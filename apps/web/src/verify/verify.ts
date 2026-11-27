/**
 * Verification that a pain.001 document matches the money that moved on Stellar.
 *
 * The link between the two layers is a fingerprint: the SHA-256 of the pain.001's
 * exact bytes is the transaction's memo (Memo.hash, which Horizon returns base64).
 * The payment itself moves a token (USDC) to the producer's Stellar address, and
 * the document records that address and token amount in SplmtryData.
 *
 * Everything here is browser-side: only the transaction hash leaves the browser, to
 * the public Horizon of the configured network. The file never touches MicoPay's
 * API. Horizon access goes through a HorizonClient so the unit tests can stand in
 * for the network.
 */

import type { ParsedPain001, ParsedTransfer } from './pain001Parser.js';
import { parsePain001 } from './pain001Parser.js';

export { parsePain001 };
export type { ParsedPain001, ParsedTransfer, ParsedLine, ParsedAdjustment, ParsedDocument, ParsedSettlement } from './pain001Parser.js';

/** Public Horizon endpoints by network, matching what the API reports. */
export const HORIZON_URL: Record<'TESTNET' | 'PUBLIC', string> = {
  TESTNET: 'https://horizon-testnet.stellar.org',
  PUBLIC: 'https://horizon.stellar.org',
};

/** What the verification page asks of Horizon. Mocked in tests. */
export interface HorizonResponse {
  status: number;
  body: unknown;
}
export interface HorizonClient {
  getTransaction(hash: string): Promise<HorizonResponse>;
  getOperations(hash: string): Promise<HorizonResponse>;
}

interface HorizonTx {
  memo_type?: string | null;
  memo?: string | null;
  successful?: boolean;
}
interface HorizonOp {
  type: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string | null;
  asset_issuer?: string | null;
}

/** Default client: fetch against a public Horizon. */
export function fetchHorizon(baseUrl: string): HorizonClient {
  const get = async (path: string): Promise<HorizonResponse> => {
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(30_000) });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };
  return {
    getTransaction: (hash) => get(`/transactions/${hash}`),
    getOperations: (hash) => get(`/transactions/${hash}/operations?limit=200&order=asc`),
  };
}

/* ── primitives ──────────────────────────────────────────────────────────── */

/** SHA-256 of the file's exact bytes, hex. Runs on crypto.subtle, in the browser. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Horizon's memo comes base64; turn it into hex to compare with the file hash. */
export function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let hex = '';
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

/**
 * Accepts a bare 64-char hex transaction hash, or a stellar.expert link that
 * contains one (e.g. https://stellar.expert/explorer/testnet/tx/<hash>). Returns
 * the lowercase hash, or null if there is no 64-hex run.
 */
