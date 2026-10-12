import type { ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { lang, setLang, t } from './i18n';
import { mxn, short } from './format';
import { Icon } from './ui';
import { useData } from './useData';
import RealizarPago from './pages/RealizarPago';
import Productores from './pages/Productores';
import ProductorDetalle from './pages/ProductorDetalle';
import Historial from './pages/Historial';
import PagoDetalle from './pages/PagoDetalle';
import Resumen from './pages/admin/Resumen';
import Precios from './pages/admin/Precios';
import Creditos from './pages/admin/Creditos';
import CreditoDetalle from './pages/admin/CreditoDetalle';
import Prestamistas from './pages/admin/Prestamistas';
import Auditoria from './pages/admin/Auditoria';
import Recibo from './pages/Recibo';

/* Marca: el logotipo de MicoPay (Logo.tsx de la app) con el producto como sufijo. */
export function Marca({ tone = 'claro' }: { tone?: 'claro' | 'oscuro' }) {
  const tinta = tone === 'oscuro' ? 'var(--color-papel)' : 'var(--color-tinta)';
  const naranja = tone === 'oscuro' ? 'var(--color-naranja-claro)' : 'var(--color-naranja)';
  return (
    <div className="flex items-center gap-2.5">
      <svg fill="none" height="26" width="26" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="7" cy="7" r="3" stroke={tinta} strokeWidth="2.5" />
        <circle cx="17" cy="17" r="3" stroke={naranja} strokeWidth="2.5" />
        <path d="M10 10L14 14" stroke={tinta} strokeLinecap="round" strokeWidth="2.5" />
      </svg>
      <div className="font-display text-[20px] font-extrabold uppercase tracking-[-.02em] leading-none" style={{ fontVariationSettings: '"wdth" 112' }} translate="no">
        <span style={{ color: tinta }}>Mico</span>
        <span style={{ color: naranja }}>Pay</span>
        <span className="ml-1.5 text-[13px] tracking-[.14em]" style={{ color: tone === 'oscuro' ? 'var(--color-gris-3)' : 'var(--color-gris)' }}>Café</span>
      </div>
    </div>
  );
}

const OPERACION = [
  { to: '/', icon: 'payments', label: 'Realizar pago' },
  { to: '/productores', icon: 'person', label: 'Productores' },
  { to: '/historial', icon: 'receipt_long', label: 'Historial' },
];
const ADMIN = [
  { to: '/admin', icon: 'home', label: 'Resumen del mes' },
  { to: '/admin/precios', icon: 'checklist', label: 'Precio de referencia' },
  { to: '/admin/creditos', icon: 'savings', label: 'Créditos' },
  { to: '/admin/prestamistas', icon: 'account_balance', label: 'Prestamistas' },
  { to: '/admin/auditoria', icon: 'verified_user', label: 'Auditoría' },
];

function Grupo({ titulo, items }: { titulo: string; items: typeof OPERACION }) {
  return (
    <div className="md:mb-3 flex md:flex-col">
      <div className="hidden md:block px-5 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-[.14em] text-gris-3">{t(titulo)}</div>
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/' || n.to === '/admin'}
          className={({ isActive }) => `flex items-center gap-3 px-5 py-3 text-[15px] font-bold whitespace-nowrap border-l-4 ${isActive ? 'border-naranja-claro bg-tinta-2 text-papel' : 'border-transparent text-gris-3'}`}>
          {({ isActive }) => (<><Icon name={n.icon} filled={isActive} /> {t(n.label)}</>)}
        </NavLink>
      ))}
    </div>
  );
}

function Encabezado() {
  const s = useData(api.summary);
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b-2 border-tinta pb-4">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[.14em] text-gris">{t('Compradora de café')}</div>
        <div className="font-bold text-[16px]">{s.data?.cooperative.name ?? '…'}</div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-[.14em] text-gris">{t('Saldo · {code} · testnet', { code: s.data?.asset.code ?? '' })}</div>
          <div className="num font-display text-[22px] font-extrabold text-verde leading-tight">{s.data?.balance ? mxn(s.data.balance) : '—'}</div>
        </div>
        <button type="button" onClick={s.reload} aria-label={t('Actualizar saldo')} className="rounded-sm border-2 border-tinta bg-papel p-2"><Icon name="history_toggle_off" /></button>
      </div>
      {s.data && <div className="w-full text-[12px] text-gris num">{t('Cuenta {addr} · firma {signer}', { addr: short(s.data.cooperative.stellar_address, 8), signer: t(s.data.signer === 'micopay' ? 'desde la app de MicoPay' : 'local de demo (testnet)') })}</div>}
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[256px_1fr]">
      <aside className="bg-tinta text-papel md:sticky md:top-0 md:h-dvh flex md:flex-col overflow-x-auto no-scrollbar">
        <div className="px-5 py-5 border-b-2 border-tinta-3 hidden md:block"><Marca tone="oscuro" /></div>
        <nav className="flex md:flex-col md:py-2">
          <Grupo titulo="Operación" items={OPERACION} />
          <Grupo titulo="Administración" items={ADMIN} />
        </nav>
        <div className="hidden md:flex mt-auto px-5 py-4 border-t-2 border-tinta-3 gap-2" role="group" aria-label="Language">
          {(['es', 'en'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
              className={`rounded-sm border-2 px-3 py-1 text-[13px] font-bold uppercase ${lang === l ? 'bg-papel text-tinta border-papel' : 'border-tinta-3 text-gris-3'}`}>{l}</button>
          ))}
        </div>
      </aside>
      <main className="px-4 py-6 md:px-10 md:py-8 max-w-[1200px] w-full">
        <Encabezado />
        {children}
      </main>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  // The receipt is what the producer sees on the phone: no cooperative chrome.
  if (pathname.startsWith('/recibo/')) {
    return (
      <div className="min-h-dvh bg-fondo px-4 py-6 flex flex-col items-center">
        <div className="w-full max-w-[420px]"><div className="mb-5"><Marca /></div><Routes><Route path="/recibo/:id" element={<Recibo />} /></Routes></div>
      </div>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RealizarPago />} />
        <Route path="/productores" element={<Productores />} />
        <Route path="/productores/:id" element={<ProductorDetalle />} />
        <Route path="/historial" element={<Historial />} />
        <Route path="/historial/:id" element={<PagoDetalle />} />
        <Route path="/admin" element={<Resumen />} />
        <Route path="/admin/precios" element={<Precios />} />
        <Route path="/admin/creditos" element={<Creditos />} />
        <Route path="/admin/creditos/:id" element={<CreditoDetalle />} />
        <Route path="/admin/prestamistas" element={<Prestamistas />} />
        <Route path="/admin/auditoria" element={<Auditoria />} />
      </Routes>
    </Layout>
  );
}
