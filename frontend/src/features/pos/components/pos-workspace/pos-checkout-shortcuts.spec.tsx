import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createTestQueryClient } from '@/test/test-query-client';
import { PosCheckoutDialog } from './PosCheckoutDialog';
import {
  getCheckoutPaymentActions,
  getCheckoutPaymentRegion,
  parseCheckoutAltDigit,
  resolveCheckoutActionForSlot,
  resolvePresetForCheckoutAction,
} from './pos-checkout-shortcuts';

vi.mock('@/shared/api/delivery-reps.api', () => ({
  deliveryRepsApi: { list: vi.fn().mockResolvedValue([]) },
}));

const uiCustomState = vi.hoisted(() => ({
  checkoutMode: 'detailed' as 'detailed' | 'express',
  defaultPaymentChannel: 'cash',
}));

vi.mock('@/features/pos/hooks/usePosUiCustomization', () => ({
  usePosUiCustomization: () => ({
    customization: uiCustomState,
  }),
}));

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
    paidAmount: 150,
    amountDue: 0,
    changeAmount: 0,
    cashAmount: 150,
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

function renderCheckout(pos: unknown) {
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

describe('POS checkout Alt+1..5 payment shortcuts & focus isolation', () => {
  beforeEach(() => {
    uiCustomState.checkoutMode = 'detailed';
    uiCustomState.defaultPaymentChannel = 'cash';
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('parses Alt+1..5 across physical key codes and Arabic numerals while ignoring plain digits', () => {
    expect(parseCheckoutAltDigit({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit1', key: '1' })).toBeNull();
    expect(parseCheckoutAltDigit({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: false, code: 'Digit1', key: '1' })).toBeNull();
    expect(parseCheckoutAltDigit({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: true, code: 'Digit2', key: '2' })).toBeNull();
    expect(parseCheckoutAltDigit({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit2', key: '٢' })).toBe(2);
    expect(parseCheckoutAltDigit({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Numpad4', key: '4' })).toBe(4);
    expect(parseCheckoutAltDigit({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: '', key: '٥' })).toBe(5);
    expect(parseCheckoutAltDigit({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'Digit6', key: '6' })).toBeNull();
  });

  it('maps Kuwait and KSA 5-slot regional payment layouts symmetrically', () => {
    const kwdActions = getCheckoutPaymentActions(getCheckoutPaymentRegion(true, false));
    expect(kwdActions.map((a) => `${a.shortcutLabel}:${a.kind}:${a.cardScheme || ''}`)).toEqual([
      'Alt+1:cash:',
      'Alt+2:card:knet',
      'Alt+3:card:visa',
      'Alt+4:credit:',
      'Alt+5:transfer:',
    ]);

    const ksaActions = getCheckoutPaymentActions(getCheckoutPaymentRegion(false, true));
    expect(ksaActions.map((a) => `${a.shortcutLabel}:${a.kind}:${a.cardScheme || ''}`)).toEqual([
      'Alt+1:cash:',
      'Alt+2:card:mada',
      'Alt+3:card:visa',
      'Alt+4:credit:',
      'Alt+5:transfer:',
    ]);

    const uniTransfer = resolveCheckoutActionForSlot('universal', 3)!;
    expect(resolvePresetForCheckoutAction(uniTransfer, 'cash', 'universal')).toBe('instapay');
    expect(resolvePresetForCheckoutAction(uniTransfer, 'wallet', 'universal')).toBe('wallet');
  });

  it('switches payment methods on Alt+1..4 without stealing cash numeric typing and preserves exact accessible button names', async () => {
    const setPaymentPreset = vi.fn();
    const setTerminalPaymentDetails = vi.fn();
    renderCheckout(makePos({ setPaymentPreset, setTerminalPaymentDetails }));

    // Existing exact accessible names remain intact for screen readers and queries.
    const cashBtn = screen.getByRole('button', { name: 'نقدي' });
    const cardBtn = screen.getByRole('button', { name: 'فيزا / كارت' });
    expect(cashBtn.getAttribute('aria-keyshortcuts')).toBe('Alt+1');
    expect(cardBtn.getAttribute('aria-keyshortcuts')).toBe('Alt+2');

    // Initial open focuses the cash amount input, NOT background search.
    const cashInput = screen.getByLabelText('نقدي') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(cashInput));

    // Plain digits inside cash input do NOT switch payment presets.
    fireEvent.keyDown(cashInput, { key: '2', code: 'Digit2' });
    fireEvent.keyDown(cashInput, { key: '3', code: 'Digit3' });
    expect(setPaymentPreset).not.toHaveBeenCalled();

    // Alt+2 selects card and moves focus inside dialog to card input.
    fireEvent.keyDown(cashInput, { key: '2', code: 'Digit2', altKey: true });
    expect(setPaymentPreset).toHaveBeenLastCalledWith('card');
    expect(setTerminalPaymentDetails).toHaveBeenLastCalledWith({ cardScheme: 'visa' });
    const cardInput = screen.getByLabelText('فيزا / كارت') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(cardInput));

    // Alt+3 (even with Arabic key symbol) selects transfers and moves focus to transfer input.
    fireEvent.keyDown(cardInput, { key: '٣', code: 'Digit3', altKey: true });
    expect(setPaymentPreset).toHaveBeenLastCalledWith('instapay');
    expect(setTerminalPaymentDetails).toHaveBeenLastCalledWith(null);
    const transferInput = document.getElementById('pos-checkout-transfer-input') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(transferInput));

    // Alt+4 selects credit.
    fireEvent.keyDown(transferInput, { key: '4', code: 'Digit4', altKey: true });
    expect(setPaymentPreset).toHaveBeenLastCalledWith('credit');

    // Alt+1 switches back to cash and focuses cash input again.
    fireEvent.keyDown(window, { key: '1', code: 'Digit1', altKey: true });
    expect(setPaymentPreset).toHaveBeenLastCalledWith('cash');
    await waitFor(() => expect(document.activeElement).toBe(cashInput));
  }, 30000);

  it('refuses Alt+1..5 payment switching when terminal authorization is live', () => {
    const setPaymentPreset = vi.fn();
    renderCheckout(makePos({
      setPaymentPreset,
      cashAmount: 0,
      cardAmount: 150,
      paymentChannel: 'card',
      terminalPaymentDetails: { authCode: 'AUTH-99', approvedAmount: 150, cardScheme: 'visa' },
    }));

    fireEvent.keyDown(window, { key: '1', code: 'Digit1', altKey: true });
    expect(setPaymentPreset).not.toHaveBeenCalled();
  }, 30000);

  it('supports Alt+1 (cash) and Alt+2 (card) shortcuts in Express mode', async () => {
    uiCustomState.checkoutMode = 'express';
    const setPaymentPreset = vi.fn();
    renderCheckout(makePos({ setPaymentPreset }));

    fireEvent.keyDown(window, { key: '2', code: 'Digit2', altKey: true });
    await waitFor(() => expect(setPaymentPreset).toHaveBeenCalledWith('card'));

    fireEvent.keyDown(window, { key: '1', code: 'Digit1', altKey: true });
    expect(setPaymentPreset).toHaveBeenLastCalledWith('cash');
  }, 30000);
});
