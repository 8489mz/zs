/*
 * R-B13 (INV-REST-PAID-DEFINITION): the POS workspace had three different
 * definitions of "paid" — the display (usePosWorkspace) summed cash + card
 * except on wallet/instapay where it summed cash + transfer; the submit gate
 * (createPosWorkspaceAsyncActions initialPaidAmount) saw transfer only on
 * wallet/instapay and cash + card otherwise; only the posted payload summed
 * all three legs. The gate's dropped cash leg was not academic: on a wallet
 * sale with cash 20 entered and transfer 0, the gate saw paid 0 and the
 * assume-full-transfer path settled the sale as a full transfer, posting
 * paid 120 (cash 20 + transfer 100) on a 100 total. The display's dropped
 * transfer leg likewise showed an amount due the submit path would not charge.
 *
 * The fix is one shared definition — paid = cash + card + transfer, always,
 * rounded once at book digits — in computePaidAmount, called by the display,
 * the gate and the payload.
 *
 * R4-D (INV-REST-PAID-GATES-2) supersedes the last paragraph of the old
 * note: the with-customer partial-credit flip is REMOVED — an underpaid
 * sale with a customer is now blocked in handleSubmit and must be
 * switched explicitly to the credit preset. The "posts as partial
 * credit" case below is updated to the block; the flip no longer exists
 * in either layer.
 */

import { describe, expect, it, vi } from 'vitest';
import { computePaidAmount, computeCashChange } from '@/features/pos/lib/pos-paid-amount';
import { createPosWorkspaceAsyncActions } from '@/features/pos/hooks/pos-workspace-actions/createPosWorkspaceAsyncActions';
import { createPosWorkspaceBaseActions } from '@/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions';
import type { PosWorkspaceActionParams } from '@/features/pos/hooks/usePosWorkspaceActionGroups';
import type { PosItem } from '@/features/pos/types/pos.types';

