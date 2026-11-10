/* Merchant dispatch goes through dispatchOrders, not updateOrderStatus('shipped')
 * (D-SF-05 / INV-SF-MERCHANT-DISPATCH): the old path flipped only the online
 * order row and left sales.delivery_status='pending', so the merchant list
 * showed "shipped" while the courier queue still showed the order as pending
 * collection. dispatchOrders sets both in one backend transaction. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantOrdersTable, resolveDispatchRepId } from './MerchantOrdersTable';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';
import type { OnlineOrderRecord } from '../types/storefront.types';

const { listMock, dispatchOrdersMock, toastSuccessMock, toastErrorMock, onUpdateStatusMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  dispatchOrdersMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  onUpdateStatusMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('@/shared/api/delivery-reps.api', () => ({
  deliveryRepsApi: {
    list: listMock,
    dispatchOrders: dispatchOrdersMock,
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock, warning: vi.fn(), info: vi.fn() },
  systemConfirm: vi.fn(),
  systemAlert: vi.fn(),
}));

const REPS: DeliveryRep[] = [
  { id: 5, name: 'كابتن أحمد', phone: '01012345678', is_active: true },
  { id: 6, name: 'كابتن محمد', phone: '01111111111', is_active: true },
];

function makeOrder(overrides: Partial<OnlineOrderRecord> = {}): OnlineOrderRecord {
  return {
    id: 101,
    orderNumber: 'ON-261110-0001',
    createdAt: '2026-11-10T10:00:00.000Z',
    customerName: 'عميل تجريبي',
    customerPhone: '01099999999',
    customerAddress: 'شارع تجريبي 1',
    customerNotes: null,
    subtotal: 100,
    deliveryFee: 20,
    totalAmount: 120,
    status: 'processing',
    paymentMethod: 'cod',
    saleId: 77,
    deliveryRepName: 'كابتن أحمد',
    deliveryRepPhone: '01012345678',
    items: [
      {
        productId: 1,
        name: 'منتج اختبار',
        quantity: 2,
        baseUnitPrice: 50,
        unitPrice: 50,
        total: 100,
        originalTotal: 100,
      },
    ],
    ...overrides,
  } as OnlineOrderRecord;
}

function renderTable(orders: OnlineOrderRecord[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(
    <MerchantOrdersTable
      orders={orders}
      isLoading={false}
      onSelectOrder={vi.fn()}
      onConvertToDelivery={vi.fn()}
      onShipBosta={vi.fn()}
      onShipGcc={vi.fn()}
      onLoadToPos={vi.fn()}
      loadingPosOrderId={null}
      onUpdateStatus={onUpdateStatusMock}
      isUpdatingStatus={false}
    />,
    { wrapper: Wrapper },
  );
}

describe('resolveDispatchRepId (INV-SF-MERCHANT-DISPATCH)', () => {
  it('resolves the rep assigned at conversion by exact name', () => {
    expect(resolveDispatchRepId(makeOrder(), REPS)).toBe(5);
  });

  it('tie-breaks same-name reps by phone', () => {
    const dupes: DeliveryRep[] = [
      { id: 7, name: 'كابتن أحمد', phone: '01222222222', is_active: true },
      { id: 8, name: 'كابتن أحمد', phone: '01012345678', is_active: true },
    ];
    expect(resolveDispatchRepId(makeOrder(), dupes)).toBe(8);
  });

  it('returns null when the assigned rep cannot be identified', () => {
    expect(resolveDispatchRepId(makeOrder({ deliveryRepName: 'كابتن غائب' }), REPS)).toBe(null);
    expect(resolveDispatchRepId(makeOrder({ deliveryRepName: null }), REPS)).toBe(null);
    expect(
      resolveDispatchRepId(makeOrder({ deliveryRepPhone: null }), [
        { id: 7, name: 'كابتن أحمد', phone: '01222222222', is_active: true },
        { id: 8, name: 'كابتن أحمد', phone: '01012345678', is_active: true },
      ]),
    ).toBe(null);
  });

  it('ignores inactive reps', () => {
    const reps: DeliveryRep[] = [
      { id: 9, name: 'كابتن أحمد', phone: '01012345678', is_active: false },
      { id: 6, name: 'كابتن محمد', phone: '01111111111', is_active: true },
    ];
    expect(resolveDispatchRepId(makeOrder(), reps)).toBe(null);
  });
});

describe('MerchantOrdersTable merchant dispatch (INV-SF-MERCHANT-DISPATCH)', () => {
  beforeEach(() => {
    listMock.mockReset();
    dispatchOrdersMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    onUpdateStatusMock.mockReset();
    listMock.mockResolvedValue(REPS);
    dispatchOrdersMock.mockResolvedValue({
      success: true,
      repId: 5,
      repName: 'كابتن أحمد',
      dispatchedCount: 1,
      notifications: [],
      message: 'تم إسناد وانطلاق الطلبات بنجاح',
    });
  });

  it('dispatches a processing invoiced order through dispatchOrders, never updateOrderStatus shipped', async () => {
    const user = userEvent.setup();
    renderTable([makeOrder()]);

    await user.click(screen.getByRole('button', { name: 'تسليم للمندوب' }));

    // The dialog opens with the rep assigned at conversion pre-selected.
    expect(await screen.findByDisplayValue(/كابتن أحمد/)).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: 'تسليم للمندوب' });
    await user.click(buttons[buttons.length - 1]);

    await waitFor(() =>
      expect(dispatchOrdersMock).toHaveBeenCalledWith({ repId: 5, onlineOrderIds: [101] }),
    );
    expect(onUpdateStatusMock).not.toHaveBeenCalled();
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it('blocks dispatch when the assigned rep cannot be matched, instead of guessing a rep', async () => {
    const user = userEvent.setup();
    renderTable([makeOrder({ deliveryRepName: 'كابتن غائب', deliveryRepPhone: '01999999999' })]);

    await user.click(screen.getByRole('button', { name: 'تسليم للمندوب' }));
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText(/تعذر مطابقة المندوب المعين/)).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: 'تسليم للمندوب' });
    expect(buttons[buttons.length - 1]).toBeDisabled();
    expect(dispatchOrdersMock).not.toHaveBeenCalled();
  });

  it('keeps the shipped-to-delivered step on updateOrderStatus', async () => {
    const user = userEvent.setup();
    renderTable([makeOrder({ status: 'shipped' })]);

    await user.click(screen.getByRole('button', { name: 'تم التسليم' }));

    expect(onUpdateStatusMock).toHaveBeenCalledWith(101, 'delivered');
    expect(dispatchOrdersMock).not.toHaveBeenCalled();
  });
});
