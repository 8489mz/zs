/* R-B10 + R-B11 + R-B12 + R-I32 + R-I33 (INV-REST-SPLIT-REAL-TOTALS):
 * the split modal re-implemented sale creation client-side, and every
 * number it produced was wrong in a different way:
 * - B10: getBillTotal was price x qty only and handlePayBill posted
 *   discount 0, taxRate 0, no service charge/tip, paid = that reduced sum;
 *   the modal closed settled when no unpaid bill remained, with no check
 *   that paid bills sum to totalAmount.
 * - B11: a fractional part was price/qty only and carried the FULL modifier
 *   list — burger 100 + cheese 20 split in 2 posted 140 instead of 120.
 * - B12: save-as-drafts looped setCart + setTableNumber + holdDraft, but
 *   holdDraft reads render-captured snapshot params, so every draft saved
 *   the ORIGINAL full cart under the ORIGINAL table number.
 * - I32: the init effect re-ran on any cart change, and handlePayBill
 *   itself calls setCart(remainingItems) — paying one bill of three
 *   collapsed the whole split back to Bill 1 + empty Bill 2, paid flags gone.
 * - I33: handlePayGuest set paid: true BEFORE createSale, the catch never
 *   reverted it, and no backend call happened until ALL guests were paid;
 *   the final sale sent taxRate 0, deliveryFee 0, no service charge/tip
 *   and hardcoded paymentChannel 'cash' for a mixed payments array.
 *
 * The fix prices every bill from the opening order snapshot (real line
 * values qty x (price + modifiers) + the order's discount / tax / service
 * charge / tip allocated pro-rata, last bill taking remainders), refuses
 * to close settled unless the paid sum matches the order total within the
 * provable tax-rounding tolerance, splits fractions out of the full line
 * value with no modifiers on the parts, saves drafts by calling the
 * held-draft mutation directly per bill, never resets on cart change, and
 * marks a guest paid only after the final sale posts.
 *
 * Base note: the helpers are new, so there is no behavioural base run for
 * them — the old behaviour is pinned by the exact old inputs (price-only
 * 100 instead of 120, parts 50+50 carrying cheese 20). The render tests
 * pin the wiring fixes against the real modal; their red proof is the
 * failing payload / reset / phantom-paid assertions run against the
 * pre-fix modal logic (see the base-run note in the package report).
 *
 * R6-C (INV-REST-LOYALTY-TRUTH): loyalty rules were scattered across
 * display, redeem-all and server, and split bills redeemed ZERO points
 * while granting the loyalty discount for free once per part —
 * handlePayBill / finalizeEvenSplit never sent loyaltyPointsRedeemed
 * and the allocated discount already contained the loyalty share.
 * The fix snapshots the loyalty split at modal open (manualDiscount,
 * loyaltyPointsRedeemed, point value, cap percent), allocates the
 * MANUAL discount with allocateSplitBillAmounts and the POINTS with
 * the new pure helper allocateSplitLoyaltyPoints, and posts per bill
 * discount = manual share only + loyaltyPointsRedeemed = points share
 * (the backend recomputes the loyalty discount per part, capped, and
 * deducts once per part). Two traps are pinned here, not just the
 * happy path: (1) double-count — sending the combined discount AND
 * points would make the backend add the loyalty discount a second
 * time, so the payload assertions check the discount carries NO
 * loyalty share; (2) cap vs points burned — the backend caps the
 * DISCOUNT but burns ALL sent points, so the allocator caps each
 * part's points at floor(partMaxDiscount / pointValue) and points
 * that cannot be placed anywhere stay UNREDEEMED. Bill amounts are
 * manual share + discount-from-allocated-points, never the snapshot's
 * combined discountValue, or the paid-sum guard refuses to close.
 * The checkout banner (PosCheckoutDialogSections) showed the UNCAPPED
 * points value and the redeem-all gate defaulted to 50 while the
 * backend defaults to 0 — both fixed there; the banner value is the
 * derived hook's capped totals.loyaltyDiscount, so no new component
 * harness is invented for one line (see r6c.md §3).
 *
 * Points-remainder note: unlike money (last non-empty bill takes the
 * rounding remainder), a points remainder is distributed one point at
 * a time in largest-remainder order and is NEVER forced onto the last
 * bill — forcing it would exceed that bill's cap and burn points for
 * discount never given (Trap 2). */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import {
  PosSplitBillModal,
  allocateSplitBillAmounts,
  allocateSplitLoyaltyPoints,
  buildFractionalParts,
  calcStrandedLoyaltyValue,
  isSplitPaidSumSettled,
  moveSplitBillItem,
  moveSplitBillItems,
  resolveSplitPaymentChannel,
  splitRoundingTolerance,
  type SplitOrderTotals,
} from './PosSplitBillModal';
import type { PosItem } from '@/features/pos/types/pos.types';

const DIGITS = 2;

function item(overrides: Partial<PosItem> = {}): PosItem {
  return {
    lineKey: 'L1',
    productId: '1',
    name: 'برجر',
    unitId: 'u1',
    unitName: 'قطعة',
    unitMultiplier: 1,
    price: 100,
    costPrice: 50,
    qty: 1,
    stockLimit: 0,
    currentStock: 10,
    minStock: 0,
    priceType: 'retail',
    modifiers: [],
    ...overrides,
  } as PosItem;
}

const cheese = { price: 20, qty: 1 };

