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

describe('PosCheckoutDialog — single active payment button & no-spin inputs', () => {
  it('never highlights both cash and card buttons when cash holds 100 and card holds 0', () => {
    renderDialog(makePos({
      totals: { total: 100, subTotal: 100, discountValue: 0, deliveryFee: 0, taxRate: 0, pricesIncludeTax: false, serviceCharge: 0, taxAmount: 0, tipAmount: 0 },
      paidAmount: 100,
      amountDue: 0,
      cashAmount: 100,
      cardAmount: 0,
      transferAmount: 0,
      paymentType: 'cash',
      paymentChannel: 'card', // even if stale channel says card while cash leg holds 100
    }));

    const cashBtn = screen.getByRole('button', { name: 'نقدي' });
    const cardBtn = screen.getByRole('button', { name: 'فيزا / كارت' });
    expect(cashBtn.className).toContain('btn-primary');
    expect(cardBtn.className).toContain('btn-secondary');
    expect(cardBtn.className).not.toContain('btn-primary');
  }, 30000);

  it('adds no-spin-arrows to all payment and discount numeric inputs', () => {
    renderDialog(makePos({
      totals: { total: 100, subTotal: 100, discountValue: 0, deliveryFee: 0, taxRate: 0, pricesIncludeTax: false, serviceCharge: 0, taxAmount: 0, tipAmount: 0 },
      cashAmount: 100,
      paidAmount: 100,
      amountDue: 0,
    }));

    expect((screen.getByLabelText('نقدي') as HTMLInputElement).className).toContain('no-spin-arrows');
    expect((screen.getByLabelText('فيزا / كارت') as HTMLInputElement).className).toContain('no-spin-arrows');
    expect((screen.getByLabelText('محافظ / InstaPay') as HTMLInputElement).className).toContain('no-spin-arrows');
    expect((screen.getByLabelText('الخصم (مبلغ)') as HTMLInputElement).className).toContain('no-spin-arrows');
    expect((screen.getByLabelText('الخصم (%)') as HTMLInputElement).className).toContain('no-spin-arrows');
  }, 30000);

  it('disables payment leg inputs during a credit sale', () => {
    renderDialog(makePos({
      paymentType: 'credit',
      paymentChannel: 'credit',
      cashAmount: 0,
      cardAmount: 0,
      transferAmount: 0,
    }));

    expect(screen.getByLabelText('نقدي')).toBeDisabled();
    expect(screen.getByLabelText('فيزا / كارت')).toBeDisabled();
    expect(screen.getByLabelText('محافظ / InstaPay')).toBeDisabled();
  }, 30000);

  it('shows credit customer warning at most once (no duplicate banners)', () => {
    renderDialog(makePos({
      paymentType: 'credit',
      paymentChannel: 'credit',
      customerId: '',
      cashAmount: 0,
      cardAmount: 0,
      transferAmount: 0,
      canSubmitSale: false,
      canSubmitHint: 'البيع الآجل يحتاج اختيار عميل.',
    }));

    expect(screen.getAllByText('البيع الآجل يحتاج اختيار عميل.')).toHaveLength(1);
  }, 30000);

  it('hides the express/detailed switcher on desktop viewports', () => {
    renderDialog(makePos({ orderType: 'takeaway' }));

    expect(screen.queryByRole('button', { name: 'دفع سريع' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'تفصيلي' })).toBeNull();
  }, 30000);

  it('stretches payment card to full height, anchors enlarged money KPI cards, and emphasizes invoice total', () => {
    renderDialog(makePos({
      orderType: 'takeaway',
      totals: { subTotal: 70.29, total: 70.29 },
      settings: { restaurantModuleEnabled: true },
      settingsQuery: { data: { restaurantModuleEnabled: true } },
    }));

    const paymentCard = document.body.querySelector('.pos-checkout-payment-card') as HTMLElement | null;
    const moneyCards = document.body.querySelector('.pos-checkout-money-cards') as HTMLElement | null;
    const customTipInput = document.body.querySelector('.pos-checkout-tip-custom-input') as HTMLInputElement | null;

    expect(paymentCard).not.toBeNull();
    expect(paymentCard?.style.height).toBe('100%');
    expect(moneyCards).not.toBeNull();
    expect(moneyCards?.style.marginTop).toBe('auto');
    expect(customTipInput).not.toBeNull();
    expect(customTipInput?.classList.contains('no-spin-arrows')).toBe(true);

    const kpiStrong = moneyCards?.querySelector('strong') as HTMLElement | null;
    expect(kpiStrong?.style.fontSize).toBe('19px');

    const totalLabel = screen.getByText('الإجمالي');
    const totalRow = totalLabel.parentElement as HTMLElement | null;
    expect(totalRow?.style.fontSize).toBe('17.5px');

    const totalsCard = document.body.querySelector('.pos-checkout-totals-card') as HTMLElement | null;
    const rightCol = document.body.querySelectorAll('.pos-checkout-col-pane')[0] as HTMLElement | null;
    expect(totalsCard).not.toBeNull();
    expect(totalsCard?.style.marginTop).toBe('auto');
    expect(rightCol?.lastElementChild).toBe(totalsCard);
  }, 30000);

  it('suppresses redundant customer-added success banner and stacks selected customer card cleanly on delivery', () => {
    renderDialog(makePos({
      orderType: 'delivery',
      customerId: '10',
      quickCustomerPhone: '01205004477',
      quickCustomerAddress: 'المعادي شارع 9',
      customersQuery: { data: [{ id: '10', name: 'كريم', phone: '01205004477', address: 'المعادي شارع 9' }] },
      submitMessage: 'تم إضافة العميل وتحديده داخل فاتورة الكاشير.',
      createSale: { isPending: false, isError: false },
      canShowLastSaleActions: false,
    }));

    expect(screen.queryByRole('alert')).toBeNull();
    const customerCard = document.body.querySelector('.pos-checkout-selected-customer-card') as HTMLElement | null;
    expect(customerCard).not.toBeNull();
    expect(screen.getByPlaceholderText('رقم الهاتف')).toHaveValue('01205004477');
    expect(screen.getByPlaceholderText('العنوان أو المكان')).toHaveValue('المعادي شارع 9');
  }, 30000);

  it('locks header, subslot, tip bar, and delivery summary dimensions when تحصيل عند التسليم toggles', () => {
    const { rerender } = renderDialog(makePos({
      orderType: 'delivery',
      collectionStatus: 'cod',
      cashAmount: 0,
      cardAmount: 0,
      transferAmount: 0,
      settings: { restaurantModuleEnabled: true },
      settingsQuery: { data: { restaurantModuleEnabled: true } },
    }));

    const codBadge = screen.getByText('تحصيل عند التسليم');
    const cardHeader = document.body.querySelector('.pos-checkout-payment-card-header') as HTMLElement;
    const subslot = document.body.querySelector('.pos-checkout-payment-subslot') as HTMLElement;
    const tipRow = document.body.querySelector('.pos-checkout-tip-row') as HTMLElement;
    const collectionSummary = screen.getByTestId('pos-collection-status-summary');
    const columns = document.body.querySelectorAll('.pos-checkout-col-pane');

    expect(columns).toHaveLength(2);
    expect(codBadge.style.height).toBe('22px');
    expect(cardHeader.style.height).toBe('26px');
    expect(cardHeader.style.minHeight).toBe('26px');
    expect(cardHeader.style.maxHeight).toBe('26px');
    expect(subslot.style.height).toBe('38px');
    expect(tipRow.style.height).toBe('36px');
    expect(collectionSummary.style.height).toBe('46px');

    rerender(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <PosCheckoutDialog
            open
            pos={makePos({
              orderType: 'delivery',
              collectionStatus: 'prepaid_by_rep',
              cashAmount: 150,
              paidAmount: 150,
              amountDue: 0,
              settings: { restaurantModuleEnabled: true },
              settingsQuery: { data: { restaurantModuleEnabled: true } },
            }) as any}
            selectedCustomerName="عميل نقدي"
            onClose={vi.fn()}
            onConfirmSale={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('تحصيل عند التسليم')).toBeNull();
    expect(cardHeader.style.height).toBe('26px');
    expect(subslot.style.height).toBe('38px');
    expect(tipRow.style.height).toBe('36px');
    expect(screen.getByTestId('pos-collection-status-summary').style.height).toBe('46px');
  }, 30000);
});
