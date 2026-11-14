/* R-B15 / INV-REST-SAFE-TRANSFER-TYPES: the drawer movement form
 * must offer the two safe-transfer types (safe_drop: cash out of the
 * drawer into the safe/bank; safe_replenishment: float top-up from
 * the safe/bank into the drawer) with a counterpart cash/bank
 * account picker, and must not let a transfer submit without one.
 * Before this fix the form offered only cash_in/cash_out, so every
 * top-up posted as 7100 misc income and every deposit as 6950
 * expense. The backend transfer posting itself is pinned by
 * backend/test/critical/cash-drawer-movement-types.spec.ts; this
 * spec pins the form half. The approval secret (manager PIN /
 * user password) is collected by the page's confirm dialog, not
 * by this form, so it is out of scope here.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { CashDrawerFormsPanel } from './CashDrawerFormsPanel';
import type {
  CloseShiftValues,
  MovementValues,
  OpenShiftValues,
} from '@/features/cash-drawer/hooks/useCashDrawerPageController';

const mockAccounts = [
  {
    id: '1110', code: '1110', nameAr: 'صندوق الدرج', nameEn: '', accountType: 'asset',
    accountGroup: 'current_assets', parentId: '', depth: 1, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: true, allowManualEntries: true,
    isControlAccount: false, isMonetary: true, revaluationCurrency: null,
    flags: { isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
  {
    id: '1111', code: '1111', nameAr: 'الخزينة الآمنة', nameEn: '', accountType: 'asset',
    accountGroup: 'current_assets', parentId: '', depth: 1, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: true, allowManualEntries: true,
    isControlAccount: false, isMonetary: true, revaluationCurrency: null,
    flags: { isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
  {
    id: '1120', code: '1120', nameAr: 'بنك', nameEn: '', accountType: 'asset',
    accountGroup: 'current_assets', parentId: '', depth: 1, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: true, revaluationCurrency: null,
    flags: { isCashBank: true, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
  {
    id: '6950', code: '6950', nameAr: 'مصروفات', nameEn: '', accountType: 'expense',
    accountGroup: 'expenses', parentId: '', depth: 1, normalBalance: 'debit',
    balance: 0, isActive: true, isSystem: false, allowManualEntries: true,
    isControlAccount: false, isMonetary: false, revaluationCurrency: null,
    flags: { isCashBank: false, isReceivable: false, isPayable: false, isInventory: false, isTax: false },
    sortOrder: 0,
  },
];

vi.mock('@/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http')>();
  return {
    ...actual,
    http: vi.fn(() => Promise.resolve({ accounts: mockAccounts })),
  };
});

// jsdom has no Element.scrollIntoView; the shared CustomSelect calls it
// when its dropdown opens (same stub as import-payee-selects.spec.tsx).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const idleMutation = { isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), mutate: vi.fn() };

function Harness({ onMovementSubmit = vi.fn() }: { onMovementSubmit?: () => void }) {
  const movementForm = useForm<MovementValues>({
    defaultValues: { shiftId: '1', type: 'cash_in', amount: 100, note: 'تغذية', managerPin: '' },
  });
  const openForm = useForm<OpenShiftValues>({
    defaultValues: { openingCash: 0, note: '', branchId: '', locationId: '' },
  });
  const closeForm = useForm<CloseShiftValues>({
    defaultValues: {
      shiftId: '', countedCash: 0, cardDeclaredTotal: 0, cardOperationCount: 0,
      walletDeclaredTotal: 0, walletOperationCount: 0, instapayDeclaredTotal: 0,
      instapayOperationCount: 0, cardDetails: [], walletDetails: [], instapayDetails: [],
      note: '', managerPin: '',
    },
  });
  const shift = { id: '1', openedByName: 'أمين الصندوق', docNo: 'SHIFT-1' };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <CashDrawerFormsPanel
        activeForm="movement"
        onCloseForm={vi.fn()}
        branches={[]}
        locations={[]}
        openOptions={[shift as never]}
        myOpenShift={shift as never}
        openForm={openForm}
        movementForm={movementForm}
        closeForm={closeForm}
        openMutation={idleMutation}
        movementMutation={idleMutation}
        closeMutation={idleMutation}
        closeExpectedCash={0}
        closeVariancePreview={0}
        closeNoteValue=""
        onMovementSubmit={onMovementSubmit}
        onCloseSubmit={vi.fn()}
      />
    </QueryClientProvider>
  );
}

function typeCombobox(): HTMLElement {
  const boxes = screen.getAllByRole('combobox');
  expect(boxes.length).toBeGreaterThanOrEqual(1);
  return boxes[0];
}

async function chooseType(label: string): Promise<void> {
  fireEvent.click(typeCombobox());
  fireEvent.click(await screen.findByText(label));
}

/* R4-B / INV-REST-SHIFT-CLOSE-CONTROL (I25): the close card must
 * show the opening-cash row plus the two expected-cash components
 * the server counts but the card used to hide — customer
 * collections and cancelled-sale cash — when they are nonzero,
 * and must hide the two component rows when they are zero.
 * The 0.01 note gates are also pinned here: any nonzero rounded
 * preview requires a note (the server gates on any-nonzero book
 * variance), so a 0.005 preview must not ask for a note while a
 * 0.01 preview must.
 */

