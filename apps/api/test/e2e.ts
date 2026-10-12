/** Manual end-to-end check against a running API on testnet: npx tsx test/e2e.ts */
import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';
const API = process.env.API ?? 'http://127.0.0.1:8787/api';
const XSD = new URL('../../../docs/xsd/', import.meta.url);
async function j(path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data;
}
async function check(path: string, schema: string) {
  const xml = await (await fetch(`${API}${path}`)).text();
  const r = await validateXML({ xml: { fileName: 'm.xml', contents: xml }, schema: { fileName: `${schema}.xsd`, contents: readFileSync(new URL(`${schema}.xsd`, XSD), 'utf8') } });
  console.log(`${r.valid ? 'VALIDO  ' : 'INVALIDO'} ${schema} ${path}`, r.errors.map((e) => e.rawMessage).join(' | '));
}
for (let i = 0; i < 30; i++) { try { await j('/health'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
console.log('resumen', await j('/summary'));
console.log('preview', await j('/deliveries/preview', { producerId: 1, productId: 1, quantity: '250', quality: { humedad: 13.5, defectos: 3 } }));
const d1 = await j('/deliveries', { producerId: 1, productId: 1, quantity: '250', quality: { humedad: 13.5, defectos: 3 }, lot: 'LOTE-45' });
const d2 = await j('/deliveries', { producerId: 2, productId: 1, quantity: '180.5', quality: { humedad: 11.8, defectos: 6 } });
const d3 = await j('/deliveries', { producerId: 3, productId: 2, quantity: '95', quality: { humedad: 7.5 } });
console.log('entregas', [d1, d2, d3].map((d) => `${d.reference} bruto ${d.gross} neto ${d.net} abono ${d.creditRepayment}`));
const run = await j('/runs', { settlementIds: [d1.settlementId, d2.settlementId, d3.settlementId] });
console.log('corrida', run);
await check(`/runs/${run.runId}/pain001`, 'pain.001.001.09');
await check(`/runs/${run.runId}/pain002`, 'pain.002.001.10');
for (const d of [d1, d2, d3]) await check(`/settlements/${d.settlementId}/camt054`, 'camt.054.001.08');
await check('/statement', 'camt.053.001.08');
console.log('creditos', (await j('/credits')).map((c: any) => `${c.reference} saldo ${c.outstanding} pagado ${c.repaid}`));
