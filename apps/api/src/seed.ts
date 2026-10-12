/**
 * Prepares a fresh demo on Stellar testnet:
 *  - funds issuer, cooperative, lender and producers with friendbot
 *  - issues the demo MXNe token and gives the cooperative working capital
 *  - loads cooperative, lender, producers, products, prices, quality rules and one credit
 *
 * Testnet only. Keys are written to data/testnet-keys.json (git-ignored).
 */
import { Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { rmSync } from 'node:fs';
import { ASSET_CODE, DATA_DIR, PG_DIR, saveKeys, type TestnetKeys } from './config.js';
import { openDb } from './db.js';
import { horizon, NETWORK_PASSPHRASE } from './stellar.js';

const PRODUCERS = [
  { name: 'Juan Pérez López', community: 'Tenejapa, Chiapas' },
  { name: 'María Hernández Gómez', community: 'Oxchuc, Chiapas' },
  { name: 'Pedro Sántiz Girón', community: 'Chenalhó, Chiapas' },
];
const WORKING_CAPITAL = '500000';

async function friendbot(address: string) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  if (!res.ok) throw new Error(`friendbot falló para ${address}: ${res.status}`);
}

async function main() {
  rmSync(PG_DIR, { recursive: true, force: true });

  const issuer = Keypair.random();
  const coop = Keypair.random();
  const lender = Keypair.random();
  const producers = PRODUCERS.map(() => Keypair.random());
  const all = [issuer, coop, lender, ...producers];

  console.log('Fondeando 6 cuentas con friendbot…');
  await Promise.all(all.map((k) => friendbot(k.publicKey())));

  const asset = new Asset(ASSET_CODE, issuer.publicKey());
  const source = await horizon.loadAccount(coop.publicKey());
  const holders = [coop, lender, ...producers];
  const builder = new TransactionBuilder(source, { fee: '1000', networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(120);
  for (const h of holders) builder.addOperation(Operation.changeTrust({ asset, source: h.publicKey() }));
  builder.addOperation(Operation.payment({ source: issuer.publicKey(), destination: coop.publicKey(), asset, amount: WORKING_CAPITAL }));
  const tx = builder.build();
  tx.sign(issuer, ...holders);
  const res = await horizon.submitTransaction(tx);
  console.log(`Trustlines + capital de trabajo: ${res.hash}`);

  const keys: TestnetKeys = {
    issuer: issuer.secret(),
    cooperative: coop.secret(),
    lender: lender.secret(),
    producers: Object.fromEntries(producers.map((k, i) => [`PROD-000${i + 1}`, k.secret()])),
  };
  saveKeys(keys);

  const db = await openDb(PG_DIR);
  await db.query(`INSERT INTO cooperatives (name, account_id, stellar_address) VALUES ($1, 'COOP-0001', $2)`,
    ['Cooperativa Cafetalera Los Altos', coop.publicKey()]);
  await db.query(`INSERT INTO lenders (name, account_id, stellar_address) VALUES ($1, 'LEND-0001', $2)`,
    ['Fondo de Avío (IFNB demo)', lender.publicKey()]);
  for (const [i, p] of PRODUCERS.entries()) {
    await db.query(
      `INSERT INTO producers (cooperative_id, name, community, account_id, stellar_address) VALUES (1, $1, $2, $3, $4)`,
      [p.name, p.community, `PROD-000${i + 1}`, producers[i]!.publicKey()],
    );
  }

  await db.query(`INSERT INTO products (name, unit, quality_schema) VALUES
    ('Café pergamino', 'kg', '[{"key":"humedad","label":"Humedad","unit":"%"},{"key":"defectos","label":"Defectos","unit":"%"}]'),
    ('Cacao seco', 'kg', '[{"key":"humedad","label":"Humedad","unit":"%"},{"key":"fermentacion","label":"Fermentación","unit":"%"}]')`);
  await db.query(`INSERT INTO prices (product_id, cooperative_id, price_per_unit) VALUES (1, 1, 85.00), (2, 1, 120.00)`);
  await db.query(`INSERT INTO deduction_rules (product_id, attribute, above, percent, reason, label) VALUES
    (1, 'humedad', 12, 4, 'HUME', 'Humedad arriba de 12%'),
    (1, 'humedad', 14, 10, 'HUME', 'Humedad arriba de 14%'),
    (1, 'defectos', 5, 3, 'DEFE', 'Defectos arriba de 5%'),
    (2, 'humedad', 8, 5, 'HUME', 'Humedad arriba de 8%')`);
  await db.query(`INSERT INTO credits (reference, producer_id, lender_id, purpose, principal, outstanding, repayment_percent)
    VALUES ('CR-2026-0012', 1, 1, 'Avío: fertilizante y jornales', 20000, 20000, 25)`);
  await db.close();

  console.log(`\nListo. Cooperativa: ${coop.publicKey()}`);
  console.log(`Datos en ${DATA_DIR}`);
}

main().catch((err) => {
  console.error(err?.response?.data?.extras ?? err);
  process.exit(1);
});
