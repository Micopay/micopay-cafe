import { useState } from 'react';
import { api } from '../../api';
import { BarraPanel, Cargando, ErrorCaja, Panel, Subtitulo, Tabla, td, tdNum, Titulo } from '../../comun';
import { fecha, mxn } from '../../format';
import { Button, TextField } from '../../ui';
import { useData } from '../../useData';

export default function Precios() {
  const products = useData(api.products);
  const history = useData(() => api.prices());
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function guardar(productId: number, name: string) {
    setError(null); setSaved(null);
    try { await api.setPrice(productId, draft[productId]!); setSaved(`Precio de ${name} actualizado.`); setDraft({ ...draft, [productId]: '' }); products.reload(); history.reload(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <Titulo cintillo="Administración">Precio del día</Titulo>
      <p className="max-w-[720px] text-gris mb-6 text-[15px]">El precio que se carga por defecto en la báscula. El operador puede ajustarlo en un pago y el cambio queda en la bitácora.</p>
      {error && <div className="mb-4"><ErrorCaja mensaje={error} /></div>}
      {saved && <div className="mb-4 border-2 border-tinta bg-verde-suave px-4 py-3 rounded-sm font-semibold text-[14px]">{saved}</div>}

      {!products.data ? <Cargando /> : (
        <div className="grid gap-5 md:grid-cols-2">
          {products.data.map((p) => (
            <Panel key={p.id} sombra>
              <BarraPanel>{p.name}</BarraPanel>
              <div className="p-5">
                <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">Vigente {p.price_since ? `desde ${fecha(p.price_since)}` : ''}</div>
                <div className="num font-display text-[30px] font-extrabold leading-tight">{p.price ? `${mxn(p.price)} / ${p.unit}` : 'Sin precio'}</div>
                <div className="mt-4 flex gap-3 items-end">
                  <div className="flex-1"><TextField etiqueta={`Nuevo precio por ${p.unit} (MXN)`} inputMode="decimal" className="num" value={draft[p.id] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value.replace(',', '.') })} /></div>
                  <Button disabled={!/^\d+(\.\d{1,2})?$/.test(draft[p.id] ?? '') || Number(draft[p.id]) <= 0} onClick={() => guardar(p.id, p.name)}>Guardar</Button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Subtitulo>Historial de precios</Subtitulo>
      <Panel>
        <Tabla cabeceras={['Desde', 'Producto', { t: 'Precio', derecha: true }]}>
          {history.data?.map((h) => (
            <tr key={h.id}><td className={`${td} num`}>{fecha(h.valid_from)}</td><td className={td}>{h.product}</td><td className={tdNum}>{mxn(h.price)} / {h.unit}</td></tr>
          ))}
        </Tabla>
      </Panel>
    </>
  );
}
