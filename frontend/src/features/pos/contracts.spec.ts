import { describe, expect, it } from 'vitest';
import { buildLegacyPosSalePayload, buildPosSalePayload, stripSaleItemNameFields, validatePosSaleInput } from './contracts';
import { addPosItem } from '@/features/pos/lib/pos.domain';
import type { PosItem } from '@/features/pos/types/pos.types';
import type { Product } from '@/types/domain';

const cart: PosItem[] = [
  {
    productId: '1',
    name: 'صنف اختبار',
    qty: 1,
    price: 25,
    costPrice: 20,
    unitName: 'قطعة',
    unitId: 'unit-1',
    unitMultiplier: 1,
    priceType: 'retail',
    lineKey: '1::قطعة::retail',
    stockLimit: 100,
    currentStock: 100,
    minStock: 0,
  },
];

describe('POS sale contracts', () => {
  it('keeps selected customer id on all credit-sale payload builders', () => {
    const input = {
      cart,
      customerId: ' 77 ',
      paymentType: 'credit' as const,
      paymentChannel: 'credit' as const,
      discount: 0,
      deliveryFee: 0,
      note: ' آجل ',
      paidAmount: 0,
      tenderedAmount: 0,
      payments: [],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 25,
      branchId: '1',
      locationId: '2',
    };

    expect(buildPosSalePayload(input)).toMatchObject({
      customerId: '77',
      paymentType: 'credit',
      paymentChannel: 'credit',
      payments: [],
    });
    expect(buildLegacyPosSalePayload(input)).toMatchObject({
      customerId: '77',
      paymentType: 'credit',
      paymentChannel: 'credit',
    });
  });

  it('preserves fractional unit conversion in all POS payloads for accurate stock deduction', () => {
    const input = {
      cart: [{ ...cart[0], qty: 4, price: 12.5, unitMultiplier: 0.5 }],
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: 50,
      tenderedAmount: 50,
      payments: [{ paymentChannel: 'cash' as const, amount: 50 }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 50,
    };
    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      expect((build(input) as any).items[0].unitMultiplier).toBe(0.5);
    }
  });

  it('rejects a credit sale before submit when no customer is selected', () => {
    expect(() => validatePosSaleInput({
      cart,
      customerId: '',
      paymentType: 'credit',
      paymentChannel: 'credit',
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: 0,
      tenderedAmount: 0,
      payments: [],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 25,
    })).toThrow('اختر العميل أولًا في حالة البيع الآجل');
  });

  it('rejects accidental credit channel on cash sale', () => {
    expect(() => validatePosSaleInput({
      cart,
      customerId: '',
      paymentType: 'cash',
      paymentChannel: 'credit',
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: 25,
      tenderedAmount: 25,
      payments: [{ paymentChannel: 'cash', amount: 25 }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 25,
    })).toThrow('لا يمكن استخدام قناة آجل مع بيع نقدي');
  });

  it('carries the storefront order id on every payload builder (O62)', () => {
    const input = {
      cart,
      customerId: '7',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 5,
      deliveryFee: 0,
      note: '',
      paidAmount: 20,
      tenderedAmount: 20,
      payments: [{ paymentChannel: 'cash' as const, amount: 20 }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 20,
      onlineOrderId: 41,
    };

    // The discount belongs to the storefront order, so the server must know which order it is;
    // without this the cashier is asked for a manager PIN (or the discount is lost).
    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      expect((build(input) as { onlineOrderId?: number }).onlineOrderId).toBe(41);
    }

    const withoutOrder = { ...input, onlineOrderId: undefined };
    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      expect('onlineOrderId' in (build(withoutOrder) as object)).toBe(false);
    }
  });

  it('the surviving retry leg preserves modifiers and sale terms (R4-C I51)', () => {
    // buildMinimalPosSalePayload is DELETED by R4-C: it dropped
    // modifiers, discount, deliveryFee, taxRate, serviceCharge,
    // tipAmount, payments, tenderedAmount, tableNumber and orderType,
    // so a modifier sale retried through it posted at base price.
    // The legacy builder is the only retry leg left (pos.api createSale
    // retries with it when no idempotency key is present), and it must
    // carry the whole sale — this pins that.
    const input = {
      cart: [{ ...cart[0], modifiers: [{ productId: 9, name: 'Cheese', qty: 1, price: 10 }] }],
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 5,
      deliveryFee: 10,
      note: '',
      paidAmount: 40,
      tenderedAmount: 40,
      payments: [{ paymentChannel: 'cash' as const, amount: 40 }],
      taxRate: 14,
      pricesIncludeTax: false,
      expectedTotal: 40,
      tableNumber: 'T-4',
      orderType: 'dine_in',
      serviceCharge: 3,
      tipAmount: 2,
    };
    const legacy = buildLegacyPosSalePayload(input) as any;
    expect(legacy.items[0].modifiers).toEqual([{ productId: 9, name: 'Cheese', qty: 1, price: 10 }]);
    expect(legacy.discount).toBe(5);
    expect(legacy.deliveryFee).toBe(10);
    expect(legacy.taxRate).toBe(14);
    expect(legacy.serviceCharge).toBe(3);
    expect(legacy.tipAmount).toBe(2);
    expect(legacy.tenderedAmount).toBe(40);
    expect(legacy.orderType).toBe('dine_in');
    // NOTE (follow-up, not this package): the legacy builder still
    // carries no `payments` array and no `tableNumber` — the retried
    // sale leans on paymentType/paymentChannel + tenderedAmount, and
    // loses its table. That gap predates R4-C and is out of scope here;
    // this pin covers the fields the legacy leg does preserve.
  });

  it('never sends nameEn / name_en in any POS sale payload (English-only, Arabic-only, bilingual)', () => {
    // The sale DTOs have no nameEn / name_en field and the validation pipe forbids
    // non-whitelisted fields, so sending either key rejects the whole sale with a
    // 400 VALIDATION_ERROR. The English name is display-only; the server resolves
    // names from productId.
    const namedCart: PosItem[] = [
      { ...cart[0], productId: '1', name: 'Test Product', nameEn: 'Test Product', price: 25 },
      { ...cart[0], productId: '2', name: 'منتج عربي', price: 25 },
      { ...cart[0], productId: '3', name: 'منتج ثنائي', nameEn: 'Bilingual Product', price: 25 },
    ];
    const input = {
      cart: namedCart,
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: 75,
      tenderedAmount: 75,
      payments: [{ paymentChannel: 'cash' as const, amount: 75 }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 75,
    };
    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      const payload = build(input) as any;
      expect(payload.items).toHaveLength(3);
      for (const item of payload.items) {
        expect('nameEn' in item).toBe(false);
        expect('name_en' in item).toBe(false);
      }
      expect(payload.items.map((item: any) => item.productId)).toEqual(['1', '2', '3']);
      expect(payload.items.map((item: any) => item.qty)).toEqual([1, 1, 1]);
    }
    // The main payload keeps the display name; the fallback builders never carried it.
    expect((buildPosSalePayload(input) as any).items.map((item: any) => item.name))
      .toEqual(['Test Product', 'منتج عربي', 'منتج ثنائي']);
  });

  it('strips a snake_case name_en coming from the catalog shape as well', () => {
    const input = {
      cart: [{ ...cart[0], ...({ name_en: 'Snake Product' } as any), price: 25 }],
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: 25,
      tenderedAmount: 25,
      payments: [{ paymentChannel: 'cash' as const, amount: 25 }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 25,
    };
    const item = (buildPosSalePayload(input) as any).items[0];
    expect('nameEn' in item).toBe(false);
    expect('name_en' in item).toBe(false);
    expect(item.name).toBe('صنف اختبار');
  });

  it('stripSaleItemNameFields removes both name keys and keeps everything else', () => {
    const items = [
      { productId: 1, name: 'منتج', nameEn: 'Product', name_en: 'Product', qty: 2, seatNumber: 3, course: 'main' },
    ];
    expect(stripSaleItemNameFields(items)).toEqual([
      { productId: 1, name: 'منتج', qty: 2, seatNumber: 3, course: 'main' },
    ]);
    // The input is not mutated: the kitchen print still gets the English name.
    expect(items[0]).toHaveProperty('nameEn', 'Product');
  });
});

/* LF-P3: a serial-tracked line with its serials entered passes the existing
 * validation and ships them in the main payload; without them confirm stays
 * blocked. The validation itself is unchanged — this pins the entry path
 * end to end (helper -> validate -> payload). */
describe('POS serial-tracked lines (LF-P3)', () => {
  const serialCart: PosItem[] = [
    { ...cart[0], trackSerials: true, qty: 2, serials: ['869123456789022', '869123456789023'] },
  ];

  function cashInput(cartItems: PosItem[], expectedTotal = 50) {
    return {
      cart: cartItems,
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: expectedTotal,
      tenderedAmount: expectedTotal,
      payments: [{ paymentChannel: 'cash' as const, amount: expectedTotal }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal,
    };
  }

  it('passes validation and ships the entered serials once count == qty', () => {
    expect(() => validatePosSaleInput(cashInput(serialCart))).not.toThrow();
    expect((buildPosSalePayload(cashInput(serialCart)) as any).items[0].serials)
      .toEqual(['869123456789022', '869123456789023']);
  });

  it('keeps confirm blocked while any serial is missing', () => {
    const missingOne: PosItem[] = [{ ...serialCart[0], serials: ['869123456789022'] }];
    expect(() => validatePosSaleInput(cashInput(missingOne)))
      .toThrow('امسح سيريالاً فريداً لكل قطعة من صنف اختبار');
    const missingAll: PosItem[] = [{ ...serialCart[0], serials: undefined }];
    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      expect(() => build(cashInput(missingAll))).toThrow('امسح سيريالاً فريداً لكل قطعة من صنف اختبار');
    }
  });

  it('keeps confirm blocked on a duplicate serial', () => {
    const duplicated: PosItem[] = [{ ...serialCart[0], serials: ['869123456789022', '869123456789022'] }];
    expect(() => validatePosSaleInput(cashInput(duplicated)))
      .toThrow('امسح سيريالاً فريداً لكل قطعة من صنف اختبار');
  });
});

/* R4-D (INV-REST-PAID-GATES-2): the paid gates the POS workspace used
 * to enforce alone — or not at all. At base every case below PASSES
 * validation (the validator either exempted it or never checked it);
 * after the fix each one throws before any payload is built, so the
 * mutation, the offline sync and the split-bill modal (all three run
 * validatePosSaleInput via the payload builders) are guarded alike. */
describe('POS paid gates (R4-D)', () => {
  function baseInput(overrides: Record<string, unknown> = {}) {
    return {
      cart,
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: 25,
      tenderedAmount: 25,
      payments: [{ paymentChannel: 'cash' as const, amount: 25 }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 25,
      ...overrides,
    };
  }

  it('I28: an underpaid cash sale with a customer no longer passes as a silent partial credit', () => {
    expect(() => validatePosSaleInput(baseInput({
      customerId: '7',
      paidAmount: 10,
      tenderedAmount: 10,
      payments: [{ paymentChannel: 'cash' as const, amount: 10 }],
    }))).toThrow('المبلغ المدفوع أقل من إجمالي الفاتورة');
  });

  it('I28: an explicitly-chosen credit sale with a customer still passes', () => {
    expect(() => validatePosSaleInput(baseInput({
      customerId: '7',
      paymentType: 'credit' as const,
      paymentChannel: 'credit' as const,
      paidAmount: 0,
      tenderedAmount: 0,
      payments: [],
    }))).not.toThrow();
  });

  it('I39: a negative payment leg is rejected instead of being dropped before validation', () => {
    // Cash -50 + card 100 + cash 50 covers the 100 total, so the old
    // underpaid and non-cash-overpay checks never fired and the -50 leg
    // was silently dropped by the > 0 filter in the submit path.
    expect(() => validatePosSaleInput(baseInput({
      expectedTotal: 100,
      paidAmount: 100,
      tenderedAmount: 100,
      payments: [
        { paymentChannel: 'cash' as const, amount: -50 },
        { paymentChannel: 'card' as const, amount: 100 },
        { paymentChannel: 'cash' as const, amount: 50 },
      ],
    }))).toThrow('مبالغ الدفع لا يمكن أن تكون سالبة');
  });

  it('I39: a discount larger than the cart-line subtotal is rejected', () => {
    expect(() => validatePosSaleInput(baseInput({ discount: 30 })))
      .toThrow('الخصم أكبر من إجمالي الأصناف');
  });

  it('I39: negative delivery fee, tip, service charge and tendered amounts are rejected', () => {
    expect(() => validatePosSaleInput(baseInput({ deliveryFee: -5 })))
      .toThrow('رسوم التوصيل لا يمكن أن تكون سالبة');
    expect(() => validatePosSaleInput(baseInput({ tipAmount: -10 })))
      .toThrow('الإكرامية لا يمكن أن تكون سالبة');
    expect(() => validatePosSaleInput(baseInput({ serviceCharge: -5 })))
      .toThrow('رسوم الخدمة لا يمكن أن تكون سالبة');
    expect(() => validatePosSaleInput(baseInput({ tenderedAmount: -50 })))
      .toThrow('المبلغ المستلم لا يمكن أن يكون سالبًا');
  });

  it('I40: a card leg below the terminal-approved amount is rejected', () => {
    expect(() => validatePosSaleInput(baseInput({
      expectedTotal: 100,
      paidAmount: 100,
      tenderedAmount: 10,
      payments: [
        { paymentChannel: 'card' as const, amount: 90 },
        { paymentChannel: 'cash' as const, amount: 10 },
      ],
      terminalAuthCode: 'AUTH-1',
      terminalApprovedAmount: 100,
    }))).toThrow('المبلغ المعتمد من الماكينة لا يطابق مبلغ البطاقة');
  });

  it('I40: a card leg equal to the terminal-approved amount passes', () => {
    expect(() => validatePosSaleInput(baseInput({
      expectedTotal: 100,
      paidAmount: 100,
      tenderedAmount: 0,
      payments: [{ paymentChannel: 'card' as const, amount: 100 }],
      terminalAuthCode: 'AUTH-1',
      terminalApprovedAmount: 100,
    }))).not.toThrow();
  });

  it('I42: a dine-in sale without a table is rejected', () => {
    expect(() => validatePosSaleInput(baseInput({ orderType: 'dine_in' })))
      .toThrow('اختر طاولة أولًا لطلبات الصالة');
  });

  it('I42: a dine-in sale with a table, and a takeaway sale without one, still pass', () => {
    expect(() => validatePosSaleInput(baseInput({ orderType: 'dine_in', tableNumber: 'T1' }))).not.toThrow();
    expect(() => validatePosSaleInput(baseInput({ orderType: 'takeaway' }))).not.toThrow();
  });

  it('I43: an unpaid COD delivery with no customer is rejected', () => {
    expect(() => validatePosSaleInput(baseInput({
      orderType: 'delivery',
      collectionStatus: 'cod',
      paidAmount: 0,
      tenderedAmount: 0,
      payments: [],
    }))).toThrow('الدليفري غير المسدد يحتاج عميلًا مسجلًا');
  });

  it('I43: an unpaid COD delivery WITH a customer, and a prepaid COD without one, still pass', () => {
    expect(() => validatePosSaleInput(baseInput({
      orderType: 'delivery',
      collectionStatus: 'cod',
      customerId: '7',
      paidAmount: 0,
      tenderedAmount: 0,
      payments: [],
    }))).not.toThrow();
    expect(() => validatePosSaleInput(baseInput({
      orderType: 'delivery',
      collectionStatus: 'cod',
      payments: [{ paymentChannel: 'cash' as const, amount: 25 }],
    }))).not.toThrow();
  });

  it('I44: a zero-total sale is rejected', () => {
    expect(() => validatePosSaleInput(baseInput({
      expectedTotal: 0,
      paidAmount: 0,
      tenderedAmount: 0,
      payments: [],
    }))).toThrow('إجمالي الفاتورة غير صالح');
  });

  it('I24 follow-up: the payload builder carries the per-browser terminal code through', () => {
    // R4-B wired terminalCode only into the offline-sync path, so the
    // online submit dropped it and terminal attribution worked only
    // for synced offline sales. At base the builder drops the field
    // (no terminalCode key on the built payload); after the fix the
    // online payload carries it to normalizeSalePayload.
    expect((buildPosSalePayload(baseInput({ terminalCode: 'T4A2' })) as any).terminalCode).toBe('T4A2');
  });

  /* INV-POS-LINE-DISCOUNT: the clothes-shop case — a 2-piece line at
   * 100 with 30 off that piece only, plus a 1-piece line at 50 with
   * its whole 50 discounted. Gross 250, net 170. Both payload
   * builders (online + legacy fallback) must carry the per-line
   * discount, and the validation must bound it per line ([0, line
   * gross]) and bound the header discount by the NET subtotal. */
  it('carries the per-line discount on both payload builders', () => {
    const discountedCart: PosItem[] = [
      { ...cart[0], productId: '1', qty: 2, price: 100, lineDiscount: 30, lineKey: '1::قطعة::retail' },
      { ...cart[0], productId: '2', name: 'صنف ثان', qty: 1, price: 50, lineDiscount: 50, lineKey: '2::قطعة::retail' },
    ];
    const input = baseInput({
      cart: discountedCart,
      paidAmount: 170,
      tenderedAmount: 170,
      payments: [{ paymentChannel: 'cash' as const, amount: 170 }],
      expectedTotal: 170,
    });
    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      const built = build(input) as any;
      expect(built.items[0].lineDiscount).toBe(30);
      expect(built.items[1].lineDiscount).toBe(50);
      expect(built.expectedTotal).toBe(170);
    }
  });

  it('rejects a per-line discount above the line gross', () => {
    expect(() => validatePosSaleInput(baseInput({
      cart: [{ ...cart[0], qty: 2, price: 100, lineDiscount: 200.01 }],
    }))).toThrow('خصم الصنف أكبر من إجمالي الصنف');
  });

  it('rejects a negative per-line discount', () => {
    expect(() => validatePosSaleInput(baseInput({
      cart: [{ ...cart[0], lineDiscount: -5 }],
    }))).toThrow('خصم الصنف لا يمكن أن يكون سالبًا');
  });

  it('bounds the header discount by the net subtotal, not the gross', () => {
    const discountedCart: PosItem[] = [
      { ...cart[0], qty: 2, price: 100, lineDiscount: 30, lineKey: '1::قطعة::retail' },
      { ...cart[0], productId: '2', name: 'صنف ثان', qty: 1, price: 50, lineKey: '2::قطعة::retail' },
    ];
    // Net subtotal is 220 (250 gross - 30 line discount): a header
    // discount of 221 exceeds it even though it is below the gross.
    expect(() => validatePosSaleInput(baseInput({
      cart: discountedCart,
      discount: 221,
      paidAmount: 220,
      tenderedAmount: 220,
      payments: [{ paymentChannel: 'cash' as const, amount: 220 }],
      expectedTotal: 1,
    }))).toThrow('الخصم أكبر من إجمالي الأصناف');
    // A header discount of 200 fits the net subtotal and passes.
    expect(() => validatePosSaleInput(baseInput({
      cart: discountedCart,
      discount: 200,
      paidAmount: 20,
      tenderedAmount: 20,
      payments: [{ paymentChannel: 'cash' as const, amount: 20 }],
      expectedTotal: 20,
    }))).not.toThrow();
  });

  it('carries the displayed total as expectedTotal on both payload builders (R5-A, R-I53)', () => {
    const input = {
      cart,
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: 25,
      tenderedAmount: 25,
      payments: [{ paymentChannel: 'cash' as const, amount: 25 }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal: 25,
    };
    expect((buildPosSalePayload(input) as any).expectedTotal).toBe(25);
    expect((buildLegacyPosSalePayload(input) as any).expectedTotal).toBe(25);
  });
});

/* SPICE-PKG3 (b) — the submit normalizer (normalizeCartQty) already
 * branches on item.isWeighted, so a tile-added kg line must reach
 * it flagged: W08 posts 1 piece + 0.500 kg and E08 posts 0.125 kg.
 * On the base the lines arrive unflagged (the barcode path is the
 * only one that sets the flag), so the payload re-rounds 0.500 -> 1
 * and 0.125 -> 1 and both cases fail there. */
describe('weighed lines keep fractional quantities in the sale payload (SPICE-PKG3)', () => {
  const pieceProduct: Product = {
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
  const kgProduct: Product = {
    ...pieceProduct,
    id: 'p2',
    name: 'جبنة بيضاء',
    retailPrice: 400.40,
    barcode: '456',
    units: [{ id: 'ukg', name: 'كجم', multiplier: 1, barcode: '', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
  };

  function cashInput(cart: PosItem[], expectedTotal: number) {
    return {
      cart,
      customerId: '',
      paymentType: 'cash' as const,
      paymentChannel: 'cash' as const,
      discount: 0,
      deliveryFee: 0,
      note: '',
      paidAmount: expectedTotal,
      tenderedAmount: expectedTotal,
      payments: [{ paymentChannel: 'cash' as const, amount: expectedTotal }],
      taxRate: 0,
      pricesIncludeTax: false,
      expectedTotal,
    };
  }

  it('posts 1 piece + 0.500 kg for a mixed invoice added by tile (W08)', () => {
    let cart = addPosItem([], pieceProduct, { priceType: 'retail', quantity: 1, digits: 2 });
    cart = addPosItem(cart, kgProduct, { priceType: 'retail', quantity: 0.5, digits: 2 });
    const input = cashInput(cart, 210.20);

    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      const items = (build(input) as any).items;
      expect(items.map((item: any) => item.qty)).toEqual([1, 0.5]);
    }
  });

  it('posts 0.125 kg for a tile-added weighed line (E08: 0.125 x 400.40)', () => {
    const cart = addPosItem([], kgProduct, { priceType: 'retail', quantity: 0.125, digits: 2 });
    const input = cashInput(cart, 50.05);

    for (const build of [buildPosSalePayload, buildLegacyPosSalePayload]) {
      const items = (build(input) as any).items;
      expect(items.map((item: any) => item.qty)).toEqual([0.125]);
    }
  });
});
