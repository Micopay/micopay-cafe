import { buildCamt053, shortRef, type Entry, type Party, type SettlementInfo } from '@micopay-cafe/iso20022';
import Big from 'big.js';
import type { Asset } from '@stellar/stellar-sdk';
import type { Db } from './db.js';
import { assetBalance, horizon } from './stellar.js';

interface LedgerMove {
  hash: string;
  at: Date;
  amount: Big;
  direction: 'CRDT' | 'DBIT';
  counterparty: string;
}

/** Every movement of `asset` on `address` from `since` until now, newest first. */
async function movesSince(address: string, asset: Asset, since: Date): Promise<LedgerMove[]> {
  const moves: LedgerMove[] = [];
  let page = await horizon.payments().forAccount(address).order('desc').limit(200).call();
  for (;;) {
    for (const r of page.records) {
      const at = new Date(r.created_at);
      if (at < since) return moves;
      if (r.type !== 'payment') continue;
      const p = r as unknown as { asset_code?: string; asset_issuer?: string; amount: string; from: string; to: string; transaction_hash: string };
      if (p.asset_code !== asset.getCode() || p.asset_issuer !== asset.getIssuer()) continue;
      const incoming = p.to === address;
      moves.push({ hash: p.transaction_hash, at, amount: new Big(p.amount), direction: incoming ? 'CRDT' : 'DBIT', counterparty: incoming ? p.from : p.to });
    }
    if (page.records.length < 200) return moves;
    page = await page.next();
  }
}

/**
 * camt.053 for the cooperative's account between `from` and `to`.
 * Balances come from the ledger: closing(to) = current − movements after `to`,
 * opening(from) = closing(to) − movements inside the period. Nothing is assumed.
 */
export async function buildStatement(db: Db, params: { from: Date; to: Date; asset: Asset; network: SettlementInfo['network']; currency: string }): Promise<string> {
  const coop = (await db.query<{ name: string; account_id: string; stellar_address: string }>(
    `SELECT name, account_id, stellar_address FROM cooperatives WHERE id = 1`,
  )).rows[0]!;
  const current = await assetBalance(coop.stellar_address, params.asset);
  if (current === null) throw new Error('no se pudo leer el saldo de la cooperativa en Stellar');

  const moves = await movesSince(coop.stellar_address, params.asset, params.from);
  const signed = (m: LedgerMove) => (m.direction === 'CRDT' ? m.amount : m.amount.neg());
  const after = moves.filter((m) => m.at > params.to).reduce((a, m) => a.plus(signed(m)), new Big(0));
  const inside = moves.filter((m) => m.at <= params.to).reverse();
  const closing = new Big(current).minus(after);
  const opening = inside.reduce((a, m) => a.minus(signed(m)), closing);

  // Enrich movements that belong to our runs with their ISO references.
  const known = new Map<string, { e2e: string; uetr: string; instr: string; name: string; account: string; address: string }>();
  const rows = (await db.query<{ tx_hash: string; end_to_end_id: string; uetr: string; instr_id: string; name: string; account_id: string; stellar_address: string }>(
    `SELECT r.tx_hash, s.end_to_end_id, s.uetr::text, s.instr_id, p.name, p.account_id, p.stellar_address
       FROM settlements s JOIN payment_runs r ON r.id = s.run_id JOIN deliveries d ON d.id = s.delivery_id JOIN producers p ON p.id = d.producer_id
      WHERE r.status = 'settled'`,
  )).rows;
  for (const r of rows) known.set(`${r.tx_hash}:${r.stellar_address}`, { e2e: r.end_to_end_id, uetr: r.uetr, instr: r.instr_id, name: r.name, account: r.account_id, address: r.stellar_address });

  const coopParty: Party = { name: coop.name, account: { id: coop.account_id, stellarAddress: coop.stellar_address } };
  const entries: Entry[] = inside.map((m) => {
    const k = known.get(`${m.hash}:${m.counterparty}`);
    return {
      amount: m.amount.toFixed(5),
      direction: m.direction,
      bookedAt: m.at,
      ...(k ? {
        instrId: k.instr, endToEndId: k.e2e, uetr: k.uetr, debtor: coopParty,
        creditor: { name: k.name, account: { id: k.account, stellarAddress: k.address } },
        remittance: 'Pago a productor',
      } : { remittance: m.direction === 'CRDT' ? 'Depósito a la cuenta' : 'Abono a crédito / otro cargo' }),
      settlement: { network: params.network, assetCode: params.asset.getCode(), assetIssuer: params.asset.getIssuer(), txHash: m.hash },
    };
  });

  const now = new Date();
  return buildCamt053({
    msgId: shortRef('STM', now), statementId: shortRef('S', now), createdAt: now, from: params.from, to: params.to,
    // The account holds the token, so the statement is in its currency (USDC → USD).
    account: coopParty.account, accountOwner: coop.name, currency: params.currency, decimals: 5,
    openingBalance: opening.toFixed(5), closingBalance: closing.toFixed(5), entries,
  });
}
