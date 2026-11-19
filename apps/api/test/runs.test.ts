import { Account, Asset, Keypair, Networks, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateXML } from 'xmllint-wasm';
import { markSchemaCut, openDb, type Db } from '../src/db.js';
import { createPaymentEngine, type NewPayment, type PaymentEngine } from '../src/runs.js';
import { LocalSigner, type Chain, type ChainTip, type Lookup, type Signer, type SubmitOutcome } from '../src/stellar.js';

/* ── A Horizon stand-in whose answers each test controls ───────────────── */

interface Recorded { successful: boolean; ledger: number; closedAt: Date; resultCode: string }

class FakeChain implements Chain {
  network = Networks.TESTNET;
  latestLedger = 1000;
  latestClosedAt = new Date();
  down = false;
  ledgerTimes = true;
  seqs = new Map<string, bigint>();
  ledger = new Map<string, Recorded>();
  submits: Transaction[] = [];
  /** Decides each POST; the default includes the transaction successfully. */
  onSubmit: (tx: Transaction) => Promise<SubmitOutcome> | SubmitOutcome = (tx) => this.include(tx, true);

  include(tx: Transaction, successful: boolean): SubmitOutcome {
    const hash = tx.hash().toString('hex');
    this.latestLedger += 1;
    this.ledger.set(hash, { successful, ledger: this.latestLedger, closedAt: new Date(), resultCode: successful ? 'txSuccess' : 'paymentUnderfunded' });
    this.seqs.set(tx.source, BigInt(tx.sequence));
    return successful ? { kind: 'success', hash, ledger: this.latestLedger } : { kind: 'unknown', code: 'tx_failed' };
  }

  async loadAccount(address: string) {
    if (this.down) throw new Error('horizon caído');
    return new Account(address, String(this.seqs.get(address) ?? 100n));
  }
  async tip(): Promise<ChainTip> {
    if (this.down) throw new Error('horizon caído');
    return { networkPassphrase: this.network, latestLedger: this.latestLedger, latestClosedAt: this.latestClosedAt };
  }
  async ledgerClosedAt(): Promise<Date> {
    if (this.down || !this.ledgerTimes) throw new Error('sin ledger');
    return new Date();
  }
  async submit(tx: Transaction): Promise<SubmitOutcome> {
    this.submits.push(tx);
    return this.onSubmit(tx);
  }
  async lookup(hash: string): Promise<Lookup> {
    if (this.down) return { kind: 'error' };
    const r = this.ledger.get(hash);
    return r ? { kind: 'found', hash, ...r } : { kind: 'not_found' };
  }
}

const never = () => new Promise<never>(() => {});

interface World { db: Db; chain: FakeChain; engine: PaymentEngine; coop: Keypair; producers: number[]; creditId: number; dir?: string }
const opened: Db[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const db of opened.splice(0)) await db.close().catch(() => undefined);
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function engineFor(db: Db, chain: FakeChain, signer: Signer) {
  return createPaymentEngine({
    db, chain, signer, asset: new Asset('USDC', Keypair.random().publicKey()), network: 'TESTNET',
    rate: async () => ({ rate: '17.000000' }), log: () => undefined,
  });
}

