/* INV-REST-HOLD-RECALL-TRUTH (R5-B, I29/I30/I31): the hold/recall
 * snapshot is lossy — hold drops fields, recall reprices / drops lines
 * and overwrites the live cart, refresh loses delivery fee / rep /
 * status / tip / loyalty.
 *
 * WHAT THIS PINS:
 * - buildHeldSnapshot / restoreHeldSnapshot round-trip EVERY field
 *   (serials, tip, loyalty, pager, guestCount, check-printed,
 *   diningCourse, deliveryFeeMode, onlineOrderId, branch/location);
 *   two identical product/unit/price lines keep distinct keys.
 * - buildDraftState (localStorage path) preserves the same field list
 *   as buildHeldSnapshot — the three snapshot lists stay in sync.
 * - syncPosCartStock freezes a held line's price, never silently drops
 *   a held line, and flags a stock-out held line instead of deleting it.
 */

import { describe, expect, it } from 'vitest';
import { buildDraftState } from '@/features/pos/lib/pos.persistence';
import {
  HELD_SNAPSHOT_HEADER_FIELDS,
  HELD_SNAPSHOT_VERSION,
  buildHeldSnapshot,
  restoreHeldSnapshot,
  type HeldSnapshotState,
} from '@/features/pos/lib/pos-held-snapshot';
import { syncPosCartStock } from '@/features/pos/lib/pos.domain';
import type { PosItem } from '@/features/pos/types/pos.types';
import type { Product } from '@/types/domain';

