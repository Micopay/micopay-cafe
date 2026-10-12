/**
 * Registers a demo producer's testnet account as a MicoPay user, so the producer
 * can open it in the MicoPay app ("Restaurar con llave secreta") and see the
 * payments from the buyer there.
 *
 *   npx tsx src/register-micopay.ts PROD-0004 juana_sandoval
 *
 * Uses the same proof of key possession as the app: sign the /auth/challenge.
 * Testnet only: prints the secret so it can be typed into the app.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { loadKeys } from './config.js';

const API = process.env.MICOPAY_API ?? 'https://api.micopay.app';
const [accountId, username] = process.argv.slice(2);
if (!accountId || !username || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
  console.error('Uso: npx tsx src/register-micopay.ts PROD-0004 juana_sandoval');
  process.exit(1);
}

const secret = loadKeys().producers[accountId];
if (!secret) throw new Error(`No hay llave de testnet para ${accountId}`);
const kp = Keypair.fromSecret(secret);

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

const { challenge } = await post<{ challenge: string }>('/auth/challenge', { stellar_address: kp.publicKey() });
const signature = kp.sign(Buffer.from(challenge, 'utf8')).toString('base64');
const user = await post<Record<string, unknown>>('/users/register', { stellar_address: kp.publicKey(), username, challenge, signature });

console.log(`Usuario MicoPay creado: ${username} (${String(user.id ?? (user.user as { id?: string })?.id ?? '')})`);
console.log(`Dirección: ${kp.publicKey()}`);
console.log(`Llave secreta de TESTNET para "Restaurar con llave secreta": ${kp.secret()}`);
