import { useState } from 'react';
import { api, type Metrics } from '../../api';
import { BarraPanel, Cargando, Dato, ErrorCaja, Panel, Subtitulo, Tabla, td, tdNum, Titulo } from '../../comun';
import { hoy, mxn, qty } from '../../format';
import { TextField } from '../../ui';
import { useData } from '../../useData';

export default function Resumen() {
  const [month, setMonth] = useState(hoy().slice(0, 7));
  const m = useData(() => api.metrics(month), [month]);
  const k = m.data?.kpis;

  return (
    <>
      <Titulo cintillo="Administración" accion={<div className="w-[200px]"><TextField etiqueta="Mes" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>}>Resumen del mes</Titulo>
      {m.error && <ErrorCaja mensaje={m.error} />}
      {!m.data || !k ? <Cargando /> : (
        <>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <Dato etiqueta="Pagado a productores" valor={mxn(k.paid)} tono="text-verde" />
            <Dato etiqueta="Pagos" valor={k.payments} />
            <Dato etiqueta="Kilos" valor={`${qty(k.quantity)} kg`} />
            <Dato etiqueta="Productores" valor={k.producers} />
            <Dato etiqueta="Precio promedio" valor={k.avg_price ? `${mxn(k.avg_price)}/kg` : '—'} />
            <Dato etiqueta="Abonos a crédito" valor={mxn(k.repayments)} tono="text-naranja" />
          </div>

          <Subtitulo>Pagado por día</Subtitulo>
          <Panel className="p-5"><GraficaDias data={m.data} /></Panel>

          <Subtitulo>Top 5 productores del mes (por kg)</Subtitulo>
          <Panel>
            <Tabla cabeceras={['#', 'Productor', { t: 'Kilos', derecha: true }, { t: 'Pagado', derecha: true }]} vacio={m.data.top.length === 0 && 'Sin pagos este mes.'}>
              {m.data.top.map((t, i) => (
                <tr key={t.producer}><td className={`${td} num`}>{i + 1}</td><td className={`${td} font-bold`}>{t.producer}</td><td className={tdNum}>{qty(t.quantity)} kg</td><td className={tdNum}>{mxn(t.paid)}</td></tr>
              ))}
            </Tabla>
          </Panel>
        </>
      )}
    </>
  );
}

/* Single series (amount paid per day): one hue, no legend — the title names it.
   Thin bars with a 2px surface gap, one y-axis, recessive grid, per-bar tooltip,
   and a table view for screen readers and exact values. */
function GraficaDias({ data }: { data: Metrics }) {
  const [hover, setHover] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);
  const [y, mo] = data.month.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const byDay = new Map(data.byDay.map((d) => [Number(d.day.slice(8)), d]));
  const days = Array.from({ length: daysInMonth }, (_, i) => ({ n: i + 1, d: byDay.get(i + 1) }));
  const max = Math.max(1, ...data.byDay.map((d) => Number(d.paid)));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;

  const W = 900, H = 260, L = 72, R = 12, T = 12, B = 28;
  const pw = (W - L - R) / daysInMonth;
  const yOf = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const h = hover !== null ? days[hover - 1] : null;

  if (data.byDay.length === 0) return <p className="text-gris text-[14px]">Sin pagos este mes.</p>;

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" className="text-[13px] font-bold underline" onClick={() => setTabla(!tabla)}>{tabla ? 'Ver gráfica' : 'Ver como tabla'}</button>
      </div>
      {tabla ? (
        <Tabla cabeceras={['Día', { t: 'Pagos', derecha: true }, { t: 'Kilos', derecha: true }, { t: 'Pagado', derecha: true }]}>
          {data.byDay.map((d) => (
            <tr key={d.day}><td className={`${td} num`}>{d.day}</td><td className={tdNum}>{d.payments}</td><td className={tdNum}>{qty(d.quantity)} kg</td><td className={tdNum}>{mxn(d.paid)}</td></tr>
          ))}
        </Tabla>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Monto pagado por día en ${data.month}`} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={yOf(t)} y2={yOf(t)} stroke="var(--color-linea)" strokeWidth={t === 0 ? 1.5 : 1} />
                <text x={L - 8} y={yOf(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-gris)" className="num">{compact(t)}</text>
              </g>
            ))}
            {days.map(({ n, d }) => {
              const v = d ? Number(d.paid) : 0;
              const bw = Math.max(2, pw - 2); // 2px surface gap between bars
              const x = L + (n - 1) * pw + 1;
              return (
                <g key={n} onMouseEnter={() => setHover(n)}>
                  {/* hit target: the whole column, bigger than the mark */}
                  <rect x={L + (n - 1) * pw} y={T} width={pw} height={H - T - B} fill="transparent" />
                  {v > 0 && <rect x={x} y={yOf(v)} width={bw} height={yOf(0) - yOf(v)} rx={2} fill="var(--color-verde-claro)" opacity={hover === null || hover === n ? 1 : 0.45} />}
                  {(n === 1 || n % 5 === 0) && <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-gris)">{n}</text>}
                </g>
              );
            })}
          </svg>
          {h && (
            <div className="pointer-events-none absolute top-0 rounded-sm border-2 border-tinta bg-papel px-3 py-2 text-[13px] shadow-solida-sm"
              style={{ left: `clamp(0px, calc(${((L + (h.n - 0.5) * pw) / W) * 100}% - 80px), calc(100% - 170px))`, width: 170 }}>
              <div className="font-bold">{h.n} de {new Date(Date.UTC(y, mo - 1, h.n)).toLocaleDateString('es-MX', { month: 'long', timeZone: 'UTC' })}</div>
              {h.d ? (<><div className="num">{mxn(h.d.paid)}</div><div className="text-gris num">{h.d.payments} pagos · {qty(h.d.quantity)} kg</div></>) : <div className="text-gris">Sin pagos</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}
const compact = (v: number) => (v >= 1000 ? `$${(v / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })}k` : `$${v}`);
