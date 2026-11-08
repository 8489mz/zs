/*
 * ledger-panel-return-details.spec.tsx — INV-STATEMENT-RETURN-ROW-DETAILS.
 *
 * THE BUG (proven live on test10k): in a supplier statement the details
 * button on a purchase-RETURN row failed with 'فاتورة الشراء غير موجودة.'
 * A return row has reference_type 'return_document' and entry_type
 * 'purchase_return', so inferDocumentType fell through to the entry_type
 * check ('purchase_return'.includes('purchase') -> 'purchase') and the
 * return id was fed to purchaseById (/api/purchases/<returnId>). The same
 * loader bug hit sale-return rows in the customer statement
 * ('sale_return'.includes('sale') -> 'sale', fed to saleById).
 *
 * WORSE THAN THE ERROR: had a purchase invoice id ever equalled a return
 * id, the button would have shown the WRONG invoice instead of failing.
 *
 * WHAT THIS PINS, driving the REAL LedgerPanel / documentDetailsApi /
 * AccountsInvoiceDetailCard:
 * - a purchase-return row is classified 'purchase_return', never
 *   'purchase' -- even when its id equals an existing purchase id, and
 *   even when only entry_type carries 'purchase_return';
 * - a sale-return row is classified 'sale_return', never 'sale';
 * - a return row without a reference_id yields NO document at all -- the
 *   return id is never derivable from the ZPR/ZR doc number, so no
 *   guessed id is ever fed to the return read;
 * - clicking a return row's details button calls /api/returns/<returnId>
 *   and NEVER /api/purchases/<returnId>, and the card shows the return
 *   itself: ZPR number, JE number, party, original invoice, items and
 *   total;
 * - a purchase-invoice row is still classified 'purchase' and its button
 *   still calls /api/purchases/<invoiceId> and shows the invoice.
 */
import '@/lib/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { LedgerPanel, getDocumentReference, inferDocumentType } from './LedgerPanel';
import { documentDetailsApi } from '@/shared/api/document-details';
import type { Customer, CustomerLedgerEntry, Supplier, SupplierLedgerEntry } from '@/types/domain';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

const PURCHASE_RETURN_ROW = {
  id: '1',
  entry_type: 'purchase_return',
  reference_type: 'return_document',
  reference_id: '42',
  note: 'purchase return ZPR-261105-0592',
  debit: 0,
  credit: 100,
  balance_after: 880,
  created_at: '2026-11-05T10:00:00.000Z',
} as unknown as SupplierLedgerEntry;

const COLLIDING_RETURN_ROW = {
  ...PURCHASE_RETURN_ROW,
  id: '2',
  reference_id: '1286',
} as unknown as SupplierLedgerEntry;

const SALE_RETURN_ROW = {
  id: '3',
  entry_type: 'sale_return',
  reference_type: 'return_document',
  reference_id: '43',
  note: 'sale return ZR-261105-0591',
  debit: 150,
  credit: 0,
  balance_after: 150,
  created_at: '2026-11-05T11:00:00.000Z',
} as unknown as CustomerLedgerEntry;

const PURCHASE_ROW = {
  id: '4',
  entry_type: 'purchase_credit',
  reference_type: 'purchase',
  reference_id: '1286',
  note: 'فاتورة شراء PUR-1286',
  debit: 0,
  credit: 500,
  balance_after: 1000,
  created_at: '2026-11-04T10:00:00.000Z',
} as unknown as SupplierLedgerEntry;

const RETURN_PAYLOAD = {
  returnDocument: {
    id: '42',
    docNo: 'ZPR-261105-0592',
    returnType: 'purchase',
    invoiceId: '1286',
    invoiceDocNo: 'PUR-1286',
    partyName: 'مورد اختبار',
    total: 100,
    note: 'مرتجع مشتريات اختبار',
    settlementMode: 'payable',
    refundMethod: 'cash',
    date: '2026-11-05',
    branchName: 'الفرع الرئيسي',
    locationName: 'المخزن الرئيسي',
    createdBy: 'admin',
    journalEntryId: '15001',
    journalNo: 'JE-00014983',
    items: [{ id: '1', productId: '10', productName: 'صنف اختبار', qty: 2, unitTotal: 50, lineTotal: 100, allocatedTax: 0 }],
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
        summary={{ totalItems: entries.length, debitTotal: 0, creditTotal: 600, net: 600, lastBalance: 880 }}
      />
    </QueryClientProvider>,
  );
}

