/* T11-C (INV-REST-RETURN-RELIEF-LOUD-TRUTH): the register summary
 * stat must show the actual refund (goods + relief) across all
 * matching returns, not the goods-only server summary total. On the
 * base the workspace renders summary.totalAmount (125 for the two
 * documents below), so the 150 case fails there and passes after
 * the fix. */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnsWorkspace } from './ReturnsWorkspace';
import { createTestQueryClient } from '@/test/test-query-client';

const mockListSales = vi.fn().mockResolvedValue([]);
const mockListSalesSearch = vi.fn().mockResolvedValue([]);
const mockListPurchases = vi.fn().mockResolvedValue([]);

beforeEach(() => {
  mockListSales.mockResolvedValue([]);
  mockListSalesSearch.mockResolvedValue([]);
  mockListPurchases.mockResolvedValue([]);
});

vi.mock('@/features/returns/api/returns.api', () => ({
  returnsApi: {
    listPage: vi.fn().mockResolvedValue({
      returns: [
        { id: '1', docNo: 'ZR-261110-0001', returnType: 'sale', productName: 'Widget', qty: 1, total: 75, tipRelief: 10, courierRelief: 0, refundTotal: 85, note: '', date: '2026-11-10', settlementMode: 'refund', refundMethod: 'cash' },
        { id: '2', docNo: 'ZR-261110-0002', returnType: 'sale', productName: 'Gadget', qty: 1, total: 50, tipRelief: 5, courierRelief: 10, refundTotal: 65, note: '', date: '2026-11-10', settlementMode: 'refund', refundMethod: 'cash' },
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
      summary: { totalItems: 2, totalAmount: 125, salesReturns: 2, purchaseReturns: 0, todayCount: 0 },
    }),
    listAll: vi.fn().mockResolvedValue({
      returns: [
        { id: '1', docNo: 'ZR-261110-0001', returnType: 'sale', productName: 'Widget', qty: 1, total: 75, tipRelief: 10, courierRelief: 0, refundTotal: 85, note: '', date: '2026-11-10', settlementMode: 'refund', refundMethod: 'cash' },
        { id: '2', docNo: 'ZR-261110-0002', returnType: 'sale', productName: 'Gadget', qty: 1, total: 50, tipRelief: 5, courierRelief: 10, refundTotal: 65, note: '', date: '2026-11-10', settlementMode: 'refund', refundMethod: 'cash' },
      ],
      summary: { totalItems: 2, totalAmount: 125, salesReturns: 2, purchaseReturns: 0, todayCount: 0 },
    }),
    getInvoiceReturnedQuantities: vi.fn(),
    preview: vi.fn(),
    getReturnOperationStatus: vi.fn(),
    create: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/api/catalog', () => ({
  catalogApi: {
    listSales: (...args: unknown[]) => mockListSales(...args),
    listSalesSearch: (...args: unknown[]) => mockListSalesSearch(...args),
    listPurchases: (...args: unknown[]) => mockListPurchases(...args),
  },
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({ data: {}, isSuccess: true, isLoading: false, isError: false }),
}));

describe('ReturnsWorkspace register summary stat (T11-C)', () => {
  it('shows the actual refund total (150) instead of the goods-only summary (125)', async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <ReturnsWorkspace />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('150.00')).toBeInTheDocument();
    expect(screen.queryByText('125.00')).not.toBeInTheDocument();
  });
});

/* T12-H3 (INV-REST-RETURN-LIST-REFUND-TRUTH): the returns list
 * "المسترد" column must show the actual refund per document
 * (goods + relief), not the goods-only total. On the base the column
 * renders row.total, so the first row shows 75.00 and the second
 * 50.00; after the fix they show 85.00 and 65.00. */
describe('ReturnsWorkspace register list column (T12-H3)', () => {
  it('shows the actual refund per row (85.00 / 65.00) instead of the goods-only totals', async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <ReturnsWorkspace />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('85.00')).toBeInTheDocument();
    expect(screen.getByText('65.00')).toBeInTheDocument();
    expect(screen.queryByText('75.00')).not.toBeInTheDocument();
    expect(screen.queryByText('50.00')).not.toBeInTheDocument();
  });
});

/* P7 (INV-RETURNS-FULL-HISTORY-SEARCH): the returns dialog's
 * invoice picker loads only the latest 30 sales, so an older
 * invoice is unreachable from the dialog. Typing ≥3 characters of
 * the invoice number must fetch it from the backend search
 * (GET /api/sales?search=) and offer it as a selectable option;
 * opening with ?docNo= must resolve the deep-linked invoice with
 * its lines. On the base the picker only ever holds the latest 30
 * and the deep link never resolves, so both cases fail there and
 * pass after the fix. */
const recentSales = Array.from({ length: 30 }, (_, i) => ({
  id: String(i + 6),
  docNo: `Z-261116-${10005 + i}`,
  status: 'posted',
  total: 10,
  items: [],
}));

const oldSale = {
  id: '1',
  docNo: 'Z-261115-16455',
  status: 'posted',
  total: 100,
  customerName: 'Cash customer',
  items: [
    { id: '10', productId: '10', name: 'صنف قديم', qty: 2, price: 50, total: 100, unitName: 'piece', unitMultiplier: 1, cost: 0, priceType: 'retail' },
  ],
};

function renderWorkspace(initialEntries?: string[]) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>
        <ReturnsWorkspace />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReturnsWorkspace invoice full-history search (P7)', () => {
  it('typing "16455" fetches search=16455 and offers Z-261115-16455 even when the initial load held only the latest 30', async () => {
    mockListSales.mockResolvedValue(recentSales);
    mockListSalesSearch.mockResolvedValue([oldSale]);

    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: /مرتجع جديد/ }));
    const modalBody = await screen.findByTestId('returns-create-modal-body');
    expect(mockListSalesSearch).not.toHaveBeenCalled();

    fireEvent.change(within(modalBody).getByTestId('returns-invoice-search'), { target: { value: '16455' } });
    await waitFor(() => expect(mockListSalesSearch).toHaveBeenCalledWith('16455'), { timeout: 3000 });

    fireEvent.click(within(modalBody).getByPlaceholderText('اختر الفاتورة'));
    const option = await within(modalBody).findByText('Z-261115-16455', {}, { timeout: 3000 });
    fireEvent.click(option);
    expect(await within(modalBody).findByText('(Z-261115-16455)', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(modalBody).getByText('صنف قديم')).toBeInTheDocument();
  });

  it('opening with ?docNo=Z-261115-16455 selects that invoice with its items', async () => {
    mockListSales.mockResolvedValue(recentSales);
    mockListSalesSearch.mockResolvedValue([oldSale]);

    renderWorkspace(['/returns?docNo=Z-261115-16455']);

    await waitFor(() => expect(mockListSalesSearch).toHaveBeenCalledWith('Z-261115-16455'), { timeout: 3000 });
    const modalBody = await screen.findByTestId('returns-create-modal-body');
    expect(await within(modalBody).findByText('(Z-261115-16455)', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(modalBody).getByText('صنف قديم')).toBeInTheDocument();
  });
});
