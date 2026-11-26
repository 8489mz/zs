import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PosRecentSalesReprintModal } from './PosRecentSalesReprintModal';
import * as posPrinting from '@/lib/pos-printing';
import { salesApi } from '@/features/sales';
import type { Sale } from '@/types/domain';

const mockLastSale: Sale = {
  id: 'sale-1',
  docNo: 'Z-100',
  total: 250,
  paidAmount: 250,
  paymentType: 'cash',
  paymentChannel: 'cash',
  customerName: 'محمود حسن',
  items: [],
  payments: [],
} as unknown as Sale;

const mockRecentSales: Sale[] = [
  mockLastSale,
  {
    id: 'sale-2',
    docNo: 'Z-099',
    total: 120,
    paidAmount: 120,
    paymentType: 'cash',
    paymentChannel: 'wallet',
    customerName: 'عميل المحل المميز',
    items: [],
    payments: [],
  } as unknown as Sale,
  {
    id: 'sale-3',
    docNo: 'Z-098',
    total: 500,
    paidAmount: 300,
    paymentType: 'credit',
    paymentChannel: 'mixed',
    customerName: 'بسيسي',
    items: [],
    payments: [],
  } as unknown as Sale,
];

describe('PosRecentSalesReprintModal', () => {
  it('renders last sale banner and displays recent sales list', async () => {
    vi.spyOn(salesApi, 'listPage').mockResolvedValue({
      rows: mockRecentSales,
      pagination: {} as any,
      summary: {} as any,
    });

    render(
      <PosRecentSalesReprintModal
        isOpen={true}
        onClose={vi.fn()}
        lastSale={mockLastSale}
        onReprintLastSale={vi.fn()}
        cashierName="طاهر"
      />
    );

    expect(screen.getByText('طباعة آخر فاتورة تم إتمامها')).toBeInTheDocument();
    expect(screen.getByText(/#Z-100/)).toBeInTheDocument();
    expect(screen.getByText('محمود حسن')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('عميل المحل المميز')).toBeInTheDocument();
      expect(screen.getByText('بسيسي')).toBeInTheDocument();
    });
  });

  it('prints last sale directly when F9 is pressed', async () => {
    const printSpy = vi.spyOn(posPrinting, 'printPostedSaleReceipt').mockImplementation(vi.fn());
    vi.spyOn(salesApi, 'listPage').mockResolvedValue({
      rows: mockRecentSales,
      pagination: {} as any,
      summary: {} as any,
    });

    render(
      <PosRecentSalesReprintModal
        isOpen={true}
        onClose={vi.fn()}
        lastSale={mockLastSale}
        onReprintLastSale={vi.fn()}
        cashierName="طاهر"
      />
    );

    fireEvent.keyDown(window, { key: 'F9' });

    expect(printSpy).toHaveBeenCalledWith(
      mockLastSale,
      expect.objectContaining({
        pageSize: 'receipt',
        cashierName: 'طاهر',
        isReprint: true,
      })
    );
    printSpy.mockRestore();
  });

  it('prints a specific older sale from the list when its print button is clicked', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(posPrinting, 'printPostedSaleReceipt').mockImplementation(vi.fn());
    vi.spyOn(salesApi, 'listPage').mockResolvedValue({
      rows: mockRecentSales,
      pagination: {} as any,
      summary: {} as any,
    });

    render(
      <PosRecentSalesReprintModal
        isOpen={true}
        onClose={vi.fn()}
        lastSale={mockLastSale}
        onReprintLastSale={vi.fn()}
        cashierName="طاهر"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('عميل المحل المميز')).toBeInTheDocument();
    });

    const printButtons = screen.getAllByRole('button', { name: /طباعة ريسيت/ });
    expect(printButtons.length).toBeGreaterThanOrEqual(2);

    await user.click(printButtons[1]); // print the 2nd sale (Z-099)

    expect(printSpy).toHaveBeenCalledWith(
      expect.objectContaining({ docNo: 'Z-099' }),
      expect.objectContaining({
        pageSize: 'receipt',
        cashierName: 'طاهر',
        isReprint: true,
      })
    );
    printSpy.mockRestore();
  });
});
