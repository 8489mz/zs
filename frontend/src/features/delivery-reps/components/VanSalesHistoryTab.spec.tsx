/*
 * New file: frontend/src/features/delivery-reps/components/VanSalesHistoryTab.spec.tsx
 *
 * WHAT THIS PINS (INV-VAN-PIECE-COUNT-BASIS, part of P9): the
 * history piece total counted cartons as pieces — invoice
 * VAN-261113-0002 (2 cartons of A) contributed "2 قطعة" to the total,
 * so the day showed 21 pieces while the true piece count was 43.
 * The stored packagingBreakdown.piecesCount was built as
 * cart.reduce((s, it) => s + it.qty, 0) — raw cart qty — and the
 * no-breakdown fallback summed raw sale-item qty too, even though
 * the items carry unitMultiplier.
 *
 * WHAT IS DRIVEN (real tab, mocked vanSalesApi.getDriverSales):
 * two sales — (a) 2 cartons (qty 2, unitMultiplier 12) with NO
 * packagingBreakdown, (b) 12 pieces (qty 12, unitMultiplier 1) with
 * a stored breakdown of 12 pieces — and assert the "الطرود" total
 * is 36 pieces (24 + 12), not 14, and the per-sale line for (a)
 * reads 24 pieces, not 2.
 *
 * NOT DRIVEN: the sale-time piecesCount computation itself (pinned
 * via the receipt path in the page spec flow); already-stored
 * breakdowns keep their wrong count (prospective only).
 */
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { VanSalesHistoryTab } from './VanSalesHistoryTab';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'ar' },
    }),
  };
});

const mockSales = [
  {
    id: 1,
    docNo: 'VAN-261113-0002',
    total: 288,
    subtotal: 288,
    discount: 0,
    paymentMethod: 'cash',
    paidAmount: 288,
    remainingCredit: 0,
    createdAt: new Date().toISOString(),
    packagingBreakdown: null,
    customerId: 3060,
    customerName: 'محل اختبار جملة 1',
    itemsCount: 1,
    items: [
      { productId: 1, name: 'صنف اختبار جملة أ', qty: 2, unitPrice: 144, lineTotal: 288, unitMultiplier: 12 },
    ],
  },
  {
    id: 2,
    docNo: 'VAN-261113-0003',
    total: 288,
    subtotal: 288,
    discount: 0,
    paymentMethod: 'credit',
    paidAmount: 0,
    remainingCredit: 288,
    createdAt: new Date().toISOString(),
    packagingBreakdown: { cartonsCount: 0, piecesCount: 12, itemsCount: 1 },
    customerId: 3060,
    customerName: 'محل اختبار جملة 1',
    itemsCount: 1,
    items: [
      { productId: 2, name: 'صنف اختبار جملة ب', qty: 12, unitPrice: 24, lineTotal: 288, unitMultiplier: 1 },
    ],
  },
];

vi.mock('../api/van-sales.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/van-sales.api')>();
  return {
    ...actual,
    vanSalesApi: {
      ...actual.vanSalesApi,
      getDriverSales: vi.fn(() => Promise.resolve({ ok: true, sales: mockSales })),
    },
  };
});

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <VanSalesHistoryTab tripId={6} customers={[]} onViewReceipt={() => {}} />
    </QueryClientProvider>,
  );
}

describe('VanSalesHistoryTab piece total', () => {
  it('counts cartons as pieces (qty x unitMultiplier), not as 1 piece', async () => {
    renderTab();
    expect(await screen.findByText('#VAN-261113-0002')).toBeTruthy();
    const parcelsLabel = screen.getByText('الطرود');
    const parcelsCell = parcelsLabel.parentElement;
    expect(parcelsCell?.textContent).toContain('36');
    expect(document.body.textContent).toContain('24 قطعة');
  });
});
