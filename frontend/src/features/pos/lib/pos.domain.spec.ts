import { describe, expect, it, vi } from 'vitest';
import { addPosItem, addSerialToPosLine, getRequiredSerialCount, getSerialEntryState, getSerialLookupError, getProductPrice, isOfferHappyHourActive, removeSerialFromPosLine, repriceCartLine, syncPosCartStock, updatePosItemQtyWithOptions } from '@/features/pos/lib/pos.domain';
import type { Product } from '@/types/domain';

const product: Product = {
  id: 'p1',
  name: 'Tea',
  categoryId: '',
  supplierId: '',
  costPrice: 5,
  retailPrice: 10,
  wholesalePrice: 8,
  stock: 0,
  minStock: 0,
  notes: '',
  barcode: '123',
  units: [{ id: 'u1', name: 'قطعة', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
};

function localIsoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('POS stock handling', () => {
  it('supports fractional selling units without reducing their available stock count', () => {
    const halfUnitProduct: Product = {
      ...product,
      stock: 2,
      units: [{ ...product.units[0], id: 'half', name: 'نصف كيلو', multiplier: 0.5 }],
    };
    const cart = addPosItem([], halfUnitProduct, { priceType: 'retail', quantity: 4, digits: 2});
    expect(cart[0].qty).toBe(4);
    expect(cart[0].stockLimit).toBe(4);
    expect(cart[0].unitMultiplier).toBe(0.5);
    expect(cart[0].price).toBe(5);
    expect(() => addPosItem(cart, halfUnitProduct, { priceType: 'retail', quantity: 1, digits: 2})).toThrow();
  });

  it('charges the correct retail and wholesale amount for a carton instead of one piece', () => {
    const carton: Product = {
      ...product,
      stock: 24,
      retailPrice: 10,
      wholesalePrice: 8,
      units: [{ ...product.units[0], name: 'كرتونة', multiplier: 12 }],
    };
    const retail = addPosItem([], carton, { priceType: 'retail', quantity: 2, digits: 2});
    const wholesale = addPosItem([], carton, { priceType: 'wholesale', quantity: 1, digits: 2});
    expect(retail[0].unitMultiplier).toBe(12);
    expect(retail[0].price).toBe(120);
    expect(retail[0].qty * retail[0].price).toBe(240);
    expect(wholesale[0].price).toBe(96);
  });

  it('reports unavailable products without mutating the cart when negative stock sales are disabled', () => {
    expect(() => addPosItem([], product, { priceType: 'retail', digits: 2})).toThrow('الصنف غير متاح للبيع حاليًا');
  });

  it('allows adding and increasing quantity below stock when negative stock sales are enabled', () => {
    const cart = addPosItem([], product, { priceType: 'retail', allowNegativeStockSales: true, digits: 2});
    const updated = updatePosItemQtyWithOptions(cart, cart[0].lineKey, 3, [product], { allowNegativeStockSales: true, digits: 2});

    expect(updated[0].qty).toBe(3);
    expect(updated[0].currentStock).toBe(0);
  });

  it('keeps below-stock cart lines during stock sync when negative stock sales are enabled', () => {
    const cart = addPosItem([], product, { priceType: 'retail', allowNegativeStockSales: true, digits: 2});
    const result = syncPosCartStock(cart, [product], { allowNegativeStockSales: true, digits: 2});

    expect(result.cart).toHaveLength(1);
    expect(result.removedCount).toBe(0);
    expect(result.clampedCount).toBe(0);
  });

  it('handles weighted quantities correctly when adding items', () => {
    const weightedProduct = { ...product, stock: 3 };
    const cart = addPosItem([], weightedProduct, { priceType: 'retail', isWeighted: true, quantity: 1.575, digits: 2});
    
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(1.575);
    expect(cart[0].isWeighted).toBe(true);
  });

  it('rejects weighted items that exceed available stock', () => {
    const weightedProduct = { ...product, stock: 1 };
    expect(() => addPosItem([], weightedProduct, { priceType: 'retail', isWeighted: true, quantity: 1.575, digits: 2})).toThrowError(/المخزون المتاح|غير متاح/);
  });

  it('validates weighted quantity limits accurately down to decimals without rounding up erroneously', () => {
    const cart = addPosItem([], { ...product, stock: 1.575 }, { priceType: 'retail', isWeighted: true, quantity: 1.575, digits: 2});
    expect(cart[0].qty).toBe(1.575);
  });

  it('uses date-only active offers for the cashier price', () => {
    const todayIso = localIsoDate();
    expect(getProductPrice({
      ...product,
      stock: 5,
      offers: [{ id: 'offer-1', type: 'percent', value: 10, minQty: 1, from: `${todayIso}T23:30:00.000Z`, to: `${todayIso}T01:30:00.000Z` }],
    }, 'retail', 1, 1, 2)).toBe(9);

    expect(getProductPrice({
      ...product,
      stock: 5,
      offers: [{ id: 'offer-1', type: 'percent', value: 10, minQty: 1, from: todayIso, to: todayIso }],
    }, 'retail', 1, 1, 2)).toBe(9);
  });

  it('applies active POS offers returned in camel-case API shape', () => {
    const cart = addPosItem([], {
      ...product,
      stock: 5,
      offers: [{ id: 'offer-1', type: 'fixed', value: 2, minQty: 1, from: localIsoDate(), to: null }],
    }, { priceType: 'retail', digits: 2});

    expect(cart[0].price).toBe(8);
  });

  it('applies active POS offers returned in database-shaped API fields', () => {
    expect(getProductPrice({
      ...product,
      stock: 5,
      offers: [{ id: 'offer-1', offer_type: 'price', value: '7', min_qty: '1', start_date: localIsoDate(), end_date: null }],
    }, 'retail', 1, 1, 2)).toBe(7);
  });

  it('does not apply future or expired offers', () => {
    expect(getProductPrice({
      ...product,
      stock: 5,
      offers: [{ id: 'future-offer', type: 'percent', value: 50, minQty: 1, from: localIsoDate(1), to: null }],
    }, 'retail', 1, 1, 2)).toBe(10);

    expect(getProductPrice({
      ...product,
      stock: 5,
      offers: [{ id: 'expired-offer', type: 'percent', value: 50, minQty: 1, from: null, to: localIsoDate(-1) }],
    }, 'retail', 1, 1, 2)).toBe(10);
  });

  it('applies bundle offer correctly for full bundles and remainder items', () => {
    const bundleProduct: Product = {
      ...product,
      retailPrice: 120,
      stock: 20,
      offers: [{ id: 'bundle-offer', type: 'bundle', value: 500, minQty: 5, from: localIsoDate(), to: null }],
    };

    // Below bundle threshold: normal retail price
    expect(getProductPrice(bundleProduct, 'retail', 3, 1, 2)).toBe(120);

    // Exactly 1 bundle (5 pieces): 500 / 5 = 100 per piece
    expect(getProductPrice(bundleProduct, 'retail', 5, 1, 2)).toBe(100);

    // 1 bundle + 2 items (7 pieces): (500 + 240) / 7 = 105.71
    expect(getProductPrice(bundleProduct, 'retail', 7, 1, 2)).toBe(105.71);
  });

  it('applies BOGO offers correctly with free units and partial discounts', () => {
    const bogoProduct: Product = {
      ...product,
      retailPrice: 100,
      stock: 20,
      offers: [{
        id: 'bogo-1',
        type: 'bogo',
        value: 100,
        bogoBuyQty: 1,
        bogoGetQty: 1,
        bogoDiscountPercent: 100,
        from: localIsoDate(),
        to: null,
      }],
    };

    // 1 item: threshold not met (need buy 1 + get 1 = 2)
    expect(getProductPrice(bogoProduct, 'retail', 1, 1, 2)).toBe(100);

    // 2 items: buy 1, get 1 free (total 100 -> 50 each)
    expect(getProductPrice(bogoProduct, 'retail', 2, 1, 2)).toBe(50);

    // 3 items: buy 1 get 1 free + 1 at full price (total 200 -> 66.67 each)
    expect(getProductPrice(bogoProduct, 'retail', 3, 1, 2)).toBe(66.67);

    // 4 items: 2 complete cycles (total 200 -> 50 each)
    expect(getProductPrice(bogoProduct, 'retail', 4, 1, 2)).toBe(50);
  });

  it('respects happy hours and days of week scheduling in POS', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T15:00:00')); // Tuesday at 15:00

    try {
      const scheduledProduct: Product = {
        ...product,
        retailPrice: 100,
        stock: 20,
        offers: [{
          id: 'hh-1',
          type: 'percent',
          value: 20,
          happyHourStart: '14:00',
          happyHourEnd: '18:00',
          daysOfWeek: '1,2,3', // Monday, Tuesday, Wednesday
          from: '2026-04-01',
          to: null,
        }],
      };

      // Tuesday at 15:00 (inside window and valid day)
      const cartValid = addPosItem([], scheduledProduct, { priceType: 'retail', digits: 2});
      // repricing with time
      const repricedValid = repriceCartLine(cartValid[0], scheduledProduct, 1, 2);
      expect(repricedValid.offerName).toContain('20%');

      // Tuesday at 20:00 (outside window)
      const outsideTime = new Date('2026-04-14T20:00:00');
      expect(isOfferHappyHourActive(scheduledProduct.offers![0], outsideTime)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* LF-P3: serial entry on a cart line. On base these helpers do not exist, so
 * this block fails on base (import error) and passes with the fix. */
describe('POS cart-line serial entry (LF-P3)', () => {
  const serialProduct: Product = { ...product, stock: 5, trackSerials: true };

  function serialCart(qty = 2) {
    return addPosItem([], serialProduct, { priceType: 'retail', quantity: qty, digits: 2 });
  }

  it('adds one serial per unit until the line is complete, then blocks with a specific message', () => {
    let cart = serialCart(2);
    expect(getRequiredSerialCount(cart[0])).toBe(2);
    expect(getSerialEntryState(cart[0])).toEqual({ required: 2, entered: 0, missing: 2, complete: false });

    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789022');
    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789023');
    expect(cart[0].serials).toEqual(['869123456789022', '869123456789023']);
    expect(getSerialEntryState(cart[0]).complete).toBe(true);

    expect(() => addSerialToPosLine(cart, cart[0].lineKey, '869123456789024'))
      .toThrow('اكتملت سيريالات Tea (2 من 2)');
  });

  it('rejects a duplicate serial on the same line (case-insensitive) naming the serial', () => {
    let cart = serialCart(2);
    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789022');
    expect(() => addSerialToPosLine(cart, cart[0].lineKey, ' 869123456789022 '))
      .toThrow('السيريال 869123456789022 مضاف بالفعل إلى Tea.');
  });

  it('rejects the same serial on another line of the cart', () => {
    const otherProduct: Product = { ...serialProduct, id: 'p2', name: 'Phone B' };
    let cart = serialCart(1);
    cart = addPosItem(cart, otherProduct, { priceType: 'retail', quantity: 1, digits: 2 });
    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789022');
    expect(() => addSerialToPosLine(cart, cart[1].lineKey, '869123456789022'))
      .toThrow('السيريال 869123456789022 مضاف بالفعل إلى سطر آخر في السلة.');
  });

  it('refuses serials on a line that does not track serials and on an unknown line', () => {
    const plainCart = addPosItem([], { ...product, stock: 5 }, { priceType: 'retail', quantity: 1, digits: 2 });
    expect(() => addSerialToPosLine(plainCart, plainCart[0].lineKey, '869123456789022'))
      .toThrow('الصنف Tea لا يتطلب سيريالاً.');
    expect(() => addSerialToPosLine(plainCart, 'missing-line', '869123456789022'))
      .toThrow('تعذّر العثور على سطر السلة');
    expect(() => addSerialToPosLine(serialCart(1), serialCart(1)[0].lineKey, '   '))
      .toThrow('أدخل رقم السيريال أولاً.');
  });

  it('removes a serial and drops the serials field once the last one is removed', () => {
    let cart = serialCart(2);
    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789022');
    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789023');
    cart = removeSerialFromPosLine(cart, cart[0].lineKey, '869123456789022');
    expect(cart[0].serials).toEqual(['869123456789023']);
    cart = removeSerialFromPosLine(cart, cart[0].lineKey, '869123456789023');
    expect(cart[0].serials).toBeUndefined();
  });

  it('counts one serial per piece for fractional unit multipliers', () => {
    const halfUnitProduct: Product = {
      ...serialProduct,
      units: [{ ...product.units[0], id: 'half', name: 'نصف كيلو', multiplier: 0.5 }],
    };
    const cart = addPosItem([], halfUnitProduct, { priceType: 'retail', quantity: 4, digits: 2 });
    expect(getRequiredSerialCount(cart[0])).toBe(2);
  });

  it('trims excess serials (last-entered first) when the quantity drops', () => {
    let cart = serialCart(2);
    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789022');
    cart = addSerialToPosLine(cart, cart[0].lineKey, '869123456789023');
    const trimmed = updatePosItemQtyWithOptions(cart, cart[0].lineKey, 1, [serialProduct], { digits: 2 });
    expect(trimmed[0].qty).toBe(1);
    expect(trimmed[0].serials).toEqual(['869123456789022']);
  });

  it('names the serial and the reason for every lookup verdict', () => {
    expect(getSerialLookupError('869123456789022', null, 'p1', 'Tea'))
      .toBe('السيريال 869123456789022 غير مسجّل في النظام.');
    expect(getSerialLookupError('869123456789022', { productId: 'p9', status: 'in_stock', productName: 'Phone B' }, 'p1', 'Tea'))
      .toBe('السيريال 869123456789022 مسجّل لصنف آخر (Phone B) وليس Tea.');
    expect(getSerialLookupError('869123456789022', { productId: 'p1', status: 'sold' }, 'p1', 'Tea'))
      .toBe('السيريال 869123456789022 غير متاح للبيع — حالته: مباع.');
    expect(getSerialLookupError('869123456789022', { productId: 'p1', status: 'in_stock' }, 'p1', 'Tea'))
      .toBeNull();
  });
});
