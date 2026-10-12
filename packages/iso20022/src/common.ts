import { el, opt, type Node } from './xml.js';

/** Namespace of the single element we place inside SplmtryData/Envlp. */
export const SETTLEMENT_NS = 'urn:micopay:cafe:stellar-settlement:1';

/** ISO 20022 Max35Text identifiers (MsgId, PmtInfId, InstrId, EndToEndId...). */
export function assertMax35(value: string, field: string): string {
  if (value.length < 1 || value.length > 35) throw new Error(`${field} must be 1-35 characters, got ${value.length}`);
  return value;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Short, unique, readable reference: PREFIX-YYYYMMDD-XXXXXXXXXX (Crockford base32).
 * The full UUID belongs only in <UETR>; every other identifier is Max35Text.
 */
export function shortRef(prefix: string, now = new Date()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const rand = Array.from(bytes, (b) => CROCKFORD[b % 32]).join('');
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return assertMax35(`${prefix}-${day}-${rand}`, 'reference');
}

export function isoDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;

/** Amounts travel as decimal strings: never floats. MXN has 2 minor units. */
export function amount(value: string, field = 'amount'): string {
  if (!AMOUNT_RE.test(value)) throw new Error(`${field} must be a decimal string with up to 2 decimals, got "${value}"`);
  return value;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

/** ISO 4217 only. Tokens (MXNe, USDC) are described in the settlement envelope, never here. */
export function currency(code: string): string {
  if (!CURRENCY_RE.test(code) || ['XRP', 'XLM'].includes(code)) throw new Error(`"${code}" is not an ISO 4217 currency`);
  return code;
}

export interface Account {
  /** Short platform account identifier, Max34Text (Othr/Id). */
  id: string;
  /** Full Stellar address G... (56 chars). Goes in Prxy/Id (Max2048Text). */
  stellarAddress: string;
}

export interface Party {
  name: string;
  account: Account;
}

export function accountNode(tag: string, account: Account): Node {
  if (account.id.length < 1 || account.id.length > 34) throw new Error(`account id must be 1-34 characters`);
  if (!/^G[A-Z2-7]{55}$/.test(account.stellarAddress)) throw new Error(`invalid Stellar address ${account.stellarAddress}`);
  return el(tag, [
    el('Id', [el('Othr', [el('Id', account.id)])]),
    el('Prxy', [el('Tp', [el('Prtry', 'STELLAR')]), el('Id', account.stellarAddress)]),
  ]);
}

export function partyNode(tag: string, name: string): Node {
  return el(tag, [el('Nm', name.slice(0, 140))]);
}

/** The ledger plays the role of the account servicer; it is not a bank. */
export function stellarAgentNode(tag: string): Node {
  return el(tag, [el('FinInstnId', [el('Nm', 'Stellar Network'), el('Othr', [el('Id', 'STELLAR')])])]);
}

export interface SettlementInfo {
  network: 'TESTNET' | 'PUBLIC';
  assetCode: string;
  assetIssuer?: string;
  txHash?: string;
  /** ISO 24165 Digital Token Identifier, when known. */
  dti?: string;
}

/** SplmtryData/Envlp admits exactly one child element, so everything goes in one wrapper. */
export function settlementNode(s: SettlementInfo): Node {
  return el('SplmtryData', [
    el('PlcAndNm', 'StellarSettlement'),
    el('Envlp', [
      el(
        'StellarSettlement',
        opt(
          el('Network', s.network),
          el('Asset', null, { code: s.assetCode, ...(s.assetIssuer ? { issuer: s.assetIssuer } : {}) }),
          s.dti ? el('DTI', s.dti) : null,
          s.txHash ? el('TxHash', s.txHash) : null,
        ),
        { xmlns: SETTLEMENT_NS },
      ),
    ]),
  ]);
}
