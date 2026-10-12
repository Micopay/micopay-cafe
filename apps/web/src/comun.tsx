import type { ReactNode, SelectHTMLAttributes } from 'react';
import { t } from './i18n';
import type { CreditStatus } from './api';
import { short } from './format';
import { Badge, Icon } from './ui';

export function Titulo({ cintillo, children, accion }: { cintillo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="inline-block bg-tinta text-papel px-2.5 py-1 text-[12px] font-bold uppercase tracking-[.14em] leading-none">{cintillo}</span>
        <h1 className="mt-3 font-display text-[32px] md:text-[38px] font-extrabold leading-[1.02] tracking-[-.02em]" style={{ fontVariationSettings: '"wdth" 112' }}>
          {children}
        </h1>
      </div>
      {accion}
    </header>
  );
}

export function Subtitulo({ children, accion }: { children: ReactNode; accion?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-[21px] font-extrabold" style={{ fontVariationSettings: '"wdth" 108' }}>{children}</h2>
      {accion}
    </div>
  );
}

export const Cargando = () => <p className="text-gris text-[15px]">{t('Cargando…')}</p>;

export function ErrorCaja({ mensaje }: { mensaje: string }) {
  return <div role="alert" className="border-2 border-rojo bg-rojo-suave text-rojo px-4 py-3 font-semibold text-[14px] rounded-sm">{mensaje}</div>;
}

export function Aviso({ children, tono = 'verde' }: { children: ReactNode; tono?: 'verde' | 'aviso' }) {
  const c = tono === 'verde' ? 'bg-verde-suave' : 'bg-aviso border-aviso-borde text-aviso-texto';
  return <div className={`border-2 border-tinta ${c} px-4 py-3 rounded-sm text-[14px]`}>{children}</div>;
}

/** Plain bordered surface without the Card padding, for tables and panels with a header bar. */
export function Panel({ children, sombra = false, className = '' }: { children: ReactNode; sombra?: boolean; className?: string }) {
  return <div className={`rounded-sm border-2 border-tinta bg-papel overflow-hidden ${sombra ? 'shadow-solida' : ''} ${className}`}>{children}</div>;
}

export function BarraPanel({ children }: { children: ReactNode }) {
  return <div className="bg-tinta text-papel px-5 py-3 text-[12px] font-bold uppercase tracking-[.14em]">{children}</div>;
}

export function Tabla({ cabeceras, children, vacio }: { cabeceras: Array<string | { t: string; derecha?: boolean }>; children: ReactNode; vacio?: string | false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="bg-tinta text-papel text-left text-[11px] uppercase tracking-[.12em]">
          <tr>{cabeceras.map((c) => {
            const t = typeof c === 'string' ? { t: c } : c;
            return <th key={t.t} className={`px-3 py-3 font-bold whitespace-nowrap ${t.derecha ? 'text-right' : ''}`}>{t.t}</th>;
          })}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {vacio && <p className="px-4 py-6 text-gris text-[14px]">{vacio}</p>}
    </div>
  );
}

export const td = 'px-3 py-2.5 border-t border-linea align-top';
export const tdNum = `${td} text-right num whitespace-nowrap`;

export function Select({ etiqueta, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-bold text-gris">{etiqueta}</span>
      <select className="min-h-12 w-full rounded-sm border-2 border-tinta bg-fondo px-3 py-2.5 text-[16px] text-tinta outline-none focus:border-naranja" {...rest}>
        {children}
      </select>
    </label>
  );
}

const CREDIT: Record<CreditStatus, ['tinta' | 'naranja' | 'verde' | 'papel' | 'aviso', string]> = {
  pendiente: ['aviso', 'Pendiente'],
  vigente: ['naranja', 'Vigente'],
  vencido: ['tinta', 'Vencido'],
  pagado: ['verde', 'Pagado'],
  cancelado: ['papel', 'Cancelado'],
};
export const EstadoCredito = ({ s }: { s: CreditStatus }) => <Badge tono={CREDIT[s][0]}>{t(CREDIT[s][1])}</Badge>;

const PAGO: Record<string, ['verde' | 'aviso', string]> = { paid: ['verde', 'Pagado'], pending: ['aviso', 'Rechazado'], in_run: ['aviso', 'Enviando'] };
export const EstadoPago = ({ s }: { s: string }) => <Badge tono={PAGO[s]?.[0] ?? 'aviso'}>{t(PAGO[s]?.[1] ?? s)}</Badge>;

/** Link to stellar.expert for a transaction hash. */
export function Tx({ hash, n = 6 }: { hash: string | null | undefined; n?: number }) {
  if (!hash) return <span className="text-gris">—</span>;
  return (
    <a href={`https://stellar.expert/explorer/testnet/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-verde underline num whitespace-nowrap">
      {short(hash, n)} <Icon name="open_in_new" size={15} />
    </a>
  );
}

export function Doc({ href, nombre, desc }: { href: string; nombre: string; desc?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-sm border-2 border-tinta bg-papel px-3 py-1.5 text-[13px] font-bold">
      <Icon name="receipt_long" size={16} /> {nombre}{desc && <span className="font-normal text-gris">· {desc}</span>}
    </a>
  );
}

export function Dato({ etiqueta, valor, tono = '' }: { etiqueta: string; valor: ReactNode; tono?: string }) {
  return (
    <div className="rounded-sm border-2 border-tinta bg-papel p-4">
      <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">{etiqueta}</div>
      <div className={`num mt-1.5 font-display text-[22px] font-extrabold leading-none ${tono}`} style={{ fontVariationSettings: '"wdth" 106' }}>{valor}</div>
    </div>
  );
}
