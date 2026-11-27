import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosInstantExchangeDialog } from './PosInstantExchangeDialog';
import { useAuthStore } from '@/stores/auth-store';
import type { PosWorkspaceState } from './posWorkspace.helpers';

const mocks = vi.hoisted(() => ({
  listPage: vi.fn(),
  getSaleForExchange: vi.fn(),
  createSale: vi.fn(),
  getSaleOperationStatus: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  invalidateSalesDomain: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback || _key,
      i18n: { language: 'ar', dir: () => 'rtl' },
    }),
  };
});

vi.mock('@/shared/api/sales.api', () => ({
  salesApi: {
    listPage: mocks.listPage,
  },
}));

vi.mock('@/features/pos/api/pos.api', () => ({
  posApi: {
    getSaleForExchange: mocks.getSaleForExchange,
    createSale: mocks.createSale,
    getSaleOperationStatus: mocks.getSaleOperationStatus,
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    info: vi.fn(),
  },
}));

vi.mock('@/app/query-invalidation', () => ({
  invalidateSalesDomain: mocks.invalidateSalesDomain,
}));

function createPosMock(overrides: Partial<PosWorkspaceState> = {}): PosWorkspaceState {
  return {
    branchId: '1',
    ownOpenShift: { id: '10' },
    loyaltyPointsRedeemed: 0,
    orderType: 'takeaway',
    discount: 0,
    cart: [
      {
        lineKey: 'cart-1',
        productId: '202',
        name: 'صنف بديل',
        qty: 1,
        price: 120,
        unitName: 'قطعة',
        unitMultiplier: 1,
        priceType: 'retail',
        serials: [],
      },
    ],
    totals: {
      total: 120,
      taxRate: 0,
      pricesIncludeTax: true,
    },
    settings: { currency: 'EGP' },
    settingsQuery: { data: { currency: 'EGP' } },
    resetPosDraft: vi.fn(),
    ...overrides,
  } as unknown as PosWorkspaceState;
}

function renderDialog(pos: PosWorkspaceState, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <PosInstantExchangeDialog open onClose={onClose} pos={pos} />
      </QueryClientProvider>
    ),
  };
}

