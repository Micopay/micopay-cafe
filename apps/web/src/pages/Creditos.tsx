import { api } from '../api';
import { Cargando, ErrorCaja, Titulo } from '../App';
import { fecha, mxn } from '../format';
import { Badge, Card, Label } from '../ui';
import { useData } from '../useData';

export default function Creditos() {
  const credits = useData(api.credits);
  return (
    <>
      <Titulo cintillo="Avío">Créditos</Titulo>
      <p className="max-w-[720px] text-gris mb-7">
        El crédito se paga con la cosecha: cada liquidación descuenta un abono y lo manda al prestamista
        <b className="text-tinta"> en la misma transacción de Stellar</b> que paga al productor. El contrato del crédito
        es privado y vive en la base de la cooperativa; en la cadena solo quedan los movimientos y su huella.
      </p>
      {credits.error && <ErrorCaja mensaje={credits.error} />}
      {!credits.data ? <Cargando /> : (
        <div className="grid gap-5">
          {credits.data.map((c) => {
            const pagado = Number(c.principal) - Number(c.outstanding);
            const pct = Math.min(100, (pagado / Number(c.principal)) * 100);
            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><span className="font-display text-[20px] font-extrabold num">{c.reference}</span>
                      <Badge tono={c.status === 'active' ? 'naranja' : 'verde'}>{c.status === 'active' ? 'Vigente' : 'Pagado'}</Badge></div>
                    <div className="text-[14px] text-gris mt-1">{c.producer} · {c.purpose} · otorgado {fecha(c.created_at)}</div>
                    <div className="text-[13px] text-gris">Prestamista: {c.lender} · abono del {Number(c.repayment_percent)}% de cada liquidación</div>
                  </div>
                  <div className="text-right">
                    <Label>Por pagar</Label>
                    <div className="num mt-1 font-display text-[28px] font-extrabold text-naranja leading-none">{mxn(c.outstanding)}</div>
                  </div>
                </div>
                <div className="mt-5 h-4 border-2 border-tinta rounded-sm bg-fondo overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-verde" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[13px] num"><span>Pagado {mxn(pagado)}</span><span className="text-gris">de {mxn(c.principal)}</span></div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
