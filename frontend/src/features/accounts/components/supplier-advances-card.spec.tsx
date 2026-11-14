/*
 * supplier-advances-card.spec.tsx — INV-SUPPLIER-ADVANCE-UI-WIRING.
 *
 * THE GAP (proven live on test10k, re-trial 2026-11-14 08:35): the
 * apply-advance endpoint existed, but NO UI called it — no apply
 * action was visible anywhere for a supplier advance, and a site-wide
 * search for "دفعة مقدمة" found no menu.
 *
 * WHAT THIS PINS, driving the REAL SupplierAdvancesCard with a mocked
 * http layer (same pattern as ledger-panel-supplier-payment.spec.tsx):
 * - the card lists the supplier's OPEN advances (isAdvance with a
 *   remaining amount) with the remaining amount, and hides a fully
 *   applied advance and an ordinary settlement;
 * - applying posts POST /api/supplier-payments/<id>/apply-advance
 *   with the amount (defaulting to min(remaining, payable balance))
 *   and shows the success text;
 * - with no payable balance the apply button is disabled and the
 *   card explains why (apply needs an outstanding bill).
 */
import '@/lib/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { SupplierAdvancesCard } from './SupplierAdvancesCard';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

const OPEN_ADVANCE = {
  id: '7',
  docNo: 'ZPV-261114-000001',
  supplierId: '6',
  amount: 200,
  isAdvance: true,
  appliedAmount: 0,
  remainingAdvance: 200,
  note: 'دفعة مقدمة',
  date: '2026-11-14',
  paymentChannel: 'cash',
  instapayAddress: '',
  createdBy: 'cash',
};

const APPLIED_ADVANCE = {
  ...OPEN_ADVANCE,
  id: '8',
  docNo: 'ZPV-261114-000002',
  amount: 100,
  appliedAmount: 100,
  remainingAdvance: 0,
};

const ORDINARY_PAYMENT = {
  ...OPEN_ADVANCE,
  id: '9',
  docNo: 'ZPV-261114-000003',
  amount: 150,
  isAdvance: false,
  appliedAmount: 0,
  remainingAdvance: 150,
};

function renderCard(supplierBalance: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SupplierAdvancesCard supplierId="6" supplierName="مورد 0006" supplierBalance={supplierBalance} />
    </QueryClientProvider>,
  );
}

describe('SupplierAdvancesCard', () => {
  it('lists only the open advance, with its remaining amount', async () => {
    httpMock.mockResolvedValue({ supplierPayments: [OPEN_ADVANCE, APPLIED_ADVANCE, ORDINARY_PAYMENT], total: 3 });
    renderCard(300);
    await waitFor(() => expect(screen.getByText('ZPV-261114-000001')).toBeTruthy());
    expect(screen.queryByText('ZPV-261114-000002')).toBeNull();
    expect(screen.queryByText('ZPV-261114-000003')).toBeNull();
    expect(httpMock).toHaveBeenCalledWith(expect.stringContaining('/api/supplier-payments?supplierId=6'));
    expect(screen.getByDisplayValue('200')).toBeTruthy();
  });

  it('applying posts to the apply-advance endpoint with the default amount', async () => {
    httpMock.mockImplementation((url: string) => {
      if (url.includes('/apply-advance')) {
        return Promise.resolve({ ok: true, appliedAmount: 200, remainingAdvance: 0 });
      }
      return Promise.resolve({ supplierPayments: [OPEN_ADVANCE], total: 1 });
    });
    renderCard(300);
    await waitFor(() => expect(screen.getByText('ZPV-261114-000001')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /تطبيق على المستحقات/ }));
    await waitFor(() =>
      expect(httpMock).toHaveBeenCalledWith(
        '/api/supplier-payments/7/apply-advance',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ amount: 200 }) }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/تم تطبيق الدفعة المقدمة/)).toBeTruthy());
  });

  it('with no payable balance the apply button is disabled and the card explains why', async () => {
    httpMock.mockResolvedValue({ supplierPayments: [OPEN_ADVANCE], total: 1 });
    renderCard(0);
    await waitFor(() => expect(screen.getByText('ZPV-261114-000001')).toBeTruthy());
    expect(screen.getByText(/لا يوجد رصيد مستحق حاليًا/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /تطبيق على المستحقات/ })).toBeDisabled();
    expect(httpMock).not.toHaveBeenCalledWith(expect.stringContaining('/apply-advance'), expect.anything());
  });

  it('shows the empty state when the supplier has no open advances', async () => {
    httpMock.mockResolvedValue({ supplierPayments: [], total: 0 });
    renderCard(300);
    await waitFor(() => expect(screen.getByText(/لا توجد دفعات مقدمة مفتوحة/)).toBeTruthy());
  });
});
