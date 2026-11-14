/* T11-A (INV-REST-COMBO-SUBMIT-TRUTH, follow-up A): the checkout dialog
 * stays open on a failed submit, but the failure reason lived only in
 * the footer banner underneath it — the cashier staring at the open
 * dialog saw no reason. The dialog must surface submitMessage INSIDE
 * itself while it stays open on failure. At base the dialog renders no
 * such banner, so the first two cases fail there; the third pins that
 * no banner appears when there is no message. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { formatCurrency } from '@/lib/format';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PosCheckoutDialog } from './PosCheckoutDialog';
import { createTestQueryClient } from '@/test/test-query-client';

vi.mock('@/shared/api/delivery-reps.api', () => ({
  deliveryRepsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/features/pos/hooks/usePosUiCustomization', () => ({
  usePosUiCustomization: () => ({
    customization: { checkoutMode: 'detailed', defaultPaymentChannel: 'cash' },
  }),
}));

const FAILURE_MESSAGE = 'تعذّر حفظ الفاتورة: إجمالي الفاتورة (150) لا يطابق الإجمالي المحسوب (225).';

function makePos(overrides: Record<string, unknown> = {}) {
  return {
    cart: [{
      lineKey: 'p1::u1::retail',
      productId: 'p1',
      name: 'Burger',
      unitName: 'قطعة',
      unitMultiplier: 1,
      price: 150,
      qty: 1,
    }],
    totals: {
      total: 150,
      subTotal: 150,
      discountValue: 0,
      deliveryFee: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      serviceCharge: 0,
      taxAmount: 0,
      tipAmount: 0,
    },
    paidAmount: 0,
    amountDue: 150,
    changeAmount: 0,
    cashAmount: 0,
    cardAmount: 0,
    transferAmount: 0,
    tenderedAmount: 0,
    tipAmount: 0,
    discount: 0,
    deliveryFee: 0,
    loyaltyPointsRedeemed: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    orderType: 'takeaway',
    deliveryFeeMode: 'manual',
    collectionStatus: undefined,
    deliveryRepId: '',
    customerId: '',
    customersQuery: { data: [] },
    quickCustomerName: '',
    quickCustomerPhone: '',
    quickCustomerAddress: '',
    quickCustomerMutation: { mutateAsync: vi.fn() },
    settings: {},
    settingsQuery: { data: { restaurantModuleEnabled: false } },
    createSale: { isPending: false, isError: false },
    submitMessage: '',
    setSubmitMessage: vi.fn(),
    canSubmitSale: true,
    canSubmitHint: '',
    canShowLastSaleActions: false,
    canApplyDiscount: true,
    hasDiscountPermissionViolation: false,
    discountApprovalGranted: false,
    discountAuthorizationMutation: { mutateAsync: vi.fn() },
    setDiscountApprovalGranted: vi.fn(),
    setDiscountApprovalSecret: vi.fn(),
    setPaymentPreset: vi.fn(),
    setNote: vi.fn(),
    note: '',
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    setTenderedAmount: vi.fn(),
    setTipAmount: vi.fn(),
    setDiscount: vi.fn(),
    setDeliveryFee: vi.fn(),
    setDeliveryFeeMode: vi.fn(),
    setLoyaltyPointsRedeemed: vi.fn(),
    setTerminalPaymentDetails: vi.fn(),
    terminalPaymentDetails: null,
    setCustomerId: vi.fn(),
    setQuickCustomerName: vi.fn(),
    setQuickCustomerPhone: vi.fn(),
    setQuickCustomerAddress: vi.fn(),
    setOrderType: vi.fn(),
    setCollectionStatus: vi.fn(),
    setDeliveryRepId: vi.fn(),
    setPaymentChannel: vi.fn(),
    handleQuickCustomerSubmit: vi.fn(),
    api: {},
    ...overrides,
  };
}

function renderDialog(pos: unknown) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <PosCheckoutDialog
          open
          pos={pos as any}
          selectedCustomerName="عميل نقدي"
          onClose={vi.fn()}
          onConfirmSale={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PosCheckoutDialog — failure reason inside the dialog (T11-A)', () => {
  it('shows the submit failure reason inside the dialog while it stays open', () => {
    renderDialog(makePos({
      submitMessage: FAILURE_MESSAGE,
      createSale: { isPending: false, isError: true },
    }));

    expect(screen.getByText(/إجمالي الفاتورة \(150\) لا يطابق الإجمالي المحسوب \(225\)/)).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain(FAILURE_MESSAGE);
  }, 30000);

  it('shows a dialog-local validation failure (no mutation error) inside the dialog', () => {
    renderDialog(makePos({
      submitMessage: 'يرجى اختيار مندوب التوصيل لتسجيل عهدة التحصيل عليه (في حالة تحصيل من العميل).',
      createSale: { isPending: false, isError: false },
      canShowLastSaleActions: false,
    }));

    expect(screen.getByText(/يرجى اختيار مندوب التوصيل/)).toBeInTheDocument();
  }, 30000);

  it('shows no banner when there is no submit message', () => {
    renderDialog(makePos({ submitMessage: '' }));

    expect(screen.queryByRole('alert')).toBeNull();
  }, 30000);

  it('shows manager approval button when cashier has discount locked, and locks confirm sale', () => {
    renderDialog(makePos({
      canApplyDiscount: false,
      hasDiscountPermissionViolation: true,
      canSubmitSale: false,
      canSubmitHint: 'الخصم يتطلب اعتماد المدير (PIN).',
    }));

    expect(screen.getByText('اعتماد المدير')).toBeInTheDocument();
    expect(screen.getByText('الخصم يتطلب اعتماد المدير (PIN).')).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: /تأكيد البيع/ });
    expect(confirmButton).toBeDisabled();
  });
});

/* SPICE-PKG8 (INV-THREE-WAY-PAYMENT-SPLIT): the trial E-block sale
 * (cash + Visa + wallet, 200/200/200 on a 600 total) could not be
 * recorded — the payment section rendered ONE shared second input
 * whose value and setter flipped between the card leg and the
 * transfer leg with paymentChannel, so the third leg had nowhere to
 * be typed. The dialog must render three SEPARATE inputs (cash,
 * card, transfer) holding all three legs at once, each typing into
 * its own leg only, and the paid/remaining chips must reconcile
 * exactly — a one-piastre shortfall still shows as remaining, never
 * silently absorbed. */
