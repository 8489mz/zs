import { expect, test, describe } from 'vitest';
import { buildPurchasePayload, PurchaseDraftItem } from '../contracts';

describe('Purchase Contracts - buildPurchasePayload', () => {
  const defaultValues = {
    supplierId: '1',
    paymentType: 'credit' as const,
    branchId: 'br1',
    locationId: 'loc1',
    note: '',
    requiredDate: '2026-07-15T00:00:00.000Z',
    currency: 'EGP',
    companyName: '',
    contactId: null,
    shippingAddressId: null,
    costCenterId: null,
    projectId: null,
    termsTemplate: '',
    discount: 0,
    freight: 0,
  };

  test('should retain locationId and categoryId in items', () => {
    const items: PurchaseDraftItem[] = [
      {
        productId: '10',
        name: 'زيت كريستال',
        qty: 5,
        cost: 100,
        total: 500,
        unitName: 'Piece',
        unitMultiplier: 1,
        locationId: 5, // المخزن المختار يدويًا
        categoryId: 2,
      }
    ];

    const payload = buildPurchasePayload(defaultValues, items, 14, false, undefined, 2);
    
    expect(payload.items[0].locationId).toBe(5);
    expect(payload.items[0].categoryId).toBe(2);
  });

  test('should map undefined locationId and categoryId to undefined (no unintended 0, NaN, or null)', () => {
    const items: PurchaseDraftItem[] = [
      {
        productId: '11',
        name: 'صنف بدون مخزن',
        qty: 1,
        cost: 50,
        total: 50,
        unitName: 'Piece',
        unitMultiplier: 1,
      }
    ];

    const payload = buildPurchasePayload(defaultValues, items, 14, false, undefined, 2);
    
    expect(payload.items[0].locationId).toBeUndefined();
    expect(payload.items[0].categoryId).toBeUndefined();
  });
  
  // INV-LANDED-COST-ALLOCATION: freight entered on the invoice must reach
  // the backend as landedCosts, so createPurchase allocates it to item
  // cost at posting (invoice 100 + freight 20 posts inventory 120).
  test('should send freight as landedCosts with the invoice supplier as vendor', () => {
    const items: PurchaseDraftItem[] = [
      { productId: '10', name: 'صنف', qty: 1, cost: 100, total: 100, unitName: 'Piece', unitMultiplier: 1 },
    ];

    const payload = buildPurchasePayload({ ...defaultValues, freight: 20 }, items, 0, false, undefined, 2);

    expect(payload.landedCosts).toEqual({
      allocationMethod: 'value',
      costs: [{ costType: 'freight', description: 'شحن', amount: 20, vendorId: 1 }],
    });
  });

  test('should send no landedCosts when freight is zero', () => {
    const items: PurchaseDraftItem[] = [
      { productId: '10', name: 'صنف', qty: 1, cost: 100, total: 100, unitName: 'Piece', unitMultiplier: 1 },
    ];

    const payload = buildPurchasePayload({ ...defaultValues, freight: 0 }, items, 0, false, undefined, 2);

    expect('landedCosts' in payload).toBe(false);
  });

  test('should coerce a string freight value to a number', () => {
    const items: PurchaseDraftItem[] = [
      { productId: '10', name: 'صنف', qty: 1, cost: 100, total: 100, unitName: 'Piece', unitMultiplier: 1 },
    ];

    const payload = buildPurchasePayload({ ...defaultValues, freight: '20' as unknown as number }, items, 0, false, undefined, 2);

    expect(payload.landedCosts).toEqual({
      allocationMethod: 'value',
      costs: [{ costType: 'freight', description: 'شحن', amount: 20, vendorId: 1 }],
    });
  });

  test('should parse string locationId and categoryId to numbers', () => {
    const items: PurchaseDraftItem[] = [
      {
        productId: '12',
        name: 'صنف',
        qty: 1,
        cost: 50,
        total: 50,
        unitName: 'Piece',
        unitMultiplier: 1,
        locationId: '100',
        categoryId: '200',
      }
    ];

    const payload = buildPurchasePayload(defaultValues, items, 14, false, undefined, 2);
    
    expect(payload.items[0].locationId).toBe(100);
    expect(payload.items[0].categoryId).toBe(200);
  });

  // INV-FE2-FRONTEND-BOOK-DIGITS: discount/freight round at the passed
  // book digits — a KWD (3dp) discount of 100.125 keeps its third
  // decimal at digits 3 and rounds to 100.13 at digits 2. The old code
  // hardcoded toFixed(2), so a 3-decimal tenant's discount lost a fils
  // before the payload ever reached the backend.
  test('should round discount and freight at the passed book digits (KWD 3dp)', () => {
    const items: PurchaseDraftItem[] = [
      { productId: '10', name: 'صنف', qty: 1, cost: 100, total: 100, unitName: 'Piece', unitMultiplier: 1 },
    ];

    const kwd = buildPurchasePayload({ ...defaultValues, currency: 'KWD', discount: 100.125, freight: 100.125 }, items, 0, false, undefined, 3);
    expect(kwd.discount).toBe(100.125);
    expect(kwd.landedCosts?.costs[0]?.amount).toBe(100.125);

    const egp = buildPurchasePayload({ ...defaultValues, currency: 'EGP', discount: 100.125, freight: 100.125 }, items, 0, false, undefined, 2);
    expect(egp.discount).toBe(100.13);
    expect(egp.landedCosts?.costs[0]?.amount).toBe(100.13);
  });
});