function orderTotals(overrides: Partial<SplitOrderTotals> = {}): SplitOrderTotals {
  const base: SplitOrderTotals = {
    subTotal: 300,
    discountValue: 30,
    serviceCharge: 27,
    taxRate: 14,
    pricesIncludeTax: false,
    tipAmount: 10,
    deliveryFee: 0,
    total: 348.58,
    manualDiscount: 30,
    loyaltyPointsRedeemed: 0,
    loyaltyPointRedeemValue: 0.1,
    loyaltyMaxDiscountPercentage: 100,
  };
  const merged = { ...base, ...overrides };
  // R6-C: manualDiscount tracks discountValue unless the caller says
  // otherwise — the pre-loyalty fixtures carry one combined discount.
  if (overrides.manualDiscount === undefined) merged.manualDiscount = merged.discountValue;
  return merged;
}

describe('allocateSplitBillAmounts (B10)', () => {
  it('charges the real line value: a modified item totals price + modifiers, not price only', () => {
    const burger = item({ modifiers: [cheese] });
    const lineTotal = calcCartLineTotal(burger);
    expect(lineTotal).toBe(120);
    const [bill] = allocateSplitBillAmounts(
      [lineTotal, 0],
      orderTotals({ subTotal: 120, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 120 }),
      DIGITS,
    );
    expect(bill.total).toBe(120);
    expect(bill.subtotal).toBe(120);
  });

  it('allocates discount, service charge, tax and tip across bills and sums exactly to the order total', () => {
    const [first, second] = allocateSplitBillAmounts([100, 200], orderTotals(), DIGITS);
    expect(first).toEqual({
      subtotal: 100,
      discount: 10,
      serviceCharge: 9,
      taxAmount: 13.86,
      tipAmount: 3.33,
      deliveryFee: 0,
      total: 116.19,
      manualDiscount: 10,
      loyaltyPointsRedeemed: 0,
      loyaltyDiscount: 0,
    });
    expect(second).toEqual({
      subtotal: 200,
      discount: 20,
      serviceCharge: 18,
      taxAmount: 27.72,
      tipAmount: 6.67,
      deliveryFee: 0,
      total: 232.39,
      manualDiscount: 20,
      loyaltyPointsRedeemed: 0,
      loyaltyDiscount: 0,
    });
    expect(first.total + second.total).toBe(348.58);
  });

  it('gives an empty bill zeros and lets the last non-empty bill take the remainders', () => {
    const amounts = allocateSplitBillAmounts([100, 0, 200], orderTotals(), DIGITS);
    expect(amounts[1].total).toBe(0);
    expect(amounts[0].total + amounts[1].total + amounts[2].total).toBe(348.58);
    expect(amounts[2].discount).toBe(20);
    expect(amounts[2].tipAmount).toBe(6.67);
  });

  it('prices tax-inclusive bills with the tax inside the total', () => {
    const [first, second] = allocateSplitBillAmounts(
      [100, 100],
      orderTotals({
        subTotal: 200,
        discountValue: 0,
        serviceCharge: 0,
        taxRate: 14,
        pricesIncludeTax: true,
        tipAmount: 0,
        total: 200,
      }),
      DIGITS,
    );
    expect(first.taxAmount).toBe(12.28);
    expect(first.total).toBe(100);
    expect(second.total).toBe(100);
    expect(first.total + second.total).toBe(200);
  });

  it('never lets a bill discount exceed its own lines', () => {
    const [first] = allocateSplitBillAmounts(
      [10, 290],
      orderTotals({ discountValue: 300 }),
      DIGITS,
    );
    expect(first.discount).toBeLessThanOrEqual(10);
  });
});

/* INV-REST-LOYALTY-TRUTH (R6-C): the points allocator. At base there is
 * no points allocation at all — split bills redeemed zero points while
 * granting the loyalty discount — so these cases pin the helper
 * directly, plus the modal payload assertions below. */
describe('allocateSplitLoyaltyPoints (R6-C)', () => {
  const PV = 0.1;
  const PCT = 100;

  it('splits 100 points exactly pro-rata over two bills', () => {
    expect(allocateSplitLoyaltyPoints([100, 200], 100, PV, PCT, DIGITS)).toEqual([33, 67]);
    expect(allocateSplitLoyaltyPoints([100, 100], 100, PV, PCT, DIGITS)).toEqual([50, 50]);
  });

  it('floors the remainder: 3 points over 2 equal bills is 2+1, never 1.5', () => {
    const points = allocateSplitLoyaltyPoints([100, 100], 3, PV, PCT, DIGITS);
    expect(points).toEqual([2, 1]);
    expect(points.every((p) => Number.isInteger(p))).toBe(true);
    expect(points.reduce((s, p) => s + p, 0)).toBe(3);
  });

  it('returns all zero for zero points', () => {
    expect(allocateSplitLoyaltyPoints([100, 200], 0, PV, PCT, DIGITS)).toEqual([0, 0]);
    expect(allocateSplitLoyaltyPoints([100, 200], 0, PV, PCT, DIGITS)).toEqual([0, 0]);
  });

  it('gives a single bill all the points', () => {
    expect(allocateSplitLoyaltyPoints([100], 100, PV, PCT, DIGITS)).toEqual([100]);
  });

  it('caps a small part at floor(partMaxDiscount / pointValue) and leaves the rest unredeemed', () => {
    // Subtotals 10 + 100, point value 1, cap 50%: the small part may
    // carry at most floor(5 / 1) = 5 points, the big part at most
    // floor(50 / 1) = 50 — 45 of the 100 points cannot be placed
    // anywhere and stay UNREDEEMED (Trap 2: the backend would burn
    // them for discount never given).
    const points = allocateSplitLoyaltyPoints([10, 100], 100, 1, 50, DIGITS);
    expect(points).toEqual([5, 50]);
    expect(points.reduce((s, p) => s + p, 0)).toBe(55);
  });

  it('never sends points to a bill whose cap is zero', () => {
    // Subtotal 1 at point value 10: floor(1 / 10) = 0 points of
    // headroom — the single remainder point cannot go here either.
    expect(allocateSplitLoyaltyPoints([1, 100], 11, 10, PCT, DIGITS)).toEqual([0, 10]);
  });

  it('places every point when the total is exactly at the combined cap', () => {
    expect(allocateSplitLoyaltyPoints([100, 100], 100, 1, 50, DIGITS)).toEqual([50, 50]);
  });

  it('returns all zero when the point value is zero', () => {
    expect(allocateSplitLoyaltyPoints([100, 100], 100, 0, PCT, DIGITS)).toEqual([0, 0]);
  });
});

