/* IMEI history page header (LF-P4, mobiles/maintenance live-fix batch):
 * live-proven 2026-11-08 on test10k — the header showed no branch /
 * warehouse, no price and warranty always "—" for both test devices,
 * and labelled a maintenance-only customer device "متاح بالسجل العام"
 * although it has no serial row at all (it is not stock).
 *
 * What this pins, rendering the REAL page with mocked API clients:
 * - Registered trade-in serial (NULL branch/location, retail price on
 *   the lookup item): the price renders, the location reads as honestly
 *   "not recorded", and the warranty comes from the device's latest
 *   repair ticket (real data, same device) — never "متاح بالسجل العام".
 * - Maintenance-only serial (lookup null, ticket exists): the page
 *   says the device is NOT in the serial register, the location never
 *   reads as available stock, the price reads as "no price recorded",
 *   and the ticket warranty still shows.
 * - Unknown serial (lookup null, no tickets, no trade-ins): the honest
 *   "no data recorded" state, never an availability claim.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { ImeiHistoryPage } from './ImeiHistoryPage';

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  useLocation: vi.fn().mockReturnValue({ pathname: '/products/imei-history' }),
}));

const mockLookup = vi.fn();
const mockMaintenanceList = vi.fn();
const mockTradeInList = vi.fn();

vi.mock('@/features/products/api/product-serials.api', () => ({
  productSerialsApi: {
    lookup: (...args: Parameters<typeof mockLookup>) => mockLookup(...args),
  },
}));

vi.mock('@/features/maintenance/api/maintenance.api', () => ({
  maintenanceApi: {
    list: (...args: Parameters<typeof mockMaintenanceList>) => mockMaintenanceList(...args),
  },
}));

vi.mock('@/features/tradein/api/tradein.api', () => ({
  tradeInApi: {
    list: (...args: Parameters<typeof mockTradeInList>) => mockTradeInList(...args),
  },
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({ data: { maintenanceProfile: 'mobile' } }),
}));

const emptyPage = { tickets: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } };
const emptyTradeins = { transactions: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } };

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    ticketNo: 'ZM-261108-0002',
    customerName: 'Test Customer',
    customerPhone: '01000000000',
    deviceBrand: '',
    deviceModel: 'Phone',
    serialNumber: '869123456789011',
    problemDescription: 'Screen broken',
    expectedCost: 300,
    finalCost: 300,
    advancePayment: 100,
    status: 'delivered',
    warrantyDays: 30,
    receivedAt: '2026-11-08T10:00:00.000Z',
    repairedAt: '2026-11-08T11:00:00.000Z',
    deliveredAt: '2026-11-08T12:00:00.000Z',
    createdAt: '2026-11-08T10:00:00.000Z',
    warrantyEnd: '2099-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ImeiHistoryPage />
    </QueryClientProvider>,
  );
}

async function search(serial: string) {
  fireEvent.change(screen.getByPlaceholderText(/امسح الباركود/), { target: { value: serial } });
  fireEvent.click(screen.getByRole('button', { name: /فحص واستعلام/ }));
}

describe('ImeiHistoryPage header (LF-P4)', () => {
  it('registered trade-in serial: shows the retail price, honest not-recorded location, ticket warranty', async () => {
    mockLookup.mockResolvedValue({
      id: '1',
      productId: '1',
      productName: 'Used Phone (مستعمل)',
      productBarcode: 'DEV-6789022-1',
      productRetailPrice: 150,
      productWholesalePrice: 120,
      serialNumber: '869123456789022',
      status: 'in_stock',
      branchId: null,
      branchName: '',
      locationId: null,
      locationName: '',
      costPrice: 10,
      warrantyEndDate: null,
    });
    mockMaintenanceList.mockResolvedValue({ ...emptyPage, tickets: [ticket({ serialNumber: '869123456789022' })] });
    mockTradeInList.mockResolvedValue({
      ...emptyTradeins,
      transactions: [
        {
          id: '1',
          docNo: 'TRD-261108-0001',
          sellerName: 'Seller',
          sellerNationalId: '29901011234567',
          deviceBrand: '',
          deviceModel: 'Phone',
          agreedPurchasePrice: 10,
          createdAt: '2026-11-08T10:00:00.000Z',
        },
      ],
    });
    renderPage();
    await search('869123456789022');

    expect(await screen.findByText(/150\.00/)).toBeTruthy();
    expect(await screen.findByText('لم يُسجَّل الموقع / الفرع')).toBeTruthy();
    expect(await screen.findByText(/ساري حتى:/)).toBeTruthy();
    expect(await screen.findByText('ضمان الصيانة (آخر إصلاح)')).toBeTruthy();
    expect(screen.queryByText('متاح بالسجل العام')).toBeNull();
    expect(screen.queryByText('غير مسجَّل في سجل السيريالات')).toBeNull();
  });

  it('maintenance-only serial: never labelled as available stock, ticket warranty still shows', async () => {
    mockLookup.mockResolvedValue(null);
    mockMaintenanceList.mockResolvedValue({ ...emptyPage, tickets: [ticket()] });
    mockTradeInList.mockResolvedValue(emptyTradeins);
    renderPage();
    await search('869123456789011');

    expect(await screen.findByText('هذا الجهاز غير مسجَّل في سجل السيريالات')).toBeTruthy();
    expect(await screen.findByText(/جهاز عميل له سجل صيانة/)).toBeTruthy();
    expect(await screen.findByText('غير مسجَّل في سجل السيريالات')).toBeTruthy();
    expect(await screen.findByText('لا يوجد سعر مسجَّل')).toBeTruthy();
    expect(await screen.findByText(/ساري حتى:/)).toBeTruthy();
    expect(screen.queryByText('متاح بالسجل العام')).toBeNull();
  });

  it('unknown serial: honest no-data state, never an availability claim', async () => {
    mockLookup.mockResolvedValue(null);
    mockMaintenanceList.mockResolvedValue(emptyPage);
    mockTradeInList.mockResolvedValue(emptyTradeins);
    renderPage();
    await search('000000000000000');

    expect(await screen.findByText('هذا الجهاز غير مسجَّل في سجل السيريالات')).toBeTruthy();
    expect(await screen.findByText(/لا توجد بيانات مسجَّلة عن هذا السيريال/)).toBeTruthy();
    expect(await screen.findByText('لا يوجد سعر مسجَّل')).toBeTruthy();
    expect(await screen.findByText('لا يوجد ضمان مسجَّل')).toBeTruthy();
    expect(screen.queryByText('متاح بالسجل العام')).toBeNull();
  });
});
