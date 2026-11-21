import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, type PaymentInput, type PaymentResult, type Preview } from '../api';
import { BarraPanel, ErrorCaja, EstadoPago, MensajeEstadoPago, Panel, Titulo, Tx } from '../comun';
import { mxn, qty, short, token } from '../format';
import { Button, Icon, Label, Pill, TextField } from '../ui';
import { useData } from '../useData';

const DEC = /^\d+(\.\d{1,2})?$/;
const STORAGE_KEY = 'micopay.pendingDelivery';

interface StoredDelivery { clientRef: string; input: PaymentInput }

function isStoredDelivery(value: unknown): value is StoredDelivery {
  if (!value || typeof value !== 'object') return false;
  const saved = value as Partial<StoredDelivery>;
  const input = saved.input;
  return typeof saved.clientRef === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.clientRef) &&
    !!input && typeof input === 'object' &&
    typeof input.producerId === 'number' && typeof input.productId === 'number' &&
    typeof input.quantity === 'string' && !!input.quality && typeof input.quality === 'object';
}

function readStoredDelivery(): { delivery: StoredDelivery | null; invalid: boolean } {
  let raw: string | null;
  try { raw = window.sessionStorage.getItem(STORAGE_KEY); } catch { return { delivery: null, invalid: false }; }
  if (!raw) return { delivery: null, invalid: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredDelivery(parsed)
      ? { delivery: parsed, invalid: false }
      : { delivery: null, invalid: true };
  } catch {
    return { delivery: null, invalid: true };
  }
}

function writeStoredDelivery(delivery: StoredDelivery) {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(delivery)); } catch { /* Continue in page if storage is unavailable. */ }
}

function clearStoredDelivery() {
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* Continue in page if storage is unavailable. */ }
}

