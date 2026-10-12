import { describe, expect, it } from 'vitest';
import { settle, type DeductionRule } from '../src/settlement.js';

const HUMEDAD: DeductionRule[] = [
  { attribute: 'humedad', above: '12', percent: '4', reason: 'HUME', label: 'Humedad' },
  { attribute: 'humedad', above: '14', percent: '10', reason: 'HUME', label: 'Humedad' },
];

describe('liquidación', () => {
  it('kilos × precio sin castigos ni crédito', () => {
    const r = settle({ quantity: '250', unitPrice: '85', quality: { humedad: 11.5 }, rules: HUMEDAD });
    expect(r).toMatchObject({ gross: '21250.00', deductions: [], creditRepayment: '0.00', net: '21250.00' });
  });

  it('aplica solo el escalón de castigo más alto que se rebasa', () => {
    const r = settle({ quantity: '250', unitPrice: '85', quality: { humedad: 13.5 }, rules: HUMEDAD });
    expect(r.deductions).toEqual([{ reason: 'HUME', label: 'Humedad (13.5)', amount: '850.00' }]);
    expect(settle({ quantity: '250', unitPrice: '85', quality: { humedad: 15 }, rules: HUMEDAD }).deductions[0]!.amount).toBe('2125.00');
  });

  it('descuenta el abono al crédito sobre lo que queda después de calidad', () => {
    const r = settle({
      quantity: '250', unitPrice: '85', quality: { humedad: 13.5 }, rules: HUMEDAD,
      credit: { id: 7, reference: 'CR-1', outstanding: '20000.00', repaymentPercent: '25' },
    });
    expect(r).toMatchObject({ afterQuality: '20400.00', creditRepayment: '5100.00', creditId: 7, net: '15300.00' });
  });

  it('el abono nunca excede lo que se debe', () => {
    const r = settle({
      quantity: '250', unitPrice: '85', quality: {}, rules: HUMEDAD,
      credit: { id: 7, reference: 'CR-1', outstanding: '1200.50', repaymentPercent: '25' },
    });
    expect(r).toMatchObject({ creditRepayment: '1200.50', net: '20049.50' });
  });

  it('redondea a centavos una sola vez, sin errores de punto flotante', () => {
    const r = settle({ quantity: '0.1', unitPrice: '0.2', quality: {}, rules: [] });
    expect(r.gross).toBe('0.02');
    expect(settle({ quantity: '33.33', unitPrice: '87.15', quality: {}, rules: [] }).gross).toBe('2904.71');
  });

  it('rechaza cantidades y precios no positivos', () => {
    expect(() => settle({ quantity: '0', unitPrice: '85', quality: {}, rules: [] })).toThrow();
    expect(() => settle({ quantity: '10', unitPrice: '-1', quality: {}, rules: [] })).toThrow();
  });
});
