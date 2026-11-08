/* MaintenanceDetailModal spare-parts wiring: the modal must search the real
 * catalog as the technician types (server-side q), show stock, enable the
 * dispatch button only after a part is picked, and dispatch the picked part
 * through maintenanceApi.addPart. Before this fix the page passed
 * products={[]} so the combobox could never offer anything. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceDetailModal } from '@/features/maintenance/components/MaintenanceDetailModal';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import { SYSTEM_DEFAULTS } from '@/config/system-defaults.constants';
import type { Product } from '@/types/domain-models/catalog';
import type { MaintenanceTicket } from '@/types/domain-models/maintenance';

const { listPageMock, addPartMock, getTicketMock, updateStatusMock, removePartMock } = vi.hoisted(() => ({
  listPageMock: vi.fn(),
  addPartMock: vi.fn(),
  getTicketMock: vi.fn(),
  updateStatusMock: vi.fn(),
  removePartMock: vi.fn(),
}));

vi.mock('@/features/products/api/products.api', () => ({
  productsApi: { listPage: listPageMock },
}));

vi.mock('@/features/maintenance/api/maintenance.api', () => ({
  maintenanceApi: {
    addPart: addPartMock,
    get: getTicketMock,
    updateStatus: updateStatusMock,
    removePart: removePartMock,
  },
}));

const SCREEN: Product = {
  id: '42',
  name: 'شاشة سامسونج A54',
  nameEn: 'Samsung A54 Screen',
  barcode: '622300000001',
  categoryId: '1',
  supplierId: '1',
  costPrice: 600,
  retailPrice: 850,
  wholesalePrice: 800,
  stock: 4,
  minStock: 1,
  notes: '',
  units: [],
};

const BATTERY: Product = {
  id: '43',
  name: 'بطارية سامسونج',
  nameEn: 'Samsung Battery',
  barcode: '622300000002',
  categoryId: '1',
  supplierId: '1',
  costPrice: 200,
  retailPrice: 300,
  wholesalePrice: 280,
  stock: 0,
  minStock: 1,
  notes: '',
  units: [],
};

const TICKET: MaintenanceTicket = {
  id: 't1',
  ticketNo: 'ZM-261108-0001',
  customerId: null,
  customerName: 'أحمد',
  customerPhone: '01000000000',
  deviceBrand: 'Samsung',
  deviceModel: 'Galaxy A54',
  serialNumber: '123456789012345',
  passcode: null,
  problemDescription: 'شاشة مكسورة',
  deviceCondition: null,
  expectedCost: 500,
  finalCost: 0,
  advancePayment: 0,
  status: 'received',
  technicianId: null,
  technicianName: null,
  technicianNotes: null,
  branchId: null,
  locationId: null,
  saleId: null,
  warrantyDays: 30,
  receivedAt: '2026-11-08T10:00:00.000Z',
  repairedAt: null,
  deliveredAt: null,
  createdAt: '2026-11-08T10:00:00.000Z',
  parts: [],
};

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const user = userEvent.setup();
  const view = render(
    <MaintenanceDetailModal
      ticket={TICKET}
      onClose={vi.fn()}
      onOpenSettlement={vi.fn()}
      onSendWhatsApp={vi.fn()}
      onPrintReceipt={vi.fn()}
      maintenanceProfile={getMaintenanceProfile()}
      commissionRate={SYSTEM_DEFAULTS.TECHNICIAN_COMMISSION_RATE}
    />,
    { wrapper: Wrapper },
  );
  return { ...view, user };
}

/* The combobox selects the input text on focus and re-selects it from a
 * requestAnimationFrame callback; in jsdom rAF is a 1ms setTimeout, so
 * typing immediately after the click can lose the first character to a
 * mid-typing re-select. A real user clicking then typing does not hit
 * this. The wait below lets the focus select settle before typing, and
 * the query assertion reads the box's actual content instead of assuming
 * the literal typed string. */
async function searchForPart(user: ReturnType<typeof userEvent.setup>, query: string) {
  const searchInput = screen.getByPlaceholderText(/ابحث عن قطعة غيار/) as HTMLInputElement;
  await user.click(searchInput);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await user.type(searchInput, query);
  return searchInput;
}