export default function RealizarPago() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const producers = useData(() => api.producers(q), [q]);
  const products = useData(api.products);

  const producerId = params.get('productor') ? Number(params.get('productor')) : null;
  const producer = useData(() => (producerId ? api.producer(producerId) : Promise.resolve(null)), [producerId]);
  const reloadProducer = useRef(producer.reload);
  reloadProducer.current = producer.reload;
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
  const [delivery, setDelivery] = useState<StoredDelivery | null>(null);
  const [activePayment, setActivePayment] = useState<PaymentResult | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [resendAllowed, setResendAllowed] = useState(false);
  const [referenceNotFound, setReferenceNotFound] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const recoveryStarted = useRef(false);

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
    if (delivery || recoveryBlocked) { setPreview(null); return; }
    if (!input) { setPreview(null); return; }
    let active = true;
    const timer = setTimeout(() => {
      api.preview(input).then((p) => {
        if (active) { setPreview(p); setError(null); }
      }).catch((e: Error) => { if (active) setError(e.message); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producerId, productId, quantity, price, qualityNumbers, delivery, recoveryBlocked]);

  useEffect(() => {
    if (recoveryStarted.current) return;
    recoveryStarted.current = true;
    const stored = readStoredDelivery();
    if (stored.invalid) {
      setError(t('No se pudo recuperar la entrega guardada. No inicies otro pago desde esta pantalla.'));
      setRecoveryBlocked(true);
      setRecoveryChecked(true);
      return;
    }
    if (!stored.delivery) {
      setRecoveryChecked(true);
      return;
    }

    const saved = stored.delivery;
    setDelivery(saved);
    setParams({ productor: String(saved.input.producerId) });
    setProductId(saved.input.productId);
    setQuantity(saved.input.quantity);
    setPrice(saved.input.unitPrice ?? '');
    setQuality(Object.fromEntries(Object.entries(saved.input.quality).map(([key, value]) => [key, String(value)])));
    setConCalidad(Object.keys(saved.input.quality).length > 0);
    setLot(saved.input.lot ?? '');
    setNotes(saved.input.notes ?? '');

    api.paymentByRef(saved.clientRef).then((payment) => {
      setResendAllowed(false);
      if (payment.paymentState === 'paid') {
        completarPago(payment);
      } else {
        setReferenceNotFound(false);
        setActivePayment(payment);
      }
    }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) {
        setReferenceNotFound(true);
        setResendAllowed(true);
      }
      else {
        setReferenceNotFound(false);
        setError((e as Error).message);
        setResendAllowed(false);
      }
    }).finally(() => setRecoveryChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activePayment || activePayment.paymentState !== 'unconfirmed') return;
    let active = true;
    let timer: number;
    const consultar = async () => {
      try {
        const latest = await api.payment(activePayment.settlementId);
        if (!active) return;
        const updated: PaymentResult = {
          ...activePayment,
          paymentState: latest.paymentState,
          retryAllowed: latest.retryAllowed,
          txHash: latest.tx_hash,
          resultCode: latest.result_code ?? undefined,
          explorer: latest.explorer ?? null,
        };
        if (updated.paymentState === 'paid') completarPago(updated);
        else setActivePayment(updated);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
      if (active) timer = window.setTimeout(consultar, 10_000);
    };
    timer = window.setTimeout(consultar, 10_000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activePayment?.settlementId, activePayment?.paymentState]);

  function seleccionar(id: number) {
    if (delivery) return;
    setParams({ productor: String(id) });
    setResult(null); setActivePayment(null); setQuantity(''); setQuality({}); setConCalidad(false); setLot(''); setNotes(''); setError(null);
  }

  function completarPago(payment: PaymentResult) {
    clearStoredDelivery();
    setDelivery(null);
    setActivePayment(null);
    setResult(payment);
    setQuantity('');
    setQuality({});
    setLot('');
    setNotes('');
    setError(null);
    reloadProducer.current();
  }

  async function enviarEntrega(saved?: StoredDelivery) {
    if (!saved && !input) return;
    let attempt: StoredDelivery;
    try {
      attempt = saved ?? { clientRef: window.crypto.randomUUID(), input: input! };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setDelivery(attempt);
    setActivePayment(null);
    setResendAllowed(false);
    setReferenceNotFound(false);
    writeStoredDelivery(attempt);
    setPaying(true); setError(null);
    try {
      const payment = await api.pay({ ...attempt.input, clientRef: attempt.clientRef });
      if (payment.paymentState === 'paid') completarPago(payment);
      else setActivePayment(payment);
    } catch (e: unknown) {
      setError((e as Error).message);
      setResendAllowed(!(e instanceof ApiError) || e.status >= 500);
    } finally {
      setPaying(false); setConfirmando(false);
    }
  }

  async function reintentar() {
    if (!activePayment) return;
    setPaying(true); setError(null);
    try {
      const payment = await api.retry(activePayment.settlementId);
      if (payment.paymentState === 'paid') completarPago(payment);
      else setActivePayment(payment);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPaying(false);
    }
  }

  function entregarAHistorial() {
    clearStoredDelivery();
    setDelivery(null);
  }

  const p = producer.data;
  const precioModificado = product?.price && price && price !== product.price && Number(price) !== Number(product.price);

  return (
    <>
      <Titulo cintillo={t('Báscula')}>{t('Realizar pago')}</Titulo>

      <div className="grid gap-7 lg:grid-cols-[300px_1fr] items-start">
        {/* Productores, como en la app original: búsqueda + lista + seleccionar */}
        <Panel>
          <BarraPanel>{t('Productores')}</BarraPanel>
          <div className="p-3 border-b-2 border-linea">
            <TextField aria-label={t('Buscar productor')} placeholder={t('Buscar por nombre o comunidad')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-[520px] overflow-y-auto">
            {producers.data?.filter((x) => x.is_active).map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => seleccionar(x.id)} disabled={!!delivery}
                  className={`w-full text-left px-4 py-3 border-b border-linea disabled:cursor-not-allowed disabled:opacity-60 ${producerId === x.id ? 'bg-tinta text-papel' : ''}`}>
                  <div className="font-bold leading-tight">{x.name}</div>
                  <div className={`text-[12px] ${producerId === x.id ? 'text-gris-3' : 'text-gris'}`}>{x.community}</div>
                  {Number(x.credit_outstanding) > 0 && <div className={`text-[12px] font-bold ${producerId === x.id ? 'text-naranja-claro' : 'text-naranja'}`}>{t('Crédito: debe {amount}', { amount: mxn(x.credit_outstanding) })}</div>}
                </button>
              </li>
            ))}
            {producers.data?.length === 0 && <li className="px-4 py-4 text-gris text-[14px]">{t('Sin resultados.')}</li>}
          </ul>
          <div className="p-3"><Link to="/productores?nuevo=1" className="font-bold underline text-[14px]">{t('+ Nuevo productor')}</Link></div>
        </Panel>

        <div className="grid gap-6">
          {result && <PagoExitoso r={result} />}

          {delivery ? (
            <EntregaRecuperada
              delivery={delivery}
              payment={activePayment}
              loading={!recoveryChecked}
              referenceNotFound={referenceNotFound}
              resendAllowed={resendAllowed}
              paying={paying}
              error={error}
              onSend={() => enviarEntrega(delivery)}
              onRetry={reintentar}
              onHandoff={entregarAHistorial}
            />
          ) : !p ? (
            <div className="rounded-sm border-2 border-dashed border-gris-2 p-8 text-center text-gris">{t('Selecciona un productor de la lista para registrar su entrega.')}</div>
          ) : (
            <>
              <Panel>
                <div className="p-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-display text-[22px] font-extrabold leading-tight" style={{ fontVariationSettings: '"wdth" 108' }}>{p.name}</div>
                    <div className="text-gris text-[14px]">{p.community} · <span className="num">{p.account_id}</span> · <span className="num">{short(p.stellar_address)}</span></div>
                  </div>
                  <div className="text-right text-[13px] text-gris">
                    <div><b className="text-tinta num">{t('{n} entregas', { n: p.stats.deliveries })}</b> · <b className="text-tinta num">{qty(p.stats.quantity)} kg</b></div>
                    <div className="num">{t('Pagado {amount}', { amount: mxn(p.stats.paid) })}</div>
                    <Link to={`/productores/${p.id}`} className="underline font-bold text-tinta">{t('Ver historial')}</Link>
                  </div>
                </div>
                {p.account !== 'ok' && (
                  <div className="border-t-2 border-tinta bg-aviso text-aviso-texto px-4 py-2.5 text-[13px] font-semibold">
                    {t(p.account === 'sin_cuenta' ? 'Su cuenta de Stellar no existe todavía: no puede recibir pagos.' : 'Aún no activa MXNe en su cuenta: no puede recibir pagos.')}
                  </div>
                )}
              </Panel>

              <div className="grid gap-6 xl:grid-cols-[1fr_380px] items-start">
                <section className="grid gap-5">
                  <div>
                    <Label>{t('Producto')}</Label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {products.data?.map((x) => (
                        <Pill key={x.id} activa={x.id === productId} onClick={() => { setProductId(x.id); setQuality({}); setConCalidad(false); }}>{t(x.name)}</Pill>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField etiqueta={t('Peso ({unit})', { unit: product?.unit ?? 'kg' })} inputMode="decimal" placeholder={t('Ej. 250')} value={quantity} className="num"
                      onChange={(e) => setQuantity(e.target.value.replace(',', '.'))} error={quantity && !DEC.test(quantity) ? t('Usa hasta 2 decimales') : null} />
                    <TextField etiqueta={t('Precio acordado por {unit} (MXN)', { unit: product?.unit ?? 'kg' })} inputMode="decimal" value={price} className="num"
                      onChange={(e) => setPrice(e.target.value.replace(',', '.'))}
                      ayuda={product?.price ? (precioModificado ? t('Negociado sobre la referencia del día ({price})', { price: mxn(product.price) }) : t('Referencia del día; se ajusta si se negocia')) : t('Sin precio de referencia configurado')} />
                    {product && product.quality_schema.length > 0 && !conCalidad && (
                      <button type="button" onClick={() => setConCalidad(true)} className="sm:col-span-2 text-left text-[14px] font-bold underline">
                        {t('+ Agregar calidad (opcional): {fields}', { fields: product.quality_schema.map((f) => t(f.label).toLowerCase()).join(', ') })}
                      </button>
                    )}
                    {conCalidad && product?.quality_schema.map((f) => (
                      <TextField key={f.key} etiqueta={`${t(f.label)} (${f.unit})`} inputMode="decimal" value={quality[f.key] ?? ''} className="num"
                        onChange={(e) => setQuality({ ...quality, [f.key]: e.target.value.replace(',', '.') })}
                        ayuda={product.rules?.filter((r) => r.attribute === f.key).map((r) => t('más de {above}{unit}: −{percent}%', { above: Number(r.above), unit: f.unit, percent: Number(r.percent) })).join(' · ')} />
                    ))}
                    <TextField etiqueta={t('Lote · opcional')} placeholder={t('Ej. LOTE-45')} maxLength={35} value={lot} onChange={(e) => setLot(e.target.value)} />
                    <TextField etiqueta={t('Notas · opcional')} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </section>

                <aside className="xl:sticky xl:top-8">
                  <Panel sombra>
                    <BarraPanel>{t('Total a pagar')}</BarraPanel>
                    <div className="p-5">
                      {!preview ? <p className="text-gris text-[14px]">{t('Escribe el peso para calcular el pago.')}</p> : (
                        <dl className="grid gap-2.5 text-[15px]">
                          <Linea etiqueta={`${qty(quantity)} ${product?.unit} × ${mxn(preview.unitPrice)}`} valor={mxn(preview.gross)} />
                          {preview.deductions.map((d) => <Linea key={d.reason} etiqueta={t('Castigo: {label}', { label: d.label })} valor={`− ${mxn(d.amount)}`} tono="text-rojo" />)}
                          {preview.credit && Number(preview.creditRepayment) > 0 && (
                            <Linea etiqueta={t('Abono a crédito {ref} ({pct}%)', { ref: preview.credit.reference, pct: Number(preview.credit.repaymentPercent) })} valor={`− ${mxn(preview.creditRepayment)}`} tono="text-naranja" />
                          )}
                          <div className="mt-2 border-t-2 border-tinta pt-3 flex items-baseline justify-between">
                            <dt className="font-bold">{t('Recibe')}</dt>
                            <dd className="num font-display text-[30px] font-extrabold text-verde leading-none" style={{ fontVariationSettings: '"wdth" 108' }}>{mxn(preview.net)}</dd>
                          </div>
                        </dl>
                      )}
                      {error && <div className="mt-4"><ErrorCaja mensaje={error} /></div>}
                      {!confirmando ? (
                        <Button block className="mt-5" disabled={!preview || p.account !== 'ok' || recoveryBlocked} onClick={() => setConfirmando(true)}>
                          <Icon name="payments" /> {t('Ejecutar pago')}
                        </Button>
                      ) : (
                        <div className="mt-5 grid gap-3">
                          <div className="text-[14px]">{t('¿Confirmas el pago de {amount} a {name}?', { amount: mxn(preview?.net), name: p.name })}{Number(preview?.creditRepayment) > 0 && t(' Incluye el abono de {amount} al prestamista.', { amount: mxn(preview?.creditRepayment) })} {t('Se ejecuta en Stellar testnet.')}</div>
                          <Button block disabled={paying || !recoveryChecked} onClick={() => enviarEntrega()}><Icon name="lock" /> {paying ? t('Firmando y enviando…') : t('Confirmar pago')}</Button>
                          <Button block variant="ghost" disabled={paying} onClick={() => setConfirmando(false)}>{t('Cancelar')}</Button>
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
          <div className="mb-2"><EstadoPago s="paid" paymentState="paid" /></div>
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-verde-brillo flex items-center gap-1.5"><Icon name="verified" filled size={18} /> {t('Pago exitoso en Stellar')}</div>
          <div className="mt-2 num font-display text-[30px] font-extrabold text-verde-brillo leading-none">{mxn(r.net)}</div>
          <div className="mt-1 text-[14px] text-papel num">{r.tokenAmount && t('Liquidado en Stellar: {amount} {asset}', { amount: token(r.tokenAmount), asset: r.asset })}</div>
          <div className="mt-2 text-[13px] text-gris-3 num">{t('Entrega {ref}', { ref: r.reference })}{Number(r.creditRepayment) > 0 && t(' · abono al crédito {amount} en la misma transacción', { amount: mxn(r.creditRepayment) })}</div>
          {r.txHash && <div className="mt-2"><Tx hash={r.txHash} n={10} /></div>}
        </div>
        <div className="flex flex-wrap gap-3">
          {r.explorer && <a href={r.explorer} target="_blank" rel="noreferrer"><Button tone="oscuro">{t('Ver en Stellar')} <Icon name="open_in_new" size={18} /></Button></a>}
          <Link to={`/historial/${r.settlementId}`}><Button tone="oscuro" variant="ghost">{t('Detalle e ISO 20022')}</Button></Link>
          <Link to={`/recibo/${r.settlementId}`} target="_blank"><Button tone="oscuro" variant="ghost"><Icon name="receipt_long" /> {t('Recibo')}</Button></Link>
        </div>
      </div>
    </div>
  );
}

function EntregaRecuperada({
  delivery, payment, loading, referenceNotFound, resendAllowed, paying, error, onSend, onRetry, onHandoff,
}: {
  delivery: StoredDelivery;
  payment: PaymentResult | null;
  loading: boolean;
  referenceNotFound: boolean;
  resendAllowed: boolean;
  paying: boolean;
  error: string | null;
  onSend: () => void;
  onRetry: () => void;
  onHandoff: () => void;
}) {
  return (
    <Panel sombra>
      <BarraPanel>{t('Entrega guardada')}</BarraPanel>
      <div className="grid gap-4 p-5">
        <p className="text-[14px]">
          {t('Productor {id} · {quantity} · {price}', {
            id: delivery.input.producerId,
            quantity: delivery.input.quantity,
            price: delivery.input.unitPrice ?? '—',
          })}
        </p>
        {loading ? <p className="text-gris">{t('Buscando el pago registrado…')}</p> : payment ? (
          <>
            <div className="grid gap-3">
              <EstadoPago s={payment.paymentState} paymentState={payment.paymentState} />
              <MensajeEstadoPago paymentState={payment.paymentState} txHash={payment.txHash} />
              {payment.resultCode && <p className="num text-[13px]">{t('Código de rechazo')}: {payment.resultCode}</p>}
            </div>
            <div className="flex flex-wrap gap-3">
              {payment.retryAllowed && <Button disabled={paying} onClick={onRetry}>{paying ? t('Reintentando…') : t('Reintentar pago')}</Button>}
              <Link to={`/historial/${payment.settlementId}`} onClick={onHandoff}>
                <Button variant="ghost">{t('Ver historial')}</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-[14px]">{paying ? t('Firmando y enviando…') : referenceNotFound
              ? t('No hay pago registrado con esta referencia. Puedes enviar esta entrega con la misma referencia y los mismos datos.')
              : t('No se pudo confirmar la respuesta del pago. Conservamos la misma referencia y los mismos datos.')}</p>
            {resendAllowed && <Button disabled={paying} onClick={onSend}>{paying ? t('Firmando y enviando…') : t('Enviar la misma entrega')}</Button>}
          </>
        )}
        {error && <ErrorCaja mensaje={error} />}
      </div>
    </Panel>
  );
}
