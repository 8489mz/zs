/*
 * ledger-panel-supplier-payment.spec.tsx — INV-STATEMENT-PAYMENT-DETAILS.
 *
 * THE BUG (proven live on test10k): in a supplier statement the details
 * button on a supplier PAYMENT row failed with 'تعذر تحميل تفاصيل الفاتورة /
 * فاتورة الشراء غير موجودة.' A payment row has reference_type
 * 'supplier_payment', so inferDocumentType fell through to the entry_type
 * check ('supplier_payment'.includes('supplier') -> 'purchase') and the
 * payment id was fed to purchaseById (/api/purchases/<paymentId>).
 *
 * WORSE THAN THE ERROR: had a purchase invoice id ever equalled a payment
 * id, the button would have shown the WRONG invoice instead of failing.
 *
 * WHAT THIS PINS, driving the REAL LedgerPanel / documentDetailsApi /
 * AccountsInvoiceDetailCard:
 * - a supplier payment row is classified 'supplier_payment', never
 *   'purchase' -- even when its id equals an existing purchase id, and
 *   even when only entry_type carries 'supplier_payment';
 * - clicking its details button calls /api/supplier-payments/<paymentId>
 *   and NEVER /api/purchases/<paymentId>, and the card shows the
 *   payment itself: ZPV number, JE number, amount, supplier, date, note,
 *   channel and the IPA address for InstaPay;
 * - a purchase-invoice row is still classified 'purchase' and its button
 *   still calls /api/purchases/<invoiceId> and shows the invoice.
 */
import '@/lib/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { LedgerPanel, getDocumentReference, inferDocumentType } from './LedgerPanel';
import { documentDetailsApi } from '@/shared/api/document-details';
import type { Supplier, SupplierLedgerEntry } from '@/types/domain';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

const PAYMENT_ROW = {
  id: '1',
  entry_type: 'supplier_payment',
  reference_type: 'supplier_payment',
  reference_id: '7',
  note: 'دفع إلى مورد اختبار',
  debit: 120,
  credit: 0,
  balance_after: 880,
  created_at: '2026-11-05T10:00:00.000Z',
} as unknown as SupplierLedgerEntry;

const COLLIDING_PAYMENT_ROW = {
  ...PAYMENT_ROW,
  id: '2',
  reference_id: '1286',
} as unknown as SupplierLedgerEntry;

const PURCHASE_ROW = {
  id: '3',
  entry_type: 'purchase_credit',
  reference_type: 'purchase',
  reference_id: '1286',
  note: 'فاتورة شراء PUR-1286',
  debit: 0,
  credit: 500,
  balance_after: 1000,
  created_at: '2026-11-04T10:00:00.000Z',
} as unknown as SupplierLedgerEntry;

const PAYMENT_PAYLOAD = {
  supplierPayment: {
    id: '7',
    docNo: 'ZPV-261107-000002',
    supplierId: '3',
    supplierName: 'مورد اختبار',
    amount: 120,
    note: 'دفعة اختبار',
    date: '2026-11-05',
    paymentChannel: 'instapay',
    instapayAddress: 'test@instapay',
    branchName: 'الفرع الرئيسي',
    locationName: 'المخزن الرئيسي',
    createdBy: 'admin',
    journalEntryId: '15002',
    journalNo: 'JE-00015002',
  },
};

const PURCHASE_PAYLOAD = {
  purchase: {
    id: '1286',
    docNo: 'PUR-1286',
    supplierId: '3',
    supplierName: 'مورد اختبار',
    paymentType: 'credit',
    subTotal: 500,
    total: 500,
    status: 'posted',
    date: '2026-11-04',
    branchName: 'الفرع الرئيسي',
    locationName: 'المخزن الرئيسي',
    items: [{ id: '1', productId: '10', name: 'صنف اختبار', qty: 1, cost: 500, total: 500, unitName: 'قطعة', unitMultiplier: 1 }],
  },
};

