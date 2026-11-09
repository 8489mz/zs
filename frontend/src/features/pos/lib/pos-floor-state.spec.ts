/*
 * R5-D (INV-REST-FLOOR-STATE-TRUTH): one floor-state source.
 *
 * At base the floor derived occupancy from three inconsistent maps in
 * PosTablesFloorPlanDialog: occupiedMap overwrote a second draft on the
 * same table, a QR order on a draft table contributed nothing to the
 * occupied money, the canvas rendered draft money as 0 / 1 item (it read
 * cartTotal / cart / itemCount, fields HeldPosDraftSummary does not have),
 * and a KDS ticket alone never marked a table occupied in either view.
 * buildFloorState is the single derivation both views render from.
 * Occupancy rule (decided): a table is occupied iff it has a draft OR a
 * live cart OR a QR order; a KDS ticket alone is a display badge only.
 * A QR order on a draft table adds its money once (never lost, never
 * double-counted); duplicate drafts on one table are both listed.
 */
import { describe, expect, it } from 'vitest';
import {
  buildFloorState,
  buildQrRange,
  isDefaultStorefrontSlug,
} from './pos-floor-state';

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  label: 'طاولة 5',
  total: 100,
  itemsCount: 2,
  tableNumber: '5',
  ...overrides,
});

const qrOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'q1',
  tableNumber: '5',
  totalAmount: 50,
  items: [{ id: 1 }, { id: 2 }],
  ...overrides,
});

describe('buildFloorState', () => {
  it('draft + QR on one table: occupied, QR money counted once, QR not lost', () => {
    const state = buildFloorState({
      drafts: [draft()],
      qrOrders: [qrOrder()],
      tablesCount: 12,
    });
    const table = state.byTable.get('5')!;
    expect(table.status).toBe('occupied');
    expect(table.total).toBe(150);
    expect(table.itemsCount).toBe(4);
    expect(table.qrOrder).toBeDefined();
    expect(table.drafts).toHaveLength(1);
    expect(state.totalOccupiedMoney).toBe(150);
    expect(state.occupiedCount).toBe(1);
  });

  it('two drafts on one table: both listed, totals summed, never overwritten', () => {
    const state = buildFloorState({
      drafts: [draft(), draft({ id: 'd2', total: 40, itemsCount: 1 })],
      tablesCount: 12,
    });
    const table = state.byTable.get('5')!;
    expect(table.status).toBe('occupied');
    expect(table.drafts).toHaveLength(2);
    expect(table.total).toBe(140);
    expect(table.itemsCount).toBe(3);
    expect(state.occupiedCount).toBe(1);
  });

  it('QR-only table: occupied with the QR money shown', () => {
    const state = buildFloorState({
      drafts: [],
      qrOrders: [qrOrder({ tableNumber: '7', totalAmount: 80, items: [{ id: 1 }] })],
      tablesCount: 12,
    });
    const table = state.byTable.get('7')!;
    expect(table.status).toBe('occupied');
    expect(table.total).toBe(80);
    expect(table.itemsCount).toBe(1);
    expect(state.occupiedCount).toBe(1);
  });

  it('KDS-only table: free, with a KDS badge — never occupancy', () => {
    const state = buildFloorState({
      drafts: [],
      kdsTickets: [{ id: 'k1', tableNumber: '3', course: 'main' }],
      tablesCount: 12,
    });
    const table = state.byTable.get('3')!;
    expect(table.status).toBe('free');
    expect(table.kdsTicket).toBeDefined();
    expect(state.occupiedCount).toBe(0);
  });

  it('live cart table: occupied with the live total', () => {
    const state = buildFloorState({
      drafts: [],
      liveCart: { tableNumber: '2', total: 90, itemsCount: 3 },
      tablesCount: 12,
    });
    const table = state.byTable.get('2')!;
    expect(table.status).toBe('occupied');
    expect(table.total).toBe(90);
    expect(table.itemsCount).toBe(3);
    expect(table.hasLiveCart).toBe(true);
  });

  it('reservation-only table: reserved, not occupied', () => {
    const state = buildFloorState({
      drafts: [],
      reservations: [{ table_number: '4', guest_name: 'ضيف', reservation_time: '2026-11-09T19:00:00Z', status: 'confirmed' }],
      tablesCount: 12,
    });
    const table = state.byTable.get('4')!;
    expect(table.status).toBe('reserved');
    expect(state.occupiedCount).toBe(0);
  });

  it('custom-table draft: an extra-tile entry outside 1..N', () => {
    const state = buildFloorState({
      drafts: [draft({ id: 'd9', tableNumber: 'VIP 2', total: 300, itemsCount: 5 })],
      tablesCount: 12,
    });
    expect(state.customTables.map((t) => t.tableNumber)).toEqual(['VIP 2']);
    const table = state.byTable.get('VIP 2')!;
    expect(table.isCustom).toBe(true);
    expect(table.status).toBe('occupied');
    expect(table.total).toBe(300);
  });

  it('a numeric table inside 1..N is not a custom table', () => {
    const state = buildFloorState({ drafts: [draft()], tablesCount: 12 });
    expect(state.customTables).toHaveLength(0);
    expect(state.byTable.get('5')!.isCustom).toBe(false);
  });
});

describe('buildQrRange', () => {
  it('clamps to the configured count', () => {
    const range = buildQrRange(1, 100, 12);
    expect(range.from).toBe(1);
    expect(range.to).toBe(12);
    expect(range.clamped).toBe(true);
    expect(range.tables).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('rejects a to above the configured count instead of printing ghost tables', () => {
    const range = buildQrRange(10, 20, 12);
    expect(range.to).toBe(12);
    expect(range.clamped).toBe(true);
    expect(range.tables).not.toContain(13);
  });

  it('passes a range inside the configured count through untouched', () => {
    const range = buildQrRange(3, 5, 12);
    expect(range).toEqual({ from: 3, to: 5, count: 12, clamped: false, tables: [3, 4, 5] });
  });

  it('clamps a from below 1 up to 1', () => {
    const range = buildQrRange(0, 3, 12);
    expect(range.from).toBe(1);
    expect(range.clamped).toBe(true);
  });
});

describe('isDefaultStorefrontSlug', () => {
  it('detects the unconfigured slug', () => {
    expect(isDefaultStorefrontSlug('default')).toBe(true);
    expect(isDefaultStorefrontSlug('')).toBe(true);
    expect(isDefaultStorefrontSlug(undefined)).toBe(true);
    expect(isDefaultStorefrontSlug('my-shop')).toBe(false);
  });
});
