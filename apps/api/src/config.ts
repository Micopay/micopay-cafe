import { Asset, Keypair } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** CAFE_DATA_DIR moves the database and keys, e.g. to start a clean demo next to an archived one. */
export const DATA_DIR = process.env.CAFE_DATA_DIR
  ? join(process.env.CAFE_DATA_DIR, '/')
  : fileURLToPath(new URL('../../../data/', import.meta.url));
export const KEYS_FILE = `${DATA_DIR}testnet-keys.json`;
export const PG_DIR = `${DATA_DIR}pg`;
const LOCK_FILE = `${DATA_DIR}api.lock`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Exclusive use of the data directory: the API and the review command never run
 * at the same time, because the in-memory payment locks live in one process.
 * A lock left by a process that no longer exists is taken over.
 */
export function acquireDataLock(owner: string): () => void {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(LOCK_FILE)) {
    const held = JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as { pid: number; owner: string };
    if (held.pid !== process.pid && alive(held.pid)) {
      throw new Error(`${DATA_DIR} está en uso por ${held.owner} (pid ${held.pid}); detenlo primero`);
    }
  }
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, owner }));
  return () => rmSync(LOCK_FILE, { force: true });
}

/** Testnet-only keys written by the seed script. Never real funds. */
export interface TestnetKeys {
  issuer: string;
  cooperative: string;
  lender: string;
  /** Additional demo lenders that can sign disbursements locally. */
  extraLenders?: string[];
  /** Producer secrets keyed by account id or address (demo only; the platform never uses them). */
  producers: Record<string, string>;
  /** Settlement token. The demo uses MicoPay's testnet USDC so the MicoPay app shows it. */
  asset?: { code: string; issuer: string };
}

export function loadKeys(): TestnetKeys {
  if (!existsSync(KEYS_FILE)) throw new Error('No hay llaves de testnet. Corre primero: npm run seed -w apps/api');
  return JSON.parse(readFileSync(KEYS_FILE, 'utf8')) as TestnetKeys;
}

export function saveKeys(keys: TestnetKeys): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

export function settlementAsset(keys: TestnetKeys): Asset {
  if (!keys.asset) throw new Error('testnet-keys.json no tiene el activo de liquidación; corre de nuevo el seed');
  return new Asset(keys.asset.code, keys.asset.issuer);
}

/** ISO 4217 currency the settlement token is worth (USDC → USD). */
export const TOKEN_CCY: Record<string, string> = { USDC: 'USD' };
