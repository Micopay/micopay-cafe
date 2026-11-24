import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { base64ToHex, parsePain001, parseTxInput, sha256Hex, verifyPayment, type HorizonClient, type HorizonResponse } from './verify.js';

const FIXTURE = join(import.meta.dirname, 'fixtures');
const enc = new TextEncoder();
const dec = new TextDecoder();

function fixture(name: string): Uint8Array<ArrayBuffer> {
  // new Uint8Array(typedArray) copies into a plain ArrayBuffer-backed view.
  return new Uint8Array(enc.encode(readFileSync(join(FIXTURE, name), 'utf8')));
}

/* ── mock Horizon ─────────────────────────────────────────────────────────── */

interface TxBody { memo_type: string | null; memo: string | null; successful: boolean }
type Op = { type: string; to?: string; amount?: string; asset_type?: string; asset_code?: string | null; asset_issuer?: string | null };

/** A HorizonClient that answers fixed records. txStatus !== 200 returns null body. */
function mockHorizon(opts: { txStatus?: number; tx?: Partial<TxBody>; ops?: Op[]; opStatus?: number } = {}): HorizonClient {
  const tx: TxBody = { memo_type: 'hash', memo: null, successful: true, ...opts.tx };
  return {
    async getTransaction(): Promise<HorizonResponse> {
      return { status: opts.txStatus ?? 200, body: opts.txStatus && opts.txStatus !== 200 ? null : tx };
    },
    async getOperations(): Promise<HorizonResponse> {
      return { status: opts.opStatus ?? 200, body: { _embedded: { records: opts.ops ?? [] } } };
    },
  };
}

/** The base64 memo that matches a file's SHA-256 (what a real MicoPay tx carries). */
async function memoFor(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let bin = '';
  for (let i = 0; i < h.length; i++) bin += String.fromCharCode(h[i]!);
  return btoa(bin);
}

/** One payment operation per transfer in the document that moves a token. */
function matchingOps(bytes: Uint8Array<ArrayBuffer>): Op[] {
  const parsed = parsePain001(dec.decode(bytes));
  return parsed.transfers
    .filter((t) => t.settlement.tokenAmount && Number(t.settlement.tokenAmount) > 0)
    .map((t) => ({ type: 'payment', to: t.creditorAddress!, amount: t.settlement.tokenAmount!, asset_type: 'credit_alphanum4', asset_code: t.settlement.assetCode, asset_issuer: t.settlement.assetIssuer }));
}

const SINGLE = () => fixture('pain001-single.xml');
const MULTI = () => fixture('pain001-multi.xml');
const HASH = '0'.repeat(64);
const OTHER_ADDR = 'GAU3R2JKHGJDF2BG3H4QYVBJQTFQYZLJDJUVXGQRG3SX3OBJXQCXY5MX';

describe('verificación de un pain.001 contra Stellar', () => {
  it('un pain.001 y su transacción verifican', async () => {
    const bytes = SINGLE();
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes) }, ops: matchingOps(bytes) }) });
    expect(r.kind).toBe('verified');
  });

  it('cambiar un byte del archivo falla la huella', async () => {
    const bytes = SINGLE();
    const memo = await memoFor(bytes); // memo for the ORIGINAL document
    const modified = new Uint8Array(enc.encode(dec.decode(bytes).replace('250.00', '250.01'))); // one content byte, XML stays valid
    const r = await verifyPayment({ fileBytes: modified, txHash: HASH, horizon: mockHorizon({ tx: { memo }, ops: matchingOps(bytes) }) });
    expect(r.kind).toBe('fingerprint_mismatch');
  });

  it('un pago a otra dirección falla y nombra la transferencia', async () => {
    const bytes = SINGLE();
    const ops = matchingOps(bytes).map((o) => ({ ...o, to: OTHER_ADDR }));
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes) }, ops }) });
    expect(r.kind).toBe('payment_mismatch');
    if (r.kind === 'payment_mismatch') {
      expect(r.mismatch).toBe('address');
      expect(r.transfer.creditorName).toBe('Juan Pérez López');
    }
  });

  it('un pago con otro monto falla y nombra la transferencia', async () => {
    const bytes = SINGLE();
    const ops = matchingOps(bytes).map((o) => ({ ...o, amount: '999.00000' }));
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes) }, ops }) });
    expect(r.kind).toBe('payment_mismatch');
    if (r.kind === 'payment_mismatch') {
      expect(r.mismatch).toBe('amount');
      expect(r.expected).toBe('836.64627');
      expect(r.found).toBe('999.00000');
      expect(r.transfer.creditorName).toBe('Juan Pérez López');
    }
  });

  it('un pago con otro activo falla y nombra la transferencia', async () => {
    const bytes = SINGLE();
    const ops = matchingOps(bytes).map((o) => ({ ...o, asset_code: 'MXNe' }));
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes) }, ops }) });
    expect(r.kind).toBe('payment_mismatch');
    if (r.kind === 'payment_mismatch') {
      expect(r.mismatch).toBe('asset');
      expect(r.expected).toContain('USDC');
      expect(r.found).toContain('MXNe');
    }
  });

  it('un documento sin monto de liquidación no puede verificar', async () => {
    const xml = dec.decode(SINGLE()).replace('<Amount>836.64627</Amount>', '');
    const bytes = new Uint8Array(enc.encode(xml));
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes) }, ops: matchingOps(SINGLE()) }) });
    expect(r.kind).toBe('payment_mismatch');
    if (r.kind === 'payment_mismatch') {
      expect(r.mismatch).toBe('settlement');
      expect(r.transfer.creditorName).toBe('Juan Pérez López');
    }
  });

  it('un memo de texto falla', async () => {
    const bytes = SINGLE();
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo_type: 'text', memo: 'hola' } }) });
    expect(r.kind).toBe('memo_not_hash');
    if (r.kind === 'memo_not_hash') expect(r.memoType).toBe('text');
  });

  it('una transacción sin memo falla', async () => {
    const bytes = SINGLE();
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo_type: 'none', memo: null } }) });
    expect(r.kind).toBe('memo_not_hash');
    if (r.kind === 'memo_not_hash') expect(r.memoType).toBe('none');
  });

  it('un memo hash que no contiene 32 bytes se reporta como respuesta inválida', async () => {
    const bytes = SINGLE();
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: 'aGVsbG8=' } }) });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.reason).toBe('response');
  });

  it('un 404 de Horizon muestra transacción no encontrada', async () => {
    const bytes = SINGLE();
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ txStatus: 404 }) });
    expect(r.kind).toBe('tx_not_found');
  });

  it('una transacción que falló en la cadena no verifica', async () => {
    const bytes = SINGLE();
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes), successful: false }, ops: matchingOps(bytes) }) });
    expect(r.kind).toBe('tx_unsuccessful');
  });

  it('un archivo que no es pain.001 da error de lectura', async () => {
    const r = await verifyPayment({ fileBytes: new Uint8Array(enc.encode('esto no es xml')), txHash: HASH, horizon: mockHorizon() });
    expect(r.kind).toBe('parse_error');
  });

  it('una corrida con dos transferencias verifica', async () => {
    const bytes = MULTI();
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes) }, ops: matchingOps(bytes) }) });
    expect(r.kind).toBe('verified');
  });

  it('en dos transferencias, la segunda con monto distinto nombra a Juan', async () => {
    const bytes = MULTI();
    const ops = matchingOps(bytes);
    ops[1] = { ...ops[1]!, amount: '999.00000' };
    const r = await verifyPayment({ fileBytes: bytes, txHash: HASH, horizon: mockHorizon({ tx: { memo: await memoFor(bytes) }, ops }) });
    expect(r.kind).toBe('payment_mismatch');
    if (r.kind === 'payment_mismatch') {
      expect(r.mismatch).toBe('amount');
      expect(r.transfer.creditorName).toBe('Juan Pérez López');
    }
  });
});