describe('allocateSplitBillAmounts with loyalty (R6-C)', () => {
  it('builds each bill discount from the manual share plus the discount from its allocated points — never the combined snapshot share', () => {
    // Manual 20 + 3 points at 0.1 = 0.30 loyalty, combined 20.30.
    // A combined pro-rata split would give each bill 10.15; the
    // points split is 2+1, so the bills must be 10.20 and 10.10.
    const [first, second] = allocateSplitBillAmounts(
      [100, 100],
      orderTotals({
        subTotal: 200,
        discountValue: 20,
        manualDiscount: 20,
        loyaltyPointsRedeemed: 3,
        loyaltyPointRedeemValue: 0.1,
        loyaltyMaxDiscountPercentage: 100,
        serviceCharge: 0,
        taxRate: 0,
        tipAmount: 0,
        total: 179.7,
      }),
      DIGITS,
      [2, 1],
    );
    expect(first.manualDiscount).toBe(10);
    expect(first.loyaltyPointsRedeemed).toBe(2);
    expect(first.loyaltyDiscount).toBe(0.2);
    expect(first.discount).toBe(10.2);
    expect(first.total).toBe(89.8);
    expect(second.manualDiscount).toBe(10);
    expect(second.loyaltyPointsRedeemed).toBe(1);
    expect(second.loyaltyDiscount).toBe(0.1);
    expect(second.discount).toBe(10.1);
    expect(second.total).toBe(89.9);
    expect(first.total + second.total).toBe(179.7);
  });

  it('caps the loyalty discount per bill at the tenant cap and places only the points the cap allows', () => {
    // Cap 5%: each 100 bill allows at most 5 of discount, i.e. 50
    // points at 0.1 — the other 50 points stay unredeemed.
    const [first, second] = allocateSplitBillAmounts(
      [100, 100],
      orderTotals({
        subTotal: 200,
        discountValue: 0,
        manualDiscount: 0,
        loyaltyPointsRedeemed: 100,
        loyaltyPointRedeemValue: 0.1,
        loyaltyMaxDiscountPercentage: 5,
        serviceCharge: 0,
        taxRate: 0,
        tipAmount: 0,
        total: 190,
      }),
      DIGITS,
      [50, 50],
    );
    expect(first.loyaltyPointsRedeemed).toBe(50);
    expect(first.loyaltyDiscount).toBe(5);
    expect(first.discount).toBe(5);
    expect(first.total).toBe(95);
    expect(second.loyaltyDiscount).toBe(5);
    expect(second.total).toBe(95);
    expect(first.total + second.total).toBe(190);
  });
});

describe('buildFractionalParts (B11)', () => {
  it('splits burger 100 + cheese 20 in 2 into 60 + 60 with no modifiers on either part', () => {
    const burger = item({ modifiers: [cheese] });
    const parts = buildFractionalParts(burger, 2, DIGITS);
    expect(parts).not.toBeNull();
    expect(parts!.map((p) => p.price)).toEqual([60, 60]);
    expect(parts!.map((p) => p.qty)).toEqual([1, 1]);
    expect(parts![0].modifiers).toEqual([]);
    expect(parts![1].modifiers).toEqual([]);
    // What the backend posts per part: qty x (price + modifiers) = 60.
    expect(parts!.reduce((s, p) => s + calcCartLineTotal(p), 0)).toBe(120);
    expect(parts![0].name).toContain('حصة 1/2');
    expect(parts![1].name).toContain('حصة 2/2');
  });

  it('splits in 3 into equal shares that sum to the full line value', () => {
    const burger = item({ modifiers: [cheese] });
    const parts = buildFractionalParts(burger, 3, DIGITS);
    expect(parts!.map((p) => p.price)).toEqual([40, 40, 40]);
    expect(parts!.reduce((s, p) => s + calcCartLineTotal(p), 0)).toBe(120);
  });

  it('splits a qty-2 line out of its full value, not its price-only value', () => {
    const burgers = item({ qty: 2, modifiers: [cheese] });
    expect(calcCartLineTotal(burgers)).toBe(240);
    const parts = buildFractionalParts(burgers, 2, DIGITS);
    expect(parts!.map((p) => p.price)).toEqual([120, 120]);
  });

  it('returns null for a zero line', () => {
    expect(buildFractionalParts(item({ price: 0 }), 2, DIGITS)).toBeNull();
  });
});

