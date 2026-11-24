import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { t } from '../i18n';
import { api, type ProducerRecord } from '../api';
import { Cargando, Dato, ErrorCaja, EstadoCredito, EstadoPago, Panel, Subtitulo, Tabla, td, tdNum, Titulo, Tx } from '../comun';
import { dia, fecha, mxn, qty, short, hoy } from '../format';
import { Badge, Button, Icon, TextField } from '../ui';
import { useData } from '../useData';

const CUENTA = { ok: ['verde', 'Puede recibir pagos'], sin_cuenta: ['aviso', 'Cuenta de Stellar no existe'], sin_trustline: ['aviso', 'Falta activar MXNe'] } as const;

function defaultRecordFrom(to: string) {
  const [year = 0, month = 1, day = 1] = to.split('-').map(Number);
  const targetYear = year - 1;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function HistorialProductor({ id }: { id: number }) {
  const [to, setTo] = useState(hoy());
  const [from, setFrom] = useState(() => defaultRecordFrom(hoy()));
  const [manifest, setManifest] = useState<ProducerRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setManifest(null);
    setError(null);
    setLoading(true);
    api.producerRecord(id, from, to)
      .then((result) => { if (active) setManifest(result); })
      .catch((cause: Error) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, from, to]);
  const currentManifest = manifest?.period.from === from && manifest.period.to === to ? manifest : null;

  function downloadJson(manifest: ProducerRecord) {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `historial-${id}-${from}-${to}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const pages = currentManifest ? Array.from(
    { length: Math.ceil(currentManifest.payments.length / 25) },
    (_, page) => currentManifest.payments.slice(page * 25, (page + 1) * 25),
  ) : [];

  return (
    <>
      <Subtitulo>{t('Historial del productor')}</Subtitulo>
      <Panel className="p-4 no-print rounded-lg">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <TextField className="rounded-lg" type="date" etiqueta={t('Desde')} value={from} onChange={(event) => setFrom(event.target.value)} />
          <TextField className="rounded-lg" type="date" etiqueta={t('Hasta')} value={to} onChange={(event) => setTo(event.target.value)} />
          <Button className="rounded-lg" variant="ghost" onClick={() => window.print()} disabled={!currentManifest?.payments.length}>
            {t('Imprimir')}
          </Button>
          <Button className="rounded-lg" variant="ghost" onClick={() => currentManifest && downloadJson(currentManifest)} disabled={!currentManifest}>
            {t('Descargar JSON')}
          </Button>
        </div>
        {error && <div className="mt-4"><ErrorCaja mensaje={error} /></div>}
        {!error && loading && <div className="mt-4"><Cargando /></div>}
        {currentManifest && (
          <p className="mt-4 text-[13px] text-gris">
            {t('Se excluyeron {count} pagos no liquidados.', { count: currentManifest.excluded.total })}
          </p>
        )}
      </Panel>

      {currentManifest && (
        <div className="record-print-area">
          <header className="record-print-heading">
            <h1>{t('Historial del productor')}</h1>
            <p className="font-bold">{currentManifest.producer.name}</p>
            <p>{currentManifest.producer.community ?? '—'}</p>
            <p className="record-address">{currentManifest.producer.stellar_address}</p>
            <p>{t('Periodo: {from} a {to}', { from, to })}</p>
            <p>{t('Generado: {date}', { date: dia(currentManifest.generated_at) })}</p>
          </header>
          {currentManifest.payments.length === 0 ? (
            <p className="border-2 border-tinta px-4 py-6">{t('No hay pagos en este periodo.')}</p>
          ) : (
            <>
              {pages.map((payments, page) => (
                <section key={page} className="record-print-page">
                  <table className="record-print-table">
                    <thead><tr>
                      <th>{t('Fecha')}</th><th>{t('Entrega')}</th><th>{t('Producto')}</th>
                      <th>{t('Kilos')}</th><th>{t('Precio')}</th><th>{t('Castigos de calidad')}</th>
                      <th>{t('Neto')}</th><th>{t('Transacción')}</th>
                    </tr></thead>
                    <tbody>{payments.map((payment) => (
                      <tr key={payment.reference}>
                        <td>{dia(payment.date)}</td>
                        <td className="num">{payment.reference}</td>
                        <td>{t(payment.product)}</td>
                        <td className="num">{qty(payment.kilos)} {payment.unit}</td>
                        <td className="num">{mxn(payment.unit_price_mxn)}</td>
                        <td className="num">{mxn(payment.quality_deductions_mxn)}</td>
                        <td className="num">{mxn(payment.net_mxn)}</td>
                        <td className="num"><a href={payment.explorer_url}>{short(payment.tx_hash, 6)}</a></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </section>
              ))}
              <div className="record-print-totals">
                <strong>{t('Totales')}</strong>
                <span>{t('Entregas')}: <b className="num">{currentManifest.totals.deliveries}</b></span>
                <span>{t('Kilos')}: <b className="num">{qty(currentManifest.totals.kilos)} kg</b></span>
                <span>{t('Neto recibido')}: <b className="num">{mxn(currentManifest.totals.net_mxn)}</b></span>
              </div>
            </>
          )}
          <p className="record-verification">{t('Cada pago puede verificarse en /verificar con su pain.001 y su transacción de Stellar.')}</p>
        </div>
      )}
    </>
  );
}

export default function ProductorDetalle() {
  const id = Number(useParams().id);
  const p = useData(() => api.producer(id), [id]);
  if (p.error) return <ErrorCaja mensaje={p.error} />;
  if (!p.data) return <Cargando />;
  const d = p.data;

  async function toggle() {
    await api.setProducerActive(id, !d.is_active);
    p.reload();
  }

  return (
    <>
      <Titulo cintillo={t('Productor · {id}', { id: d.account_id })} accion={
        <div className="flex gap-3">
          {d.is_active && <Link to={`/?productor=${d.id}`}><Button><Icon name="check_circle" /> {t('Seleccionar para pago')}</Button></Link>}
          <Button variant="ghost" onClick={toggle}>{t(d.is_active ? 'Desactivar' : 'Activar')}</Button>
        </div>
      }>{d.name}</Titulo>

      <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
        <Panel className="p-4 text-[14px]">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2">
            <dt className="text-gris">{t('Comunidad')}</dt><dd>{d.community ?? '—'}</dd>
            <dt className="text-gris">{t('Contacto')}</dt><dd>{d.contact ?? '—'}</dd>
            <dt className="text-gris">{t('Registrado')}</dt><dd>{dia(d.created_at)}</dd>
            <dt className="text-gris">{t('Estado')}</dt><dd>{d.is_active ? <Badge tono="verde">{t('Activo')}</Badge> : <Badge>{t('Inactivo')}</Badge>}</dd>
            <dt className="text-gris">Stellar</dt><dd className="num break-all text-[13px]">{d.stellar_address}</dd>
            <dt className="text-gris">{t('Cuenta')}</dt><dd><Badge tono={CUENTA[d.account][0]}>{t(CUENTA[d.account][1])}</Badge></dd>
          </dl>
          <p className="mt-3 text-[12px] text-gris">{t('Cobra en su app de MicoPay: lo deja digital, lo manda a su banco por SPEI o lo cambia a efectivo con un agente.')}</p>
        </Panel>
        <div className="grid grid-cols-2 gap-4">
          <Dato etiqueta={t('Entregas')} valor={d.stats.deliveries} />
          <Dato etiqueta={t('Total entregado')} valor={`${qty(d.stats.quantity)} kg`} />
          <Dato etiqueta={t('Total pagado')} valor={mxn(d.stats.paid)} tono="text-verde" />
          <Dato etiqueta={t('Último pago')} valor={d.stats.last_payment ? fecha(d.stats.last_payment) : '—'} />
        </div>
      </div>

      <HistorialProductor id={id} />

      <Subtitulo>{t('Historial de entregas')}</Subtitulo>
      <Panel>
        <Tabla cabeceras={[t('Fecha'), t('Entrega'), t('Producto'), { t: t('Cantidad'), derecha: true }, { t: t('Precio'), derecha: true }, { t: t('Abono'), derecha: true }, { t: t('Pagado'), derecha: true }, t('Estado'), 'Stellar']}
          vacio={d.history.length === 0 && t('Todavía no hay entregas.')}>
          {d.history.map((h) => (
            <tr key={h.id}>
              <td className={`${td} num whitespace-nowrap`}>{fecha(h.created_at)}</td>
              <td className={td}><Link to={`/historial/${h.id}`} className="underline num">{h.reference}</Link></td>
              <td className={td}>{t(h.product)}</td>
              <td className={tdNum}>{qty(h.quantity)} {h.unit}</td>
              <td className={tdNum}>{mxn(h.unit_price)}</td>
              <td className={`${tdNum} text-naranja`}>{Number(h.credit_repayment) ? mxn(h.credit_repayment) : '—'}</td>
              <td className={`${tdNum} font-bold`}>{mxn(h.net)}</td>
              <td className={td}><EstadoPago s={h.status} /></td>
              <td className={td}><Tx hash={h.tx_hash} /></td>
            </tr>
          ))}
        </Tabla>
      </Panel>

      <Subtitulo accion={<Link to={`/admin/creditos?nuevo=1&productor=${d.id}`} className="font-bold underline text-[14px]">{t('+ Otorgar crédito')}</Link>}>{t('Créditos')}</Subtitulo>
      <Panel>
        <Tabla cabeceras={[t('Crédito'), t('Destino'), { t: t('Total'), derecha: true }, { t: t('Saldo'), derecha: true }, t('Vence'), t('Estado')]} vacio={d.credits.length === 0 && t('Sin créditos.')}>
          {d.credits.map((c) => (
            <tr key={c.id}>
              <td className={`${td} whitespace-nowrap`}><Link to={`/admin/creditos/${c.id}`} className="underline font-bold num">{c.reference}</Link></td>
              <td className={td}>{t(c.purpose)}</td>
              <td className={tdNum}>{mxn(c.total_due)}</td>
              <td className={`${tdNum} font-bold`}>{mxn(c.outstanding)}</td>
              <td className={`${td} num`}>{dia(c.due_date)}</td>
              <td className={td}><EstadoCredito s={c.status} /></td>
            </tr>
          ))}
        </Tabla>
      </Panel>
    </>
  );
}
