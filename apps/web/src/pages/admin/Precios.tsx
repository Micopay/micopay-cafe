import { useState } from 'react';
import { t } from '../../i18n';
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
    try { await api.setPrice(productId, draft[productId]!); setSaved(t('Precio de {name} actualizado.', { name: t(name) })); setDraft({ ...draft, [productId]: '' }); products.reload(); history.reload(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <>
      <Titulo cintillo={t('Administración')}>{t('Precio de referencia')}</Titulo>
      <p className="max-w-[720px] text-gris mb-6 text-[15px]">{t('El precio de referencia que se carga en la báscula. En cada compra se negocia (unos centavos arriba o abajo) y el recibo guarda el precio acordado.')}</p>
      {error && <div className="mb-4"><ErrorCaja mensaje={error} /></div>}
      {saved && <div className="mb-4 border-2 border-tinta bg-verde-suave px-4 py-3 rounded-sm font-semibold text-[14px]">{saved}</div>}

      {!products.data ? <Cargando /> : (
        <div className="grid gap-5 md:grid-cols-2">
          {products.data.map((p) => (
            <Panel key={p.id} sombra>
              <BarraPanel>{t(p.name)}</BarraPanel>
              <div className="p-5">
                <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris">{p.price_since ? t('Vigente desde {date}', { date: fecha(p.price_since) }) : ''}</div>
                <div className="num font-display text-[30px] font-extrabold leading-tight">{p.price ? `${mxn(p.price)} / ${p.unit}` : t('Sin precio')}</div>
                <div className="mt-4 flex gap-3 items-end">
                  <div className="flex-1"><TextField etiqueta={t('Nuevo precio por {unit} (MXN)', { unit: p.unit })} inputMode="decimal" className="num" value={draft[p.id] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value.replace(',', '.') })} /></div>
                  <Button disabled={!/^\d+(\.\d{1,2})?$/.test(draft[p.id] ?? '') || Number(draft[p.id]) <= 0} onClick={() => guardar(p.id, p.name)}>{t('Guardar')}</Button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Subtitulo>{t('Historial de precios')}</Subtitulo>
      <Panel>
        <Tabla cabeceras={[t('Desde'), t('Producto'), { t: t('Precio'), derecha: true }]}>
          {history.data?.map((h) => (
            <tr key={h.id}><td className={`${td} num`}>{fecha(h.valid_from)}</td><td className={td}>{t(h.product)}</td><td className={tdNum}>{mxn(h.price)} / {h.unit}</td></tr>
          ))}
        </Tabla>
      </Panel>
    </>
  );
}