describe('resolveSplitPaymentChannel (I33)', () => {
  it('returns cash / card / instapay for single-channel mixes and mixed otherwise', () => {
    expect(resolveSplitPaymentChannel(100, 0, 0)).toBe('cash');
    expect(resolveSplitPaymentChannel(0, 100, 0)).toBe('card');
    expect(resolveSplitPaymentChannel(0, 0, 100)).toBe('instapay');
    expect(resolveSplitPaymentChannel(50, 50, 0)).toBe('mixed');
    expect(resolveSplitPaymentChannel(50, 0, 50)).toBe('mixed');
    expect(resolveSplitPaymentChannel(0, 50, 50)).toBe('instapay');
    expect(resolveSplitPaymentChannel(0, 0, 0)).toBe('cash');
  });
});

describe('isSplitPaidSumSettled + splitRoundingTolerance (B10 guard)', () => {
  it('tolerates only the provable per-bill tax-rounding drift', () => {
    expect(splitRoundingTolerance(3, 2)).toBe(0.02);
    // 33.33 + 33.33 + 33.34 at 14%: per-bill taxes sum to 14.01, the order
    // tax is 14.00 — one cent of pure rounding drift, inside tolerance.
    expect(isSplitPaidSumSettled(114.01, 114.0, 3, 2)).toBe(true);
    expect(isSplitPaidSumSettled(114.0, 114.0, 3, 2)).toBe(true);
  });

  it('refuses a real shortfall', () => {
    expect(isSplitPaidSumSettled(113.0, 114.0, 3, 2)).toBe(false);
    expect(isSplitPaidSumSettled(100, 348.58, 2, 2)).toBe(false);
  });
});

/* INV-REST-LOYALTY-TRUTH (R6-C repair): stranded loyalty points could
 * leave a paid split UNABLE TO CLOSE. 201 points over two 10.05 bills
 * place only 100 + 100 (each part's cap is floor(10.05 / 0.1) = 100),
 * so 1 point (0.10 value) strands: the bills' loyalty discounts sum to
 * 20.00 against the order's 20.10, the bills sum to orderTotal + 0.10,
 * and the old guard (tolerance 0.015 for 2 bills) refused — after
 * handlePayBill had already posted the part-sales, so the money was
 * taken but the split never settled and the cart never cleared. The fix
 * computes the stranded value exactly — max(0, (redeemed - placed) x
 * pointValue) — and allows exactly that much extra in BOTH the close
 * guard and the distributed-sum display, so the display never warns
 * while closing is allowed. The allocator's no-force rule stands (Trap
 * 2): points are never forced past a cap, the stranded point stays with
 * the customer, and the customer pays the stranded value extra but keeps
 * a point worth exactly that value — economically neutral, not a hidden
 * charge. A genuine shortfall beyond tolerance + stranded value must
 * STILL refuse. */
