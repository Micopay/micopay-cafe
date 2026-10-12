import { useState } from 'react';
import { t } from '../i18n';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { BarraPanel, Cargando, ErrorCaja, Panel, Tabla, td, tdNum, Titulo } from '../comun';
import { mxn, qty, short } from '../format';
import { Badge, Button, Icon, TextField } from '../ui';
import { useData } from '../useData';

export default function Productores() {
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(params.get('nuevo') === '1');
  const list = useData(() => api.producers(q), [q]);

  return (
    <>
      <Titulo cintillo={t('Socios')} accion={!nuevo && <Button onClick={() => setNuevo(true)}><Icon name="add_circle" /> {t('Nuevo productor')}</Button>}>{t('Productores')}</Titulo>
      {nuevo && <Alta onClose={() => setNuevo(false)} onCreated={list.reload} />}
      <div className="mb-4 max-w-[420px]"><TextField aria-label={t('Buscar productor')} placeholder={t('Buscar por nombre o comunidad')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.error && <ErrorCaja mensaje={list.error} />}
      {!list.data ? <Cargando /> : (
        <Panel>
          <Tabla cabeceras={[t('Productor'), t('Comunidad'), t('Cuenta'), { t: t('Entregado'), derecha: true }, { t: t('Cobrado'), derecha: true }, { t: t('Crédito'), derecha: true }, t('Estado')]}
            vacio={list.data.length === 0 && t('No hay productores con ese nombre.')}>
            {list.data.map((p) => (
              <tr key={p.id}>
                <td className={td}><Link to={`/productores/${p.id}`} className="font-bold underline">{p.name}</Link><div className="text-[12px] text-gris">{p.contact}</div></td>
                <td className={td}>{p.community}</td>
                <td className={`${td} num text-[13px]`}>{p.account_id}<div className="text-gris">{short(p.stellar_address)}</div></td>
                <td className={tdNum}>{qty(p.delivered)} kg</td>
                <td className={tdNum}>{mxn(p.paid)}</td>
                <td className={`${tdNum} ${Number(p.credit_outstanding) > 0 ? 'text-naranja font-bold' : 'text-gris'}`}>{Number(p.credit_outstanding) > 0 ? mxn(p.credit_outstanding) : '—'}</td>
                <td className={td}>{p.is_active ? <Badge tono="verde">{t('Activo')}</Badge> : <Badge>{t('Inactivo')}</Badge>}</td>
              </tr>
            ))}
          </Tabla>
        </Panel>
      )}
    </>
  );
}

function Alta({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', community: '', contact: '', stellarAddress: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'cuenta' | 'guardar' | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const addressOk = /^G[A-Z2-7]{55}$/.test(f.stellarAddress.trim());

  async function crearCuenta() {
    setBusy('cuenta'); setError(null);
    try { setF({ ...f, stellarAddress: (await api.testnetAccount()).address }); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function guardar() {
    setBusy('guardar'); setError(null);
    try {
      const r = await api.createProducer({ name: f.name, community: f.community || undefined, contact: f.contact || undefined, stellarAddress: f.stellarAddress.trim() });
      onCreated(); navigate(`/productores/${r.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <Panel sombra className="mb-8">
      <BarraPanel>{t('Nuevo productor')}</BarraPanel>
      <div className="p-5 grid gap-4 md:grid-cols-2">
        <TextField etiqueta={t('Nombre completo')} value={f.name} onChange={set('name')} placeholder={t('Ej. Rosa Gómez Díaz')} />
        <TextField etiqueta={t('Comunidad · opcional')} value={f.community} onChange={set('community')} placeholder={t('Ej. Huatusco, Veracruz')} />
        <TextField etiqueta={t('Contacto · opcional')} value={f.contact} onChange={set('contact')} placeholder={t('Teléfono')} />
        <div>
          <TextField etiqueta={t('Dirección de Stellar (la de su app de MicoPay)')} value={f.stellarAddress} onChange={set('stellarAddress')} placeholder="G…" className="num text-[14px]"
            error={f.stellarAddress && !addressOk ? t('Debe empezar con G y medir 56 caracteres') : null} />
          <button type="button" onClick={crearCuenta} disabled={busy !== null} className="mt-2 text-[13px] font-bold underline">
            {busy === 'cuenta' ? t('Creando cuenta en testnet…') : t('Sin app todavía: crear cuenta de prueba en testnet')}
          </button>
        </div>
        {error && <div className="md:col-span-2"><ErrorCaja mensaje={error} /></div>}
        <div className="md:col-span-2 flex gap-3">
          <Button disabled={busy !== null || f.name.trim().length < 3 || !addressOk} onClick={guardar}>{busy === 'guardar' ? t('Guardando…') : t('Dar de alta')}</Button>
          <Button variant="ghost" onClick={onClose}>{t('Cancelar')}</Button>
        </div>
      </div>
    </Panel>
  );
}
