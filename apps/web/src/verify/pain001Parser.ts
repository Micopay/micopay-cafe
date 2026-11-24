/**
 * Reads a pain.001 (ISO 20022 customer credit transfer init) in the browser with
 * DOMParser, and pulls out what the verification page needs:
 *
 * - each credit transfer's creditor Stellar address, read from CdtrAcct/Prxy where
 *   the proxy type is STELLAR (Prxy/Tp/Prtry = STELLAR);
 * - the on-chain amount and asset, read from SplmtryData/StellarSettlement;
 * - the MXN amounts, kilos, price and deductions from the structured remittance
 *   (RmtInf/Strd).
 *
 * Parsing is tolerant: it reads what it can and leaves unknown fields null, so a
 * third party who feeds a document MicoPay did not produce still gets a readable
 * error from the verification step rather than a crash here. The verification
 * module decides what "missing" means.
 */

export interface ParsedLine {
  id: string;
  /** Free-text line description, e.g. "Café pergamino · 250.00 kg × 85.00 MXN/kg". */
  description: string;
  amount: string;
  /** Kilos and unit price parsed out of the free-text description, when it follows
   * the "{product} · {qty} {unit} × {price} MXN/{unit}" shape MicoPay writes. */
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
}

export interface ParsedAdjustment {
  amount: string;
  /** CRDT adds to the creditor, DBIT reduces what they receive. */
  direction: 'CRDT' | 'DBIT' | null;
  /** Short reason code, e.g. HUME, CRED. */
  reason: string;
  /** Free text, e.g. "Castigo por humedad 13.5%". */
  info: string | null;
}

export interface ParsedDocument {
  number: string;
  date: string | null;
  lines: ParsedLine[];
  /** Gross, before deductions. */
  duePayable: string;
  adjustments: ParsedAdjustment[];
  /** Net, what is actually paid. */
  remitted: string;
}

export interface ParsedSettlement {
  network: string | null;
  assetCode: string | null;
  assetIssuer: string | null;
  /** Token units that the document says moved on the ledger. */
  tokenAmount: string | null;
  /** MXN per 1 unit of the token. */
  fxRate: string | null;
}

export interface ParsedTransfer {
  instrId: string | null;
  endToEndId: string | null;
  uetr: string | null;
  /** InstdAmt: the MXN amount instructed to the creditor (= net paid). */
  amountMxn: string;
  creditorName: string | null;
  /** Stellar address from CdtrAcct/Prxy where Tp/Prtry = STELLAR. */
  creditorAddress: string | null;
  document: ParsedDocument;
  settlement: ParsedSettlement;
}

export interface ParsedPain001 {
  msgId: string | null;
  createdAt: string | null;
  initiatingParty: string | null;
  currency: string | null;
  transfers: ParsedTransfer[];
}

/** First descendant of `root` whose local XML name matches `name`. */
function one(root: Element | Document | null, name: string): Element | null {
  if (!root) return null;
  return all(root, name)[0] ?? null;
}

