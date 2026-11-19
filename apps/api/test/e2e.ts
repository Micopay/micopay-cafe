/**
 * End-to-end check against a running API on Stellar testnet (after `npm run seed`):
 *   npx tsx apps/api/test/e2e.ts
 * Covers: daily price, producer signup, pay at the scale with quality deduction,
 * replay of a payment by its scale reference, credit lifecycle without disbursement
 * (disabled until it handles unconfirmed submissions), Horizon verification of the
 * run memo, ISO messages against the XSDs, exports and audit.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';

const API = process.env.API ?? 'http://127.0.0.1:8787/api';
const HORIZON = 'https://horizon-testnet.stellar.org';
const XSD = new URL('../../../docs/xsd/', import.meta.url);
let failures = 0;

function check(ok: boolean, label: string, extra = '') {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${label}${extra ? ` · ${extra}` : ''}`);
  if (!ok) failures++;
}
async function j<T = any>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${API}${path}`, body === undefined ? undefined : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data as T;
}
async function expectError(path: string, body: unknown, pattern: RegExp, label: string) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json()) as { error?: string };
  check(!res.ok && pattern.test(data.error ?? ''), label, data.error);
}
async function xsd(path: string, schema: string) {
  const xml = await (await fetch(`${API}${path}`)).text();
  const r = await validateXML({ xml: { fileName: 'm.xml', contents: xml }, schema: { fileName: `${schema}.xsd`, contents: readFileSync(new URL(`${schema}.xsd`, XSD), 'utf8') } });
  check(r.valid, `${schema} válido contra XSD`, r.errors.map((e) => e.rawMessage).join(' | '));
  return xml;
}
async function memoHex(txHash: string) {
  const tx = (await (await fetch(`${HORIZON}/transactions/${txHash}`)).json()) as { memo_type: string; memo: string; successful: boolean; operation_count: number };
  return { ...tx, hex: Buffer.from(tx.memo, 'base64').toString('hex') };
}

for (let i = 0; i < 30; i++) { try { await j('/health'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }

// Products and daily price (café cereza first: it is what is bought the most)
const products = await j<any[]>('/products');
const P = Object.fromEntries(products.map((p) => [p.name, p.id])) as Record<string, number>;
check(products[0].name === 'Café cereza' && products[0].price === '17.50', 'café cereza primero, precio de demo', products[0].price);
await j('/prices', { productId: P['Café pergamino'], price: '85.00' });
check((await j<any[]>('/products')).find((p) => p.name === 'Café pergamino').price === '85.00', 'precio del día actualizado');

// Credits as seeded: both pending, because disbursement is disabled
const credits = await j<any[]>('/credits');
const juanCredit = credits.find((c) => c.producer === 'Juan Pérez López');
const mariaCredit = credits.find((c) => c.producer === 'María Hernández Gómez');
check(juanCredit?.status === 'pendiente' && juanCredit.total_due === '12510.00', 'crédito de Juan pendiente, total con interés', juanCredit?.total_due);
check(mariaCredit?.status === 'pendiente', 'crédito de María pendiente');
await expectError(`/credits/${mariaCredit.id}/disburse`, {}, /desactivado/, 'el desembolso está desactivado');

// Pay Juan at the scale with a scale reference: quality deduction, no repayment of a pending credit
const ref = randomUUID();
const juanBody = { producerId: 1, productId: P['Café pergamino']!, quantity: '250', quality: { humedad: 13.5, defectos: 3 }, lot: 'LOTE-45', clientRef: ref };
const pay = await j('/payments', juanBody);
check(pay.status === 'settled' && pay.gross === '21250.00' && pay.creditRepayment === '0.00' && pay.net === '20400.00', 'pago de Juan con castigo', pay.net);
const again = await j('/payments', juanBody);
check(again.replayed === true && again.settlementId === pay.settlementId && again.txHash === pay.txHash, 'repetir con la misma referencia devuelve el mismo pago');
await expectError('/payments', { ...juanBody, quantity: '251' }, /otros datos/, 'la misma referencia con otros datos se rechaza');
check((await j(`/payments/by-ref/${ref}`)).settlementId === pay.settlementId, 'recuperar el pago por su referencia');
const run = await memoHex(pay.txHash);
const detail = await j(`/payments/${pay.settlementId}`);
const pain001 = await xsd(`/runs/${detail.run_id}/pain001`, 'pain.001.001.09');
check(run.successful && run.operation_count === 1 && run.hex === createHash('sha256').update(pain001).digest('hex'), 'una transacción, 1 operación (sin abono), memo = SHA-256 del pain.001');
await xsd(`/runs/${detail.run_id}/pain002`, 'pain.002.001.10');
await xsd(`/payments/${pay.settlementId}/camt054`, 'camt.054.001.08');
check(detail.paymentState === 'paid' && detail.retryAllowed === false, 'estado del pago y sin reintento');
await expectError(`/payments/${pay.settlementId}/retry`, {}, /ya se hizo/, 'un pago hecho no se reintenta');

// Pause automatic deduction: next payment carries no repayment
await j(`/credits/${juanCredit.id}`, { autoDeduct: false }, 'PATCH');
const paused = await j('/payments/preview', { producerId: 1, productId: P['Café cereza']!, quantity: '100', quality: {} });
check(paused.creditRepayment === '0.00', 'con el descuento pausado no hay abono');
await j(`/credits/${juanCredit.id}`, { autoDeduct: true }, 'PATCH');

// María: a pending credit is never repaid at the scale
const before = await j('/payments/preview', { producerId: 2, productId: P['Café cereza']!, quantity: '100', quality: {} });
check(before.creditRepayment === '0.00', 'un crédito pendiente no se descuenta');
const payM = await j('/payments', { producerId: 2, productId: P['Café pergamino']!, quantity: '180.5', quality: { humedad: 11.8, defectos: 6 } });
check(payM.status === 'settled' && payM.creditRepayment === '0.00', 'pago de María sin abono', payM.net);

// Pedro sells café cereza at the scale: price negotiated 30 cents over the reference, no deductions
const cereza = await j('/payments', { producerId: 3, productId: P['Café cereza']!, quantity: '600', unitPrice: '17.80' });
check(cereza.status === 'settled' && cereza.gross === '10680.00' && cereza.deductions.length === 0 && cereza.net === '10680.00', 'compra de café cereza a precio negociado', cereza.net);

// New credit for Pedro, cancelled before disbursement
const due = new Date(); due.setMonth(due.getMonth() + 6);
const cp = await j('/credits', { producerId: 3, lenderId: 1, purpose: 'Secadora solar', principal: '8000', annualRate: '8.5', termMonths: 6, repaymentPercent: '15', dueDate: due.toISOString().slice(0, 10) });
await j(`/credits/${cp.id}/cancel`, {});
check((await j(`/credits/${cp.id}`)).status === 'cancelado', 'crédito cancelado antes del desembolso');
await expectError('/credits', { producerId: 3, lenderId: 1, purpose: 'x', principal: '0', annualRate: '8', termMonths: 6, repaymentPercent: '10', dueDate: '2030-01-01' }, /.+/, 'rechaza un crédito inválido');

// New producer with a fresh testnet account, paid in cocoa (generic product)
const acct = await j('/testnet/account', {});
const np = await j('/producers', { name: 'Rosa Gómez Díaz', community: 'Ixhuacán, Veracruz', stellarAddress: acct.address });
check(np.account === 'ok', 'alta de productor con cuenta activa', np.accountId);
await expectError('/producers', { name: 'Duplicado', stellarAddress: acct.address }, /ya hay/, 'no duplica direcciones');
await expectError('/producers', { name: 'Mala', stellarAddress: 'rN7n7otQDd6FczFgLdlqtyMVrn3e5PcjXd' }, /no es válida/, 'rechaza direcciones XRPL');
const cacao = await j('/payments', { producerId: np.id, productId: P['Cacao seco']!, quantity: '95', quality: { humedad: 7.5 } });
check(cacao.status === 'settled' && cacao.net === '11400.00', 'pago de cacao a productora nueva', cacao.net);

// Reports
const m = await j('/metrics');
check(m.kpis.payments === 4 && m.top.length === 4, 'resumen del mes', `${m.kpis.payments} pagos · ${m.kpis.quantity} kg`);
check((await (await fetch(`${API}/payments.csv`)).text()).split('\n').length === 5, 'exportación de pagos');
check((await (await fetch(`${API}/credits.csv`)).text()).includes('CR-2026-0003'), 'exportación de cartera');
const auditLog = await j<any[]>('/audit');
check(['pago', 'productor.alta', 'credito.cancelado', 'credito.ajuste', 'precio.del_dia', 'precio.modificado_en_pago'].every((a) => auditLog.some((x) => x.action === a)), 'bitácora de auditoría');
await xsd('/statement', 'camt.053.001.08');

console.log(failures ? `\n${failures} verificaciones fallaron` : '\nTodo en orden');
process.exit(failures ? 1 : 0);
