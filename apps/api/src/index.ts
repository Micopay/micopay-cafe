import cors from '@fastify/cors';
import { Keypair } from '@stellar/stellar-sdk';
import Big from 'big.js';
import Fastify, { type FastifyReply } from 'fastify';
import { loadKeys, PG_DIR, settlementAsset } from './config.js';
import { openDb } from './db.js';
import { executeRun } from './runs.js';
import { settle, type DeductionRule } from './settlement.js';
import { buildStatement } from './statement.js';
import { assetBalance, explorerTx, LocalSigner } from './stellar.js';

const keys = loadKeys();
const asset = settlementAsset(keys);
const signer = new LocalSigner(Keypair.fromSecret(keys.cooperative));
const NETWORK = 'TESTNET' as const;
const db = await openDb(PG_DIR);

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, { origin: true });

app.setErrorHandler((err, _req, reply) => {
  reply.status(err.statusCode ?? 400).send({ error: err.message });
});

function xml(reply: FastifyReply, body: string | null | undefined, filename: string) {
  if (!body) return reply.status(404).send({ error: 'documento no disponible' });
  return reply.header('content-type', 'application/xml; charset=utf-8')
    .header('content-disposition', `inline; filename="${filename}"`).send(body);
}

async function nextRef(prefix: string, table: 'deliveries'): Promise<string> {
  const n = (await db.query<{ n: number }>(`SELECT COUNT(*)::int + 1 AS n FROM ${table}`)).rows[0]!.n;
  return `${prefix}-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`;
}

async function settlementInputs(producerId: number, productId: number) {
  const price = (await db.query<{ price_per_unit: string }>(
    `SELECT price_per_unit::text FROM prices WHERE product_id = $1 AND cooperative_id = 1 ORDER BY valid_from DESC LIMIT 1`, [productId],
  )).rows[0];
  if (!price) throw new Error('el producto no tiene precio vigente');
  const rules = (await db.query<DeductionRule>(
    `SELECT attribute, above::text, percent::text, reason, label FROM deduction_rules WHERE product_id = $1`, [productId],
  )).rows;
  // Repayment is computed against what is still owed after other unpaid settlements.
  const credit = (await db.query<{ id: number; reference: string; outstanding: string; repaymentPercent: string }>(
    `SELECT c.id, c.reference, (c.outstanding - COALESCE((SELECT SUM(s.credit_repayment) FROM settlements s
            WHERE s.credit_id = c.id AND s.status IN ('pending', 'in_run')), 0))::text AS outstanding,
            c.repayment_percent::text AS "repaymentPercent"
       FROM credits c WHERE c.producer_id = $1 AND c.status = 'active' ORDER BY c.created_at LIMIT 1`, [producerId],
  )).rows[0];
  return { unitPrice: price.price_per_unit, rules, credit: credit ?? null };
}

interface DeliveryBody { producerId: number; productId: number; quantity: string; quality: Record<string, number>; lot?: string }
const deliverySchema = {
  body: {
    type: 'object',
    required: ['producerId', 'productId', 'quantity'],
    properties: {
      producerId: { type: 'integer' }, productId: { type: 'integer' },
      quantity: { type: 'string', pattern: '^\\d+(\\.\\d{1,2})?$' },
      quality: { type: 'object', additionalProperties: { type: 'number' } },
      lot: { type: 'string', maxLength: 35 },
    },
    additionalProperties: false,
  },
};

