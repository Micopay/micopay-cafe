import {
  buildCamt054, buildPain001, buildPain002, shortRef,
  type CreditTransfer, type Party, type SettlementInfo, type TxStatus,
} from '@micopay-cafe/iso20022';
import Big from 'big.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Asset, Transaction } from '@stellar/stellar-sdk';
import { audit, type Db, type Queryable } from './db.js';
import { toToken, usdcMxnRate } from './fx.js';
import { buildPaymentTransaction, explorerTx, NETWORK_PASSPHRASE, type Chain, type Signer } from './stellar.js';

/*
 * Payment attempts that never pay twice.
 *
 * Rule: a payment is retried only when it is proven it did not happen. The only
 * proofs this version accepts are a ledger record of the failed transaction, or
 * an envelope that never left this process. Anything else stays open, and an
 * attempt that never shows up after it expires stays blocked in needs_review.
 * Design and review history: internal plan "Pagos sin confirmar en MicoPay Café".
 */

export type RunStatus = 'prepared' | 'submitting' | 'unconfirmed' | 'settled' | 'failed_onchain' | 'not_executed' | 'needs_review';
export const OPEN_STATUSES: RunStatus[] = ['prepared', 'submitting', 'unconfirmed', 'needs_review'];
/** Terminal attempts after which the same settlement can be paid again. */
export const RETRYABLE_STATUSES: RunStatus[] = ['failed_onchain', 'not_executed'];

/** paid | unconfirmed | needs_review | failed | not_executed, from a settlement `s` joined to its last attempt `r`. */
export const PAYMENT_STATE_SQL = `CASE WHEN s.status = 'paid' THEN 'paid'
  WHEN r.status IN ('prepared', 'submitting', 'unconfirmed') THEN 'unconfirmed'
  WHEN r.status = 'needs_review' THEN 'needs_review'
  WHEN r.status = 'failed_onchain' THEN 'failed'
  WHEN r.status = 'not_executed' THEN 'not_executed'
  ELSE 'pending' END`;
export const RETRY_ALLOWED_SQL = `(s.status = 'pending' AND r.status IN ('failed_onchain', 'not_executed'))`;

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

/** Raised inside a claim to roll it back and answer with the payment already stored under that clientRef. */
class Replay extends Error {
  constructor(readonly settlementId: number) {
    super('replay');
  }
}

/** Raised inside a closing transaction when the settlements no longer belong to the attempt. */
class Discrepancy extends Error {}

/** One promise chain per key: work for the same key runs one at a time. */
class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.tails.set(key, next);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}

/* ── The immutable snapshot of an attempt ──────────────────────────────── */

interface PayloadTransfer {
  settlementId: number;
  instrId: string;
  endToEndId: string;
  uetr: string;
  /** MXN net and the token units that move. */
  amount: string;
  tokenAmount: string;
  creditor: Party;
  deliveryRef: string;
  remittance: string;
  credit: { id: number; reference: string | null; repayment: string; repaymentToken: string } | null;
}

export interface RunPayload {
  msgId: string;
  pmtInfId: string;
  createdAt: string;
  rate: string;
  coopName: string;
  debtor: Party;
  settlement: SettlementInfo;
  transfers: PayloadTransfer[];
  lenderPayments: Array<{ destination: string; amount: string }>;
}

/** What the scale computed for a delivery, returned unchanged when the request is replayed. */
export interface PaymentCalc {
  unitPrice: string;
  dailyPrice?: string;
  gross: string;
  deductions: Array<{ reason: string; label: string; amount: string }>;
  afterQuality?: string;
  creditId: number | null;
  creditRepayment: string;
  net: string;
  credit?: unknown;
}

interface Line {
  settlementId: number;
  deliveryRef: string;
  deliveryDate: Date;
  quantity: string;
  unit: string;
  product: string;
  lot: string | null;
  calc: PaymentCalc;
  creditRef: string | null;
  producer: { name: string; accountId: string; address: string };
  lenderAddress: string | null;
}

export interface NewPayment {
  producerId: number;
  productId: number;
  quantity: string;
  quality: Record<string, number>;
  lot?: string;
  notes?: string;
  clientRef?: string;
  requestSha256?: string;
  calc: PaymentCalc;
  /** Extra fields of the original response (daily price, credit preview), kept for replays. */
  preview: Record<string, unknown>;
}

export interface Evidence {
  hash: string;
  ledger: number;
  closedAt: Date;
  networkPassphrase: string;
}

export interface PaymentView extends Record<string, unknown> {
  runId: number;
  status: RunStatus;
  txHash: string;
  resultCode?: string;
  explorer: string;
  settlementId: number;
  reference: string;
  tokenAmount: string | null;
  asset: string;
  paymentState: string;
  retryAllowed: boolean;
}

