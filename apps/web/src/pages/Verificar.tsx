import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t } from '../i18n';
import { api } from '../api';
import { BarraPanel, Panel, Titulo } from '../comun';
import { mxn, token } from '../format';
import { Button, Icon, Label, TextField } from '../ui';
import { fetchHorizon, HORIZON_URL, parsePain001, parseTxInput, verifyPayment, type ParsedPain001, type VerificationResult } from '../verify';

type Net = 'TESTNET' | 'PUBLIC';

export default function Verificar() {
  const [params] = useSearchParams();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array<ArrayBuffer> } | null>(null);
  const [parsed, setParsed] = useState<ParsedPain001 | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [txInput, setTxInput] = useState(params.get('tx') ?? '');
  const [txError, setTxError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);

  const [net, setNet] = useState<Net | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [manualNet, setManualNet] = useState<Net>('TESTNET');

  // The page reads the network from /api/health; when the API is unreachable the
  // operator picks the network by hand.
  useEffect(() => {
    api.health().then((h) => {
      if (h.network === 'PUBLIC' || h.network === 'TESTNET') setNet(h.network);
      else setApiDown(true);
    }).catch(() => setApiDown(true));
  }, []);

  const effectiveNet: Net = apiDown ? manualNet : (net ?? 'TESTNET');
  const baseUrl = HORIZON_URL[effectiveNet];

  async function loadFile(f: File) {
    setFile(null);
    setParsed(null);
    setResult(null);
    setFileError(null);
    setTxError(null);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(await f.arrayBuffer());
    } catch {
      setFileError(t('No se pudo leer el archivo pain.001.'));
      return;
    }
    setFile({ name: f.name, bytes });
    try {
      setParsed(parsePain001(new TextDecoder().decode(bytes)));
    } catch {
      setParsed(null);
    }
  }

  async function verificar() {
    if (!file) { setFileError(t('Falta el archivo pain.001.')); return; }
    const txHash = parseTxInput(txInput);
    if (!txHash) { setTxError(t('No es un hash de transacción válido.')); return; }
    setTxError(null);
    setBusy(true);
    setResult(null);
    try {
      setResult(await verifyPayment({ fileBytes: file.bytes, txHash, horizon: fetchHorizon(baseUrl) }));
    } catch (e) {
      setResult({ kind: 'error', reason: 'network' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Titulo cintillo={t('Verificación pública')}>{t('Verificar un pago')}</Titulo>
      <p className="mb-6 -mt-3 max-w-prose text-[15px] text-gris">{t('Comprueba que un documento pain.001 coincide con el dinero que se movió en Stellar, sin confiar en la API de MicoPay. La huella SHA-256 del documento es el memo de la transacción.')}</p>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Panel>
          <BarraPanel>{t('Documento y transacción')}</BarraPanel>
          <div className="p-5 grid gap-5">
            <div>
              <Label>{t('Orden de pago (pain.001)')}</Label>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void loadFile(f); }}
                className={`mt-3 flex min-h-[110px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-sm border-2 border-dashed p-6 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-tinta ${dragOver ? 'border-naranja bg-naranja-suave' : 'border-gris-2 hover:border-tinta'}`}
              >
                <Icon name="receipt_long" size={26} className="text-gris" />
                <span className="font-bold text-[15px]">{file ? file.name : t('Arrastra el archivo o selecciónalo')}</span>
                <span className="text-[13px] text-gris">{file ? t('Cambia el archivo') : 'pain.001 · XML'}</span>
                <input type="file" accept=".xml,application/xml,text/xml" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />
              </label>
              {fileError && <p role="alert" className="mt-2 text-[13px] font-semibold text-rojo">{fileError}</p>}
            </div>

            <TextField
              etiqueta={t('Transacción de Stellar (hash o enlace de stellar.expert)')}
              placeholder={t('Pega el hash o el enlace de stellar.expert')}
              value={txInput}
              onChange={(e) => { setTxInput(e.target.value); setTxError(null); setResult(null); }}
              error={txError}
            />

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label>{t('Red')}</Label>
                {apiDown ? (
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      aria-label={t('Red')}
                      value={manualNet}
                      onChange={(e) => { setManualNet(e.target.value as Net); setResult(null); }}
                      className="min-h-12 rounded-sm border-2 border-tinta bg-fondo px-3 text-[16px] font-bold focus:border-naranja"
                    >
                      <option value="TESTNET">{t('Testnet')}</option>
                      <option value="PUBLIC">{t('Pública')}</option>
                    </select>
                  </div>
                ) : net ? (
                  <div className="mt-2 num text-[15px] font-bold">{effectiveNet === 'TESTNET' ? t('Testnet') : t('Pública')} <span className="text-gris font-normal">· {baseUrl}</span></div>
                ) : (
                  <div className="mt-2 text-[15px] text-gris">{t('Leyendo red…')}</div>
                )}
                {apiDown && <p className="mt-1.5 text-[12px] text-gris">{t('No se pudo determinar la red; elige la red a mano.')}</p>}
              </div>
              <Button onClick={verificar} disabled={busy || (!apiDown && !net)}>
                <Icon name="verified" /> {busy ? t('Verificando…') : t('Verificar')}
              </Button>
            </div>
          </div>
        </Panel>

        <div className="grid gap-6">
          {result ? <Resultado result={result} net={effectiveNet} /> : (
            <Panel sombra>
              <div className="p-8 text-center text-gris text-[15px]">{t('El resultado de la verificación aparece aquí.')}</div>
            </Panel>
          )}
          {parsed && <Documento parsed={parsed} />}
        </div>
      </div>

      <Panel>
        <BarraPanel>{t('Qué prueba y qué no')}</BarraPanel>
        <div className="p-5 grid gap-3 text-[14px]">
          <p>{t('Esta verificación prueba que este documento no se cambió después del pago y que el dinero se movió como dice el documento. No prueba los kilos ni la calidad, que los registra la compradora.')}</p>
          <p className="flex gap-2"><Icon name="lock" size={18} className="text-verde" /> <span>{t('El archivo no sale de tu navegador: solo se consulta la red pública de Stellar.')}</span></p>
        </div>
      </Panel>
    </>
  );
}

