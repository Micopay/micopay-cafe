import {
  accountNode, amount, assertMax35, currency, isoDate, isoDateTime, partyNode,
  settlementNode, stellarAgentNode, type Party, type SettlementInfo,
} from './common.js';
import { documentXml, el, opt, type Node } from './xml.js';

export const PAIN001_NS = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09';

/** One line of the settlement document: a lot or a product delivered. */
export interface DocumentLine {
  id: string;
  /** Human-readable quantity and unit price, e.g. "Café pergamino · 250.00 kg × 85.00 MXN/kg". */
  description: string;
  amount: string;
}

export interface Adjustment {
  amount: string;
  /** Short reason code, e.g. HUMEDAD, ABONO_CREDITO. Max4Text in the XSD. */
  reason: string;
  /** Free text, e.g. "Humedad 13.5%" or "Abono crédito CR-2026-0012". */
  info?: string;
  /** CRDT = adds to the creditor, DBIT = reduces what the creditor receives. */
  direction?: 'CRDT' | 'DBIT';
}

/** The delivery settlement ("liquidación") that backs one payment. */
export interface ReferredDocument {
  number: string;
  date: Date;
  lines: DocumentLine[];
  /** quantity × price, before deductions. */
  duePayable: string;
  adjustments: Adjustment[];
  /** What is actually paid. */
  remitted: string;
}

export interface CreditTransfer {
  instrId: string;
  endToEndId: string;
  uetr: string;
  amount: string;
  creditor: Party;
  document: ReferredDocument;
}

export interface PaymentRun {
  msgId: string;
  createdAt: Date;
  initiatingParty: string;
  pmtInfId: string;
  executionDate: Date;
  debtor: Party;
  currency: string;
  transactions: CreditTransfer[];
  settlement: SettlementInfo;
}

function sum(values: string[]): string {
  // Cents as BigInt: exact for any realistic total.
  const cents = values.reduce((acc, v) => {
    const [i, f = ''] = v.split('.');
    return acc + BigInt(i!) * 100n + BigInt((f + '00').slice(0, 2));
  }, 0n);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function remittance(doc: ReferredDocument, ccy: string): Node {
  if (doc.adjustments.some((a) => a.reason.length > 4)) throw new Error('adjustment reason must be at most 4 characters');
  return el('RmtInf', [
    el('Strd', [
      el('RfrdDocInf', [
        el('Tp', [el('CdOrPrtry', [el('Prtry', 'LIQUIDACION')])]),
        el('Nb', assertMax35(doc.number, 'document number')),
        el('RltdDt', isoDate(doc.date)),
        ...doc.lines.map((l) =>
          el('LineDtls', [
            el('Id', [el('Nb', assertMax35(l.id, 'line id'))]),
            el('Desc', l.description.slice(0, 2048)),
            el('Amt', [el('RmtdAmt', amount(l.amount), { Ccy: ccy })]),
          ]),
        ),
      ]),
      el(
        'RfrdDocAmt',
        opt(
          el('DuePyblAmt', amount(doc.duePayable), { Ccy: ccy }),
          doc.adjustments.map((a) =>
            el('AdjstmntAmtAndRsn', opt(
              el('Amt', amount(a.amount), { Ccy: ccy }),
              el('CdtDbtInd', a.direction ?? 'DBIT'),
              el('Rsn', a.reason),
              a.info ? el('AddtlInf', a.info.slice(0, 140)) : null,
            )),
          ),
          el('RmtdAmt', amount(doc.remitted), { Ccy: ccy }),
        ),
      ),
    ]),
  ]);
}

export function buildPain001(run: PaymentRun): string {
  const ccy = currency(run.currency);
  if (run.transactions.length === 0) throw new Error('a payment run needs at least one transaction');
  const total = sum(run.transactions.map((t) => amount(t.amount)));
  const count = String(run.transactions.length);

  const txs = run.transactions.map((t) =>
    el('CdtTrfTxInf', [
      el('PmtId', [
        el('InstrId', assertMax35(t.instrId, 'InstrId')),
        el('EndToEndId', assertMax35(t.endToEndId, 'EndToEndId')),
        el('UETR', t.uetr),
      ]),
      el('Amt', [el('InstdAmt', t.amount, { Ccy: ccy })]),
      stellarAgentNode('CdtrAgt'),
      partyNode('Cdtr', t.creditor.name),
      accountNode('CdtrAcct', t.creditor.account),
      el('Purp', [el('Cd', 'GDDS')]),
      remittance(t.document, ccy),
      settlementNode(run.settlement),
    ]),
  );

  return documentXml(
    PAIN001_NS,
    el('CstmrCdtTrfInitn', [
      el('GrpHdr', [
        el('MsgId', assertMax35(run.msgId, 'MsgId')),
        el('CreDtTm', isoDateTime(run.createdAt)),
        el('NbOfTxs', count),
        el('CtrlSum', total),
        partyNode('InitgPty', run.initiatingParty),
      ]),
      el('PmtInf', [
        el('PmtInfId', assertMax35(run.pmtInfId, 'PmtInfId')),
        el('PmtMtd', 'TRF'),
        el('BtchBookg', 'false'),
        el('NbOfTxs', count),
        el('CtrlSum', total),
        el('PmtTpInf', [el('CtgyPurp', [el('Cd', 'SUPP')])]),
        el('ReqdExctnDt', [el('Dt', isoDate(run.executionDate))]),
        partyNode('Dbtr', run.debtor.name),
        accountNode('DbtrAcct', run.debtor.account),
        stellarAgentNode('DbtrAgt'),
        el('ChrgBr', 'DEBT'),
        ...txs,
      ]),
    ]),
  );
}