describe('supplier statement return details (INV-STATEMENT-RETURN-ROW-DETAILS)', () => {
  it('classifies a purchase-return row as purchase_return, never purchase', () => {
    expect(inferDocumentType(PURCHASE_RETURN_ROW)).toBe('purchase_return');
    const document = getDocumentReference(PURCHASE_RETURN_ROW);
    expect(document?.type).toBe('purchase_return');
    expect(document?.referenceId).toBe('42');
    expect(document?.key).toBe('purchase_return-42');
  });

  it('never classifies a return as purchase even when its id equals a purchase id', () => {
    expect(inferDocumentType(COLLIDING_RETURN_ROW)).toBe('purchase_return');
    const document = getDocumentReference(COLLIDING_RETURN_ROW);
    expect(document?.type).toBe('purchase_return');
    expect(document?.key).toBe('purchase_return-1286');
    expect(document?.key).not.toBe('purchase-1286');
  });

  it('classifies a return from entry_type alone when reference_type is missing', () => {
    const row = { ...PURCHASE_RETURN_ROW, reference_type: '' } as unknown as SupplierLedgerEntry;
    expect(inferDocumentType(row)).toBe('purchase_return');
    expect(getDocumentReference(row)?.type).toBe('purchase_return');
  });

  it('classifies a sale-return row as sale_return, never sale', () => {
    expect(inferDocumentType(SALE_RETURN_ROW)).toBe('sale_return');
    const document = getDocumentReference(SALE_RETURN_ROW);
    expect(document?.type).toBe('sale_return');
    expect(document?.referenceId).toBe('43');
    expect(document?.key).toBe('sale_return-43');
    expect(document?.key).not.toBe('sale-43');
  });

  it('yields no document for a return row without a reference_id', () => {
    const row = { ...PURCHASE_RETURN_ROW, reference_id: '' } as unknown as SupplierLedgerEntry;
    expect(getDocumentReference(row)).toBeNull();
  });

  it('still classifies a purchase-invoice row as purchase with its invoice id', () => {
    expect(inferDocumentType(PURCHASE_ROW)).toBe('purchase');
    const document = getDocumentReference(PURCHASE_ROW);
    expect(document?.type).toBe('purchase');
    expect(document?.referenceId).toBe('1286');
    expect(document?.key).toBe('purchase-1286');
  });

  it('routes a return details click to the single-return read, never to purchaseById', async () => {
    httpMock.mockResolvedValueOnce(RETURN_PAYLOAD);
    renderPanel([PURCHASE_RETURN_ROW]);

    fireEvent.click(await screen.findByRole('button', { name: 'عرض التفاصيل' }));

    await screen.findByText('ZPR-261105-0592');
    expect(await screen.findByText('JE-00014983')).toBeTruthy();
    expect(screen.getByText('صنف اختبار')).toBeTruthy();
    expect(screen.getByText(/مرتجع مشتريات اختبار/)).toBeTruthy();
    await waitFor(() => expect(httpMock).toHaveBeenCalledWith('/api/returns/42'));
    expect(httpMock.mock.calls.map((call) => String(call[0]))).not.toContain('/api/purchases/42');
  });

  it('routes a purchase-invoice details click to purchaseById with the invoice id', async () => {
    httpMock.mockResolvedValueOnce(PURCHASE_PAYLOAD);
    renderPanel([PURCHASE_ROW]);

    fireEvent.click(await screen.findByRole('button', { name: 'عرض التفاصيل' }));

    await screen.findByText('تفاصيل PUR-1286');
    await waitFor(() => expect(httpMock).toHaveBeenCalledWith('/api/purchases/1286'));
    expect(httpMock.mock.calls.map((call) => String(call[0]))).not.toContain('/api/returns/1286');
  });

  it('returnById unwraps the return payload without touching the purchase endpoint', async () => {
    httpMock.mockResolvedValueOnce(RETURN_PAYLOAD);
    const doc = await documentDetailsApi.returnById('42');
    expect(httpMock).toHaveBeenCalledWith('/api/returns/42');
    expect(doc.docNo).toBe('ZPR-261105-0592');
    expect(doc.journalNo).toBe('JE-00014983');
    expect(doc.partyName).toBe('مورد اختبار');
    expect(doc.items[0].productName).toBe('صنف اختبار');
  });
});
