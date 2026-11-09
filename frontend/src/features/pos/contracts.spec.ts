import { describe, expect, it } from 'vitest';
import { buildLegacyPosSalePayload, buildPosSalePayload, stripSaleItemNameFields, validatePosSaleInput } from './contracts';
import type { PosItem } from '@/features/pos/types/pos.types';

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
