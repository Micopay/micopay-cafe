import { useParams } from 'react-router-dom';
import { t } from '../i18n';
import { api } from '../api';
import { Cargando, ErrorCaja } from '../comun';
import { fecha, mxn, qty, short } from '../format';
import { Card, Icon, Label, MoneyBlock } from '../ui';
import { useData } from '../useData';

/* Lo que ve el productor en su teléfono: cuánto entregó, cómo se calculó y cómo cobrar. */
export default function Recibo() {
  const { id } = useParams();
  const s = useData(() => api.payment(Number(id)), [id]);
  if (s.error) return <ErrorCaja mensaje={s.error} />;
  if (!s.data) return <Cargando />;
  const r = s.data;
  const pagado = r.status === 'paid';

  return (
    <div className="grid gap-5">
      <MoneyBlock
        etiqueta={pagado ? t('Recibiste · {date}', { date: fecha(r.settled_at ?? r.created_at) }) : t('Por recibir')}
        cifra={mxn(r.net)}
        tipo="saldo"
        pie={<>{r.producer} · {r.community}</>}
      />

      <Card>
        <Label>{t('Tu entrega {ref}', { ref: r.reference })}</Label>
        <dl className="mt-4 grid gap-2.5 text-[15px]">
          <Fila etiqueta={`${qty(r.quantity)} ${r.unit} ${t(r.product).toLowerCase()} × ${mxn(r.unit_price)}`} valor={mxn(r.gross)} />
          {r.deductions.map((d) => <Fila key={d.reason} etiqueta={t('Castigo: {label}', { label: d.label })} valor={`− ${mxn(d.amount)}`} tono="text-rojo" />)}
          {Number(r.credit_repayment) > 0 && <Fila etiqueta={t('Abono a tu crédito {ref}', { ref: r.credit_ref ?? '' })} valor={`− ${mxn(r.credit_repayment)}`} tono="text-naranja" />}
          <div className="border-t-2 border-tinta pt-2.5"><Fila etiqueta={t('Recibiste')} valor={mxn(r.net)} tono="text-verde font-extrabold" /></div>
        </dl>
        {r.credit_ref && r.credit_outstanding && (
          <p className="mt-3 text-[13px] text-gris num">{t('Te quedan {amount} por pagar del crédito {ref}.', { amount: mxn(r.credit_outstanding), ref: r.credit_ref })}</p>
        )}
      </Card>

      <Card plana>
        <Label>{t('Cómo cobrar')}</Label>
        <ul className="mt-3 grid gap-2.5 text-[14px]">
          <li className="flex gap-2.5"><Icon name="account_balance_wallet" className="text-verde" /> {t('Déjalo en tu app de MicoPay, en pesos digitales.')}</li>
          <li className="flex gap-2.5"><Icon name="account_balance" className="text-verde" /> {t('Mándalo a tu banco por SPEI.')}</li>
          <li className="flex gap-2.5"><Icon name="payments" className="text-naranja" /> {t('Cámbialo a efectivo con un agente de la Red MicoPay, o ahí mismo si tu compradora es agente.')}</li>
        </ul>
      </Card>

      {pagado && r.tx_hash && (
        <Card plana className="text-[13px]">
          <Label>{t('Comprobante')}</Label>
          <p className="mt-3 text-gris">{t('Este pago está registrado en Stellar y nadie puede cambiarlo.')}</p>
          <a href={`https://stellar.expert/explorer/testnet/tx/${r.tx_hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 font-bold text-verde underline num">
            {t('Verificar {hash}', { hash: short(r.tx_hash, 8) })} <Icon name="open_in_new" size={16} />
          </a>
          <div className="mt-2"><a href={`/api/payments/${r.id}/camt054`} target="_blank" rel="noreferrer" className="underline">{t('Aviso bancario ISO 20022 (camt.054)')}</a></div>
          <div className="mt-1 text-gris num break-all">{t('Referencia de rastreo (UETR): {uetr}', { uetr: r.uetr ?? '' })}</div>
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
