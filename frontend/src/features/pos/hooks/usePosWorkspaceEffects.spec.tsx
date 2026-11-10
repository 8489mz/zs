/* POS cash follows the total (INV-INVOICE-DETAIL-AMOUNTS): when the grand
 * total changes for any reason (discount, tip, loyalty redemption, delivery
 * fee, items added/removed) and the cash field was simply filled to the old
 * total (single cash payment, no card/transfer split), the cash field is
 * re-filled to the new total — so Trial 8's stale cash (85.00 left standing
 * while the total fell to 65.00 after tip + redemption, then rose to 80.00
 * after the 15.00 delivery fee) now follows the total to 65.00 then 80.00.
 * A manually tendered amount, a split payment, a credit sale, or an
 * unchanged total must leave the cash field untouched. Re-syncing UP when
 * the total rises is the accepted trade-off, already accepted for discounts.
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePosWorkspaceEffects } from './usePosWorkspaceEffects';
import { usePosWorkspaceDerived } from './usePosWorkspaceDerived';
import { applyPosOrderTypeChange } from './usePosWorkspace';
import type { PosItem } from '@/features/pos/types/pos.types';

const cartItem = {
  lineKey: 'line-1',
  productId: '10',
  name: 'صنف تجريبي',
  unitId: '1',
  unitName: 'قطعة',
  unitMultiplier: 1,
  price: 150,
  costPrice: 100,
  qty: 1,
  stockLimit: 100,
  currentStock: 100,
  minStock: 0,
  priceType: 'retail',
} as PosItem;

interface CashProps {
  discount: number;
  total: number;
  cashAmount: number;
  cardAmount: number;
  transferAmount: number;
  paymentType: 'cash' | 'credit';
}

function setup() {
  const setters = {
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    setPaymentChannel: vi.fn(),
    setCart: vi.fn(),
    setSubmitMessage: vi.fn(),
    setSelectedLineKey: vi.fn(),
    setLastAddedLineKey: vi.fn(),
    setDiscountApprovalSecret: vi.fn(),
  };
  const render = (initialProps: CashProps) =>
    renderHook(
      ({ discount, total, cashAmount, cardAmount, transferAmount, paymentType }: CashProps) =>
        usePosWorkspaceEffects({
          cart: [cartItem],
          customerId: '',
          discount,
          paidAmount: cashAmount + cardAmount + transferAmount,
          total,
          cashAmount,
          setCashAmount: setters.setCashAmount,
          cardAmount,
          setCardAmount: setters.setCardAmount,
          transferAmount,
          setTransferAmount: setters.setTransferAmount,
          paymentType,
          paymentChannel: 'cash',
          setPaymentChannel: setters.setPaymentChannel,
          note: '',
          search: '',
          priceType: 'retail',
          tableNumber: '',
          orderType: 'takeaway',
          products: [],
          setCart: setters.setCart,
          setSubmitMessage: setters.setSubmitMessage,
          recentProductIds: [],
          lastSale: null,
          lastAddedLineKey: '',
          setLastAddedLineKey: setters.setLastAddedLineKey,
          selectedLineKey: '',
          setSelectedLineKey: setters.setSelectedLineKey,
          discountApprovalSecret: '',
          setDiscountApprovalSecret: setters.setDiscountApprovalSecret,
        }),
      { initialProps },
    );
  return { setters, render };
}

describe('POS cash follows the total', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('re-fills cash to the new total when a discount is entered on a cash-filled sale', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).toHaveBeenCalledWith(135);
  });

  it('leaves a manually tendered cash amount untouched', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 200, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 200, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('leaves a split payment untouched', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 100, cardAmount: 50, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 100, cardAmount: 50, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('re-syncs tracking cash when tip + redemption drop the total (Trial 8: 85 to 65)', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 85, cashAmount: 85, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 0, total: 65, cashAmount: 85, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).toHaveBeenCalledWith(65);
  });

  it('re-syncs tracking cash when the delivery fee raises the total (Trial 8: 65 to 80)', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 65, cashAmount: 65, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 0, total: 80, cashAmount: 65, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).toHaveBeenCalledWith(80);
  });

  it('re-syncs tracking cash UP when the total rises (accepted trade-off)', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 0, total: 160, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).toHaveBeenCalledWith(160);
  });

  it('leaves a manually tendered cash amount untouched when the total changes without a discount change', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 200, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 0, total: 135, cashAmount: 200, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('leaves a split payment untouched when the total changes without a discount change', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 100, cardAmount: 50, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 0, total: 135, cashAmount: 100, cardAmount: 50, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('leaves cash untouched when the total does not change', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });

    act(() => {
      rerender({ discount: 0, total: 150, cashAmount: 150, cardAmount: 0, transferAmount: 0, paymentType: 'cash' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });

  it('leaves cash untouched on a credit sale', () => {
    const { setters, render } = setup();
    const { rerender } = render({ discount: 0, total: 150, cashAmount: 0, cardAmount: 0, transferAmount: 0, paymentType: 'credit' });

    act(() => {
      rerender({ discount: 15, total: 135, cashAmount: 0, cardAmount: 0, transferAmount: 0, paymentType: 'credit' });
    });

    expect(setters.setCashAmount).not.toHaveBeenCalled();
  });
});

/* T15-A (INV-REST-TRASH-DELETE-EXTRAS-TRUTH, K1): Trial 8 (clean
 * state) trash-deleted the only item with tip 10 + 200 redeemed
 * points + a 15.00 delivery fee set and the empty cart still
 * totalled 25.00 — T14-A's zeroing branch never fired live, because
 * it read a flag assigned inside the setCart updater synchronously,
 * and React runs a functional updater at re-render, never inside
 * the setState call. The reaction now lives in the empty-cart
 * effect: it runs after render against the installed cart, so it
 * covers every empty-cart path (trash, stepper-to-zero, clear).
 * At base this describe's first case FAILS: the effect only
 * cleared the selected line and the discount secret, never the
 * extras. The customer stays attached — the effect has no
 * setCustomerId prop at all, and removeItem never calls it (pinned
 * in createPosWorkspaceBaseActions.spec.ts). */
