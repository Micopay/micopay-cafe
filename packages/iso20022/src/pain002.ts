import { assertMax35, isoDateTime, partyNode, settlementNode, type SettlementInfo } from './common.js';
import { documentXml, el, opt } from './xml.js';

export const PAIN002_NS = 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.10';

/** ACSC = settled on the ledger, RJCT = the ledger rejected it, PDNG = submitted, not final. */
export type TxStatus = 'ACSC' | 'RJCT' | 'PDNG';

export interface TxStatusEntry {
  originalInstrId: string;
  originalEndToEndId: string;
  originalUetr: string;
  status: TxStatus;
  /** Stellar result code, e.g. tx_failed / op_underfunded. Required for RJCT. */
  reasonCode?: string;
  reasonInfo?: string;
  settlement: SettlementInfo;
}

export interface StatusReport {
  msgId: string;
  createdAt: Date;
  initiatingParty: string;
  /** MsgId and creation time of the pain.001 being answered — not the UETR. */
  originalMsgId: string;
  originalCreatedAt: Date;
  originalPmtInfId: string;
  entries: TxStatusEntry[];
}

/**
 * Maps a Stellar submission result to an ISO status.
 * Horizon only returns success for applied transactions; any tx_/op_ error code
 * means the transaction never changed balances.
 */
export function statusFromStellar(result: { successful: boolean; code?: string } | null): TxStatus {
  if (!result) return 'PDNG';
  return result.successful ? 'ACSC' : 'RJCT';
}

function groupStatus(entries: TxStatusEntry[]): string {
  const all = (s: TxStatus) => entries.every((e) => e.status === s);
  if (all('ACSC')) return 'ACSC';
  if (all('RJCT')) return 'RJCT';
  if (entries.some((e) => e.status === 'PDNG')) return 'PDNG';
  return 'PART';
}

export function buildPain002(report: StatusReport): string {
  const txs = report.entries.map((e) => {
    if (e.status === 'RJCT' && !e.reasonCode) throw new Error('RJCT needs a reason code');
    return el('TxInfAndSts', opt(
      el('OrgnlInstrId', assertMax35(e.originalInstrId, 'OrgnlInstrId')),
      el('OrgnlEndToEndId', assertMax35(e.originalEndToEndId, 'OrgnlEndToEndId')),
      el('OrgnlUETR', e.originalUetr),
      el('TxSts', e.status),
      e.reasonCode
        ? el('StsRsnInf', opt(
            el('Rsn', [el('Prtry', e.reasonCode.slice(0, 35))]),
            e.reasonInfo ? el('AddtlInf', e.reasonInfo.slice(0, 105)) : null,
          ))
        : null,
      settlementNode(e.settlement),
    ));
  });

  return documentXml(
    PAIN002_NS,
    el('CstmrPmtStsRpt', [
      el('GrpHdr', [
        el('MsgId', assertMax35(report.msgId, 'MsgId')),
        el('CreDtTm', isoDateTime(report.createdAt)),
        partyNode('InitgPty', report.initiatingParty),
      ]),
      el('OrgnlGrpInfAndSts', [
        el('OrgnlMsgId', assertMax35(report.originalMsgId, 'OrgnlMsgId')),
        el('OrgnlMsgNmId', 'pain.001.001.09'),
        el('OrgnlCreDtTm', isoDateTime(report.originalCreatedAt)),
        el('OrgnlNbOfTxs', String(report.entries.length)),
        el('GrpSts', groupStatus(report.entries)),
      ]),
      el('OrgnlPmtInfAndSts', [
        el('OrgnlPmtInfId', assertMax35(report.originalPmtInfId, 'OrgnlPmtInfId')),
        ...txs,
      ]),
    ]),
  );
}
