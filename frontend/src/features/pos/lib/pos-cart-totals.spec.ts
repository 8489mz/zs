/* INV-POS-LINE-DISCOUNT: the ONE pure POS totals computation (see
 * pos-cart-totals.ts). Order of operations is the backend's: gross
 * cart total -> minus per-line discounts -> net subtotal -> minus the
 * header discount (manual + loyalty) -> service charge -> tax ->
 * total. The loyalty cap and the discount base divide the NET
 * subtotal, matching the backend exactly. */

import { describe, expect, it } from 'vitest';
import { calcInvoiceDiscountAmountFromPercent, calcInvoiceDiscountPercent, computePosCartTotals } from './pos-cart-totals';
import type { PosItem } from '@/features/pos/types/pos.types';

function line(overrides: Partial<PosItem> = {}): PosItem {
  return {
    productId: '1',
    name: 'صنف اختبار',
    qty: 1,
    price: 100,
    costPrice: 80,
    unitName: 'قطعة',
    unitId: 'unit-1',
    unitMultiplier: 1,
    priceType: 'retail',
    lineKey: '1::قطعة::retail',
    stockLimit: 100,
    currentStock: 100,
    minStock: 0,
    ...overrides,
  };
}

const baseInput = {
  discount: 0,
  deliveryFee: 0,
  orderType: 'direct',
  bookDigits: 2 as const,
  settings: {},
};

describe('computePosCartTotals (INV-POS-LINE-DISCOUNT)', () => {
  it('keeps the gross subtotal and the total unchanged with no discounts', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      cart: [line({ qty: 2, price: 100 }), line({ productId: '2', qty: 1, price: 50 })],
    });
    expect(totals.subTotal).toBe(250);
    expect(totals.lineDiscountTotal).toBe(0);
    expect(totals.netSubTotal).toBe(250);
    expect(totals.total).toBe(250);
  });

  it('subtracts the per-line discounts before the header discount', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      discount: 20,
      cart: [line({ qty: 2, price: 100, lineDiscount: 30 }), line({ productId: '2', qty: 1, price: 50 })],
    });
    expect(totals.subTotal).toBe(250);
    expect(totals.lineDiscountTotal).toBe(30);
    expect(totals.netSubTotal).toBe(220);
    expect(totals.discountValue).toBe(20);
    expect(totals.total).toBe(200);
  });

  it('caps the loyalty discount at a percentage of the NET subtotal', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      loyaltyPointsRedeemed: 1000,
      cart: [line({ qty: 2, price: 100, lineDiscount: 30 }), line({ productId: '2', qty: 1, price: 50 })],
      settings: { loyaltyPointRedeemValue: 0.1, loyaltyMaxDiscountPercentage: 10 },
    });
    // Raw loyalty value is 100; the cap is 10% of the NET 220 = 22
    // (10% of the gross 250 would be 25 — the net base is what
    // distinguishes the two).
    expect(totals.loyaltyDiscount).toBe(22);
    expect(totals.total).toBe(198);
  });

  it('charges the dine-in service charge on the discounted base', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      orderType: 'dine_in',
      cart: [line({ qty: 2, price: 100, lineDiscount: 30 }), line({ productId: '2', qty: 1, price: 50 })],
      settings: { restaurantServiceChargeEnabled: true, restaurantServiceChargePercent: 10 },
    });
    expect(totals.serviceCharge).toBe(22);
    expect(totals.total).toBe(242);
  });

  it('taxes the net discounted base (exclusive tax)', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      cart: [line({ qty: 2, price: 100, lineDiscount: 30 }), line({ productId: '2', qty: 1, price: 50 })],
      settings: { taxRate: 14, taxMode: 'exclusive' },
    });
    expect(totals.taxAmount).toBe(30.8);
    expect(totals.total).toBe(250.8);
  });

  it('never lets the header discount take the total below zero', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      discount: 300,
      cart: [line({ qty: 2, price: 100, lineDiscount: 30 })],
    });
    expect(totals.netSubTotal).toBe(170);
    expect(totals.total).toBe(0);
  });

  it('adds delivery fee and tip after the discounts', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      deliveryFee: 10,
      tipAmount: 5,
      cart: [line({ qty: 2, price: 100, lineDiscount: 30 }), line({ productId: '2', qty: 1, price: 50 })],
    });
    expect(totals.total).toBe(235);
  });
});

/* F1b (van trial problems 20/21): the invoice "%" input is a percent
 * of the NET subtotal (gross minus line discounts), never of the
 * gross. Trial pin: gross 100.00 with a 4.00 line discount nets to
 * 96.00, so 4% is 3.84 — the old gross base gave 4.00. */
describe('invoice discount percent (F1b)', () => {
  it('pins the trial case: 4% of net 96.00 (gross 100.00 minus 4.00 line discount) is 3.84', () => {
    const totals = computePosCartTotals({
      ...baseInput,
      cart: [line({ qty: 1, price: 100, lineDiscount: 4 })],
    });
    expect(totals.subTotal).toBe(100);
    expect(totals.netSubTotal).toBe(96);
    expect(calcInvoiceDiscountAmountFromPercent(4, totals.netSubTotal, 2)).toBe(3.84);
  });

  it('returns 0 at 0% and the whole net base at 100%', () => {
    expect(calcInvoiceDiscountAmountFromPercent(0, 96, 2)).toBe(0);
    expect(calcInvoiceDiscountAmountFromPercent(100, 96, 2)).toBe(96);
  });

  it('clamps a percent above 100 to the whole net base and a negative percent to 0', () => {
    expect(calcInvoiceDiscountAmountFromPercent(150, 96, 2)).toBe(96);
    expect(calcInvoiceDiscountAmountFromPercent(-5, 96, 2)).toBe(0);
  });

  it('returns 0 when the net base is 0', () => {
    expect(calcInvoiceDiscountAmountFromPercent(50, 0, 2)).toBe(0);
  });

  it('rounds the produced amount at book digits', () => {
    expect(calcInvoiceDiscountAmountFromPercent(33.33, 10, 2)).toBe(3.33);
    expect(calcInvoiceDiscountAmountFromPercent(33.33, 10, 3)).toBe(3.333);
  });

  describe('calcInvoiceDiscountPercent', () => {
    it('converts the stored amount back to its percent of the net base', () => {
      expect(calcInvoiceDiscountPercent(3.84, 96)).toBe(4);
    });

    it('returns 0 for no discount or a zero net base', () => {
      expect(calcInvoiceDiscountPercent(0, 96)).toBe(0);
      expect(calcInvoiceDiscountPercent(4, 0)).toBe(0);
    });
  });
});
