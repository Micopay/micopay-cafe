import { useState } from 'react';
import { api } from '../../api';
import { BarraPanel, Cargando, ErrorCaja, Panel, Tabla, td, tdNum, Titulo } from '../../comun';
import { mxn, short } from '../../format';
import { Badge, Button, Icon, TextField } from '../../ui';
import { useData } from '../../useData';

export default function Prestamistas() {
  const list = useData(api.lenders);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ name: '', kind: 'IFNB', stellarAddress: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function guardar() {
    setBusy(true); setError(null);
    try { await api.createLender({ ...f, stellarAddress: f.stellarAddress.trim() }); setNuevo(false); setF({ name: '', kind: 'IFNB', stellarAddress: '' }); list.reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <Titulo cintillo="Administración" accion={!nuevo && <Button onClick={() => setNuevo(true)}><Icon name="add_circle" /> Nuevo prestamista</Button>}>Prestamistas</Titulo>
      <p className="max-w-[760px] text-gris mb-6 text-[15px]">Quien pone el dinero del crédito: un IFNB, una SOFOM o un banco que fondea con FIRA, o la propia compradora o cooperativa como dispersora. Desembolsa desde su cuenta de Stellar y recibe los abonos ahí mismo.</p>

      {nuevo && (
        <Panel sombra className="mb-8">
          <BarraPanel>Nuevo prestamista</BarraPanel>
          <div className="p-5 grid gap-4 md:grid-cols-3">
            <TextField etiqueta="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <TextField etiqueta="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} ayuda="IFNB, SOFOM, banco, compradora, cooperativa…" />
            <TextField etiqueta="Dirección de Stellar" className="num text-[14px]" placeholder="G…" value={f.stellarAddress} onChange={(e) => setF({ ...f, stellarAddress: e.target.value })} />
            {error && <div className="md:col-span-3"><ErrorCaja mensaje={error} /></div>}
            <div className="md:col-span-3 flex gap-3">
              <Button disabled={busy || f.name.trim().length < 3 || !/^G[A-Z2-7]{55}$/.test(f.stellarAddress.trim())} onClick={guardar}>{busy ? 'Guardando…' : 'Dar de alta'}</Button>
              <Button variant="ghost" onClick={() => setNuevo(false)}>Cancelar</Button>
            </div>
          </div>
        </Panel>
      )}

      {list.error && <ErrorCaja mensaje={list.error} />}
      {!list.data ? <Cargando /> : (
        <Panel>
          <Tabla cabeceras={['Prestamista', 'Tipo', 'Cuenta', { t: 'Saldo disponible', derecha: true }, { t: 'Créditos vigentes', derecha: true }, { t: 'Cartera', derecha: true }, 'Firma']}>
            {list.data.map((l) => (
              <tr key={l.id}>
                <td className={td}><b>{l.name}</b></td>
                <td className={td}>{l.kind}</td>
                <td className={`${td} num text-[13px]`}>{l.account_id}<div className="text-gris">{short(l.stellar_address)}</div></td>
                <td className={`${tdNum} text-verde`}>{l.balance ? mxn(l.balance) : '—'}</td>
                <td className={tdNum}>{l.active_credits}</td>
                <td className={`${tdNum} font-bold`}>{mxn(l.portfolio)}</td>
                <td className={td}>{l.canSign ? <Badge tono="verde">Demo local</Badge> : <Badge tono="aviso">App de MicoPay</Badge>}</td>
              </tr>
            ))}
          </Tabla>
        </Panel>
      )}
    </>
  );
}