app.get('/api/summary', async () => {
  const coop = (await db.query<{ name: string; stellar_address: string }>(`SELECT name, stellar_address FROM cooperatives WHERE id = 1`)).rows[0]!;
  const stats = (await db.query<Record<string, unknown>>(`SELECT
      (SELECT COUNT(*)::int FROM producers) AS producers,
      (SELECT COALESCE(SUM(net), 0)::text FROM settlements WHERE status = 'pending') AS pending_total,
      (SELECT COUNT(*)::int FROM settlements WHERE status = 'pending') AS pending_count,
      (SELECT COALESCE(SUM(net), 0)::text FROM settlements WHERE status = 'paid') AS paid_total,
      (SELECT COALESCE(SUM(d.quantity), 0)::text FROM deliveries d JOIN settlements s ON s.delivery_id = d.id WHERE s.status = 'paid') AS paid_quantity,
      (SELECT COALESCE(SUM(outstanding), 0)::text FROM credits WHERE status = 'active') AS credit_outstanding`)).rows[0];
  return { cooperative: coop, balance: await assetBalance(coop.stellar_address, asset), asset: { code: asset.getCode(), issuer: asset.getIssuer() }, network: NETWORK, ...stats };
});

app.get('/api/producers', async () => (await db.query(`
  SELECT p.id, p.name, p.community, p.account_id, p.stellar_address,
         COALESCE((SELECT SUM(d.quantity) FROM deliveries d WHERE d.producer_id = p.id), 0)::text AS delivered,
         COALESCE((SELECT SUM(s.net) FROM settlements s JOIN deliveries d ON d.id = s.delivery_id WHERE d.producer_id = p.id AND s.status = 'paid'), 0)::text AS paid,
         (SELECT row_to_json(c) FROM (SELECT reference, purpose, principal::text, outstanding::text, repayment_percent::text, status
            FROM credits WHERE producer_id = p.id ORDER BY created_at DESC LIMIT 1) c) AS credit
    FROM producers p ORDER BY p.id`)).rows);

app.get('/api/products', async () => (await db.query(`
  SELECT pr.id, pr.name, pr.unit, pr.quality_schema,
         (SELECT price_per_unit::text FROM prices WHERE product_id = pr.id ORDER BY valid_from DESC LIMIT 1) AS price,
         (SELECT json_agg(json_build_object('attribute', attribute, 'above', above::text, 'percent', percent::text, 'label', label) ORDER BY attribute, above)
            FROM deduction_rules WHERE product_id = pr.id) AS rules
    FROM products pr ORDER BY pr.id`)).rows);

app.post<{ Body: DeliveryBody }>('/api/deliveries/preview', { schema: deliverySchema }, async (req) => {
  const inputs = await settlementInputs(req.body.producerId, req.body.productId);
  return { unitPrice: inputs.unitPrice, credit: inputs.credit, ...settle({ ...inputs, quantity: req.body.quantity, quality: req.body.quality ?? {} }) };
});

app.post<{ Body: DeliveryBody }>('/api/deliveries', { schema: deliverySchema }, async (req) => {
  const { producerId, productId, quantity, quality = {}, lot } = req.body;
  const inputs = await settlementInputs(producerId, productId);
  const result = settle({ ...inputs, quantity, quality });
  const reference = await nextRef('ENT', 'deliveries');
  const delivery = (await db.query<{ id: number }>(
    `INSERT INTO deliveries (reference, producer_id, product_id, quantity, quality, lot) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [reference, producerId, productId, quantity, JSON.stringify(quality), lot ?? null],
  )).rows[0]!;
  const s = (await db.query<{ id: number }>(
    `INSERT INTO settlements (delivery_id, unit_price, gross, deductions, credit_id, credit_repayment, net)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [delivery.id, inputs.unitPrice, result.gross, JSON.stringify(result.deductions), result.creditId, result.creditRepayment, result.net],
  )).rows[0]!;
  return { deliveryId: delivery.id, settlementId: s.id, reference, ...result };
});

const SETTLEMENT_SELECT = `
  SELECT s.id, s.status, d.reference, d.lot, d.quantity::text, d.quality, d.created_at, pr.name AS product, pr.unit,
         s.unit_price::text, s.gross::text, s.deductions, s.credit_repayment::text, s.net::text, c.reference AS credit_ref,
         c.outstanding::text AS credit_outstanding, p.id AS producer_id, p.name AS producer, p.community, p.stellar_address,
         s.run_id, s.end_to_end_id, s.uetr, r.tx_hash, r.settled_at, r.pain001_sha256
    FROM settlements s JOIN deliveries d ON d.id = s.delivery_id JOIN products pr ON pr.id = d.product_id
    JOIN producers p ON p.id = d.producer_id LEFT JOIN credits c ON c.id = s.credit_id LEFT JOIN payment_runs r ON r.id = s.run_id`;

