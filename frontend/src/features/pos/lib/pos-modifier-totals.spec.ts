/* R-B8 (INV-REST-MODIFIER-QTY-TOTALS): frontend line totals must charge each modifier
 * price * qty, exactly like the backend (sales-write.helper.ts buildPreparedSaleItem).
 * At base the frontend summed price only, so a modifier with qty 2 was under-displayed
 * on screen and on the receipt while the posted sale charged the full amount. */

import { describe, it, expect } from 'vitest';
import { calcModifiersTotal, calcCartLineDiscount, calcCartLineNetTotal, calcCartLineTotal, calcLineDiscountAmountFromPercent, calcLineDiscountPercent, buildCustomerDisplayItems } from './pos-modifier-totals';

describe('pos-modifier-totals (R-B8)', () => {
  describe('calcModifiersTotal', () => {
    it('charges price * qty per modifier: price 20 qty 2 totals 40', () => {
      expect(calcModifiersTotal([{ price: 20, qty: 2 }])).toBe(40);
    });

    it('sums several modifiers with quantities', () => {
      expect(
        calcModifiersTotal([
          { price: 20, qty: 2 },
          { price: 5, qty: 3 },
          { price: 10, qty: 1 },
        ]),
      ).toBe(65);
    });

    it('counts a modifier with no qty once, like the backend', () => {
      expect(calcModifiersTotal([{ price: 20 }])).toBe(20);
    });

    it('returns 0 for no modifiers', () => {
      expect(calcModifiersTotal([])).toBe(0);
      expect(calcModifiersTotal(undefined)).toBe(0);
      expect(calcModifiersTotal(null)).toBe(0);
    });
  });

  describe('calcCartLineTotal', () => {
    it('one item qty 1, modifier price 20 qty 2 -> line total 1 * (100 + 40) = 140', () => {
      expect(calcCartLineTotal({ qty: 1, price: 100, modifiers: [{ price: 20, qty: 2 }] })).toBe(140);
    });

    it('multiplies the modifier surcharge by the item qty too', () => {
      // 2 burgers at 100, extra cheese 20 x2 per burger -> 2 * (100 + 40) = 280
      expect(calcCartLineTotal({ qty: 2, price: 100, modifiers: [{ price: 20, qty: 2 }] })).toBe(280);
    });

    it('is unchanged for qty-1 modifiers (no regression on the common case)', () => {
      expect(calcCartLineTotal({ qty: 1, price: 100, modifiers: [{ price: 20, qty: 1 }] })).toBe(120);
      expect(calcCartLineTotal({ qty: 3, price: 50, modifiers: [] })).toBe(150);
    });
  });

  describe('buildCustomerDisplayItems (R5-A, R-I14)', () => {
    it('charges modifiers in the CFD line total: 2 burgers with extra cheese 20 x2 -> 280', () => {
      const items = buildCustomerDisplayItems([
        {
          productId: '1',
          lineKey: 'L1',
          name: 'برجر',
          qty: 2,
          price: 100,
          modifiers: [{ name: 'جبنة إضافية', price: 20, qty: 2 }],
        },
      ]);
      expect(items).toHaveLength(1);
      expect(items[0].lineTotal).toBe(280);
      // The unit price the display shows must be the charged per-unit
      // price (base + modifiers), not the bare base price.
      expect(items[0].price).toBe(140);
    });

    it('carries modifier names, quantities and the line note to the display', () => {
      const items = buildCustomerDisplayItems([
        {
          productId: '1',
          lineKey: 'L1',
          name: 'برجر',
          qty: 1,
          price: 100,
          notes: 'بدون بصل',
          modifiers: [
            { name: 'جبنة إضافية', price: 20, qty: 1 },
            { name: 'صوص حار', price: 5, qty: 2 },
          ],
        },
      ]);
      expect(items[0].lineTotal).toBe(130);
      expect(items[0].notes).toBe('بدون بصل');
      expect(items[0].modifiers).toEqual([
        { name: 'جبنة إضافية', qty: 1, price: 20 },
        { name: 'صوص حار', qty: 2, price: 5 },
      ]);
    });

    it('is unchanged for lines without modifiers', () => {
      const items = buildCustomerDisplayItems([
        { productId: '1', lineKey: 'L1', name: 'بطاطس', qty: 3, price: 50, modifiers: [] },
      ]);
      expect(items[0].lineTotal).toBe(150);
      expect(items[0].price).toBe(50);
      expect(items[0].modifiers).toEqual([]);
    });
  });
});

/* INV-POS-LINE-DISCOUNT: the per-line discount in force is the entered
 * amount clamped to [0, line gross]; the net line total is the gross
 * minus that discount, matching the backend's buildPreparedSaleItem
 * lineTotal exactly. The customer display shows the net total. */
