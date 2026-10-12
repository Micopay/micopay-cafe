/**
 * Prepares a fresh demo on Stellar testnet:
 *  - funds issuer, cooperative, lender and producers with friendbot
 *  - issues the demo MXNe token: working capital to the cooperative, a loan fund to the lender
 *  - loads cooperative, lender, producers, products, daily prices and quality rules
 *  - grants and disburses one crop loan through the real flow (terms anchored on Stellar)
 *    and leaves a second one pending so the admin flow can be shown
 *
 * Testnet only. Keys are written to data/testnet-keys.json (git-ignored).
 */
import { Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { rmSync } from 'node:fs';
import { ASSET_CODE, DATA_DIR, PG_DIR, saveKeys, type TestnetKeys } from './config.js';
import { createCredit, disburseCredit } from './credits.js';
import { audit, openDb } from './db.js';
import { horizon, LocalSigner, NETWORK_PASSPHRASE } from './stellar.js';
import { friendbot } from './testnet.js';

const PRODUCERS = [
  { name: 'Juan Pérez López', community: 'Tenejapa, Chiapas', contact: '967 123 4501' },
  { name: 'María Hernández Gómez', community: 'Oxchuc, Chiapas', contact: '967 123 4502' },
  { name: 'Pedro Sántiz Girón', community: 'Chenalhó, Chiapas', contact: '967 123 4503' },
];

async function main() {
  rmSync(PG_DIR, { recursive: true, force: true });

  const issuer = Keypair.random();
  const coop = Keypair.random();
  const lender = Keypair.random();
  const producers = PRODUCERS.map(() => Keypair.random());

  console.log('Fondeando 6 cuentas con friendbot…');
  await Promise.all([issuer, coop, lender, ...producers].map((k) => friendbot(k.publicKey())));

  const asset = new Asset(ASSET_CODE, issuer.publicKey());
  const holders = [coop, lender, ...producers];
  const builder = new TransactionBuilder(await horizon.loadAccount(coop.publicKey()), { fee: '1000', networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(120);
  for (const h of holders) builder.addOperation(Operation.changeTrust({ asset, source: h.publicKey() }));
  builder.addOperation(Operation.payment({ source: issuer.publicKey(), destination: coop.publicKey(), asset, amount: '500000' }));
  builder.addOperation(Operation.payment({ source: issuer.publicKey(), destination: lender.publicKey(), asset, amount: '300000' }));
  const tx = builder.build();
  tx.sign(issuer, ...holders);
  console.log(`Trustlines y fondeo en MXNe: ${(await horizon.submitTransaction(tx)).hash}`);

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
  await db.query(`INSERT INTO lenders (name, kind, account_id, stellar_address) VALUES ($1, 'IFNB', 'LEND-0001', $2)`,
    ['Fondo de Avío Los Altos (demo)', lender.publicKey()]);
  for (const [i, p] of PRODUCERS.entries()) {
    await db.query(
      `INSERT INTO producers (cooperative_id, name, community, contact, account_id, stellar_address) VALUES (1, $1, $2, $3, $4, $5)`,
      [p.name, p.community, p.contact, `PROD-000${i + 1}`, producers[i]!.publicKey()],
    );
  }

  await db.query(`INSERT INTO products (name, unit, quality_schema) VALUES
    ('Café pergamino', 'kg', '[{"key":"humedad","label":"Humedad","unit":"%"},{"key":"defectos","label":"Defectos","unit":"%"}]'),
    ('Cacao seco', 'kg', '[{"key":"humedad","label":"Humedad","unit":"%"},{"key":"fermentacion","label":"Fermentación","unit":"%"}]')`);
  // Demo prices, not market quotes.
  await db.query(`INSERT INTO prices (product_id, cooperative_id, price_per_unit, valid_from) VALUES
    (1, 1, 82.00, NOW() - INTERVAL '2 days'), (1, 1, 85.00, NOW() - INTERVAL '1 hour'), (2, 1, 120.00, NOW() - INTERVAL '1 hour')`);
  await db.query(`INSERT INTO deduction_rules (product_id, attribute, above, percent, reason, label) VALUES
    (1, 'humedad', 12, 4, 'HUME', 'Humedad arriba de 12%'),
    (1, 'humedad', 14, 10, 'HUME', 'Humedad arriba de 14%'),
    (1, 'defectos', 5, 3, 'DEFE', 'Defectos arriba de 5%'),
    (2, 'humedad', 8, 5, 'HUME', 'Humedad arriba de 8%')`);
  await audit(db, 'demo.inicializada', { cooperative: 'Cooperativa Cafetalera Los Altos' });

  const due = new Date(); due.setMonth(due.getMonth() + 8);
  const dueDate = due.toISOString().slice(0, 10);
  const juan = await createCredit(db, {
    producerId: 1, lenderId: 1, purpose: 'Avío: fertilizante y jornales', principal: '20000',
    annualRate: '8.5', termMonths: 8, repaymentPercent: '25', dueDate,
  });
  const d = await disburseCredit(db, juan.id, { asset, signerFor: () => new LocalSigner(lender) });
  console.log(`Crédito ${juan.reference} desembolsado a Juan: ${d.txHash}`);
  const maria = await createCredit(db, {
    producerId: 2, lenderId: 1, purpose: 'Renovación de cafetal (plántula)', principal: '12000',
    annualRate: '8.5', termMonths: 12, repaymentPercent: '20', dueDate,
  });
  console.log(`Crédito ${maria.reference} de María queda pendiente de desembolso`);
  await db.close();

  console.log(`\nListo. Cooperativa: ${coop.publicKey()}\nDatos en ${DATA_DIR}`);
}

main().catch((err) => {
  console.error(err?.response?.data?.extras ?? err);
  process.exit(1);
});
