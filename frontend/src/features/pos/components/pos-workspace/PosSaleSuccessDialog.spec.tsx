import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosSaleSuccessDialog } from './PosSaleSuccessDialog';
import type { Sale } from '@/types/domain';

const { mockIsAvailable, mockKickDrawer } = vi.hoisted(() => ({
  mockIsAvailable: vi.fn(),
  mockKickDrawer: vi.fn(),
}));

vi.mock('@/features/pos/lib/hardware-bridge-client', () => ({
  HardwareBridgeClient: {
    isAvailable: mockIsAvailable,
    kickDrawer: mockKickDrawer,
  },
}));

const sale = {
  id: 'sale-1',
  docNo: 'S-100',
  customerId: 'cust-1',
  customerName: 'أحمد علي',
  paymentType: 'cash',
  paymentChannel: 'cash',
  total: 120,
  paidAmount: 150,
  items: [],
  payments: [],
} as unknown as Sale;

function renderDialog(overrides: Partial<Parameters<typeof PosSaleSuccessDialog>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PosSaleSuccessDialog
        open
        sale={sale}
        customer={{ id: 'cust-1', name: 'أحمد علي', phone: '01000000001', address: '', balance: 0, type: 'vip', creditLimit: 0, storeCreditBalance: 0 }}
        settings={{ storeName: 'متجر تجريبي' }}
        onClose={vi.fn()}
        onNewSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintA4={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

/* INV-DRAWER-KICK-500: the bridge being up does not mean a printer is
 * attached — kicking with no printer configured returns 500 from the
 * bridge (127.0.0.1:18181/api/printer/kick-drawer). The dialog now kicks
 * the bridge drawer only when the merchant has set a cash drawer
 * printer as connected (settings.posCashDrawerPrinterEnabled). These
 * cases drive the REAL dialog with a mocked HardwareBridgeClient.
 * The fixture MUST carry status 'posted': the kick runs only for posted
 * cash sales, so a fixture without it would pass vacuously. */
describe('drawer kick (INV-DRAWER-KICK-500)', () => {
  const postedCashSale = { ...sale, status: 'posted' } as unknown as Sale;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
    mockKickDrawer.mockResolvedValue({ ok: true });
  });

  it('skips the bridge drawer kick quietly when no printer is configured', async () => {
    renderDialog({ sale: postedCashSale, settings: { storeName: 'متجر تجريبي' } });

    await waitFor(() => {
      expect(screen.getByText('تم البيع بنجاح')).toBeInTheDocument();
    });
    expect(mockIsAvailable).not.toHaveBeenCalled();
    expect(mockKickDrawer).not.toHaveBeenCalled();
  });

  it('sends the bridge drawer kick when a printer is configured', async () => {
    renderDialog({
      sale: postedCashSale,
      settings: { storeName: 'متجر تجريبي', posCashDrawerPrinterEnabled: true },
    });

    await waitFor(() => {
      expect(mockKickDrawer).toHaveBeenCalledTimes(1);
    });
    expect(mockKickDrawer).toHaveBeenCalledWith({ ip: '127.0.0.1' });
  });

  it('does not kick when the bridge reports unavailable even if a printer is configured', async () => {
    mockIsAvailable.mockResolvedValue(false);
    renderDialog({
      sale: postedCashSale,
      settings: { storeName: 'متجر تجريبي', posCashDrawerPrinterEnabled: true },
    });

    await waitFor(() => {
      expect(screen.getByText('تم البيع بنجاح')).toBeInTheDocument();
    });
    expect(mockIsAvailable).toHaveBeenCalledTimes(1);
    expect(mockKickDrawer).not.toHaveBeenCalled();
  });

  it('does not kick a sale that is not posted even if a printer is configured', async () => {
    renderDialog({
      sale: { ...sale, status: 'draft' } as unknown as Sale,
      settings: { storeName: 'متجر تجريبي', posCashDrawerPrinterEnabled: true },
    });

    await waitFor(() => {
      expect(screen.getByText('تم البيع بنجاح')).toBeInTheDocument();
    });
    expect(mockIsAvailable).not.toHaveBeenCalled();
    expect(mockKickDrawer).not.toHaveBeenCalled();
  });
});

