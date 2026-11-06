/* Purchase dialog buttons (INV-PURCHASE-DIALOG-BUTTONS): the 8 action
 * controls in the purchase detail dialog must all stay visible without
 * overlap or clipping at normal and narrow widths, in both the matched
 * (7 controls, no GRN) and unmatched (8 controls) states. The fixed
 * 3-column grid plus the global button nowrap rule used to let long
 * labels overflow their cell; each control now wraps its label inside
 * its own cell. Renders the REAL PurchaseDetailCard.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { PurchaseDetailCard } from './PurchaseDetailCard';
import type { Purchase } from '@/types/domain';

vi.mock('./PurchasePaymentScheduleCard', () => ({
  PurchasePaymentScheduleCard: () => null,
}));

const basePurchase: Purchase = {
  id: '1',
  docNo: 'PO-261106-0001',
  supplierId: '7',
  supplierName: 'مورد تجريبي',
  paymentType: 'credit',
  subTotal: 100,
  discount: 0,
  taxRate: 0,
  taxAmount: 0,
  pricesIncludeTax: false,
  total: 100,
  note: '',
  status: 'draft',
  createdBy: 'admin',
  branchId: '1',
  branchName: 'الفرع الرئيسي',
  locationId: '1',
  locationName: 'المخزن الرئيسي',
  date: '2026-11-06T10:00:00.000Z',
  items: [
    { id: 'i1', productId: '10', name: 'صنف تجريبي', qty: 2, cost: 50, total: 100, unitName: 'قطعة', unitMultiplier: 1 },
  ],
};

const renderCard = (purchase: Purchase) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PurchaseDetailCard purchase={purchase} onPrint={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

const assertBarWraps = (container: HTMLElement) => {
  const bar = container.querySelector('.invoice-detail-actions-bar') as HTMLElement;
  expect(bar).toBeTruthy();
  expect(bar.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  const controls = bar.querySelectorAll('button, a');
  expect(controls.length).toBeGreaterThan(0);
  controls.forEach((el) => {
    expect((el as HTMLElement).style.whiteSpace).toBe('normal');
    expect((el as HTMLElement).style.overflowWrap).toBe('anywhere');
  });
  return controls.length;
};

describe('Purchase dialog buttons', () => {
  it('shows all 8 controls wrapping inside their cells when unmatched', async () => {
    const { container } = renderCard({ ...basePurchase, status: 'draft' });

    expect(await screen.findByText('فحص واعتماد المطابقة (3-Way Match)')).toBeTruthy();
    expect(screen.getByText('استلام بضاعة (GRN)')).toBeTruthy();
    expect(screen.getByText('تكلفة الوصول (Landed Costs)')).toBeTruthy();
    expect(screen.getByText('دفع لمورد')).toBeTruthy();
    expect(screen.getByText(/طباعة باركود البنود/)).toBeTruthy();
    expect(screen.getByText('طباعة الفاتورة')).toBeTruthy();
    expect(screen.getByText('تعديل الفاتورة')).toBeTruthy();
    expect(screen.getByText('إلغاء الفاتورة')).toBeTruthy();
    expect(assertBarWraps(container)).toBe(8);
  });

  it('shows 7 controls wrapping inside their cells when matched', async () => {
    const { container } = renderCard({ ...basePurchase, status: 'posted' });

    expect(await screen.findByText('فحص واعتماد المطابقة (3-Way Match)')).toBeTruthy();
    expect(screen.queryByText('استلام بضاعة (GRN)')).toBeNull();
    expect(screen.getByText('تكلفة الوصول (Landed Costs)')).toBeTruthy();
    expect(screen.getByText('دفع لمورد')).toBeTruthy();
    expect(screen.getByText(/طباعة باركود البنود/)).toBeTruthy();
    expect(screen.getByText('طباعة الفاتورة')).toBeTruthy();
    expect(screen.getByText('تعديل الفاتورة')).toBeTruthy();
    expect(screen.getByText('إلغاء الفاتورة')).toBeTruthy();
    expect(assertBarWraps(container)).toBe(7);
  });
});