async function world(opts: { dir?: string; signer?: (coop: Keypair) => Signer; chain?: FakeChain } = {}): Promise<World> {
  const db = await openDb(opts.dir);
  opened.push(db);
  const coop = Keypair.random();
  const fresh = !(await db.query(`SELECT 1 FROM cooperatives`)).rows.length;
  if (fresh) {
    await markSchemaCut(db);
    await db.query(`INSERT INTO cooperatives (name, account_id, stellar_address) VALUES ('Compradora Demo', 'COOP-0001', $1)`, [coop.publicKey()]);
    await db.query(`INSERT INTO lenders (name, account_id, stellar_address) VALUES ('Fondo Demo', 'LEND-0001', $1)`, [Keypair.random().publicKey()]);
    for (const n of [1, 2]) {
      await db.query(`INSERT INTO producers (cooperative_id, name, account_id, stellar_address) VALUES (1, $1, $2, $3)`,
        [`Productor ${n}`, `PROD-000${n}`, Keypair.random().publicKey()]);
    }
    await db.query(`INSERT INTO products (name, unit) VALUES ('Café cereza', 'kg')`);
    await db.query(`INSERT INTO credits (reference, producer_id, lender_id, purpose, principal, annual_rate, term_months, interest, total_due,
                     outstanding, repayment_percent, due_date, status, terms_json, terms_sha256)
                    VALUES ('CR-1', 1, 1, 'Avío', 1000, 0, 6, 0, 1000, 1000, 25, CURRENT_DATE + 90, 'vigente', '{}', $1)`, ['0'.repeat(64)]);
  }
  const chain = opts.chain ?? new FakeChain();
  const engine = engineFor(db, chain, (opts.signer ?? ((k) => new LocalSigner(k)))(coop));
  return { db, chain, engine, coop, producers: [1, 2], creditId: 1, dir: opts.dir };
}

function payment(producerId = 1, extra: Partial<NewPayment> = {}): NewPayment {
  const calc = { unitPrice: '17.50', gross: '175.00', deductions: [], creditId: null, creditRepayment: '0.00', net: '175.00' };
  return { producerId, productId: 1, quantity: '10', quality: {}, calc, preview: { ...calc, dailyPrice: '17.50', credit: null }, ...extra };
}

