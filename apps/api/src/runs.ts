import {
  buildCamt054, buildPain001, buildPain002, shortRef, statusFromStellar,
  type CreditTransfer, type Party, type SettlementInfo,
} from '@micopay-cafe/iso20022';
import Big from 'big.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Asset } from '@stellar/stellar-sdk';
import { audit, type Db } from './db.js';
import { buildPaymentTransaction, submit, type Signer } from './stellar.js';

interface SettlementRow {
  id: number;
  delivery_ref: string;
  delivery_date: Date;
  quantity: string;
  unit: string;
  product: string;
  lot: string | null;
  unit_price: string;
  gross: string;
  deductions: Array<{ reason: string; label: string; amount: string }>;
  credit_id: number | null;
  credit_ref: string | null;
  credit_repayment: string;
  net: string;
  producer_name: string;
  producer_account: string;
  producer_address: string;
  lender_address: string | null;
}

export interface RunOutcome {
  runId: number;
  status: 'settled' | 'rejected';
  txHash: string;
  resultCode?: string;
}

/**
 * Executes one payment run end to end:
 *   pain.001 → SHA-256 in the memo → one atomic Stellar transaction
 *   (producer payments + credit repayments) → pain.002 → camt.054 per producer
 *   → credit balances updated only if the ledger accepted the transaction.
 */