function all(root: Element | Document | null, name: string): Element[] {
  if (!root) return [];
  const found: Element[] = [];
  const visit = (node: Node) => {
    if (node instanceof Element && node.localName === name) found.push(node);
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  for (const child of Array.from(root.childNodes)) visit(child);
  return found;
}

function txt(el: Element | null | undefined): string | null {
  const v = el?.textContent;
  return v ? v.trim() : null;
}

function txtOf(root: Element | Document | null, name: string): string | null {
  return txt(one(root, name));
}

function attrOf(root: Element | Document | null, name: string, attr: string): string | null {
  const el = one(root, name);
  const v = el?.getAttribute(attr);
  return v ? v.trim() : null;
}

/** The Stellar address under an account's Prxy, only when the proxy type is STELLAR. */
function stellarProxy(accountTag: string, root: Element): string | null {
  const acct = one(root, accountTag);
  if (!acct) return null;
  for (const prxy of all(acct, 'Prxy')) {
    if (txtOf(prxy, 'Prtry') === 'STELLAR') {
      const id = txtOf(prxy, 'Id');
      if (id) return id;
    }
  }
  return null;
}

/** Kilos and unit price out of the free-text description MicoPay writes. */
function parseDescription(description: string): Pick<ParsedLine, 'quantity' | 'unit' | 'unitPrice'> {
  // "Café pergamino · 250.00 kg × 85.00 MXN/kg" — · is U+00B7, × is U+00D7.
  const m = description.match(/\u00b7\s*([\d.,]+)\s*(\S+?)\s*\u00d7\s*([\d.,]+)\s*MXN\/(.+)/u);
  if (!m) return { quantity: null, unit: null, unitPrice: null };
  return { quantity: m[1]!, unit: m[2]!, unitPrice: m[3]! };
}

function parseLine(el: Element): ParsedLine {
  const description = txtOf(el, 'Desc') ?? '';
  return {
    id: txtOf(el, 'Nb') ?? '',
    description,
    amount: txtOf(el, 'RmtdAmt') ?? '0',
    ...parseDescription(description),
  };
}

function parseAdjustment(el: Element): ParsedAdjustment {
  const dir = txtOf(el, 'CdtDbtInd');
  return {
    amount: txtOf(el, 'Amt') ?? '0',
    direction: dir === 'CRDT' || dir === 'DBIT' ? dir : null,
    reason: txtOf(el, 'Rsn') ?? '',
    info: txtOf(el, 'AddtlInf'),
  };
}

function parseDocument(el: Element): ParsedDocument {
  const rfrdDocInf = one(el, 'RfrdDocInf');
  const rfrdDocAmt = one(el, 'RfrdDocAmt');
  const adjustments = rfrdDocAmt ? all(rfrdDocAmt, 'AdjstmntAmtAndRsn').map(parseAdjustment) : [];
  return {
    number: txtOf(rfrdDocInf, 'Nb') ?? '',
    date: txtOf(rfrdDocInf, 'RltdDt'),
    lines: rfrdDocInf ? all(rfrdDocInf, 'LineDtls').map(parseLine) : [],
    duePayable: txtOf(rfrdDocAmt, 'DuePyblAmt') ?? '0',
    adjustments,
    remitted: txtOf(rfrdDocAmt, 'RmtdAmt') ?? txtOf(el, 'InstdAmt') ?? '0',
  };
}

function parseSettlement(el: Element): ParsedSettlement {
  for (const sd of all(el, 'SplmtryData')) {
    if (txtOf(sd, 'PlcAndNm') !== 'StellarSettlement') continue;
    // StellarSettlement lives in Envlp under a different namespace.
    const ss = one(sd, 'StellarSettlement');
    if (!ss) continue;
    return {
      network: txtOf(ss, 'Network'),
      assetCode: attrOf(ss, 'Asset', 'code'),
      assetIssuer: attrOf(ss, 'Asset', 'issuer'),
      tokenAmount: txtOf(ss, 'Amount'),
      fxRate: txtOf(ss, 'FxRate'),
    };
  }
  return { network: null, assetCode: null, assetIssuer: null, tokenAmount: null, fxRate: null };
}

function parseTransfer(el: Element): ParsedTransfer {
  const cdtr = one(el, 'Cdtr');
  return {
    instrId: txtOf(el, 'InstrId'),
    endToEndId: txtOf(el, 'EndToEndId'),
    uetr: txtOf(el, 'UETR'),
    amountMxn: txtOf(el, 'InstdAmt') ?? '0',
    creditorName: txtOf(cdtr, 'Nm'),
    creditorAddress: stellarProxy('CdtrAcct', el),
    document: parseDocument(el),
    settlement: parseSettlement(el),
  };
}

/**
 * Parse a pain.001 XML string. Throws when the document is not XML or carries no
 * credit transfers; the caller (the verification module) turns that into a
 * readable "could not read the document" result.
 */
export function parsePain001(xml: string): ParsedPain001 {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML ilegible');
  const transfersXml = all(doc, 'CdtTrfTxInf');
  if (transfersXml.length === 0) throw new Error('el documento no tiene transferencias');
  const grpHdr = one(doc, 'GrpHdr');
  return {
    msgId: txtOf(grpHdr, 'MsgId'),
    createdAt: txtOf(grpHdr, 'CreDtTm'),
    initiatingParty: txtOf(one(grpHdr, 'InitgPty'), 'Nm'),
    currency: attrOf(doc, 'InstdAmt', 'Ccy'),
    transfers: transfersXml.map(parseTransfer),
  };
}