export function parseTxInput(input: string): string | null {
  const value = input.trim();
  if (/^[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  try {
    const url = new URL(value);
    if (url.hostname !== 'stellar.expert') return null;
    const match = url.pathname.match(/^\/explorer\/(?:testnet|public)\/tx\/([a-fA-F0-9]{64})\/?$/);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** A decimal string with no trailing/leading zeros, so "836.6462700" == "836.64627". */
function normDecimal(s: string): string {
  let [int = '', frac = ''] = s.split('.');
  int = int.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  const out = frac ? `${int || '0'}.${frac}` : (int || '0');
  return out;
}

function sameAmount(a: string, b: string): boolean {
  return normDecimal(a) === normDecimal(b);
}

function assetMatch(op: HorizonOp, code: string | null, issuer: string | null): boolean {
  return op.asset_code === code && op.asset_issuer === issuer;
}

/* ── result ──────────────────────────────────────────────────────────────── */

export type VerificationResult =
  | { kind: 'verified'; fileSha256: string; txHash: string; parsed: ParsedPain001 }
  | { kind: 'fingerprint_mismatch'; fileSha256: string; memoHex: string; parsed: ParsedPain001 }
  | { kind: 'memo_not_hash'; memoType: string; parsed: ParsedPain001 }
  | { kind: 'tx_unsuccessful'; parsed: ParsedPain001 }
  | { kind: 'payment_mismatch'; transfer: ParsedTransfer; mismatch: 'settlement' | 'address' | 'amount' | 'asset'; expected: string; found: string; parsed: ParsedPain001 }
  | { kind: 'tx_not_found'; parsed: ParsedPain001 }
  | { kind: 'parse_error'; message: string }
  | { kind: 'error'; reason: 'network' | 'response' | 'http'; status?: number; parsed?: ParsedPain001 };

export interface VerifyInput {
  /** Exact bytes of the pain.001 file. Hashed for the fingerprint. */
  fileBytes: Uint8Array<ArrayBuffer>;
  /** The transaction hash (already parsed to 64-char hex). */
  txHash: string;
  horizon: HorizonClient;
}

/**
 * Run the full check. Returns the first problem found, or `verified` when the
 * fingerprint matches and every transfer that moves money has its payment.
 */
export async function verifyPayment(input: VerifyInput): Promise<VerificationResult> {
  let parsed: ParsedPain001;
  try {
    parsed = parsePain001(new TextDecoder().decode(input.fileBytes));
  } catch (e) {
    return { kind: 'parse_error', message: (e as Error).message };
  }

  const fileSha256 = await sha256Hex(input.fileBytes);

  let txRes: HorizonResponse;
  try {
    txRes = await input.horizon.getTransaction(input.txHash);
  } catch {
    return { kind: 'error', reason: 'network', parsed };
  }
  if (txRes.status === 404) return { kind: 'tx_not_found', parsed };
  if (txRes.status !== 200) return { kind: 'error', reason: 'http', status: txRes.status, parsed };

  const tx = txRes.body as HorizonTx | null;
  if (!tx || typeof tx.successful !== 'boolean' || tx.memo_type == null) {
    return { kind: 'error', reason: 'response', parsed };
  }

  // Fingerprint: the memo must be a hash, and its bytes must equal the file hash.
  if (tx.memo_type !== 'hash' || !tx.memo) return { kind: 'memo_not_hash', memoType: tx.memo_type, parsed };
  let memoHex: string;
  try {
    memoHex = base64ToHex(tx.memo);
  } catch {
    return { kind: 'error', reason: 'response', parsed };
  }
  if (memoHex.length !== 64) return { kind: 'error', reason: 'response', parsed };
  if (memoHex !== fileSha256) return { kind: 'fingerprint_mismatch', fileSha256, memoHex, parsed };

  // A failed transaction carried the memo but moved no money.
  if (!tx.successful) return { kind: 'tx_unsuccessful', parsed };

  // Payments: every transfer that moves a token must have its payment operation.
  let opsRes: HorizonResponse;
  try {
    opsRes = await input.horizon.getOperations(input.txHash);
  } catch {
    return { kind: 'error', reason: 'network', parsed };
  }
  if (opsRes.status !== 200) return { kind: 'error', reason: 'http', status: opsRes.status, parsed };
  const opsBody = opsRes.body as { _embedded?: { records?: HorizonOp[] } } | null;
  const records = opsBody?._embedded?.records;
  if (!Array.isArray(records) || records.some((op) => !op || typeof op.type !== 'string')) {
    return { kind: 'error', reason: 'response', parsed };
  }
  const ops = records.filter((o) => o.type === 'payment');

  const used = new Set<number>();
  for (const transfer of parsed.transfers) {
    const tokenAmount = transfer.settlement.tokenAmount;
    if (!tokenAmount || !Number.isFinite(Number(tokenAmount)) || Number(tokenAmount) <= 0) {
      return { kind: 'payment_mismatch', transfer, mismatch: 'settlement', expected: 'positive token amount', found: tokenAmount ?? 'missing', parsed };
    }
    if (!transfer.settlement.assetCode || !transfer.settlement.assetIssuer) {
      return {
        kind: 'payment_mismatch', transfer, mismatch: 'asset',
        expected: 'asset code and issuer',
        found: `${transfer.settlement.assetCode ?? ''}:${transfer.settlement.assetIssuer ?? ''}`,
        parsed,
      };
    }
    if (!transfer.creditorAddress) {
      return { kind: 'payment_mismatch', transfer, mismatch: 'address', expected: 'STELLAR creditor address', found: 'missing', parsed };
    }
    const exact = ops.findIndex((op, i) => !used.has(i) && op.to === transfer.creditorAddress && sameAmount(op.amount ?? '', tokenAmount) && assetMatch(op, transfer.settlement.assetCode, transfer.settlement.assetIssuer));
    if (exact >= 0) { used.add(exact); continue; }

    // Diagnose which part of the match failed, naming the transfer.
    const addr = ops.findIndex((op, i) => !used.has(i) && op.to === transfer.creditorAddress);
    if (addr < 0) {
      return { kind: 'payment_mismatch', transfer, mismatch: 'address', expected: transfer.creditorAddress ?? '', found: '', parsed };
    }
    const op = ops[addr]!;
    if (!sameAmount(op.amount ?? '', tokenAmount)) {
      return { kind: 'payment_mismatch', transfer, mismatch: 'amount', expected: tokenAmount, found: op.amount ?? '', parsed };
    }
    return {
      kind: 'payment_mismatch', transfer, mismatch: 'asset',
      expected: `${transfer.settlement.assetCode ?? ''}:${transfer.settlement.assetIssuer ?? ''}`,
      found: `${op.asset_code ?? ''}:${op.asset_issuer ?? ''}`, parsed,
    };
  }
  return { kind: 'verified', fileSha256, txHash: input.txHash, parsed };
}
