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
 * - Case 3: submitting an unlinked return calls submitFieldReturn
 *   with saleId: null and the picked item at the retail price.
 * - Case 4: a wholesale-typed customer -> the unlinked line prices at
 *   the wholesale price (same rule as the sale cart).
 * - Case 5 (no-regression): the linked flow is unchanged — picking an
 *   eligible sale renders its items and hides the unlinked picker.
 *
 * NOT DRIVEN: the backend acceptance of saleId: null (proven by the
 * submit path + the P13 approval specs); the approval-time stock
 * posting for unlinked lines (legacy plain path, unchanged).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { VanCollectionTab } from './VanCollectionTab';
import { createTestQueryClient } from '@/test/test-query-client';

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

  it('case 3: submitting an unlinked return sends saleId null at the retail price', async () => {
    renderTab();
    await screen.findByText('لا توجد فواتير مرحلة سابقة لهذا العميل.');
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    fireEvent.click(screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ }));
    await waitFor(() => expect(mockSubmitReturn).toHaveBeenCalledTimes(1));
    const payload = mockSubmitReturn.mock.calls[0][0];
    expect(payload.tripId).toBe(6);
    expect(payload.customerId).toBe(3060);
    expect(payload.saleId).toBeNull();
    expect(payload.refundMethod).toBe('credit');
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].productId).toBe(1);
    expect(payload.items[0].qty).toBe(1);
    expect(payload.items[0].unitPrice).toBe(12);
    expect(payload.items[0].saleItemId).toBeUndefined();
    expect(payload.items[0].unitMultiplier).toBe(1);
  });

  it('case 4: a wholesale-typed customer prices the unlinked line at wholesale', async () => {
    renderTab({ customer: wholesaleCustomer });
    await screen.findByText('لا توجد فواتير مرحلة سابقة لهذا العميل.');
    fireEvent.click(screen.getAllByText('+ إضافة')[0]);
    fireEvent.click(screen.getByRole('button', { name: /إرسال إذن المرتجع للإدارة/ }));
    await waitFor(() => expect(mockSubmitReturn).toHaveBeenCalledTimes(1));
    const payload = mockSubmitReturn.mock.calls[0][0];
    expect(payload.customerId).toBe(3061);
    expect(payload.items[0].unitPrice).toBe(10);
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
