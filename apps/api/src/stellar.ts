import {
  Account, Asset, Horizon, Keypair, Memo, Networks, Operation, StrKey, Transaction, TransactionBuilder, xdr,
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
export function buildPaymentTransaction(params: {
  account: Account;
  asset: Asset;
  payments: RunPayment[];
  memoSha256: string;
}): Transaction {
  if (params.payments.length === 0) throw new Error('la transacción no tiene pagos');
  if (params.payments.length > 100) throw new Error('una transacción admite hasta 100 operaciones');
  const builder = new TransactionBuilder(params.account, { fee: '1000', networkPassphrase: NETWORK_PASSPHRASE })
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

/* ── What Horizon can prove ─────────────────────────────────────────────── */

/**
 * The outcome of one POST. Only a 200 that names the expected hash and a ledger
 * proves anything; every other answer (any 400 code, timeouts, 5xx) is unknown,
 * because none of them proves the envelope never made it into a ledger.
 */
export type SubmitOutcome =
  | { kind: 'success'; hash: string; ledger: number }
  | { kind: 'unknown'; code?: string };

/** A transaction record as Horizon stores it once it is in a ledger. */
export type Lookup =
  | { kind: 'found'; hash: string; ledger: number; successful: boolean; closedAt: Date; resultCode: string }
  | { kind: 'not_found' }
  | { kind: 'error' };

export interface ChainTip {
  networkPassphrase: string;
  latestLedger: number;
  latestClosedAt: Date;
}

/** Everything the payment flow asks of the network, so tests can stand in for Horizon. */
export interface Chain {
  loadAccount(address: string): Promise<Account>;
  tip(): Promise<ChainTip>;
  ledgerClosedAt(seq: number): Promise<Date>;
  submit(tx: Transaction): Promise<SubmitOutcome>;
  lookup(hash: string): Promise<Lookup>;
}

const isLedger = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** Readable failure code from a transaction result: the first failed operation, else the transaction code. */
export function resultCode(resultXdr: string): string {
  try {
    const result = xdr.TransactionResult.fromXDR(resultXdr, 'base64').result();
    const tx = result.switch().name;
    if (tx === 'txFailed') {
      for (const op of result.results()) {
        const inner = op.switch().name === 'opInner' ? op.tr().value() : null;
        const name = inner ? (inner as { switch(): { name: string } }).switch().name : op.switch().name;
        if (!/Success$/.test(name)) return name;
      }
    }
    return tx;
  } catch {
    return 'resultado ilegible';
  }
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export class HorizonChain implements Chain {
  constructor(private readonly url = HORIZON_URL) {}

  loadAccount(address: string): Promise<Account> {
    return new Horizon.Server(this.url).loadAccount(address);
  }

  async tip(): Promise<ChainTip> {
    const { status, body } = await getJson(`${this.url}/`);
    const b = body as { network_passphrase?: string; history_latest_ledger?: number; history_latest_ledger_closed_at?: string } | null;
    if (status !== 200 || !b?.network_passphrase || !isLedger(b.history_latest_ledger) || !b.history_latest_ledger_closed_at) {
      throw new Error(`Horizon no devolvió el último ledger (${status})`);
    }
    return { networkPassphrase: b.network_passphrase, latestLedger: b.history_latest_ledger, latestClosedAt: new Date(b.history_latest_ledger_closed_at) };
  }

  async ledgerClosedAt(seq: number): Promise<Date> {
    const { status, body } = await getJson(`${this.url}/ledgers/${seq}`);
    const b = body as { sequence?: number; closed_at?: string } | null;
    if (status !== 200 || b?.sequence !== seq || !b.closed_at) throw new Error(`Horizon no devolvió el ledger ${seq} (${status})`);
    return new Date(b.closed_at);
  }

  async submit(tx: Transaction): Promise<SubmitOutcome> {
    const expected = tx.hash().toString('hex');
    try {
      const res = await fetch(`${this.url}/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: tx.toEnvelope().toXDR('base64') }),
        // Horizon answers a synchronous submission within about a minute.
        signal: AbortSignal.timeout(75_000),
      });
      const body = (await res.json().catch(() => null)) as {
        hash?: string; ledger?: number; successful?: boolean;
        extras?: { result_codes?: { transaction?: string; operations?: string[] } };
      } | null;
      if (res.status === 200 && body?.successful === true && body.hash === expected && isLedger(body.ledger)) {
        return { kind: 'success', hash: expected, ledger: body.ledger };
      }
      const codes = body?.extras?.result_codes;
      return { kind: 'unknown', code: codes?.operations?.find((c) => c !== 'op_success') ?? codes?.transaction ?? `http_${res.status}` };
    } catch (err) {
      return { kind: 'unknown', code: (err as Error).name === 'TimeoutError' ? 'timeout' : 'red' };
    }
  }

  async lookup(hash: string): Promise<Lookup> {
    try {
      const { status, body } = await getJson(`${this.url}/transactions/${hash}`);
      if (status === 404) return { kind: 'not_found' };
      const b = body as { hash?: string; ledger?: number; successful?: unknown; created_at?: string; result_xdr?: string } | null;
      if (status !== 200 || b?.hash !== hash || !isLedger(b.ledger) || typeof b.successful !== 'boolean' || !b.created_at) {
        return { kind: 'error' };
      }
      return {
        kind: 'found', hash, ledger: b.ledger, successful: b.successful, closedAt: new Date(b.created_at),
        resultCode: b.result_xdr ? resultCode(b.result_xdr) : 'sin resultado',
      };
    } catch {
      return { kind: 'error' };
    }
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
