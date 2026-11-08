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

const { listPageMock, addPartMock, getTicketMock, updateStatusMock, removePartMock, toastErrorMock } = vi.hoisted(() => ({
  listPageMock: vi.fn(),
  addPartMock: vi.fn(),
  getTicketMock: vi.fn(),
  updateStatusMock: vi.fn(),
  removePartMock: vi.fn(),
  toastErrorMock: vi.fn(),
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

/* The modal toasts addPart failures through the shared toast framework
 * (repo rule: never a native alert); the mock lets the spec assert the
 * exact specific message the user would see. */
vi.mock('@/shared/components/system-alert', () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
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

function renderModal(ticket: MaintenanceTicket = TICKET) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const user = userEvent.setup();
  const modalElement = (t: MaintenanceTicket) => (
    <MaintenanceDetailModal
      ticket={t}
      onClose={vi.fn()}
      onOpenSettlement={vi.fn()}
      onSendWhatsApp={vi.fn()}
      onPrintReceipt={vi.fn()}
      maintenanceProfile={getMaintenanceProfile()}
      commissionRate={SYSTEM_DEFAULTS.TECHNICIAN_COMMISSION_RATE}
    />
  );
  const view = render(modalElement(ticket), { wrapper: Wrapper });
  return { ...view, user, rerenderTicket: (next: MaintenanceTicket) => view.rerender(modalElement(next)) };
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

/* Package 7 (batch M2): the cancelled/unrepairable card must not claim a
 * refund is due after it was already recorded; the device passcode is
 * masked by default; and a parts price sum above the ticket total warns
 * (warning only, no blocking). `refundedAdvance` is added by package 5,
 * which merges before this one — on this base the field does not exist
 * on MaintenanceTicket yet, so the flag is passed via a cast. */
describe('MaintenanceDetailModal refund, passcode and pricing warnings', () => {
  beforeEach(() => {
    listPageMock.mockReset();
    addPartMock.mockReset();
    getTicketMock.mockReset();
    updateStatusMock.mockReset();
    removePartMock.mockReset();
    getTicketMock.mockResolvedValue({ ticket: TICKET });
  });

  it('cancelled ticket with refundedAdvance=true shows no refund-due text', () => {
    renderModal({ ...TICKET, status: 'cancelled', advancePayment: 100, refundedAdvance: true } as MaintenanceTicket);
    expect(screen.queryByText(/مستحق رد العربون/)).not.toBeInTheDocument();
    expect(screen.getByText(/تم تسجيل رد العربون/)).toBeInTheDocument();
  });

  it('cancelled ticket without refundedAdvance keeps the old refund-due text', () => {
    renderModal({ ...TICKET, status: 'cancelled', advancePayment: 100 });
    expect(screen.getByText(/مستحق رد العربون للعميل بالكامل/)).toBeInTheDocument();
  });

  it('masks the passcode by default and reveals it only on click', async () => {
    const { user } = renderModal({ ...TICKET, passcode: '1234' });
    expect(screen.queryByText('1234')).not.toBeInTheDocument();
    expect(screen.getByText('••••••')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'إظهار' }));
    expect(screen.getByText('1234')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'إخفاء' }));
    expect(screen.queryByText('1234')).not.toBeInTheDocument();
    expect(screen.getByText('••••••')).toBeInTheDocument();
  });

  it('warns when the parts price sum exceeds the ticket total', () => {
    renderModal({
      ...TICKET,
      finalCost: 100,
      expectedCost: 100,
      parts: [
        { id: 'p1', ticketId: 't1', productId: '42', productName: 'شاشة سامسونج A54', qty: 1, unitCost: 100, unitPrice: 150, totalPrice: 150, createdAt: '2026-11-08T10:00:00.000Z' },
      ],
    });
    /* role="alert" has no accessible name (live region): assert the role
     * plus the warning text itself. */
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/سعر قطع الغيار أعلى من إجمالي الحساب/)).toBeInTheDocument();
  });

  it('shows no pricing warning when the parts price sum is within the total', () => {
    renderModal({
      ...TICKET,
      finalCost: 500,
      expectedCost: 500,
      parts: [
        { id: 'p1', ticketId: 't1', productId: '42', productName: 'شاشة سامسونج A54', qty: 1, unitCost: 100, unitPrice: 150, totalPrice: 150, createdAt: '2026-11-08T10:00:00.000Z' },
      ],
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/سعر قطع الغيار أعلى من إجمالي الحساب/)).not.toBeInTheDocument();
  });
});

