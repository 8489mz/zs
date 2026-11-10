/* T10-A (INV-REST-COMBO-TOTALS-TRUTH): handleSubmit reports its
 * outcome as a boolean — true only when the sale posted, false on
 * every gate refusal and on any post failure (including the server
 * 422 SALE_TOTAL_MISMATCH). At base it returned void on every path:
 * its catch only set the submit message and every gate just returned,
 * so PosWorkspace's onConfirmSale closed the checkout dialog in
 * .then() unconditionally and a failed Confirm looked like a silent
 * success (F1 + F8). The dialog now closes only when this resolves
 * true. The cases below pin the contract: success, server refusal,
 * zero-price gate, underpaid gate (F8), and a pending sale. */
import { describe, expect, it, vi } from 'vitest';
import { createPosWorkspaceAsyncActions } from './createPosWorkspaceAsyncActions';
import type { PosWorkspaceActionParams } from '@/features/pos/hooks/usePosWorkspaceActionGroups';
import type { PosItem } from '@/features/pos/types/pos.types';

vi.mock('@/lib/http', () => ({
  http: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/app/providers', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock('@/features/storefront/api/storefront.api', () => ({
  storefrontApi: { updateOrderStatus: vi.fn() },
}));

vi.mock('@/lib/pos-printing/kitchen', () => ({
  printKitchenTicketAuto: vi.fn(),
  shouldAutoPrintKitchenTicket: vi.fn(() => false),
}));

vi.mock('@/features/pos/lib/pos-offline-sync', () => ({
  getPosTerminalCode: () => 'T1',
}));

const CART_LINE: PosItem = {
  lineKey: '1::base-1::retail',
  productId: '1',
  name: 'Burger',
  itemCode: '1',
  unitId: 'base-1',
  unitName: 'قطعة',
  unitMultiplier: 1,
  price: 99,
  costPrice: 50,
  qty: 1,
  stockLimit: 10,
  currentStock: 10,
  minStock: 0,
  priceType: 'retail',
};

function makeParams(overrides: Partial<PosWorkspaceActionParams> = {}): PosWorkspaceActionParams {
  return {
    cart: [CART_LINE],
    setCart: vi.fn(),
    selectedLineKey: '',
    setSelectedLineKey: vi.fn(),
    customerId: '',
    setCustomerId: vi.fn(),
    discount: 0,
    setDiscount: vi.fn(),
    discountApprovalGranted: false,
    setDiscountApprovalGranted: vi.fn(),
    discountApprovalSecret: '',
    setDiscountApprovalSecret: vi.fn(),
    wholesaleApprovalGranted: false,
    setWholesaleApprovalGranted: vi.fn(),
    wholesaleApprovalSecret: '',
    setWholesaleApprovalSecret: vi.fn(),
    cashAmount: 174,
    setCashAmount: vi.fn(),
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
    setBranchId: vi.fn(),
    locationId: '',
    setLocationId: vi.fn(),
    tableNumber: '',
    setTableNumber: vi.fn(),
    orderType: 'takeaway',
    setOrderType: vi.fn(),
    deliveryFeeMode: 'store_fleet',
    setDeliveryFeeMode: vi.fn(),
    deliveryRepId: '',
    setDeliveryRepId: vi.fn(),
    collectionStatus: 'cod',
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
    setLastAddedLineKey: vi.fn(),
    setRecentProductIds: vi.fn(),
    setLastSale: vi.fn(),
    postSaleSaleKey: '',
    setPostSaleSaleKey: vi.fn(),
    requestBarcodeFocus: vi.fn(),
    lastSale: null,
    products: [],
    branches: [],
    locations: [],
    currentBranch: null,
    currentLocation: null,
    settings: {},
    totals: { discountValue: 0, deliveryFee: 0, taxRate: 0, pricesIncludeTax: false, total: 174, serviceCharge: 0 },
    paidAmount: 174,
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
    createSale: { mutateAsync: vi.fn(), isPending: false },
    saveHeldDraftMutation: { mutateAsync: vi.fn() },
    deleteHeldDraftMutation: { mutateAsync: vi.fn() },
    clearHeldDraftsMutation: { mutateAsync: vi.fn() },
    discountAuthorizationMutation: { mutateAsync: vi.fn() },
    ...overrides,
  } as PosWorkspaceActionParams;
}

function makeActions(
  paramsOverrides: Partial<PosWorkspaceActionParams> = {},
  mutateImpl: (payload: unknown) => Promise<unknown> = () => Promise.resolve({ id: 7, docNo: 'INV-1' }),
) {
  const params = makeParams(paramsOverrides);
  const mutateAsync = vi.fn(mutateImpl);
  params.createSale = { mutateAsync, isPending: false };
  const base = { resetPosDraft: vi.fn() };
  const actions = createPosWorkspaceAsyncActions(params, base as never);
  return { actions, params, base, mutateAsync };
}

describe('createPosWorkspaceAsyncActions — handleSubmit reports its outcome (T10-A)', () => {
  it('returns true and posts with the displayed total when the sale succeeds', async () => {
    const { actions, params, base, mutateAsync } = makeActions();

    const result = await actions.handleSubmit({});

    expect(result).toBe(true);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ expectedTotal: 174 });
    expect(params.setLastSale).toHaveBeenCalledTimes(1);
    expect(base.resetPosDraft).toHaveBeenCalledTimes(1);
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('تم حفظ فاتورة البيع بنجاح'));
  });

  it('returns false and keeps the sale unposted when the server refuses (422 totals mismatch)', async () => {
    const serverError = new Error('إجمالي الفاتورة المعروض (99) لا يطابق الإجمالي المحسوب (174)');
    const { actions, params, base } = makeActions({}, () => Promise.reject(serverError));

    const result = await actions.handleSubmit({});

    expect(result).toBe(false);
    expect(params.setLastSale).not.toHaveBeenCalled();
    expect(base.resetPosDraft).not.toHaveBeenCalled();
    // The server's specific reason is surfaced, not a generic banner.
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('لا يطابق الإجمالي المحسوب'));
  });

  it('returns false without posting when a zero-price line blocks the submit', async () => {
    const { actions, params, mutateAsync } = makeActions({ hasZeroPriceLine: true });

    const result = await actions.handleSubmit({});

    expect(result).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('سعر صفر'));
  });

  it('returns false without posting when the payment is short (F8 underpaid gate)', async () => {
    const { actions, params, mutateAsync } = makeActions({ cashAmount: 0, paidAmount: 0 });

    const result = await actions.handleSubmit({});

    expect(result).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(params.setSubmitMessage).toHaveBeenCalledWith(expect.stringContaining('المبلغ المدفوع أقل من المطلوب'));
  });

  it('returns false without posting while a sale is already in flight', async () => {
    const params = makeParams();
    params.createSale = { mutateAsync: vi.fn(), isPending: true };
    const base = { resetPosDraft: vi.fn() };
    const actions = createPosWorkspaceAsyncActions(params, base as never);

    const result = await actions.handleSubmit({});

    expect(result).toBe(false);
    expect(params.createSale.mutateAsync).not.toHaveBeenCalled();
  });
});
