/**
 * Prepares a fresh demo on Stellar testnet:
 *  - funds the buyer, lender and producers with friendbot
 *  - settles in MicoPay's testnet USDC (issuer GADK7…, the one the MicoPay app shows):
 *    working capital to the buyer and a loan fund to the lender, minted with the
 *    issuer key of the MicoPay USDC rehearsal (~/.micopay/ensayo-usdc.json)
 *  - loads cooperative, lender, producers, products, daily prices and quality rules
 *  - grants and disburses one crop loan through the real flow (terms anchored on Stellar)
 *    and leaves a second one pending so the admin flow can be shown
 *
 * Testnet only. Keys are written to data/testnet-keys.json (git-ignored).
 */
import { Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR, PG_DIR, saveKeys, type TestnetKeys } from './config.js';
import { createCredit, disburseCredit } from './credits.js';
import { audit, openDb } from './db.js';
import { addCafeCereza } from './products.js';
import { horizon, LocalSigner, NETWORK_PASSPHRASE } from './stellar.js';
import { friendbot } from './testnet.js';

// Demo people and places: coffee towns around Xico, Veracruz.
const PRODUCERS = [
  { name: 'Juan Pérez López', community: 'Xico, Veracruz', contact: '228 123 4501' },
  { name: 'María Hernández Gómez', community: 'Teocelo, Veracruz', contact: '228 123 4502' },
  { name: 'Pedro Martínez Landa', community: 'Cosautlán, Veracruz', contact: '228 123 4503' },
  { name: 'Juana Sandoval', community: 'Huatusco, Veracruz', contact: '273 123 4504' },
];

/** Testnet USDC issuer of the MicoPay rehearsal: the app's VITE_USDC_ISSUER on testnet. */
function usdcIssuer(): Keypair {
  const state = JSON.parse(readFileSync(join(homedir(), '.micopay', 'ensayo-usdc.json'), 'utf8')) as { issuer: string };
  return Keypair.fromSecret(state.issuer);
}

async function main() {
  rmSync(PG_DIR, { recursive: true, force: true });

  const issuer = usdcIssuer();
  const coop = Keypair.random();
  const lender = Keypair.random();
  const producers = PRODUCERS.map(() => Keypair.random());

  console.log(`Fondeando ${2 + producers.length} cuentas con friendbot…`);
  await Promise.all([coop, lender, ...producers].map((k) => friendbot(k.publicKey())));

  const asset = new Asset('USDC', issuer.publicKey());
  const holders = [coop, lender, ...producers];
  const builder = new TransactionBuilder(await horizon.loadAccount(coop.publicKey()), { fee: '1000', networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(120);
  for (const h of holders) builder.addOperation(Operation.changeTrust({ asset, source: h.publicKey() }));
  builder.addOperation(Operation.payment({ source: issuer.publicKey(), destination: coop.publicKey(), asset, amount: '30000' }));
  builder.addOperation(Operation.payment({ source: issuer.publicKey(), destination: lender.publicKey(), asset, amount: '15000' }));
  const tx = builder.build();
  tx.sign(issuer, ...holders);
  console.log(`Trustlines y fondeo en USDC de testnet: ${(await horizon.submitTransaction(tx)).hash}`);

  // The issuer secret stays in ~/.micopay; the demo key file only records the asset.
  const keys: TestnetKeys = {
    issuer: '',
    asset: { code: 'USDC', issuer: issuer.publicKey() },
    cooperative: coop.secret(),
    lender: lender.secret(),
    producers: Object.fromEntries(producers.map((k, i) => [`PROD-000${i + 1}`, k.secret()])),
  };
  saveKeys(keys);

  const db = await openDb(PG_DIR);
  await db.query(`INSERT INTO cooperatives (name, account_id, stellar_address) VALUES ($1, 'COOP-0001', $2)`,
    ['Compradora de Café La Cumbre', coop.publicKey()]);
  await db.query(`INSERT INTO lenders (name, kind, account_id, stellar_address) VALUES ($1, 'IFNB', 'LEND-0001', $2)`,
    ['Fondo de Avío Xico (demo)', lender.publicKey()]);
  for (const [i, p] of PRODUCERS.entries()) {
    await db.query(
      `INSERT INTO producers (cooperative_id, name, community, contact, account_id, stellar_address) VALUES (1, $1, $2, $3, $4, $5)`,
      [p.name, p.community, p.contact, `PROD-000${i + 1}`, producers[i]!.publicKey()],
    );
  }

  // Café cereza first: it is what producers sell the most during the harvest.
  await addCafeCereza(db);
  await db.query(`INSERT INTO products (name, unit, quality_schema) VALUES
    ('Café pergamino', 'kg', '[{"key":"humedad","label":"Humedad","unit":"%"},{"key":"defectos","label":"Defectos","unit":"%"}]'),
    ('Cacao seco', 'kg', '[{"key":"humedad","label":"Humedad","unit":"%"},{"key":"fermentacion","label":"Fermentación","unit":"%"}]')`);
  // Demo prices, not market quotes.
  await db.query(`INSERT INTO prices (product_id, cooperative_id, price_per_unit, valid_from) VALUES
    (2, 1, 82.00, NOW() - INTERVAL '2 days'), (2, 1, 85.00, NOW() - INTERVAL '1 hour'), (3, 1, 120.00, NOW() - INTERVAL '1 hour')`);
  await db.query(`INSERT INTO deduction_rules (product_id, attribute, above, percent, reason, label) VALUES
    (2, 'humedad', 12, 4, 'HUME', 'Humedad arriba de 12%'),
    (2, 'humedad', 14, 10, 'HUME', 'Humedad arriba de 14%'),
    (2, 'defectos', 5, 3, 'DEFE', 'Defectos arriba de 5%'),
    (3, 'humedad', 8, 5, 'HUME', 'Humedad arriba de 8%')`);
  await audit(db, 'demo.inicializada', { buyer: 'Compradora de Café La Cumbre' });

  const due = new Date(); due.setMonth(due.getMonth() + 8);
  const dueDate = due.toISOString().slice(0, 10);
  const juan = await createCredit(db, {
    producerId: 1, lenderId: 1, purpose: 'Avío: fertilizante y jornales', principal: '12000',
    annualRate: '8.5', termMonths: 6, repaymentPercent: '25', dueDate,
  });
  const d = await disburseCredit(db, juan.id, { asset, signerFor: () => new LocalSigner(lender) });
  console.log(`Crédito ${juan.reference} desembolsado a Juan: ${d.txHash}`);
  const maria = await createCredit(db, {
    producerId: 2, lenderId: 1, purpose: 'Renovación de cafetal (plántula)', principal: '12000',
    annualRate: '8.5', termMonths: 12, repaymentPercent: '20', dueDate,
  });
  console.log(`Crédito ${maria.reference} de María queda pendiente de desembolso`);
  await db.close();

  console.log(`\nListo. Compradora: ${coop.publicKey()}\nDatos en ${DATA_DIR}`);
}

main().catch((err) => {
  console.error(err?.response?.data?.extras ?? err);
  process.exit(1);
});
