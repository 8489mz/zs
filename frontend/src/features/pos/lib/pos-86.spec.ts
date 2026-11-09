/*
 * R-I11 (INV-REST-FNB-TRUTH-2): the POS must refuse to add an 86'd
 * item, naming it — the server rejects it at submit anyway, but the
 * cashier must be stopped at the add, not at checkout.
 *
 * addPosItem takes the 86 list (product ids) via
 * options.eightySixedProductIds — the first statement in the
 * function, before any key/stock logic — and throws a named error.
 * The workspace passes the list the header already fetches
 * (query key ['pos-86-items-header', branchId]).
 *
 * Also pins the tenant-local date helper the prep-sheet modal
 * reuses: todayLocalIsoDate builds the date from local calendar
 * parts, never from UTC toISOString (00:00–02:00 Cairo "today"
 * was yesterday's date under UTC).
 *
 * RED PROOF: on the unfixed tree addPosItem has no 86 option and
 * the 86'd add succeeds, and todayLocalIsoDate is not exported —
 * see the base-run note at the end of the report.
 */

import { describe, expect, it } from 'vitest';
import { addPosItem, todayLocalIsoDate } from '@/features/pos/lib/pos.domain';
import type { Product } from '@/types/domain';

const product: Product = {
  id: 'p1',
  name: 'Shawarma',
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

describe('POS 86 block', () => {
  it('refuses to add an 86d item and names it', () => {
    expect(() =>
      addPosItem([], product, { priceType: 'retail', digits: 2, eightySixedProductIds: ['p1'] }),
    ).toThrow('Shawarma');
    expect(() =>
      addPosItem([], product, { priceType: 'retail', digits: 2, eightySixedProductIds: ['p1'] }),
    ).toThrow('86');
  });

  it('matches 86 ids across number/string id shapes', () => {
    const numericProduct = { ...product, id: '7' as unknown as Product['id'] };
    expect(() =>
      addPosItem([], numericProduct, { priceType: 'retail', digits: 2, eightySixedProductIds: [7] }),
    ).toThrow('Shawarma');
  });

  it('adds a non-86d item normally', () => {
    const cart = addPosItem([], product, { priceType: 'retail', digits: 2, eightySixedProductIds: ['p2'] });
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Shawarma');
    const noList = addPosItem([], product, { priceType: 'retail', digits: 2 });
    expect(noList).toHaveLength(1);
  });

  it('builds today from local calendar parts, not UTC', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayLocalIsoDate()).toBe(expected);
  });
});
