import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createPosWorkspaceBaseActions } from '@/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions';
import { usePosWorkspaceEffects } from '@/features/pos/hooks/usePosWorkspaceEffects';
import { applyPosOrderTypeChange } from '@/features/pos/hooks/usePosWorkspace';
import { buildDraftState, clearDraftSnapshot, loadPosWorkspaceStorage, persistDraftSnapshot } from '@/features/pos/lib/pos.persistence';
import type { PosWorkspaceActionParams } from '@/features/pos/hooks/usePosWorkspaceActionGroups';
import type { PosItem } from '@/features/pos/types/pos.types';
import type { Product } from '@/types/domain';

vi.mock('@/lib/http', () => ({
  http: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

const product: Product = {
  id: 'p1',
  name: 'Tea',
  categoryId: '',
  supplierId: '',
  costPrice: 5,
  retailPrice: 10,
  wholesalePrice: 8,
  stock: 10,
  minStock: 0,
  notes: '',
  barcode: '123',
  units: [{ id: 'u1', name: 'قطعة', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
};

function makeParams(overrides: Partial<PosWorkspaceActionParams> = {}): PosWorkspaceActionParams {
  return {
    cart: [],
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
    deliveryRepId: '',
    setDeliveryRepId: vi.fn(),
    collectionStatus: '',
    setCollectionStatus: vi.fn(),
    discountApprovalGranted: false,
    setDiscountApprovalGranted: vi.fn(),
    discountApprovalSecret: '',
    setDiscountApprovalSecret: vi.fn(),
    cashAmount: 0,
    setCashAmount: vi.fn(),
    cardAmount: 0,
    setCardAmount: vi.fn(),
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
    quickAddCode: '',
    setQuickAddCode: vi.fn(),
    quickCustomerName: '',
    setQuickCustomerName: vi.fn(),
    quickCustomerPhone: '',
    setQuickCustomerPhone: vi.fn(),
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
    products: [product],
    branches: [],
    locations: [],
    currentBranch: null,
    currentLocation: null,
    settings: {},
    totals: { discountValue: 0, taxRate: 0, pricesIncludeTax: false, total: 0 },
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
    createSale: { mutateAsync: vi.fn() },
    saveHeldDraftMutation: { mutateAsync: vi.fn() },
    deleteHeldDraftMutation: { mutateAsync: vi.fn() },
    clearHeldDraftsMutation: { mutateAsync: vi.fn() },
    discountAuthorizationMutation: { mutateAsync: vi.fn() },
    ...overrides,
  } as PosWorkspaceActionParams;
}

/* A setCart mock that installs updates against the LIVE cart. It
 * executes the updater synchronously — which is NOT React's timing
 * (React queues a functional updater and runs it at re-render, never
 * inside the setState call), only its value semantics. It is valid
 * for asserting what an updater RETURNS against the live cart
 * (handleAddProduct's stock check), and NEVER for asserting a
 * synchronous side effect after setCart: T14-A's zeroing passed
 * under this mock while never firing live (Trial 8), because the
 * flag it read was assigned inside the updater. Tests of the
 * empty-cart reaction use the empty-cart effect (T15-A) or a plain
 * non-executing vi.fn() setCart (production semantics). */
describe('createPosWorkspaceBaseActions', () => {
  it('adds products against the latest cart state instead of reintroducing stale deleted lines', () => {
    const staleDeletedCart: PosItem[] = [{
      lineKey: 'old::u1::retail',
      productId: 'old',
      name: 'Old',
      itemCode: 'old',
      unitId: 'u1',
      unitName: 'قطعة',
      unitMultiplier: 1,
      price: 4,
      costPrice: 2,
      qty: 1,
      stockLimit: 10,
      currentStock: 10,
      minStock: 0,
      priceType: 'retail',
    }];
    const currentCart: PosItem[] = [];
    const setCart = vi.fn((updater: PosItem[] | ((cart: PosItem[]) => PosItem[])) => (
      typeof updater === 'function' ? updater(currentCart) : updater
    ));

    createPosWorkspaceBaseActions(makeParams({ cart: staleDeletedCart, setCart })).handleAddProduct(product);

    expect(setCart).toHaveBeenCalledWith(expect.any(Function));
    expect(setCart.mock.results[0]?.value.map((item: PosItem) => item.productId)).toEqual(['p1']);
  });

  describe('quantity chunks', () => {
    it('removes the last chunk and then removes the item entirely when the last chunk is removed', () => {
      const weightedItem: PosItem = {
        lineKey: 'p1::u1::retail',
        productId: 'p1',
        name: 'Tea',
        unitId: 'u1',
        unitName: 'كجم',
        unitMultiplier: 1,
        price: 10,
        costPrice: 5,
        qty: 0.385,
        stockLimit: 10,
        currentStock: 10,
        minStock: 0,
        priceType: 'retail',
        isWeighted: true,
        quantityChunks: [0.135, 0.250],
      };
      
      const setCart = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({ cart: [weightedItem], setCart }));
      
      // First decrement removes 0.250, leaving 0.135
      actions.changeLineQtyByDelta('p1::u1::retail', -1);
      const updatedCart1 = setCart.mock.calls[0][0];
      expect(updatedCart1[0].qty).toBe(0.135);
      expect(updatedCart1[0].quantityChunks).toEqual([0.135]);
      
      // Second decrement removes 0.135, leaving empty array -> line should be removed
      const actions2 = createPosWorkspaceBaseActions(makeParams({ cart: updatedCart1, setCart }));
      actions2.changeLineQtyByDelta('p1::u1::retail', -1);
      
      // Inside changeLineQtyByDelta, removeItem calls setCart via a function, so we simulate it
      const updatedCart2Fn = setCart.mock.calls[1][0];
      const updatedCart2 = updatedCart2Fn(updatedCart1);
      expect(updatedCart2.length).toBe(0); // Line removed completely
    });

    it('repeats the last chunk when incrementing a weighted barcode item', () => {
      const weightedItem: PosItem = {
        lineKey: 'p1::u1::retail',
        productId: 'p1',
        name: 'Tea',
        unitId: 'u1',
        unitName: 'كجم',
        unitMultiplier: 1,
        price: 10,
        costPrice: 5,
        qty: 0.135,
        stockLimit: 10,
        currentStock: 10,
        minStock: 0,
        priceType: 'retail',
        isWeighted: true,
        quantityChunks: [0.135],
      };
      
      const setCart = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({ cart: [weightedItem], setCart }));
      
      actions.changeLineQtyByDelta('p1::u1::retail', 1);
      const updatedCart = setCart.mock.calls[0][0];
      expect(updatedCart[0].qty).toBe(0.270);
      expect(updatedCart[0].quantityChunks).toEqual([0.135, 0.135]);
    });

    it('rejects increment if stock limit is exceeded', () => {
      const weightedItem: PosItem = {
        lineKey: 'p1::u1::retail',
        productId: 'p1',
        name: 'Tea',
        unitId: 'u1',
        unitName: 'كجم',
        unitMultiplier: 1,
        price: 10,
        costPrice: 5,
        qty: 0.135,
        stockLimit: 0.200, // limited stock!
        currentStock: 0.200,
        minStock: 0,
        priceType: 'retail',
        isWeighted: true,
        quantityChunks: [0.135],
      };
      
      const setSubmitMessage = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({ cart: [weightedItem], setSubmitMessage }));
      
      const result = actions.changeLineQtyByDelta('p1::u1::retail', 1);
      expect(result).toBe(false);
      expect(setSubmitMessage).toHaveBeenCalledWith('الكمية المطلوبة أكبر من المخزون المتاح.');
    });

    it('uses a step of 0.001 for manual weighted items (isWeighted = true but no chunks)', () => {
      const manualWeightedItem: PosItem = {
        lineKey: 'p1::u1::retail',
        productId: 'p1',
        name: 'Tea',
        unitId: 'u1',
        unitName: 'كجم',
        unitMultiplier: 1,
        price: 10,
        costPrice: 5,
        qty: 0.270,
        stockLimit: 10,
        currentStock: 10,
        minStock: 0,
        priceType: 'retail',
        isWeighted: true, // marked as weighted but no chunks
      };
      
      const setCart = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({ cart: [manualWeightedItem], setCart }));
      
      actions.changeLineQtyByDelta('p1::u1::retail', 1);
      const updatedCart = setCart.mock.calls[0][0];
      expect(updatedCart[0].qty).toBe(0.271);
      
      actions.changeLineQtyByDelta('p1::u1::retail', -1);
      const updatedCart2 = setCart.mock.calls[1][0];
      expect(updatedCart2[0].qty).toBe(0.269);
    });

    it('clears quantityChunks when the user manually sets a different quantity', () => {
      const weightedItem: PosItem = {
        lineKey: 'p1::u1::retail',
        productId: 'p1',
        name: 'Tea',
        unitId: 'u1',
        unitName: 'كجم',
        unitMultiplier: 1,
        price: 10,
        costPrice: 5,
        qty: 0.270,
        stockLimit: 10,
        currentStock: 10,
        minStock: 0,
        priceType: 'retail',
        isWeighted: true,
        quantityChunks: [0.135, 0.135],
      };
      
      const setCart = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({ cart: [weightedItem], setCart, selectedLineKey: 'p1::u1::retail' }));
      
      // Mock window.prompt
      vi.stubGlobal('prompt', () => '0.200');
      
      actions.editSelectedQty();
      
      const updatedCart = setCart.mock.calls[0][0];
      expect(updatedCart[0].qty).toBe(0.200);
      expect(updatedCart[0].quantityChunks).toBeUndefined(); // Cleared because the user manually edited it
      
      vi.unstubAllGlobals();
    });

    it('works correctly for normal (unweighted) items using steps of 1', () => {
      const normalItem: PosItem = {
        lineKey: 'p1::u1::retail',
        productId: 'p1',
        name: 'Tea',
        unitId: 'u1',
        unitName: 'قطعة',
        unitMultiplier: 1,
        price: 10,
        costPrice: 5,
        qty: 1,
        stockLimit: 10,
        currentStock: 10,
        minStock: 0,
        priceType: 'retail',
        isWeighted: false,
      };
      
      const setCart = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({ cart: [normalItem], setCart }));
      
      actions.changeLineQtyByDelta('p1::u1::retail', 1);
      const updatedCart = setCart.mock.calls[0][0];
      expect(updatedCart[0].qty).toBe(2);
      
      actions.changeLineQtyByDelta('p1::u1::retail', -1);
      // changeLineQtyByDelta for normal items with qty=1 and delta=-1 results in nextQty <= 0, which calls removeItem.
      // removeItem calls setCart with a functional updater.
      const updater = setCart.mock.calls[1][0];
      const updatedCart2 = typeof updater === 'function' ? updater([updatedCart[0]]) : updater;
      expect(updatedCart2.length).toBe(0);
    });
  });

  describe('setPaymentPreset', () => {
    it('preserves cash and transfer distribution when switching between wallet and instapay', () => {
      const setPaymentChannel = vi.fn();
      const setCashAmount = vi.fn();
      const setTransferAmount = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        totals: { discountValue: 0, deliveryFee: 0, taxRate: 0, pricesIncludeTax: false, total: 200 },
        paymentChannel: 'instapay',
        cashAmount: 100,
        transferAmount: 50,
        setPaymentChannel,
        setCashAmount,
        setTransferAmount,
      }));

      actions.setPaymentPreset('wallet');

      expect(setPaymentChannel).toHaveBeenCalledWith('wallet');
      expect(setCashAmount).not.toHaveBeenCalled();
      expect(setTransferAmount).not.toHaveBeenCalled();
    });

    it('sets full transfer amount for a fresh single-channel payment', () => {
      const setPaymentChannel = vi.fn();
      const setCashAmount = vi.fn();
      const setTransferAmount = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        totals: { discountValue: 0, deliveryFee: 0, taxRate: 0, pricesIncludeTax: false, total: 200 },
        paymentChannel: 'cash',
        cashAmount: 0,
        transferAmount: 0,
        setPaymentChannel,
        setCashAmount,
        setTransferAmount,
      }));

      actions.setPaymentPreset('instapay');

      expect(setPaymentChannel).toHaveBeenCalledWith('instapay');
      expect(setCashAmount).toHaveBeenCalledWith(0);
      expect(setTransferAmount).toHaveBeenCalledWith(200);
    });

    it('preserves existing cash split and auto-fills remaining balance into transfer', () => {
      const setPaymentChannel = vi.fn();
      const setTransferAmount = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        totals: { discountValue: 0, deliveryFee: 0, taxRate: 0, pricesIncludeTax: false, total: 200 },
        paymentChannel: 'cash',
        cashAmount: 120,
        transferAmount: 0,
        setPaymentChannel,
        setTransferAmount,
      }));

      actions.setPaymentPreset('wallet');

      expect(setPaymentChannel).toHaveBeenCalledWith('wallet');
      expect(setTransferAmount).toHaveBeenCalledWith(80);
    });
  });

  /* T15-A (INV-REST-TRASH-DELETE-EXTRAS-TRUTH, K1): the T11-A /
 * T13-N2 / T14-A describes that used to live here asserted that
 * removeItem itself zeroes the extras, clears the banner and resets
 * createSale — under liveCartSetCart, which executes the updater
 * synchronously. That is not production semantics: React runs the
 * updater at re-render, never inside setState, so the flag T14-A
 * read was still false at the check and the branch never fired
 * live (Trial 8: trash-delete left an empty cart at 25.00). The
 * reaction moved to the empty-cart effect in
 * usePosWorkspaceEffects; removeItem only removes the line. The
 * behaviours are re-pinned at their new home (the effect spec) and
 * end to end below — nothing is dropped, only moved. */
