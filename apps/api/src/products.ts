import type { Db } from './db.js';

/**
 * Café cereza (fruit): the coffee bought freshly picked, before pulping.
 * Quality is judged on ripeness: share of green cherries and of floaters/empty
 * fruit (vanos). Price and deduction tiers are demo values, not market quotes.
 * Idempotent, so it can run against an existing database.
 */
export async function addCafeCereza(db: Db): Promise<number> {
  const existing = (await db.query<{ id: number }>(`SELECT id FROM products WHERE name = 'Café cereza'`)).rows[0];
  if (existing) return existing.id;
  const { id } = (await db.query<{ id: number }>(
    `INSERT INTO products (name, unit, quality_schema) VALUES ('Café cereza', 'kg',
       '[{"key":"verdes","label":"Cereza verde","unit":"%"},{"key":"vanos","label":"Vanos y flotes","unit":"%"}]') RETURNING id`,
  )).rows[0]!;
  await db.query(`INSERT INTO prices (product_id, cooperative_id, price_per_unit, valid_from) VALUES ($1, 1, 18.00, NOW() - INTERVAL '1 hour')`, [id]);
  await db.query(
    `INSERT INTO deduction_rules (product_id, attribute, above, percent, reason, label) VALUES
       ($1, 'verdes', 5, 3, 'VERD', 'Cereza verde arriba de 5%'),
       ($1, 'verdes', 10, 8, 'VERD', 'Cereza verde arriba de 10%'),
       ($1, 'vanos', 5, 3, 'VANO', 'Vanos y flotes arriba de 5%')`,
    [id],
  );
  return id;
}