app.get<{ Querystring: { status?: string } }>('/api/settlements', async (req) =>
  (await db.query(`${SETTLEMENT_SELECT} WHERE ($1::text IS NULL OR s.status = $1) ORDER BY s.id DESC`, [req.query.status ?? null])).rows);

app.get<{ Params: { id: string } }>('/api/settlements/:id', async (req, reply) => {
  const row = (await db.query<{ tx_hash: string | null }>(`${SETTLEMENT_SELECT} WHERE s.id = $1`, [Number(req.params.id)])).rows[0];
  if (!row) return reply.status(404).send({ error: 'no existe' });
  return { ...row, explorer: row.tx_hash ? explorerTx(row.tx_hash) : null };
});

app.get<{ Params: { id: string } }>('/api/settlements/:id/camt054', async (req, reply) => {
  const row = (await db.query<{ camt054: string | null }>(`SELECT camt054 FROM settlements WHERE id = $1`, [Number(req.params.id)])).rows[0];
  return xml(reply, row?.camt054, `camt054-${req.params.id}.xml`);
});

app.post<{ Body: { settlementIds: number[] } }>('/api/runs', {
  schema: { body: { type: 'object', required: ['settlementIds'], properties: { settlementIds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 90 } } } },
}, async (req) => {
  const outcome = await executeRun(db, { settlementIds: req.body.settlementIds, signer, asset, network: NETWORK });
  return { ...outcome, explorer: explorerTx(outcome.txHash) };
});

app.get('/api/runs', async () => (await db.query<{ tx_hash: string | null }>(`
  SELECT r.id, r.msg_id, r.status, r.tx_hash, r.result_code, r.pain001_sha256, r.created_at, r.settled_at,
         COUNT(s.id)::int AS payments, COALESCE(SUM(s.net), 0)::text AS total, COALESCE(SUM(s.credit_repayment), 0)::text AS repayments
    FROM payment_runs r LEFT JOIN settlements s ON s.run_id = r.id GROUP BY r.id ORDER BY r.id DESC`)).rows
  .map((r) => ({ ...r, explorer: r.tx_hash ? explorerTx(r.tx_hash) : null })));

app.get<{ Params: { id: string; doc: string } }>('/api/runs/:id/:doc', async (req, reply) => {
  if (!['pain001', 'pain002'].includes(req.params.doc)) return reply.status(404).send({ error: 'documento desconocido' });
  const row = (await db.query<Record<string, string | null>>(`SELECT pain001, pain002 FROM payment_runs WHERE id = $1`, [Number(req.params.id)])).rows[0];
  return xml(reply, row?.[req.params.doc], `${req.params.doc}-${req.params.id}.xml`);
});

app.get('/api/credits', async () => (await db.query(`
  SELECT c.id, c.reference, c.purpose, c.principal::text, c.outstanding::text, c.repayment_percent::text, c.status, c.created_at,
         p.name AS producer, l.name AS lender,
         COALESCE((SELECT SUM(s.credit_repayment) FROM settlements s WHERE s.credit_id = c.id AND s.status = 'paid'), 0)::text AS repaid
    FROM credits c JOIN producers p ON p.id = c.producer_id JOIN lenders l ON l.id = c.lender_id ORDER BY c.id`)).rows);

app.get<{ Querystring: { from?: string; to?: string } }>('/api/statement', async (req, reply) => {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 3600 * 1000);
  return xml(reply, await buildStatement(db, { from, to, asset, network: NETWORK }), 'camt053.xml');
});

app.get('/api/health', async () => ({ ok: true, signer: signer.kind, network: NETWORK, decimals: new Big(1).toFixed(2) }));

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
