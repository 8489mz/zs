import { describe, expect, it, vi } from 'vitest';
import { createPosWorkspaceBaseActions } from '@/features/pos/hooks/pos-workspace-actions/createPosWorkspaceBaseActions';
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

/* A setCart mock that installs updates against the LIVE cart, the way
 * React runs a functional updater: the updater is invoked with the
 * installed cart and its return value is the installed result.
 * removeItem's emptiness decision lives inside that updater (T14-A),
 * so a plain vi.fn() that never invokes it would leave the decision
 * unmade and the zeroing unasserted. */
function liveCartSetCart(liveCart: PosItem[]) {
  return vi.fn((updater: PosItem[] | ((cart: PosItem[]) => PosItem[])) => (
    typeof updater === 'function' ? updater(liveCart) : updater
  ));
}

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

  /* T11-A (INV-REST-COMBO-SUBMIT-TRUTH, G3): the mismatch banner is
   * submitMessage, and emptying the cart by deleting the line left it
   * standing until a reload — only resetDraftState cleared it. At base
   * removeItem never clears it and never resets the createSale error,
   * so the first and third cases below fail there; the middle case
   * pins the boundary (the banner must survive a removal that leaves
   * items in the cart). */
  describe('removeItem clears the stale submit banner when the cart empties (T11-A)', () => {
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
      stockLimit: 10,
      currentStock: 10,
      minStock: 0,
      priceType: 'retail',
    };

    it('clears submitMessage and resets the createSale error when the last line is removed', () => {
      const setSubmitMessage = vi.fn();
      const reset = vi.fn();
      const setCart = liveCartSetCart([line]);
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line],
        setSubmitMessage,
        setCart,
        createSale: { mutateAsync: vi.fn(), reset },
      }));

      actions.removeItem('p1::u1::retail');

      expect(setSubmitMessage).toHaveBeenCalledWith('');
      expect(reset).toHaveBeenCalledTimes(1);
      expect(setCart.mock.results[0]?.value).toEqual([]);
    });

    it('keeps the banner when removing a line leaves items in the cart', () => {
      const otherLine: PosItem = { ...line, lineKey: 'p2::u1::retail', productId: 'p2', name: 'Coffee' };
      const setSubmitMessage = vi.fn();
      const reset = vi.fn();
      const setCart = liveCartSetCart([line, otherLine]);
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line, otherLine],
        setSubmitMessage,
        setCart,
        createSale: { mutateAsync: vi.fn(), reset },
      }));

      actions.removeItem('p1::u1::retail');

      expect(setSubmitMessage).not.toHaveBeenCalledWith('');
      expect(reset).not.toHaveBeenCalled();
    });

    it('clears the banner when the last line is removed by decrementing its quantity to zero', () => {
      const setSubmitMessage = vi.fn();
      const reset = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line],
        setCart: liveCartSetCart([line]),
        setSubmitMessage,
        createSale: { mutateAsync: vi.fn(), reset },
      }));

      actions.changeLineQtyByDelta('p1::u1::retail', -1);

      expect(setSubmitMessage).toHaveBeenCalledWith('');
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  /* T13-N2 (INV-REST-WORKSPACE-EXTRAS-RESET, NEW-2): emptying the
   * cart by deleting the last line left the tip and the redeemed
   * points standing — the tip is in the persist deps, so a reload
   * restored tip 10 with 0 items (المطلوب دفعه 10.00, no items).
   * removeItem's cart-becomes-empty branch now zeroes both,
   * mirroring resetPosDraftState's extras. The customer stays
   * attached: emptying the cart is not starting a new sale, so
   * setCustomerId must never be called here. At base neither
   * setter is called, so the first case below fails there; the
   * second case pins the boundary (extras survive a removal that
   * leaves items in the cart). */
  describe('removeItem zeroes order extras when the cart empties (T13-N2)', () => {
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
      stockLimit: 10,
      currentStock: 10,
      minStock: 0,
      priceType: 'retail',
    };

    it('zeroes tipAmount and loyaltyPointsRedeemed when the last line is removed — the customer stays attached', () => {
      const setTipAmount = vi.fn();
      const setLoyaltyPointsRedeemed = vi.fn();
      const setCustomerId = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line],
        setCart: liveCartSetCart([line]),
        customerId: '7',
        tipAmount: 10,
        loyaltyPointsRedeemed: 100,
        setTipAmount,
        setLoyaltyPointsRedeemed,
        setCustomerId,
      }));

      actions.removeItem('p1::u1::retail');

      expect(setTipAmount).toHaveBeenCalledWith(0);
      expect(setLoyaltyPointsRedeemed).toHaveBeenCalledWith(0);
      expect(setCustomerId).not.toHaveBeenCalled();
    });

    it('keeps tip and loyalty when removing a line leaves items in the cart', () => {
      const otherLine: PosItem = { ...line, lineKey: 'p2::u1::retail', productId: 'p2', name: 'Coffee' };
      const setTipAmount = vi.fn();
      const setLoyaltyPointsRedeemed = vi.fn();
      const setDeliveryFee = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line, otherLine],
        setCart: liveCartSetCart([line, otherLine]),
        tipAmount: 10,
        loyaltyPointsRedeemed: 100,
        setTipAmount,
        setLoyaltyPointsRedeemed,
        setDeliveryFee,
      }));

      actions.removeItem('p1::u1::retail');

      expect(setTipAmount).not.toHaveBeenCalled();
      expect(setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
      expect(setDeliveryFee).not.toHaveBeenCalled();
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

  /* T14-A (INV-REST-WORKSPACE-EXTRAS-LIVE-RESET, K1 + NEW (b)): Trial 6
   * deleted the only item via the trash icon with tip 10 + 200 redeemed
   * points + a 15.00 delivery fee set, and the empty cart still
   * totalled 15.00 with the tip/loyalty standing. The zeroing branch
   * never ran because removeItem read the closed-over params.cart
   * snapshot: the memoised products panel can invoke the handler
   * through a stale closure. Emptiness is now decided inside the
   * setCart updater against the LIVE cart, and the empty branch
   * zeroes tip + loyalty + deliveryFee (P2 zeroed tip/loyalty only).
   * Total 0 follows from the derived formula once those land: an
   * empty cart has subTotal 0, loyaltyDiscount 0 (0 points redeemed),
   * deliveryFee 0 and tipAmount 0, so total = 0 + 0 + 0. The first
   * case reproduces the trial exactly — the stale snapshot still
   * lists a second line the live cart no longer has, so at base the
   * snapshot says "not empty" and nothing is zeroed. The second case
   * pins the decision the other way: a snapshot that says "empty"
   * must NOT zero extras the live cart still owes. */
  describe('removeItem zeroes ALL order extras when the LIVE cart empties (T14-A)', () => {
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

    it('zeroes tip, loyalty AND deliveryFee when the only line is deleted with a STALE params.cart snapshot', () => {
      const setTipAmount = vi.fn();
      const setLoyaltyPointsRedeemed = vi.fn();
      const setDeliveryFee = vi.fn();
      const setSubmitMessage = vi.fn();
      const reset = vi.fn();
      const setCart = liveCartSetCart([line]);
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line, otherLine],
        setCart,
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

      expect(setCart.mock.results[0]?.value).toEqual([]);
      expect(setTipAmount).toHaveBeenCalledWith(0);
      expect(setLoyaltyPointsRedeemed).toHaveBeenCalledWith(0);
      expect(setDeliveryFee).toHaveBeenCalledWith(0);
      expect(setSubmitMessage).toHaveBeenCalledWith('');
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('keeps the extras when the LIVE cart still holds a line the stale snapshot has already lost', () => {
      const setTipAmount = vi.fn();
      const setLoyaltyPointsRedeemed = vi.fn();
      const setDeliveryFee = vi.fn();
      const actions = createPosWorkspaceBaseActions(makeParams({
        cart: [line],
        setCart: liveCartSetCart([line, otherLine]),
        tipAmount: 10,
        loyaltyPointsRedeemed: 200,
        deliveryFee: 15,
        setTipAmount,
        setLoyaltyPointsRedeemed,
        setDeliveryFee,
      }));

      actions.removeItem('p1::u1::retail');

      expect(setTipAmount).not.toHaveBeenCalled();
      expect(setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
      expect(setDeliveryFee).not.toHaveBeenCalled();
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
