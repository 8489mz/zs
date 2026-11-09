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
 * the gate and the payload. The with-customer partial-credit flip is
 * unchanged by design: it now fires only when that unified paid is truly
 * below the total.
 */

import { describe, expect, it, vi } from 'vitest';
import { computePaidAmount } from '@/features/pos/lib/pos-paid-amount';
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

  it('wallet sale, cash 20 + transfer 0 on a 100 total, with a customer: posts as partial credit for the unified paid 20', async () => {
    // The partial-credit flip stays as designed, but it now fires on the
    // unified paid (20 < 100) instead of the gate inventing a full payment.
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

    expect(params.createSale.mutateAsync).toHaveBeenCalledTimes(1);
    const payload = (params.createSale.mutateAsync as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.paymentType).toBe('credit');
    expect(payload.paidAmount).toBe(20);
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
