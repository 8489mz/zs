/*
 * R5-D (INV-REST-FLOOR-STATE-TRUTH): the single floor-state derivation.
 *
 * The floor used to derive occupancy from three inconsistent maps in
 * PosTablesFloorPlanDialog (held drafts, QR orders, KDS tickets) while the
 * canvas consulted only some of them and read draft fields that do not
 * exist (cartTotal / cart / itemCount). Both views now render from the
 * one record this module returns.
 *
 * Occupancy rule (decided): a table is occupied iff it has a held draft
 * OR a live cart OR a pending QR order. A KDS ticket alone is a display
 * badge, never occupancy: the ticket means a sale already posted and
 * cooking, and blocking the table on it would strand tables after the
 * sale posts. A reservation alone is "reserved", not occupied.
 *
 * Money: a QR order on a table that also has a draft adds its money once
 * — counted once, never lost (the old stats dropped it entirely) and
 * never double-counted. Duplicate drafts on one table are kept as a list
 * and summed; the floor must show that two drafts claim one table rather
 * than silently overwriting the second (the server already blocks saving
 * a second hold per table, but rows created before that guard can exist).
 * A draft whose table number is not in 1..tablesCount is a custom table
 * and is returned as an extra-tile entry (zero schema change).
 */

export interface FloorDraftInput {
  id: string;
  label?: string;
  total?: number;
  itemsCount?: number;
  tableNumber?: string;
}

export interface FloorQrOrderInput {
  id: string | number;
  tableNumber?: string;
  totalAmount?: number;
  items?: unknown[];
  itemCount?: number;
}

export interface FloorKdsTicketInput {
  id: string | number;
  tableNumber?: string;
  course?: string;
}

export interface FloorLiveCartInput {
  tableNumber: string;
  total: number;
  itemsCount: number;
}

export interface FloorReservationInput {
  table_number?: string;
  tableNumber?: string;
  guest_name?: string;
  reservation_time?: string | Date;
  status?: string;
}

export type FloorTableStatus = 'occupied' | 'reserved' | 'free';

export interface FloorTableState {
  tableNumber: string;
  status: FloorTableStatus;
  /** True when the table number is not in 1..tablesCount (extra tile). */
  isCustom: boolean;
  /** Every held draft claiming this table (never silently overwritten). */
  drafts: FloorDraftInput[];
  /** First draft, for callers that only need one. */
  draft?: FloorDraftInput;
  qrOrder?: FloorQrOrderInput;
  /** Display badge only — never occupancy. */
  kdsTicket?: FloorKdsTicketInput;
  reservation?: FloorReservationInput;
  /** Drafts + QR money (QR counted once) + live cart money. */
  total: number;
  itemsCount: number;
  hasLiveCart: boolean;
}

export interface FloorState {
  byTable: Map<string, FloorTableState>;
  tables: FloorTableState[];
  occupiedCount: number;
  totalOccupiedMoney: number;
  availableCount: number;
  /** Draft tables outside 1..tablesCount, rendered as extra tiles. */
  customTables: FloorTableState[];
}

export interface BuildFloorStateInput {
  drafts?: FloorDraftInput[];
  qrOrders?: FloorQrOrderInput[];
  kdsTickets?: FloorKdsTicketInput[];
  liveCart?: FloorLiveCartInput | null;
  reservations?: FloorReservationInput[];
  tablesCount?: number;
}

function tableKey(value: unknown): string {
  return String(value ?? '').trim();
}

function isNumericTable(tableNumber: string, tablesCount: number): boolean {
  const n = Number(tableNumber);
  return Number.isInteger(n) && n >= 1 && n <= tablesCount;
}