const trialLine: PosItem = {
  lineKey: 'line-75',
  productId: 'p1',
  name: 'Item 000001',
  unitId: '1',
  unitName: 'قطعة',
  unitMultiplier: 1,
  price: 75,
  costPrice: 5,
  qty: 1,
  stockLimit: 100,
  currentStock: 100,
  minStock: 0,
  priceType: 'retail',
} as PosItem;

const secondLine: PosItem = { ...trialLine, lineKey: 'line-10', productId: 'p2', name: 'Second item', price: 10 };

interface EmptyCartProps {
  cart: PosItem[];
  tipAmount: number;
  loyaltyPointsRedeemed: number;
  deliveryFee: number;
  submitMessage: string;
}

function setupEmptyCart() {
  const setters = {
    setCashAmount: vi.fn(),
    setCardAmount: vi.fn(),
    setTransferAmount: vi.fn(),
    setPaymentChannel: vi.fn(),
    setCart: vi.fn(),
    setSubmitMessage: vi.fn(),
    setSelectedLineKey: vi.fn(),
    setLastAddedLineKey: vi.fn(),
    setDiscountApprovalSecret: vi.fn(),
    setTipAmount: vi.fn(),
    setLoyaltyPointsRedeemed: vi.fn(),
    setDeliveryFee: vi.fn(),
    createSaleReset: vi.fn(),
  };
  const render = (initialProps: EmptyCartProps) =>
    renderHook(
      ({ cart, tipAmount, loyaltyPointsRedeemed, deliveryFee, submitMessage }: EmptyCartProps) =>
        usePosWorkspaceEffects({
          cart,
          customerId: '7',
          discount: 0,
          paidAmount: 0,
          total: 0,
          cashAmount: 0,
          setCashAmount: setters.setCashAmount,
          cardAmount: 0,
          setCardAmount: setters.setCardAmount,
          transferAmount: 0,
          setTransferAmount: setters.setTransferAmount,
          paymentType: 'cash',
          paymentChannel: 'cash',
          setPaymentChannel: setters.setPaymentChannel,
          note: '',
          search: '',
          priceType: 'retail',
          tableNumber: '',
          orderType: 'delivery',
          deliveryFee,
          setDeliveryFee: setters.setDeliveryFee,
          tipAmount,
          setTipAmount: setters.setTipAmount,
          loyaltyPointsRedeemed,
          setLoyaltyPointsRedeemed: setters.setLoyaltyPointsRedeemed,
          products: [],
          setCart: setters.setCart,
          submitMessage,
          setSubmitMessage: setters.setSubmitMessage,
          recentProductIds: [],
          lastSale: null,
          lastAddedLineKey: '',
          setLastAddedLineKey: setters.setLastAddedLineKey,
          selectedLineKey: 'line-75',
          setSelectedLineKey: setters.setSelectedLineKey,
          discountApprovalSecret: '',
          setDiscountApprovalSecret: setters.setDiscountApprovalSecret,
          createSale: { reset: setters.createSaleReset },
        }),
      { initialProps },
    );
  return { setters, render };
}