const one = async <T>(db: Db, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const count = async (db: Db, sql: string, params: unknown[] = []) => (await one<{ n: number }>(db, `SELECT COUNT(*)::int AS n FROM (${sql}) x`, params)).n;
const runStatus = async (db: Db, id: number) => (await one<{ status: string }>(db, `SELECT status FROM payment_runs WHERE id = $1`, [id])).status;

/* ── tests ─────────────────────────────────────────────────────────────── */

describe('clasificación del envío', () => {
  it('un 200 con el hash esperado y su ledger deja el pago pagado, con documentos y memo del pain.001 guardado', async () => {
    const w = await world();
    const r = await w.engine.createAndPay(payment());
    expect(r).toMatchObject({ status: 'settled', paymentState: 'paid', retryAllowed: false, gross: '175.00', net: '175.00', dailyPrice: '17.50' });
    const run = await one<{ pain001: string; pain001_sha256: string; signed_envelope_xdr: string; pain002: string }>(w.db, `SELECT * FROM payment_runs WHERE id = $1`, [r.runId]);
    const signed = TransactionBuilder.fromXDR(run.signed_envelope_xdr, Networks.TESTNET) as Transaction;
    expect(Buffer.from(signed.memo.value as Buffer).toString('hex')).toBe(run.pain001_sha256);
    expect(createHash('sha256').update(run.pain001).digest('hex')).toBe(run.pain001_sha256);
    expect(run.pain002).toContain('<TxSts>ACSC</TxSts>');
    const s = await one<{ status: string; camt054: string; uetr: string; token_amount: string }>(w.db, `SELECT status, camt054, uetr::text, token_amount::text FROM settlements WHERE id = $1`, [r.settlementId]);
    expect(s.status).toBe('paid');
    expect(s.camt054).toContain(s.uetr);
    expect(s.token_amount).toBe('10.29412');
    expect(await count(w.db, `SELECT 1 FROM audit_log WHERE action = 'pago'`)).toBe(1);
  });

  it.each([
    ['400 tx_failed', { kind: 'unknown', code: 'tx_failed' } as SubmitOutcome],
    ['400 tx_bad_seq', { kind: 'unknown', code: 'tx_bad_seq' } as SubmitOutcome],
    ['timeout', { kind: 'unknown', code: 'timeout' } as SubmitOutcome],
    ['504', { kind: 'unknown', code: 'http_504' } as SubmitOutcome],
  ])('%s queda sin confirmar y no deja reintentar', async (_label, outcome) => {
    const w = await world();
    w.chain.onSubmit = () => outcome;
    const r = await w.engine.createAndPay(payment());
    expect(r).toMatchObject({ status: 'unconfirmed', paymentState: 'unconfirmed', retryAllowed: false });
    expect((await one<{ pain002: string }>(w.db, `SELECT pain002 FROM payment_runs WHERE id = $1`, [r.runId])).pain002).toContain('<TxSts>PDNG</TxSts>');
    await expect(w.engine.retry(r.settlementId)).rejects.toMatchObject({ statusCode: 409 });
    expect(w.chain.submits).toHaveLength(1);
  });

  it('un éxito sin hora de cierre del ledger queda sin confirmar y el reconciliador lo cierra', async () => {
    const w = await world();
    w.chain.ledgerTimes = false;
    const r = await w.engine.createAndPay(payment());
    expect(r.status).toBe('unconfirmed');
    await w.engine.reconcileRun(r.runId);
    expect(await runStatus(w.db, r.runId)).toBe('settled');
    expect(await count(w.db, `SELECT 1 FROM audit_log WHERE action = 'pago'`)).toBe(1);
  });
});

describe('reconciliador: solo evidencia positiva', () => {
  async function unconfirmed() {
    const w = await world();
    let held: Transaction | null = null;
    w.chain.onSubmit = (tx) => { held = tx; return { kind: 'unknown', code: 'timeout' }; };
    const r = await w.engine.createAndPay(payment());
    return { ...w, r, held: () => held! };
  }

  it('encontrada y exitosa: pagado una sola vez, aunque se reconcilie dos veces a la par', async () => {
    const w = await unconfirmed();
    w.chain.include(w.held(), true);
    await Promise.all([w.engine.reconcileRun(w.r.runId), w.engine.reconcileRun(w.r.runId)]);
    expect(await runStatus(w.db, w.r.runId)).toBe('settled');
    expect(await count(w.db, `SELECT 1 FROM audit_log WHERE action = 'pago'`)).toBe(1);
    expect(await count(w.db, `SELECT 1 FROM settlements WHERE status = 'paid'`)).toBe(1);
  });

  it('encontrada y fallida: no se ejecutó, la liquidación vuelve a pendiente y el reintento paga', async () => {
    const w = await unconfirmed();
    w.chain.include(w.held(), false);
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('failed_onchain');
    const v = await w.engine.view(w.r.settlementId);
    expect(v).toMatchObject({ paymentState: 'failed', retryAllowed: true });
    expect((await one<{ pain002: string }>(w.db, `SELECT pain002 FROM payment_runs WHERE id = $1`, [w.r.runId])).pain002).toContain('paymentUnderfunded');
    w.chain.onSubmit = (tx) => w.chain.include(tx, true);
    const again = await w.engine.retry(w.r.settlementId);
    expect(again).toMatchObject({ status: 'settled', paymentState: 'paid' });
    expect(again.runId).not.toBe(w.r.runId);
  });

  it('un 404 después de maxTime pasa a revisión, nunca a no ejecutado', async () => {
    const w = await unconfirmed();
    w.chain.latestClosedAt = new Date(Date.now() + 400_000);
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('needs_review');
    expect(await w.engine.view(w.r.settlementId)).toMatchObject({ paymentState: 'needs_review', retryAllowed: false });
    await expect(w.engine.retry(w.r.settlementId)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('con la hora de cierre igual a maxTime sigue sin confirmar', async () => {
    const w = await unconfirmed();
    w.chain.latestClosedAt = new Date((await one<{ max_time: Date }>(w.db, `SELECT max_time FROM payment_runs WHERE id = $1`, [w.r.runId])).max_time);
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('unconfirmed');
  });

  it('un 404 antes de vencer y luego la transacción exitosa: pagado', async () => {
    const w = await unconfirmed();
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('unconfirmed');
    w.chain.include(w.held(), true);
    w.chain.latestClosedAt = new Date(Date.now() + 400_000);
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('settled');
  });

  it('en revisión y luego aparece exitosa: pagado', async () => {
    const w = await unconfirmed();
    w.chain.latestClosedAt = new Date(Date.now() + 400_000);
    await w.engine.reconcileRun(w.r.runId);
    w.chain.include(w.held(), true);
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('settled');
  });

  it('con Horizon caído no cambia nada', async () => {
    const w = await unconfirmed();
    w.chain.down = true;
    w.chain.latestClosedAt = new Date(Date.now() + 400_000);
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('unconfirmed');
  });

  it('con Horizon de otra red no cierra nada', async () => {
    const w = await unconfirmed();
    w.chain.include(w.held(), true);
    w.chain.network = Networks.PUBLIC;
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('unconfirmed');
  });

  it('un éxito que llega cuando el intento ya está cerrado no lo sobrescribe y deja la discrepancia', async () => {
    const w = await unconfirmed();
    w.chain.include(w.held(), false);
    await w.engine.reconcileRun(w.r.runId);
    const hash = (await one<{ tx_hash: string }>(w.db, `SELECT tx_hash FROM payment_runs WHERE id = $1`, [w.r.runId])).tx_hash;
    await w.engine.applySettled(w.r.runId, { hash, ledger: 5, closedAt: new Date(), networkPassphrase: Networks.TESTNET });
    expect(await runStatus(w.db, w.r.runId)).toBe('failed_onchain');
    expect(await count(w.db, `SELECT 1 FROM audit_log WHERE action = 'pago.discrepancia'`)).toBe(1);
  });

  it('dos finalizaciones a la par, sin candado: un solo comprobante, un abono y una auditoría', async () => {
    const w = await world();
    let held: Transaction | null = null;
    w.chain.onSubmit = (tx) => { held = tx; return { kind: 'unknown', code: 'timeout' }; };
    const calc = { unitPrice: '17.50', gross: '175.00', deductions: [], creditId: 1, creditRepayment: '43.75', net: '131.25' };
    const r = await w.engine.createAndPay(payment(1, { calc, preview: calc }));
    const hash = held!.hash().toString('hex');
    const ev = { hash, ledger: 7, closedAt: new Date(), networkPassphrase: Networks.TESTNET };
    await Promise.all([w.engine.applySettled(r.runId, ev), w.engine.applySettled(r.runId, ev)]);
    expect(await count(w.db, `SELECT 1 FROM credit_movements`)).toBe(1);
    expect(await count(w.db, `SELECT 1 FROM audit_log WHERE action = 'pago'`)).toBe(1);
    expect((await one<{ outstanding: string }>(w.db, `SELECT outstanding::text FROM credits WHERE id = 1`)).outstanding).toBe('956.25');
  });

  it('si falla a mitad de aplicar el éxito, nada queda escrito y el intento sigue bloqueado', async () => {
    const w = await world();
    let held: Transaction | null = null;
    w.chain.onSubmit = (tx) => { held = tx; return { kind: 'unknown', code: 'timeout' }; };
    const calc = { unitPrice: '17.50', gross: '175.00', deductions: [], creditId: 1, creditRepayment: '43.75', net: '131.25' };
    const r = await w.engine.createAndPay(payment(1, { calc, preview: calc }));
    // The repayment points at a credit that disappeared: the transaction must roll back whole.
    await w.db.query(`UPDATE payment_runs SET run_payload = jsonb_set(run_payload, '{transfers,0,credit,id}', '99') WHERE id = $1`, [r.runId]);
    w.chain.include(held!, true);
    await w.engine.reconcileRun(r.runId);
    expect(await runStatus(w.db, r.runId)).toBe('needs_review');
    expect(await count(w.db, `SELECT 1 FROM settlements WHERE status = 'paid' OR camt054 IS NOT NULL`)).toBe(0);
    expect(await count(w.db, `SELECT 1 FROM credit_movements`)).toBe(0);
    expect(await w.engine.view(r.settlementId)).toMatchObject({ retryAllowed: false });
  });

  it('si la liquidación ya no es del intento, el éxito no se aplica y pasa a revisión', async () => {
    const w = await unconfirmed();
    await w.db.query(`UPDATE settlements SET status = 'pending' WHERE id = $1`, [w.r.settlementId]);
    w.chain.include(w.held(), true);
    await w.engine.reconcileRun(w.r.runId);
    expect(await runStatus(w.db, w.r.runId)).toBe('needs_review');
    expect(await count(w.db, `SELECT 1 FROM settlements WHERE status = 'paid'`)).toBe(0);
  });

  it('el comprobante tardío refleja el intento original aunque cambien los datos del productor', async () => {
    const w = await unconfirmed();
    await w.db.query(`UPDATE producers SET name = 'Otro Nombre', account_id = 'PROD-9999' WHERE id = 1`);
    w.chain.include(w.held(), true);
    await w.engine.reconcileRun(w.r.runId);
    const camt = (await one<{ camt054: string }>(w.db, `SELECT camt054 FROM settlements WHERE id = $1`, [w.r.settlementId])).camt054;
    expect(camt).toContain('Productor 1');
    expect(camt).toContain('PROD-0001');
    expect(camt).not.toContain('Otro Nombre');
  });

  it('los documentos de un éxito tardío validan contra los XSD', async () => {
    const w = await unconfirmed();
    w.chain.include(w.held(), true);
    await w.engine.reconcileRun(w.r.runId);
    const run = await one<{ pain001: string; pain002: string }>(w.db, `SELECT pain001, pain002 FROM payment_runs WHERE id = $1`, [w.r.runId]);
    const s = await one<{ camt054: string }>(w.db, `SELECT camt054 FROM settlements WHERE id = $1`, [w.r.settlementId]);
    const xsdDir = new URL('../../../docs/xsd/', import.meta.url);
    for (const [xml, schema] of [[run.pain001, 'pain.001.001.09'], [run.pain002, 'pain.002.001.10'], [s.camt054, 'camt.054.001.08']] as const) {
      const r = await validateXML({ xml: { fileName: 'm.xml', contents: xml }, schema: { fileName: `${schema}.xsd`, contents: readFileSync(new URL(`${schema}.xsd`, xsdDir), 'utf8') } });
      expect(r.errors.map((e) => e.rawMessage)).toEqual([]);
    }
  });
});

describe('firma y caídas', () => {
  it('si la firma local falla, no se envía y se puede reintentar', async () => {
    const w = await world({ signer: () => ({ kind: 'local', sign: async () => { throw new Error('sin llave'); } }) });
    const r = await w.engine.createAndPay(payment());
    expect(r).toMatchObject({ status: 'not_executed', paymentState: 'not_executed', retryAllowed: true });
    expect(w.chain.submits).toHaveLength(0);
  });

  it('si el firmador devuelve otra transacción, no se envía', async () => {
    const w = await world({
      signer: (coop) => ({
        kind: 'local',
        sign: async (tx) => {
          const other = new TransactionBuilder(new Account(tx.source, '999'), { fee: '100', networkPassphrase: Networks.TESTNET })
            .addOperation(tx.operations[0] as never).setTimeout(30).build();
          other.sign(coop);
          return other;
        },
      }),
    });
    const r = await w.engine.createAndPay(payment());
    expect(r.status).toBe('not_executed');
    expect(w.chain.submits).toHaveLength(0);
  });

  it('con la firma de la app de MicoPay responde 503 y no crea nada', async () => {
    const w = await world({ signer: () => ({ kind: 'micopay', sign: async (tx) => tx }) });
    await expect(w.engine.createAndPay(payment())).rejects.toMatchObject({ statusCode: 503 });
    expect(await count(w.db, `SELECT 1 FROM payment_runs`)).toBe(0);
  });

  it('caída antes de firmar (en disco): al arrancar el intento se cierra como no ejecutado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cafe-'));
    dirs.push(dir);
    const first = await world({ dir, signer: () => ({ kind: 'local', sign: never }) });
    void first.engine.createAndPay(payment());
    await expect.poll(() => count(first.db, `SELECT 1 FROM payment_runs WHERE status = 'prepared'`)).toBe(1);
    await first.db.close();

    const second = await world({ dir });
    await second.engine.recover();
    expect(await count(second.db, `SELECT 1 FROM payment_runs WHERE status = 'not_executed'`)).toBe(1);
    expect(await count(second.db, `SELECT 1 FROM settlements WHERE status = 'pending'`)).toBe(1);
    expect(second.chain.submits).toHaveLength(0);
  });

  it('caída con el POST en curso (en disco): al arrancar se busca y, si salió, queda pagado una vez', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cafe-'));
    dirs.push(dir);
    const first = await world({ dir });
    let sent: Transaction | null = null;
    first.chain.onSubmit = (tx) => { sent = tx; return never(); };
    void first.engine.createAndPay(payment());
    await expect.poll(() => count(first.db, `SELECT 1 FROM payment_runs WHERE status = 'submitting'`)).toBe(1);
    await first.db.close();

    const chain = new FakeChain();
    chain.include(sent!, true);
    const second = await world({ dir, chain });
    await second.engine.recover();
    expect(await count(second.db, `SELECT 1 FROM payment_runs WHERE status = 'settled'`)).toBe(1);
    expect(await count(second.db, `SELECT 1 FROM audit_log WHERE action = 'pago'`)).toBe(1);
    expect(chain.submits).toHaveLength(0);
  });

  it('caída con el POST en curso que nunca aparece: al arrancar no se infiere nada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cafe-'));
    dirs.push(dir);
    const first = await world({ dir });
    first.chain.onSubmit = () => never();
    void first.engine.createAndPay(payment());
    await expect.poll(() => count(first.db, `SELECT 1 FROM payment_runs WHERE status = 'submitting'`)).toBe(1);
    await first.db.close();

    const second = await world({ dir });
    await second.engine.recover();
    expect(await count(second.db, `SELECT 1 FROM payment_runs WHERE status = 'unconfirmed'`)).toBe(1);
    second.chain.latestClosedAt = new Date(Date.now() + 400_000);
    await second.engine.tick();
    expect(await count(second.db, `SELECT 1 FROM payment_runs WHERE status = 'needs_review'`)).toBe(1);
  });
});