function renderPanel(entries: SupplierLedgerEntry[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const supplier = { id: 3, name: 'مورد اختبار' } as unknown as Supplier;
  render(
    <QueryClientProvider client={queryClient}>
      <LedgerPanel
        title="كشف حساب مورد"
        value="3"
        onChange={() => {}}
        options={[supplier]}
        emptyLabel="اختر المورد"
        entries={entries}
        search=""
        onSearchChange={() => {}}
        pagination={{ page: 1, pageSize: 10, totalItems: entries.length, totalPages: 1 }}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        summary={{ totalItems: entries.length, debitTotal: 120, creditTotal: 500, net: 380, lastBalance: 880 }}
      />
    </QueryClientProvider>,
  );
}

describe('supplier statement payment details (INV-STATEMENT-PAYMENT-DETAILS)', () => {
  it('classifies a supplier payment row as supplier_payment, never purchase', () => {
    expect(inferDocumentType(PAYMENT_ROW)).toBe('supplier_payment');
    const document = getDocumentReference(PAYMENT_ROW);
    expect(document?.type).toBe('supplier_payment');
    expect(document?.referenceId).toBe('7');
    expect(document?.key).toBe('supplier_payment-7');
  });

  it('never classifies a payment as purchase even when its id equals a purchase id', () => {
    expect(inferDocumentType(COLLIDING_PAYMENT_ROW)).toBe('supplier_payment');
    const document = getDocumentReference(COLLIDING_PAYMENT_ROW);
    expect(document?.type).toBe('supplier_payment');
    expect(document?.key).toBe('supplier_payment-1286');
    expect(document?.key).not.toBe('purchase-1286');
  });

  it('classifies a payment from entry_type alone when reference_type is missing', () => {
    const row = { ...PAYMENT_ROW, reference_type: '' } as unknown as SupplierLedgerEntry;
    expect(inferDocumentType(row)).toBe('supplier_payment');
    expect(getDocumentReference(row)?.type).toBe('supplier_payment');
  });

  it('still classifies a purchase-invoice row as purchase with its invoice id', () => {
    expect(inferDocumentType(PURCHASE_ROW)).toBe('purchase');
    const document = getDocumentReference(PURCHASE_ROW);
    expect(document?.type).toBe('purchase');
    expect(document?.referenceId).toBe('1286');
    expect(document?.key).toBe('purchase-1286');
  });

  it('routes a payment details click to the single-payment read, never to purchaseById', async () => {
    httpMock.mockResolvedValueOnce(PAYMENT_PAYLOAD);
    renderPanel([PAYMENT_ROW]);

    fireEvent.click(await screen.findByRole('button', { name: 'عرض التفاصيل' }));

    await screen.findByText('ZPV-261107-000002');
    expect(await screen.findByText('JE-00015002')).toBeTruthy();
    expect(screen.getByText('test@instapay')).toBeTruthy();
    expect(screen.getByText(/دفعة اختبار/)).toBeTruthy();
    await waitFor(() => expect(httpMock).toHaveBeenCalledWith('/api/supplier-payments/7'));
    expect(httpMock.mock.calls.map((call) => String(call[0]))).not.toContain('/api/purchases/7');
  });

  it('routes a purchase-invoice details click to purchaseById with the invoice id', async () => {
    httpMock.mockResolvedValueOnce(PURCHASE_PAYLOAD);
    renderPanel([PURCHASE_ROW]);

    fireEvent.click(await screen.findByRole('button', { name: 'عرض التفاصيل' }));

    await screen.findByText('تفاصيل PUR-1286');
    await waitFor(() => expect(httpMock).toHaveBeenCalledWith('/api/purchases/1286'));
    expect(httpMock.mock.calls.map((call) => String(call[0]))).not.toContain('/api/supplier-payments/1286');
  });

  it('supplierPaymentById unwraps the payment payload without touching the purchase endpoint', async () => {
    httpMock.mockResolvedValueOnce(PAYMENT_PAYLOAD);
    const payment = await documentDetailsApi.supplierPaymentById('7');
    expect(httpMock).toHaveBeenCalledWith('/api/supplier-payments/7');
    expect(payment.docNo).toBe('ZPV-261107-000002');
    expect(payment.journalNo).toBe('JE-00015002');
    expect(payment.paymentChannel).toBe('instapay');
    expect(payment.instapayAddress).toBe('test@instapay');
  });
});