describe('PosSaleSuccessDialog', () => {
  it('shows sale success details and print hint', () => {
    renderDialog();

    expect(screen.getByText('تم البيع بنجاح')).toBeInTheDocument();
    expect(screen.getAllByText('S-100').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /طباعة ريسيت العميل F2/ })).toBeInTheDocument();
  });

  it('renders dual receipt print button with F4 and executes on F4 press', async () => {
    const user = userEvent.setup();
    const dualPrintMock = vi.fn();
    renderDialog({ onPrintDualReceipt: dualPrintMock });

    const dualBtn = screen.getByRole('button', { name: /طباعة نسختين \(عميل \+ محل\) F4/ });
    expect(dualBtn).toBeInTheDocument();

    await user.keyboard('{F4}');
    expect(dualPrintMock).toHaveBeenCalledTimes(1);
  });

  it('uses the selected customer phone for WhatsApp', async () => {
    const user = userEvent.setup();
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderDialog();

    await user.click(screen.getByRole('button', { name: 'إرسال واتساب F8' }));

    expect(openMock).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/01000000001'), '_blank', 'noopener,noreferrer');
    expect(openMock).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('S-100')), '_blank', 'noopener,noreferrer');
    openMock.mockRestore();
  });

  it('shows phone input when no customer phone exists and sends once', async () => {
    const user = userEvent.setup();
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderDialog({
      customer: { id: 'cust-1', name: 'أحمد علي', phone: '', address: '', balance: 0, type: 'cash', creditLimit: 0, storeCreditBalance: 0 },
    });

    expect(screen.getByPlaceholderText('أدخل رقم الهاتف لإرسال الفاتورة')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('أدخل رقم الهاتف لإرسال الفاتورة'), '01234567890');
    await user.click(screen.getByRole('button', { name: 'إرسال مرة واحدة F8' }));

    expect(openMock).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/01234567890'), '_blank', 'noopener,noreferrer');
    openMock.mockRestore();
  });

  it('correctly formats delivery COD sales with courier collection info', () => {
    const deliverySale = {
      ...sale,
      orderType: 'delivery',
      deliveryRepId: 3,
      deliveryRepName: 'سيد',
      total: 1033,
      paidAmount: 0,
      tenderedAmount: 0,
    } as unknown as Sale;

    renderDialog({ sale: deliverySale });

    expect(screen.getByText(/دليفري — تحصيل مع المندوب \(سيد\)/)).toBeInTheDocument();
    expect(screen.getByText(/المطلوب تحصيله/)).toBeInTheDocument();
    expect(screen.getByText(/عهدة مع المندوب/)).toBeInTheDocument();
    expect(screen.queryByText(/المستلم نقديًا/)).not.toBeInTheDocument();
  });

  it('correctly formats online-paid delivery orders without courier COD debt', () => {
    const onlineDeliverySale = {
      ...sale,
      orderType: 'delivery',
      deliveryRepId: 3,
      deliveryRepName: 'سيد',
      paymentChannel: 'instapay',
      deliveryFee: 35,
      total: 1035,
      paidAmount: 1035,
      collectionStatus: 'collected',
    } as unknown as Sale;

    renderDialog({ sale: onlineDeliverySale });

    expect(screen.getByText(/مدفوع مسبقاً بالكامل/)).toBeInTheDocument();
    expect(screen.getByText(/سيد/)).toBeInTheDocument();
    expect(screen.getByText(/تسوية المندوب/)).toBeInTheDocument();
    expect(screen.queryByText(/عهدة مع المندوب/)).not.toBeInTheDocument();
  });

  it('correctly formats partial credit delivery orders with customer debt and courier delivery-only role', () => {
    const partialCreditDeliverySale = {
      ...sale,
      orderType: 'delivery',
      deliveryRepId: 3,
      deliveryRepName: 'طاهر',
      paymentType: 'credit',
      paymentChannel: 'mixed',
      deliveryFee: 35,
      total: 235,
      paidAmount: 230,
      customerName: 'بسيسي',
    } as unknown as Sale;

    renderDialog({ sale: partialCreditDeliverySale });

    expect(screen.getByText(/سداد جزئي \(متبقي آجل\)/)).toBeInTheDocument();
    expect(screen.getByText(/المتبقي على العميل/)).toBeInTheDocument();
    expect(screen.getByText(/طاهر/)).toBeInTheDocument();
    expect(screen.getByText(/تسليم فقط/)).toBeInTheDocument();
    expect(screen.queryByText(/مدفوع مسبقاً بالكامل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/عهدة مع المندوب/)).not.toBeInTheDocument();
  });
});
