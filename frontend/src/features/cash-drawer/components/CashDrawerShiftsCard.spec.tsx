/* INV-EXPECTED-CASH-SINGLE-SOURCE: the shift detail card must render
 * the backend's expectedCash (the single source of truth, shared with
 * the close screen and the Z-report) instead of recomputing expected
 * cash locally from a subset of the legs. The local recompute omitted
 * customer collections and cancelled-sale cash, so closed shift
 * SHIFT-261113-0027 showed 3,733.90 on the detail card while the
 * close screen showed the true 4,283.90 — a phantom +550.00 variance
 * (T23 collection 300 + voided-invoice in-leg 250). Variance in the
 * detail card and in the list column must both derive from
 * row.expectedCash. The cashier close flow stays blind: this card is
 * only rendered to roles that can view sensitive totals.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CashDrawerShiftsCard } from './CashDrawerShiftsCard';
import type { CashierShift } from '@/types/domain';

function makeShift(overrides: Partial<CashierShift> = {}): CashierShift {
  return {
    id: 'SHIFT-261113-0027',
    docNo: 'SHIFT-261113-0027',
    status: 'closed',
    openingCash: 1000,
    // Backend figure (single source of truth): 1000 + 3000 - 266.10
    // + 300 collections + 250 cancelled-sale cash = 4,283.90.
    expectedCash: 4283.9,
    countedCash: 4283.9,
    variance: 0,
    createdAt: '2026-11-13T10:00:00.000Z',
    closedAt: '2026-11-13T18:00:00.000Z',
    openedByName: 'cashier_test',
    closedByName: 'admin',
    cashSalesTotal: 3000,
    cardSalesTotal: 0,
    walletSalesTotal: 0,
    instapaySalesTotal: 0,
    creditSalesTotal: 0,
    serviceCashTotal: 0,
    serviceCardTotal: 0,
    serviceTotal: 0,
    shiftSalesTotal: 3000,
    cashDrawerManualCashInTotal: 0,
    cashDrawerDeliveryCashInTotal: 0,
    cashDrawerCashOutTotal: 100,
    expensesTotal: 66.1,
    supplierPaymentsTotal: 100,
    saleReturnCashRefundTotal: 0,
    saleReturnCardRefundTotal: 0,
    customerCollectionsTotal: 300,
    cancelledSaleCashTotal: 250,
    movementItems: [],
    ...overrides,
  };
}

function renderCard(rows: CashierShift[]) {
  return render(
    <CashDrawerShiftsCard
      search=""
      onSearchChange={vi.fn()}
      shiftFilter="all"
      onShiftFilterChange={vi.fn()}
      onReset={vi.fn()}
      onCopySummary={vi.fn()}
      onExportRows={vi.fn()}
      onPrintRows={vi.fn()}
      totalItems={rows.length}
      rows={rows}
      canViewSensitiveTotals
      isLoading={false}
      isError={false}
      error={null}
      page={1}
      pageSize={20}
      totalPaginationItems={rows.length}
      onPageChange={vi.fn()}
      onPageSizeChange={vi.fn()}
    />,
  );
}

function expandDetails() {
  fireEvent.click(screen.getByRole('button', { name: 'التفاصيل' }));
}

describe('CashDrawerShiftsCard expected cash (INV-EXPECTED-CASH-SINGLE-SOURCE)', () => {
  it('shows the backend expected cash 4,283.90, not the local 3,733.90 recompute', () => {
    renderCard([makeShift()]);
    expandDetails();

    const expectedRow = screen.getByText('صافي النقدية المتوقعة:').closest('div');
    expect(expectedRow?.textContent).toContain('4,283.90');
    // The phantom local figure and its +550 variance must appear nowhere:
    // not in the detail card, not in the list variance column.
    expect(document.body.textContent).not.toContain('3,733.90');
    expect(document.body.textContent).not.toContain('550.00');
  });

  it('renders the customer-collections and cancelled-sale-cash legs', () => {
    renderCard([makeShift()]);
    expandDetails();

    const collectionsRow = screen.getByText('(+) تحصيلات عملاء نقدي:').closest('div');
    expect(collectionsRow?.textContent).toContain('300.00');
    const cancelledRow = screen.getByText('(+) نقدية فواتير ملغاة:').closest('div');
    expect(cancelledRow?.textContent).toContain('250.00');
  });

  it('derives the final variance from the backend expected cash', () => {
    // Counted 4,293.90 against backend expected 4,283.90 is +10.00.
    // The local recompute would have shown +560.00 instead.
    renderCard([makeShift({ countedCash: 4293.9, variance: 10 })]);
    expandDetails();

    const varianceRow = screen.getByText('الفارق النهائي (عجز / زيادة):').closest('div');
    expect(varianceRow?.textContent).toContain('10.00');
    expect(document.body.textContent).not.toContain('560.00');
  });

  it('hides the two legs when the backend reports zero for them', () => {
    renderCard([
      makeShift({
        customerCollectionsTotal: 0,
        cancelledSaleCashTotal: 0,
        expectedCash: 3733.9,
        countedCash: 3733.9,
      }),
    ]);
    expandDetails();

    expect(screen.queryByText('(+) تحصيلات عملاء نقدي:')).not.toBeInTheDocument();
    expect(screen.queryByText('(+) نقدية فواتير ملغاة:')).not.toBeInTheDocument();
    const expectedRow = screen.getByText('صافي النقدية المتوقعة:').closest('div');
    expect(expectedRow?.textContent).toContain('3,733.90');
  });
});