describe('pos-modifier-totals line discount (INV-POS-LINE-DISCOUNT)', () => {
  describe('calcCartLineDiscount', () => {
    it('returns the entered discount inside the gross', () => {
      expect(calcCartLineDiscount({ qty: 2, price: 100, lineDiscount: 30 })).toBe(30);
    });

    it('returns 0 for a line without a discount', () => {
      expect(calcCartLineDiscount({ qty: 2, price: 100 })).toBe(0);
      expect(calcCartLineDiscount({ qty: 2, price: 100, lineDiscount: 0 })).toBe(0);
    });

    it('clamps a discount above the line gross to the gross', () => {
      expect(calcCartLineDiscount({ qty: 2, price: 100, lineDiscount: 250 })).toBe(200);
    });

    it('counts modifiers toward the gross cap', () => {
      expect(calcCartLineDiscount({ qty: 1, price: 100, modifiers: [{ price: 20, qty: 1 }], lineDiscount: 150 })).toBe(120);
    });

    it('ignores a negative discount', () => {
      expect(calcCartLineDiscount({ qty: 2, price: 100, lineDiscount: -5 })).toBe(0);
    });
  });

  describe('calcCartLineNetTotal', () => {
    it('subtracts the line discount from the gross', () => {
      expect(calcCartLineNetTotal({ qty: 2, price: 100, lineDiscount: 30 })).toBe(170);
    });

    it('nets a fully-discounted line to zero', () => {
      expect(calcCartLineNetTotal({ qty: 1, price: 50, lineDiscount: 50 })).toBe(0);
    });

    it('is the gross when there is no line discount', () => {
      expect(calcCartLineNetTotal({ qty: 2, price: 100, modifiers: [{ price: 20, qty: 2 }] })).toBe(280);
    });
  });

  describe('buildCustomerDisplayItems line discount', () => {
    it('shows the net line total and the line discount', () => {
      const items = buildCustomerDisplayItems([
        { productId: '1', lineKey: 'L1', name: 'قميص', qty: 2, price: 100, modifiers: [], lineDiscount: 30 },
      ]);
      expect(items[0].lineTotal).toBe(170);
      expect(items[0].lineDiscount).toBe(30);
    });
  });
});

/* F1b (van trial problem 21): the cart line-discount input takes a
 * PERCENT of the line gross, not an amount. Trial pin: typing 50 on
 * a 24.00 line is a 12.00 discount — the old amount input clamped
 * the 50 to the full 24.00 and zeroed the line. The stored
 * lineDiscount stays an AMOUNT (the backend contract); only the
 * input interprets keystrokes as a percent. */
describe('pos-modifier-totals line discount percent (F1b)', () => {
  describe('calcLineDiscountAmountFromPercent', () => {
    it('pins the trial case: 50% of a 24.00 line is 12.00, not the clamped 24.00', () => {
      expect(calcLineDiscountAmountFromPercent({ qty: 1, price: 24 }, 50)).toBe(12);
    });

    it('returns 0 at 0% and the whole gross at 100%', () => {
      expect(calcLineDiscountAmountFromPercent({ qty: 1, price: 24 }, 0)).toBe(0);
      expect(calcLineDiscountAmountFromPercent({ qty: 1, price: 24 }, 100)).toBe(24);
    });

    it('clamps a percent above 100 to the whole gross and a negative percent to 0', () => {
      expect(calcLineDiscountAmountFromPercent({ qty: 1, price: 24 }, 150)).toBe(24);
      expect(calcLineDiscountAmountFromPercent({ qty: 1, price: 24 }, -5)).toBe(0);
    });

    it('counts modifiers toward the gross the percent divides', () => {
      expect(calcLineDiscountAmountFromPercent({ qty: 1, price: 100, modifiers: [{ price: 20, qty: 1 }] }, 50)).toBe(60);
    });

    it('scales with quantity: 50% of 2 x 24.00 is 24.00', () => {
      expect(calcLineDiscountAmountFromPercent({ qty: 2, price: 24 }, 50)).toBe(24);
    });
  });

  describe('calcLineDiscountPercent', () => {
    it('converts the stored amount back to its percent of the line gross', () => {
      expect(calcLineDiscountPercent({ qty: 1, price: 24, lineDiscount: 12 })).toBe(50);
    });

    it('returns 0 for no discount or a zero gross', () => {
      expect(calcLineDiscountPercent({ qty: 1, price: 24 })).toBe(0);
      expect(calcLineDiscountPercent({ qty: 0, price: 24, lineDiscount: 5 })).toBe(0);
    });
  });
});
