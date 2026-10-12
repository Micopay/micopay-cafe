import { locale } from './i18n';

const MXN = new Intl.NumberFormat(locale, { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const QTY = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Money arrives as decimal strings from the API; formatting is display-only. */
export const mxn = (v: string | number | null | undefined) => MXN.format(Number(v ?? 0));
/** Token amounts (USDC): up to 2 decimals shown, the ledger keeps 5. */
export const token = (v: string | number | null | undefined) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));
export const qty = (v: string | number | null | undefined) => QTY.format(Number(v ?? 0));
export const short = (s: string, n = 6) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const fecha = (v: string | Date) =>
  new Date(v).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const dia = (v: string | Date) =>
  new Date(v).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** Today's date in Mexico City (UTC-6, no DST) as YYYY-MM-DD. */
export const hoy = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