/* Totals through the REAL derived hook (the same code the workspace
 * renders), not a re-implementation: settings null means the
 * defaults — 0.1 per redeemed point, loyalty capped at the subtotal. */
function totalsFor(overrides: { cart: PosItem[]; tipAmount?: number; loyaltyPointsRedeemed?: number; deliveryFee?: number }) {
  const params: Record<string, unknown> = {
    saleProducts: [],
    products: [{ id: 'p1', name: 'Item 000001', retail_price: 75, is_active: true }],
    search: '',
    customers: [],
    branches: [{ id: 1, name: 'Main' }],
    locations: [{ id: 10, name: 'Main warehouse' }],
    openShiftRows: [],
    authUserId: 'u1',
    authPermissions: ['*'],
    settings: null,
    heldDrafts: [],
    recentProductIds: [],
    productFilter: 'all',
    cart: overrides.cart,
    discount: 0,
    deliveryFee: overrides.deliveryFee ?? 0,
    tipAmount: overrides.tipAmount ?? 0,
    loyaltyPointsRedeemed: overrides.loyaltyPointsRedeemed ?? 0,
    paidAmount: 0,
    cashAmount: 0,
    cardAmount: 0,
    transferAmount: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    customerId: '',
    branchId: '1',
    locationId: '10',
    lastSale: null,
    orderType: 'takeaway',
    tableNumber: '',
  };
  return renderHook(() => usePosWorkspaceDerived(params as any)).result.current.totals;
}

