import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { api, type Payment } from '../api';
import Recibo from '../pages/Recibo';

const payment = {
  id: 42, status: 'paid', reference: 'ENT-001', producer: 'María García', community: 'Xico',
  net: '1250.00', quantity: '250', unit: 'kg', unit_price: '5.00', gross: '1250.00', product: 'Café cereza',
  deductions: [], credit_repayment: '0', credit_ref: null, credit_outstanding: null, producer_id: 1,
  stellar_address: 'GABC...XYZ', created_at: '2024-01-15T10:00:00Z', settled_at: '2024-01-15T10:05:00Z',
  quality: {}, lot: null, notes: null, run_id: null, msg_id: null, end_to_end_id: null, uetr: null,
  tx_hash: 'abc123', pain001_sha256: null, result_code: null, explorer: null, token_amount: null, fx_rate: null,
} as unknown as Payment;

describe('Recibo (receipt) page', () => {
  it('loads the payment through api.payment and shows producer, amount and reference', async () => {
    const spy = vi.spyOn(api, 'payment').mockResolvedValue(payment);
    render(
      <MemoryRouter initialEntries={['/recibo/42']}>
        <Routes>
          <Route path="/recibo/:id" element={<Recibo />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText((_, el) => el?.textContent === 'María García · Xico')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(42);
    expect(screen.getAllByText(/1,250\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText((_, el) => el?.textContent === 'Your delivery ENT-001')).toBeInTheDocument();
  });
});
