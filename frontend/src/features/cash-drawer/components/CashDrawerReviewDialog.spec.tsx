/* INV-CLOSE-REVIEW-ZERO-DIFF: the review screen must treat a
 * sub-minor-unit difference as a match everywhere, and the review
 * note floor is 3 characters on a real mismatch. The dialog
 * computed its cash variance RAW (sums of ~10 Number() values
 * carry binary float dust, e.g. +0.004): formatCurrency rounded
 * it to 0.00 for display, but the bottom summary card's raw
 * `> 0` test still printed "(زيادة)" while the banner and
 * Section 1 — both tolerant — printed "(مطابق)", and the
 * `!== 0` mismatch gate disabled approve on an empty note.
 * Rounding the variance at book digits (as electronicDiff
 * already was) and testing money deltas with the canonical
 * zero test makes all three agree. Count/detail deltas stay
 * exact: they are integers, so any non-zero value is still a
 * real mismatch that demands a note.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CashDrawerReviewDialog } from './CashDrawerReviewDialog';
import type { CashierShift } from '@/types/domain';

function makeShift(overrides: Partial<CashierShift> = {}): CashierShift {
  return {
    id: 'SHIFT-261116-0001',
    docNo: 'SHIFT-261116-0001',
    status: 'pending_review',
    openingCash: 100,
    expectedCash: 100,
    countedCash: 100,
    declaredCash: 100,
    variance: 0,
    createdAt: '2026-11-16T10:00:00.000Z',
    closedAt: '2026-11-16T18:00:00.000Z',
    openedByName: 'cashier_test',
    cashSalesTotal: 0,
    cardSalesTotal: 0,
    walletSalesTotal: 0,
    instapaySalesTotal: 0,
    creditSalesTotal: 0,
    deliverySalesTotal: 0,
    serviceCashTotal: 0,
    serviceCardTotal: 0,
    cashDrawerManualCashInTotal: 0,
    cashDrawerDeliveryCashInTotal: 0,
    cashDrawerCashOutTotal: 0,
    expensesTotal: 0,
    supplierPaymentsTotal: 0,
    saleReturnCashRefundTotal: 0,
    saleReturnCardRefundTotal: 0,
    customerCollectionsTotal: 0,
    cancelledSaleCashTotal: 0,
    movementItems: [],
    ...overrides,
  };
}

function renderDialog(shift: CashierShift, managerNote = '') {
  return render(
    <CashDrawerReviewDialog
      open
      shift={shift}
      managerNote={managerNote}
      onManagerNoteChange={vi.fn()}
      onApprove={vi.fn()}
      onReject={vi.fn()}
      onClose={vi.fn()}
      isPending={false}
      isError={false}
      error={null}
    />,
  );
}

function rerenderDialog(result: ReturnType<typeof renderDialog>, shift: CashierShift, managerNote: string) {
  result.rerender(
    <CashDrawerReviewDialog
      open
      shift={shift}
      managerNote={managerNote}
      onManagerNoteChange={vi.fn()}
      onApprove={vi.fn()}
      onReject={vi.fn()}
      onClose={vi.fn()}
      isPending={false}
      isError={false}
      error={null}
    />,
  );
}

function approveButton() {
  return screen.getByRole('button', { name: 'اعتماد الإغلاق النهائي' });
}

function rejectButton() {
  return screen.getByRole('button', { name: 'رفض وإعادة فتح الوردية' });
}

describe('CashDrawerReviewDialog zero-difference handling (INV-CLOSE-REVIEW-ZERO-DIFF)', () => {
  it('shows 0.00 (مطابق) everywhere and enables approve with an empty note when the cash variance is only float dust', () => {
    // 100.10 + 200.20 sums in binary to 300.30000000000001, so the
    // declared 300.304 leaves a raw variance of +0.004000000000019 —
    // sub-minor-unit dust, not a real surplus. Before the fix the
    // bottom card printed "(زيادة)" and approve was disabled.
    const shift = makeShift({
      openingCash: 100.1,
      cashSalesTotal: 200.2,
      declaredCash: 300.304,
      countedCash: 300.304,
    });
    renderDialog(shift, '');

    expect(screen.getByText('الوردية متطابقة بالكامل مع إقرار الكاشير.')).toBeInTheDocument();
    expect(document.body.textContent).toContain('0.00 (مطابق)');
    expect(document.body.textContent).not.toContain('(زيادة)');
    expect(document.body.textContent).not.toContain('(عجز)');
    expect(approveButton()).toBeEnabled();
    expect(screen.getByText('ملاحظة المشرف للاعتماد (اختياري)')).toBeInTheDocument();
  });

  it('keeps a real +5.00 variance a surplus: approve needs a 3-char note, 2 chars still block it', () => {
    const shift = makeShift({ openingCash: 100, declaredCash: 105, countedCash: 105 });
    const result = renderDialog(shift, '');

    expect(document.body.textContent).toContain('5.00 (زيادة)');
    expect(screen.getByText('ملاحظة المشرف للاعتماد (إلزامية عند وجود فرق — 3 أحرف على الأقل)')).toBeInTheDocument();
    expect(approveButton()).toBeDisabled();
    expect(rejectButton()).toBeDisabled();

    rerenderDialog(result, shift, 'لا');
    expect(approveButton()).toBeDisabled();
    expect(rejectButton()).toBeDisabled();

    rerenderDialog(result, shift, 'فرق');
    expect(approveButton()).toBeEnabled();
    expect(rejectButton()).toBeEnabled();
  });

  it('still demands a note when the stored reconciliation has zero money deltas but a non-zero count delta', () => {
    // Money matches everywhere (cash 100 = 100, electronic 0 = 0),
    // so the banner still says matched — but the server
    // reconciliation records one card operation more than the
    // system counted, and that count delta is a real mismatch.
    const shift = makeShift({
      reconciliation: {
        card: { declared: 100, computed: 100, delta: 0, declaredCount: 2, computedCount: 1, countDelta: 1, detailTotal: 100, detailDelta: 0 },
        wallet: { declared: 0, computed: 0, delta: 0, declaredCount: 0, computedCount: 0, countDelta: 0, detailTotal: 0, detailDelta: 0 },
        instapay: { declared: 0, computed: 0, delta: 0, declaredCount: 0, computedCount: 0, countDelta: 0, detailTotal: 0, detailDelta: 0 },
      },
    });
    const result = renderDialog(shift, '');

    expect(screen.getByText('الوردية متطابقة بالكامل مع إقرار الكاشير.')).toBeInTheDocument();
    expect(approveButton()).toBeDisabled();

    rerenderDialog(result, shift, 'فرق');
    expect(approveButton()).toBeEnabled();
  });
});

describe('CashDrawerReviewDialog discount summary (INV-SHIFT-CLOSE-DISCOUNT-SUMMARY)', () => {
  it('shows the total discounts and their % of gross sales, display-only', () => {
    const shift = makeShift({
      shiftDiscountTotal: 15,
      shiftDiscountGrossTotal: 840.8,
      shiftDiscountPercent: 1.784,
    });
    renderDialog(shift, '');

    expect(document.body.textContent).toContain('إجمالي خصومات الوردية:');
    expect(document.body.textContent).toContain('15.00');
    expect(document.body.textContent).toContain('1.784%');
    expect(document.body.textContent).toContain('840.80');
  });

  it('shows 0.00 and 0% on a shift with no discounts, and blocks nothing', () => {
    const shift = makeShift({
      shiftDiscountTotal: 0,
      shiftDiscountGrossTotal: 0,
      shiftDiscountPercent: 0,
    });
    renderDialog(shift, '');

    expect(document.body.textContent).toContain('إجمالي خصومات الوردية:');
    expect(document.body.textContent).toContain('0%');
    expect(approveButton()).toBeEnabled();
  });
});