/* LF-P1 (live-fix batch, ticket ZM-261108-0002): the "+ صرف" button was
 * dead live — a stocked part picked by barcode or by name, four clicks,
 * zero parts recorded, no error, no 5100/1140 journal. The pick→click
 * path itself works on a stable prop (see the 600 ms test above), so the
 * break is what happens AROUND the pick: (1) the modal's useEffect
 * ([ticket]) wipes the pick whenever the ticket prop arrives as a new
 * object — a list refetch re-deriving the selected ticket does exactly
 * that, and the button goes disabled under the technician's clicks;
 * (2) addPart had no error surface at all, so ANY backend refusal
 * (closed ticket, insufficient stock) vanished with no trace; (3) the
 * dispatch row offered dispatch on closed tickets, whose backend
 * rejects it (MAINTENANCE_CLOSED 409) by design. Each test below FAILS
 * on the base file and PASSES only with the production fix. */
describe('MaintenanceDetailModal parts dispatch stays alive (LF-P1)', () => {
  beforeEach(() => {
    listPageMock.mockReset();
    addPartMock.mockReset();
    getTicketMock.mockReset();
    updateStatusMock.mockReset();
    removePartMock.mockReset();
    toastErrorMock.mockReset();
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

  async function pickScreenPart(user: ReturnType<typeof userEvent.setup>) {
    await searchForPart(user, 'شاشة');
    const option = await screen.findByText('شاشة سامسونج A54 (متاح: 4) - 850 ج.م', {}, { timeout: 3000 });
    await user.click(option);
    const dispatchButton = screen.getByRole('button', { name: '+ صرف' });
    await waitFor(() => expect(dispatchButton).toBeEnabled(), { timeout: 3000 });
    return dispatchButton;
  }

  it('keeps the picked part when the same ticket arrives as a fresh prop object', async () => {
    const { user, rerenderTicket } = renderModal();
    await pickScreenPart(user);

    /* A list refetch re-derives the selected ticket: same id, new object
     * identity, one harmless field changed — the technician's in-progress
     * pick must survive it, exactly as a real refetch would deliver it. */
    rerenderTicket({ ...TICKET, technicianNotes: 'فحص أولي' });

    const dispatchButton = screen.getByRole('button', { name: '+ صرف' });
    await waitFor(() => expect(dispatchButton).toBeEnabled(), { timeout: 3000 });
    expect(screen.getByPlaceholderText('السعر')).toHaveValue(850);

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

  it('still resets the pick when a DIFFERENT ticket is opened', async () => {
    const { user, rerenderTicket } = renderModal();
    await pickScreenPart(user);

    rerenderTicket({ ...TICKET, id: 't2', ticketNo: 'ZM-261108-0002' });

    await waitFor(
      () => expect(screen.getByRole('button', { name: '+ صرف' })).toBeDisabled(),
      { timeout: 3000 },
    );
    expect(addPartMock).not.toHaveBeenCalled();
  });

  it('does not offer dispatch on a delivered ticket', async () => {
    const { user } = renderModal({ ...TICKET, status: 'delivered' });
    await searchForPart(user, 'شاشة');
    const option = await screen.findByText('شاشة سامسونج A54 (متاح: 4) - 850 ج.م', {}, { timeout: 3000 });
    await user.click(option);

    expect(screen.getByRole('button', { name: '+ صرف' })).toBeDisabled();
    expect(addPartMock).not.toHaveBeenCalled();
  });

  it('names the closed ticket when the backend refuses a dispatch on it', async () => {
    const { user } = renderModal();
    addPartMock.mockRejectedValueOnce(
      Object.assign(new Error('Cannot issue parts to a closed maintenance ticket'), {
        code: 'MAINTENANCE_CLOSED',
        status: 409,
      }),
    );
    const dispatchButton = await pickScreenPart(user);

    await user.click(dispatchButton);

    await waitFor(() => expect(addPartMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled(), { timeout: 3000 });
    const toasted = String(toastErrorMock.mock.calls[0][0]);
    expect(toasted).toMatch(/مغلقة/);
    expect(toasted).toMatch(/ZM-261108-0001/);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/مغلقة/)).toBeInTheDocument();
  });

  it('shows the backend stock message verbatim when stock refuses the dispatch', async () => {
    const { user } = renderModal();
    addPartMock.mockRejectedValueOnce(
      Object.assign(new Error('الرصيد غير كافٍ لصرف قطعة الغيار شاشة سامسونج A54'), {
        code: 'INSUFFICIENT_STOCK',
        status: 422,
      }),
    );
    const dispatchButton = await pickScreenPart(user);

    await user.click(dispatchButton);

    await waitFor(() => expect(addPartMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled(), { timeout: 3000 });
    expect(String(toastErrorMock.mock.calls[0][0])).toContain(
      'الرصيد غير كافٍ لصرف قطعة الغيار شاشة سامسونج A54',
    );
    expect(
      screen.getByText('الرصيد غير كافٍ لصرف قطعة الغيار شاشة سامسونج A54'),
    ).toBeInTheDocument();
  });
});
