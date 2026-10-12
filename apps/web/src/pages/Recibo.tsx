import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Cargando, ErrorCaja } from '../App';
import { fecha, mxn, qty, short } from '../format';
import { Card, Icon, Label, MoneyBlock } from '../ui';
import { useData } from '../useData';

/* Lo que ve el productor en su teléfono: cuánto entregó, cómo se calculó y cómo cobrar. */
export default function Recibo() {
  const { id } = useParams();
  const s = useData(() => api.settlement(Number(id)), [id]);
  if (s.error) return <ErrorCaja mensaje={s.error} />;
  if (!s.data) return <Cargando />;
  const r = s.data;
  const pagado = r.status === 'paid';

  return (
    <div className="grid gap-5">
      <MoneyBlock
        etiqueta={pagado ? `Recibiste · ${fecha(r.settled_at ?? r.created_at)}` : 'Por recibir'}
        cifra={mxn(r.net)}
        tipo="saldo"
        pie={<>{r.producer} · {r.community}</>}
      />

      <Card>
        <Label>Tu entrega {r.reference}</Label>
        <dl className="mt-4 grid gap-2.5 text-[15px]">
          <Fila etiqueta={`${qty(r.quantity)} ${r.unit} ${r.product.toLowerCase()} × ${mxn(r.unit_price)}`} valor={mxn(r.gross)} />
          {r.deductions.map((d) => <Fila key={d.reason} etiqueta={`Castigo: ${d.label}`} valor={`− ${mxn(d.amount)}`} tono="text-rojo" />)}
          {Number(r.credit_repayment) > 0 && <Fila etiqueta={`Abono a tu crédito ${r.credit_ref}`} valor={`− ${mxn(r.credit_repayment)}`} tono="text-naranja" />}
          <div className="border-t-2 border-tinta pt-2.5"><Fila etiqueta="Recibiste" valor={mxn(r.net)} tono="text-verde font-extrabold" /></div>
        </dl>
        {r.credit_ref && r.credit_outstanding && (
          <p className="mt-3 text-[13px] text-gris">Te quedan <b className="text-tinta num">{mxn(r.credit_outstanding)}</b> por pagar del crédito {r.credit_ref}.</p>
        )}
      </Card>

      <Card plana>
        <Label>Cómo cobrar</Label>
        <ul className="mt-3 grid gap-2.5 text-[14px]">
          <li className="flex gap-2.5"><Icon name="account_balance_wallet" className="text-verde" /> Déjalo en tu app de MicoPay, en pesos digitales.</li>
          <li className="flex gap-2.5"><Icon name="account_balance" className="text-verde" /> Mándalo a tu banco por SPEI.</li>
          <li className="flex gap-2.5"><Icon name="payments" className="text-naranja" /> Cámbialo a efectivo con un agente de la Red MicoPay.</li>
        </ul>
      </Card>

      {pagado && r.tx_hash && (
        <Card plana className="text-[13px]">
          <Label>Comprobante</Label>
          <p className="mt-3 text-gris">Este pago está registrado en Stellar y nadie puede cambiarlo.</p>
          <a href={`https://stellar.expert/explorer/testnet/tx/${r.tx_hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-bold text-verde underline num">
            Verificar {short(r.tx_hash, 8)} <Icon name="open_in_new" size={16} />
          </a>
          <div className="mt-2"><a href={`/api/settlements/${r.id}/camt054`} target="_blank" rel="noreferrer" className="underline">Aviso bancario ISO 20022 (camt.054)</a></div>
          <div className="mt-1 text-gris num break-all">Referencia de rastreo (UETR): {r.uetr}</div>
        </Card>
      )}
    </div>
  );
}

function Fila({ etiqueta, valor, tono = '' }: { etiqueta: string; valor: string; tono?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gris">{etiqueta}</dt>
      <dd className={`num font-bold whitespace-nowrap ${tono}`}>{valor}</dd>
    </div>
  );
}
