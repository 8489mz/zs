/* T11-C (INV-REST-RETURN-RELIEF-LOUD-TRUTH): the register summary
 * stat must show the actual refund (goods + relief) across all
 * matching returns, not the goods-only server summary total. On the
 * base the workspace renders summary.totalAmount (125 for the two
 * documents below), so the 150 case fails there and passes after
 * the fix. */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReturnsWorkspace } from './ReturnsWorkspace';
import { createTestQueryClient } from '@/test/test-query-client';

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
    listSales: vi.fn().mockResolvedValue([]),
    listPurchases: vi.fn().mockResolvedValue([]),
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
