import { useState } from 'react';
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
      <Titulo cintillo="Socios" accion={!nuevo && <Button onClick={() => setNuevo(true)}><Icon name="add_circle" /> Nuevo productor</Button>}>Productores</Titulo>
      {nuevo && <Alta onClose={() => setNuevo(false)} onCreated={list.reload} />}
      <div className="mb-4 max-w-[420px]"><TextField aria-label="Buscar productor" placeholder="Buscar por nombre o comunidad" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.error && <ErrorCaja mensaje={list.error} />}
      {!list.data ? <Cargando /> : (
        <Panel>
          <Tabla cabeceras={['Productor', 'Comunidad', 'Cuenta', { t: 'Entregado', derecha: true }, { t: 'Cobrado', derecha: true }, { t: 'Crédito', derecha: true }, 'Estado']}
            vacio={list.data.length === 0 && 'No hay productores con ese nombre.'}>
            {list.data.map((p) => (
              <tr key={p.id}>
                <td className={td}><Link to={`/productores/${p.id}`} className="font-bold underline">{p.name}</Link><div className="text-[12px] text-gris">{p.contact}</div></td>
                <td className={td}>{p.community}</td>
                <td className={`${td} num text-[13px]`}>{p.account_id}<div className="text-gris">{short(p.stellar_address)}</div></td>
                <td className={tdNum}>{qty(p.delivered)} kg</td>
                <td className={tdNum}>{mxn(p.paid)}</td>
                <td className={`${tdNum} ${Number(p.credit_outstanding) > 0 ? 'text-naranja font-bold' : 'text-gris'}`}>{Number(p.credit_outstanding) > 0 ? mxn(p.credit_outstanding) : '—'}</td>
                <td className={td}>{p.is_active ? <Badge tono="verde">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
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
      <BarraPanel>Nuevo productor</BarraPanel>
      <div className="p-5 grid gap-4 md:grid-cols-2">
        <TextField etiqueta="Nombre completo" value={f.name} onChange={set('name')} placeholder="Ej. Rosa Gómez Díaz" />
        <TextField etiqueta="Comunidad · opcional" value={f.community} onChange={set('community')} placeholder="Ej. Chilón, Chiapas" />
        <TextField etiqueta="Contacto · opcional" value={f.contact} onChange={set('contact')} placeholder="Teléfono" />
        <div>
          <TextField etiqueta="Dirección de Stellar (la de su app de MicoPay)" value={f.stellarAddress} onChange={set('stellarAddress')} placeholder="G…" className="num text-[14px]"
            error={f.stellarAddress && !addressOk ? 'Debe empezar con G y medir 56 caracteres' : null} />
          <button type="button" onClick={crearCuenta} disabled={busy !== null} className="mt-2 text-[13px] font-bold underline">
            {busy === 'cuenta' ? 'Creando cuenta en testnet…' : 'Sin app todavía: crear cuenta de prueba en testnet'}
          </button>
        </div>
        {error && <div className="md:col-span-2"><ErrorCaja mensaje={error} /></div>}
        <div className="md:col-span-2 flex gap-3">
          <Button disabled={busy !== null || f.name.trim().length < 3 || !addressOk} onClick={guardar}>{busy === 'guardar' ? 'Guardando…' : 'Dar de alta'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </Panel>
  );
}