/* ── verdict ────────────────────────────────────────────────────────────────── */

function transferName(r: Extract<VerificationResult, { kind: 'payment_mismatch' }>): string {
  const tr = r.transfer;
  return tr.creditorName ?? tr.creditorAddress ?? tr.document.number;
}

function Resultado({ result, net }: { result: VerificationResult; net: Net }) {
  const v = verdictOf(result);
  const explorer = `https://stellar.expert/explorer/${net === 'TESTNET' ? 'testnet' : 'public'}/tx/`;
  const bg = v.tono === 'ok' ? 'bg-verde-suave' : v.tono === 'warn' ? 'bg-aviso' : 'bg-rojo-suave';
  const label = v.tono === 'ok' ? 'text-verde' : v.tono === 'warn' ? 'text-aviso-texto' : 'text-rojo';
  return (
    <div role="status" aria-live="polite" className={`rounded-sm border-2 border-tinta ${bg} p-5 shadow-solida`}>
      <div className="flex items-center gap-2.5">
        <span className={`font-bold uppercase tracking-[.12em] text-[12px] ${label}`}>{v.etiqueta}</span>
        {v.icon && <Icon name={v.icon} filled size={20} className="text-verde" />}
      </div>
      <p className="mt-2 text-[15px]">{v.mensaje}</p>
      {v.hash && <a href={`${explorer}${v.hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold text-verde underline num break-all">{v.hash} <Icon name="open_in_new" size={14} /></a>}
    </div>
  );
}

function verdictOf(r: VerificationResult): { tono: 'ok' | 'warn' | 'bad'; etiqueta: string; icon: string | null; mensaje: string; hash?: string } {
  switch (r.kind) {
    case 'verified':
      return { tono: 'ok', etiqueta: t('Verificado'), icon: 'verified', hash: r.txHash, mensaje: t('La huella del documento coincide con el memo de la transacción y cada transferencia tiene su pago en Stellar.') };
    case 'fingerprint_mismatch':
      return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('La huella del documento no coincide con el memo de la transacción.') };
    case 'memo_not_hash':
      return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: r.memoType === 'none' ? t('La transacción no tiene memo: no lleva huella.') : r.memoType === 'text' ? t('El memo de la transacción es texto, no una huella.') : t('El memo de la transacción no es una huella (es de tipo {type}).', { type: r.memoType }) };
    case 'tx_unsuccessful':
      return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('La transacción falló en la cadena: no se movió dinero.') };
    case 'payment_mismatch': {
      const name = transferName(r);
      if (r.mismatch === 'address') return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('Falta el pago a {name}: la transacción no envía dinero a esa dirección.', { name }) };
      if (r.mismatch === 'amount') return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('El pago a {name} mueve otro monto: el documento dice {expected} y en la cadena hay {found}.', { name, expected: token(r.expected), found: token(r.found) }) };
      if (r.mismatch === 'settlement') return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('El documento no indica un monto de Stellar válido para el pago a {name}.', { name }) };
      return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('El pago a {name} mueve otro activo: el documento dice {expected} y en la cadena hay {found}.', { name, expected: r.expected, found: r.found }) };
    }
    case 'tx_not_found':
      return { tono: 'warn', etiqueta: t('No encontrado'), icon: null, mensaje: t('La transacción no se encontró en la red de Stellar.') };
    case 'parse_error':
      return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('No se pudo leer el documento: no es un pain.001 válido.') };
    case 'error':
      if (r.reason === 'http') return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('Horizon respondió con HTTP {status}. Comprueba que elegiste la red correcta e intenta de nuevo.', { status: r.status ?? '—' }) };
      if (r.reason === 'response') return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('La respuesta de Horizon no se pudo interpretar.') };
      return { tono: 'bad', etiqueta: t('No coincide'), icon: null, mensaje: t('No se pudo conectar con la red pública de Stellar.') };
  }
}

/* ── what the document says ──────────────────────────────────────────────────── */

function Documento({ parsed }: { parsed: ParsedPain001 }) {
  return (
    <Panel>
      <BarraPanel>{t('Lo que dice el documento')}</BarraPanel>
      <div className="p-5 grid gap-5">
        {parsed.transfers.map((tr, i) => (
          <div key={i} className="grid gap-3">
            <div>
              <div className="font-bold text-[16px]">{tr.creditorName ?? t('Productor')}</div>
              {tr.creditorAddress && <div className="num text-[12px] break-all text-gris">{tr.creditorAddress}</div>}
            </div>
            <dl className="grid gap-2 text-[14px]">
              {tr.document.lines.map((l) => <Fila key={l.id} e={l.description} v={mxn(l.amount)} />)}
              <div className="border-t-2 border-linea" />
              <Fila e={t('Bruto')} v={mxn(tr.document.duePayable)} />
              {tr.document.adjustments.map((a, j) => <Fila key={j} e={a.info ?? a.reason} v={`${a.direction === 'CRDT' ? '+' : '−'} ${mxn(a.amount)}`} tono={a.direction === 'CRDT' ? 'text-verde' : 'text-rojo'} />)}
              <Fila e={t('Neto')} v={mxn(tr.document.remitted)} tono="text-verde font-extrabold" />
              {tr.settlement.tokenAmount && <Fila e={t('Liquidado en Stellar')} v={`${token(tr.settlement.tokenAmount)} ${tr.settlement.assetCode ?? ''}`} tono="text-verde font-bold" />}
              {tr.settlement.fxRate && <Fila e={t('Tipo de cambio')} v={`1 ${tr.settlement.assetCode ?? ''} = ${Number(tr.settlement.fxRate).toFixed(4)} MXN`} />}
            </dl>
          </div>
        ))}
        {parsed.msgId && <p className="text-[12px] text-gris num">{t('Orden (MsgId)')}: {parsed.msgId}</p>}
      </div>
    </Panel>
  );
}

function Fila({ e, v, tono = '' }: { e: string; v: React.ReactNode; tono?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gris">{e}</dt>
      <dd className={`num text-right whitespace-nowrap ${tono}`}>{v}</dd>
    </div>
  );
}