export function buildFloorState(input: BuildFloorStateInput): FloorState {
  const tablesCount = Math.max(1, Number(input.tablesCount || 12));
  const byTable = new Map<string, FloorTableState>();

  const ensure = (tableNumber: string): FloorTableState => {
    const key = tableKey(tableNumber);
    let state = byTable.get(key);
    if (!state) {
      state = {
        tableNumber: key,
        status: 'free',
        isCustom: !isNumericTable(key, tablesCount),
        drafts: [],
        total: 0,
        itemsCount: 0,
        hasLiveCart: false,
      };
      byTable.set(key, state);
    }
    return state;
  };

  for (const draft of input.drafts ?? []) {
    const key = tableKey(draft.tableNumber);
    if (!key) continue;
    const state = ensure(key);
    state.drafts.push(draft);
    if (!state.draft) state.draft = draft;
    state.total += Number(draft.total || 0);
    state.itemsCount += Number(draft.itemsCount || 0);
  }

  for (const order of input.qrOrders ?? []) {
    const key = tableKey(order.tableNumber);
    if (!key) continue;
    const state = ensure(key);
    if (!state.qrOrder) {
      state.qrOrder = order;
      state.total += Number(order.totalAmount || 0);
      state.itemsCount += Number(order.itemCount ?? (Array.isArray(order.items) ? order.items.length : 1));
    }
  }

  for (const ticket of input.kdsTickets ?? []) {
    const key = tableKey(ticket.tableNumber);
    if (!key) continue;
    const state = ensure(key);
    if (!state.kdsTicket) state.kdsTicket = ticket;
  }

  if (input.liveCart && tableKey(input.liveCart.tableNumber)) {
    const state = ensure(input.liveCart.tableNumber);
    state.hasLiveCart = true;
    state.total += Number(input.liveCart.total || 0);
    state.itemsCount += Number(input.liveCart.itemsCount || 0);
  }

  for (const reservation of input.reservations ?? []) {
    const key = tableKey(reservation.table_number ?? reservation.tableNumber);
    if (!key) continue;
    const state = ensure(key);
    if (!state.reservation) state.reservation = reservation;
  }

  let occupiedCount = 0;
  let totalOccupiedMoney = 0;
  for (const state of byTable.values()) {
    state.status =
      state.drafts.length > 0 || state.hasLiveCart || Boolean(state.qrOrder)
        ? 'occupied'
        : state.reservation
          ? 'reserved'
          : 'free';
    if (state.status === 'occupied') {
      occupiedCount += 1;
      totalOccupiedMoney += state.total;
    }
  }

  const tables = Array.from(byTable.values());
  return {
    byTable,
    tables,
    occupiedCount,
    totalOccupiedMoney,
    availableCount: Math.max(0, tablesCount - occupiedCount),
    customTables: tables.filter((t) => t.isCustom),
  };
}

export interface QrRange {
  from: number;
  to: number;
  count: number;
  clamped: boolean;
  tables: number[];
}

/*
 * R-I57: the QR print range is clamped to the configured table count —
 * printing cards for tables that do not exist is refused at the helper,
 * not at the printer. A `to` above the count is clamped (and flagged),
 * never printed.
 */
export function buildQrRange(from: number, to: number, configuredCount: number): QrRange {
  const count = Math.max(1, Math.floor(Number(configuredCount) || 1));
  const rawFrom = Number(from);
  const rawTo = Number(to);
  const start = Math.max(1, Math.floor(Number.isFinite(rawFrom) ? rawFrom : 1));
  const end = Math.min(count, Math.max(start, Math.floor(Number.isFinite(rawTo) ? rawTo : start)));
  const clamped = start !== Math.floor(rawFrom) || end !== Math.floor(rawTo);
  const tables: number[] = [];
  for (let i = start; i <= end; i++) tables.push(i);
  return { from: start, to: end, count, clamped, tables };
}

/** True when the storefront slug was never configured (silent 'default'). */
export function isDefaultStorefrontSlug(slug: string | undefined | null): boolean {
  const value = String(slug ?? '').trim();
  return value === '' || value === 'default';
}
