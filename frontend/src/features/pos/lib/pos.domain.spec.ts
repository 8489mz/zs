import { describe, expect, it, vi } from 'vitest';
import { addPosItem, addSerialToPosLine, applyPosLineTransfer, buildPosLineKey, getRequiredSerialCount, getSerialEntryState, getSerialLookupError, getProductPrice, isOfferHappyHourActive, isWeightedSaleUnit, normalizeUnitName, removeSerialFromPosLine, repriceCartLine, syncPosCartStock, updatePosItemLineDiscount, updatePosItemModifiers, updatePosItemQtyWithOptions, updatePosItemSeat } from '@/features/pos/lib/pos.domain';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
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

  // INV-SERVICE-STOCK-NO-STOCK-CHECK (spice trial D02): a grinding
  // service is unsellable with "الصنف نافذ من المخزون" at stock 0.
  // Services sell without stock: addPosItem already exempts them,
  // but syncPosCartStock removed the line (limit 0 < minQty 1).
  it('sells a zero-stock service without a stock error', () => {
    const service: Product = { ...product, stock: 0, itemType: 'service' };
    const cart = addPosItem([], service, { priceType: 'retail', digits: 2});

    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(1);
  });

  it('keeps a zero-stock service line during stock sync', () => {
    const service: Product = { ...product, stock: 0, itemType: 'service' };
    const cart = addPosItem([], service, { priceType: 'retail', digits: 2});
    const result = syncPosCartStock(cart, [service], { allowNegativeStockSales: false, digits: 2});

    expect(result.cart).toHaveLength(1);
    expect(result.cart[0].qty).toBe(1);
    expect(result.removedCount).toBe(0);
    expect(result.clampedCount).toBe(0);
  });

  it('does not flag a held zero-stock service line unavailable during stock sync', () => {
    const service: Product = { ...product, stock: 0, itemType: 'service' };
    const cart = addPosItem([], service, { priceType: 'retail', digits: 2});
    const held = [{ ...cart[0], priceHeldAt: Date.now() }];
    const result = syncPosCartStock(held, [service], { allowNegativeStockSales: false, digits: 2});

    expect(result.cart).toHaveLength(1);
    expect(result.heldUnavailableCount).toBe(0);
    // A held line that is not unavailable carries no flag at all
    // (the sync only stamps heldUnavailable when it becomes true).
    expect(result.cart[0].heldUnavailable).toBeFalsy();
  });

  it('treats a database-shaped service (item_type) the same as itemType during stock sync', () => {
    const rawService = { ...product, stock: 0, itemType: undefined, item_type: 'service' } as unknown as Product;
    const cart = addPosItem([], rawService, { priceType: 'retail', digits: 2});
    const result = syncPosCartStock(cart, [rawService], { allowNegativeStockSales: false, digits: 2});

    expect(result.cart).toHaveLength(1);
    expect(result.removedCount).toBe(0);
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

/* R-I34 / INV-REST-LINE-IDENTITY: plain and modified lines of the same
 * product are different lines. Before the fix addPosItem keyed lines by
 * product::unit::priceType only, so a plain burger merged into a burger
 * with extra cheese and the cheese was charged on every unit. */
describe('POS line identity (R-I34)', () => {
  const stocked = { ...product, stock: 10 };
  const cheese = { optionId: 'opt-cheese', name: 'جبنة إضافية', price: 20, qty: 1 };

  it('keeps a plain line and a modified line apart, charging the modifier only on the modified units', () => {
    let cart = addPosItem([], stocked, { priceType: 'retail', quantity: 1, digits: 2 });
    cart = addPosItem(cart, stocked, { priceType: 'retail', quantity: 1, digits: 2, modifiers: [cheese] });
    expect(cart).toHaveLength(2);
    const plain = cart.find((line) => !(line.modifiers || []).length)!;
    const modified = cart.find((line) => (line.modifiers || []).length === 1)!;
    expect(calcCartLineTotal(plain)).toBe(10);
    expect(calcCartLineTotal(modified)).toBe(30);
    expect(cart.reduce((sum, line) => sum + calcCartLineTotal(line), 0)).toBe(40);
  });

  it('merges a re-added identical modified item into one line', () => {
    let cart = addPosItem([], stocked, { priceType: 'retail', quantity: 1, digits: 2, modifiers: [cheese] });
    cart = addPosItem(cart, stocked, { priceType: 'retail', quantity: 1, digits: 2, modifiers: [cheese] });
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(2);
    expect(calcCartLineTotal(cart[0])).toBe(60);
  });

  it('keeps lines apart when the notes differ, even with identical modifiers', () => {
    let cart = addPosItem([], stocked, { priceType: 'retail', quantity: 1, digits: 2, notes: 'بدون بصل' });
    cart = addPosItem(cart, stocked, { priceType: 'retail', quantity: 1, digits: 2, notes: 'حار' });
    expect(cart).toHaveLength(2);
    expect(new Set(cart.map((line) => line.lineKey)).size).toBe(2);
  });

  it('re-keys a line when modifiers are set after the add, so a later plain add does not merge into it', () => {
    // Live flow: the cashier adds the product, then picks modifiers in the
    // modifier modal (setItemModifiers -> updatePosItemModifiers). The key
    // must follow the modifiers, or the next plain add merges and the
    // modifier is charged on all units.
    let cart = addPosItem([], stocked, { priceType: 'retail', quantity: 1, digits: 2 });
    const plainKey = cart[0].lineKey;
    cart = updatePosItemModifiers(cart, plainKey, [cheese]);
    expect(cart[0].lineKey).not.toBe(plainKey);
    expect(cart[0].lineKey).toBe(buildPosLineKey({
      productId: 'p1', unitId: 'u1', priceType: 'retail', modifiers: [cheese],
    }));
    cart = addPosItem(cart, stocked, { priceType: 'retail', quantity: 1, digits: 2 });
    expect(cart).toHaveLength(2);
    expect(cart.reduce((sum, line) => sum + calcCartLineTotal(line), 0)).toBe(40);
  });

  it('re-keys a line when its seat changes', () => {
    let cart = addPosItem([], stocked, { priceType: 'retail', quantity: 1, digits: 2, seatNumber: 1 });
    const seat1Key = cart[0].lineKey;
    cart = updatePosItemSeat(cart, seat1Key, 2);
    expect(cart[0].lineKey).not.toBe(seat1Key);
    expect(cart[0].seatNumber).toBe(2);
  });
});

describe('POS line transfer matching (R-I34)', () => {
  const cheese = { optionId: 'opt-cheese', name: 'جبنة إضافية', price: 20, qty: 1 };
  const plainLine = (overrides: Record<string, unknown> = {}) => ({
    lineKey: 'p1::u1::retail',
    productId: 'p1',
    name: 'Tea',
    unitId: 'u1',
    unitName: 'قطعة',
    unitMultiplier: 1,
    price: 10,
    costPrice: 5,
    qty: 2,
    stockLimit: 10,
    currentStock: 10,
    minStock: 0,
    priceType: 'retail',
    modifiers: [],
    ...overrides,
  } as never);

  it('moves a modified line onto a target holding the same product plain without collapsing them', () => {
    const source = [plainLine({ lineKey: 'p1::u1::retail::opt-cheese:جبنة إضافية:20:1', qty: 1, modifiers: [cheese] })];
    const target = [plainLine({ qty: 1 })];
    const { source: nextSource, target: nextTarget } = applyPosLineTransfer(source, target, source as never);
    expect(nextSource).toHaveLength(0);
    expect(nextTarget).toHaveLength(2);
    expect(nextTarget.find((line: any) => (line.modifiers || []).length === 1)?.qty).toBe(1);
    expect(nextTarget.find((line: any) => !(line.modifiers || []).length)?.qty).toBe(1);
  });

  it('merges a transferred line into the identical target line', () => {
    const source = [plainLine({ qty: 1 })];
    const target = [plainLine({ qty: 1 })];
    const { target: nextTarget } = applyPosLineTransfer(source, target, source as never);
    expect(nextTarget).toHaveLength(1);
    expect(nextTarget[0].qty).toBe(2);
  });

  it('matches legacy lines without a key by full identity, never by product + price alone', () => {
    const legacyModified = plainLine({ lineKey: undefined, qty: 1, modifiers: [cheese] });
    const legacyPlain = plainLine({ lineKey: undefined, qty: 1, modifiers: [] });
    const { target: nextTarget } = applyPosLineTransfer(
      [legacyModified], [legacyPlain], [legacyModified] as never,
    );
    expect(nextTarget).toHaveLength(2);
  });

  it('deducts only the moved quantity from the source line', () => {
    const source = [plainLine({ qty: 3 })];
    const { source: nextSource, target: nextTarget } = applyPosLineTransfer(
      source, [], [plainLine({ qty: 1 })] as never,
    );
    expect(nextSource[0].qty).toBe(2);
    expect(nextTarget[0].qty).toBe(1);
  });
});

/* INV-POS-LINE-DISCOUNT: the per-line TOTAL discount (amount) is set
 * on one cart line only, clamped to [0, line gross] and rounded at
 * book digits — the cart can never hold a discount the backend
 * would refuse (INVALID_DISCOUNT). */
describe('POS per-line discount (INV-POS-LINE-DISCOUNT)', () => {
  const shirt: Product = { ...product, id: 'p-shirt', name: 'قميص', retailPrice: 100, costPrice: 80, stock: 10 };
  const trousers: Product = { ...product, id: 'p-trousers', name: 'بنطلون', retailPrice: 50, costPrice: 30, stock: 10 };

  function twoLineCart() {
    let cart = addPosItem([], shirt, { priceType: 'retail', quantity: 2, digits: 2 });
    cart = addPosItem(cart, trousers, { priceType: 'retail', quantity: 1, digits: 2 });
    return cart;
  }

  it('sets the discount on the named line only', () => {
    const cart = twoLineCart();
    const next = updatePosItemLineDiscount(cart, cart[0].lineKey, 30, 2);
    expect(next[0].lineDiscount).toBe(30);
    expect(next[1].lineDiscount).toBeUndefined();
    expect(next[1]).toBe(cart[1]);
  });

  it('clamps a discount above the line gross to the gross', () => {
    const cart = twoLineCart();
    const next = updatePosItemLineDiscount(cart, cart[0].lineKey, 250, 2);
    expect(next[0].lineDiscount).toBe(200);
  });

  it('counts modifiers toward the line gross cap', () => {
    const cheese = { optionId: 'opt-cheese', name: 'جبنة إضافية', price: 20, qty: 1 };
    const cart = addPosItem([], shirt, { priceType: 'retail', quantity: 1, digits: 2, modifiers: [cheese] });
    const next = updatePosItemLineDiscount(cart, cart[0].lineKey, 150, 2);
    expect(next[0].lineDiscount).toBe(120);
  });

  it('rounds the discount at book digits', () => {
    const cart = twoLineCart();
    const next = updatePosItemLineDiscount(cart, cart[0].lineKey, 33.333, 2);
    expect(next[0].lineDiscount).toBe(33.33);
  });

  it('clears the discount with zero', () => {
    const cart = twoLineCart();
    const key = cart[0].lineKey;
    const discounted = updatePosItemLineDiscount(cart, key, 30, 2);
    expect(discounted[0].lineDiscount).toBe(30);
    const next = updatePosItemLineDiscount(discounted, key, 0, 2);
    expect(next[0].lineDiscount).toBeUndefined();
  });

  it('ignores a negative discount', () => {
    const cart = twoLineCart();
    const next = updatePosItemLineDiscount(cart, cart[0].lineKey, -5, 2);
    expect(next[0].lineDiscount).toBeUndefined();
  });
});

/* SPICE-PKG3 (b) — weighed lines added WITHOUT the scale/barcode
 * path: isWeighted is derived from the selected SALE UNIT, not from
 * how the line entered the cart. A tile tap, text search or quick
 * add of a kg/g product must keep fractional quantities at every
 * layer (add, qty edit, submit) instead of rounding 0.500 -> 1.
 * On the base isWeighted is set only by the weighted-barcode path,
 * so every case below fails there and passes after the fix. */
describe('weighed sale units derived from the sale unit (SPICE-PKG3)', () => {
  const kgProduct: Product = {
    ...product,
    stock: 10,
    retailPrice: 400.40,
    units: [{ ...product.units[0], id: 'ukg', name: 'كجم', multiplier: 1 }],
  };
  const kiloGramSpelledProduct: Product = {
    ...product,
    stock: 10,
    retailPrice: 400.40,
    units: [{ ...product.units[0], id: 'ukg', name: 'كيلو جرام', multiplier: 1 }],
  };
  const gramProduct: Product = {
    ...product,
    stock: 500,
    retailPrice: 2,
    units: [{ ...product.units[0], id: 'ug', name: 'جرام', multiplier: 1 }],
  };

  it('normalizes every weighed-unit spelling the catalog actually uses to kg/g', () => {
    expect(normalizeUnitName('كجم')).toBe('kg');
    expect(normalizeUnitName('كيلو')).toBe('kg');
    expect(normalizeUnitName('كيلو جرام')).toBe('kg');
    expect(normalizeUnitName('كيلوجرام')).toBe('kg');
    expect(normalizeUnitName('كيلوغرام')).toBe('kg');
    expect(normalizeUnitName('kg')).toBe('kg');
    expect(normalizeUnitName('kilo')).toBe('kg');
    expect(normalizeUnitName('kilogram')).toBe('kg');
    expect(normalizeUnitName('جرام')).toBe('g');
    expect(normalizeUnitName('جم')).toBe('g');
    expect(normalizeUnitName('g')).toBe('g');
  });

  it('does not mistake a half-kilo pack (sold by the piece) for a weighed line', () => {
    expect(normalizeUnitName('نصف كيلو')).toBe('نصف كيلو');
    expect(isWeightedSaleUnit('نصف كيلو')).toBe(false);
    expect(isWeightedSaleUnit('قطعة')).toBe(false);
    expect(isWeightedSaleUnit('كرتونة')).toBe(false);
    expect(isWeightedSaleUnit('')).toBe(false);
    expect(isWeightedSaleUnit(undefined)).toBe(false);
  });

  it('flags kg/g sale units as weighed in every spelling', () => {
    for (const name of ['كجم', 'كيلو', 'كيلو جرام', 'كيلوجرام', 'kg', 'kilo', 'جرام', 'جم', 'g']) {
      expect(isWeightedSaleUnit(name)).toBe(true);
    }
  });

  it('keeps 0.500 kg on a tile add of a كجم product (W08) — no barcode flag', () => {
    const cart = addPosItem([], kgProduct, { priceType: 'retail', quantity: 0.5, digits: 2 });
    expect(cart[0].qty).toBe(0.5);
    expect(cart[0].isWeighted).toBe(true);
    expect(calcCartLineTotal(cart[0])).toBeCloseTo(200.20, 2);
  });

  it('keeps 0.125 kg on a tile add of a كيلو جرام product (E08: 0.125 x 400.40)', () => {
    const cart = addPosItem([], kiloGramSpelledProduct, { priceType: 'retail', quantity: 0.125, digits: 2 });
    expect(cart[0].qty).toBe(0.125);
    expect(cart[0].isWeighted).toBe(true);
    expect(calcCartLineTotal(cart[0])).toBeCloseTo(50.05, 2);
  });

  it('still rounds a piece line 0.500 -> 1 — the derivation changes weighed lines only', () => {
    const cart = addPosItem([], { ...product, stock: 10 }, { priceType: 'retail', quantity: 0.5, digits: 2 });
    expect(cart[0].qty).toBe(1);
    expect(cart[0].isWeighted).toBeUndefined();
  });

  it('lets a 0.750 kg stock cover a 0.500 kg tile add instead of flooring the stock to 0', () => {
    const cart = addPosItem([], { ...kgProduct, stock: 0.75 }, { priceType: 'retail', quantity: 0.5, digits: 2 });
    expect(cart[0].qty).toBe(0.5);
    expect(cart[0].stockLimit).toBe(0.75);
  });

  it('keeps a fractional qty edit on a tile-added kg line (W07-style partial: 0.750 -> 0.250)', () => {
    const cart = addPosItem([], kgProduct, { priceType: 'retail', quantity: 0.75, digits: 2 });
    const updated = updatePosItemQtyWithOptions(cart, cart[0].lineKey, 0.25, [kgProduct], { digits: 2 });
    expect(updated[0].qty).toBe(0.25);
  });

  it('keeps a fractional gram edit (125.5 g) on a tile-added جرام line', () => {
    const cart = addPosItem([], gramProduct, { priceType: 'retail', quantity: 250, digits: 2 });
    expect(cart[0].isWeighted).toBe(true);
    const updated = updatePosItemQtyWithOptions(cart, cart[0].lineKey, 125.5, [gramProduct], { digits: 2 });
    expect(updated[0].qty).toBe(125.5);
  });

  it('holds a mixed invoice (W08: 1 piece + 0.500 kg) with both quantities intact', () => {
    let cart = addPosItem([], { ...product, stock: 10 }, { priceType: 'retail', quantity: 1, digits: 2 });
    cart = addPosItem(cart, kgProduct, { priceType: 'retail', quantity: 0.5, digits: 2 });
    expect(cart.map((item) => item.qty)).toEqual([1, 0.5]);
    expect(cart[0].isWeighted).toBeUndefined();
    expect(cart[1].isWeighted).toBe(true);
  });
});