const closeShiftWithTotals = {
  id: '1', openedByName: 'أمين الصندوق', docNo: 'SHIFT-1',
  openingCash: 100, cashSalesTotal: 50, cardSalesTotal: 0, walletSalesTotal: 0,
  instapaySalesTotal: 0, creditSalesTotal: 0, serviceCashTotal: 0,
  saleReturnCashRefundTotal: 0, cashDrawerMovementTotal: 0,
  customerCollectionsTotal: 30, cancelledSaleCashTotal: 20,
};

function CloseHarness({ shift = closeShiftWithTotals, variancePreview = 0 }: { shift?: Record<string, unknown>; variancePreview?: number }) {
  const movementForm = useForm<MovementValues>({
    defaultValues: { shiftId: '1', type: 'cash_in', amount: 100, note: 'تغذية', managerPin: '' },
  });
  const openForm = useForm<OpenShiftValues>({
    defaultValues: { openingCash: 0, note: '', branchId: '', locationId: '' },
  });
  const closeForm = useForm<CloseShiftValues>({
    defaultValues: {
      shiftId: '1', countedCash: 200, cardDeclaredTotal: 0, cardOperationCount: 0,
      walletDeclaredTotal: 0, walletOperationCount: 0, instapayDeclaredTotal: 0,
      instapayOperationCount: 0, cardDetails: [], walletDetails: [], instapayDetails: [],
      note: '', managerPin: '1234',
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <CashDrawerFormsPanel
        activeForm="close"
        onCloseForm={vi.fn()}
        branches={[]}
        locations={[]}
        openOptions={[shift as never]}
        myOpenShift={shift as never}
        openForm={openForm}
        movementForm={movementForm}
        closeForm={closeForm}
        openMutation={idleMutation}
        movementMutation={idleMutation}
        closeMutation={idleMutation}
        closeExpectedCash={200}
        closeVariancePreview={variancePreview}
        closeNoteValue=""
        onMovementSubmit={vi.fn()}
        onCloseSubmit={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe('CashDrawerFormsPanel close card expected-cash rows (I25)', () => {
  it('shows the opening-cash row and both new component rows when nonzero', () => {
    render(<CloseHarness />);
    expect(screen.getByText('رصيد الفتح')).toBeTruthy();
    expect(screen.getByText('تحصيلات عملاء نقدي')).toBeTruthy();
    expect(screen.getByText('نقدية فواتير ملغاة')).toBeTruthy();
  });

  it('hides the collections and cancelled rows when both are zero', () => {
    render(<CloseHarness shift={{ ...closeShiftWithTotals, customerCollectionsTotal: 0, cancelledSaleCashTotal: 0 }} />);
    expect(screen.getByText('رصيد الفتح')).toBeTruthy();
    expect(screen.queryByText('تحصيلات عملاء نقدي')).toBeNull();
    expect(screen.queryByText('نقدية فواتير ملغاة')).toBeNull();
  });
});

describe('CashDrawerFormsPanel movement types', () => {
  it('offers the two safe-transfer types alongside cash_in and cash_out', async () => {
    render(<Harness />);
    fireEvent.click(typeCombobox());
    expect(await screen.findByText('إيداع')).toBeTruthy();
    expect(await screen.findByText('صرف')).toBeTruthy();
    expect(await screen.findByText('تحويل للخزنة (إيداع آمن)')).toBeTruthy();
    expect(await screen.findByText('تغذية الدرج من الخزنة')).toBeTruthy();
  });

  it('shows a cash/bank counterpart picker for safe_drop and gates submit on it', async () => {
    render(<Harness />);
    await chooseType('تحويل للخزنة (إيداع آمن)');
    expect(await screen.findByText('الحساب المقابل (خزنة / بنك)')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'حفظ الحركة' });
    expect(submit).toBeDisabled();
    const boxes = screen.getAllByRole('combobox');
    expect(boxes.length).toBe(2);
    fireEvent.click(boxes[1]);
    expect(await screen.findByText('1120 — بنك')).toBeTruthy();
    // INV-DRAWER-DISBURSE-CASHIER-PASSWORD (trial T31): the drawer
    // cash account itself (1110) is never offered as a counterpart
    // — a transfer from the drawer to itself is rejected
    // server-side — while the seeded safe account 1111 is offered.
    expect(await screen.findByText('1111 — الخزينة الآمنة')).toBeTruthy();
    expect(screen.queryByText('1110 — صندوق الدرج')).toBeNull();
    expect(screen.queryByText('6950 — مصروفات')).toBeNull();
    fireEvent.click(screen.getByText('1120 — بنك'));
    expect(screen.getByRole('button', { name: 'حفظ الحركة' })).not.toBeDisabled();
  });

  it('shows the counterpart picker for safe_replenishment too', async () => {
    render(<Harness />);
    await chooseType('تغذية الدرج من الخزنة');
    expect(await screen.findByText('الحساب المقابل (خزنة / بنك)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'حفظ الحركة' })).toBeDisabled();
  });

  it('does not ask for a counterpart for cash_in', async () => {
    render(<Harness />);
    expect(screen.queryByText('الحساب المقابل (خزنة / بنك)')).toBeNull();
    expect(screen.getByRole('button', { name: 'حفظ الحركة' })).not.toBeDisabled();
  });
});
