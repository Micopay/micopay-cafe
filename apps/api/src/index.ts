import cors from '@fastify/cors';
import { Keypair } from '@stellar/stellar-sdk';
import Big from 'big.js';
import Fastify, { type FastifyReply } from 'fastify';
import { loadKeys, PG_DIR, settlementAsset, TOKEN_CCY } from './config.js';
import { cancelCredit, createCredit, disburseCredit, STATUS_SQL, updateCredit, type NewCredit } from './credits.js';
import { audit, openDb } from './db.js';
import { toMxn, usdcMxnRate } from './fx.js';
import { createTestnetAccount } from './testnet.js';
import { executeRun } from './runs.js';
import { settle, type DeductionRule } from './settlement.js';
import { buildStatement } from './statement.js';
import { accountStatus, assetBalance, explorerTx, isStellarAddress, LocalSigner, MicopaySigner, type Signer } from './stellar.js';

const keys = loadKeys();
const asset = settlementAsset(keys);
const NETWORK = 'TESTNET' as const;
/** Mexico City has no DST since 2022: business days are UTC-6. */
const TZ_OFFSET = '-06:00';
const db = await openDb(PG_DIR);

// MICOPAY_API + MICOPAY_DEVICE_KEY + MICOPAY_IDENTIFIER switch signing to the MicoPay app.
const coopSigner: Signer = process.env.MICOPAY_DEVICE_KEY && process.env.MICOPAY_API && process.env.MICOPAY_IDENTIFIER
  ? new MicopaySigner({ apiUrl: process.env.MICOPAY_API, deviceKey: process.env.MICOPAY_DEVICE_KEY, identifier: process.env.MICOPAY_IDENTIFIER })
  : new LocalSigner(Keypair.fromSecret(keys.cooperative));

/** Demo lenders sign with testnet keys held locally; any other lender would sign from its MicoPay app. */
const lenderKeys = new Map([keys.lender, ...(keys.extraLenders ?? [])].map((s) => [Keypair.fromSecret(s).publicKey(), Keypair.fromSecret(s)]));
const lenderSigner = (address: string): Signer | null => {
  const kp = lenderKeys.get(address);
  return kp ? new LocalSigner(kp) : null;
};

const app = Fastify({ logger: { level: 'warn' } });
await app.register(cors, { origin: true });
app.setErrorHandler((err, _req, reply) => {
  reply.status(err.statusCode && err.statusCode < 500 ? err.statusCode : 400).send({ error: err.message });
});

/* ── helpers ───────────────────────────────────────────────────────────── */

function xml(reply: FastifyReply, body: string | null | undefined, filename: string) {
  if (!body) return reply.status(404).send({ error: 'documento no disponible' });
  return reply.header('content-type', 'application/xml; charset=utf-8').header('content-disposition', `inline; filename="${filename}"`).send(body);
}

function csv(reply: FastifyReply, rows: Array<Record<string, unknown>>, filename: string) {
  const headers = rows.length ? Object.keys(rows[0]!) : [];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens accents correctly.
  const body = '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\n');
  return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${filename}"`).send(body);
}