describe('stranded loyalty value (R6-C repair)', () => {
  it('strands exactly 1 point / 0.10 when 201 points split over two 10.05 bills, and the bills sum to order total + 0.10', () => {
    expect(allocateSplitLoyaltyPoints([10.05, 10.05], 201, 0.1, 100, DIGITS)).toEqual([100, 100]);
    expect(calcStrandedLoyaltyValue(201, [100, 100], 0.1, DIGITS)).toBe(0.1);
    const [first, second] = allocateSplitBillAmounts(
      [10.05, 10.05],
      orderTotals({
        subTotal: 20.1,
        discountValue: 0,
        manualDiscount: 0,
        loyaltyPointsRedeemed: 201,
        loyaltyPointRedeemValue: 0.1,
        loyaltyMaxDiscountPercentage: 100,
        serviceCharge: 0,
        taxRate: 0,
        tipAmount: 0,
        total: 0,
      }),
      DIGITS,
      [100, 100],
    );
    // Each bill: 10.05 lines - 10.00 loyalty discount = 0.05 to pay.
    expect(first.loyaltyPointsRedeemed).toBe(100);
    expect(first.loyaltyDiscount).toBe(10);
    expect(first.discount).toBe(10);
    expect(first.total).toBe(0.05);
    expect(second.loyaltyPointsRedeemed).toBe(100);
    expect(second.loyaltyDiscount).toBe(10);
    expect(second.total).toBe(0.05);
    // The bills sum to the order total (0) + the stranded 0.10.
    expect(first.total + second.total).toBe(0.1);
    // The guard accepts paidSum = total + stranded value — and only
    // with the stranded value: without it the same sums refuse
    // (0.10 > the 0.015 rounding tolerance for 2 bills).
    expect(isSplitPaidSumSettled(0.1, 0, 2, DIGITS, 0.1)).toBe(true);
    expect(isSplitPaidSumSettled(0.1, 0, 2, DIGITS)).toBe(false);
  });

  it('still refuses a genuine shortfall beyond tolerance + stranded value', () => {
    // A 0.50 shortfall against a 20.10 order, with 0.10 stranded:
    // 0.50 > 0.015 tolerance + 0.10 stranded, so the guard refuses.
    expect(isSplitPaidSumSettled(19.6, 20.1, 2, DIGITS, 0.1)).toBe(false);
    // Same on the over side: 0.60 over is 0.50 beyond the stranded value.
    expect(isSplitPaidSumSettled(20.7, 20.1, 2, DIGITS, 0.1)).toBe(false);
    // But exactly the stranded value over is accepted (boundary).
    expect(isSplitPaidSumSettled(20.2, 20.1, 2, DIGITS, 0.1)).toBe(true);
  });

  it('changes nothing when nothing strands', () => {
    expect(calcStrandedLoyaltyValue(100, [50, 50], 0.1, DIGITS)).toBe(0);
    expect(calcStrandedLoyaltyValue(0, [0, 0], 0.1, DIGITS)).toBe(0);
    // Never negative, even if the placed points somehow exceed the order.
    expect(calcStrandedLoyaltyValue(100, [60, 50], 0.1, DIGITS)).toBe(0);
    expect(calcStrandedLoyaltyValue(100, [50, 50], 0, DIGITS)).toBe(0);
    // The guard behaves exactly as before with zero stranded value,
    // with or without the (defaulted) fifth argument.
    expect(isSplitPaidSumSettled(114.01, 114.0, 3, DIGITS, 0)).toBe(true);
    expect(isSplitPaidSumSettled(114.01, 114.0, 3, DIGITS)).toBe(true);
    expect(isSplitPaidSumSettled(113.0, 114.0, 3, DIGITS, 0)).toBe(false);
    expect(isSplitPaidSumSettled(113.0, 114.0, 3, DIGITS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Render tests against the real modal.
// ---------------------------------------------------------------------------

function createMockPos(
  cart: PosItem[],
  totals: SplitOrderTotals,
  extra: {
    loyaltyPointsRedeemed?: number;
    discount?: number;
    loyaltyPointRedeemValue?: number;
    loyaltyMaxDiscountPercentage?: number;
    customerId?: string;
  } = {},
) {
  return {
    cart,
    totals,
    settings: {
      currency: 'EGP',
      ...(extra.loyaltyPointRedeemValue !== undefined
        ? { loyaltyPointRedeemValue: extra.loyaltyPointRedeemValue }
        : {}),
      ...(extra.loyaltyMaxDiscountPercentage !== undefined
        ? { loyaltyMaxDiscountPercentage: extra.loyaltyMaxDiscountPercentage }
        : {}),
    },
    settingsQuery: { data: { currency: 'EGP' } },
    customerId: extra.customerId ?? '',
    discount: extra.discount ?? 0,
    loyaltyPointsRedeemed: extra.loyaltyPointsRedeemed ?? 0,
    tipAmount: 0,
    orderType: 'dine_in',
    tableNumber: '5',
    paymentType: 'cash',
    paymentChannel: 'cash',
    note: '',
    search: '',
    priceType: 'retail',
    branchId: '1',
    locationId: '1',
    currentBranch: null,
    currentLocation: null,
    deliveryRepId: '',
    collectionStatus: 'cod',
    guestCount: 2,
    createSale: { isPending: false, mutateAsync: vi.fn().mockResolvedValue({ id: 1 }) },
    saveHeldDraftMutation: { mutateAsync: vi.fn().mockResolvedValue({}) },
    holdDraft: vi.fn(),
    setCart: vi.fn(),
    setTableNumber: vi.fn(),
  };
}

function renderModal(mockPos: ReturnType<typeof createMockPos>) {
  const onClose = vi.fn();
  const onSplitCompleted = vi.fn();
  render(
    <MemoryRouter>
      <PosSplitBillModal open pos={mockPos as never} onClose={onClose} onSplitCompleted={onSplitCompleted} />
    </MemoryRouter>,
  );
  return { onClose, onSplitCompleted };
}

describe('PosSplitBillModal — paying a bill posts the real total (B10)', () => {
  it('posts modifiers, allocated discount, real tax rate, service charge and tip — never the price-only sum', async () => {
    const burger = item({ lineKey: 'L1', productId: '1', name: 'برجر', modifiers: [cheese] });
    const fries = item({ lineKey: 'L2', productId: '2', name: 'بطاطس', price: 50, qty: 2, modifiers: [] });
    const totals = orderTotals({
      subTotal: 220,
      discountValue: 20,
      serviceCharge: 20,
      taxRate: 14,
      tipAmount: 10,
      total: 260.8,
    });
    const mockPos = createMockPos([burger, fries], totals);
    renderModal(mockPos);

    fireEvent.click(screen.getByRole('button', { name: 'تحصيل نقد' }));

    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.cart).toHaveLength(2);
    expect(payload.cart[0].modifiers).toEqual([cheese]);
    expect(payload.discount).toBe(20);
    expect(payload.deliveryFee).toBe(0);
    expect(payload.taxRate).toBe(14);
    expect(payload.pricesIncludeTax).toBe(false);
    expect(payload.serviceCharge).toBe(20);
    expect(payload.tipAmount).toBe(10);
    expect(payload.paidAmount).toBe(260.8);
    expect(payload.tenderedAmount).toBe(260.8);
    expect(payload.expectedTotal).toBe(260.8);
    expect(payload.payments).toEqual([{ paymentChannel: 'cash', amount: 260.8 }]);
    // Settled: the workspace cart is cleared.
    expect(mockPos.setCart).toHaveBeenCalledWith([]);
    expect(mockPos.setTableNumber).toHaveBeenCalledWith('');
  });
});

describe('PosSplitBillModal — split bills redeem loyalty points once, per bill (R6-C)', () => {
  function loyaltyPos() {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 100, modifiers: [] });
    const b = item({ lineKey: 'LB', productId: '2', name: 'صنف ب', price: 100, modifiers: [] });
    // Manual 20 + 100 points at 0.1 = 10 loyalty, combined 30, total 170.
    const totals = orderTotals({
      subTotal: 200,
      discountValue: 30,
      manualDiscount: 20,
      loyaltyPointsRedeemed: 100,
      loyaltyPointRedeemValue: 0.1,
      loyaltyMaxDiscountPercentage: 100,
      serviceCharge: 0,
      taxRate: 0,
      tipAmount: 0,
      total: 170,
    });
    return createMockPos([a, b], totals, {
      loyaltyPointsRedeemed: 100,
      discount: 20,
      loyaltyPointRedeemValue: 0.1,
      loyaltyMaxDiscountPercentage: 100,
      customerId: '7',
    });
  }

  it('posts each bill with the manual discount only plus its points share — never the combined discount and never zero points', async () => {
    const mockPos = loyaltyPos();
    renderModal(mockPos);

    // Move item B to Bill 2.
    const moveButtons = screen.getAllByTitle('نقل إلى الشيك 2');
    fireEvent.click(moveButtons[1]);

    // Pay Bill 1 (cash): 100 - 10 manual - 5 loyalty = 85.
    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const first = mockPos.createSale.mutateAsync.mock.calls[0][0];
    // Trap 1: the discount must carry NO loyalty share — the backend
    // adds the loyalty discount from the points itself.
    expect(first.discount).toBe(10);
    expect(first.loyaltyPointsRedeemed).toBe(50);
    expect(first.paidAmount).toBe(85);
    expect(first.tenderedAmount).toBe(85);
    expect(first.expectedTotal).toBe(85);

    // Pay Bill 2: the same manual share and the other 50 points.
    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(2));
    const second = mockPos.createSale.mutateAsync.mock.calls[1][0];
    expect(second.discount).toBe(10);
    expect(second.loyaltyPointsRedeemed).toBe(50);
    expect(second.paidAmount).toBe(85);
    expect(second.expectedTotal).toBe(85);
    // The parts sum to the order's redeemed points — deducted once
    // across parts, never double-redeemed, never beyond the order.
    const totalRedeemed = mockPos.createSale.mutateAsync.mock.calls.reduce(
      (s: number, c: any[]) => s + Number(c[0].loyaltyPointsRedeemed || 0),
      0,
    );
    expect(totalRedeemed).toBe(100);
    // Settled: 85 + 85 = the order total 170, so the split closes.
    expect(mockPos.setCart).toHaveBeenCalledWith([]);
    expect(mockPos.setTableNumber).toHaveBeenCalledWith('');
  });

  it('posts the even split as one sale with the manual discount only and the order’s full redeemed points', async () => {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 100, modifiers: [] });
    const totals = orderTotals({
      subTotal: 100,
      discountValue: 30,
      manualDiscount: 20,
      loyaltyPointsRedeemed: 100,
      loyaltyPointRedeemValue: 0.1,
      loyaltyMaxDiscountPercentage: 100,
      serviceCharge: 0,
      taxRate: 0,
      tipAmount: 0,
      total: 70,
    });
    const mockPos = createMockPos([a], totals, {
      loyaltyPointsRedeemed: 100,
      discount: 20,
      loyaltyPointRedeemValue: 0.1,
      loyaltyMaxDiscountPercentage: 100,
      customerId: '7',
    });
    renderModal(mockPos);
    fireEvent.click(screen.getByRole('button', { name: 'تقسيم بالتساوي (ضيوف)' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(screen.getByText(/تم التحصيل/)).toBeTruthy());
    expect(mockPos.createSale.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.discount).toBe(20);
    expect(payload.loyaltyPointsRedeemed).toBe(100);
    expect(payload.paidAmount).toBe(70);
    expect(payload.expectedTotal).toBe(70);
  });

  it('closes a stranded-points split: 201 points over two 10.05 bills pay 0.05 + 0.05 and settle, with no mismatch warning', async () => {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 10.05, modifiers: [] });
    const b = item({ lineKey: 'LB', productId: '2', name: 'صنف ب', price: 10.05, modifiers: [] });
    // Subtotal 20.10, 201 points at 0.1 = 20.10 loyalty discount, total 0.
    const totals = orderTotals({
      subTotal: 20.1,
      discountValue: 20.1,
      manualDiscount: 0,
      loyaltyPointsRedeemed: 201,
      loyaltyPointRedeemValue: 0.1,
      loyaltyMaxDiscountPercentage: 100,
      serviceCharge: 0,
      taxRate: 0,
      tipAmount: 0,
      total: 0,
    });
    const mockPos = createMockPos([a, b], totals, {
      loyaltyPointsRedeemed: 201,
      discount: 0,
      loyaltyPointRedeemValue: 0.1,
      loyaltyMaxDiscountPercentage: 100,
      customerId: '7',
    });
    renderModal(mockPos);

    // Move item B to Bill 2.
    const moveButtons = screen.getAllByTitle('نقل إلى الشيك 2');
    fireEvent.click(moveButtons[1]);

    // The distributed sum (0.10) exceeds the order total (0) by exactly
    // the stranded 0.10 — the display must NOT warn while closing is
    // allowed (before this repair it warned here and the guard refused).
    expect(screen.queryByText(/لا يطابق/)).toBeNull();

    // Pay Bill 1 (cash): 10.05 - 10.00 loyalty = 0.05, 100 points.
    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const first = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(first.discount).toBe(0);
    expect(first.loyaltyPointsRedeemed).toBe(100);
    expect(first.paidAmount).toBe(0.05);
    expect(first.expectedTotal).toBe(0.05);

    // Pay Bill 2: the other 100 points, the same 0.05.
    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(2));
    const second = mockPos.createSale.mutateAsync.mock.calls[1][0];
    expect(second.discount).toBe(0);
    expect(second.loyaltyPointsRedeemed).toBe(100);
    expect(second.paidAmount).toBe(0.05);
    // The stranded point stays with the customer: only 200 of the 201
    // order points were redeemed across the parts.
    const totalRedeemed = mockPos.createSale.mutateAsync.mock.calls.reduce(
      (s: number, c: any[]) => s + Number(c[0].loyaltyPointsRedeemed || 0),
      0,
    );
    expect(totalRedeemed).toBe(200);
    // Settled: 0.05 + 0.05 = order total 0 + stranded 0.10, so the
    // split closes and the cart clears — the cashier is not stuck with
    // a posted-but-unsettled split.
    expect(mockPos.setCart).toHaveBeenCalledWith([]);
    expect(mockPos.setTableNumber).toHaveBeenCalledWith('');
  });
});