export interface EngineDeps {
  db: Db;
  chain: Chain;
  signer: Signer;
  asset: Asset;
  network: SettlementInfo['network'];
  rate?: () => Promise<{ rate: string }>;
  log?: (msg: string, err?: unknown) => void;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function createPaymentEngine(deps: EngineDeps) {
  const { db, chain, signer, asset } = deps;
  const rate = deps.rate ?? usdcMxnRate;
  const log = deps.log ?? ((msg, err) => console.warn(msg, err ?? ''));
  const accountLock = new KeyedLock();
  const runLock = new KeyedLock();

  async function cooperative() {
    const coop = (await db.query<{ id: number; name: string; account_id: string; stellar_address: string }>(
      `SELECT id, name, account_id, stellar_address FROM cooperatives WHERE id = 1`,
    )).rows[0];
    if (!coop) throw new Error('no hay cooperativa configurada');
    return coop;
  }

  function assertLocalSigner() {
    if (signer.kind !== 'local') {
      throw new HttpError(503, 'La firma desde la app de MicoPay está desactivada hasta corregir su contrato');
    }
  }

  /* ── views ─────────────────────────────────────────────────────────── */

  async function view(settlementId: number, extra: Record<string, unknown> = {}): Promise<PaymentView> {
    const row = (await db.query<{
      run_id: number; status: RunStatus; tx_hash: string; result_code: string | null; reference: string;
      token_amount: string | null; preview: Record<string, unknown> | null; payment_state: string; retry_allowed: boolean;
    }>(
      `SELECT s.run_id, r.status, r.tx_hash, r.result_code, d.reference, s.token_amount::text, s.preview,
              ${PAYMENT_STATE_SQL} AS payment_state, ${RETRY_ALLOWED_SQL} AS retry_allowed
         FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN payment_runs r ON r.id = s.run_id
        WHERE s.id = $1`,
      [settlementId],
    )).rows[0];
    if (!row) throw new HttpError(404, 'el pago no existe');
    return {
      ...(row.preview ?? {}),
      runId: row.run_id, status: row.status, txHash: row.tx_hash,
      ...(row.result_code ? { resultCode: row.result_code } : {}),
      explorer: explorerTx(row.tx_hash), settlementId, reference: row.reference,
      tokenAmount: row.token_amount, asset: asset.getCode(),
      paymentState: row.payment_state, retryAllowed: row.retry_allowed, ...extra,
    };
  }

  async function findByRef(q: Queryable, clientRef: string) {
    return (await q.query<{ settlement_id: number; request_sha256: string | null }>(
      `SELECT s.id AS settlement_id, d.request_sha256 FROM deliveries d JOIN settlements s ON s.delivery_id = d.id WHERE d.client_ref = $1`,
      [clientRef],
    )).rows[0];
  }

  async function replay(found: { settlement_id: number; request_sha256: string | null }, requestSha256: string | undefined) {
    if (found.request_sha256 !== (requestSha256 ?? null)) {
      throw new HttpError(409, 'esta referencia de la báscula ya se usó con otros datos');
    }
    return view(found.settlement_id, { replayed: true });
  }

  /** Answers a POST that carries a clientRef already stored, before any call to Horizon. */
  async function lookupRef(clientRef: string, requestSha256: string | undefined): Promise<PaymentView | null> {
    const found = await findByRef(db, clientRef);
    return found ? replay(found, requestSha256) : null;
  }

  /* ── ISO documents from the snapshot ───────────────────────────────── */

  function statusReport(p: RunPayload, status: TxStatus, extra: { txHash: string; reasonCode?: string; reasonInfo?: string }): string {
    return buildPain002({
      msgId: shortRef('STS'), createdAt: new Date(), initiatingParty: p.coopName,
      originalMsgId: p.msgId, originalCreatedAt: new Date(p.createdAt), originalPmtInfId: p.pmtInfId,
      entries: p.transfers.map((t) => ({
        originalInstrId: t.instrId, originalEndToEndId: t.endToEndId, originalUetr: t.uetr,
        status, reasonCode: extra.reasonCode, reasonInfo: extra.reasonInfo,
        settlement: { ...p.settlement, txHash: extra.txHash, fxRate: p.rate, tokenAmount: t.tokenAmount },
      })),
    });
  }

  /* ── building an attempt (outside any database transaction) ─────────── */

  async function buildAttempt(coop: { name: string; account_id: string; stellar_address: string }, lines: Line[], now: Date) {
    const tip = await chain.tip();
    if (tip.networkPassphrase !== NETWORK_PASSPHRASE) {
      throw new HttpError(503, 'Horizon responde para otra red; no se envía el pago');
    }
    // One rate for the whole run: MXN amounts are what was agreed, USDC is what moves.
    const { rate: fx } = await rate();
    const unitCcy = asset.getCode() === 'USDC' ? 'USD' : null;
    const debtor: Party = { name: coop.name, account: { id: coop.account_id, stellarAddress: coop.stellar_address } };
    const base: SettlementInfo = { network: deps.network, assetCode: asset.getCode(), assetIssuer: asset.getIssuer() };

    const transfers: Array<CreditTransfer & { line: Line; tokenAmount: string }> = lines.map((l) => {
      const tokenAmount = toToken(l.calc.net, fx);
      return {
        line: l, tokenAmount,
        instrId: shortRef('INS', now), endToEndId: shortRef('E2E', now), uetr: randomUUID(),
        amount: l.calc.net,
        ...(unitCcy ? { exchangeRate: { unitCcy, rate: fx } } : {}),
        creditor: { name: l.producer.name, account: { id: l.producer.accountId, stellarAddress: l.producer.address } },
        document: {
          number: l.deliveryRef,
          date: l.deliveryDate,
          lines: [{
            id: l.lot ?? l.deliveryRef,
            description: `${l.product} · ${new Big(l.quantity).toFixed(2)} ${l.unit} × ${l.calc.unitPrice} MXN/${l.unit}`,
            amount: l.calc.gross,
          }],
          duePayable: l.calc.gross,
          adjustments: [
            ...l.calc.deductions.map((d) => ({ amount: d.amount, reason: d.reason, info: d.label })),
            ...(new Big(l.calc.creditRepayment).gt(0)
              ? [{ amount: l.calc.creditRepayment, reason: 'CRED', info: `Abono crédito ${l.creditRef}` }]
              : []),
          ],
          remitted: l.calc.net,
        },
        settlement: { ...base, tokenAmount, fxRate: fx },
      };
    });

    const msgId = shortRef('PAIN', now);
    const pmtInfId = shortRef('RUN', now);
    const pain001 = buildPain001({
      msgId, createdAt: now, initiatingParty: coop.name, pmtInfId, executionDate: now,
      debtor, currency: 'MXN', transactions: transfers, settlement: base,
    });
    const pain001Sha256 = sha256(pain001);

    // Producer payments, then repayments aggregated per lender.
    const repayByLender = new Map<string, Big>();
    for (const l of lines) {
      if (l.lenderAddress && new Big(l.calc.creditRepayment).gt(0)) {
        repayByLender.set(l.lenderAddress, (repayByLender.get(l.lenderAddress) ?? new Big(0)).plus(l.calc.creditRepayment));
      }
    }
    const lenderPayments = [...repayByLender].map(([destination, amount]) => ({ destination, amount: toToken(amount.toFixed(2), fx) }));
    const tx = buildPaymentTransaction({
      account: await chain.loadAccount(coop.stellar_address),
      asset,
      memoSha256: pain001Sha256,
      payments: [
        ...transfers.filter((t) => new Big(t.tokenAmount).gt(0)).map((t) => ({ destination: t.creditor.account.stellarAddress, amount: t.tokenAmount })),
        ...lenderPayments,
      ],
    });

    const payload: RunPayload = {
      msgId, pmtInfId, createdAt: now.toISOString(), rate: fx, coopName: coop.name, debtor, settlement: base, lenderPayments,
      transfers: transfers.map((t) => ({
        settlementId: t.line.settlementId, instrId: t.instrId, endToEndId: t.endToEndId, uetr: t.uetr,
        amount: t.amount, tokenAmount: t.tokenAmount, creditor: t.creditor, deliveryRef: t.line.deliveryRef,
        remittance: `Liquidación ${t.line.deliveryRef} · ${new Big(t.line.quantity).toFixed(2)} ${t.line.unit} ${t.line.product}`,
        credit: t.line.calc.creditId && new Big(t.line.calc.creditRepayment).gt(0)
          ? { id: t.line.calc.creditId, reference: t.line.creditRef, repayment: t.line.calc.creditRepayment, repaymentToken: toToken(t.line.calc.creditRepayment, fx) }
          : null,
      })),
    };
    return {
      tx, txHash: tx.hash().toString('hex'), pain001, pain001Sha256, payload, tip,
      maxTime: new Date(Number(tx.timeBounds!.maxTime) * 1000),
    };
  }

  type Attempt = Awaited<ReturnType<typeof buildAttempt>>;

  async function insertRun(q: Queryable, runId: number, coopId: number, a: Attempt, now: Date) {
    await q.query(
      `INSERT INTO payment_runs (id, cooperative_id, msg_id, pmt_inf_id, status, pain001, pain001_sha256, tx_hash, fx_rate,
                                 source_account, tx_sequence, max_time, network_passphrase, ledger_at_build_seq, envelope_xdr, run_payload, created_at)
       VALUES ($1, $2, $3, $4, 'prepared', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [runId, coopId, a.payload.msgId, a.payload.pmtInfId, a.pain001, a.pain001Sha256, a.txHash, a.payload.rate,
        a.tx.source, a.tx.sequence, a.maxTime, NETWORK_PASSPHRASE, a.tip.latestLedger, a.tx.toEnvelope().toXDR('base64'),
        JSON.stringify(a.payload), now],
    );
  }

  /** D3: one open attempt per producer, whatever path opens the next one. */
  async function assertNoOpenAttempt(q: Queryable, producerId: number) {
    const open = (await q.query(
      `SELECT 1 FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN payment_runs r ON r.id = s.run_id
        WHERE d.producer_id = $1 AND r.status = ANY($2) LIMIT 1`,
      [producerId, OPEN_STATUSES],
    )).rows.length > 0;
    if (open) throw new HttpError(409, 'Hay un pago sin confirmar a este productor; revisa el historial');
  }

  async function reserveRunId(): Promise<number> {
    return (await db.query<{ id: number }>(`SELECT nextval('payment_runs_id_seq')::int AS id`)).rows[0]!.id;
  }

  /* ── sending a claimed attempt ─────────────────────────────────────── */

  async function sendClaimed(runId: number, tx: Transaction, txHash: string): Promise<void> {
    let signed: Transaction;
    try {
      signed = await signer.sign(tx);
    } catch (err) {
      await closeNotExecuted(runId, `la firma local falló: ${(err as Error).message}`);
      return;
    }
    if (signed.hash().toString('hex') !== txHash) {
      await closeNotExecuted(runId, 'el firmador devolvió otra transacción');
      return;
    }
    const moved = await db.query(
      `UPDATE payment_runs SET status = 'submitting', signed_envelope_xdr = $2 WHERE id = $1 AND status = 'prepared' RETURNING id`,
      [runId, signed.toEnvelope().toXDR('base64')],
    );
    if (moved.rows.length !== 1) return; // someone else closed it: never POST
    const outcome = await chain.submit(signed);
    if (outcome.kind === 'success') {
      let closedAt: Date;
      try {
        closedAt = await chain.ledgerClosedAt(outcome.ledger);
      } catch (err) {
        log(`pago ${runId}: éxito sin hora de cierre; queda para el reconciliador`, err);
        await markUnconfirmed(runId, 'sin hora de cierre del ledger');
        return;
      }
      await applySettled(runId, { hash: outcome.hash, ledger: outcome.ledger, closedAt, networkPassphrase: NETWORK_PASSPHRASE });
      return;
    }
    await markUnconfirmed(runId, outcome.code);
  }

  async function payloadOf(q: Queryable, runId: number): Promise<{ status: RunStatus; tx_hash: string; payload: RunPayload } | undefined> {
    const row = (await q.query<{ status: RunStatus; tx_hash: string; run_payload: RunPayload }>(
      `SELECT status, tx_hash, run_payload FROM payment_runs WHERE id = $1`, [runId],
    )).rows[0];
    return row && { status: row.status, tx_hash: row.tx_hash, payload: row.run_payload };
  }

  async function markUnconfirmed(runId: number, code: string | undefined) {
    const run = await payloadOf(db, runId);
    if (!run) return;
    await db.query(
      `UPDATE payment_runs SET status = 'unconfirmed', result_code = $2, pain002 = $3 WHERE id = $1 AND status = 'submitting'`,
      [runId, code ?? null, statusReport(run.payload, 'PDNG', { txHash: run.tx_hash })],
    );
    await audit(db, 'pago.sin_confirmar', { run: run.payload.msgId, tx: run.tx_hash, code });
  }

  async function markNeedsReview(runId: number, from: RunStatus[], reason: string) {
    const r = await db.query<{ msg_id: string; tx_hash: string }>(
      `UPDATE payment_runs SET status = 'needs_review', checked_at = NOW() WHERE id = $1 AND status = ANY($2) RETURNING msg_id, tx_hash`,
      [runId, from],
    );
    if (r.rows[0]) await audit(db, 'pago.requiere_revision', { run: r.rows[0].msg_id, tx: r.rows[0].tx_hash, reason });
  }

  /** Puts the attempt's settlements back to pending, only if they still belong to it. */
  async function releaseSettlements(q: Queryable, runId: number, p: RunPayload) {
    const ids = p.transfers.map((t) => t.settlementId);
    const released = await q.query(
      `UPDATE settlements SET status = 'pending' WHERE run_id = $1 AND status = 'in_run' AND id = ANY($2) RETURNING id`,
      [runId, ids],
    );
    if (released.rows.length !== ids.length) throw new Discrepancy('las liquidaciones ya no pertenecen a este intento');
  }

  async function onDiscrepancy(runId: number, err: unknown, action: string) {
    if (!(err instanceof Discrepancy)) throw err;
    await audit(db, 'pago.discrepancia', { runId, action, reason: err.message });
    await markNeedsReview(runId, ['prepared', 'submitting', 'unconfirmed'], err.message);
  }

  /** The envelope never left this process (local signer): proven not executed. */
  async function closeNotExecuted(runId: number, reason: string) {
    try {
      await db.transaction(async (tx) => {
        const run = (await tx.query<{ run_payload: RunPayload; msg_id: string }>(
          `UPDATE payment_runs SET status = 'not_executed', result_code = $2 WHERE id = $1 AND status = 'prepared' RETURNING run_payload, msg_id`,
          [runId, reason],
        )).rows[0];
        if (!run) return;
        await releaseSettlements(tx, runId, run.run_payload);
        await audit(tx, 'pago.no_ejecutado', { run: run.msg_id, reason });
      });
    } catch (err) {
      await onDiscrepancy(runId, err, 'no_ejecutado');
    }
  }

  /** A ledger record shows the transaction failed: nothing was paid to the producers. */
  async function closeFailedOnchain(runId: number, from: RunStatus[], hash: string, code: string) {
    try {
      await db.transaction(async (tx) => {
        const run = (await tx.query<{ run_payload: RunPayload; msg_id: string }>(
          `SELECT run_payload, msg_id FROM payment_runs WHERE id = $1 AND status = ANY($2) AND tx_hash = $3 FOR UPDATE`,
          [runId, from, hash],
        )).rows[0];
        if (!run) return;
        await tx.query(`UPDATE payment_runs SET status = 'failed_onchain', result_code = $2, pain002 = $3 WHERE id = $1`, [
          runId, code,
          statusReport(run.run_payload, 'RJCT', { txHash: hash, reasonCode: code || 'NARR', reasonInfo: 'La transacción falló en Stellar; no se ejecutó el pago al productor' }),
        ]);
        await releaseSettlements(tx, runId, run.run_payload);
        await audit(tx, 'pago.fallido', { run: run.msg_id, tx: hash, code });
      });
    } catch (err) {
      await onDiscrepancy(runId, err, 'fallido');
    }
  }

  /**
   * Applies a proven success exactly once: documents, settlements, credit
   * repayments and audit in one transaction, built only from the stored snapshot.
   */
  async function applySettled(runId: number, ev: Evidence): Promise<void> {
    try {
      const applied = await db.transaction(async (tx) => {
        const run = (await tx.query<{ run_payload: RunPayload; msg_id: string }>(
          `UPDATE payment_runs SET status = 'settled', ledger = $4, settled_at = $5
            WHERE id = $1 AND status IN ('submitting', 'unconfirmed', 'needs_review') AND tx_hash = $2 AND network_passphrase = $3
            RETURNING run_payload, msg_id`,
          [runId, ev.hash, ev.networkPassphrase, ev.ledger, ev.closedAt],
        )).rows[0];
        if (!run) return false;
        const p = run.run_payload;
        const ids = p.transfers.map((t) => t.settlementId);
        const owned = await tx.query(`SELECT id FROM settlements WHERE run_id = $1 AND status = 'in_run' AND id = ANY($2) FOR UPDATE`, [runId, ids]);
        if (owned.rows.length !== ids.length) throw new Discrepancy('las liquidaciones ya no pertenecen a este intento');

        const bookedAt = ev.closedAt;
        const settled: SettlementInfo = { ...p.settlement, txHash: ev.hash, fxRate: p.rate };
        for (const t of p.transfers) {
          const camt054 = buildCamt054({
            msgId: shortRef('NTF', bookedAt), notificationId: shortRef('N', bookedAt), createdAt: bookedAt,
            account: t.creditor.account, accountOwner: t.creditor.name, currency: 'MXN',
            entries: [{
              amount: t.amount, direction: 'CRDT', bookedAt, instrId: t.instrId, endToEndId: t.endToEndId, uetr: t.uetr,
              debtor: p.debtor, creditor: t.creditor, settlement: { ...settled, tokenAmount: t.tokenAmount }, remittance: t.remittance,
            }],
          });
          await tx.query(`UPDATE settlements SET status = 'paid', camt054 = $1 WHERE id = $2`, [camt054, t.settlementId]);
          if (t.credit) {
            const balance = (await tx.query<{ outstanding: string }>(
              `UPDATE credits SET outstanding = outstanding - $1,
                      status = CASE WHEN outstanding - $1 <= 0 THEN 'pagado' ELSE status END
                WHERE id = $2 RETURNING outstanding::text`,
              [t.credit.repayment, t.credit.id],
            )).rows[0];
            if (!balance) throw new Discrepancy(`el crédito ${t.credit.id} del abono no existe`);
            await tx.query(
              `INSERT INTO credit_movements (credit_id, kind, amount, balance_after, settlement_id, tx_hash, token_amount, fx_rate, created_at)
               VALUES ($1, 'abono', $2, $3, $4, $5, $6, $7, $8)`,
              [t.credit.id, t.credit.repayment, balance.outstanding, t.settlementId, ev.hash, t.credit.repaymentToken, p.rate, bookedAt],
            );
          }
        }
        await tx.query(`UPDATE payment_runs SET pain002 = $2 WHERE id = $1`, [runId, statusReport(p, 'ACSC', { txHash: ev.hash })]);
        await audit(tx, 'pago', {
          run: run.msg_id, tx: ev.hash, ledger: ev.ledger,
          payments: p.transfers.map((t) => ({ producer: t.creditor.name, delivery: t.deliveryRef, net: t.amount, repayment: t.credit?.repayment ?? '0.00' })),
        });
        return true;
      });
      if (applied) return;
    } catch (err) {
      await onDiscrepancy(runId, err, 'pagado');
      return;
    }
    // Nothing updated: tell an already applied success from a late answer or a contradiction.
    const now = (await db.query<{ status: RunStatus; tx_hash: string }>(`SELECT status, tx_hash FROM payment_runs WHERE id = $1`, [runId])).rows[0];
    if (!now || (now.status === 'settled' && now.tx_hash === ev.hash)) return;
    if (now.status === 'failed_onchain' || now.status === 'not_executed' || now.status === 'settled') {
      await audit(db, 'pago.discrepancia', { runId, action: 'pagado', reason: `Stellar muestra éxito y el intento está ${now.status}` });
    }
  }

  /* ── public operations ─────────────────────────────────────────────── */

  /** Records a delivery, claims it and pays it, under the cooperative account lock. */
  async function createAndPay(req: NewPayment): Promise<PaymentView> {
    assertLocalSigner();
    const coop = await cooperative();
    return accountLock.run(coop.stellar_address, async () => {
      if (req.clientRef) {
        const found = await findByRef(db, req.clientRef);
        if (found) return replay(found, req.requestSha256);
      }
      const info = (await db.query<{ name: string; account_id: string; stellar_address: string; product: string; unit: string; lender_address: string | null; credit_ref: string | null }>(
        `SELECT p.name, p.account_id, p.stellar_address, pr.name AS product, pr.unit, l.stellar_address AS lender_address, c.reference AS credit_ref
           FROM producers p JOIN products pr ON pr.id = $2 LEFT JOIN credits c ON c.id = $3 LEFT JOIN lenders l ON l.id = c.lender_id
          WHERE p.id = $1`,
        [req.producerId, req.productId, req.calc.creditId],
      )).rows[0];
      if (!info) throw new Error('el productor o el producto no existen');

      const ids = (await db.query<{ d: number; s: number; n: number }>(
        `SELECT nextval('deliveries_id_seq')::int AS d, nextval('settlements_id_seq')::int AS s, nextval('delivery_ref_seq')::int AS n`,
      )).rows[0]!;
      const runId = await reserveRunId();
      const now = new Date();
      const reference = `ENT-${now.getFullYear()}-${String(ids.n).padStart(6, '0')}`;
      const line: Line = {
        settlementId: ids.s, deliveryRef: reference, deliveryDate: now, quantity: req.quantity, unit: info.unit, product: info.product,
        lot: req.lot || null, calc: req.calc, creditRef: info.credit_ref,
        producer: { name: info.name, accountId: info.account_id, address: info.stellar_address }, lenderAddress: info.lender_address,
      };
      const attempt = await buildAttempt(coop, [line], now);
      const t = attempt.payload.transfers[0]!;

      return runLock.run(String(runId), async () => {
        try {
          await db.transaction(async (tx) => {
            await tx.query(`SELECT id FROM producers WHERE id = $1 FOR UPDATE`, [req.producerId]);
            if (req.clientRef) {
              const found = await findByRef(tx, req.clientRef);
              if (found) throw new Replay(found.settlement_id);
            }
            await assertNoOpenAttempt(tx, req.producerId);
            await insertRun(tx, runId, coop.id, attempt, now);
            const delivery = (await tx.query<{ id: number }>(
              `INSERT INTO deliveries (id, reference, producer_id, product_id, quantity, quality, lot, notes, client_ref, request_sha256, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (client_ref) DO NOTHING RETURNING id`,
              [ids.d, reference, req.producerId, req.productId, req.quantity, JSON.stringify(req.quality), req.lot || null, req.notes || null,
                req.clientRef ?? null, req.requestSha256 ?? null, now],
            )).rows[0];
            if (!delivery) {
              const found = await findByRef(tx, req.clientRef!);
              throw new Replay(found!.settlement_id);
            }
            await tx.query(
              `INSERT INTO settlements (id, delivery_id, unit_price, gross, deductions, credit_id, credit_repayment, net, status, run_id,
                                        instr_id, end_to_end_id, uetr, token_amount, preview)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_run',$9,$10,$11,$12,$13,$14)`,
              [ids.s, ids.d, req.calc.unitPrice, req.calc.gross, JSON.stringify(req.calc.deductions), req.calc.creditId, req.calc.creditRepayment,
                req.calc.net, runId, t.instrId, t.endToEndId, t.uetr, t.tokenAmount, JSON.stringify(req.preview)],
            );
          });
        } catch (err) {
          if (err instanceof Replay) return replay((await findByRef(db, req.clientRef!))!, req.requestSha256);
          throw err;
        }
        await sendClaimed(runId, attempt.tx, attempt.txHash);
        return view(ids.s);
      });
    });
  }

  /** Pays again a settlement whose last attempt is proven not to have paid. */
  async function retry(settlementId: number): Promise<PaymentView> {
    assertLocalSigner();
    const last = (await db.query<{ run_id: number | null }>(`SELECT run_id FROM settlements WHERE id = $1`, [settlementId])).rows[0];
    if (!last) throw new HttpError(404, 'el pago no existe');
    if (last.run_id) await reconcileRun(last.run_id);

    const row = (await db.query<{
      status: string; run_id: number; run_status: RunStatus; producer_id: number; delivery_ref: string; delivery_date: Date; quantity: string;
      unit: string; product: string; lot: string | null; unit_price: string; gross: string; deductions: PaymentCalc['deductions'];
      credit_id: number | null; credit_ref: string | null; credit_repayment: string; net: string; producer_name: string;
      producer_account: string; producer_address: string; lender_address: string | null;
    }>(
      `SELECT s.status, s.run_id, r.status AS run_status, d.producer_id, d.reference AS delivery_ref, d.created_at AS delivery_date,
              d.quantity::text, pr.unit, pr.name AS product, d.lot, s.unit_price::text, s.gross::text, s.deductions, s.credit_id,
              c.reference AS credit_ref, s.credit_repayment::text, s.net::text, p.name AS producer_name, p.account_id AS producer_account,
              p.stellar_address AS producer_address, l.stellar_address AS lender_address
         FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN products pr ON pr.id = d.product_id
         JOIN producers p ON p.id = d.producer_id JOIN payment_runs r ON r.id = s.run_id
         LEFT JOIN credits c ON c.id = s.credit_id LEFT JOIN lenders l ON l.id = c.lender_id
        WHERE s.id = $1`,
      [settlementId],
    )).rows[0];
    if (!row) throw new HttpError(409, 'este pago no tiene un intento anterior que pruebe que no se hizo');
    if (row.status !== 'pending' || !RETRYABLE_STATUSES.includes(row.run_status)) {
      throw new HttpError(409, row.status === 'paid' ? 'este pago ya se hizo' : 'este pago no se puede reintentar: no está probado que el intento anterior no se hizo');
    }
    const expectedRun = row.run_id;
    const coop = await cooperative();
    return accountLock.run(coop.stellar_address, async () => {
      const runId = await reserveRunId();
      const now = new Date();
      const line: Line = {
        settlementId, deliveryRef: row.delivery_ref, deliveryDate: new Date(row.delivery_date), quantity: row.quantity, unit: row.unit,
        product: row.product, lot: row.lot, creditRef: row.credit_ref, lenderAddress: row.lender_address,
        calc: { unitPrice: row.unit_price, gross: row.gross, deductions: row.deductions, creditId: row.credit_id, creditRepayment: row.credit_repayment, net: row.net },
        producer: { name: row.producer_name, accountId: row.producer_account, address: row.producer_address },
      };
      const attempt = await buildAttempt(coop, [line], now);
      const t = attempt.payload.transfers[0]!;
      return runLock.run(String(runId), async () => {
        await db.transaction(async (tx) => {
          await tx.query(`SELECT id FROM producers WHERE id = $1 FOR UPDATE`, [row.producer_id]);
          await assertNoOpenAttempt(tx, row.producer_id);
          const eligible = (await tx.query(
            `SELECT 1 FROM settlements s JOIN payment_runs r ON r.id = s.run_id
              WHERE s.id = $1 AND s.status = 'pending' AND s.run_id = $2 AND r.status = ANY($3)`,
            [settlementId, expectedRun, RETRYABLE_STATUSES],
          )).rows.length > 0;
          if (!eligible) throw new HttpError(409, 'este pago ya tiene otro intento; revisa el historial');
          await insertRun(tx, runId, coop.id, attempt, now);
          const claimed = await tx.query(
            `UPDATE settlements SET status = 'in_run', run_id = $2, instr_id = $3, end_to_end_id = $4, uetr = $5, token_amount = $6
              WHERE id = $1 AND status = 'pending' AND run_id = $7 RETURNING id`,
            [settlementId, runId, t.instrId, t.endToEndId, t.uetr, t.tokenAmount, expectedRun],
          );
          if (claimed.rows.length !== 1) throw new HttpError(409, 'este pago ya tiene otro intento; revisa el historial');
        });
        await sendClaimed(runId, attempt.tx, attempt.txHash);
        return view(settlementId);
      });
    });
  }

  /**
   * Closes an open attempt only on positive evidence from the ledger. A 404 never
   * proves absence on the public Horizon: after the envelope expires the attempt
   * moves to needs_review and stays blocked.
   */
  async function reconcileRun(runId: number): Promise<void> {
    await runLock.run(String(runId), async () => {
      const run = (await db.query<{ status: RunStatus; tx_hash: string; max_time: Date; network_passphrase: string }>(
        `SELECT status, tx_hash, max_time, network_passphrase FROM payment_runs WHERE id = $1`, [runId],
      )).rows[0];
      if (!run || !['submitting', 'unconfirmed', 'needs_review'].includes(run.status)) return;
      await db.query(`UPDATE payment_runs SET checked_at = NOW() WHERE id = $1`, [runId]);
      const found = await chain.lookup(run.tx_hash);
      const tip = await chain.tip().catch(() => null);
      if (!tip || tip.networkPassphrase !== run.network_passphrase) return; // cannot vouch for the source
      if (found.kind === 'found') {
        if (found.successful) {
          await applySettled(runId, { hash: found.hash, ledger: found.ledger, closedAt: found.closedAt, networkPassphrase: tip.networkPassphrase });
        } else {
          await closeFailedOnchain(runId, [run.status], found.hash, found.resultCode);
        }
        return;
      }
      if (run.status === 'needs_review') return;
      if (tip.latestClosedAt.getTime() > new Date(run.max_time).getTime()) {
        await markNeedsReview(runId, [run.status], 'no aparece en Stellar después de vencer; un 404 no prueba que no se hizo');
      } else if (run.status === 'submitting') {
        // No request is in flight (we hold the run lock): the outcome of that POST is unknown.
        await db.query(`UPDATE payment_runs SET status = 'unconfirmed' WHERE id = $1 AND status = 'submitting'`, [runId]);
      }
    });
  }

  /** Startup, before accepting traffic: close what never left, look up the rest. */
  async function recover(): Promise<void> {
    const prepared = (await db.query<{ id: number }>(`SELECT id FROM payment_runs WHERE status = 'prepared' ORDER BY id`)).rows;
    for (const r of prepared) await closeNotExecuted(r.id, 'el proceso se detuvo antes de firmar o enviar');
    const open = (await db.query<{ id: number }>(
      `SELECT id FROM payment_runs WHERE status IN ('submitting', 'unconfirmed', 'needs_review') ORDER BY id`,
    )).rows;
    for (const r of open) await reconcileRun(r.id).catch((err) => log(`reconciliación del intento ${r.id}`, err));
  }

  /** Periodic pass: open attempts every time; needs_review every 10 minutes for its first day. */
  async function tick(): Promise<void> {
    const due = (await db.query<{ id: number }>(
      `SELECT id FROM payment_runs
        WHERE status IN ('submitting', 'unconfirmed')
           OR (status = 'needs_review' AND created_at > NOW() - INTERVAL '24 hours'
               AND (checked_at IS NULL OR checked_at < NOW() - INTERVAL '10 minutes'))
        ORDER BY id`,
    )).rows;
    for (const r of due) await reconcileRun(r.id).catch((err) => log(`reconciliación del intento ${r.id}`, err));
  }

  /** On a payment detail: reconcile its open attempt at most every 10 seconds. */
  async function refresh(settlementId: number): Promise<void> {
    const r = (await db.query<{ run_id: number }>(
      `SELECT s.run_id FROM settlements s JOIN payment_runs r ON r.id = s.run_id
        WHERE s.id = $1 AND r.status IN ('submitting', 'unconfirmed', 'needs_review')
          AND (r.checked_at IS NULL OR r.checked_at < NOW() - INTERVAL '10 seconds')`,
      [settlementId],
    )).rows[0];
    if (r) await reconcileRun(r.run_id).catch((err) => log(`reconciliación del intento ${r.run_id}`, err));
  }

  return { createAndPay, retry, reconcileRun, recover, tick, refresh, lookupRef, view, applySettled };
}

export type PaymentEngine = ReturnType<typeof createPaymentEngine>;
