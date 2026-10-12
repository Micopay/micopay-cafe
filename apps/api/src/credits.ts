import Big from 'big.js';
import { createHash } from 'node:crypto';
import type { Asset } from '@stellar/stellar-sdk';
import { audit, type Db } from './db.js';
import { toToken, usdcMxnRate } from './fx.js';
import { buildPaymentTransaction, submit, type Signer } from './stellar.js';

/* ── Pure terms math ───────────────────────────────────────────────────── */

export interface TermsInput {
  principal: string;
  annualRate: string;
  termMonths: number;
}

/** Simple interest fixed at origination: principal × rate × months / 12, rounded once to cents. */
export function computeTerms(t: TermsInput): { interest: string; totalDue: string } {
  const principal = new Big(t.principal);
  if (principal.lte(0)) throw new Error('el monto debe ser mayor que cero');
  if (new Big(t.annualRate).lt(0)) throw new Error('la tasa no puede ser negativa');
  if (!Number.isInteger(t.termMonths) || t.termMonths < 1 || t.termMonths > 60) throw new Error('el plazo debe ser de 1 a 60 meses');
  const interest = principal.times(t.annualRate).div(100).times(t.termMonths).div(12).round(2, Big.roundHalfUp);
  return { interest: interest.toFixed(2), totalDue: principal.plus(interest).toFixed(2) };
}

/** Deterministic JSON (sorted keys) so anyone can recompute the hash anchored on Stellar. */
export function canonicalTerms(terms: Record<string, string | number>): { json: string; sha256: string } {
  const json = JSON.stringify(Object.fromEntries(Object.entries(terms).sort(([a], [b]) => a.localeCompare(b))));
  return { json, sha256: createHash('sha256').update(json).digest('hex') };
}

/** "vencido" is not stored: it is a vigente credit past its due date that still owes money. */
export const STATUS_SQL = `CASE WHEN c.status = 'vigente' AND c.due_date < CURRENT_DATE AND c.outstanding > 0 THEN 'vencido' ELSE c.status END`;

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

export interface NewCredit {
  producerId: number;
  lenderId: number;
  purpose: string;
  principal: string;
  annualRate: string;
  termMonths: number;
  repaymentPercent: string;
  dueDate: string; // YYYY-MM-DD
}