describe('trash-delete end to end with production setCart semantics (T15-A)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const line: PosItem = {
    lineKey: 'p1::u1::retail',
    productId: 'p1',
    name: 'Tea',
    itemCode: 'p1',
    unitId: 'u1',
    unitName: 'قطعة',
    unitMultiplier: 1,
    price: 75,
    costPrice: 5,
    qty: 1,
    stockLimit: 10,
    currentStock: 10,
    minStock: 0,
    priceType: 'retail',
  };

  it('trash-delete with a plain non-executing setCart zeroes the extras through the empty-cart effect — NOT inside removeItem', () => {
    // Production semantics: React queues the functional updater and
    // runs it at re-render, never inside the setState call. A plain
    // vi.fn() reproduces that: the updater is captured, never run.
    // At base this test FAILS: the empty-cart effect never called
    // the zeroing setters, so the empty cart kept tip 10 + fee 15.
    const setCart = vi.fn();
    const setTipAmount = vi.fn();
    const setLoyaltyPointsRedeemed = vi.fn();
    const setDeliveryFee = vi.fn();
    const setSubmitMessage = vi.fn();
    const reset = vi.fn();
    const setSelectedLineKey = vi.fn();
    const setPostSaleSaleKey = vi.fn();
    const setCustomerId = vi.fn();
    const actions = createPosWorkspaceBaseActions(makeParams({
      cart: [line],
      setCart,
      selectedLineKey: 'p1::u1::retail',
      setSelectedLineKey,
      setPostSaleSaleKey,
      customerId: '7',
      setCustomerId,
      tipAmount: 10,
      loyaltyPointsRedeemed: 200,
      deliveryFee: 15,
      setTipAmount,
      setLoyaltyPointsRedeemed,
      setDeliveryFee,
      setSubmitMessage,
      createSale: { mutateAsync: vi.fn(), reset },
    }));

    actions.removeItem('p1::u1::retail');

    // removeItem itself zeroes NOTHING: the updater has not run yet.
    expect(setTipAmount).not.toHaveBeenCalled();
    expect(setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
    expect(setDeliveryFee).not.toHaveBeenCalled();
    expect(setSubmitMessage).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(setCustomerId).not.toHaveBeenCalled();
    expect(setSelectedLineKey).toHaveBeenCalledWith('');
    expect(setPostSaleSaleKey).toHaveBeenCalledWith('');
    // The updater, when React runs it at re-render, removes the line.
    const updater = setCart.mock.calls[0][0] as (cart: PosItem[]) => PosItem[];
    expect(updater([line])).toEqual([]);

    // The re-render installs the empty cart; the empty-cart effect
    // then zeroes the extras, clears the banner and resets the sale.
    renderHook(() => usePosWorkspaceEffects({
      cart: [],
      customerId: '7',
      discount: 0,
      paidAmount: 0,
      total: 0,
      cashAmount: 0,
      setCashAmount: vi.fn(),
      cardAmount: 0,
      setCardAmount: vi.fn(),
      transferAmount: 0,
      setTransferAmount: vi.fn(),
      paymentType: 'cash',
      paymentChannel: 'cash',
      setPaymentChannel: vi.fn(),
      note: '',
      search: '',
      priceType: 'retail',
      tableNumber: '',
      orderType: 'delivery',
      deliveryFee: 15,
      setDeliveryFee,
      tipAmount: 10,
      setTipAmount,
      loyaltyPointsRedeemed: 200,
      setLoyaltyPointsRedeemed,
      products: [],
      setCart: vi.fn(),
      submitMessage: 'mismatch banner',
      setSubmitMessage,
      recentProductIds: [],
      lastSale: null,
      lastAddedLineKey: '',
      setLastAddedLineKey: vi.fn(),
      selectedLineKey: '',
      setSelectedLineKey: vi.fn(),
      discountApprovalSecret: '',
      setDiscountApprovalSecret: vi.fn(),
      createSale: { reset },
    }));

    expect(setTipAmount).toHaveBeenCalledTimes(1);
    expect(setTipAmount).toHaveBeenCalledWith(0);
    expect(setLoyaltyPointsRedeemed).toHaveBeenCalledWith(0);
    expect(setDeliveryFee).toHaveBeenCalledWith(0);
    expect(setSubmitMessage).toHaveBeenCalledWith('');
    // INV-POS-EMPTY-CART-MUTATION-RESET-GATE: the stub is an idle
    // mutation (a plain trash-delete, no finished sale), so the gated
    // empty-cart effect must NOT reset it. The extras-zeroing above
    // is this test's real point; the terminal-state reset is pinned
    // in usePosWorkspaceEffects.reset-loop.spec.tsx.
    expect(reset).toHaveBeenCalledTimes(0);
  });
});

