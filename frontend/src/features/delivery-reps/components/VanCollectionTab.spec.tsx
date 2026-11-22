/*
 * New file: frontend/src/features/delivery-reps/components/VanCollectionTab.spec.tsx
 *
 * WHAT THIS PINS (INV-VAN-UNLINKED-RETURN-PICKER, part of P6): with no
 * invoice selected the return form showed NO item picker at all — the
 * picker rendered only when a sale was selected
 * (VanCollectionTab.tsx:1095), so an unlinked return could never be
 * created even though the backend accepts saleId: null and the submit
 * already sends it. A customer with no prior invoices dead-ended at
 * "لا توجد فواتير مرحلة سابقة لهذا العميل." (live trial test10k
 * 2026-11-13).
 *
 * WHAT IS DRIVEN (real tab, mocked api): render the return form with a
 * customer selected and the trip's van-stock inventory passed in.
 * - Case 1: customer with no invoices -> the unlinked picker renders
 *   the van-stock items.
 * - Case 2: adding an unlinked item fills the cart and enables submit.
 * - Case 3 (CORRECTED 2026-11-17, ci-full #74): submitting an unlinked
 *   return is REFUSED — INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK (2026-11-16)
 *   superseded the 2026-11-13 unlinked-submit expectation: the server
 *   refuses a missing saleId with 400 RETURN_REQUIRES_SALE_ID, and the
 *   form guard toasts "يرجى اختيار الفاتورة الأصلية للمرتجع" without
 *   calling submitFieldReturn. The case pins that refusal.
 * - Case 4 (CORRECTED 2026-11-17, ci-full #74): a wholesale-typed
 *   customer -> the unlinked cart line still prices at the wholesale
 *   price (same rule as the sale cart), and submitting it is refused
 *   the same way — no API call.
 * - Case 5 (no-regression): the linked flow is unchanged — picking an
 *   eligible sale renders its items and hides the unlinked picker.
 *
 * NOT DRIVEN: the backend refusal of saleId: null (pinned by
 * van-return-linkage-payment-lock.spec.ts — missing saleId is refused
 * 400 RETURN_REQUIRES_SALE_ID before any other validation); the
 * approval-time stock posting for unlinked lines (legacy plain path,
 * unchanged). NOTE: the unlinked picker + cart still render (cases 1/2)
 * even though an unlinked return can no longer be submitted under the
 * linkage lock — whether the picker should stay or go is an open
 * product question, not decided by this repair.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { VanCollectionTab } from './VanCollectionTab';
import { createTestQueryClient } from '@/test/test-query-client';
import { toast } from '@/shared/components/system-alert';

// jsdom has no Element.scrollIntoView; the shared CustomSelect calls it
// when its dropdown opens.
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

const { mockGetEligibleSales, mockSubmitReturn } = vi.hoisted(() => ({
  mockGetEligibleSales: vi.fn(),
  mockSubmitReturn: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('../api/van-sales.api', () => ({
  vanSalesApi: {
    getCustomerEligibleSales: mockGetEligibleSales,
    submitFieldReturn: mockSubmitReturn,
    // INV-VAN-SALES-MOCK-EVALUATE-PROMOTIONS: VanSaleTab calls this
    // 250ms after a non-empty cart renders; the stub matches the real
    // return shape (van-sales-fraud-promotions.ts:124).
    evaluateCartPromotions: vi.fn().mockResolvedValue({
      ok: true,
      appliedPromotions: [],
      bonusItemsToAdd: [],
      totalPromotionalDiscount: 0,
      upsellNudges: [],
    }),
  },
}));

vi.mock('../offline/van-sales-offline.db', () => ({
  vanOfflineDb: {
    recordOfflineReturn: vi.fn(),
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const retailCustomer: any = {
  id: 3060,
  name: 'محل اختبار جملة 1',
  phone: '01122220001',
  balance: 18,
  creditLimit: 5000,
  customerCode: 'C-3060',
};

const wholesaleCustomer: any = {
  id: 3061,
  name: 'محل جملة 2',
  phone: '01122220002',
  balance: 0,
  creditLimit: 5000,
  customerCode: 'C-3061',
  customer_type: 'wholesale',
};

const inventory: any[] = [
  {
    productId: 1,
    productName: 'صنف اختبار جملة أ',
    barcode: '6220000990011',
    qty: 46,
    costPrice: 8,
    retailPrice: 12,
    wholesalePrice: 10,
    unitName: 'كرتونة',
    stockUnitName: 'قطعة',
    packagingUnit: { name: 'كرتونة', multiplier: 12 },
  },
  {
    productId: 2,
    productName: 'صنف اختبار جملة ب',
    barcode: '6220000990021',
    qty: 64,
    costPrice: 15,
    retailPrice: 24,
    wholesalePrice: 20,
    unitName: 'كرتونة',
    stockUnitName: 'قطعة',
    packagingUnit: { name: 'كرتونة', multiplier: 12 },
  },
];

const cashSale: any = {
  id: 100,
  docNo: 'VAN-261113-0002',
  createdAt: '2026-11-13T10:00:00.000Z',
  total: 288,
  discount: 0,
  // INV-VAN-RETURN-REFUND-METHOD-DEFAULT (P8): the source invoice's
  // payment type — the form defaults the settlement from it.
  paymentType: 'cash',
  items: [
    {
      saleItemId: 1001,
      productId: 1,
      productName: 'صنف اختبار جملة أ',
      soldQty: 2,
      alreadyReturnedQty: 0,
      remainingReturnableQty: 2,
      unitPrice: 144,
      netUnitPrice: 144,
      unitMultiplier: 12,
      unitName: 'كرتونة',
    },
  ],
};

const creditSale: any = {
  id: 101,
  docNo: 'VAN-261113-0003',
  createdAt: '2026-11-13T10:00:00.000Z',
  total: 288,
  discount: 0,
  paymentType: 'credit',
  items: [
    {
      saleItemId: 1002,
      productId: 2,
      productName: 'صنف اختبار جملة ب',
      soldQty: 1,
      alreadyReturnedQty: 0,
      remainingReturnableQty: 1,
      unitPrice: 288,
      netUnitPrice: 288,
      unitMultiplier: 1,
      unitName: 'قطعة',
    },
  ],
};

async function pickSale(docNo: string) {
  const picker = await screen.findByPlaceholderText('اختر الفاتورة الأصلية');
  fireEvent.click(picker);
  const option = await screen.findByText((_, el) => el?.tagName === 'SPAN' && (el.textContent || '').startsWith(`فاتورة #${docNo}`));
  fireEvent.click(option);
}

function renderTab(props: { customer?: any; customers?: any[]; sales?: any[] } = {}) {
  const customer = props.customer ?? retailCustomer;
  mockGetEligibleSales.mockResolvedValue(props.sales ?? []);
  mockSubmitReturn.mockResolvedValue({
    ok: true,
    returnDocNo: 'VRET-261113-0002',
    returnId: 5,
    status: 'pending_approval',
    totalAmount: 12,
  });
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <VanCollectionTab
        tripId={6}
        customers={props.customers ?? [retailCustomer, wholesaleCustomer]}
        colCustomerId=""
        onColCustomerChange={() => {}}
        colAmount=""
        onColAmountChange={() => {}}
        onSubmitCollection={() => {}}
        isSubmitting={false}
        initialSubMode="return"
        initialReturnCustomerId={customer.id}
        inventory={inventory}
      />
    </QueryClientProvider>,
  );
}

describe('VanCollectionTab unlinked return picker (P6)', () => {
  it('case 1: customer with no invoices gets a van-stock picker', async () => {
    renderTab();
    await screen.findByText('لا توجد فواتير مرحلة سابقة لهذا العميل.');
    expect(await screen.findByText('أو إرجاع بدون فاتورة — من بضاعة السيارة:')).toBeTruthy();
    expect(screen.getByText('صنف اختبار جملة أ')).toBeTruthy();
    expect(screen.getByText('صنف اختبار جملة ب')).toBeTruthy();
    expect(screen.getAllByText('+ إضافة').length).toBeGreaterThan(0);
  });

  it('case 2: adding an unlinked item fills the cart and enables submit', async () => {
    renderTab();
    await screen.findByText('لا توجد فواتير مرحلة سابقة لهذا العميل.');
    const submitBefore = screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ });
    expect(submitBefore).toBeDisabled();
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    expect(await screen.findByText('أصناف إذن المرتجع المطلوب اعتمادها (1):')).toBeTruthy();
    const submitAfter = screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ });
    expect(submitAfter).not.toBeDisabled();
  });

  it('case 3: submitting an unlinked return is refused — no API call (INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK)', async () => {
    renderTab();
    await screen.findByText('لا توجد فواتير مرحلة سابقة لهذا العميل.');
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    fireEvent.click(screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ }));
    // The guard runs synchronously before any await: the warning fires
    // and submitFieldReturn is never reached.
    expect(toast.warning).toHaveBeenCalledWith('يرجى اختيار الفاتورة الأصلية للمرتجع');
    expect(mockSubmitReturn).not.toHaveBeenCalled();
  });

  it('case 4: a wholesale-typed customer prices the unlinked line at wholesale — and submitting it is refused', async () => {
    renderTab({ customer: wholesaleCustomer });
    await screen.findByText('لا توجد فواتير مرحلة سابقة لهذا العميل.');
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    // The cart line still carries the wholesale price (same rule as the
    // sale cart), even though the return cannot be submitted unlinked.
    expect(await screen.findByText(/سعر الإرجاع: 10\.00/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ }));
    expect(toast.warning).toHaveBeenCalledWith('يرجى اختيار الفاتورة الأصلية للمرتجع');
    expect(mockSubmitReturn).not.toHaveBeenCalled();
  });

  it('case 5: linked flow unchanged — picking a sale renders its items and hides the unlinked picker', async () => {
    renderTab({ sales: [cashSale] });
    const picker = await screen.findByPlaceholderText('اختر الفاتورة الأصلية');
    fireEvent.click(picker);
    const option = await screen.findByText((_, el) => el?.tagName === 'SPAN' && (el.textContent || '').startsWith('فاتورة #VAN-261113-0002'));
    fireEvent.click(option);
    expect(await screen.findByText(/بنود الفاتورة الأصلية #/)).toBeTruthy();
    expect(screen.getByText('صنف اختبار جملة أ')).toBeTruthy();
    expect(screen.queryByText('أو إرجاع بدون فاتورة — من بضاعة السيارة:')).toBeNull();
  });

  it('case 6 (P8): picking a cash invoice defaults the settlement to cash refund', async () => {
    renderTab({ sales: [cashSale] });
    await pickSale('VAN-261113-0002');
    expect(await screen.findByText(/بنود الفاتورة الأصلية #/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    fireEvent.click(screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ }));
    await waitFor(() => expect(mockSubmitReturn).toHaveBeenCalledTimes(1));
    const payload = mockSubmitReturn.mock.calls[0][0];
    expect(payload.saleId).toBe(100);
    expect(payload.refundMethod).toBe('cash');
  });

  it('case 7 (P8): picking a credit invoice defaults the settlement to credit', async () => {
    renderTab({ sales: [creditSale] });
    await pickSale('VAN-261113-0003');
    expect(await screen.findByText(/بنود الفاتورة الأصلية #/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    fireEvent.click(screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ }));
    await waitFor(() => expect(mockSubmitReturn).toHaveBeenCalledTimes(1));
    const payload = mockSubmitReturn.mock.calls[0][0];
    expect(payload.saleId).toBe(101);
    expect(payload.refundMethod).toBe('credit');
  });

  it('case 8 (P8): the manual override still works after the auto-default', async () => {
    renderTab({ sales: [cashSale] });
    await pickSale('VAN-261113-0002');
    expect(await screen.findByText(/بنود الفاتورة الأصلية #/)).toBeTruthy();
    // Auto-default is cash; the rep switches to credit manually.
    fireEvent.click(screen.getByText('خصم من الحساب (آجل)'));
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    fireEvent.click(screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ }));
    await waitFor(() => expect(mockSubmitReturn).toHaveBeenCalledTimes(1));
    const payload = mockSubmitReturn.mock.calls[0][0];
    expect(payload.refundMethod).toBe('credit');
  });
});