describe('referencia de la báscula y un pago abierto por productor', () => {
  it('dos POST a la par con la misma referencia: una entrega, un intento, la misma respuesta', async () => {
    const w = await world();
    const ref = randomUUID();
    const [a, b] = await Promise.all([
      w.engine.createAndPay(payment(1, { clientRef: ref, requestSha256: 'x'.repeat(64) })),
      w.engine.createAndPay(payment(1, { clientRef: ref, requestSha256: 'x'.repeat(64) })),
    ]);
    expect(a.settlementId).toBe(b.settlementId);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
    expect(await count(w.db, `SELECT 1 FROM deliveries`)).toBe(1);
    expect(w.chain.submits).toHaveLength(1);
  });

  it('la segunda petición con la referencia recibe la original aunque el primer intento siga abierto', async () => {
    const w = await world();
    const ref = randomUUID();
    w.chain.onSubmit = () => ({ kind: 'unknown', code: 'timeout' });
    const a = await w.engine.createAndPay(payment(1, { clientRef: ref, requestSha256: 'x'.repeat(64) }));
    const b = await w.engine.createAndPay(payment(1, { clientRef: ref, requestSha256: 'x'.repeat(64) }));
    expect(b).toMatchObject({ settlementId: a.settlementId, replayed: true, status: 'unconfirmed' });
  });

  it('la misma referencia con otros datos responde 409', async () => {
    const w = await world();
    const ref = randomUUID();
    await w.engine.createAndPay(payment(1, { clientRef: ref, requestSha256: 'x'.repeat(64) }));
    await expect(w.engine.createAndPay(payment(1, { clientRef: ref, requestSha256: 'y'.repeat(64) }))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('repetir después del éxito devuelve el pago guardado, sin pagar ni consultar Horizon', async () => {
    const w = await world();
    const ref = randomUUID();
    const a = await w.engine.createAndPay(payment(1, { clientRef: ref, requestSha256: 'x'.repeat(64) }));
    w.chain.down = true;
    const b = await w.engine.lookupRef(ref, 'x'.repeat(64));
    expect(b).toMatchObject({ settlementId: a.settlementId, status: 'settled', tokenAmount: a.tokenAmount, net: '175.00', replayed: true });
    expect(w.chain.submits).toHaveLength(1);
  });

  it('con un pago abierto, otra entrega del mismo productor recibe 409 y la de otro productor pasa', async () => {
    const w = await world();
    w.chain.onSubmit = () => ({ kind: 'unknown', code: 'timeout' });
    await w.engine.createAndPay(payment(1));
    await expect(w.engine.createAndPay(payment(1))).rejects.toMatchObject({ statusCode: 409 });
    await expect(w.engine.createAndPay(payment(1, { clientRef: randomUUID(), requestSha256: 'z'.repeat(64) }))).rejects.toMatchObject({ statusCode: 409 });
    w.chain.onSubmit = (tx) => w.chain.include(tx, true);
    expect((await w.engine.createAndPay(payment(2))).status).toBe('settled');
  });

  it('un reintento elegible espera si otra entrega del mismo productor está abierta', async () => {
    const w = await world();
    w.chain.onSubmit = (tx) => w.chain.include(tx, false);
    const failed = await w.engine.createAndPay(payment(1));
    await w.engine.reconcileRun(failed.runId);
    expect(await w.engine.view(failed.settlementId)).toMatchObject({ retryAllowed: true });
    w.chain.onSubmit = () => ({ kind: 'unknown', code: 'timeout' });
    await w.engine.createAndPay(payment(1));
    await expect(w.engine.retry(failed.settlementId)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('dos reintentos a la par: solo uno abre intento', async () => {
    const w = await world();
    w.chain.onSubmit = (tx) => w.chain.include(tx, false);
    const failed = await w.engine.createAndPay(payment(1));
    await w.engine.reconcileRun(failed.runId);
    w.chain.onSubmit = (tx) => w.chain.include(tx, true);
    const results = await Promise.allSettled([w.engine.retry(failed.settlementId), w.engine.retry(failed.settlementId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } });
    expect(await count(w.db, `SELECT 1 FROM payment_runs`)).toBe(2);
  });

  it('los folios no chocan y el pain.001 lleva el folio guardado', async () => {
    const w = await world();
    const a = await w.engine.createAndPay(payment(1));
    const b = await w.engine.createAndPay(payment(2));
    expect(a.reference).not.toBe(b.reference);
    const pain = (await one<{ pain001: string }>(w.db, `SELECT pain001 FROM payment_runs WHERE id = $1`, [b.runId])).pain001;
    expect(pain).toContain(b.reference);
  });
});

describe('abonos y choques de secuencia', () => {
  it('el abono se aplica una vez con el importe congelado y balance_after del mismo UPDATE', async () => {
    const w = await world();
    const calc = { unitPrice: '17.50', gross: '175.00', deductions: [], creditId: 1, creditRepayment: '43.75', net: '131.25' };
    const r = await w.engine.createAndPay(payment(1, { calc, preview: calc }));
    expect(r.status).toBe('settled');
    await w.engine.reconcileRun(r.runId);
    const mv = await w.db.query<{ amount: string; balance_after: string; token_amount: string }>(
      `SELECT amount::text, balance_after::text, token_amount::text FROM credit_movements WHERE credit_id = 1`);
    expect(mv.rows).toEqual([{ amount: '43.75', balance_after: '956.25', token_amount: '2.57353' }]);
  });

  it('un tx_bad_seq de un segundo pago tras un timeout tampoco libera ningún reintento', async () => {
    const w = await world();
    w.chain.onSubmit = () => ({ kind: 'unknown', code: 'timeout' });
    const first = await w.engine.createAndPay(payment(1));
    w.chain.onSubmit = () => ({ kind: 'unknown', code: 'tx_bad_seq' });
    const second = await w.engine.createAndPay(payment(2));
    w.chain.latestClosedAt = new Date(Date.now() + 400_000);
    await w.engine.tick();
    for (const r of [first, second]) {
      expect(await w.engine.view(r.settlementId)).toMatchObject({ paymentState: 'needs_review', retryAllowed: false });
    }
  });
});
