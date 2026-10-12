import { Link } from 'react-router-dom';
import { api } from '../api';
import { Cargando, ErrorCaja, Titulo } from '../App';
import { fecha, mxn, qty, short } from '../format';
import { Badge, Button, Card, Icon, MoneyBlock } from '../ui';
import { useData } from '../useData';

export default function Panel() {
  const summary = useData(api.summary);
  const runs = useData(api.runs);
  const s = summary.data;

  return (
    <>
      <Titulo cintillo="Cooperativa" accion={<Link to="/entregas/nueva"><Button><Icon name="add_circle" /> Registrar entrega</Button></Link>}>
        {s?.cooperative.name ?? 'Panel'}
      </Titulo>
      {summary.error && <ErrorCaja mensaje={summary.error} />}
      {!s ? <Cargando /> : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <MoneyBlock
              etiqueta={`Saldo en Stellar · ${s.asset.code}`}
              cifra={s.balance === null ? '—' : mxn(s.balance)}
              tipo="saldo"
              pie={<span className="num">Cuenta {short(s.cooperative.stellar_address)} · {s.network.toLowerCase()}</span>}
            />
            <MoneyBlock
              etiqueta={`Por pagar · ${s.pending_count} liquidaciones`}
              cifra={mxn(s.pending_total)}
              tipo="cobro"
              pie={<Link to="/pagos" className="underline font-semibold text-papel">Pagar corrida →</Link>}
            />
          </div>

          <div className="mt-5 grid gap-5 grid-cols-2 md:grid-cols-4">
            <Dato etiqueta="Pagado a productores" valor={mxn(s.paid_total)} />
            <Dato etiqueta="Kilos liquidados" valor={`${qty(s.paid_quantity)} kg`} />
            <Dato etiqueta="Productores" valor={String(s.producers)} />
            <Dato etiqueta="Crédito por recuperar" valor={mxn(s.credit_outstanding)} />
          </div>
        </>
      )}

      <section className="mt-10">
        <h2 className="font-display text-[22px] font-extrabold mb-4" style={{ fontVariationSettings: '"wdth" 108' }}>Últimas corridas</h2>
        {runs.data?.length === 0 && <p className="text-gris">Todavía no hay pagos. Registra una entrega para empezar.</p>}
        <div className="grid gap-3">
          {runs.data?.slice(0, 5).map((r) => (
            <Card key={r.id} plana className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-bold num">{r.msg_id}</div>
                <div className="text-[13px] text-gris num">{fecha(r.created_at)} · {r.payments} pagos · abonos {mxn(r.repayments)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="num font-extrabold text-[18px]">{mxn(r.total)}</span>
                <Badge tono={r.status === 'settled' ? 'verde' : 'aviso'}>{r.status === 'settled' ? 'Liquidada' : r.status}</Badge>
                {r.explorer && <a href={r.explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-verde font-bold text-[14px] underline">Stellar <Icon name="open_in_new" size={16} /></a>}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Card plana>
      <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">{etiqueta}</div>
      <div className="num mt-1.5 font-display text-[22px] font-extrabold leading-none" style={{ fontVariationSettings: '"wdth" 106' }}>{valor}</div>
    </Card>
  );
}
