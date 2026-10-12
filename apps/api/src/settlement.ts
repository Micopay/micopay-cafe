import Big from 'big.js';

/**
 * Delivery settlement ("liquidación"): pure function, no I/O.
 * Money is rounded to cents exactly once per line, and every later step works on
 * already-rounded values, so the ISO message, the ledger and the receipt agree.
 */

export interface DeductionRule {
  attribute: string;
  above: string;
  percent: string;
  reason: string;
  label: string;
}

export interface CreditTerms {
  id: number;
  reference: string;
  outstanding: string;
  repaymentPercent: string;
}

export interface SettlementInput {
  quantity: string;
  unitPrice: string;
  quality: Record<string, number>;
  rules: DeductionRule[];
  credit?: CreditTerms | null;
}

export interface Deduction {
  reason: string;
  label: string;
  amount: string;
}

export interface SettlementResult {
  gross: string;
  deductions: Deduction[];
  afterQuality: string;
  creditRepayment: string;
  creditId: number | null;
  net: string;
}

const cents = (b: Big) => b.round(2, Big.roundHalfUp);

export function settle(input: SettlementInput): SettlementResult {
  const quantity = new Big(input.quantity);
  const price = new Big(input.unitPrice);
  if (quantity.lte(0)) throw new Error('la cantidad debe ser mayor que cero');
  if (price.lte(0)) throw new Error('el precio debe ser mayor que cero');

  const gross = cents(quantity.times(price));

  // Per attribute, only the highest tier exceeded applies.
  const byAttribute = new Map<string, DeductionRule>();
  for (const rule of input.rules) {
    const value = input.quality[rule.attribute];
    if (value === undefined || !new Big(value).gt(rule.above)) continue;
    const current = byAttribute.get(rule.attribute);
    if (!current || new Big(rule.above).gt(current.above)) byAttribute.set(rule.attribute, rule);
  }
  const deductions: Deduction[] = [...byAttribute.values()].map((r) => ({
    reason: r.reason,
    label: `${r.label} (${input.quality[r.attribute]})`,
    amount: cents(gross.times(r.percent).div(100)).toFixed(2),
  }));

  const afterQuality = deductions.reduce((acc, d) => acc.minus(d.amount), gross);
  if (afterQuality.lt(0)) throw new Error('los castigos superan el valor de la entrega');

  let creditRepayment = new Big(0);
  if (input.credit && new Big(input.credit.outstanding).gt(0)) {
    const byPercent = cents(afterQuality.times(input.credit.repaymentPercent).div(100));
    creditRepayment = byPercent.gt(input.credit.outstanding) ? new Big(input.credit.outstanding) : byPercent;
  }

  return {
    gross: gross.toFixed(2),
    deductions,
    afterQuality: afterQuality.toFixed(2),
    creditRepayment: creditRepayment.toFixed(2),
    creditId: creditRepayment.gt(0) ? input.credit!.id : null,
    net: afterQuality.minus(creditRepayment).toFixed(2),
  };
}