describe('parseo del pain.001', () => {
  it('lee la dirección del productor, el monto en token y el activo', () => {
    const p = parsePain001(dec.decode(SINGLE()));
    expect(p.transfers).toHaveLength(1);
    const t = p.transfers[0]!;
    expect(t.creditorAddress).toBe('GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON');
    expect(t.creditorName).toBe('Juan Pérez López');
    expect(t.amountMxn).toBe('15400.00');
    expect(t.settlement.assetCode).toBe('USDC');
    expect(t.settlement.tokenAmount).toBe('836.64627');
    expect(t.document.duePayable).toBe('21250.00');
    expect(t.document.adjustments).toHaveLength(2);
    expect(t.document.adjustments[0]!.reason).toBe('HUME');
  });

  it('lee kilos y precio de la descripción de la línea', () => {
    const p = parsePain001(dec.decode(SINGLE()));
    const line = p.transfers[0]!.document.lines[0]!;
    expect(line.quantity).toBe('250.00');
    expect(line.unit).toBe('kg');
    expect(line.unitPrice).toBe('85.00');
  });

  it('lee pain.001 con nombres de elemento prefijados', () => {
    const xml = dec.decode(SINGLE())
      .replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s>])/g, (_match, slash: string, name: string) => `<${slash}p:${name}`)
      .replace('<p:Document ', '<p:Document xmlns:p="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" ');
    const parsed = parsePain001(xml);
    expect(parsed.transfers[0]!.creditorAddress).toBe('GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON');
    expect(parsed.transfers[0]!.settlement.tokenAmount).toBe('836.64627');
  });
});

describe('helpers', () => {
  it('sha256Hex coincide con SHA-256 del archivo', async () => {
    const bytes = SINGLE();
    // known sha256 of the single fixture
    expect(await sha256Hex(bytes)).toBe('0d9731d4b459cc343aefb0b0ca5800768e7925dbbff54b3932b0cadf6e00b41c');
  });

  it('base64ToHex invierte el memo', () => {
    expect(base64ToHex('aGVsbG8=')).toBe('68656c6c6f');
  });

  it('parseTxInput acepta hash y enlace de stellar.expert', () => {
    const h = 'abcdef0123456789'.repeat(4);
    expect(parseTxInput(h)).toBe(h);
    expect(parseTxInput(`https://stellar.expert/explorer/testnet/tx/${h}`)).toBe(h);
    expect(parseTxInput(`https://stellar.expert/explorer/public/tx/${h}`)).toBe(h);
    expect(parseTxInput(h.toUpperCase())).toBe(h);
    expect(parseTxInput('no es un hash')).toBeNull();
    expect(parseTxInput(`https://not-stellar.expert/explorer/testnet/tx/${h}`)).toBeNull();
    expect(parseTxInput(`prefijo-${h}-sufijo`)).toBeNull();
  });
});
