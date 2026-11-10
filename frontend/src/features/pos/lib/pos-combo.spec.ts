/* R-B9 combo builder (INV-REST-COMBO-LINE): the old onAddComboToCart ignored
 * handleAddProduct's boolean return and stamped the combo name/notes/modifiers
 * onto prevCart[prevCart.length - 1] — the wrong line whenever the add failed
 * (out of stock) or merged into a plain line of the same product already in
 * the cart — and it never used combo.price, so an offer-repriced main posted
 * a different total than the modal displayed (totalComboPrice).
 * These tests drive the pure helper applyComboToCart that replaces that logic:
 * a failed add leaves the cart untouched, a combo always lands on its own new
 * line, and the posted line total equals the modal's displayed total. */

import { describe, expect, it } from 'vitest';
import { addPosItem, applyComboToCart, buildComboLineKey } from '@/features/pos/lib/pos.domain';
import type { Product } from '@/types/domain';

const burger: Product = {
  id: 'burger',
  name: 'برجر',
  categoryId: '',
  supplierId: '',
  costPrice: 40,
  retailPrice: 100,
  wholesalePrice: 80,
  stock: 10,
  minStock: 0,
  notes: '',
  barcode: 'burger-1',
  units: [{ id: 'u1', name: 'قطعة', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
};

const combo = {
  productId: 'burger',
  productName: 'وجبة كومبو (برجر)',
  // Modal base price; totalComboPrice shown to the customer is 100 + 12 + 15 = 127.
  price: 100,
  modifiers: [
    { name: 'طبق جانبي: بطاطس مقلية بالجبنة الشيدر', price: 12 },
    { name: 'مشروب: عصير برتقال فريش طبيعي', price: 15 },
  ],
  notes: 'بدون بصل',
};

function lineTotal(line: { qty: number; price: number; modifiers?: Array<{ price: number }> }) {
  const modifiersTotal = (line.modifiers || []).reduce((sum, mod) => sum + Number(mod.price || 0), 0);
  return line.qty * (line.price + modifiersTotal);
}

describe('applyComboToCart (R-B9)', () => {
  it('adds the combo as its own line with the modal total on an empty cart', () => {
    const { cart, lineKey } = applyComboToCart([], burger, combo, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-1',
    });

    expect(cart).toHaveLength(1);
    expect(lineKey).toBe(buildComboLineKey(burger, 'retail', 'combo-1'));
    const line = cart[0];
    expect(line.lineKey).toBe(lineKey);
    expect(line.qty).toBe(1);
    expect(line.name).toBe('وجبة كومبو (برجر)');
    expect(line.notes).toBe('بدون بصل');
    expect(line.modifiers).toEqual(combo.modifiers);
    expect(line.price).toBe(100);
    expect(lineTotal(line)).toBe(127);
  });

  it('leaves the cart unchanged when the main is out of stock', () => {
    const outOfStock: Product = { ...burger, stock: 0 };
    const plainCart = addPosItem([], { ...burger, id: 'fries', name: 'بطاطس', stock: 5 }, { priceType: 'retail', digits: 2 });

    expect(() => applyComboToCart(plainCart, outOfStock, combo, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-2',
    })).toThrow('الصنف غير متاح للبيع حاليًا');
    expect(plainCart).toHaveLength(1);
    expect(plainCart[0].name).toBe('بطاطس');
  });

  it('never merges into a plain line of the same product already in the cart', () => {
    const plainCart = addPosItem([], burger, { priceType: 'retail', digits: 2 });
    expect(plainCart).toHaveLength(1);

    const { cart } = applyComboToCart(plainCart, burger, combo, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-3',
    });

    expect(cart).toHaveLength(2);
    const plainLine = cart.find((line) => line.lineKey === plainCart[0].lineKey);
    expect(plainLine?.qty).toBe(1);
    expect(plainLine?.name).toBe('برجر');
    expect(plainLine?.modifiers).toBeUndefined();
    expect(plainLine?.price).toBe(100);
    const comboLine = cart.find((line) => line.lineKey !== plainCart[0].lineKey);
    expect(comboLine?.qty).toBe(1);
    expect(comboLine?.name).toBe('وجبة كومبو (برجر)');
    expect(comboLine?.modifiers).toEqual(combo.modifiers);
    expect(lineTotal(comboLine!)).toBe(127);
  });

  it('refuses the combo when the last unit is already in the cart as a plain line', () => {
    const oneInStock: Product = { ...burger, stock: 1 };
    const plainCart = addPosItem([], oneInStock, { priceType: 'retail', digits: 2 });
    expect(plainCart[0].qty).toBe(1);

    expect(() => applyComboToCart(plainCart, oneInStock, combo, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-4',
    })).toThrow('الكمية المطلوبة أكبر من المخزون المتاح');
    expect(plainCart).toHaveLength(1);
    expect(plainCart[0].qty).toBe(1);
  });

  it('posts the modal total even when an offer would reprice the main', () => {
    const offered: Product = {
      ...burger,
      offers: [{ id: 'offer-20', type: 'percent', value: 20, minQty: 1 }],
    };
    // Sanity: the catalog price really is offer-repriced (80), so stamping
    // the modal base price (100) is what makes posted == displayed.
    const repriced = addPosItem([], offered, { priceType: 'retail', digits: 2 });
    expect(repriced[0].price).toBe(80);

    const { cart } = applyComboToCart([], offered, combo, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-5',
    });

    expect(cart[0].price).toBe(100);
    expect(cart[0].offerDiscount).toBe(0);
    expect(cart[0].offerName).toBeUndefined();
    expect(lineTotal(cart[0])).toBe(127);
  });

  it('gives two identical combos two separate lines instead of merging them', () => {
    const once = applyComboToCart([], burger, combo, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-6a',
    });
    const twice = applyComboToCart(once.cart, burger, combo, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-6b',
    });

    expect(twice.cart).toHaveLength(2);
    expect(twice.cart[0].qty).toBe(1);
    expect(twice.cart[1].qty).toBe(1);
    expect(lineTotal(twice.cart[0])).toBe(127);
    expect(lineTotal(twice.cart[1])).toBe(127);
  });

  it('addPosItem with a lineKeySuffix never merges into a plain line', () => {
    const plainCart = addPosItem([], burger, { priceType: 'retail', digits: 2 });
    const suffixed = addPosItem(plainCart, burger, {
      priceType: 'retail',
      digits: 2,
      lineKeySuffix: 'combo-7',
    });

    expect(suffixed).toHaveLength(2);
    expect(suffixed[0].qty).toBe(1);
    expect(suffixed[1].qty).toBe(1);
    expect(suffixed[1].lineKey).toBe(`${plainCart[0].lineKey}::combo-7`);
  });
});

