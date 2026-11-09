/*
 * R4-D (INV-REST-PAID-GATES-2): the derived workspace flags the paid
 * gates rest on. At base:
 * - I41: requiresCashierShift is false for credit sales, so a credit
 *   sale can be submitted with no open shift (the backend already
 *   rejects it — this pins the frontend flag to the same rule).
 * - I45: changeAmount sums every leg, so card 120 on a 100 total
 *   shows 20 change for cash never received.
 * - I42: there is no dine-in-without-table flag at all, so a dine-in
 *   sale with no table is submittable.
 * - I44: a 100%-discounted (zero-total) cart is submittable.
 * After the fix each case flips to the gated value below.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePosWorkspaceDerived } from './usePosWorkspaceDerived';
import type { PosItem } from '@/features/pos/types/pos.types';

const cartItem: PosItem = {
  lineKey: 'p1::u1::retail',
  productId: 'p1',
  name: 'Tea',
  itemCode: 'p1',
  unitId: 'u1',
  unitName: 'قطعة',
  unitMultiplier: 1,
  price: 100,
  costPrice: 5,
  qty: 1,
  stockLimit: 10,
  currentStock: 10,
  minStock: 0,
  priceType: 'retail',
};

const openShift = [{ id: 1, docNo: 'SHIFT-1', openedById: 'u1', openedByName: 'cashier-a' }];

function setup(overrides: Record<string, unknown> = {}) {
  const legs = {
    cashAmount: Number((overrides as any).cashAmount ?? 0),
    cardAmount: Number((overrides as any).cardAmount ?? 0),
    transferAmount: Number((overrides as any).transferAmount ?? 0),
  };
  const paidAmount = legs.cashAmount + legs.cardAmount + legs.transferAmount;
  const params: Record<string, unknown> = {
    saleProducts: [],
    products: [],
    search: '',
    customers: [],
    branches: [{ id: 1, name: 'Main' }],
    locations: [{ id: 10, name: 'Main warehouse' }],
    openShiftRows: [],
    authUserId: 'u1',
    authPermissions: ['*'],
    settings: null,
    heldDrafts: [],
    recentProductIds: [],
    productFilter: 'all',
    cart: [cartItem],
    discount: 0,
    deliveryFee: 0,
    paidAmount,
    paymentType: 'cash',
    paymentChannel: 'cash',
    customerId: '',
    branchId: '1',
    locationId: '10',
    lastSale: null,
    orderType: 'takeaway',
    tableNumber: '',
    ...legs,
    ...overrides,
  };
  // The derived hook needs one catalog product for hasCatalogReady.
  (params as any).products = [{ id: 'p1', name: 'Tea', retail_price: 100, is_active: true }];
  return renderHook(() => usePosWorkspaceDerived(params as any));
}

describe('usePosWorkspaceDerived paid gates (R4-D)', () => {
  it('I41: a credit sale requires a cashier shift exactly like a cash sale', () => {
    const { result } = setup({ paymentType: 'credit', paymentChannel: 'credit', customerId: 'c1' });
    expect(result.current.requiresCashierShift).toBe(true);
    expect(result.current.canSubmitSale).toBe(false);
    expect(result.current.canSubmitHint).toContain('وردية');
  });

  it('I41: a credit sale WITH an open shift stays submittable', () => {
    const { result } = setup({
      paymentType: 'credit', paymentChannel: 'credit', customerId: 'c1',
      openShiftRows: openShift,
    });
    expect(result.current.canSubmitSale).toBe(true);
  });

  it('I45: card 120 on a 100 total shows zero change — the card was never cash', () => {
    const { result } = setup({ cardAmount: 120, paymentChannel: 'card' });
    expect(result.current.totals.total).toBe(100);
    expect(result.current.changeAmount).toBe(0);
  });

  it('I45: cash 120 on a 100 total still shows 20 change', () => {
    const { result } = setup({ cashAmount: 120 });
    expect(result.current.changeAmount).toBe(20);
  });

  it('I45: cash 50 + card 60 on a 100 total shows 10 change — only the cash leg overpaid its share', () => {
    const { result } = setup({ cashAmount: 50, cardAmount: 60 });
    expect(result.current.changeAmount).toBe(10);
  });

  it('I42: a dine-in sale without a table is flagged and not submittable', () => {
    const { result } = setup({ orderType: 'dine_in', tableNumber: '', openShiftRows: openShift });
    expect(result.current.hasDineInWithoutTable).toBe(true);
    expect(result.current.canSubmitSale).toBe(false);
    expect(result.current.canSubmitHint).toContain('طاولة');
  });

  it('I42: a dine-in sale with a table stays submittable', () => {
    // Fully paid (cash 100) so the underpaid flag does not mask the
    // table flag — the case pins the table gate only.
    const { result } = setup({ orderType: 'dine_in', tableNumber: 'T1', openShiftRows: openShift, cashAmount: 100 });
    expect(result.current.hasDineInWithoutTable).toBe(false);
    expect(result.current.canSubmitSale).toBe(true);
  });

  it('I44: a 100%-discounted (zero-total) cart is not submittable', () => {
    const { result } = setup({
      paymentType: 'credit', paymentChannel: 'credit', customerId: 'c1', discount: 100,
      openShiftRows: openShift,
    });
    expect(result.current.totals.total).toBe(0);
    expect(result.current.canSubmitSale).toBe(false);
    expect(result.current.canSubmitHint).toContain('صفر');
  });
});
