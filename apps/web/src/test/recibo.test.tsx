import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Recibo from '../pages/Recibo';
import { useData } from '../useData';

// Mock useData hook
vi.mock('../useData');

describe('Recibo (receipt) page', () => {
  const mockUseData = vi.mocked(useData);

  beforeEach(() => {
    mockUseData.mockReturnValue({
      data: {
        id: 42,
        status: 'paid' as const,
        reference: 'ENT-001',
        producer: 'María García',
        community: 'Xico',
        net: '1250.00',
        quantity: '250',
        unit: 'kg',
        unit_price: '5.00',
        gross: '1250.00',
        product: 'Café cereza',
        deductions: [],
        credit_repayment: '0',
        credit_ref: null,
        credit_outstanding: null,
        producer_id: 1,
        stellar_address: 'GABC...XYZ',
        created_at: '2024-01-15T10:00:00Z',
        settled_at: '2024-01-15T10:05:00Z',
        quality: {},
        lot: null,
        notes: null,
        run_id: null,
        msg_id: null,
        end_to_end_id: null,
        uetr: null,
        tx_hash: 'abc123',
        pain001_sha256: null,
        result_code: null,
        explorer: null,
        token_amount: null,
        fx_rate: null,
      },
      error: null,
      reload: vi.fn(),
    });
  });

  it('renders producer, amount and reference', () => {
    render(
      <MemoryRouter initialEntries={['/recibo/42']}>
        <Routes>
          <Route path="/recibo/:id" element={<Recibo />} />
        </Routes>
      </MemoryRouter>
    );

    // Assert producer is rendered (use custom matcher for text that may be split)
    expect(screen.getByText((content, element) => {
      return element?.textContent === 'María García · Xico';
    })).toBeInTheDocument();

    // Assert amount is rendered (formatted as MXN) - check that it appears at least once
    expect(screen.getAllByText(/1,250\.00/).length).toBeGreaterThan(0);

    // Assert reference is rendered (it's part of "Your delivery ENT-001")
    expect(screen.getByText((content, element) => {
      return element?.textContent === 'Your delivery ENT-001';
    })).toBeInTheDocument();
  });
});