/* T11-A (INV-REST-COMBO-SUBMIT-TRUTH): the stamp must refuse a 0
 * component price when the catalog price is non-zero — fail loud, do
 * not stamp a 0 the server will re-price to DB retail_price and then
 * 422 SALE_TOTAL_MISMATCH. At base the stamp takes the modal's prices
 * at face value, so every refusal case below passes the stamp and the
 * cart lands with the 0. A genuinely free component (catalog price 0)
 * still stamps at 0. The refusal happens before any cart write, so a
 * refused combo leaves the cart untouched. */
describe('applyComboToCart — refuses a 0 component price (T11-A)', () => {
  it('refuses a 0 main price when the catalog price is non-zero', () => {
    expect(() => applyComboToCart([], burger, { ...combo, price: 0 }, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-t11a-1',
    })).toThrow(/صفر/);
  });

  it('leaves the cart untouched when the main price is refused', () => {
    const plainCart = addPosItem([], { ...burger, id: 'fries', name: 'بطاطس', stock: 5 }, { priceType: 'retail', digits: 2 });
    expect(() => applyComboToCart(plainCart, burger, { ...combo, price: 0 }, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-t11a-2',
    })).toThrow(/صفر/);
    expect(plainCart).toHaveLength(1);
    expect(plainCart[0].name).toBe('بطاطس');
  });

  it('refuses a 0 modifier price when its catalog price is non-zero', () => {
    const zeroSide = {
      ...combo,
      modifiers: [
        { name: 'طبق جانبي: بطاطس', price: 0, catalogPrice: 75 },
        { name: 'مشروب: عصير', price: 15, catalogPrice: 15 },
      ],
    };
    expect(() => applyComboToCart([], burger, zeroSide, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-t11a-3',
    })).toThrow(/بطاطس/);
  });

  it('allows a genuinely free side (catalog price 0) at 0', () => {
    const freeSide = {
      ...combo,
      modifiers: [
        { name: 'طبق جانبي: بطاطس', price: 0, catalogPrice: 0 },
        { name: 'مشروب: عصير', price: 15, catalogPrice: 15 },
      ],
    };
    const { cart } = applyComboToCart([], burger, freeSide, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-t11a-4',
    });

    expect(cart).toHaveLength(1);
    expect(cart[0].price).toBe(100);
    expect(lineTotal(cart[0])).toBe(115);
  });

  it('allows a 0 main price when the catalog price is 0', () => {
    const freeMain: Product = { ...burger, retailPrice: 0 };
    const { cart } = applyComboToCart([], freeMain, { ...combo, price: 0 }, {
      priceType: 'retail',
      digits: 2,
      comboLineId: 'combo-t11a-5',
    });

    expect(cart).toHaveLength(1);
    expect(cart[0].price).toBe(0);
    expect(lineTotal(cart[0])).toBe(27);
  });
});