describe('removeItem never zeroes extras or clears the banner itself (T15-A)', () => {
  const line: PosItem = {
    lineKey: 'p1::u1::retail',
    productId: 'p1',
    name: 'Tea',
    itemCode: 'p1',
    unitId: 'u1',
    unitName: 'قطعة',
    unitMultiplier: 1,
    price: 75,
    costPrice: 5,
    qty: 1,
    stockLimit: 10,
    currentStock: 10,
    minStock: 0,
    priceType: 'retail',
  };
  const otherLine: PosItem = { ...line, lineKey: 'p2::u1::retail', productId: 'p2', name: 'Coffee', price: 10 };

  function plainSetCartActions(cart: PosItem[]) {
    const setCart = vi.fn();
    const setTipAmount = vi.fn();
    const setLoyaltyPointsRedeemed = vi.fn();
    const setDeliveryFee = vi.fn();
    const setSubmitMessage = vi.fn();
    const reset = vi.fn();
    const setCustomerId = vi.fn();
    const actions = createPosWorkspaceBaseActions(makeParams({
      cart,
      setCart,
      selectedLineKey: 'p1::u1::retail',
      setSelectedLineKey: vi.fn(),
      setPostSaleSaleKey: vi.fn(),
      customerId: '7',
      setCustomerId,
      tipAmount: 10,
      loyaltyPointsRedeemed: 200,
      deliveryFee: 15,
      setTipAmount,
      setLoyaltyPointsRedeemed,
      setDeliveryFee,
      setSubmitMessage,
      createSale: { mutateAsync: vi.fn(), reset },
    }));
    return { actions, setCart, setTipAmount, setLoyaltyPointsRedeemed, setDeliveryFee, setSubmitMessage, reset, setCustomerId };
  }

  it('removing the last line with a plain non-executing setCart zeroes nothing itself — the effect owns that — and the customer stays attached', () => {
    const { actions, setCart, setTipAmount, setLoyaltyPointsRedeemed, setDeliveryFee, setSubmitMessage, reset, setCustomerId } = plainSetCartActions([line]);

    actions.removeItem('p1::u1::retail');

    expect(setCart).toHaveBeenCalledWith(expect.any(Function));
    expect(setTipAmount).not.toHaveBeenCalled();
    expect(setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
    expect(setDeliveryFee).not.toHaveBeenCalled();
    expect(setSubmitMessage).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(setCustomerId).not.toHaveBeenCalled();
  });

  it('removing a line that leaves items keeps the extras — and the updater removes only that line', () => {
    const { actions, setCart, setTipAmount, setLoyaltyPointsRedeemed, setDeliveryFee, setSubmitMessage, reset } = plainSetCartActions([line, otherLine]);

    actions.removeItem('p1::u1::retail');

    expect(setTipAmount).not.toHaveBeenCalled();
    expect(setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
    expect(setDeliveryFee).not.toHaveBeenCalled();
    expect(setSubmitMessage).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    const updater = setCart.mock.calls[0][0] as (cart: PosItem[]) => PosItem[];
    expect(updater([line, otherLine])).toEqual([otherLine]);
  });

  it('stepper-to-zero goes through the same removeItem and zeroes nothing itself', () => {
    const { actions, setCart, setTipAmount, setLoyaltyPointsRedeemed, setDeliveryFee, setSubmitMessage, reset } = plainSetCartActions([line]);

    const result = actions.changeLineQtyByDelta('p1::u1::retail', -1);

    expect(result).toBe(true);
    expect(setTipAmount).not.toHaveBeenCalled();
    expect(setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
    expect(setDeliveryFee).not.toHaveBeenCalled();
    expect(setSubmitMessage).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    const updater = setCart.mock.calls[0][0] as (cart: PosItem[]) => PosItem[];
    expect(updater([line])).toEqual([]);
  });
});

/* T13-N2 (INV-REST-WORKSPACE-EXTRAS-RESET, NEW-3): the stock check
   * read the render-captured params.cart, but the products panel is
   * memoised (arePropsEqual ignores onAddProduct), so after the cart
   * changes it can still hold the OLD handleAddProduct closure whose
   * cart still lists a deleted line — the cashier got a phantom
   * "الموجود في السلة 1" refusal for an empty cart. The check now
   * reads the live cart inside the setCart updater. The harness
   * reproduces the stale closure exactly: the actions are built with
   * the stale cart (one line, qty 1, stock 1 — at the limit), while
   * the setCart mock installs updates against the live cart. At base
   * the first case refuses (currentQty 1 >= availableQty 1 from the
   * snapshot) and fails; the second case pins the live refusal with
   * the identical wording, so the message itself is unchanged. */
  describe('handleAddProduct reads the live cart for the stock check (T13-N2)', () => {
    const oneInStock: Product = { ...product, stock: 1 };
    const line: PosItem = {
      lineKey: 'p1::u1::retail',
      productId: 'p1',
      name: 'Tea',
      itemCode: 'p1',
      unitId: 'u1',
      unitName: 'قطعة',
      unitMultiplier: 1,
      price: 10,
      costPrice: 5,
      qty: 1,
      stockLimit: 1,
      currentStock: 1,
      minStock: 0,
      priceType: 'retail',
    };

    function staleClosureActions(liveCart: PosItem[]) {
      const setCart = vi.fn((updater: PosItem[] | ((cart: PosItem[]) => PosItem[])) => (
        typeof updater === 'function' ? updater(liveCart) : updater
      ));
      const setSubmitMessage = vi.fn();
      const setScannerMessage = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line],
        setCart,
        setSubmitMessage,
        setScannerMessage,
      }));
      return { actions, setCart, setSubmitMessage, setScannerMessage };
    }

    it('re-adds a deleted item through a stale closure: no phantom-count refusal when the live cart is empty', () => {
      const { actions, setCart, setSubmitMessage } = staleClosureActions([]);

      const result = actions.handleAddProduct(oneInStock);

      expect(result).toBe(true);
      expect(setSubmitMessage).not.toHaveBeenCalledWith(expect.stringContaining('الموجود في السلة'));
      const installed = setCart.mock.results[0]?.value as PosItem[];
      expect(installed.map((entry) => entry.productId)).toEqual(['p1']);
      expect(installed[0]?.qty).toBe(1);
    });

    it('still refuses when the LIVE cart really holds the item at the stock limit — same wording as before', () => {
      const { actions, setSubmitMessage } = staleClosureActions([line]);

      const result = actions.handleAddProduct(oneInStock);

      expect(result).toBe(false);
      expect(setSubmitMessage).toHaveBeenCalledWith(
        'لا يمكن إضافة كمية أكبر. المتاح من الصنف 1، والموجود في السلة 1.',
      );
    });
  });

  /* T13-N2 — the reload half of the save-as-held reset: the canonical
   * reset must wipe the persisted draft snapshot, or a reload
   * re-initialises the workspace from it and the redemption is back.
   * This pins it through the real production read path —
   * loadPosWorkspaceStorage is what usePosWorkspaceState mounts
   * from — not through a mock: seed a draft carrying 100 redeemed
   * points, run the real resetPosDraft, and a fresh load finds no
   * draft at all. At base this behaviour already held for the two
   * patched split branches (they call the same reset); the new
   * save-as-held branch joins them, so this case passes at base
   * and guards the shared reset itself. */
  describe('resetPosDraft wipes the persisted draft snapshot (T13-N2)', () => {
    it('clears the stored draft so a fresh mount finds no redemption to restore', () => {
      clearDraftSnapshot();
      persistDraftSnapshot(buildDraftState({
        cart: [],
        customerId: '7',
        loyaltyPointsRedeemed: 100,
        tipAmount: 10,
      }));
      expect(loadPosWorkspaceStorage().draft?.loyaltyPointsRedeemed).toBe(100);

      const actions = createPosWorkspaceBaseActions(makeParams({
        setTipAmount: vi.fn(),
        setLoyaltyPointsRedeemed: vi.fn(),
        setDeliveryFee: vi.fn(),
        setOrderType: vi.fn(),
        setTableNumber: vi.fn(),
        setDeliveryRepId: vi.fn(),
        setCollectionStatus: vi.fn(),
        setTransferAmount: vi.fn(),
        setQuickCustomerName: vi.fn(),
        setQuickCustomerPhone: vi.fn(),
        setQuickCustomerAddress: vi.fn(),
      }));

      actions.resetPosDraft();

      expect(loadPosWorkspaceStorage().draft).toBeNull();
      clearDraftSnapshot();
    });
  });

  /* T14-A (INV-REST-WORKSPACE-EXTRAS-LIVE-RESET, NEW (b)): switching
   * the order type from delivery to takeaway left a zone-set fee
   * standing, because handleSetOrderType cleared the fee only when it
   * equalled the settings defaultDeliveryFee — and it never touched
   * the courier or the collection status, so the COD summary box
   * ("التحصيل: تحصيل من العميل") stayed. The switch now clears fee +
   * rep + status regardless of fee source, through the production
   * helper applyPosOrderTypeChange (the same code handleSetOrderType
   * calls). The COD box is gone with it: PosCheckoutDialog renders
   * the rep-required box only when orderType is 'delivery' AND
   * collectionStatus is 'cod', and the checkout delivery section —
   * the COD summary box — only renders for a delivery order, so a
   * takeaway with status '' shows neither. At base the first case
   * fails: the settings default is 0, so the old
   * `defaultDeliveryFee > 0 && fee === default` guard never fires
   * and the 15.00 fee survives. */
  describe('leaving delivery clears delivery extras regardless of fee source (T14-A)', () => {
    function orderTypeSetters() {
      return {
        setDeliveryFee: vi.fn(),
        setDeliveryFeeMode: vi.fn(),
        setDeliveryRepId: vi.fn(),
        setCollectionStatus: vi.fn(),
      };
    }

    it('delivery → takeaway with a zone-set fee (15.00, NOT the settings default) clears fee, rep and collection status', () => {
      const setters = orderTypeSetters();

      applyPosOrderTypeChange('delivery', 'takeaway', { defaultDeliveryFee: 0 }, 15, setters);

      expect(setters.setDeliveryFee).toHaveBeenCalledWith(0);
      expect(setters.setDeliveryRepId).toHaveBeenCalledWith('');
      expect(setters.setCollectionStatus).toHaveBeenCalledWith('');
    });

    it('delivery → takeaway also clears a fee that DOES equal the settings default', () => {
      const setters = orderTypeSetters();

      applyPosOrderTypeChange('delivery', 'takeaway', { defaultDeliveryFee: 15 }, 15, setters);

      expect(setters.setDeliveryFee).toHaveBeenCalledWith(0);
      expect(setters.setDeliveryRepId).toHaveBeenCalledWith('');
      expect(setters.setCollectionStatus).toHaveBeenCalledWith('');
    });

    it('delivery → dine_in clears the same three extras', () => {
      const setters = orderTypeSetters();

      applyPosOrderTypeChange('delivery', 'dine_in', { defaultDeliveryFee: 5 }, 15, setters);

      expect(setters.setDeliveryFee).toHaveBeenCalledWith(0);
      expect(setters.setDeliveryRepId).toHaveBeenCalledWith('');
      expect(setters.setCollectionStatus).toHaveBeenCalledWith('');
    });

    it('keeps delivery extras when the order type does not leave delivery', () => {
      const staying = orderTypeSetters();
      applyPosOrderTypeChange('delivery', 'delivery', { defaultDeliveryFee: 0 }, 15, staying);
      expect(staying.setDeliveryFee).not.toHaveBeenCalled();
      expect(staying.setDeliveryRepId).not.toHaveBeenCalled();
      expect(staying.setCollectionStatus).not.toHaveBeenCalled();

      const entering = orderTypeSetters();
      applyPosOrderTypeChange('takeaway', 'takeaway', { defaultDeliveryFee: 0 }, 0, entering);
      expect(entering.setDeliveryFee).not.toHaveBeenCalled();
      expect(entering.setDeliveryRepId).not.toHaveBeenCalled();
      expect(entering.setCollectionStatus).not.toHaveBeenCalled();
    });

    it('takeaway → delivery still applies the settings default fee when none is set', () => {
      const setters = orderTypeSetters();

      applyPosOrderTypeChange('takeaway', 'delivery', { defaultDeliveryFee: 10, deliveryFeeMode: 'store_fleet' }, 0, setters);

      expect(setters.setDeliveryFee).toHaveBeenCalledWith(10);
      expect(setters.setDeliveryFeeMode).toHaveBeenCalledWith('store_fleet');
      expect(setters.setDeliveryRepId).not.toHaveBeenCalled();
      expect(setters.setCollectionStatus).not.toHaveBeenCalled();
    });
  });
});

