import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicopaySigner } from '../src/stellar.js';

const coop = Keypair.random();

function unsignedTx(): Transaction {
  return new TransactionBuilder(new Account(coop.publicKey(), '1'), { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(300)
    .build();
}

/** Fake MicoPay backend: POST creates the request, GET answers with `poll` once. */
function fakeBackend(poll: (tx: Transaction) => Record<string, unknown>) {
  let posted: Transaction | null = null;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'POST') {
      posted = TransactionBuilder.fromXDR(JSON.parse(String(init.body)).txxdr, Networks.TESTNET) as Transaction;
      return new Response(JSON.stringify({ id: 'req-1', pushed: true }), { status: 200 });
    }
    return new Response(JSON.stringify(poll(posted!)), { status: 200 });
  });
  return calls;
}

const signer = () => new MicopaySigner({ apiUrl: 'https://api.test', deviceKey: 'dk', identifier: 'coop_los_altos', pollMs: 1, timeoutMs: 2000 });

afterEach(() => vi.unstubAllGlobals());

describe('MicopaySigner', () => {
  it('manda el XDR con la device key y devuelve la transacción firmada por la app', async () => {
    const calls = fakeBackend((tx) => {
      tx.sign(coop); // what the phone does
      return { resolved: true, signed: true, cancelled: false, expired: false, signed_xdr: tx.toXDR() };
    });
    const signed = await signer().sign(unsignedTx());
    expect(signed.signatures).toHaveLength(1);
    expect(coop.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(true);
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer dk');
    expect(JSON.parse(String(calls[0]!.init!.body)).identifier).toBe('coop_los_altos');
  });

  it('falla claro si el backend no devuelve signed_xdr', async () => {
    fakeBackend(() => ({ resolved: true, signed: true, cancelled: false, expired: false, txid: 'abc' }));
    await expect(signer().sign(unsignedTx())).rejects.toThrow(/signed_xdr/);
  });

  it('propaga el rechazo hecho en la app', async () => {
    fakeBackend(() => ({ resolved: true, signed: false, cancelled: true, expired: false }));
    await expect(signer().sign(unsignedTx())).rejects.toThrow(/rechazó/);
  });
});
