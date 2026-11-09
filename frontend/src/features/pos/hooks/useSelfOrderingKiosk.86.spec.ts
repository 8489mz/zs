/*
 * R-I11 (INV-REST-FNB-TRUTH-2): the kiosk menu must EXCLUDE 86'd
 * items entirely — a greyed-out item on a customer-facing menu
 * invites confusion and support calls; the kitchen toggles 86
 * precisely to stop orders.
 *
 * filterKioskMenuItems is the single pure decision: it drops every
 * item whose id is in the 86 list (number/string id shapes both
 * match) and keeps the rest in order. The page feeds it the menu
 * plus the 86 list; the server still rejects any 86'd line at
 * createOnlineOrder, so a stale menu can never place the order.
 *
 * RED PROOF: on the unfixed tree filterKioskMenuItems does not
 * exist and the kiosk menu has no 86 filter — see the base-run
 * note at the end of the report.
 */

import { describe, expect, it } from 'vitest';
import { filterKioskMenuItems } from '@/features/pos/hooks/useSelfOrderingKiosk';

const menu = [
  { id: 101, name: 'Shawarma', categoryId: 1 },
  { id: 102, name: 'Fries', categoryId: 1 },
  { id: '103', name: 'Soup', categoryId: 2 },
];

describe('kiosk menu 86 filter', () => {
  it('excludes 86d items from the menu entirely', () => {
    const visible = filterKioskMenuItems(menu, [101]);
    expect(visible.map((item: any) => item.id)).toEqual([102, '103']);
  });

  it('matches 86 ids across number/string id shapes', () => {
    const visible = filterKioskMenuItems(menu, ['103']);
    expect(visible.map((item: any) => item.id)).toEqual([101, 102]);
  });

  it('keeps every item when nothing is 86d, and keeps order', () => {
    expect(filterKioskMenuItems(menu, [])).toEqual(menu);
    expect(filterKioskMenuItems(menu, undefined)).toEqual(menu);
  });

  it('returns an empty menu when everything is 86d', () => {
    expect(filterKioskMenuItems(menu, [101, 102, 103])).toEqual([]);
    expect(filterKioskMenuItems([], [101])).toEqual([]);
  });
});
