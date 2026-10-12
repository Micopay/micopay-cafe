import { useState } from 'react';
import { t } from '../../i18n';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { BarraPanel, Cargando, Dato, ErrorCaja, EstadoCredito, Panel, Subtitulo, Tabla, td, tdNum, Titulo, Tx } from '../../comun';
import { dia, fecha, mxn } from '../../format';
import { Button, Icon, TextField } from '../../ui';
import { useData } from '../../useData';

export default function CreditoDetalle() {
  const id = Number(useParams().id);
  const c = useData(() => api.credit(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pct, setPct] = useState('');
  if (c.error) return <ErrorCaja mensaje={c.error} />;
  if (!c.data) return <Cargando />;
  const d = c.data;
  const pagado = Number(d.total_due) - Number(d.outstanding);
  const avance = Math.min(100, (pagado / Number(d.total_due)) * 100);
  const abierto = d.status === 'vigente' || d.status === 'vencido';

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label); setError(null); setOk(null);
    try { await fn(); setOk(done); c.reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <>
      <Titulo cintillo={t('Crédito · {name}', { name: d.producer })} accion={<EstadoCredito s={d.status} />}><span className="num">{d.reference}</span></Titulo>
      {error && <div className="mb-5"><ErrorCaja mensaje={error} /></div>}
      {ok && <div className="mb-5 border-2 border-tinta bg-verde-suave px-4 py-3 rounded-sm font-semibold text-[14px]">{ok}</div>}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Dato etiqueta={t('Capital')} valor={mxn(d.principal)} />
        <Dato etiqueta={t('Interés · {rate}% anual · {months} m', { rate: Number(d.annual_rate), months: d.term_months })} valor={mxn(d.interest)} />
        <Dato etiqueta={t('Pagado')} valor={mxn(pagado)} tono="text-verde" />
        <Dato etiqueta={t('Saldo')} valor={mxn(d.outstanding)} tono={d.status === 'vencido' ? 'text-rojo' : 'text-naranja'} />
      </div>
      <div className="mt-4 h-4 border-2 border-tinta rounded-sm bg-fondo overflow-hidden" role="progressbar" aria-label={t('Avance de pago')} aria-valuenow={Math.round(avance)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-verde" style={{ width: `${avance}%` }} />
      </div>
      <div className="mt-1.5 text-[13px] text-gris num">{t('{pct}% pagado de {total} · vence {date}', { pct: avance.toFixed(0), total: mxn(d.total_due), date: dia(d.due_date) })}</div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2 items-start">
        <Panel>
          <BarraPanel>{t('Términos')}</BarraPanel>
          <dl className="p-5 grid grid-cols-[170px_1fr] gap-y-2 text-[14px]">
            <dt className="text-gris">{t('Productor')}</dt><dd><Link to={`/productores/${d.producer_id}`} className="underline font-bold">{d.producer}</Link></dd>
            <dt className="text-gris">{t('Prestamista')}</dt><dd>{t(d.lender)}</dd>
            <dt className="text-gris">{t('Destino')}</dt><dd>{t(d.purpose)}</dd>
            <dt className="text-gris">{t('Abono por entrega')}</dt><dd className="num">{t('{pct}% de cada liquidación', { pct: Number(d.repayment_percent) })}</dd>
            <dt className="text-gris">{t('Descuento automático')}</dt><dd>{d.auto_deduct ? t('Activo') : <b className="text-naranja">{t('Pausado')}</b>}</dd>
            <dt className="text-gris">{t('Otorgado')}</dt><dd className="num">{fecha(d.created_at)}</dd>
            <dt className="text-gris">{t('Desembolsado')}</dt><dd>{d.disbursed_at ? <span className="num">{fecha(d.disbursed_at)} · <Tx hash={d.disbursement_tx} /></span> : '—'}</dd>
          </dl>
        </Panel>

        <Panel sombra>
          <BarraPanel>{t('Acciones')}</BarraPanel>
          <div className="p-5 grid gap-4 text-[14px]">
            {d.status === 'pendiente' && (
              <>
                <p className="text-gris">{t('El prestamista le paga a {name} en Stellar. El memo de la transacción será la huella de estos términos.', { name: d.producer.split(' ')[0]! })}</p>
                <Button disabled={busy !== null} onClick={() => run('d', () => api.disburse(id), t('Crédito desembolsado en Stellar.'))}>
                  <Icon name="lock" /> {busy === 'd' ? t('Firmando y enviando…') : t('Desembolsar {amount}', { amount: mxn(d.principal) })}
                </Button>
                <Button variant="peligro" disabled={busy !== null} onClick={() => run('c', () => api.cancelCredit(id), t('Crédito cancelado.'))}>{t('Cancelar crédito')}</Button>
              </>
            )}
            {abierto && (
              <>
                <Button variant="ghost" disabled={busy !== null} onClick={() => run('p', () => api.updateCredit(id, { autoDeduct: !d.auto_deduct }), t(d.auto_deduct ? 'Descuento pausado.' : 'Descuento reanudado.'))}>
                  {t(d.auto_deduct ? 'Pausar descuento automático' : 'Reanudar descuento automático')}
                </Button>
                <div className="flex gap-3 items-end">
                  <div className="flex-1"><TextField etiqueta={t('Nuevo % de abono por entrega')} inputMode="decimal" className="num" value={pct} onChange={(e) => setPct(e.target.value.replace(',', '.'))} /></div>
                  <Button variant="ghost" disabled={busy !== null || !/^\d+(\.\d{1,2})?$/.test(pct)}
                    onClick={() => run('r', () => api.updateCredit(id, { repaymentPercent: pct }), t('Abono cambiado a {pct}%.', { pct }))}>{t('Cambiar')}</Button>
                </div>
              </>
            )}
            {!abierto && d.status !== 'pendiente' && <p className="text-gris">{t('Este crédito está {status}; no admite cambios.', { status: t(d.status) })}</p>}
          </div>
        </Panel>
      </div>

      <Subtitulo>{t('Movimientos')}</Subtitulo>
      <Panel>
        <Tabla cabeceras={[t('Fecha'), t('Movimiento'), t('Entrega'), { t: t('Monto'), derecha: true }, { t: t('Saldo después'), derecha: true }, 'Stellar']}
          vacio={d.movements.length === 0 && t('Sin movimientos: el crédito no se ha desembolsado.')}>
          {d.movements.map((m) => (
            <tr key={m.id}>
              <td className={`${td} num whitespace-nowrap`}>{fecha(m.created_at)}</td>
              <td className={td}><b>{t(m.kind === 'desembolso' ? 'Desembolso' : 'Abono con la cosecha')}</b></td>
              <td className={td}>{m.settlement_id ? <Link to={`/historial/${m.settlement_id}`} className="underline num">{m.delivery}</Link> : '—'}</td>
              <td className={`${tdNum} ${m.kind === 'abono' ? 'text-verde' : ''}`}>{m.kind === 'abono' ? '− ' : ''}{mxn(m.amount)}</td>
              <td className={`${tdNum} font-bold`}>{mxn(m.balance_after)}</td>
              <td className={td}><Tx hash={m.tx_hash} /></td>
            </tr>
          ))}
        </Tabla>
      </Panel>

      <Subtitulo>{t('Verificación')}</Subtitulo>
      <Panel className="p-5 text-[14px]">
        <p className="text-gris">{t('Cualquiera puede comprobar que los términos no cambiaron: descarga el JSON, calcula su SHA-256 y compáralo con el memo de la transacción de desembolso.')}</p>
        <div className="mt-3 border-2 border-linea rounded-sm p-3">
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">{t('Huella SHA-256 de los términos')}</div>
          <div className="num text-[12px] break-all mt-1">{d.terms_sha256}</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <a href={`/api/credits/${d.id}/terms`} target="_blank" rel="noreferrer" className="font-bold underline">{t('Términos (JSON)')}</a>
          {d.disbursement_tx && <Tx hash={d.disbursement_tx} n={10} />}
        </div>
      </Panel>
    </>
  );
}
