import type { ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Icon } from './ui';
import Panel from './pages/Panel';
import NuevaEntrega from './pages/NuevaEntrega';
import PorPagar from './pages/PorPagar';
import Corridas from './pages/Corridas';
import Productores from './pages/Productores';
import Creditos from './pages/Creditos';
import Recibo from './pages/Recibo';

/* Marca: el logotipo de MicoPay (Logo.tsx de la app) con el producto como sufijo. */
function Marca({ tone = 'claro' }: { tone?: 'claro' | 'oscuro' }) {
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

const NAV = [
  { to: '/', icon: 'home', label: 'Panel' },
  { to: '/entregas/nueva', icon: 'add_circle', label: 'Registrar entrega' },
  { to: '/pagos', icon: 'payments', label: 'Por pagar' },
  { to: '/corridas', icon: 'receipt_long', label: 'Corridas' },
  { to: '/productores', icon: 'person', label: 'Productores' },
  { to: '/creditos', icon: 'savings', label: 'Créditos' },
];

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="bg-tinta text-papel md:sticky md:top-0 md:h-dvh flex md:flex-col">
        <div className="px-5 py-5 border-b-2 border-tinta-3 hidden md:block"><Marca tone="oscuro" /></div>
        <nav className="flex md:flex-col overflow-x-auto no-scrollbar md:py-3 w-full">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-3.5 text-[15px] font-bold whitespace-nowrap border-l-4 ${
                  isActive ? 'border-naranja-claro bg-tinta-2 text-papel' : 'border-transparent text-gris-3'
                }`
              }
            >
              {({ isActive }) => (<><Icon name={n.icon} filled={isActive} /> {n.label}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden md:block px-5 py-4 border-t-2 border-tinta-3 text-[12px] text-gris-3 leading-relaxed">
          Stellar <b className="text-verde-brillo">testnet</b> · firma local de demo.
          <br />En producción firma la app de MicoPay.
        </div>
      </aside>
      <main className="px-4 py-6 md:px-10 md:py-9 max-w-[1180px] w-full">{children}</main>
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
        <Route path="/" element={<Panel />} />
        <Route path="/entregas/nueva" element={<NuevaEntrega />} />
        <Route path="/pagos" element={<PorPagar />} />
        <Route path="/corridas" element={<Corridas />} />
        <Route path="/productores" element={<Productores />} />
        <Route path="/creditos" element={<Creditos />} />
      </Routes>
    </Layout>
  );
}

export function Titulo({ cintillo, children, accion }: { cintillo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="inline-block bg-tinta text-papel px-2.5 py-1 text-[12px] font-bold uppercase tracking-[.14em] leading-none">{cintillo}</span>
        <h1 className="mt-3 font-display text-[34px] md:text-[40px] font-extrabold leading-[1.02] tracking-[-.02em]" style={{ fontVariationSettings: '"wdth" 112' }}>
          {children}
        </h1>
      </div>
      {accion}
    </header>
  );
}

export function Cargando() {
  return <p className="text-gris text-[15px]">Cargando…</p>;
}

export function ErrorCaja({ mensaje }: { mensaje: string }) {
  return <div className="border-2 border-rojo bg-rojo-suave text-rojo px-4 py-3 font-semibold text-[14px] rounded-sm">{mensaje}</div>;
}