vi.mock('@/lib/http', () => ({
  http: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/app/providers', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock('@/lib/api/catalog', () => ({
  catalogApi: { listCustomers: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/features/storefront/api/storefront.api', () => ({
  storefrontApi: { updateOrderStatus: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/features/pos/components/pos-workspace/posWorkspace.helpers', () => ({
  getPostSalePrintHint: () => 'hint',
  getPostSalePrintMode: () => 'a4',
}));

describe('computePaidAmount (INV-REST-PAID-DEFINITION)', () => {
  it('pins the reported case: wallet sale, cash 20 + transfer 80 = paid 100', () => {
    expect(computePaidAmount({ cashAmount: 20, cardAmount: 0, transferAmount: 80 }, 2)).toBe(100);
  });

  it('counts every leg: cash 20 + card 30 + transfer 50 = paid 100', () => {
    expect(computePaidAmount({ cashAmount: 20, cardAmount: 30, transferAmount: 50 }, 2)).toBe(100);
  });

  it('counts a card-only payment in full', () => {
    expect(computePaidAmount({ cashAmount: 0, cardAmount: 100, transferAmount: 0 }, 2)).toBe(100);
  });

  it('is zero when no leg is entered', () => {
    expect(computePaidAmount({ cashAmount: 0, cardAmount: 0, transferAmount: 0 }, 2)).toBe(0);
    expect(computePaidAmount({}, 2)).toBe(0);
  });

  it('does not depend on the payment channel: the same legs give the same paid for every channel', () => {
    // The helper deliberately takes no channel: display, gate and payload
    // must agree, so a wallet sale, a card sale and a mixed sale with the
    // same legs all see the same paid amount.
    const legs = { cashAmount: 20, cardAmount: 30, transferAmount: 50 };
    for (const _channel of ['cash', 'card', 'wallet', 'instapay', 'mixed'] as const) {
      expect(computePaidAmount(legs, 2)).toBe(100);
    }
  });

  it('sees the cash leg on a wallet sale: cash 20 + transfer 0 = paid 20, not 0', () => {
    // The old gate saw transfer only for wallet/instapay and therefore saw
    // 0 here, which triggered the assume-full-transfer path.
    expect(computePaidAmount({ cashAmount: 20, cardAmount: 0, transferAmount: 0 }, 2)).toBe(20);
  });

  it('sees the transfer leg on a cash/card sale: cash 20 + transfer 80 = paid 100, not 20', () => {
    // The old display dropped the transfer leg unless the channel was
    // wallet/instapay, so it showed an amount due of 80 on a fully paid sale.
    expect(computePaidAmount({ cashAmount: 20, cardAmount: 0, transferAmount: 80 }, 2)).toBe(100);
  });

  it('rounds once at the tenant book digits', () => {
    expect(computePaidAmount({ cashAmount: 0.115 }, 2)).toBe(0.12);
    expect(computePaidAmount({ cashAmount: 10.001, transferAmount: 0.0004 }, 3)).toBe(10.001);
  });

  it('treats missing legs as zero', () => {
    expect(computePaidAmount({ cashAmount: null, cardAmount: undefined, transferAmount: 5 }, 2)).toBe(5);
  });
});

/*
 * R4-D, I45 (INV-REST-PAID-GATES-2): change is cash-only. A card (or
 * wallet) leg can never produce change — the money never passed through
 * the drawer — so change is the cash leg minus the part of the total the
 * non-cash legs did not cover. At base the display summed every leg, so
 * card 120 on a 100 total showed 20 change for cash never received.
 */
describe('computeCashChange (INV-REST-PAID-GATES-2, I45)', () => {
  it('pins the reported case: card 120 on a 100 total yields change 0, not 20', () => {
    expect(computeCashChange({ cashAmount: 0, cardAmount: 120 }, 100, 2)).toBe(0);
  });

  it('cash 120 on a 100 total yields change 20', () => {
    expect(computeCashChange({ cashAmount: 120 }, 100, 2)).toBe(20);
  });

  it('cash 50 + card 60 on a 100 total yields change 10 (cash covers the 40 the card did not)', () => {
    expect(computeCashChange({ cashAmount: 50, cardAmount: 60 }, 100, 2)).toBe(10);
  });

  it('transfer-only overpay yields change 0', () => {
    expect(computeCashChange({ cashAmount: 0, transferAmount: 150 }, 100, 2)).toBe(0);
  });

  it('cash below the uncovered part yields change 0, never negative', () => {
    expect(computeCashChange({ cashAmount: 10, cardAmount: 60 }, 100, 2)).toBe(0);
  });

  it('rounds once at the tenant book digits', () => {
    // 100.115 is not used: in binary float it is 0.11499… below the
    // half-cent, so it rounds to 0.11 — the rounding is correct, the
    // test value was not.
    expect(computeCashChange({ cashAmount: 100.12, cardAmount: 0 }, 100, 2)).toBe(0.12);
    expect(computeCashChange({ cashAmount: 100.001, cardAmount: 0 }, 100, 3)).toBe(0.001);
  });
});

const cartItem: PosItem = {
  lineKey: 'p1::u1::retail',
  productId: 'p1',
  name: 'Tea',
  itemCode: 'p1',
  unitId: 'u1',
  unitName: 'قطعة',
  unitMultiplier: 1,
  price: 100,
  costPrice: 5,
  qty: 1,
  stockLimit: 10,
  currentStock: 10,
  minStock: 0,
  priceType: 'retail',
};

function makeSubmitParams(overrides: Partial<PosWorkspaceActionParams> = {}) {
  // INV-REST-PAID-GATES-2 (R4-D, I27): the harness defaults the
  // derived submit gate to open, so the cases below pin handleSubmit's
  // own downstream checks (the unified paid, the terminal pin, the
  // negative-leg rejection). The derived gate itself is covered by
  // the R4-D describe block at the end of this file, which passes
  // canSubmitSale: false + the hint.
  const params = {
    cart: [cartItem],
    setCart: vi.fn(),
    selectedLineKey: '',
    setSelectedLineKey: vi.fn(),
    customerId: '',
    setCustomerId: vi.fn(),
    discount: 0,
    setDiscount: vi.fn(),
    tipAmount: 0,
    setTipAmount: vi.fn(),
    loyaltyPointsRedeemed: 0,
    setLoyaltyPointsRedeemed: vi.fn(),
    deliveryFee: 0,
    setDeliveryFee: vi.fn(),
    discountApprovalGranted: false,
    setDiscountApprovalGranted: vi.fn(),
    discountApprovalSecret: '',
    setDiscountApprovalSecret: vi.fn(),
    wholesaleApprovalGranted: false,
    setWholesaleApprovalGranted: vi.fn(),
    wholesaleApprovalSecret: '',
    setWholesaleApprovalSecret: vi.fn(),
    cashAmount: 0,
    setCashAmount: vi.fn(),
    tenderedAmount: 0,
    setTenderedAmount: vi.fn(),
    cardAmount: 0,
    setCardAmount: vi.fn(),
    transferAmount: 0,
    setTransferAmount: vi.fn(),
    paymentType: 'cash',
    setPaymentType: vi.fn(),
    paymentChannel: 'cash',
    setPaymentChannel: vi.fn(),
    note: '',
    setNote: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    priceType: 'retail',
    setPriceType: vi.fn(),
    branchId: '',
    locationId: '',
    tableNumber: '',
    setTableNumber: vi.fn(),
    pagerNumber: '',
    setPagerNumber: vi.fn(),
    diningCourse: '',
    setDiningCourse: vi.fn(),
    guestCount: 1,
    setGuestCount: vi.fn(),
    guestCheckPrintedAt: null,
    setGuestCheckPrintedAt: vi.fn(),
    orderType: 'dine_in',
    setOrderType: vi.fn(),
    deliveryFeeMode: 'freelance_courier',
    setDeliveryFeeMode: vi.fn(),
    deliveryRepId: '',
    setDeliveryRepId: vi.fn(),
    collectionStatus: '',
    setCollectionStatus: vi.fn(),
    quickAddCode: '',
    setQuickAddCode: vi.fn(),
    quickCustomerName: '',
    setQuickCustomerName: vi.fn(),
    quickCustomerPhone: '',
    setQuickCustomerPhone: vi.fn(),
    quickCustomerAddress: '',
    setQuickCustomerAddress: vi.fn(),
    scannerMessage: '',
    setScannerMessage: vi.fn(),
    setSubmitMessage: vi.fn(),
    lastAddedLineKey: '',
    setLastAddedLineKey: vi.fn(),
    setRecentProductIds: vi.fn(),
    setLastSale: vi.fn(),
    postSaleSaleKey: '',
    setPostSaleSaleKey: vi.fn(),
    terminalPaymentDetails: null,
    setTerminalPaymentDetails: vi.fn(),
    requestBarcodeFocus: vi.fn(),
    lastSale: null,
    products: [],
    branches: [],
    locations: [],
    currentBranch: null,
    currentLocation: null,
    settings: { allowNegativeStockSales: true },
    totals: {
      discountValue: 0,
      deliveryFee: 0,
      taxRate: 0,
      pricesIncludeTax: false,
      total: 100,
      serviceCharge: 0,
      serviceChargePercent: 0,
      subTotal: 100,
    },
    paidAmount: 0,
    hasOperationalSetup: true,
    hasCatalogReady: true,
    requiresCashierShift: false,
    ownOpenShift: null,
    hasCreditWithoutCustomer: false,
    hasZeroPriceLine: false,
    hasUnderpaidSale: false,
    canSubmitSale: true,
    canSubmitHint: '',
    heldDrafts: [],
    quickCustomerMutation: { mutateAsync: vi.fn() },
    createSale: { mutateAsync: vi.fn().mockResolvedValue({ id: 1, docNo: 'S-1' }), isPending: false },
    saveHeldDraftMutation: { mutateAsync: vi.fn() },
    deleteHeldDraftMutation: { mutateAsync: vi.fn() },
    clearHeldDraftsMutation: { mutateAsync: vi.fn() },
    discountAuthorizationMutation: { mutateAsync: vi.fn() },
    ...overrides,
  } as unknown as PosWorkspaceActionParams;
  return params;
}

describe('handleSubmit gate uses the same paid as the display (R-B13)', () => {
  it('wallet sale, cash 20 + transfer 0 on a 100 total, no customer: blocked as underpaid, not settled as a full transfer', async () => {
    // At base the gate saw paid 0 (transfer only) and the assume-full
    // transfer path posted paid 120 (cash 20 + transfer 100) on a 100
    // total. With the unified definition the gate sees paid 20, so the
    // sale is underpaid and must not post.
    const params = makeSubmitParams({
      paymentChannel: 'wallet',
      cashAmount: 20,
      cardAmount: 0,
      transferAmount: 0,
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('أقل من المطلوب'));
  });

  it('wallet sale, cash 20 + transfer 0 on a 100 total, with a customer: BLOCKED as underpaid — the partial-credit flip is gone (R4-D, I28)', async () => {
    // INV-REST-PAID-GATES-2 (R4-D, I28, D-R4D-1): the silent flip is
    // removed. The cashier completes the payment or switches
    // explicitly to the credit preset and re-confirms; the sale must
    // NOT post as credit on its own.
    const params = makeSubmitParams({
      paymentChannel: 'wallet',
      cashAmount: 20,
      cardAmount: 0,
      transferAmount: 0,
      customerId: 'c1',
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('أقل من الإجمالي'));
  });

  it('reported case, wallet sale, cash 20 + transfer 80 on a 100 total: posts fully paid, never as credit', async () => {
    // Gate paid is 100 (same value as the display), so there is no
    // underpaid block and no credit flip.
    const params = makeSubmitParams({
      paymentChannel: 'wallet',
      cashAmount: 20,
      cardAmount: 0,
      transferAmount: 80,
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).toHaveBeenCalledTimes(1);
    const payload = (params.createSale.mutateAsync as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.paymentType).toBe('cash');
    expect(payload.paidAmount).toBe(100);
    expect(payload.payments).toEqual([
      { paymentChannel: 'cash', amount: 20 },
      { paymentChannel: 'wallet', amount: 80 },
    ]);
  });
});

/*
 * R4-D (INV-REST-PAID-GATES-2): handleSubmit's own gates — the derived
 * submit gate (I27), the negative-leg rejection (I39), and the
 * terminal-approved-amount pin (I40). At base every case here posted
 * (the gate was never passed in, negative legs were dropped silently,
 * and no approved amount was stored anywhere).
 */
describe('handleSubmit paid gates (INV-REST-PAID-GATES-2, R4-D)', () => {
  it('I27: a closed derived gate blocks the submit with the hint message', async () => {
    const params = makeSubmitParams({
      canSubmitSale: false,
      canSubmitHint: 'الخصم يتطلب اعتماد المدير (PIN).',
      paymentChannel: 'cash',
      cashAmount: 100,
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith('الخصم يتطلب اعتماد المدير (PIN).');
  });

  it('I27: a closed gate for a dine-in sale without a table blocks with the table hint', async () => {
    const params = makeSubmitParams({
      canSubmitSale: false,
      canSubmitHint: 'اختر طاولة أولًا لطلبات الصالة.',
      paymentChannel: 'cash',
      cashAmount: 100,
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith('اختر طاولة أولًا لطلبات الصالة.');
  });

  it('I39: a negative card leg is rejected before the > 0 filter can drop it', async () => {
    const params = makeSubmitParams({
      paymentChannel: 'card',
      cashAmount: 0,
      cardAmount: -50,
      transferAmount: 0,
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('سالبة'));
  });

  it('I40: a card leg above the terminal-approved amount is rejected (approved 90, leg 100)', async () => {
    // The leg covers the total, so the underpaid check does not fire
    // first — the pin is the reason for the block.
    const params = makeSubmitParams({
      paymentChannel: 'card',
      cashAmount: 0,
      cardAmount: 100,
      transferAmount: 0,
      terminalPaymentDetails: { authCode: 'AUTH-1', approvedAmount: 90 },
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('المعتمد'));
  });

  it('I40: a card leg equal to the terminal-approved amount posts, and the approved amount is sent', async () => {
    const params = makeSubmitParams({
      paymentChannel: 'card',
      cashAmount: 0,
      cardAmount: 100,
      transferAmount: 0,
      terminalPaymentDetails: { authCode: 'AUTH-1', approvedAmount: 100 },
    });
    const base = createPosWorkspaceBaseActions(params);
    const actions = createPosWorkspaceAsyncActions(params, base);

    await actions.handleSubmit();

    expect(params.createSale.mutateAsync).toHaveBeenCalledTimes(1);
    const payload = (params.createSale.mutateAsync as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.terminalApprovedAmount).toBe(100);
    expect(payload.terminalAuthCode).toBe('AUTH-1');
  });
});