const dayStart = (d: string) => new Date(`${d}T00:00:00${TZ_OFFSET}`);
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999${TZ_OFFSET}`);
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const MONEY = { type: 'string', pattern: '^\\d+(\\.\\d{1,2})?$' };

async function currentPrice(productId: number): Promise<string> {
  const row = (await db.query<{ p: string }>(
    `SELECT price_per_unit::text AS p FROM prices WHERE product_id = $1 AND cooperative_id = 1 AND valid_from <= NOW() ORDER BY valid_from DESC, id DESC LIMIT 1`,
    [productId],
  )).rows[0];
  if (!row) throw new Error('el producto no tiene precio del día; configúralo en Administración');
  return row.p;
}

async function settlementInputs(producerId: number, productId: number, unitPrice?: string) {
  const dailyPrice = await currentPrice(productId);
  const rules = (await db.query<DeductionRule>(
    `SELECT attribute, above::text, percent::text, reason, label FROM deduction_rules WHERE product_id = $1`, [productId],
  )).rows;
  // Only disbursed credits with automatic deduction on; the oldest due date is repaid first.
  // Repayment is computed against what is still owed after other unpaid settlements.
  const credit = (await db.query<{ id: number; reference: string; outstanding: string; repaymentPercent: string }>(
    `SELECT c.id, c.reference, (c.outstanding - COALESCE((SELECT SUM(s.credit_repayment) FROM settlements s
            WHERE s.credit_id = c.id AND s.status IN ('pending', 'in_run')), 0))::text AS outstanding,
            c.repayment_percent::text AS "repaymentPercent"
       FROM credits c WHERE c.producer_id = $1 AND c.status = 'vigente' AND c.auto_deduct AND c.outstanding > 0
      ORDER BY c.due_date, c.id LIMIT 1`, [producerId],
  )).rows[0];
  return { unitPrice: unitPrice ?? dailyPrice, dailyPrice, rules, credit: credit ?? null };
}

/* ── cooperative header ────────────────────────────────────────────────── */

app.get('/api/summary', async () => {
  const coop = (await db.query<{ name: string; stellar_address: string }>(`SELECT name, stellar_address FROM cooperatives WHERE id = 1`)).rows[0]!;
  const balance = await assetBalance(coop.stellar_address, asset);
  const fx = await usdcMxnRate().catch(() => null);
  return {
    cooperative: coop, balance, balanceMxn: balance && fx ? toMxn(balance, fx.rate) : null, fx,
    asset: { code: asset.getCode(), issuer: asset.getIssuer() }, network: NETWORK, signer: coopSigner.kind,
  };
});

/* ── products and daily price ──────────────────────────────────────────── */

app.get('/api/products', async () => (await db.query(`
  SELECT pr.id, pr.name, pr.unit, pr.quality_schema,
         (SELECT price_per_unit::text FROM prices WHERE product_id = pr.id AND valid_from <= NOW() ORDER BY valid_from DESC, id DESC LIMIT 1) AS price,
         (SELECT valid_from FROM prices WHERE product_id = pr.id AND valid_from <= NOW() ORDER BY valid_from DESC, id DESC LIMIT 1) AS price_since,
         (SELECT json_agg(json_build_object('attribute', attribute, 'above', above::text, 'percent', percent::text, 'label', label) ORDER BY attribute, above)
            FROM deduction_rules WHERE product_id = pr.id) AS rules
    FROM products pr ORDER BY pr.id`)).rows);

app.get<{ Querystring: { productId?: string } }>('/api/prices', async (req) => (await db.query(`
  SELECT pr.id, p.name AS product, p.unit, pr.price_per_unit::text AS price, pr.valid_from
    FROM prices pr JOIN products p ON p.id = pr.product_id
   WHERE ($1::int IS NULL OR pr.product_id = $1) ORDER BY pr.valid_from DESC, pr.id DESC LIMIT 60`,
  [req.query.productId ? Number(req.query.productId) : null])).rows);

app.post<{ Body: { productId: number; price: string } }>('/api/prices', {
  schema: { body: { type: 'object', required: ['productId', 'price'], properties: { productId: { type: 'integer' }, price: MONEY }, additionalProperties: false } },
}, async (req) => {
  if (new Big(req.body.price).lte(0)) throw new Error('el precio debe ser mayor que cero');
  const product = (await db.query<{ name: string }>(`SELECT name FROM products WHERE id = $1`, [req.body.productId])).rows[0];
  if (!product) throw new Error('el producto no existe');
  await db.query(`INSERT INTO prices (product_id, cooperative_id, price_per_unit) VALUES ($1, 1, $2)`, [req.body.productId, req.body.price]);
  await audit(db, 'precio.del_dia', { product: product.name, price: req.body.price });
  return { ok: true };
});

/* ── producers ─────────────────────────────────────────────────────────── */

app.get<{ Querystring: { q?: string } }>('/api/producers', async (req) => (await db.query(`
  SELECT p.id, p.name, p.community, p.contact, p.account_id, p.stellar_address, p.is_active, p.created_at,
         COALESCE((SELECT SUM(d.quantity) FROM deliveries d JOIN settlements s ON s.delivery_id = d.id WHERE d.producer_id = p.id AND s.status = 'paid'), 0)::text AS delivered,
         COALESCE((SELECT SUM(s.net) FROM settlements s JOIN deliveries d ON d.id = s.delivery_id WHERE d.producer_id = p.id AND s.status = 'paid'), 0)::text AS paid,
         (SELECT COALESCE(SUM(c.outstanding), 0)::text FROM credits c WHERE c.producer_id = p.id AND c.status = 'vigente') AS credit_outstanding
    FROM producers p
   WHERE ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%' OR p.community ILIKE '%' || $1 || '%')
   ORDER BY p.name`, [req.query.q?.trim() || null])).rows);

app.get<{ Params: { id: string } }>('/api/producers/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const p = (await db.query<{ stellar_address: string }>(`SELECT * FROM producers WHERE id = $1`, [id])).rows[0];
  if (!p) return reply.status(404).send({ error: 'no existe' });
  const stats = (await db.query(`
    SELECT COUNT(*)::int AS deliveries, COALESCE(SUM(d.quantity), 0)::text AS quantity, COALESCE(SUM(s.net), 0)::text AS paid,
           COALESCE(SUM(s.credit_repayment), 0)::text AS repaid, MAX(r.settled_at) AS last_payment
      FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN payment_runs r ON r.id = s.run_id
     WHERE d.producer_id = $1 AND s.status = 'paid'`, [id])).rows[0];
  const history = (await db.query(`
    SELECT s.id, d.reference, d.created_at, pr.name AS product, pr.unit, d.quantity::text, s.unit_price::text, s.gross::text,
           s.credit_repayment::text, s.net::text, s.status, r.tx_hash
      FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN products pr ON pr.id = d.product_id LEFT JOIN payment_runs r ON r.id = s.run_id
     WHERE d.producer_id = $1 ORDER BY d.created_at DESC LIMIT 20`, [id])).rows;
  const credits = (await db.query(`
    SELECT c.id, c.reference, c.purpose, c.total_due::text, c.outstanding::text, c.due_date, ${STATUS_SQL} AS status
      FROM credits c WHERE c.producer_id = $1 ORDER BY c.created_at DESC`, [id])).rows;
  return { ...p, stats, history, credits, account: await accountStatus(p.stellar_address, asset) };
});

app.post<{ Body: { name: string; community?: string; contact?: string; stellarAddress: string } }>('/api/producers', {
  schema: { body: { type: 'object', required: ['name', 'stellarAddress'], additionalProperties: false, properties: {
    name: { type: 'string', minLength: 3, maxLength: 140 }, community: { type: 'string', maxLength: 140 },
    contact: { type: 'string', maxLength: 140 }, stellarAddress: { type: 'string' } } } },
}, async (req) => {
  const { name, community, contact, stellarAddress } = req.body;
  if (!isStellarAddress(stellarAddress)) throw new Error('la dirección de Stellar no es válida (empieza con G y mide 56 caracteres)');
  const n = (await db.query<{ n: number }>(`SELECT COUNT(*)::int + 1 AS n FROM producers`)).rows[0]!.n;
  const accountId = `PROD-${String(n).padStart(4, '0')}`;
  const row = (await db.query<{ id: number }>(
    `INSERT INTO producers (cooperative_id, name, community, contact, account_id, stellar_address) VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT (stellar_address) DO NOTHING RETURNING id`,
    [name.trim(), community?.trim() || null, contact?.trim() || null, accountId, stellarAddress],
  )).rows[0];
  if (!row) throw new Error('ya hay un productor con esa dirección de Stellar');
  await audit(db, 'productor.alta', { name, accountId });
  return { id: row.id, accountId, account: await accountStatus(stellarAddress, asset) };
});

app.patch<{ Params: { id: string }; Body: { isActive?: boolean; contact?: string; community?: string } }>('/api/producers/:id', async (req) => {
  await db.query(`UPDATE producers SET is_active = COALESCE($2, is_active), contact = COALESCE($3, contact), community = COALESCE($4, community) WHERE id = $1`,
    [Number(req.params.id), req.body.isActive ?? null, req.body.contact ?? null, req.body.community ?? null]);
  await audit(db, 'productor.edicion', { id: Number(req.params.id), ...req.body });
  return { ok: true };
});

/** Demo helper: a fresh testnet account with the MXNe trustline, as the MicoPay app would create. */
app.post('/api/testnet/account', async () => createTestnetAccount(asset));

/* ── pay at the scale ──────────────────────────────────────────────────── */

interface PaymentBody { producerId: number; productId: number; quantity: string; quality?: Record<string, number>; unitPrice?: string; lot?: string; notes?: string }
const paymentSchema = { body: { type: 'object', required: ['producerId', 'productId', 'quantity'], additionalProperties: false, properties: {
  producerId: { type: 'integer' }, productId: { type: 'integer' }, quantity: MONEY,
  quality: { type: 'object', additionalProperties: { type: 'number' } }, unitPrice: MONEY,
  lot: { type: 'string', maxLength: 35 }, notes: { type: 'string', maxLength: 500 } } } };

app.post<{ Body: PaymentBody }>('/api/payments/preview', { schema: paymentSchema }, async (req) => {
  const inputs = await settlementInputs(req.body.producerId, req.body.productId, req.body.unitPrice);
  return { unitPrice: inputs.unitPrice, dailyPrice: inputs.dailyPrice, credit: inputs.credit,
    ...settle({ ...inputs, quantity: req.body.quantity, quality: req.body.quality ?? {} }) };
});

/** Records the delivery and pays it immediately, like the original app: weigh, confirm, pay. */
app.post<{ Body: PaymentBody }>('/api/payments', { schema: paymentSchema }, async (req) => {
  const { producerId, productId, quantity, quality = {}, unitPrice, lot, notes } = req.body;
  const producer = (await db.query<{ is_active: boolean; stellar_address: string }>(`SELECT is_active, stellar_address FROM producers WHERE id = $1`, [producerId])).rows[0];
  if (!producer?.is_active) throw new Error('el productor no existe o está inactivo');
  const status = await accountStatus(producer.stellar_address, asset);
  if (status !== 'ok') throw new Error(status === 'sin_cuenta' ? 'la cuenta de Stellar del productor no existe todavía' : `el productor aún no activa ${asset.getCode()} en su cuenta`);

  const inputs = await settlementInputs(producerId, productId, unitPrice);
  const result = settle({ ...inputs, quantity, quality });
  const n = (await db.query<{ n: number }>(`SELECT COUNT(*)::int + 1 AS n FROM deliveries`)).rows[0]!.n;
  const reference = `ENT-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`;
  const delivery = (await db.query<{ id: number }>(
    `INSERT INTO deliveries (reference, producer_id, product_id, quantity, quality, lot, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [reference, producerId, productId, quantity, JSON.stringify(quality), lot || null, notes || null],
  )).rows[0]!;
  const s = (await db.query<{ id: number }>(
    `INSERT INTO settlements (delivery_id, unit_price, gross, deductions, credit_id, credit_repayment, net) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [delivery.id, inputs.unitPrice, result.gross, JSON.stringify(result.deductions), result.creditId, result.creditRepayment, result.net],
  )).rows[0]!;
  if (unitPrice && unitPrice !== inputs.dailyPrice) await audit(db, 'precio.modificado_en_pago', { reference, dailyPrice: inputs.dailyPrice, used: unitPrice });

  const outcome = await executeRun(db, { settlementIds: [s.id], signer: coopSigner, asset, network: NETWORK });
  const paid = (await db.query<{ token_amount: string | null }>(`SELECT token_amount::text FROM settlements WHERE id = $1`, [s.id])).rows[0];
  return { ...outcome, settlementId: s.id, reference, ...result, tokenAmount: paid?.token_amount ?? null, asset: asset.getCode(), explorer: explorerTx(outcome.txHash) };
});

/** Retry a payment whose transaction the ledger rejected (the settlement stays pending). */
app.post<{ Params: { id: string } }>('/api/payments/:id/retry', async (req) => {
  const outcome = await executeRun(db, { settlementIds: [Number(req.params.id)], signer: coopSigner, asset, network: NETWORK });
  return { ...outcome, explorer: explorerTx(outcome.txHash) };
});

const PAYMENT_SELECT = `
  SELECT s.id, s.status, d.reference, d.lot, d.notes, d.quantity::text, d.quality, d.created_at, pr.name AS product, pr.unit,
         s.unit_price::text, s.gross::text, s.deductions, s.credit_repayment::text, s.net::text,
         c.reference AS credit_ref, c.outstanding::text AS credit_outstanding,
         p.id AS producer_id, p.name AS producer, p.community, p.stellar_address,
         s.run_id, r.msg_id, s.end_to_end_id, s.uetr::text, r.tx_hash, r.settled_at, r.pain001_sha256, r.result_code,
         s.token_amount::text, r.fx_rate::text
    FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN products pr ON pr.id = d.product_id
    JOIN producers p ON p.id = d.producer_id LEFT JOIN credits c ON c.id = s.credit_id LEFT JOIN payment_runs r ON r.id = s.run_id`;

interface PaymentFilters { from?: string; to?: string; status?: string; producerId?: string }
function paymentWhere(q: PaymentFilters): [string, unknown[]] {
  return [`WHERE ($1::timestamptz IS NULL OR d.created_at >= $1) AND ($2::timestamptz IS NULL OR d.created_at <= $2)
             AND ($3::text IS NULL OR s.status = $3) AND ($4::int IS NULL OR p.id = $4)`,
    [q.from ? dayStart(q.from) : null, q.to ? dayEnd(q.to) : null, q.status || null, q.producerId ? Number(q.producerId) : null]];
}

app.get<{ Querystring: PaymentFilters & { limit?: string; offset?: string } }>('/api/payments', async (req) => {
  const [where, params] = paymentWhere(req.query);
  return (await db.query(`${PAYMENT_SELECT} ${where} ORDER BY d.created_at DESC LIMIT $5 OFFSET $6`,
    [...params, Math.min(Number(req.query.limit ?? 50), 200), Number(req.query.offset ?? 0)])).rows;
});

app.get<{ Querystring: PaymentFilters }>('/api/payments.csv', async (req, reply) => {
  const [where, params] = paymentWhere(req.query);
  const rows = (await db.query<Record<string, unknown>>(`
    SELECT d.created_at AS fecha, d.reference AS entrega, p.name AS productor, pr.name AS producto, d.quantity AS cantidad, pr.unit AS unidad,
           s.unit_price AS precio, s.gross AS bruto, (SELECT COALESCE(SUM((x->>'amount')::numeric), 0) FROM jsonb_array_elements(s.deductions) x) AS castigos,
           s.credit_repayment AS abono_credito, c.reference AS credito, s.net AS pagado, s.status AS estado, s.end_to_end_id, s.uetr, r.tx_hash
      FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN products pr ON pr.id = d.product_id
      JOIN producers p ON p.id = d.producer_id LEFT JOIN credits c ON c.id = s.credit_id LEFT JOIN payment_runs r ON r.id = s.run_id
      ${where} ORDER BY d.created_at DESC`, params)).rows;
  return csv(reply, rows, 'pagos.csv');
});

app.get<{ Params: { id: string } }>('/api/payments/:id', async (req, reply) => {
  const row = (await db.query<{ tx_hash: string | null }>(`${PAYMENT_SELECT} WHERE s.id = $1`, [Number(req.params.id)])).rows[0];
  if (!row) return reply.status(404).send({ error: 'no existe' });
  return { ...row, explorer: row.tx_hash ? explorerTx(row.tx_hash) : null };
});

app.get<{ Params: { id: string } }>('/api/payments/:id/camt054', async (req, reply) => {
  const row = (await db.query<{ camt054: string | null }>(`SELECT camt054 FROM settlements WHERE id = $1`, [Number(req.params.id)])).rows[0];
  return xml(reply, row?.camt054, `camt054-${req.params.id}.xml`);
});

app.get<{ Params: { id: string; doc: string } }>('/api/runs/:id/:doc', async (req, reply) => {
  if (!['pain001', 'pain002'].includes(req.params.doc)) return reply.status(404).send({ error: 'documento desconocido' });
  const row = (await db.query<Record<string, string | null>>(`SELECT pain001, pain002 FROM payment_runs WHERE id = $1`, [Number(req.params.id)])).rows[0];
  return xml(reply, row?.[req.params.doc], `${req.params.doc}-${req.params.id}.xml`);
});

/* ── lenders ───────────────────────────────────────────────────────────── */

app.get('/api/lenders', async () => {
  const rows = (await db.query<{ stellar_address: string }>(`
    SELECT l.id, l.name, l.kind, l.account_id, l.stellar_address, l.created_at,
           COUNT(c.id) FILTER (WHERE c.status = 'vigente')::int AS active_credits,
           COALESCE(SUM(c.outstanding) FILTER (WHERE c.status = 'vigente'), 0)::text AS portfolio
      FROM lenders l LEFT JOIN credits c ON c.lender_id = l.id GROUP BY l.id ORDER BY l.id`)).rows;
  const fx = await usdcMxnRate().catch(() => null);
  return Promise.all(rows.map(async (l) => {
    const balance = await assetBalance(l.stellar_address, asset);
    return { ...l, balance, balanceMxn: balance && fx ? toMxn(balance, fx.rate) : null, canSign: lenderKeys.has(l.stellar_address) };
  }));
});

app.post<{ Body: { name: string; kind?: string; stellarAddress: string } }>('/api/lenders', {
  schema: { body: { type: 'object', required: ['name', 'stellarAddress'], additionalProperties: false, properties: {
    name: { type: 'string', minLength: 3, maxLength: 140 }, kind: { type: 'string', maxLength: 40 }, stellarAddress: { type: 'string' } } } },
}, async (req) => {
  if (!isStellarAddress(req.body.stellarAddress)) throw new Error('la dirección de Stellar no es válida');
  const n = (await db.query<{ n: number }>(`SELECT COUNT(*)::int + 1 AS n FROM lenders`)).rows[0]!.n;
  const row = (await db.query<{ id: number }>(
    `INSERT INTO lenders (name, kind, account_id, stellar_address) VALUES ($1, $2, $3, $4) ON CONFLICT (stellar_address) DO NOTHING RETURNING id`,
    [req.body.name.trim(), req.body.kind?.trim() || 'IFNB', `LEND-${String(n).padStart(4, '0')}`, req.body.stellarAddress],
  )).rows[0];
  if (!row) throw new Error('ya hay un prestamista con esa dirección');
  await audit(db, 'prestamista.alta', { name: req.body.name });
  return { id: row.id };
});

/* ── credits ───────────────────────────────────────────────────────────── */

const CREDIT_SELECT = `
  SELECT c.id, c.reference, c.purpose, c.principal::text, c.annual_rate::text, c.term_months, c.interest::text, c.total_due::text,
         c.outstanding::text, c.repayment_percent::text, c.auto_deduct, c.due_date, ${STATUS_SQL} AS status, c.terms_sha256,
         c.disbursement_tx, c.disbursed_at, c.created_at, p.id AS producer_id, p.name AS producer, l.id AS lender_id, l.name AS lender,
         (c.total_due - c.outstanding)::text AS repaid
    FROM credits c JOIN producers p ON p.id = c.producer_id JOIN lenders l ON l.id = c.lender_id`;

app.get<{ Querystring: { status?: string } }>('/api/credits', async (req) =>
  (await db.query(`SELECT * FROM (${CREDIT_SELECT}) x WHERE ($1::text IS NULL OR x.status = $1) ORDER BY x.created_at DESC`, [req.query.status || null])).rows);

app.get('/api/credits.csv', async (_req, reply) => {
  const rows = (await db.query<Record<string, unknown>>(`
    SELECT reference AS credito, producer AS productor, lender AS prestamista, purpose AS destino, principal AS capital, annual_rate AS tasa_anual,
           term_months AS plazo_meses, interest AS interes, total_due AS total, repaid AS pagado, outstanding AS saldo, status AS estado,
           due_date AS vencimiento, disbursement_tx AS tx_desembolso, terms_sha256 AS huella_terminos
      FROM (${CREDIT_SELECT}) x ORDER BY created_at`)).rows;
  return csv(reply, rows, 'cartera.csv');
});

app.get<{ Params: { id: string } }>('/api/credits/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const c = (await db.query(`${CREDIT_SELECT} WHERE c.id = $1`, [id])).rows[0];
  if (!c) return reply.status(404).send({ error: 'no existe' });
  const movements = (await db.query<{ tx_hash: string | null }>(`
    SELECT m.id, m.kind, m.amount::text, m.balance_after::text, m.tx_hash, m.created_at, d.reference AS delivery, m.settlement_id,
           m.token_amount::text, m.fx_rate::text
      FROM credit_movements m LEFT JOIN settlements s ON s.id = m.settlement_id LEFT JOIN deliveries d ON d.id = s.delivery_id
     WHERE m.credit_id = $1 ORDER BY m.created_at, m.id`, [id])).rows.map((m) => ({ ...m, explorer: m.tx_hash ? explorerTx(m.tx_hash) : null }));
  return { ...c, movements };
});

/** The exact text whose SHA-256 is the disbursement memo, so anyone can verify it. */
app.get<{ Params: { id: string } }>('/api/credits/:id/terms', async (req, reply) => {
  const row = (await db.query<{ terms_json: string }>(`SELECT terms_json FROM credits WHERE id = $1`, [Number(req.params.id)])).rows[0];
  if (!row) return reply.status(404).send({ error: 'no existe' });
  return reply.header('content-type', 'application/json; charset=utf-8').send(row.terms_json);
});

app.post<{ Body: NewCredit }>('/api/credits', {
  schema: { body: { type: 'object', additionalProperties: false,
    required: ['producerId', 'lenderId', 'purpose', 'principal', 'annualRate', 'termMonths', 'repaymentPercent', 'dueDate'],
    properties: { producerId: { type: 'integer' }, lenderId: { type: 'integer' }, purpose: { type: 'string', minLength: 3, maxLength: 140 },
      principal: MONEY, annualRate: MONEY, termMonths: { type: 'integer' }, repaymentPercent: MONEY, dueDate: DATE } } },
}, async (req) => createCredit(db, req.body));

app.post<{ Params: { id: string } }>('/api/credits/:id/disburse', async (req) => {
  const r = await disburseCredit(db, Number(req.params.id), { asset, signerFor: lenderSigner });
  return { ...r, explorer: explorerTx(r.txHash) };
});

app.post<{ Params: { id: string } }>('/api/credits/:id/cancel', async (req) => {
  await cancelCredit(db, Number(req.params.id));
  return { ok: true };
});

app.patch<{ Params: { id: string }; Body: { autoDeduct?: boolean; repaymentPercent?: string } }>('/api/credits/:id', {
  schema: { body: { type: 'object', additionalProperties: false, properties: { autoDeduct: { type: 'boolean' }, repaymentPercent: MONEY } } },
}, async (req) => {
  await updateCredit(db, Number(req.params.id), req.body);
  return { ok: true };
});

/* ── admin: monthly summary, audit, day close ──────────────────────────── */

app.get<{ Querystring: { month?: string } }>('/api/metrics', async (req) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month! : new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 7);
  const from = dayStart(`${month}-01`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const to = dayStart(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
  const base = `FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN payment_runs r ON r.id = s.run_id JOIN producers p ON p.id = d.producer_id
                WHERE s.status = 'paid' AND r.settled_at >= $1 AND r.settled_at < $2`;
  const kpis = (await db.query(`SELECT COUNT(*)::int AS payments, COALESCE(SUM(s.net), 0)::text AS paid, COALESCE(SUM(s.gross), 0)::text AS gross,
      COALESCE(SUM(d.quantity), 0)::text AS quantity, COUNT(DISTINCT p.id)::int AS producers, COALESCE(SUM(s.credit_repayment), 0)::text AS repayments,
      CASE WHEN SUM(d.quantity) > 0 THEN ROUND(SUM(s.gross) / SUM(d.quantity), 2)::text END AS avg_price ${base}`, [from, to])).rows[0];
  const byDay = (await db.query(`SELECT to_char(r.settled_at - INTERVAL '6 hours', 'YYYY-MM-DD') AS day, COUNT(*)::int AS payments,
      SUM(s.net)::text AS paid, SUM(d.quantity)::text AS quantity ${base} GROUP BY 1 ORDER BY 1`, [from, to])).rows;
  const top = (await db.query(`SELECT p.name AS producer, SUM(d.quantity)::text AS quantity, SUM(s.net)::text AS paid ${base}
      GROUP BY p.name ORDER BY SUM(d.quantity) DESC LIMIT 5`, [from, to])).rows;
  return { month, kpis, byDay, top };
});

app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/audit', async (req) =>
  (await db.query(`SELECT id, action, details, created_at FROM audit_log ORDER BY id DESC LIMIT $1 OFFSET $2`,
    [Math.min(Number(req.query.limit ?? 50), 200), Number(req.query.offset ?? 0)])).rows);

app.get('/api/audit.csv', async (_req, reply) =>
  csv(reply, (await db.query<Record<string, unknown>>(`SELECT created_at AS fecha, action AS accion, details AS detalle FROM audit_log ORDER BY id`)).rows, 'auditoria.csv'));

/** Day close: camt.053 of the cooperative's Stellar account for one local business day. */
app.get<{ Querystring: { date?: string } }>('/api/statement', async (req, reply) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '') ? req.query.date! : new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const to = new Date(Math.min(dayEnd(date).getTime(), Date.now()));
  const statement = await buildStatement(db, { from: dayStart(date), to, asset, network: NETWORK, currency: TOKEN_CCY[asset.getCode()] ?? 'MXN' });
  await audit(db, 'cierre_de_dia', { date });
  return xml(reply, statement, `camt053-${date}.xml`);
});

app.get('/api/health', async () => ({ ok: true, signer: coopSigner.kind, network: NETWORK }));

// PGlite writes to disk on close: an abrupt exit can leave the data directory unusable.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}

const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: '127.0.0.1' });
console.log(`API en http://127.0.0.1:${port} · firma: ${coopSigner.kind}`);
