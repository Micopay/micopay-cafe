import { Asset, Keypair } from '@stellar/stellar-sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = fileURLToPath(new URL('../../../data/', import.meta.url));
export const KEYS_FILE = `${DATA_DIR}testnet-keys.json`;
export const PG_DIR = `${DATA_DIR}pg`;

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