/* SPICE-PKG3 (b) — a kg product added by TILE TAP, by quick-add
 * barcode, or by quantity-prefix carries no isWeighted flag from
 * the caller: handleAddProduct must derive it from the selected
 * sale unit ('كجم'), so the 0.500 kg survives the add, the stock
 * check (0.750 kg of stock must not floor to 0) and the stepper
 * (0.001 step, not +1). On the base the flag stays unset, the add
 * rounds 0.500 -> 1 and the 0.750-stock add is refused outright. */
describe('tile/search add of a kg-unit product derives isWeighted (SPICE-PKG3)', () => {
  const kgProduct: Product = {
    ...product,
    stock: 10,
    retailPrice: 100,
    units: [{ id: 'u1', name: 'كجم', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
  };

  function liveCartActions(liveCart: PosItem[], overrides: Partial<PosWorkspaceActionParams> = {}) {
    const setCart = vi.fn((updater: PosItem[] | ((cart: PosItem[]) => PosItem[])) => (
      typeof updater === 'function' ? updater(liveCart) : updater
    ));
    const actions = createPosWorkspaceBaseActions(makeParams({ cart: liveCart, setCart, products: [kgProduct], ...overrides }));
    return { actions, setCart };
  }

  it('tile tap with quantity 0.5 installs a weighed 0.500 kg line', () => {
    const { actions, setCart } = liveCartActions([]);

    const result = actions.handleAddProduct(kgProduct, undefined, { quantity: 0.5 });

    expect(result).toBe(true);
    const installed = setCart.mock.results[0]?.value as PosItem[];
    expect(installed).toHaveLength(1);
    expect(installed[0].qty).toBe(0.5);
    expect(installed[0].isWeighted).toBe(true);
  });

  it('tile tap with 0.750 kg of stock and a 0.500 kg add is not refused as out of stock', () => {
    const { actions, setCart } = liveCartActions([], {});

    const result = actions.handleAddProduct({ ...kgProduct, stock: 0.75 }, undefined, { quantity: 0.5 });

    expect(result).toBe(true);
    const installed = setCart.mock.results[0]?.value as PosItem[];
    expect(installed[0].qty).toBe(0.5);
    expect(installed[0].stockLimit).toBe(0.75);
  });

  it('quick-add barcode of the kg product installs a weighed line (search path, no flag)', () => {
    const setCart = vi.fn((updater: PosItem[] | ((cart: PosItem[]) => PosItem[])) => (
      typeof updater === 'function' ? updater([]) : updater
    ));
    const actions = createPosWorkspaceBaseActions(makeParams({
      cart: [],
      setCart,
      products: [kgProduct],
      quickAddCode: '123',
    }));

    const result = actions.handleQuickAddCodeSubmit();

    expect(result).toBe(true);
    const installed = setCart.mock.results[0]?.value as PosItem[];
    expect(installed[0].qty).toBe(1);
    expect(installed[0].isWeighted).toBe(true);
  });

  it('quantity-prefix quick add 0.5*barcode installs 0.500 kg, not 1 piece', () => {
    const setCart = vi.fn((updater: PosItem[] | ((cart: PosItem[]) => PosItem[])) => (
      typeof updater === 'function' ? updater([]) : updater
    ));
    const actions = createPosWorkspaceBaseActions(makeParams({
      cart: [],
      setCart,
      products: [kgProduct],
      quickAddCode: '0.5*123',
    }));

    const result = actions.handleQuickAddCodeSubmit();

    expect(result).toBe(true);
    const installed = setCart.mock.results[0]?.value as PosItem[];
    expect(installed[0].qty).toBe(0.5);
    expect(installed[0].isWeighted).toBe(true);
  });

  it('the stepper moves a tile-added kg line by 0.001, not by 1', () => {
    const { actions, setCart } = liveCartActions([]);
    actions.handleAddProduct(kgProduct, undefined, { quantity: 0.5 });
    const installed = setCart.mock.results[0]?.value as PosItem[];
    const lineKey = installed[0].lineKey;

    const setCart2 = vi.fn();
    const actions2 = createPosWorkspaceBaseActions(makeParams({ cart: installed, setCart: setCart2, products: [kgProduct] }));
    actions2.changeLineQtyByDelta(lineKey, 1);

    const updated = setCart2.mock.calls[0][0] as PosItem[];
    expect(updated[0].qty).toBe(0.501);
  });
});
