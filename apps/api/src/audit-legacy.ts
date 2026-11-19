/**
 * Read-only report on payment runs written before the unconfirmed-payments fix.
 *
 *   npm run audit:legacy -w apps/api -- <copy of the old data/pg directory>
 *
 * Run it on a COPY of the archived database: opening a PGlite directory can
 * write to it. For every old run it asks Horizon what happened to its
 * transaction hash and lists the deliveries its pain.001 refers to, so a run
 * marked "rejected" that actually paid shows up. It changes nothing.
 */
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { HorizonChain } from './stellar.js';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error('Uso: npm run audit:legacy -w apps/api -- <copia del directorio pg anterior>');
  process.exit(2);
}

const db = new PGlite(dir);
const chain = new HorizonChain();
try {
  const runs = (await db.query<{ id: number; msg_id: string; status: string; tx_hash: string | null; pain001: string | null; created_at: Date }>(
    `SELECT id, msg_id, status, tx_hash, pain001, created_at FROM payment_runs ORDER BY id`,
  )).rows;
  const report = [];
  for (const r of runs) {
    const ledger = r.tx_hash ? await chain.lookup(r.tx_hash.trim()) : null;
    const onLedger = !ledger ? 'sin hash' : ledger.kind === 'found' ? (ledger.successful ? 'exitosa' : `fallida (${ledger.resultCode})`)
      : ledger.kind === 'not_found' ? 'no aparece (no prueba nada)' : 'Horizon no respondió';
    report.push({
      run: r.id, msgId: r.msg_id, recorded: r.status, onLedger, tx: r.tx_hash?.trim() ?? null,
      deliveries: [...new Set(r.pain001?.match(/ENT-\d{4}-\d{6}/g) ?? [])],
      contradiction: r.status !== 'settled' && ledger?.kind === 'found' && ledger.successful,
    });
  }
  console.log(JSON.stringify(report, null, 2));
  const bad = report.filter((x) => x.contradiction);
  console.error(`${runs.length} corridas; ${bad.length} marcadas como no pagadas que Stellar muestra exitosas${bad.length ? `: ${bad.map((b) => b.msgId).join(', ')}` : ''}`);
} finally {
  await db.close();
}
