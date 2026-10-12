import { api } from '../api';
import { Cargando, ErrorCaja, Titulo } from '../App';
import { mxn, qty, short } from '../format';
import { Badge, Card } from '../ui';
import { useData } from '../useData';

export default function Productores() {
  const producers = useData(api.producers);
  return (
    <>
      <Titulo cintillo="Socios">Productores</Titulo>
      {producers.error && <ErrorCaja mensaje={producers.error} />}
      {!producers.data ? <Cargando /> : (
        <div className="grid gap-4 md:grid-cols-3">
          {producers.data.map((p) => (
            <Card key={p.id}>
              <div className="font-display text-[20px] font-extrabold leading-tight" style={{ fontVariationSettings: '"wdth" 106' }}>{p.name}</div>
              <div className="text-gris text-[14px]">{p.community}</div>
              <dl className="mt-4 grid gap-1.5 text-[14px]">
                <div className="flex justify-between"><dt className="text-gris">Entregado</dt><dd className="num font-bold">{qty(p.delivered)} kg</dd></div>
                <div className="flex justify-between"><dt className="text-gris">Cobrado</dt><dd className="num font-bold text-verde">{mxn(p.paid)}</dd></div>
                <div className="flex justify-between"><dt className="text-gris">Cuenta Stellar</dt><dd className="num">{short(p.stellar_address)}</dd></div>
              </dl>
              {p.credit && (
                <div className="mt-4 border-t-2 border-tinta pt-3 flex items-center justify-between text-[14px]">
                  <span>Crédito <b className="num">{p.credit.reference}</b></span>
                  {p.credit.status === 'active' ? <Badge tono="naranja">Debe {mxn(p.credit.outstanding)}</Badge> : <Badge tono="verde">Pagado</Badge>}
                </div>
              )}
              <p className="mt-3 text-[12px] text-gris">Cobra en su app de MicoPay: lo deja digital, lo manda a su banco por SPEI o lo cambia a efectivo con un agente.</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
