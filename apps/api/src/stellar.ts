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
 * One atomic transaction per payment run: every producer payment and every credit
 * repayment succeed together or none does. A producer can never be paid while the
 * repayment to the lender is skipped.
 *
 * The memo carries the SHA-256 of the pain.001 that ordered the run, so the ISO
 * instruction and the ledger movement point at each other.
 */
export async function buildRunTransaction(params: {
  source: string;
  asset: Asset;
  payments: RunPayment[];
  pain001Sha256: string;
}): Promise<Transaction> {
  if (params.payments.length === 0) throw new Error('la corrida no tiene pagos');
  if (params.payments.length > 100) throw new Error('una transacción admite hasta 100 operaciones; parte la corrida');
  const account = await horizon.loadAccount(params.source);
  const builder = new TransactionBuilder(account, { fee: '1000', networkPassphrase: NETWORK_PASSPHRASE })
    .addMemo(Memo.hash(params.pain001Sha256))
    .setTimeout(300);
  for (const p of params.payments) {
    builder.addOperation(Operation.payment({ destination: p.destination, asset: params.asset, amount: p.amount }));
  }
  return builder.build();
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