describe('PosSplitBillModal — paying one bill never resets the others (I32)', () => {
  it('keeps the paid badge and the other bills after paying the middle bill of three items', async () => {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 10, modifiers: [] });
    const b = item({ lineKey: 'LB', productId: '2', name: 'صنف ب', price: 10, modifiers: [] });
    const c = item({ lineKey: 'LC', productId: '3', name: 'صنف ج', price: 10, modifiers: [] });
    const totals = orderTotals({ subTotal: 30, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 30 });
    const mockPos = createMockPos([a, b, c], totals);
    const { rerender } = render(
      <MemoryRouter>
        <PosSplitBillModal open pos={mockPos as never} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // Move item C to Bill 2 (third transfer button, in row order).
    const moveButtons = screen.getAllByTitle('نقل إلى الشيك 2');
    expect(moveButtons).toHaveLength(3);
    fireEvent.click(moveButtons[2]);
    expect(screen.getByText('صنف ج')).toBeTruthy();

    // Pay Bill 1 (cash): the first 'تحصيل نقد' button.
    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.cart.map((i: PosItem) => i.name)).toEqual(['صنف أ', 'صنف ب']);
    expect(payload.paidAmount).toBe(20);
    // The modal syncs the remaining items back to the workspace cart.
    expect(mockPos.setCart).toHaveBeenCalledWith([expect.objectContaining({ name: 'صنف ج' })]);

    // The parent applies that setCart: the workspace cart is now [C] only.
    // The modal must NOT re-initialise its bills from the new cart.
    const nextPos = createMockPos(
      [c],
      orderTotals({ subTotal: 10, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 10 }),
    );
    rerender(
      <MemoryRouter>
        <PosSplitBillModal open pos={nextPos as never} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // Bill 1 still shows its paid badge, Bill 2 still holds item C.
    expect(screen.getByText(/تم السداد/)).toBeTruthy();
    expect(screen.getByText('صنف ج')).toBeTruthy();
    expect(screen.getByText('الشيك 2')).toBeTruthy();
  });
});

