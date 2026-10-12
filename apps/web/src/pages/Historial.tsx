import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Payment, type PaymentFilters } from '../api';
import { Cargando, ErrorCaja, EstadoPago, Panel, Select, Tabla, td, tdNum, Titulo, Tx } from '../comun';
import { fecha, hoy, mxn, qty } from '../format';
import { Button, Icon, TextField } from '../ui';
import { useData } from '../useData';

const PAGE = 50;

export default function Historial() {
  const [draft, setDraft] = useState<PaymentFilters>({ from: '', to: hoy(), status: '' });
  const [filters, setFilters] = useState<PaymentFilters>({});
  const [extra, setExtra] = useState<Payment[]>([]);
  const [more, setMore] = useState(true);
  const producers = useData(() => api.producers());
  const page = useData(async () => {
    const rows = await api.payments({ ...filters, limit: PAGE });
    setExtra([]); setMore(rows.length === PAGE);
    return rows;
  }, [JSON.stringify(filters)]);

  async function cargarMas() {
    const rows = await api.payments({ ...filters, limit: PAGE, offset: (page.data?.length ?? 0) + extra.length });
    setExtra([...extra, ...rows]); setMore(rows.length === PAGE);
  }
  const rows = [...(page.data ?? []), ...extra];

  return (
    <>
      <Titulo cintillo="Pagos" accion={<a href={api.paymentsCsvUrl(filters)}><Button variant="ghost"><Icon name="arrow_upward" /> Exportar a Excel (CSV)</Button></a>}>Historial de pagos</Titulo>

      <Panel className="mb-6 p-4">
        <form className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_1.4fr_auto] items-end" onSubmit={(e) => { e.preventDefault(); setFilters({ ...draft }); }}>
          <TextField etiqueta="Desde" type="date" value={draft.from ?? ''} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <TextField etiqueta="Hasta" type="date" value={draft.to ?? ''} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <Select etiqueta="Estado" value={draft.status ?? ''} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">Todos</option><option value="paid">Pagado</option><option value="pending">Rechazado</option>
          </Select>
          <Select etiqueta="Productor" value={draft.producerId ?? ''} onChange={(e) => setDraft({ ...draft, producerId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Todos</option>{producers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button type="submit">Aplicar</Button>
        </form>
      </Panel>

      {page.error && <ErrorCaja mensaje={page.error} />}
      {!page.data ? <Cargando /> : (
        <Panel>
          <Tabla cabeceras={['Fecha', 'Productor', 'Entrega', { t: 'Cantidad', derecha: true }, { t: 'Bruto', derecha: true }, { t: 'Castigos', derecha: true }, { t: 'Abono', derecha: true }, { t: 'Pagado', derecha: true }, 'Estado', 'Stellar']}
            vacio={rows.length === 0 && 'Sin pagos para los filtros seleccionados.'}>
            {rows.map((p) => {
              const castigos = p.deductions.reduce((a, d) => a + Number(d.amount), 0);
              return (
                <tr key={p.id}>
                  <td className={`${td} num whitespace-nowrap`}>{fecha(p.created_at)}</td>
                  <td className={td}><span className="font-bold">{p.producer}</span></td>
                  <td className={`${td} whitespace-nowrap`}><Link to={`/historial/${p.id}`} className="underline num font-bold">{p.reference}</Link><div className="text-[12px] text-gris">{p.product}</div></td>
                  <td className={tdNum}>{qty(p.quantity)} {p.unit}</td>
                  <td className={tdNum}>{mxn(p.gross)}</td>
                  <td className={`${tdNum} text-rojo`}>{castigos ? `− ${mxn(castigos)}` : '—'}</td>
                  <td className={`${tdNum} text-naranja`}>{Number(p.credit_repayment) ? `− ${mxn(p.credit_repayment)}` : '—'}</td>
                  <td className={`${tdNum} font-extrabold`}>{mxn(p.net)}</td>
                  <td className={td}><EstadoPago s={p.status} /></td>
                  <td className={td}><Tx hash={p.tx_hash} /></td>
                </tr>
              );
            })}
          </Tabla>
          {more && rows.length > 0 && <div className="p-3 border-t border-linea"><Button variant="ghost" onClick={cargarMas}>Cargar más…</Button></div>}
        </Panel>
      )}
    </>
  );
}
