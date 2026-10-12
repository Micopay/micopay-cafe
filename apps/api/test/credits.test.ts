import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalTerms, computeTerms } from '../src/credits.js';

describe('términos del crédito', () => {
  it('interés simple fijo al otorgar: 20,000 al 8.5% anual por 8 meses', () => {
    expect(computeTerms({ principal: '20000', annualRate: '8.5', termMonths: 8 })).toEqual({ interest: '1133.33', totalDue: '21133.33' });
  });

  it('tasa cero devuelve solo el capital', () => {
    expect(computeTerms({ principal: '1500.50', annualRate: '0', termMonths: 6 })).toEqual({ interest: '0.00', totalDue: '1500.50' });
  });

  it('rechaza montos, tasas y plazos inválidos', () => {
    expect(() => computeTerms({ principal: '0', annualRate: '8', termMonths: 6 })).toThrow();
    expect(() => computeTerms({ principal: '100', annualRate: '-1', termMonths: 6 })).toThrow();
    expect(() => computeTerms({ principal: '100', annualRate: '8', termMonths: 0 })).toThrow();
    expect(() => computeTerms({ principal: '100', annualRate: '8', termMonths: 2.5 })).toThrow();
  });

  it('el JSON canónico no depende del orden de las llaves y su hash se puede recalcular', () => {
    const a = canonicalTerms({ principal: '20000.00', reference: 'CR-1', annual_rate: '8.50' });
    const b = canonicalTerms({ annual_rate: '8.50', reference: 'CR-1', principal: '20000.00' });
    expect(a).toEqual(b);
    expect(a.json).toBe('{"annual_rate":"8.50","principal":"20000.00","reference":"CR-1"}');
    expect(a.sha256).toBe(createHash('sha256').update(a.json).digest('hex'));
  });
});
