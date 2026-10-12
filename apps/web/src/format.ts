const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
const QTY = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Money arrives as decimal strings from the API; formatting is display-only. */
export const mxn = (v: string | number | null | undefined) => MXN.format(Number(v ?? 0));
export const qty = (v: string | number | null | undefined) => QTY.format(Number(v ?? 0));
export const short = (s: string, n = 6) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const fecha = (v: string | Date) =>
  new Date(v).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const dia = (v: string | Date) =>
  new Date(v).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** Today's date in Mexico City (UTC-6, no DST) as YYYY-MM-DD. */
export const hoy = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
