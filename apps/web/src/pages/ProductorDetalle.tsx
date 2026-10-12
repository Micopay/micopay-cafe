import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Cargando, Dato, ErrorCaja, EstadoCredito, EstadoPago, Panel, Subtitulo, Tabla, td, tdNum, Titulo, Tx } from '../comun';
import { dia, fecha, mxn, qty } from '../format';
import { Badge, Button, Icon } from '../ui';
import { useData } from '../useData';

const CUENTA = { ok: ['verde', 'Puede recibir pagos'], sin_cuenta: ['aviso', 'Cuenta de Stellar no existe'], sin_trustline: ['aviso', 'Falta activar MXNe'] } as const;

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
      <Titulo cintillo={`Productor · ${d.account_id}`} accion={
        <div className="flex gap-3">
          {d.is_active && <Link to={`/?productor=${d.id}`}><Button><Icon name="check_circle" /> Seleccionar para pago</Button></Link>}
          <Button variant="ghost" onClick={toggle}>{d.is_active ? 'Desactivar' : 'Activar'}</Button>
        </div>
      }>{d.name}</Titulo>

      <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
        <Panel className="p-4 text-[14px]">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2">
            <dt className="text-gris">Comunidad</dt><dd>{d.community ?? '—'}</dd>
            <dt className="text-gris">Contacto</dt><dd>{d.contact ?? '—'}</dd>
            <dt className="text-gris">Registrado</dt><dd>{dia(d.created_at)}</dd>
            <dt className="text-gris">Estado</dt><dd>{d.is_active ? <Badge tono="verde">Activo</Badge> : <Badge>Inactivo</Badge>}</dd>
            <dt className="text-gris">Stellar</dt><dd className="num break-all text-[13px]">{d.stellar_address}</dd>
            <dt className="text-gris">Cuenta</dt><dd><Badge tono={CUENTA[d.account][0]}>{CUENTA[d.account][1]}</Badge></dd>
          </dl>
          <p className="mt-3 text-[12px] text-gris">Cobra en su app de MicoPay: lo deja digital, lo manda a su banco por SPEI o lo cambia a efectivo con un agente.</p>
        </Panel>
        <div className="grid grid-cols-2 gap-4">
          <Dato etiqueta="Entregas" valor={d.stats.deliveries} />
          <Dato etiqueta="Total entregado" valor={`${qty(d.stats.quantity)} kg`} />
          <Dato etiqueta="Total pagado" valor={mxn(d.stats.paid)} tono="text-verde" />
          <Dato etiqueta="Último pago" valor={d.stats.last_payment ? fecha(d.stats.last_payment) : '—'} />
        </div>
      </div>

      <Subtitulo>Historial de entregas</Subtitulo>
      <Panel>
        <Tabla cabeceras={['Fecha', 'Entrega', 'Producto', { t: 'Cantidad', derecha: true }, { t: 'Precio', derecha: true }, { t: 'Abono', derecha: true }, { t: 'Pagado', derecha: true }, 'Estado', 'Stellar']}
          vacio={d.history.length === 0 && 'Todavía no hay entregas.'}>
          {d.history.map((h) => (
            <tr key={h.id}>
              <td className={`${td} num whitespace-nowrap`}>{fecha(h.created_at)}</td>
              <td className={td}><Link to={`/historial/${h.id}`} className="underline num">{h.reference}</Link></td>
              <td className={td}>{h.product}</td>
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

      <Subtitulo accion={<Link to={`/admin/creditos?nuevo=1&productor=${d.id}`} className="font-bold underline text-[14px]">+ Otorgar crédito</Link>}>Créditos</Subtitulo>
      <Panel>
        <Tabla cabeceras={['Crédito', 'Destino', { t: 'Total', derecha: true }, { t: 'Saldo', derecha: true }, 'Vence', 'Estado']} vacio={d.credits.length === 0 && 'Sin créditos.'}>
          {d.credits.map((c) => (
            <tr key={c.id}>
              <td className={`${td} whitespace-nowrap`}><Link to={`/admin/creditos/${c.id}`} className="underline font-bold num">{c.reference}</Link></td>
              <td className={td}>{c.purpose}</td>
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
