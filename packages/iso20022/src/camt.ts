import {
  accountNode, amount, assertMax35, currency, isoDate, isoDateTime, partyNode,
  settlementNode, type Account, type Party, type SettlementInfo,
} from './common.js';
import { documentXml, el, opt, type Node } from './xml.js';

export const CAMT054_NS = 'urn:iso:std:iso:20022:tech:xsd:camt.054.001.08';
export const CAMT053_NS = 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08';

/** One ledger movement seen from the account holder's side. */
export interface Entry {
  amount: string;
  /** CRDT = money in (producer receipt), DBIT = money out (cooperative payment). */
  direction: 'CRDT' | 'DBIT';
  bookedAt: Date;
  endToEndId: string;
  uetr: string;
  instrId?: string;
  debtor: Party;
  creditor: Party;
  /** Short human summary, e.g. "Liquidación ENT-2026-000123 · 250 kg café pergamino". */
  remittance?: string;
  settlement: SettlementInfo;
}

function entryNode(e: Entry, ccy: string): Node {
  // PMNT / RCDT|ICDT / DMCT: received or issued domestic credit transfer.
  const family = e.direction === 'CRDT' ? 'RCDT' : 'ICDT';
  return el('Ntry', [
    el('Amt', amount(e.amount), { Ccy: ccy }),
    el('CdtDbtInd', e.direction),
    el('Sts', [el('Cd', 'BOOK')]),
    el('BookgDt', [el('DtTm', isoDateTime(e.bookedAt))]),
    el('ValDt', [el('DtTm', isoDateTime(e.bookedAt))]),
    el('BkTxCd', [
      el('Domn', [el('Cd', 'PMNT'), el('Fmly', [el('Cd', family), el('SubFmlyCd', 'DMCT')])]),
    ]),
    el('NtryDtls', [
      el('TxDtls', opt(
        el('Refs', opt(
          e.instrId ? el('InstrId', assertMax35(e.instrId, 'InstrId')) : null,
          el('EndToEndId', assertMax35(e.endToEndId, 'EndToEndId')),
          el('UETR', e.uetr),
        )),
        el('Amt', amount(e.amount), { Ccy: ccy }),
        el('CdtDbtInd', e.direction),
        el('RltdPties', [
          el('Dbtr', [partyNode('Pty', e.debtor.name)]),
          accountNode('DbtrAcct', e.debtor.account),
          el('Cdtr', [partyNode('Pty', e.creditor.name)]),
          accountNode('CdtrAcct', e.creditor.account),
        ]),
        e.remittance ? el('RmtInf', [el('Ustrd', e.remittance.slice(0, 140))]) : null,
        settlementNode(e.settlement),
      )),
    ]),
  ]);
}

export interface Notification {
  msgId: string;
  notificationId: string;
  createdAt: Date;
  account: Account;
  accountOwner: string;
  currency: string;
  entries: Entry[];
}

/** camt.054: per-payment advice — the producer's receipt (CRDT) or the cooperative's debit advice (DBIT). */
export function buildCamt054(n: Notification): string {
  const ccy = currency(n.currency);
  return documentXml(
    CAMT054_NS,
    el('BkToCstmrDbtCdtNtfctn', [
      el('GrpHdr', [el('MsgId', assertMax35(n.msgId, 'MsgId')), el('CreDtTm', isoDateTime(n.createdAt))]),
      el('Ntfctn', [
        el('Id', assertMax35(n.notificationId, 'Ntfctn/Id')),
        el('CreDtTm', isoDateTime(n.createdAt)),
        accountWithOwner(n.account, n.accountOwner, ccy),
        ...n.entries.map((e) => entryNode(e, ccy)),
      ]),
    ]),
  );
}

function accountWithOwner(account: Account, owner: string, ccy: string): Node {
  const acct = accountNode('Acct', account);
  // CashAccount39: Id, Tp?, Ccy?, Nm?, Prxy?, Ownr?, Svcr?
  const [id, prxy] = acct.children!;
  return el('Acct', opt(id, el('Ccy', ccy), prxy, el('Ownr', [el('Nm', owner.slice(0, 140))])));
}

export interface Statement {
  msgId: string;
  statementId: string;
  createdAt: Date;
  from: Date;
  to: Date;
  account: Account;
  accountOwner: string;
  currency: string;
  /** Balances read from the ledger at `from` and `to` — never derived from "current balance". */
  openingBalance: string;
  closingBalance: string;
  entries: Entry[];
}

function balanceNode(code: 'OPBD' | 'CLBD', value: string, ccy: string, date: Date): Node {
  const negative = value.startsWith('-');
  return el('Bal', [
    el('Tp', [el('CdOrPrtry', [el('Cd', code)])]),
    el('Amt', amount(negative ? value.slice(1) : value), { Ccy: ccy }),
    el('CdtDbtInd', negative ? 'DBIT' : 'CRDT'),
    el('Dt', [el('Dt', isoDate(date))]),
  ]);
}

function toCents(v: string): bigint {
  const neg = v.startsWith('-');
  const [i, f = ''] = (neg ? v.slice(1) : v).split('.');
  const c = BigInt(i!) * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -c : c;
}

/**
 * camt.053: end-of-period statement of one account.
 * Rejects statements whose entries do not reconcile opening → closing.
 */
export function buildCamt053(s: Statement): string {
  const ccy = currency(s.currency);
  const movement = s.entries.reduce((acc, e) => acc + (e.direction === 'CRDT' ? 1n : -1n) * toCents(amount(e.amount)), 0n);
  if (toCents(s.openingBalance) + movement !== toCents(s.closingBalance)) {
    throw new Error(`statement does not reconcile: ${s.openingBalance} + movements ≠ ${s.closingBalance}`);
  }
  return documentXml(
    CAMT053_NS,
    el('BkToCstmrStmt', [
      el('GrpHdr', [el('MsgId', assertMax35(s.msgId, 'MsgId')), el('CreDtTm', isoDateTime(s.createdAt))]),
      el('Stmt', [
        el('Id', assertMax35(s.statementId, 'Stmt/Id')),
        el('CreDtTm', isoDateTime(s.createdAt)),
        el('FrToDt', [el('FrDtTm', isoDateTime(s.from)), el('ToDtTm', isoDateTime(s.to))]),
        accountWithOwner(s.account, s.accountOwner, ccy),
        balanceNode('OPBD', s.openingBalance, ccy, s.from),
        balanceNode('CLBD', s.closingBalance, ccy, s.to),
        ...s.entries.map((e) => entryNode(e, ccy)),
      ]),
    ]),
  );
}
