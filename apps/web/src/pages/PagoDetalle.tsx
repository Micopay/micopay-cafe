import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { BarraPanel, Cargando, Doc, ErrorCaja, EstadoPago, Panel, Titulo, Tx } from '../comun';
import { fecha, mxn, qty } from '../format';
import { Button, Icon } from '../ui';
import { useData } from '../useData';

export default function PagoDetalle() {
  const id = Number(useParams().id);
  const p = useData(() => api.payment(id), [id]);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (p.error) return <ErrorCaja mensaje={p.error} />;
  if (!p.data) return <Cargando />;
  const d = p.data;

  async function reintentar() {
    setRetrying(true); setError(null);
    try {
      const r = await api.retry(id);
      if (r.status !== 'settled') setError('Stellar volvió a rechazar la transacción.');
      p.reload();
    } catch (e) { setError((e as Error).message); } finally { setRetrying(false); }
  }

  return (
    <>
      <Titulo cintillo="Detalle del pago" accion={
        <div className="flex gap-3">
          {d.status === 'paid' && <Link to={`/recibo/${d.id}`} target="_blank"><Button variant="ghost"><Icon name="receipt_long" /> Recibo del productor</Button></Link>}
          {d.status === 'pending' && <Button disabled={retrying} onClick={reintentar}>{retrying ? 'Reintentando…' : 'Reintentar pago'}</Button>}
        </div>
      }><span className="num">{d.reference}</span></Titulo>
      {error && <div className="mb-5"><ErrorCaja mensaje={error} /></div>}

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Panel>
          <BarraPanel>Entrega</BarraPanel>
          <dl className="p-5 grid gap-2.5 text-[15px]">
            <Fila e="Productor" v={<Link to={`/productores/${d.producer_id}`} className="underline font-bold">{d.producer}</Link>} />
            <Fila e="Fecha" v={fecha(d.created_at)} />
            <Fila e="Producto" v={`${d.product}${d.lot ? ` · ${d.lot}` : ''}`} />
            {Object.entries(d.quality ?? {}).map(([k, v]) => <Fila key={k} e={k[0]!.toUpperCase() + k.slice(1)} v={`${v}%`} />)}
            {d.notes && <Fila e="Notas" v={d.notes} />}
            <div className="border-t-2 border-tinta mt-1 pt-3" />
            <Fila e={`${qty(d.quantity)} ${d.unit} × ${mxn(d.unit_price)}`} v={mxn(d.gross)} />
            {d.deductions.map((x) => <Fila key={x.reason} e={`Castigo: ${x.label}`} v={`− ${mxn(x.amount)}`} tono="text-rojo" />)}
            {Number(d.credit_repayment) > 0 && <Fila e={`Abono a crédito ${d.credit_ref}`} v={`− ${mxn(d.credit_repayment)}`} tono="text-naranja" />}
            <Fila e="Pagado al productor" v={mxn(d.net)} tono="text-verde font-extrabold text-[18px]" />
          </dl>
        </Panel>

        <Panel>
          <BarraPanel>Liquidación en Stellar e ISO 20022</BarraPanel>
          <dl className="p-5 grid gap-2.5 text-[14px]">
            <Fila e="Estado" v={<EstadoPago s={d.status} />} />
            {d.result_code && <Fila e="Código de rechazo" v={d.result_code} tono="text-rojo" />}
            <Fila e="Transacción" v={<Tx hash={d.tx_hash} n={10} />} />
            <Fila e="Liquidado" v={d.settled_at ? fecha(d.settled_at) : '—'} />
            <Fila e="Orden (MsgId)" v={<span className="num">{d.msg_id ?? '—'}</span>} />
            <Fila e="EndToEndId" v={<span className="num">{d.end_to_end_id ?? '—'}</span>} />
            <Fila e="UETR" v={<span className="num text-[12px] break-all">{d.uetr ?? '—'}</span>} />
          </dl>
          {d.pain001_sha256 && (
            <div className="mx-5 mb-4 border-2 border-linea rounded-sm p-3">
              <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">Huella del pain.001 = memo de la transacción</div>
              <div className="num text-[12px] break-all mt-1">{d.pain001_sha256}</div>
            </div>
          )}
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            {d.run_id && <Doc href={`/api/runs/${d.run_id}/pain001`} nombre="pain.001" desc="Orden de pago" />}
            {d.run_id && <Doc href={`/api/runs/${d.run_id}/pain002`} nombre="pain.002" desc="Estado" />}
            {d.status === 'paid' && <Doc href={`/api/payments/${d.id}/camt054`} nombre="camt.054" desc="Aviso al productor" />}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Fila({ e, v, tono = '' }: { e: string; v: React.ReactNode; tono?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-gris">{e}</dt>
      <dd className={`num text-right ${tono}`}>{v}</dd>
    </div>
  );
}