describe('MaintenanceDetailModal spare-parts picker', () => {
  beforeEach(() => {
    listPageMock.mockReset();
    addPartMock.mockReset();
    getTicketMock.mockReset();
    updateStatusMock.mockReset();
    removePartMock.mockReset();
    listPageMock.mockImplementation(async (params: { q: string }) => ({
      products: [SCREEN, BATTERY].filter((p) => p.name.includes(params.q) || p.barcode.includes(params.q)),
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      summary: {
        totalProducts: 2,
        lowStockCount: 0,
        outOfStockCount: 1,
        inventoryCost: 0,
        inventorySaleValue: 0,
        activeOffersCount: 0,
        customerPriceCount: 0,
      },
    }));
    addPartMock.mockResolvedValue({ ok: true, partId: 'p1', newFinalCost: 850 });
    getTicketMock.mockResolvedValue({ ticket: TICKET });
  });

  it('does not query the catalog before the technician types', async () => {
    renderModal();
    await screen.findByText('ZM-261108-0001');
    expect(listPageMock).not.toHaveBeenCalled();
  });

  it('searches by name, shows stock, and enables dispatch only after a pick', async () => {
    const { user } = renderModal();
    const dispatchButton = screen.getByRole('button', { name: '+ صرف' });
    expect(dispatchButton).toBeDisabled();

    const searchInput = await searchForPart(user, 'شاشة');

    await waitFor(
      () => expect(listPageMock).toHaveBeenCalledWith({ q: searchInput.value, page: 1, pageSize: 20 }),
      { timeout: 3000 },
    );
    const option = await screen.findByText('شاشة سامسونج A54 (متاح: 4) - 850 ج.م', {}, { timeout: 3000 });
    await user.click(option);

    expect(dispatchButton).toBeEnabled();
    expect(screen.getByPlaceholderText('السعر')).toHaveValue(850);
  });

  it('dispatches the picked part with its catalog cost and the entered price', async () => {
    const { user } = renderModal();
    await searchForPart(user, 'شاشة');
    const option = await screen.findByText('شاشة سامسونج A54 (متاح: 4) - 850 ج.م', {}, { timeout: 3000 });
    await user.click(option);

    const dispatchButton = screen.getByRole('button', { name: '+ صرف' });
    await waitFor(() => expect(dispatchButton).toBeEnabled(), { timeout: 3000 });

    await user.click(dispatchButton);

    await waitFor(() =>
      expect(addPartMock).toHaveBeenCalledWith('t1', {
        productId: 42,
        productName: 'شاشة سامسونج A54',
        qty: 1,
        unitCost: 600,
        unitPrice: 850,
      }),
    );
  });

  /* Regression: the debounced search text becomes the picked option's label
   * 250 ms after the pick, and the query for that label key never runs, so
   * the option list empties while the dispatch button stays enabled. A
   * real technician always takes longer than the debounce to click dispatch,
   * so dispatching after the debounce must still send the picked part. */
  it('still dispatches the picked part after the 250 ms search debounce elapses', async () => {
    const { user } = renderModal();
    await searchForPart(user, 'شاشة');
    const option = await screen.findByText('شاشة سامسونج A54 (متاح: 4) - 850 ج.م', {}, { timeout: 3000 });
    await user.click(option);

    const dispatchButton = screen.getByRole('button', { name: '+ صرف' });
    await waitFor(() => expect(dispatchButton).toBeEnabled(), { timeout: 3000 });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(dispatchButton).toBeEnabled();

    await user.click(dispatchButton);

    await waitFor(() =>
      expect(addPartMock).toHaveBeenCalledWith('t1', {
        productId: 42,
        productName: 'شاشة سامسونج A54',
        qty: 1,
        unitCost: 600,
        unitPrice: 850,
      }),
    );
    expect(addPartMock).toHaveBeenCalledTimes(1);
  });

  it('shows the system-default technician commission rate, not 0', () => {
    renderModal();
    expect(screen.getByText(/عمولة الفني \(30%\)/)).toBeInTheDocument();
  });
});