describe('PosSplitBillModal — fractional split posts shares, not double-charged parts (B11)', () => {
  it('splits 100 + 20 into two 60 parts with no modifiers and no mismatch warning', async () => {
    const burger = item({ modifiers: [cheese] });
    const totals = orderTotals({ subTotal: 120, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 120 });
    const mockPos = createMockPos([burger], totals);
    renderModal(mockPos);

    fireEvent.click(screen.getByRole('button', { name: '½ نصفين' }));
    expect(screen.getByText(/حصة 1\/2/)).toBeTruthy();
    expect(screen.getByText(/حصة 2\/2/)).toBeTruthy();
    expect(screen.queryByText(/لا يطابق/)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'تحصيل نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.cart).toHaveLength(1);
    expect(payload.cart[0].price).toBe(60);
    expect(payload.cart[0].qty).toBe(1);
    expect(payload.cart[0].modifiers).toEqual([]);
    expect(payload.paidAmount).toBe(60);
    expect(payload.expectedTotal).toBe(60);
  });
});

describe('PosSplitBillModal — save as drafts saves each bill under its own check (B12)', () => {
  it('calls the held-draft mutation once per bill with that bill’s own items and table label', async () => {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 10, modifiers: [] });
    const b = item({ lineKey: 'LB', productId: '2', name: 'صنف ب', price: 10, modifiers: [] });
    const totals = orderTotals({ subTotal: 20, discountValue: 0, serviceCharge: 0, taxRate: 0, tipAmount: 0, total: 20 });
    const mockPos = createMockPos([a, b], totals);
    renderModal(mockPos);

    const moveButtons = screen.getAllByTitle('نقل إلى الشيك 2');
    fireEvent.click(moveButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: 'حفظ الشيكات كطلبات معلقة منفصلة في الصالة' }));
    await waitFor(() => expect(mockPos.saveHeldDraftMutation.mutateAsync).toHaveBeenCalledTimes(2));
    const [first, second] = mockPos.saveHeldDraftMutation.mutateAsync.mock.calls.map((c) => c[0]);
    expect(first.tableNumber).toBe('5 - شيك 1');
    expect(first.items.map((i: { productId: number }) => i.productId)).toEqual([1]);
    expect(second.tableNumber).toBe('5 - شيك 2');
    expect(second.items.map((i: { productId: number }) => i.productId)).toEqual([2]);
    // The workspace cart is only reset at the end — never overwritten per bill.
    expect(mockPos.setCart).toHaveBeenCalledTimes(1);
    expect(mockPos.setCart).toHaveBeenCalledWith([]);
    expect(mockPos.setTableNumber).toHaveBeenCalledWith('');
  });
});

