import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Cargando, ErrorCaja, Titulo } from '../App';
import { mxn, qty, short } from '../format';
import { Button, Card, Icon, Label } from '../ui';
import { useData } from '../useData';

type Resultado = Awaited<ReturnType<typeof api.pay>>;

export default function PorPagar() {
  const pending = useData(() => api.settlements('pending'));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Resultado | null>(null);

  useEffect(() => { setSelected(new Set(pending.data?.map((s) => s.id) ?? [])); }, [pending.data]);

  const rows = pending.data ?? [];
  const chosen = rows.filter((s) => selected.has(s.id));
  const totalNet = chosen.reduce((a, s) => a + Number(s.net), 0);
  const totalRepay = chosen.reduce((a, s) => a + Number(s.credit_repayment), 0);
  const ops = chosen.filter((s) => Number(s.net) > 0).length + (totalRepay > 0 ? 1 : 0);

  async function pagar() {
    setPaying(true); setError(null);
    try {
      const r = await api.pay([...selected]);
      setResult(r);
      if (r.status !== 'settled') setError(`Stellar rechazó la transacción (${r.resultCode}). No se movió dinero.`);
      pending.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPaying(false);
    }
  }

  const toggle = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <>
      <Titulo cintillo="Corrida de pago">Por pagar</Titulo>

      {result?.status === 'settled' && <Liquidada result={result} />}
      {error && <div className="mb-6"><ErrorCaja mensaje={error} /></div>}

      {!pending.data ? <Cargando /> : rows.length === 0 ? (
        !result && <p className="text-gris">No hay liquidaciones pendientes. <Link to="/entregas/nueva" className="underline font-bold text-tinta">Registra una entrega</Link>.</p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px] items-start">
          <div className="rounded-sm border-2 border-tinta bg-papel overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="bg-tinta text-papel text-left text-[11px] uppercase tracking-[.12em]">
                <tr>
                  <th className="px-3 py-3 w-10"></th>
                  <th className="px-3 py-3">Productor</th>
                  <th className="px-3 py-3">Entrega</th>
                  <th className="px-3 py-3 text-right">Bruto</th>
                  <th className="px-3 py-3 text-right">Castigos</th>
                  <th className="px-3 py-3 text-right">Abono</th>
                  <th className="px-3 py-3 text-right">Recibe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const castigos = s.deductions.reduce((a, d) => a + Number(d.amount), 0);
                  return (
                    <tr key={s.id} className="border-t border-linea cursor-pointer" onClick={() => toggle(s.id)}>
                      <td className="px-3 py-3"><input type="checkbox" readOnly checked={selected.has(s.id)} className="size-4 accent-[var(--color-tinta)]" /></td>
                      <td className="px-3 py-3"><div className="font-bold">{s.producer}</div><div className="text-gris text-[12px]">{s.community}</div></td>
                      <td className="px-3 py-3 whitespace-nowrap"><div className="num">{s.reference}</div><div className="text-gris text-[12px] num">{qty(s.quantity)} {s.unit} {s.product.toLowerCase()}</div></td>
                      <td className="px-3 py-3 text-right whitespace-nowrap num">{mxn(s.gross)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap num text-rojo">{castigos ? `− ${mxn(castigos)}` : '—'}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap num text-naranja">{Number(s.credit_repayment) ? `− ${mxn(s.credit_repayment)}` : '—'}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap num font-extrabold">{mxn(s.net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <aside className="lg:sticky lg:top-8">
            <div className="rounded-sm border-2 border-tinta bg-papel shadow-solida overflow-hidden">
              <div className="bg-tinta text-papel p-5">
                <div className="text-[11px] font-bold uppercase tracking-[.12em] text-gris-3">A productores · {chosen.length}</div>
                <div className="num mt-1.5 font-display text-[34px] font-extrabold leading-none text-naranja-claro" style={{ fontVariationSettings: '"wdth" 108' }}>{mxn(totalNet)}</div>
                {totalRepay > 0 && <div className="mt-2 text-[13px] text-gris-3 num">+ {mxn(totalRepay)} de abonos al prestamista</div>}
              </div>
              <div className="p-5 grid gap-3 text-[14px]">
                <Label>Qué va a pasar</Label>
                <ol className="grid gap-2 list-decimal pl-5 text-gris">
                  <li>Se genera el <b className="text-tinta">pain.001</b> con kilos, precio, castigos y abonos.</li>
                  <li>Su huella SHA-256 va en el memo de <b className="text-tinta">una sola transacción</b> de Stellar con {ops} operaciones.</li>
                  <li>Pagos y abonos se liquidan juntos o ninguno: el crédito no se puede saltar.</li>
                  <li>Cada productor recibe su recibo con <b className="text-tinta">camt.054</b>.</li>
                </ol>
                <Button block disabled={chosen.length === 0 || paying} onClick={pagar}>
                  <Icon name="lock" /> {paying ? 'Firmando y enviando…' : 'Firmar y pagar en Stellar'}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Liquidada({ result }: { result: Resultado }) {
  return (
    <Card superficie="tinta" className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.12em] text-verde-brillo flex items-center gap-1.5"><Icon name="verified" filled size={18} /> Liquidada en Stellar</div>
          <div className="mt-2 font-display text-[22px] font-extrabold" style={{ fontVariationSettings: '"wdth" 108' }}>Corrida #{result.runId} pagada</div>
          <div className="mt-1 text-[13px] text-gris-3 num break-all">tx {short(result.txHash, 10)}</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={result.explorer} target="_blank" rel="noreferrer"><Button tone="oscuro">Ver en stellar.expert <Icon name="open_in_new" size={18} /></Button></a>
          <Link to="/corridas"><Button tone="oscuro" variant="ghost">Documentos ISO</Button></Link>
        </div>
      </div>
    </Card>
  );
}
