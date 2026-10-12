import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type CreditStatus } from '../../api';
import { BarraPanel, Cargando, Dato, ErrorCaja, EstadoCredito, Panel, Select, Tabla, td, tdNum, Titulo } from '../../comun';
import { dia, mxn } from '../../format';
import { Button, Icon, Pill, TextField } from '../../ui';
import { useData } from '../../useData';

const FILTROS: Array<[string, string]> = [['', 'Todos'], ['pendiente', 'Pendientes'], ['vigente', 'Vigentes'], ['vencido', 'Vencidos'], ['pagado', 'Pagados'], ['cancelado', 'Cancelados']];

export default function Creditos() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState('');
  const [nuevo, setNuevo] = useState(params.get('nuevo') === '1');
  const all = useData(() => api.credits());
  const list = (all.data ?? []).filter((c) => !status || c.status === status);

  const sum = (s: CreditStatus[], k: 'outstanding' | 'principal') => (all.data ?? []).filter((c) => s.includes(c.status)).reduce((a, c) => a + Number(c[k]), 0);

  return (
    <>
      <Titulo cintillo={t('Administración')} accion={
        <div className="flex gap-3">
          <a href="/api/credits.csv"><Button variant="ghost"><Icon name="arrow_upward" /> {t('Exportar cartera')}</Button></a>
          {!nuevo && <Button onClick={() => setNuevo(true)}><Icon name="add_circle" /> {t('Otorgar crédito')}</Button>}
        </div>
      }>{t('Créditos')}</Titulo>

      <p className="max-w-[760px] text-gris mb-6 text-[15px]">
        {t('El crédito se otorga aquí, el prestamista lo desembolsa en Stellar y se cobra con la cosecha: en cada pago se descuenta el abono y llega al prestamista ')}
        <b className="text-tinta">{t('en la misma transacción')}</b>{t('. Los términos son privados; en la cadena queda su huella SHA-256.')}
      </p>

      {nuevo && <Alta productorInicial={params.get('productor')} onClose={() => setNuevo(false)} />}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 mb-6">
        <Dato etiqueta={t('Por recuperar')} valor={mxn(sum(['vigente', 'vencido'], 'outstanding'))} tono="text-naranja" />
        <Dato etiqueta={t('Vencido')} valor={mxn(sum(['vencido'], 'outstanding'))} tono={sum(['vencido'], 'outstanding') ? 'text-rojo' : ''} />
        <Dato etiqueta={t('Por desembolsar')} valor={mxn(sum(['pendiente'], 'principal'))} />
        <Dato etiqueta={t('Créditos vigentes')} valor={(all.data ?? []).filter((c) => c.status === 'vigente').length} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">{FILTROS.map(([v, l]) => <Pill key={v} activa={status === v} onClick={() => setStatus(v)}>{t(l)}</Pill>)}</div>

      {all.error && <ErrorCaja mensaje={all.error} />}
      {!all.data ? <Cargando /> : (
        <Panel>
          <Tabla cabeceras={[t('Crédito'), t('Productor'), t('Destino'), t('Prestamista'), { t: t('Total'), derecha: true }, { t: t('Pagado'), derecha: true }, { t: t('Saldo'), derecha: true }, t('Vence'), t('Estado')]}
            vacio={list.length === 0 && t('No hay créditos con ese estado.')}>
            {list.map((c) => (
              <tr key={c.id}>
                <td className={`${td} whitespace-nowrap`}><Link to={`/admin/creditos/${c.id}`} className="underline font-bold num">{c.reference}</Link></td>
                <td className={td}>{c.producer}</td>
                <td className={td}>{t(c.purpose)}</td>
                <td className={`${td} text-[13px]`}>{t(c.lender)}</td>
                <td className={tdNum}>{mxn(c.total_due)}</td>
                <td className={`${tdNum} text-verde`}>{mxn(c.repaid)}</td>
                <td className={`${tdNum} font-bold`}>{mxn(c.outstanding)}</td>
                <td className={`${td} num whitespace-nowrap`}>{dia(c.due_date)}</td>
                <td className={td}><EstadoCredito s={c.status} />{!c.auto_deduct && c.status === 'vigente' && <div className="text-[11px] text-gris mt-1">{t('descuento pausado')}</div>}</td>
              </tr>
            ))}
          </Tabla>
        </Panel>
      )}
    </>
  );
}

