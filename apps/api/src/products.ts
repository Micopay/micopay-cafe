import type { Db } from './db.js';

/**
 * Café cereza (fruit): the coffee bought freshly picked, before pulping — what
 * producers sell the most, to the seasonal compradoras. There are no standard
 * quality deductions: the price is negotiated at the scale, a few cents up or
 * down from the day's reference. The default reference sits inside last
 * season's 15–20 MXN/kg range in Veracruz (this season's is not known yet).
 * Idempotent, so it can run against an existing database.
 */
export async function addCafeCereza(db: Db, price = '17.50'): Promise<number> {
  const existing = (await db.query<{ id: number }>(`SELECT id FROM products WHERE name = 'Café cereza'`)).rows[0];
  if (existing) return existing.id;
  const { id } = (await db.query<{ id: number }>(
    `INSERT INTO products (name, unit, quality_schema) VALUES ('Café cereza', 'kg', '[]') RETURNING id`,
  )).rows[0]!;
  await db.query(`INSERT INTO prices (product_id, cooperative_id, price_per_unit, valid_from) VALUES ($1, 1, $2, NOW() - INTERVAL '1 hour')`, [id, price]);
  return id;
}
