/* R-B8 (INV-REST-MODIFIER-QTY-TOTALS): frontend line totals must charge each modifier
 * price * qty, exactly like the backend (sales-write.helper.ts buildPreparedSaleItem).
 * At base the frontend summed price only, so a modifier with qty 2 was under-displayed
 * on screen and on the receipt while the posted sale charged the full amount. */

import { describe, it, expect } from 'vitest';
import { calcModifiersTotal, calcCartLineTotal } from './pos-modifier-totals';

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
});
