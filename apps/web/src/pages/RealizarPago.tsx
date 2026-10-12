import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type PaymentResult, type Preview } from '../api';
import { BarraPanel, ErrorCaja, Panel, Titulo } from '../comun';
import { mxn, qty, short } from '../format';
import { Button, Icon, Label, Pill, TextField } from '../ui';
import { useData } from '../useData';

const DEC = /^\d+(\.\d{1,2})?$/;

export default function RealizarPago() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const producers = useData(() => api.producers(q), [q]);
  const products = useData(api.products);

  const producerId = params.get('productor') ? Number(params.get('productor')) : null;
  const producer = useData(() => (producerId ? api.producer(producerId) : Promise.resolve(null)), [producerId]);
  const [productId, setProductId] = useState<number | null>(null);
  const [conCalidad, setConCalidad] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [quality, setQuality] = useState<Record<string, string>>({});
  const [lot, setLot] = useState('');
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);

  // The first product is the one bought most (café cereza at a compradora): preselect it.
  useEffect(() => { if (productId === null && products.data?.[0]) setProductId(products.data[0].id); }, [products.data, productId]);
  const product = products.data?.find((p) => p.id === productId);
  // The daily price is loaded as the default; the operator can override it (it gets audited).
  useEffect(() => { if (product?.price) setPrice(product.price); }, [product?.id, product?.price]);

  const qualityNumbers = useMemo(
    () => Object.fromEntries(Object.entries(quality).filter(([, v]) => v !== '' && !Number.isNaN(Number(v))).map(([k, v]) => [k, Number(v)])),
    [quality],
  );
  const valid = producerId !== null && productId !== null && DEC.test(quantity) && Number(quantity) > 0 && DEC.test(price) && Number(price) > 0;
  const input = valid ? { producerId: producerId!, productId: productId!, quantity, quality: qualityNumbers, unitPrice: price, lot: lot || undefined, notes: notes || undefined } : null;

  useEffect(() => {
    setConfirmando(false);
    if (!input) { setPreview(null); return; }
    const t = setTimeout(() => { api.preview(input).then((p) => { setPreview(p); setError(null); }).catch((e: Error) => setError(e.message)); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producerId, productId, quantity, price, qualityNumbers]);

  function seleccionar(id: number) {
    setParams({ productor: String(id) });
    setResult(null); setQuantity(''); setQuality({}); setConCalidad(false); setLot(''); setNotes(''); setError(null);
  }

  async function pagar() {
    if (!input) return;
    setPaying(true); setError(null);
    try {
      const r = await api.pay(input);
      if (r.status !== 'settled') setError(`Stellar rechazó la transacción (${r.resultCode}). No se movió dinero; puedes reintentar desde el historial.`);
      else { setResult(r); setQuantity(''); setQuality({}); setLot(''); setNotes(''); producer.reload(); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPaying(false); setConfirmando(false);
    }
  }

  const p = producer.data;
  const precioModificado = product?.price && price && price !== product.price && Number(price) !== Number(product.price);

  return (
    <>
      <Titulo cintillo="Báscula">Realizar pago</Titulo>

      <div className="grid gap-7 lg:grid-cols-[300px_1fr] items-start">
        {/* Productores, como en la app original: búsqueda + lista + seleccionar */}
        <Panel>
          <BarraPanel>Productores</BarraPanel>
          <div className="p-3 border-b-2 border-linea">
            <TextField aria-label="Buscar productor" placeholder="Buscar por nombre o comunidad" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-[520px] overflow-y-auto">
            {producers.data?.filter((x) => x.is_active).map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => seleccionar(x.id)}
                  className={`w-full text-left px-4 py-3 border-b border-linea ${producerId === x.id ? 'bg-tinta text-papel' : ''}`}>
                  <div className="font-bold leading-tight">{x.name}</div>
                  <div className={`text-[12px] ${producerId === x.id ? 'text-gris-3' : 'text-gris'}`}>{x.community}</div>
                  {Number(x.credit_outstanding) > 0 && <div className={`text-[12px] font-bold ${producerId === x.id ? 'text-naranja-claro' : 'text-naranja'}`}>Crédito: debe {mxn(x.credit_outstanding)}</div>}
                </button>
              </li>
            ))}
            {producers.data?.length === 0 && <li className="px-4 py-4 text-gris text-[14px]">Sin resultados.</li>}
          </ul>
          <div className="p-3"><Link to="/productores?nuevo=1" className="font-bold underline text-[14px]">+ Nuevo productor</Link></div>
        </Panel>

        <div className="grid gap-6">
          {result && <PagoExitoso r={result} />}

          {!p ? (
            <div className="rounded-sm border-2 border-dashed border-gris-2 p-8 text-center text-gris">Selecciona un productor de la lista para registrar su entrega.</div>
          ) : (
            <>
              <Panel>
                <div className="p-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-[22px] font-extrabold leading-tight" style={{ fontVariationSettings: '"wdth" 108' }}>{p.name}</div>
                    <div className="text-gris text-[14px]">{p.community} · <span className="num">{p.account_id}</span> · <span className="num">{short(p.stellar_address)}</span></div>
                  </div>
                  <div className="text-right text-[13px] text-gris">
                    <div><b className="text-tinta num">{p.stats.deliveries}</b> entregas · <b className="text-tinta num">{qty(p.stats.quantity)} kg</b></div>
                    <div>Pagado <b className="text-tinta num">{mxn(p.stats.paid)}</b></div>
                    <Link to={`/productores/${p.id}`} className="underline font-bold text-tinta">Ver historial</Link>
                  </div>
                </div>
                {p.account !== 'ok' && (
                  <div className="border-t-2 border-tinta bg-aviso text-aviso-texto px-4 py-2.5 text-[13px] font-semibold">
                    {p.account === 'sin_cuenta' ? 'Su cuenta de Stellar no existe todavía: no puede recibir pagos.' : 'Aún no activa MXNe en su cuenta: no puede recibir pagos.'}
                  </div>
                )}
              </Panel>

              <div className="grid gap-6 xl:grid-cols-[1fr_380px] items-start">
                <section className="grid gap-5">
                  <div>
                    <Label>Producto</Label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {products.data?.map((x) => (
                        <Pill key={x.id} activa={x.id === productId} onClick={() => { setProductId(x.id); setQuality({}); setConCalidad(false); }}>{x.name}</Pill>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField etiqueta={`Peso (${product?.unit ?? 'kg'})`} inputMode="decimal" placeholder="Ej. 250" value={quantity} className="num"
                      onChange={(e) => setQuantity(e.target.value.replace(',', '.'))} error={quantity && !DEC.test(quantity) ? 'Usa hasta 2 decimales' : null} />
                    <TextField etiqueta={`Precio acordado por ${product?.unit ?? 'kg'} (MXN)`} inputMode="decimal" value={price} className="num"
                      onChange={(e) => setPrice(e.target.value.replace(',', '.'))}
                      ayuda={product?.price ? (precioModificado ? `Negociado sobre la referencia del día (${mxn(product.price)})` : 'Referencia del día; se ajusta si se negocia') : 'Sin precio de referencia configurado'} />
                    {product && product.quality_schema.length > 0 && !conCalidad && (
                      <button type="button" onClick={() => setConCalidad(true)} className="sm:col-span-2 text-left text-[14px] font-bold underline">
                        + Agregar calidad (opcional): {product.quality_schema.map((f) => f.label.toLowerCase()).join(', ')}
                      </button>
                    )}
                    {conCalidad && product?.quality_schema.map((f) => (
                      <TextField key={f.key} etiqueta={`${f.label} (${f.unit})`} inputMode="decimal" value={quality[f.key] ?? ''} className="num"
                        onChange={(e) => setQuality({ ...quality, [f.key]: e.target.value.replace(',', '.') })}
                        ayuda={product.rules?.filter((r) => r.attribute === f.key).map((r) => `más de ${Number(r.above)}${f.unit}: −${Number(r.percent)}%`).join(' · ')} />
                    ))}
                    <TextField etiqueta="Lote · opcional" placeholder="Ej. LOTE-45" maxLength={35} value={lot} onChange={(e) => setLot(e.target.value)} />
                    <TextField etiqueta="Notas · opcional" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </section>

                <aside className="xl:sticky xl:top-8">
                  <Panel sombra>
                    <BarraPanel>Total a pagar</BarraPanel>
                    <div className="p-5">
                      {!preview ? <p className="text-gris text-[14px]">Escribe el peso para calcular el pago.</p> : (
                        <dl className="grid gap-2.5 text-[15px]">
                          <Linea etiqueta={`${qty(quantity)} ${product?.unit} × ${mxn(preview.unitPrice)}`} valor={mxn(preview.gross)} />
                          {preview.deductions.map((d) => <Linea key={d.reason} etiqueta={`Castigo: ${d.label}`} valor={`− ${mxn(d.amount)}`} tono="text-rojo" />)}
                          {preview.credit && Number(preview.creditRepayment) > 0 && (
                            <Linea etiqueta={`Abono a crédito ${preview.credit.reference} (${Number(preview.credit.repaymentPercent)}%)`} valor={`− ${mxn(preview.creditRepayment)}`} tono="text-naranja" />
                          )}
                          <div className="mt-2 border-t-2 border-tinta pt-3 flex items-baseline justify-between">
                            <dt className="font-bold">Recibe</dt>
                            <dd className="num font-display text-[30px] font-extrabold text-verde leading-none" style={{ fontVariationSettings: '"wdth" 108' }}>{mxn(preview.net)}</dd>
                          </div>
                        </dl>
                      )}
                      {error && <div className="mt-4"><ErrorCaja mensaje={error} /></div>}
                      {!confirmando ? (
                        <Button block className="mt-5" disabled={!preview || p.account !== 'ok'} onClick={() => setConfirmando(true)}>
                          <Icon name="payments" /> Ejecutar pago
                        </Button>
                      ) : (
                        <div className="mt-5 grid gap-3">
                          <div className="text-[14px]">¿Confirmas el pago de <b className="num">{mxn(preview?.net)}</b> a <b>{p.name}</b>{Number(preview?.creditRepayment) > 0 && <> y el abono de <b className="num">{mxn(preview?.creditRepayment)}</b> al prestamista</>}? Se ejecuta en Stellar testnet.</div>
                          <Button block disabled={paying} onClick={pagar}><Icon name="lock" /> {paying ? 'Firmando y enviando…' : 'Confirmar pago'}</Button>
                          <Button block variant="ghost" disabled={paying} onClick={() => setConfirmando(false)}>Cancelar</Button>
                        </div>
                      )}
                    </div>
                  </Panel>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Linea({ etiqueta, valor, tono = '' }: { etiqueta: string; valor: string; tono?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gris">{etiqueta}</dt>
      <dd className={`num font-bold whitespace-nowrap ${tono}`}>{valor}</dd>
    </div>
  );
}

function PagoExitoso({ r }: { r: PaymentResult }) {
  return (
    <div className="rounded-sm border-2 border-tinta bg-tinta text-papel p-5 shadow-solida">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-verde-brillo flex items-center gap-1.5"><Icon name="verified" filled size={18} /> Pago exitoso en Stellar</div>
          <div className="mt-2 num font-display text-[30px] font-extrabold text-verde-brillo leading-none">{mxn(r.net)}</div>
          <div className="mt-2 text-[13px] text-gris-3">Entrega <span className="num">{r.reference}</span>{Number(r.creditRepayment) > 0 && <> · abono al crédito <span className="num">{mxn(r.creditRepayment)}</span> en la misma transacción</>}</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={r.explorer} target="_blank" rel="noreferrer"><Button tone="oscuro">Ver en Stellar <Icon name="open_in_new" size={18} /></Button></a>
          <Link to={`/historial/${r.settlementId}`}><Button tone="oscuro" variant="ghost">Detalle e ISO 20022</Button></Link>
          <Link to={`/recibo/${r.settlementId}`} target="_blank"><Button tone="oscuro" variant="ghost"><Icon name="receipt_long" /> Recibo</Button></Link>
        </div>
      </div>
    </div>
  );
}