function Alta({ productorInicial, onClose }: { productorInicial: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const producers = useData(() => api.producers());
  const lenders = useData(api.lenders);
  const vencimientoSugerido = useMemo(() => { const d = new Date(); d.setMonth(d.getMonth() + 8); return d.toISOString().slice(0, 10); }, []);
  const [f, setF] = useState({ producerId: productorInicial ?? '', lenderId: '', purpose: '', principal: '', annualRate: '8.5', termMonths: '8', repaymentPercent: '25', dueDate: vencimientoSugerido });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value.replace(',', '.') });

  // Same formula as the API (credits.ts): simple interest fixed at origination.
  const principal = Number(f.principal), rate = Number(f.annualRate), months = Number(f.termMonths);
  const ok = principal > 0 && rate >= 0 && Number.isInteger(months) && months > 0;
  const interest = ok ? Math.round(principal * rate / 100 * months / 12 * 100) / 100 : 0;
  const lenderId = f.lenderId || String(lenders.data?.[0]?.id ?? '');

  async function guardar() {
    setBusy(true); setError(null);
    try {
      const r = await api.createCredit({ producerId: Number(f.producerId), lenderId: Number(lenderId), purpose: f.purpose, principal: f.principal,
        annualRate: f.annualRate, termMonths: months, repaymentPercent: f.repaymentPercent, dueDate: f.dueDate });
      navigate(`/admin/creditos/${r.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Panel sombra className="mb-8">
      <BarraPanel>{t('Otorgar crédito')}</BarraPanel>
      <div className="p-5 grid gap-4 md:grid-cols-3">
        <Select etiqueta={t('Productor')} value={f.producerId} onChange={set('producerId')}>
          <option value="">{t('Elige…')}</option>{producers.data?.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select etiqueta={t('Prestamista')} value={lenderId} onChange={set('lenderId')}>
          {lenders.data?.map((l) => <option key={l.id} value={l.id}>{t(l.name)}</option>)}
        </Select>
        <TextField etiqueta={t('Destino')} placeholder={t('Ej. Avío: fertilizante y jornales')} value={f.purpose} onChange={set('purpose')} />
        <TextField etiqueta={t('Monto (MXN)')} inputMode="decimal" className="num" value={f.principal} onChange={set('principal')} />
        <TextField etiqueta={t('Tasa anual (%)')} inputMode="decimal" className="num" value={f.annualRate} onChange={set('annualRate')} ayuda={t('Cosechando Soberanía: 8.5%')} />
        <TextField etiqueta={t('Plazo (meses)')} inputMode="numeric" className="num" value={f.termMonths} onChange={set('termMonths')} />
        <TextField etiqueta={t('Abono por entrega (%)')} inputMode="decimal" className="num" value={f.repaymentPercent} onChange={set('repaymentPercent')} ayuda={t('Se descuenta de cada liquidación')} />
        <TextField etiqueta={t('Vencimiento')} type="date" value={f.dueDate} onChange={set('dueDate')} />
        <div className="rounded-sm border-2 border-tinta bg-fondo p-4 text-[14px]">
          <div className="flex justify-between"><span className="text-gris">{t('Interés')}</span><b className="num">{mxn(interest)}</b></div>
          <div className="flex justify-between mt-1"><span className="text-gris">{t('Total a pagar')}</span><b className="num text-naranja">{mxn(ok ? principal + interest : 0)}</b></div>
        </div>
        {error && <div className="md:col-span-3"><ErrorCaja mensaje={error} /></div>}
        <div className="md:col-span-3 flex gap-3">
          <Button disabled={busy || !ok || !f.producerId || f.purpose.trim().length < 3} onClick={guardar}>{busy ? t('Guardando…') : t('Registrar crédito')}</Button>
          <Button variant="ghost" onClick={onClose}>{t('Cancelar')}</Button>
        </div>
        <p className="md:col-span-3 text-[12px] text-gris">{t('Queda ')}<b>{t('pendiente')}</b>{t(' hasta que el prestamista lo desembolse. No se descuenta nada mientras esté pendiente.')}</p>
      </div>
    </Panel>
  );
}
