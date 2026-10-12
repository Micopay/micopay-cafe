export interface Summary {
  cooperative: { name: string; stellar_address: string };
  balance: string | null;
  asset: { code: string; issuer: string };
  network: string;
  producers: number;
  pending_total: string;
  pending_count: number;
  paid_total: string;
  paid_quantity: string;
  credit_outstanding: string;
}
export interface Credit { reference: string; purpose: string; principal: string; outstanding: string; repayment_percent: string; status: string }
export interface Producer { id: number; name: string; community: string; account_id: string; stellar_address: string; delivered: string; paid: string; credit: Credit | null }
export interface QualityField { key: string; label: string; unit: string }
export interface Product { id: number; name: string; unit: string; price: string; quality_schema: QualityField[]; rules: Array<{ attribute: string; above: string; percent: string; label: string }> | null }
export interface Deduction { reason: string; label: string; amount: string }
export interface Preview {
  unitPrice: string; gross: string; deductions: Deduction[]; afterQuality: string; creditRepayment: string; net: string;
  credit: { reference: string; outstanding: string; repaymentPercent: string } | null;
}
export interface Settlement {
  id: number; status: string; reference: string; lot: string | null; quantity: string; quality: Record<string, number>; created_at: string;
  product: string; unit: string; unit_price: string; gross: string; deductions: Deduction[]; credit_repayment: string; net: string;
  credit_ref: string | null; credit_outstanding: string | null; producer_id: number; producer: string; community: string; stellar_address: string;
  run_id: number | null; end_to_end_id: string | null; uetr: string | null; tx_hash: string | null; settled_at: string | null;
  pain001_sha256: string | null; explorer?: string | null;
}
export interface Run {
  id: number; msg_id: string; status: string; tx_hash: string | null; result_code: string | null; pain001_sha256: string;
  created_at: string; settled_at: string | null; payments: number; total: string; repayments: string; explorer: string | null;
}
export interface CreditRow extends Credit { id: number; producer: string; lender: string; repaid: string; created_at: string }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

export const api = {
  summary: () => call<Summary>('/summary'),
  producers: () => call<Producer[]>('/producers'),
  products: () => call<Product[]>('/products'),
  preview: (b: DeliveryInput) => call<Preview>('/deliveries/preview', b),
  createDelivery: (b: DeliveryInput) => call<Preview & { reference: string; settlementId: number }>('/deliveries', b),
  settlements: (status?: string) => call<Settlement[]>(`/settlements${status ? `?status=${status}` : ''}`),
  settlement: (id: number) => call<Settlement>(`/settlements/${id}`),
  pay: (settlementIds: number[]) => call<{ runId: number; status: string; txHash: string; resultCode?: string; explorer: string }>('/runs', { settlementIds }),
  runs: () => call<Run[]>('/runs'),
  credits: () => call<CreditRow[]>('/credits'),
};

export interface DeliveryInput { producerId: number; productId: number; quantity: string; quality: Record<string, number>; lot?: string }
