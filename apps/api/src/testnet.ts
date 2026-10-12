import { type Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { loadKeys, saveKeys } from './config.js';
import { horizon, NETWORK_PASSPHRASE } from './stellar.js';

export async function friendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  if (!res.ok) throw new Error(`friendbot falló para ${address}: ${res.status}`);
}

/**
 * Testnet stand-in for what the MicoPay app does at signup: a funded account
 * that can hold the settlement token. The secret is kept only in the local
 * git-ignored key file — the platform never needs it to pay this account.
 */
export async function createTestnetAccount(asset: Asset): Promise<{ address: string }> {
  const kp = Keypair.random();
  await friendbot(kp.publicKey());
  const account = await horizon.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
  const keys = loadKeys();
  keys.producers[kp.publicKey()] = kp.secret();
  saveKeys(keys);
  return { address: kp.publicKey() };
}