const product: Product = {
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

function line(overrides: Partial<PosItem> = {}): PosItem {
  return {
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
    ...overrides,
  };
}

function fullState(): HeldSnapshotState {
  return {
    cart: [
      line({
        lineKey: 'p1::u1::retail::seat-1',
        serials: ['SN-1', 'SN-2'],
        originalPrice: 30,
        offerDiscount: 5,
        offerName: 'Deal',
        isWeighted: false,
        quantityChunks: [1, 1],
        seatNumber: 1,
        course: 'main',
      }),
      line({ lineKey: 'p1::u1::retail::seat-2', serials: [], seatNumber: 2, course: 'main' }),
    ],
    customerId: '7',
    customerName: 'Customer Seven',
    customerPhone: '01000000000',
    customerAddress: 'Cairo',
    quickCustomerName: 'Customer Seven',
    quickCustomerPhone: '01000000000',
    quickCustomerAddress: 'Cairo',
    discount: 3,
    deliveryFee: 15,
    paidAmount: 20,
    cashAmount: 20,
    cardAmount: 0,
    transferAmount: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    note: 'no onions',
    search: '',
    priceType: 'retail',
    branchId: '2',
    locationId: '5',
    tableNumber: 'T1',
    diningCourse: 'dessert',
    guestCount: 4,
    guestCheckPrintedAt: '2026-11-09T12:00:00.000Z',
    orderType: 'dine_in',
    deliveryRepId: '9',
    collectionStatus: 'prepaid_by_rep',
    onlineOrderId: 77,
    tipAmount: 5,
    loyaltyPointsRedeemed: 10,
    pagerNumber: 'A12',
    deliveryFeeMode: 'store_fleet',
  };
}

describe('held snapshot round-trip', () => {
  it('buildHeldSnapshot carries every field and is versioned', () => {
    const snapshot = buildHeldSnapshot(fullState());
    expect(snapshot.snapshotVersion).toBe(HELD_SNAPSHOT_VERSION);
    expect(snapshot.tipAmount).toBe(5);
    expect(snapshot.loyaltyPointsRedeemed).toBe(10);
    expect(snapshot.pagerNumber).toBe('A12');
    expect(snapshot.deliveryFeeMode).toBe('store_fleet');
    expect(snapshot.onlineOrderId).toBe(77);
    expect(snapshot.diningCourse).toBe('dessert');
    expect(snapshot.guestCount).toBe(4);
    expect(snapshot.guestCheckPrintedAt).toBe('2026-11-09T12:00:00.000Z');
    expect(snapshot.branchId).toBe('2');
    expect(snapshot.locationId).toBe('5');
    expect(snapshot.deliveryFee).toBe(15);
    expect(snapshot.deliveryRepId).toBe('9');
    expect(snapshot.collectionStatus).toBe('prepaid_by_rep');
    expect(snapshot.cart).toHaveLength(2);
    expect(snapshot.cart[0].serials).toEqual(['SN-1', 'SN-2']);
    expect(snapshot.cart[0].originalPrice).toBe(30);
    expect(snapshot.cart[0].offerDiscount).toBe(5);
    expect(snapshot.cart[0].offerName).toBe('Deal');
    expect(snapshot.cart[0].quantityChunks).toEqual([1, 1]);
    expect(snapshot.cart[0].seatNumber).toBe(1);
    expect(snapshot.cart[0].course).toBe('main');
  });

  it('buildHeldSnapshot strips session markers so they never reach the server', () => {
    const snapshot = buildHeldSnapshot({
      ...fullState(),
      cart: [line({ priceHeldAt: 123456, heldUnavailable: true })],
    });
    expect((snapshot.cart[0] as PosItem).priceHeldAt).toBeUndefined();
    expect((snapshot.cart[0] as PosItem).heldUnavailable).toBeUndefined();
  });

  it('restoreHeldSnapshot round-trips every field and marks lines held', () => {
    const { cart, header } = restoreHeldSnapshot(buildHeldSnapshot(fullState()));
    expect(cart).toHaveLength(2);
    expect(cart[0].serials).toEqual(['SN-1', 'SN-2']);
    expect(cart[0].originalPrice).toBe(30);
    expect(cart[0].offerDiscount).toBe(5);
    expect(cart[0].offerName).toBe('Deal');
    expect(cart[0].quantityChunks).toEqual([1, 1]);
    expect(cart[0].seatNumber).toBe(1);
    expect(cart[0].course).toBe('main');
    expect(cart[0].priceHeldAt).toBeGreaterThan(0);
    expect(header.tipAmount).toBe(5);
    expect(header.loyaltyPointsRedeemed).toBe(10);
    expect(header.pagerNumber).toBe('A12');
    expect(header.deliveryFeeMode).toBe('store_fleet');
    expect(header.onlineOrderId).toBe(77);
    expect(header.diningCourse).toBe('dessert');
    expect(header.guestCount).toBe(4);
    expect(header.guestCheckPrintedAt).toBe('2026-11-09T12:00:00.000Z');
    expect(header.branchId).toBe('2');
    expect(header.locationId).toBe('5');
    expect(header.deliveryFee).toBe(15);
    expect(header.deliveryRepId).toBe('9');
    expect(header.collectionStatus).toBe('prepaid_by_rep');
  });

  it('two identical product/unit/price lines keep distinct keys', () => {
    const { cart } = restoreHeldSnapshot(buildHeldSnapshot(fullState()));
    expect(cart[0].lineKey).toBe('p1::u1::retail::seat-1');
    expect(cart[1].lineKey).toBe('p1::u1::retail::seat-2');
    expect(cart[0].lineKey).not.toBe(cart[1].lineKey);
  });

  it('restoreHeldSnapshot leaves a missing lineKey empty for recallDraft to synthesise', () => {
    const { cart } = restoreHeldSnapshot(buildHeldSnapshot({
      ...fullState(),
      cart: [line({ lineKey: '' })],
    }));
    expect(cart[0].lineKey).toBe('');
  });

  it('buildDraftState preserves the same header field list as buildHeldSnapshot', () => {
    const snapshot = buildHeldSnapshot(fullState());
    const stored = buildDraftState(snapshot);
    const state = fullState();
    for (const field of HELD_SNAPSHOT_HEADER_FIELDS) {
      const expected = (snapshot as unknown as Record<string, unknown>)[field];
      const actual = (stored as unknown as Record<string, unknown>)[field];
      expect(actual, `buildDraftState must preserve ${field}`).toEqual(expected);
      expect(actual, `${field} must come from the state`).toEqual(
        (state as unknown as Record<string, unknown>)[field] ?? (snapshot as unknown as Record<string, unknown>)[field],
      );
    }
    expect(stored.snapshotVersion).toBe(HELD_SNAPSHOT_VERSION);
  });
});

describe('syncPosCartStock with held lines', () => {
  it('keeps a held line price and offer fields instead of repricing from the catalog', () => {
    const held = line({
      price: 25,
      originalPrice: 30,
      offerDiscount: 5,
      offerName: 'Deal',
      priceHeldAt: Date.now(),
    });
    const result = syncPosCartStock([held], [product], { allowNegativeStockSales: false, digits: 2 });
    expect(result.cart).toHaveLength(1);
    expect(result.cart[0].price).toBe(25);
    expect(result.cart[0].originalPrice).toBe(30);
    expect(result.cart[0].offerDiscount).toBe(5);
    expect(result.cart[0].offerName).toBe('Deal');
    expect(result.removedCount).toBe(0);
    expect(result.clampedCount).toBe(0);
  });

  it('keeps a stock-out held line and flags it instead of silently deleting it', () => {
    const soldOut = { ...product, stock: 0 };
    const held = line({ priceHeldAt: Date.now() });
    const result = syncPosCartStock([held], [soldOut], { allowNegativeStockSales: false, digits: 2 });
    expect(result.cart).toHaveLength(1);
    expect(result.cart[0].heldUnavailable).toBe(true);
    expect(result.removedCount).toBe(0);
    expect(result.heldUnavailableCount).toBe(1);
  });

  it('still deletes a stock-out line that was never held', () => {
    const soldOut = { ...product, stock: 0 };
    const fresh = line();
    const result = syncPosCartStock([fresh], [soldOut], { allowNegativeStockSales: false, digits: 2 });
    expect(result.cart).toHaveLength(0);
    expect(result.removedCount).toBe(1);
    expect(result.heldUnavailableCount).toBe(0);
  });

  it('still reprices a line that was never held', () => {
    const fresh = line({ price: 25 });
    const result = syncPosCartStock([fresh], [product], { allowNegativeStockSales: false, digits: 2 });
    expect(result.cart[0].price).toBe(10);
  });
});
