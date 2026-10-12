import { useState } from 'react';
import { api, type AuditRow } from '../../api';
import { BarraPanel, Cargando, ErrorCaja, Panel, Subtitulo, Tabla, td, Titulo } from '../../comun';
import { fecha, hoy } from '../../format';
import { Button, Icon, TextField } from '../../ui';
import { useData } from '../../useData';

const ACCIONES: Record<string, string> = {
  pago: 'Pago', 'pago.rechazado': 'Pago rechazado', 'productor.alta': 'Alta de productor', 'productor.edicion': 'Edición de productor',
  'precio.del_dia': 'Precio de referencia', 'precio.modificado_en_pago': 'Precio negociado en la báscula', 'credito.alta': 'Crédito otorgado',
  'credito.desembolso': 'Desembolso', 'credito.cancelado': 'Crédito cancelado', 'credito.ajuste': 'Ajuste de crédito',
  'prestamista.alta': 'Alta de prestamista', cierre_de_dia: 'Cierre de día', 'demo.inicializada': 'Demo inicializada',
};

function resumen(r: AuditRow): string {
  const d = r.details as Record<string, any>;
  if (r.action === 'pago') return (d.payments ?? []).map((p: any) => `${p.producer}: ${p.net}${Number(p.repayment) ? ` + abono ${p.repayment}` : ''}`).join(' · ');
  return Object.entries(d).filter(([k]) => k !== 'tx').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
}

export default function Auditoria() {
  const page = useData(() => api.audit(0));
  const [extra, setExtra] = useState<AuditRow[]>([]);
  const [date, setDate] = useState(hoy());
  const rows = [...(page.data ?? []), ...extra];

  return (
    <>
      <Titulo cintillo="Administración">Auditoría y exportación</Titulo>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel sombra>
          <BarraPanel>Cierre de día (camt.053)</BarraPanel>
          <div className="p-5 grid gap-3 text-[14px]">
            <p className="text-gris">Estado de cuenta ISO 20022 de la cuenta de la compradora en Stellar. Los saldos se reconstruyen desde la cadena, no se suponen.</p>
            <div className="flex gap-3 items-end">
              <div className="flex-1"><TextField etiqueta="Fecha" type="date" value={date} max={hoy()} onChange={(e) => setDate(e.target.value)} /></div>
              <a href={`/api/statement?date=${date}`} target="_blank" rel="noreferrer"><Button><Icon name="account_balance" /> Generar</Button></a>
            </div>
          </div>
        </Panel>
        <Panel sombra>
          <BarraPanel>Exportar a Excel (CSV)</BarraPanel>
          <div className="p-5 flex flex-wrap gap-3">
            <a href="/api/payments.csv"><Button variant="ghost">Pagos</Button></a>
            <a href="/api/credits.csv"><Button variant="ghost">Cartera de crédito</Button></a>
            <a href="/api/audit.csv"><Button variant="ghost">Bitácora</Button></a>
          </div>
        </Panel>
      </div>

      <Subtitulo>Bitácora</Subtitulo>
      {page.error && <ErrorCaja mensaje={page.error} />}
      {!page.data ? <Cargando /> : (
        <Panel>
          <Tabla cabeceras={['Fecha', 'Acción', 'Detalle']} vacio={rows.length === 0 && 'Sin registros.'}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} num whitespace-nowrap`}>{fecha(r.created_at)}</td>
                <td className={`${td} font-bold whitespace-nowrap`}>{ACCIONES[r.action] ?? r.action}</td>
                <td className={`${td} text-[13px] text-gris`}>{resumen(r)}</td>
              </tr>
            ))}
          </Tabla>
          {rows.length % 50 === 0 && rows.length > 0 && (
            <div className="p-3 border-t border-linea"><Button variant="ghost" onClick={async () => setExtra([...extra, ...(await api.audit(rows.length))])}>Cargar más…</Button></div>
          )}
        </Panel>
      )}
    </>
  );
}