describe('PosCheckoutDialog — three-way payment split (SPICE-PKG8)', () => {
  function makeSplitPos(overrides: Record<string, unknown> = {}) {
    return makePos({
      cart: [{
        lineKey: 'p1::u1::retail',
        productId: 'p1',
        name: 'Burger',
        unitName: 'قطعة',
        unitMultiplier: 1,
        price: 600,
        qty: 1,
      }],
      totals: {
        total: 600,
        subTotal: 600,
        discountValue: 0,
        deliveryFee: 0,
        taxRate: 0,
        pricesIncludeTax: false,
        serviceCharge: 0,
        taxAmount: 0,
        tipAmount: 0,
      },
      paidAmount: 600,
      amountDue: 0,
      changeAmount: 0,
      cashAmount: 200,
      cardAmount: 200,
      transferAmount: 200,
      paymentType: 'cash',
      paymentChannel: 'wallet',
      ...overrides,
    });
  }

  it('renders separate cash, card and transfer inputs holding all three legs at once', () => {
    renderDialog(makeSplitPos());

    const cashInput = screen.getByLabelText('نقدي') as HTMLInputElement;
    const cardInput = screen.getByLabelText('فيزا / كارت') as HTMLInputElement;
    const transferInput = screen.getByLabelText('محافظ إلكترونية') as HTMLInputElement;
    expect(cashInput.value).toBe('200');
    expect(cardInput.value).toBe('200');
    expect(transferInput.value).toBe('200');
    expect(screen.getAllByDisplayValue('200')).toHaveLength(3);
  }, 30000);

  it('typing the transfer leg calls only setTransferAmount, never setCardAmount', () => {
    const setCardAmount = vi.fn();
    const setTransferAmount = vi.fn();
    renderDialog(makeSplitPos({ setCardAmount, setTransferAmount }));

    const transferInput = screen.getByLabelText('محافظ إلكترونية');
    fireEvent.change(transferInput, { target: { value: '150' } });

    expect(setTransferAmount).toHaveBeenCalledWith(150);
    expect(setCardAmount).not.toHaveBeenCalled();
  }, 30000);

  it('typing the card leg calls only setCardAmount, never setTransferAmount', () => {
    const setCardAmount = vi.fn();
    const setTransferAmount = vi.fn();
    renderDialog(makeSplitPos({ setCardAmount, setTransferAmount }));

    const cardInput = screen.getByLabelText('فيزا / كارت');
    fireEvent.change(cardInput, { target: { value: '250' } });

    expect(setCardAmount).toHaveBeenCalledWith(250);
    expect(setTransferAmount).not.toHaveBeenCalled();
  }, 30000);

  it('the paid and remaining chips reconcile exactly for a three-way split', () => {
    renderDialog(makeSplitPos());

    expect(screen.getByText('المدفوع').parentElement?.textContent).toContain(formatCurrency(600));
    expect(screen.getByText('المتبقي').parentElement?.textContent).toContain(formatCurrency(0));
  }, 30000);

  it('a one-piastre shortfall still shows as remaining, never absorbed', () => {
    renderDialog(makeSplitPos({ paidAmount: 599.99, amountDue: 0.01 }));

    expect(screen.getByText('المتبقي').parentElement?.textContent).toContain(formatCurrency(0.01));
  }, 30000);
});