describe('PosSplitBillModal — even split never shows a guest paid before the sale posts (I33)', () => {
  function evenPos() {
    const a = item({ lineKey: 'LA', productId: '1', name: 'صنف أ', price: 100, modifiers: [] });
    const totals = orderTotals({
      subTotal: 100,
      discountValue: 0,
      serviceCharge: 10,
      taxRate: 14,
      tipAmount: 0,
      total: 125.4,
    });
    return createMockPos([a], totals);
  }

  function switchToEven() {
    fireEvent.click(screen.getByRole('button', { name: 'تقسيم بالتساوي (ضيوف)' }));
  }

  it('collects the first guest without marking paid and posts the real final sale when all collected', async () => {
    const mockPos = evenPos();
    renderModal(mockPos);
    switchToEven();

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(screen.getByText(/تم التحصيل/)).toBeTruthy());
    expect(mockPos.createSale.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText(/تم السداد/)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockPos.createSale.mutateAsync.mock.calls[0][0];
    expect(payload.taxRate).toBe(14);
    expect(payload.pricesIncludeTax).toBe(false);
    expect(payload.deliveryFee).toBe(0);
    expect(payload.serviceCharge).toBe(10);
    expect(payload.tipAmount).toBe(0);
    expect(payload.discount).toBe(0);
    expect(payload.paymentChannel).toBe('cash');
    expect(payload.paidAmount).toBe(125.4);
    expect(payload.expectedTotal).toBe(125.4);
    expect(payload.payments).toEqual([{ paymentChannel: 'cash', amount: 125.4 }]);
    await waitFor(() => expect(screen.getAllByText(/تم السداد/)).toHaveLength(2));
  });

  it('leaves no guest paid when the final post fails, and the retry posts it', async () => {
    const mockPos = evenPos();
    mockPos.createSale.mutateAsync
      .mockRejectedValueOnce(new Error('انقطع الاتصال'))
      .mockResolvedValue({ id: 7 });
    renderModal(mockPos);
    switchToEven();

    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(screen.getByText(/تم التحصيل/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: 'سداد نقد' })[0]);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/تم السداد/)).toBeNull();
    expect(screen.getAllByText(/تم التحصيل/)).toHaveLength(2);

    const retry = await screen.findByRole('button', { name: 'إعادة محاولة ترحيل البيع' });
    fireEvent.click(retry);
    await waitFor(() => expect(mockPos.createSale.mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(/تم السداد/)).toHaveLength(2));
  });
});

/* R-I34 / INV-REST-LINE-IDENTITY: split moves used to match on
 * product + unit + price, so a modified line moved onto a bill holding the
 * same product plain collapsed into it and the moved modifiers vanished.
 * Moves now match on lineKey only. */
describe('PosSplitBillModal — split moves never collapse lines that differ only by modifiers (R-I34)', () => {
  const cheese = { price: 20, qty: 1, name: 'جبنة إضافية' };
  const bill = (id: string, items: PosItem[]) => ({ id, name: `الشيك ${id}`, items, isPaid: false });

  it('moving a modified line onto a bill holding the same product plain keeps two lines with modifiers intact', () => {
    const modified = item({ lineKey: 'p1::u1::retail::cheese', productId: '1', price: 100, qty: 1, modifiers: [cheese] });
    const plain = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const next = moveSplitBillItem([bill('b1', [modified]), bill('b2', [plain])], 'b1', 'b2', modified.lineKey, 1);
    expect(next[0].items).toHaveLength(0);
    expect(next[1].items).toHaveLength(2);
    const moved = next[1].items.find((line) => (line.modifiers || []).length === 1);
    expect(moved).toBeTruthy();
    expect(calcCartLineTotal(moved!)).toBe(120);
    expect(next[1].items.reduce((sum, line) => sum + calcCartLineTotal(line), 0)).toBe(220);
  });

  it('moving a partial quantity keeps the modifiers on the moved half and leaves the remainder untouched', () => {
    const modified = item({ lineKey: 'p1::u1::retail::cheese', productId: '1', price: 100, qty: 2, modifiers: [cheese] });
    const next = moveSplitBillItem([bill('b1', [modified]), bill('b2', [])], 'b1', 'b2', modified.lineKey, 1);
    expect(next[0].items[0].qty).toBe(1);
    expect(next[0].items[0].modifiers).toEqual([cheese]);
    expect(next[1].items).toHaveLength(1);
    expect(next[1].items[0].qty).toBe(1);
    expect(next[1].items[0].modifiers).toEqual([cheese]);
    expect(next[1].items[0].lineKey).not.toBe(modified.lineKey);
  });

  it('moving an identical line merges quantities instead of duplicating it', () => {
    const line = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const other = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const next = moveSplitBillItem([bill('b1', [line]), bill('b2', [other])], 'b1', 'b2', line.lineKey, 1);
    expect(next[0].items).toHaveLength(0);
    expect(next[1].items).toHaveLength(1);
    expect(next[1].items[0].qty).toBe(2);
  });

  it('move-all with differing modifiers never collapses', () => {
    const modified = item({ lineKey: 'p1::u1::retail::cheese', productId: '1', price: 100, qty: 1, modifiers: [cheese] });
    const plain = item({ lineKey: 'p1::u1::retail', productId: '1', price: 100, qty: 1, modifiers: [] });
    const next = moveSplitBillItems([bill('b1', [modified]), bill('b2', [plain])], 'b1', 'b2');
    expect(next[0].items).toHaveLength(0);
    expect(next[1].items).toHaveLength(2);
    expect(next[1].items.reduce((sum, line) => sum + calcCartLineTotal(line), 0)).toBe(220);
  });
});