describe('PosInstantExchangeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useAuthStore.setState({ user: { id: '2', username: 'cashier-a', role: 'cashier', permissions: ['sales'], tenantId: 't1', branchIds: ['1'] } as never });
    mocks.listPage.mockResolvedValue({
      rows: [{ id: '16529', docNo: 'Z-261116-16529' }],
    });
    mocks.getSaleForExchange.mockResolvedValue({
      sale: {
        id: '16529',
        docNo: 'Z-261116-16529',
        customerId: '3063',
        customerName: 'عميل أحمد محمد',
        branchId: '1',
        status: 'posted',
        total: 70,
        paidAmount: 70,
        storeCreditUsed: 0,
        items: [
          {
            id: '901',
            productId: '101',
            name: '2 علب جلي فراولة 6 قطع',
            qty: 2,
            total: 70,
            netLineTotal: 70,
            allocatedTax: 0,
            serials: [],
          },
        ],
      },
    });
    mocks.createSale.mockResolvedValue({ sale: { id: '17000' } });
    mocks.getSaleOperationStatus.mockResolvedValue({ status: 'unknown' });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ user: null });
  });

  it('renders StandardDialog shell with header close button, footer actions, and fixed height class', () => {
    const { onClose } = renderDialog(createPosMock());
    const dialog = document.body.querySelector('.dialog-shell.pos-exchange-dialog-shell') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.classList.contains('dialog-compact')).toBe(true);

    expect(screen.getByRole('heading', { name: 'استبدال فوري' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'اعتماد الاستبدال' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('loads source invoice by docNo, enforces RTL stepper order, updates net estimate, and submits idempotent exchange', async () => {
    const pos = createPosMock();
    const { onClose } = renderDialog(pos);

    fireEvent.change(screen.getByLabelText('رقم الفاتورة الأصلية'), {
      target: { value: 'Z-261116-16529' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تحميل' }));

    await waitFor(() => {
      expect(screen.getByText('عميل أحمد محمد')).toBeTruthy();
    });
    expect(screen.getByText('Z-261116-16529')).toBeTruthy();

    // Verify Strict RTL Stepper order in DOM: [+] -> [input.no-spin-arrows] -> [-]
    const incBtn = screen.getByRole('button', { name: 'زيادة كمية المرتجع 2 علب جلي فراولة 6 قطع' });
    const qtyInput = screen.getByLabelText('كمية المرتجع 2 علب جلي فراولة 6 قطع') as HTMLInputElement;
    const decBtn = screen.getByRole('button', { name: 'إنقاص كمية المرتجع 2 علب جلي فراولة 6 قطع' });

    expect(qtyInput.classList.contains('no-spin-arrows')).toBe(true);
    expect(incBtn.nextElementSibling).toBe(qtyInput);
    expect(qtyInput.nextElementSibling).toBe(decBtn);

    fireEvent.click(incBtn);
    expect(qtyInput.value).toBe('1');
    // Return estimate = 35.00, New cart = 120.00 -> Net collect = 85.00
    expect(screen.getByText('35.00')).toBeTruthy();
    expect(screen.getByText('85.00')).toBeTruthy();

    // Select card payment via CustomSelect combobox
    const selectInputs = screen.getAllByRole('combobox');
    expect(selectInputs.length).toBe(2);
    fireEvent.click(selectInputs[0]);
    fireEvent.click(screen.getByText('شبكة'));

    // Net is +85 (customer pays positive difference), so no supervisor PIN input is shown
    expect(screen.queryByLabelText('رمز اعتماد المشرف')).toBeNull();

    const submitBtn = screen.getByRole('button', { name: 'اعتماد الاستبدال' });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mocks.createSale).toHaveBeenCalledTimes(1);
    });

    const [payload, , headers] = mocks.createSale.mock.calls[0];
    expect(payload).toMatchObject({
      exchangeSaleId: 16529,
      paymentChannel: 'card',
      exchangeRefundMethod: 'cash',
      items: [
        expect.objectContaining({ productId: 202, qty: 1, price: 120 }),
        expect.objectContaining({ productId: 101, originalSaleItemId: 901, qty: -1 }),
      ],
    });
    expect(headers['x-idempotency-key']).toBeTruthy();
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires supervisor PIN only for large cash refunds by non-admin, never for store_credit or admin', async () => {
    mocks.getSaleForExchange.mockResolvedValueOnce({
      sale: {
        id: '16529',
        docNo: 'Z-261116-16529',
        customerId: '3063',
        customerName: 'عميل أحمد محمد',
        branchId: '1',
        status: 'posted',
        total: 700,
        paidAmount: 700,
        storeCreditUsed: 0,
        items: [
          {
            id: '901',
            productId: '101',
            name: 'صنف مرتجع كبير',
            qty: 1,
            total: 700,
            netLineTotal: 700,
            allocatedTax: 0,
            serials: [],
          },
        ],
      },
    });

    const pos = createPosMock({ totals: { total: 120, taxRate: 0, pricesIncludeTax: true } as never });
    renderDialog(pos);

    fireEvent.change(screen.getByLabelText('رقم الفاتورة الأصلية'), { target: { value: '16529' } });
    fireEvent.click(screen.getByRole('button', { name: 'تحميل' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'استرجاع الكل' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'استرجاع الكل' }));

    // Net refund = 580 >= 500 in cash for cashier -> PIN input appears and blocks submit until filled
    const pinInput = screen.getByLabelText('رمز اعتماد المشرف') as HTMLInputElement;
    expect(pinInput.type).toBe('text');
    expect(pinInput.classList.contains('secure-password-field')).toBe(true);
    expect(screen.getByRole('button', { name: 'اعتماد الاستبدال' })).toBeDisabled();

    fireEvent.change(pinInput, { target: { value: '4321' } });
    expect(screen.getByRole('button', { name: 'اعتماد الاستبدال' })).not.toBeDisabled();

    // Switching refundMethod to store_credit hides supervisor PIN requirement even for 580 refund
    const selectInputs = screen.getAllByRole('combobox');
    fireEvent.click(selectInputs[1]);
    fireEvent.click(screen.getByText('رصيد متجر'));
    expect(screen.queryByLabelText('رمز اعتماد المشرف')).toBeNull();
    expect(screen.getByRole('button', { name: 'اعتماد الاستبدال' })).not.toBeDisabled();

    // Switching back to cash + admin user -> PIN also omitted for admin
    fireEvent.click(selectInputs[1]);
    fireEvent.click(screen.getByText('نقدي'));
    expect(screen.getByLabelText('رمز اعتماد المشرف')).toBeTruthy();

    cleanup();
    useAuthStore.setState({ user: { id: '1', username: 'owner', role: 'admin', permissions: [], tenantId: 't1', branchIds: ['1'] } as never });
    mocks.getSaleForExchange.mockResolvedValueOnce({
      sale: {
        id: '16529',
        docNo: 'Z-261116-16529',
        customerId: '3063',
        customerName: 'عميل أحمد محمد',
        branchId: '1',
        status: 'posted',
        total: 700,
        paidAmount: 700,
        storeCreditUsed: 0,
        items: [{ id: '901', productId: '101', name: 'صنف مرتجع كبير', qty: 1, total: 700, netLineTotal: 700, allocatedTax: 0, serials: [] }],
      },
    });
    renderDialog(pos);
    fireEvent.change(screen.getByLabelText('رقم الفاتورة الأصلية'), { target: { value: '16529' } });
    fireEvent.click(screen.getByRole('button', { name: 'تحميل' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'استرجاع الكل' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'استرجاع الكل' }));
    expect(screen.queryByLabelText('رمز اعتماد المشرف')).toBeNull();
    expect(screen.getByRole('button', { name: 'اعتماد الاستبدال' })).not.toBeDisabled();
  });

  it('prevents closing while exchange operation recovery state is unknown', async () => {
    mocks.createSale.mockRejectedValueOnce(new Error('Network timeout'));
    mocks.getSaleOperationStatus.mockRejectedValueOnce(new Error('Offline'));

    const pos = createPosMock();
    const { onClose } = renderDialog(pos);

    fireEvent.change(screen.getByLabelText('رقم الفاتورة الأصلية'), {
      target: { value: '16529' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'تحميل' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'استرجاع الكل' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'استرجاع الكل' }));
    fireEvent.click(screen.getByRole('button', { name: 'اعتماد الاستبدال' }));

    await waitFor(() => {
      expect(mocks.toastWarning).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: 'التحقق من نتيجة الطلب' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
