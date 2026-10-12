export interface Summary {
  cooperative: { name: string; stellar_address: string };
  balance: string | null;
  asset: { code: string; issuer: string };
  network: string;
  signer: 'local' | 'micopay';
}
export interface QualityField { key: string; label: string; unit: string }
export interface Product {
  id: number; name: string; unit: string; price: string | null; price_since: string | null; quality_schema: QualityField[];
  rules: Array<{ attribute: string; above: string; percent: string; label: string }> | null;
}
export interface PriceRow { id: number; product: string; unit: string; price: string; valid_from: string }
export interface ProducerRow {
  id: number; name: string; community: string | null; contact: string | null; account_id: string; stellar_address: string;
  is_active: boolean; created_at: string; delivered: string; paid: string; credit_outstanding: string;
}
export type AccountState = 'ok' | 'sin_cuenta' | 'sin_trustline';
export interface ProducerDetail extends ProducerRow {
  account: AccountState;
  stats: { deliveries: number; quantity: string; paid: string; repaid: string; last_payment: string | null };
  history: Array<{ id: number; reference: string; created_at: string; product: string; unit: string; quantity: string; unit_price: string; gross: string; credit_repayment: string; net: string; status: string; tx_hash: string | null }>;
  credits: Array<{ id: number; reference: string; purpose: string; total_due: string; outstanding: string; due_date: string; status: CreditStatus }>;
}
export interface Deduction { reason: string; label: string; amount: string }
export interface Preview {
  unitPrice: string; dailyPrice: string; gross: string; deductions: Deduction[]; afterQuality: string; creditRepayment: string; net: string;
  credit: { reference: string; outstanding: string; repaymentPercent: string } | null;
}
export interface PaymentInput { producerId: number; productId: number; quantity: string; quality: Record<string, number>; unitPrice?: string; lot?: string; notes?: string }
export interface PaymentResult extends Preview { runId: number; status: 'settled' | 'rejected'; txHash: string; resultCode?: string; explorer: string; settlementId: number; reference: string }
export interface Payment {
  id: number; status: 'paid' | 'pending' | 'in_run'; reference: string; lot: string | null; notes: string | null; quantity: string; quality: Record<string, number>;
  created_at: string; product: string; unit: string; unit_price: string; gross: string; deductions: Deduction[]; credit_repayment: string; net: string;
  credit_ref: string | null; credit_outstanding: string | null; producer_id: number; producer: string; community: string | null; stellar_address: string;
  run_id: number | null; msg_id: string | null; end_to_end_id: string | null; uetr: string | null; tx_hash: string | null; settled_at: string | null;
  pain001_sha256: string | null; result_code: string | null; explorer?: string | null;
}
export type CreditStatus = 'pendiente' | 'vigente' | 'vencido' | 'pagado' | 'cancelado';
export interface Credit {
  id: number; reference: string; purpose: string; principal: string; annual_rate: string; term_months: number; interest: string; total_due: string;
  outstanding: string; repayment_percent: string; auto_deduct: boolean; due_date: string; status: CreditStatus; terms_sha256: string;
  disbursement_tx: string | null; disbursed_at: string | null; created_at: string; producer_id: number; producer: string; lender_id: number; lender: string; repaid: string;
}
export interface CreditMovement { id: number; kind: 'desembolso' | 'abono'; amount: string; balance_after: string; tx_hash: string | null; created_at: string; delivery: string | null; settlement_id: number | null; explorer: string | null }
export interface NewCredit { producerId: number; lenderId: number; purpose: string; principal: string; annualRate: string; termMonths: number; repaymentPercent: string; dueDate: string }
export interface Lender { id: number; name: string; kind: string; account_id: string; stellar_address: string; active_credits: number; portfolio: string; balance: string | null; canSign: boolean }
export interface Metrics {
  month: string;
  kpis: { payments: number; paid: string; gross: string; quantity: string; producers: number; repayments: string; avg_price: string | null };
  byDay: Array<{ day: string; payments: number; paid: string; quantity: string }>;
  top: Array<{ producer: string; quantity: string; paid: string }>;
}
export interface AuditRow { id: number; action: string; details: Record<string, unknown>; created_at: string }

async function call<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? undefined : {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
};

export interface PaymentFilters { from?: string; to?: string; status?: string; producerId?: number }

export const api = {
  summary: () => call<Summary>('/summary'),
  products: () => call<Product[]>('/products'),
  prices: (productId?: number) => call<PriceRow[]>(`/prices${qs({ productId })}`),
  setPrice: (productId: number, price: string) => call('/prices', { productId, price }),

  producers: (q?: string) => call<ProducerRow[]>(`/producers${qs({ q })}`),
  producer: (id: number) => call<ProducerDetail>(`/producers/${id}`),
  createProducer: (b: { name: string; community?: string; contact?: string; stellarAddress: string }) => call<{ id: number; accountId: string; account: AccountState }>('/producers', b),
  setProducerActive: (id: number, isActive: boolean) => call(`/producers/${id}`, { isActive }, 'PATCH'),
  testnetAccount: () => call<{ address: string }>('/testnet/account', {}),

  preview: (b: PaymentInput) => call<Preview>('/payments/preview', b),
  pay: (b: PaymentInput) => call<PaymentResult>('/payments', b),
  retry: (id: number) => call<{ status: string; txHash: string; explorer: string }>(`/payments/${id}/retry`, {}),
  payments: (f: PaymentFilters & { limit?: number; offset?: number }) => call<Payment[]>(`/payments${qs({ ...f })}`),
  payment: (id: number) => call<Payment>(`/payments/${id}`),
  paymentsCsvUrl: (f: PaymentFilters) => `/api/payments.csv${qs({ ...f })}`,

  lenders: () => call<Lender[]>('/lenders'),
  createLender: (b: { name: string; kind?: string; stellarAddress: string }) => call<{ id: number }>('/lenders', b),

  credits: (status?: string) => call<Credit[]>(`/credits${qs({ status })}`),
  credit: (id: number) => call<Credit & { movements: CreditMovement[] }>(`/credits/${id}`),
  createCredit: (b: NewCredit) => call<{ id: number; reference: string }>('/credits', b),
  disburse: (id: number) => call<{ txHash: string; explorer: string }>(`/credits/${id}/disburse`, {}),
  cancelCredit: (id: number) => call(`/credits/${id}/cancel`, {}),
  updateCredit: (id: number, b: { autoDeduct?: boolean; repaymentPercent?: string }) => call(`/credits/${id}`, b, 'PATCH'),

  metrics: (month?: string) => call<Metrics>(`/metrics${qs({ month })}`),
  audit: (offset = 0) => call<AuditRow[]>(`/audit${qs({ offset, limit: 50 })}`),
};
