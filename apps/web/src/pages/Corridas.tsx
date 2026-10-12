import { Link } from 'react-router-dom';
import { api } from '../api';
import { Cargando, ErrorCaja, Titulo } from '../App';
import { fecha, mxn, short } from '../format';
import { Badge, Button, Card, Icon, Label } from '../ui';
import { useData } from '../useData';

export default function Corridas() {
  const runs = useData(api.runs);
  const paid = useData(() => api.settlements('paid'));

  return (
    <>
      <Titulo cintillo="ISO 20022 + Stellar" accion={
        <a href="/api/statement" target="_blank" rel="noreferrer"><Button variant="ghost"><Icon name="account_balance" /> Estado de cuenta (camt.053)</Button></a>
      }>Corridas</Titulo>
      {runs.error && <ErrorCaja mensaje={runs.error} />}
      {!runs.data ? <Cargando /> : runs.data.length === 0 ? <p className="text-gris">Aún no hay corridas.</p> : (
        <div className="grid gap-5">
          {runs.data.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2"><span className="font-display text-[20px] font-extrabold num">{r.msg_id}</span>
                    <Badge tono={r.status === 'settled' ? 'verde' : 'aviso'}>{r.status === 'settled' ? 'Liquidada' : r.status}</Badge></div>
                  <div className="text-[13px] text-gris num mt-1">{fecha(r.created_at)} · {r.payments} pagos · {mxn(r.total)} a productores · {mxn(r.repayments)} en abonos</div>
                </div>
                {r.explorer && <a href={r.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-verde font-bold underline">Transacción en Stellar <Icon name="open_in_new" size={16} /></a>}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="border-2 border-linea rounded-sm p-3">
                  <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">Huella del pain.001 = memo de la transacción</div>
                  <div className="num text-[13px] break-all mt-1">{r.pain001_sha256}</div>
                </div>
                <div className="border-2 border-linea rounded-sm p-3">
                  <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">Hash de la transacción</div>
                  <div className="num text-[13px] break-all mt-1">{r.tx_hash ?? '—'}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Doc href={`/api/runs/${r.id}/pain001`} nombre="pain.001" desc="Orden de pago" />
                <Doc href={`/api/runs/${r.id}/pain002`} nombre="pain.002" desc="Estado" />
              </div>

              <div className="mt-5">
                <Label>Recibos</Label>
                <div className="mt-2 grid gap-2">
                  {paid.data?.filter((s) => s.run_id === r.id).map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-linea pt-2 text-[14px]">
                      <span><b>{s.producer}</b> · <span className="num">{s.reference}</span></span>
                      <span className="flex items-center gap-3">
                        <span className="num font-bold">{mxn(s.net)}</span>
                        <Doc href={`/api/settlements/${s.id}/camt054`} nombre="camt.054" />
                        <Link to={`/recibo/${s.id}`} className="font-bold underline text-naranja">Recibo</Link>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-4 text-[12px] text-gris">Cualquiera puede comprobarlo: descarga el pain.001, calcula su SHA-256 y compáralo con el memo de la transacción en {short('stellar.expert', 20)}.</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Doc({ href, nombre, desc }: { href: string; nombre: string; desc?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-sm border-2 border-tinta bg-papel px-3 py-1.5 text-[13px] font-bold">
      <Icon name="receipt_long" size={16} /> {nombre}{desc && <span className="font-normal text-gris">· {desc}</span>}
    </a>
  );
}