export async function createCredit(db: Db, c: NewCredit): Promise<{ id: number; reference: string }> {
  const { interest, totalDue } = computeTerms(c);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate) || new Date(c.dueDate) <= new Date()) throw new Error('la fecha de vencimiento debe ser futura');
  const rp = new Big(c.repaymentPercent);
  if (rp.lte(0) || rp.gt(100)) throw new Error('el abono por entrega debe ser entre 1% y 100%');

  const parties = (await db.query<{ producer: string; producer_address: string; lender: string; lender_address: string }>(
    `SELECT p.name AS producer, p.stellar_address AS producer_address, l.name AS lender, l.stellar_address AS lender_address
       FROM producers p, lenders l WHERE p.id = $1 AND l.id = $2 AND p.is_active`,
    [c.producerId, c.lenderId],
  )).rows[0];
  if (!parties) throw new Error('productor o prestamista no válido');

  const n = (await db.query<{ n: number }>(`SELECT COUNT(*)::int + 1 AS n FROM credits`)).rows[0]!.n;
  const reference = `CR-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
  const terms = canonicalTerms({
    reference, currency: 'MXN', purpose: c.purpose,
    borrower: parties.producer_address, lender: parties.lender_address,
    principal: new Big(c.principal).toFixed(2), annual_rate: new Big(c.annualRate).toFixed(2), term_months: c.termMonths,
    interest, total_due: totalDue, repayment_percent: rp.toFixed(2), due_date: c.dueDate,
  });

  const row = (await db.query<{ id: number }>(
    `INSERT INTO credits (reference, producer_id, lender_id, purpose, principal, annual_rate, term_months, interest, total_due,
                          outstanding, repayment_percent, due_date, terms_json, terms_sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13) RETURNING id`,
    [reference, c.producerId, c.lenderId, c.purpose, c.principal, c.annualRate, c.termMonths, interest, totalDue,
      c.repaymentPercent, c.dueDate, terms.json, terms.sha256],
  )).rows[0]!;
  await audit(db, 'credito.alta', { reference, producer: parties.producer, lender: parties.lender, principal: c.principal, totalDue });
  return { id: row.id, reference };
}

/**
 * Disbursement: the lender pays the producer on Stellar. The memo is the
 * SHA-256 of the canonical terms, so the contract the producer accepted is
 * anchored next to the money it describes.
 */
export async function disburseCredit(db: Db, id: number, deps: { asset: Asset; signerFor: (lenderAddress: string) => Signer | null }) {
  const c = (await db.query<{ reference: string; status: string; principal: string; total_due: string; terms_sha256: string; producer_address: string; lender_address: string }>(
    `SELECT c.reference, c.status, c.principal::text, c.total_due::text, c.terms_sha256, p.stellar_address AS producer_address, l.stellar_address AS lender_address
       FROM credits c JOIN producers p ON p.id = c.producer_id JOIN lenders l ON l.id = c.lender_id WHERE c.id = $1`, [id],
  )).rows[0];
  if (!c) throw new Error('el crédito no existe');
  if (c.status !== 'pendiente') throw new Error(`solo se desembolsa un crédito pendiente (está ${c.status})`);
  const signer = deps.signerFor(c.lender_address);
  if (!signer) throw new Error('este prestamista no tiene firmante configurado en la demo; firmaría desde su app de MicoPay');

  // The loan is in MXN; the lender sends its USDC equivalent at today's rate.
  const { rate } = await usdcMxnRate();
  const tokenAmount = toToken(c.principal, rate);
  const tx = await buildPaymentTransaction({
    source: c.lender_address, asset: deps.asset, memoSha256: c.terms_sha256,
    payments: [{ destination: c.producer_address, amount: tokenAmount }],
  });
  const result = await submit(await signer.sign(tx));
  if (!result.successful) throw new Error(`Stellar rechazó el desembolso (${result.code})`);

  await db.query(`UPDATE credits SET status = 'vigente', disbursement_tx = $1, disbursed_at = NOW() WHERE id = $2`, [result.hash, id]);
  await db.query(`INSERT INTO credit_movements (credit_id, kind, amount, balance_after, tx_hash, token_amount, fx_rate) VALUES ($1, 'desembolso', $2, $3, $4, $5, $6)`,
    [id, c.principal, c.total_due, result.hash, tokenAmount, rate]);
  await audit(db, 'credito.desembolso', { reference: c.reference, amount: c.principal, tx: result.hash });
  return { txHash: result.hash, tokenAmount, rate };
}

export async function cancelCredit(db: Db, id: number): Promise<void> {
  const r = await db.query<{ reference: string }>(`UPDATE credits SET status = 'cancelado' WHERE id = $1 AND status = 'pendiente' RETURNING reference`, [id]);
  if (r.rows.length === 0) throw new Error('solo se cancela un crédito que no se ha desembolsado');
  await audit(db, 'credito.cancelado', { reference: r.rows[0]!.reference });
}

export async function updateCredit(db: Db, id: number, patch: { autoDeduct?: boolean; repaymentPercent?: string }): Promise<void> {
  if (patch.repaymentPercent !== undefined) {
    const rp = new Big(patch.repaymentPercent);
    if (rp.lte(0) || rp.gt(100)) throw new Error('el abono por entrega debe ser entre 1% y 100%');
  }
  const r = await db.query<{ reference: string }>(
    `UPDATE credits SET auto_deduct = COALESCE($2, auto_deduct), repayment_percent = COALESCE($3, repayment_percent)
      WHERE id = $1 AND status IN ('pendiente', 'vigente') RETURNING reference`,
    [id, patch.autoDeduct ?? null, patch.repaymentPercent ?? null],
  );
  if (r.rows.length === 0) throw new Error('solo se ajusta un crédito pendiente o vigente');
  await audit(db, 'credito.ajuste', { reference: r.rows[0]!.reference, ...patch });
}
