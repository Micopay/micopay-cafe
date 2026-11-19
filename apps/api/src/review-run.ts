/**
 * Looks up one blocked payment attempt again and closes it only on positive
 * evidence from the ledger (the transaction record, successful or failed).
 * Without evidence nothing changes: v1 has no way to release an attempt by hand.
 *
 *   npm run review:run -w apps/api -- <runId>
 *
 * The runId is the run_id of GET /api/payments/:id. Run it with the API stopped:
 * the payment locks live in the API process, so both refuse to share the data directory.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { acquireDataLock, loadKeys, PG_DIR, settlementAsset } from './config.js';
import { hasSchemaCut, openDb } from './db.js';
import { createPaymentEngine } from './runs.js';
import { HorizonChain, LocalSigner } from './stellar.js';

const runId = Number(process.argv[2]);
if (!Number.isInteger(runId) || runId < 1) {
  console.error('Uso: npm run review:run -w apps/api -- <runId>');
  process.exit(2);
}

const release = acquireDataLock('el comando de revisión');
const db = await openDb(PG_DIR);
try {
  if (!(await hasSchemaCut(db))) throw new Error('la base no tiene la marca de corte de este esquema');
  const keys = loadKeys();
  const engine = createPaymentEngine({
    db, chain: new HorizonChain(), signer: new LocalSigner(Keypair.fromSecret(keys.cooperative)),
    asset: settlementAsset(keys), network: 'TESTNET',
  });
  const before = (await db.query<{ status: string; tx_hash: string }>(`SELECT status, tx_hash FROM payment_runs WHERE id = $1`, [runId])).rows[0];
  if (!before) throw new Error(`no existe el intento ${runId}`);
  await engine.reconcileRun(runId);
  const after = (await db.query<{ status: string }>(`SELECT status FROM payment_runs WHERE id = $1`, [runId])).rows[0]!;
  console.log(`Intento ${runId} · ${before.tx_hash}`);
  console.log(after.status === before.status
    ? `Sin cambios: sigue en ${after.status}. Sin evidencia en Stellar no se libera.`
    : `${before.status} → ${after.status}`);
} finally {
  await db.close();
  release();
}