describe('empty cart resets order extras (T15-A)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('trash-deletes the only item with tip 10 + 200 redeemed points + fee 15: zeroes all three extras, clears the banner and resets createSale', () => {
    const { setters, render } = setupEmptyCart();
    const { rerender } = render({ cart: [trialLine], tipAmount: 10, loyaltyPointsRedeemed: 200, deliveryFee: 15, submitMessage: 'mismatch banner' });

    act(() => {
      rerender({ cart: [], tipAmount: 10, loyaltyPointsRedeemed: 200, deliveryFee: 15, submitMessage: 'mismatch banner' });
    });

    expect(setters.setTipAmount).toHaveBeenCalledWith(0);
    expect(setters.setLoyaltyPointsRedeemed).toHaveBeenCalledWith(0);
    expect(setters.setDeliveryFee).toHaveBeenCalledWith(0);
    expect(setters.setSubmitMessage).toHaveBeenCalledWith('');
    expect(setters.createSaleReset).toHaveBeenCalledTimes(1);
    expect(setters.setSelectedLineKey).toHaveBeenCalledWith('');
  });

  it('mounting with an already-empty cart is harmless: nothing to zero, only the createSale reset fires', () => {
    const { setters, render } = setupEmptyCart();
    render({ cart: [], tipAmount: 0, loyaltyPointsRedeemed: 0, deliveryFee: 0, submitMessage: '' });

    expect(setters.setTipAmount).not.toHaveBeenCalled();
    expect(setters.setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
    expect(setters.setDeliveryFee).not.toHaveBeenCalled();
    expect(setters.setSubmitMessage).not.toHaveBeenCalled();
    expect(setters.createSaleReset).toHaveBeenCalledTimes(1);
  });

  it('removing a line that leaves items in the cart does NOT zero the extras or clear the banner', () => {
    const { setters, render } = setupEmptyCart();
    const { rerender } = render({ cart: [trialLine, secondLine], tipAmount: 10, loyaltyPointsRedeemed: 200, deliveryFee: 15, submitMessage: 'mismatch banner' });

    act(() => {
      rerender({ cart: [secondLine], tipAmount: 10, loyaltyPointsRedeemed: 200, deliveryFee: 15, submitMessage: 'mismatch banner' });
    });

    expect(setters.setTipAmount).not.toHaveBeenCalled();
    expect(setters.setLoyaltyPointsRedeemed).not.toHaveBeenCalled();
    expect(setters.setDeliveryFee).not.toHaveBeenCalled();
    expect(setters.setSubmitMessage).not.toHaveBeenCalled();
    expect(setters.createSaleReset).not.toHaveBeenCalled();
  });
});

describe('Trial 8 totals through the real derived hook (T15-A)', () => {
  it('the Trial 8 sale totals 80.00 before the trash-delete (75 - 20 loyalty + 15 fee + 10 tip)', () => {
    const totals = totalsFor({ cart: [trialLine], tipAmount: 10, loyaltyPointsRedeemed: 200, deliveryFee: 15 });

    expect(totals.loyaltyDiscount).toBe(20);
    expect(totals.deliveryFee).toBe(15);
    expect(totals.tipAmount).toBe(10);
    expect(totals.total).toBe(80);
  });

  it('an empty cart with the zeroed extras totals 0.00', () => {
    const totals = totalsFor({ cart: [], tipAmount: 0, loyaltyPointsRedeemed: 0, deliveryFee: 0 });

    expect(totals.total).toBe(0);
  });

  it('re-adding the item after the trash-delete totals 75.00 — no leaked extras', () => {
    const totals = totalsFor({ cart: [trialLine], tipAmount: 0, loyaltyPointsRedeemed: 0, deliveryFee: 0 });

    expect(totals.total).toBe(75);
  });

  it('delivery → takeaway drops the fee and the total 80.00 → 65.00', () => {
    const setters = {
      setDeliveryFee: vi.fn(),
      setDeliveryFeeMode: vi.fn(),
      setDeliveryRepId: vi.fn(),
      setCollectionStatus: vi.fn(),
    };

    applyPosOrderTypeChange('delivery', 'takeaway', { defaultDeliveryFee: 0 }, 15, setters);

    expect(setters.setDeliveryFee).toHaveBeenCalledWith(0);
    expect(setters.setDeliveryRepId).toHaveBeenCalledWith('');
    expect(setters.setCollectionStatus).toHaveBeenCalledWith('');
    expect(totalsFor({ cart: [trialLine], tipAmount: 10, loyaltyPointsRedeemed: 200, deliveryFee: 15 }).total).toBe(80);
    expect(totalsFor({ cart: [trialLine], tipAmount: 10, loyaltyPointsRedeemed: 200, deliveryFee: 0 }).total).toBe(65);
  });
});