export async function executeRun(db: Db, deps: {
  settlementIds: number[];
  signer: Signer;
  asset: Asset;
  network: SettlementInfo['network'];
}): Promise<RunOutcome> {
  if (deps.settlementIds.length === 0) throw new Error('selecciona al menos una liquidación');

  const coop = (await db.query<{ id: number; name: string; account_id: string; stellar_address: string }>(
    `SELECT id, name, account_id, stellar_address FROM cooperatives WHERE id = 1`,
  )).rows[0];
  if (!coop) throw new Error('no hay cooperativa configurada');

  const rows = (await db.query<SettlementRow>(
    `SELECT s.id, d.reference AS delivery_ref, d.created_at AS delivery_date, d.quantity::text, pr.unit, pr.name AS product, d.lot,
            s.unit_price::text, s.gross::text, s.deductions, s.credit_id, c.reference AS credit_ref, s.credit_repayment::text, s.net::text,
            p.name AS producer_name, p.account_id AS producer_account, p.stellar_address AS producer_address,
            l.stellar_address AS lender_address
       FROM settlements s
       JOIN deliveries d ON d.id = s.delivery_id
       JOIN products pr ON pr.id = d.product_id
       JOIN producers p ON p.id = d.producer_id
       LEFT JOIN credits c ON c.id = s.credit_id
       LEFT JOIN lenders l ON l.id = c.lender_id
      WHERE s.id = ANY($1) AND s.status = 'pending'
      ORDER BY s.id`,
    [deps.settlementIds],
  )).rows;
  if (rows.length !== deps.settlementIds.length) throw new Error('alguna liquidación no existe o ya fue pagada');

  const now = new Date();
  const debtor: Party = { name: coop.name, account: { id: coop.account_id, stellarAddress: coop.stellar_address } };
  const baseSettlement: SettlementInfo = { network: deps.network, assetCode: deps.asset.getCode(), assetIssuer: deps.asset.getIssuer() };

  const transfers: Array<CreditTransfer & { settlementId: number }> = rows.map((r) => ({
    settlementId: r.id,
    instrId: shortRef('INS', now),
    endToEndId: shortRef('E2E', now),
    uetr: randomUUID(),
    amount: r.net,
    creditor: { name: r.producer_name, account: { id: r.producer_account, stellarAddress: r.producer_address } },
    document: {
      number: r.delivery_ref,
      date: new Date(r.delivery_date),
      lines: [{
        id: r.lot ?? r.delivery_ref,
        description: `${r.product} · ${new Big(r.quantity).toFixed(2)} ${r.unit} × ${r.unit_price} MXN/${r.unit}`,
        amount: r.gross,
      }],
      duePayable: r.gross,
      adjustments: [
        ...r.deductions.map((d) => ({ amount: d.amount, reason: d.reason, info: d.label })),
        ...(new Big(r.credit_repayment).gt(0)
          ? [{ amount: r.credit_repayment, reason: 'CRED', info: `Abono crédito ${r.credit_ref}` }]
          : []),
      ],
      remitted: r.net,
    },
  }));

  const msgId = shortRef('PAIN', now);
  const pmtInfId = shortRef('RUN', now);
  const pain001 = buildPain001({
    msgId, createdAt: now, initiatingParty: coop.name, pmtInfId, executionDate: now,
    debtor, currency: 'MXN', transactions: transfers, settlement: baseSettlement,
  });
  const pain001Sha256 = createHash('sha256').update(pain001).digest('hex');

  const run = (await db.query<{ id: number }>(
    `INSERT INTO payment_runs (cooperative_id, msg_id, pmt_inf_id, status, pain001, pain001_sha256, created_at)
     VALUES ($1, $2, $3, 'signing', $4, $5, $6) RETURNING id`,
    [coop.id, msgId, pmtInfId, pain001, pain001Sha256, now],
  )).rows[0]!;
  for (const t of transfers) {
    await db.query(`UPDATE settlements SET run_id = $1, instr_id = $2, end_to_end_id = $3, uetr = $4, status = 'in_run' WHERE id = $5`,
      [run.id, t.instrId, t.endToEndId, t.uetr, t.settlementId]);
  }

  // Producer payments, then repayments aggregated per lender.
  const repayByLender = new Map<string, Big>();
  for (const r of rows) {
    if (r.lender_address && new Big(r.credit_repayment).gt(0)) {
      repayByLender.set(r.lender_address, (repayByLender.get(r.lender_address) ?? new Big(0)).plus(r.credit_repayment));
    }
  }
  const tx = await buildPaymentTransaction({
    source: coop.stellar_address,
    asset: deps.asset,
    memoSha256: pain001Sha256,
    payments: [
      ...rows.filter((r) => new Big(r.net).gt(0)).map((r) => ({ destination: r.producer_address, amount: r.net })),
      ...[...repayByLender].map(([destination, amount]) => ({ destination, amount: amount.toFixed(2) })),
    ],
  });
  const result = await submit(await deps.signer.sign(tx));
  const status = statusFromStellar(result);
  const settledInfo: SettlementInfo = { ...baseSettlement, txHash: result.hash };

  const pain002 = buildPain002({
    msgId: shortRef('STS', now), createdAt: new Date(), initiatingParty: coop.name,
    originalMsgId: msgId, originalCreatedAt: now, originalPmtInfId: pmtInfId,
    entries: transfers.map((t) => ({
      originalInstrId: t.instrId, originalEndToEndId: t.endToEndId, originalUetr: t.uetr,
      status, reasonCode: result.code, reasonInfo: result.successful ? undefined : 'Stellar rechazó la transacción; no se movió dinero',
      settlement: settledInfo,
    })),
  });

  if (!result.successful) {
    await db.query(`UPDATE payment_runs SET status = 'rejected', pain002 = $1, tx_hash = $2, result_code = $3 WHERE id = $4`,
      [pain002, result.hash, result.code ?? null, run.id]);
    await db.query(`UPDATE settlements SET status = 'pending', run_id = NULL WHERE run_id = $1`, [run.id]);
    await audit(db, 'pago.rechazado', { run: msgId, tx: result.hash, code: result.code });
    return { runId: run.id, status: 'rejected', txHash: result.hash, resultCode: result.code };
  }

  const bookedAt = new Date();
  for (const [i, t] of transfers.entries()) {
    const r = rows[i]!;
    const camt054 = buildCamt054({
      msgId: shortRef('NTF', bookedAt), notificationId: shortRef('N', bookedAt), createdAt: bookedAt,
      account: t.creditor.account, accountOwner: t.creditor.name, currency: 'MXN',
      entries: [{
        amount: t.amount, direction: 'CRDT', bookedAt, instrId: t.instrId, endToEndId: t.endToEndId, uetr: t.uetr,
        debtor, creditor: t.creditor, settlement: settledInfo,
        remittance: `Liquidación ${r.delivery_ref} · ${new Big(r.quantity).toFixed(2)} ${r.unit} ${r.product}`,
      }],
    });
    await db.query(`UPDATE settlements SET status = 'paid', camt054 = $1 WHERE id = $2`, [camt054, t.settlementId]);
    if (r.credit_id && new Big(r.credit_repayment).gt(0)) {
      const balance = (await db.query<{ outstanding: string }>(
        `UPDATE credits SET outstanding = outstanding - $1,
                status = CASE WHEN outstanding - $1 <= 0 THEN 'pagado' ELSE status END
          WHERE id = $2 RETURNING outstanding::text`,
        [r.credit_repayment, r.credit_id],
      )).rows[0]!;
      await db.query(
        `INSERT INTO credit_movements (credit_id, kind, amount, balance_after, settlement_id, tx_hash) VALUES ($1, 'abono', $2, $3, $4, $5)`,
        [r.credit_id, r.credit_repayment, balance.outstanding, t.settlementId, result.hash],
      );
    }
  }
  await db.query(`UPDATE payment_runs SET status = 'settled', pain002 = $1, tx_hash = $2, settled_at = $3 WHERE id = $4`,
    [pain002, result.hash, bookedAt, run.id]);
  await audit(db, 'pago', {
    run: msgId, tx: result.hash,
    payments: rows.map((r) => ({ producer: r.producer_name, delivery: r.delivery_ref, net: r.net, repayment: r.credit_repayment })),
  });
  return { runId: run.id, status: 'settled', txHash: result.hash };
}
