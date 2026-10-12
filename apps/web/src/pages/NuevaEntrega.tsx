import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Preview } from '../api';
import { ErrorCaja, Titulo } from '../App';
import { mxn, qty } from '../format';
import { Button, Icon, Label, Pill, TextField } from '../ui';
import { useData } from '../useData';

const QTY_RE = /^\d+(\.\d{1,2})?$/;

export default function NuevaEntrega() {
  const producers = useData(api.producers);
  const products = useData(api.products);
  const [producerId, setProducerId] = useState<number | null>(null);
  const [productId, setProductId] = useState<number>(1);
  const [quantity, setQuantity] = useState('');
  const [quality, setQuality] = useState<Record<string, string>>({});
  const [lot, setLot] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ reference: string; net: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const product = products.data?.find((p) => p.id === productId);
  const producer = producers.data?.find((p) => p.id === producerId);
  const qualityNumbers = useMemo(
    () => Object.fromEntries(Object.entries(quality).filter(([, v]) => v !== '' && !Number.isNaN(Number(v))).map(([k, v]) => [k, Number(v)])),
    [quality],
  );
  const valid = producerId !== null && QTY_RE.test(quantity) && Number(quantity) > 0;

  // Live settlement: the operator sees exactly what the producer will receive before saving.
  useEffect(() => {
    if (!valid) { setPreview(null); return; }
    const t = setTimeout(() => {
      api.preview({ producerId: producerId!, productId, quantity, quality: qualityNumbers })
        .then((p) => { setPreview(p); setError(null); })
        .catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [valid, producerId, productId, quantity, qualityNumbers]);

  async function guardar() {
    setSaving(true);
    try {
      const r = await api.createDelivery({ producerId: producerId!, productId, quantity, quality: qualityNumbers, lot: lot || undefined });
      setSaved({ reference: r.reference, net: r.net });
      setQuantity(''); setQuality({}); setLot(''); setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Titulo cintillo="Báscula">Registrar entrega</Titulo>
      {saved && (
        <div className="mb-6 border-2 border-tinta bg-verde-suave px-4 py-3 rounded-sm flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold"><Icon name="check_circle" filled className="text-verde align-middle" /> Entrega <b className="num">{saved.reference}</b> registrada · recibirá <b className="num">{mxn(saved.net)}</b></span>
          <Link to="/pagos" className="font-bold underline">Ir a pagar →</Link>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_400px] items-start">
        <div className="grid gap-6">
          <section>
            <Label>1 · Productor</Label>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {producers.data?.map((p) => (
                <button key={p.id} type="button" onClick={() => setProducerId(p.id)}
                  className={`text-left rounded-sm border-2 border-tinta px-4 py-3 ${producerId === p.id ? 'bg-tinta text-papel' : 'bg-papel'}`}>
                  <div className="font-bold leading-tight">{p.name}</div>
                  <div className={`text-[13px] ${producerId === p.id ? 'text-gris-3' : 'text-gris'}`}>{p.community}</div>
                  {p.credit?.status === 'active' && <div className={`mt-1 text-[12px] font-bold ${producerId === p.id ? 'text-naranja-claro' : 'text-naranja'}`}>Crédito {p.credit.reference}</div>}
                </button>
              ))}
            </div>
          </section>

          <section>
            <Label>2 · Producto</Label>
            <div className="mt-3 flex flex-wrap gap-2">
              {products.data?.map((p) => (
                <Pill key={p.id} activa={p.id === productId} onClick={() => { setProductId(p.id); setQuality({}); }}>
                  {p.name} · <span className="num">{mxn(p.price)}/{p.unit}</span>
                </Pill>
              ))}
            </div>
          </section>

          <section>
            <Label>3 · Peso y calidad</Label>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <TextField etiqueta={`Cantidad (${product?.unit ?? 'kg'})`} inputMode="decimal" placeholder="Ej. 250" value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(',', '.'))}
                error={quantity && !QTY_RE.test(quantity) ? 'Usa hasta 2 decimales' : null} className="num" />
              <TextField etiqueta="Lote (opcional)" placeholder="Ej. LOTE-45" value={lot} maxLength={35} onChange={(e) => setLot(e.target.value)} />
              {product?.quality_schema.map((f) => (
                <TextField key={f.key} etiqueta={`${f.label} (${f.unit})`} inputMode="decimal" value={quality[f.key] ?? ''} className="num"
                  onChange={(e) => setQuality({ ...quality, [f.key]: e.target.value.replace(',', '.') })}
                  ayuda={product.rules?.filter((r) => r.attribute === f.key).map((r) => `>${Number(r.above)}${f.unit}: −${Number(r.percent)}%`).join(' · ')} />
              ))}
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-8">
          <div className="rounded-sm border-2 border-tinta bg-papel shadow-solida overflow-hidden">
            <div className="bg-tinta text-papel px-5 py-3 text-[12px] font-bold uppercase tracking-[.14em]">Liquidación</div>
            <div className="p-5">
              {!preview ? (
                <p className="text-gris text-[14px]">Elige productor y escribe la cantidad para ver la liquidación.</p>
              ) : (
                <dl className="grid gap-2.5 text-[15px]">
                  <Linea etiqueta={`${qty(quantity)} ${product?.unit} × ${mxn(preview.unitPrice)}`} valor={mxn(preview.gross)} />
                  {preview.deductions.map((d) => <Linea key={d.reason} etiqueta={`Castigo: ${d.label}`} valor={`− ${mxn(d.amount)}`} tono="rojo" />)}
                  {Number(preview.creditRepayment) > 0 && (
                    <Linea etiqueta={`Abono a crédito ${preview.credit?.reference} (${Number(preview.credit?.repaymentPercent)}%)`} valor={`− ${mxn(preview.creditRepayment)}`} tono="naranja" />
                  )}
                  <div className="mt-2 border-t-2 border-tinta pt-3 flex items-baseline justify-between">
                    <dt className="font-bold">{producer?.name.split(' ')[0]} recibe</dt>
                    <dd className="num font-display text-[30px] font-extrabold text-verde leading-none" style={{ fontVariationSettings: '"wdth" 108' }}>{mxn(preview.net)}</dd>
                  </div>
                  {preview.credit && Number(preview.creditRepayment) > 0 && (
                    <p className="text-[13px] text-gris">Le quedarán {mxn(Number(preview.credit.outstanding) - Number(preview.creditRepayment))} por pagar del crédito.</p>
                  )}
                </dl>
              )}
              {error && <div className="mt-4"><ErrorCaja mensaje={error} /></div>}
              <Button block className="mt-5" disabled={!preview || saving} onClick={guardar}>
                {saving ? 'Guardando…' : 'Registrar entrega'}
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Linea({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'rojo' | 'naranja' }) {
  const color = tono === 'rojo' ? 'text-rojo' : tono === 'naranja' ? 'text-naranja' : '';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gris">{etiqueta}</dt>
      <dd className={`num font-bold whitespace-nowrap ${color}`}>{valor}</dd>
    </div>
  );
}
