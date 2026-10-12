import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, StrKey, Transaction, TransactionBuilder,
} from '@stellar/stellar-sdk';

export const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const horizon = new Horizon.Server(HORIZON_URL);

export function explorerTx(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

export function isStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

export interface RunPayment {
  destination: string;
  amount: string;
}

/**
 * One atomic transaction with N payments: they all settle or none does.
 * Payment runs use it so a producer can never be paid while the loan
 * repayment is skipped; disbursements use it with a single payment.
 *
 * The memo carries a SHA-256 of the document behind the movement (the
 * pain.001 of a run, the canonical terms of a credit), so the off-chain record
 * and the ledger point at each other.
 */
export async function buildPaymentTransaction(params: {
  source: string;
  asset: Asset;
  payments: RunPayment[];
  memoSha256: string;
}): Promise<Transaction> {
  if (params.payments.length === 0) throw new Error('la transacción no tiene pagos');
  if (params.payments.length > 100) throw new Error('una transacción admite hasta 100 operaciones');
  const account = await horizon.loadAccount(params.source);
  const builder = new TransactionBuilder(account, { fee: '1000', networkPassphrase: NETWORK_PASSPHRASE })
    .addMemo(Memo.hash(params.memoSha256))
    .setTimeout(300);
  for (const p of params.payments) {
    builder.addOperation(Operation.payment({ destination: p.destination, asset: params.asset, amount: p.amount }));
  }
  return builder.build();
}

/** Whether an address exists on the network and can hold `asset` (trustline). */
export async function accountStatus(address: string, asset: Asset): Promise<'ok' | 'sin_cuenta' | 'sin_trustline'> {
  try {
    const account = await horizon.loadAccount(address);
    const has = account.balances.some((b) => 'asset_code' in b && b.asset_code === asset.getCode() && 'asset_issuer' in b && b.asset_issuer === asset.getIssuer());
    return has ? 'ok' : 'sin_trustline';
  } catch {
    return 'sin_cuenta';
  }
}

/**
 * Who authorizes the payment. The demo signs with a local testnet key; the
 * production path sends the XDR to the cooperative's MicoPay app via /sign-requests.
 */
export interface Signer {
  readonly kind: 'local' | 'micopay';
  sign(tx: Transaction): Promise<Transaction>;
}

export class LocalSigner implements Signer {
  readonly kind = 'local' as const;
  constructor(private readonly keypair: Keypair) {}
  async sign(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }
}

/**
 * Signs from the cooperative's MicoPay app through the MicoPay backend's
 * /sign-requests (device-key authenticated, push to the app, approval screen).
 *
 * Requires the backend to return `signed_xdr` from GET /sign-requests/:id once
 * signed — today it only returns { txid, account }, and nobody submits the
 * transaction, so the platform must receive the XDR to send it to Horizon.
 */
export class MicopaySigner implements Signer {
  readonly kind = 'micopay' as const;
  constructor(private readonly opts: { apiUrl: string; deviceKey: string; identifier: string; timeoutMs?: number; pollMs?: number }) {}

  async sign(tx: Transaction): Promise<Transaction> {
    const headers = { authorization: `Bearer ${this.opts.deviceKey}`, 'content-type': 'application/json' };
    const created = await fetch(`${this.opts.apiUrl}/sign-requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        txxdr: tx.toXDR(),
        identifier: this.opts.identifier,
        instruction: 'MicoPay Café: pagar corrida a productores',
        kind: 'transaction',
        expire_minutes: 5,
      }),
    });
    if (!created.ok) throw new Error(`MicoPay no aceptó la solicitud de firma (${created.status})`);
    const { id } = (await created.json()) as { id: string };

    const deadline = Date.now() + (this.opts.timeoutMs ?? 5 * 60_000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.opts.pollMs ?? 2000));
      const res = await fetch(`${this.opts.apiUrl}/sign-requests/${id}`, { headers });
      if (!res.ok) continue;
      const s = (await res.json()) as { resolved: boolean; signed: boolean; cancelled: boolean; expired: boolean; signed_xdr?: string };
      if (!s.resolved) continue;
      if (s.signed && s.signed_xdr) return TransactionBuilder.fromXDR(s.signed_xdr, NETWORK_PASSPHRASE) as Transaction;
      if (s.signed) throw new Error('La app firmó, pero el backend de MicoPay no devuelve signed_xdr');
      throw new Error(s.cancelled ? 'La firma se rechazó en la app de MicoPay' : 'La solicitud de firma expiró');
    }
    throw new Error('No llegó la firma de la app de MicoPay a tiempo');
  }
}

export interface SubmitResult {
  successful: boolean;
  hash: string;
  code?: string;
}

export async function submit(tx: Transaction): Promise<SubmitResult> {
  try {
    const res = await horizon.submitTransaction(tx);
    return { successful: res.successful, hash: res.hash };
  } catch (err: unknown) {
    const codes = (err as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } })
      .response?.data?.extras?.result_codes;
    const op = codes?.operations?.find((c) => c !== 'op_success');
    return { successful: false, hash: tx.hash().toString('hex'), code: op ?? codes?.transaction ?? 'tx_failed' };
  }
}

export async function assetBalance(address: string, asset: Asset): Promise<string | null> {
  try {
    const account = await horizon.loadAccount(address);
    const line = account.balances.find(
      (b) => 'asset_code' in b && b.asset_code === asset.getCode() && 'asset_issuer' in b && b.asset_issuer === asset.getIssuer(),
    );
    return line ? line.balance : null;
  } catch {
    return null;
  }
}
