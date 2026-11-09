import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  isAllowedKdsItemTransition,
  isAllowedKdsTransition,
  resolveItemStation,
  type KdsItemStatus,
  type KdsStation,
  type KdsTicketStatus,
} from '../helpers/kds-station.helper';

export type { KdsStation, KdsTicketStatus, KdsItemStatus };
export type KdsUrgencyLevel = 'normal' | 'warning' | 'critical';

export interface KdsTicketItem {
  id: number;
  productId?: number;
  name: string;
  qty: number;
  unitName?: string;
  modifiers?: Array<{ name: string; qty?: number; price?: number }>;
  notes?: string;
  status: KdsItemStatus;
  station: KdsStation;
}

export interface KdsTicket {
  id: number;
  docNo: string;
  orderNumber: string;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  tableNumber?: string;
  customerName?: string;
  cashierName?: string;
  status: KdsTicketStatus;
  elapsedMinutes: number;
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  items: KdsTicketItem[];
  urgencyLevel: KdsUrgencyLevel;
  course?: 'appetizer' | 'main' | 'dessert' | 'beverage';
  aggregatorChannel?: string;
  aggregatorOrderId?: string;
  pagerNumber?: string;
}

export interface KdsSummaryStats {
  pendingCount: number;
  cookingCount: number;
  readyCount: number;
  criticalCount: number;
  avgPrepMinutes: number;
}

interface StoredKdsState {
  tickets: Record<
    string,
    {
      status: KdsTicketStatus;
      itemsStatus: Record<string, KdsItemStatus>;
      updatedAt: string;
    }
  >;
  lastServedId?: number;
  /**
   * R4-E I55: the persisted blob (or an entry inside it) was unreadable.
   * Reads keep working on an empty in-memory state and the stored row is
   * left untouched, so nothing recoverable is ever overwritten with a
   * fabricated empty state. Writers drop the flag before persisting.
   */
  corrupt?: boolean;
}

/** R4-E I18: KDS state may only be written inside the 14h ticket window. */
function assertWithinTicketWindow(createdAt: unknown): void {
  const ms = createdAt instanceof Date
    ? createdAt.getTime()
    : (createdAt ? new Date(String(createdAt)).getTime() : NaN);
  if (!Number.isFinite(ms) || Date.now() - ms > 14 * 60 * 60 * 1000) {
    throw new NotFoundException('تذكرة المطعم غير موجودة أو انتهت مدة عرضها');
  }
}

@Injectable()
export class KdsService {
  private readonly logger = new Logger(KdsService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const { tenantId } = requireTenantScope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}`
      : sql<boolean>`tenant_id = ${tenantId}`;
  }

  private async getKdsStoreState(tenantId: string, db: Kysely<Database> = this.db): Promise<StoredKdsState> {
    try {
      const record = await db
        .selectFrom('settings')
        .select(['value'])
        .where('key', '=', 'kds_tickets_runtime_state')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .executeTakeFirst();

      if (record?.value) {
        let state: StoredKdsState;
        try {
          state = JSON.parse(record.value) as StoredKdsState;
        } catch (e: any) {
          // R4-E I55: one bad blob used to throw here and blind every kitchen
          // screen on every 5s poll. Log loudly, leave the stored row
          // untouched, and serve the tickets without progress.
          this.logger.error(
            `KDS runtime state for tenant ${tenantId} is corrupt JSON (${e?.message || e}). The stored row is left untouched; tickets are shown without progress.`,
          );
          return { tickets: {}, corrupt: true };
        }
        if (!state || typeof state !== 'object' || Array.isArray(state)) {
          this.logger.error(
            `KDS runtime state for tenant ${tenantId} is not an object. The stored row is left untouched; tickets are shown without progress.`,
          );
          return { tickets: {}, corrupt: true };
        }
        state.tickets ||= {};
        if (typeof state.tickets !== 'object' || Array.isArray(state.tickets)) {
          state.tickets = {};
          state.corrupt = true;
        }
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        let quarantined = false;
        for (const [id, ticket] of Object.entries(state.tickets || {})) {
          // R4-E I55: one null / non-object / invalid-status entry used to
          // throw (new Date(null.updatedAt)) and kill the whole response.
          // Quarantine the bad entry and keep the rest.
          if (!ticket || typeof ticket !== 'object'
            || !['pending', 'cooking', 'ready', 'served'].includes((ticket as any).status)) {
            delete state.tickets[id];
            quarantined = true;
            continue;
          }
          if (!ticket.itemsStatus || typeof ticket.itemsStatus !== 'object') ticket.itemsStatus = {};
          const updatedAt = new Date(ticket.updatedAt).getTime();
          if (!Number.isFinite(updatedAt) || updatedAt < cutoff) delete state.tickets[id];
        }
        if (state.lastServedId && !state.tickets[String(state.lastServedId)]) state.lastServedId = undefined;
        if (quarantined) state.corrupt = true;
        return state;
      }
    } catch (e: any) {
      // A read failure must not blind the kitchen either: log loudly, keep
      // the stored row untouched, and serve the tickets without progress.
      this.logger.error(
        `Failed reading kds runtime state: ${e?.message || e}. The stored row is left untouched; tickets are shown without progress.`,
      );
      return { tickets: {}, corrupt: true };
    }
    return { tickets: {} };
  }

  private async saveKdsStoreState(tenantId: string, state: StoredKdsState, db: Kysely<Database> = this.db): Promise<void> {
    // The corrupt flag is a read-time signal only and is never persisted.
    const persistable: StoredKdsState = { tickets: state.tickets };
    if (state.lastServedId) persistable.lastServedId = state.lastServedId;
    const jsonStr = JSON.stringify(persistable);
    const existing = await db
      .selectFrom('settings')
      .select(['key'])
      .where('key', '=', 'kds_tickets_runtime_state')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable('settings')
        .set({ value: jsonStr })
        .where('key', '=', 'kds_tickets_runtime_state')
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();
    } else {
      await db
        .insertInto('settings')
        .values({
          tenant_id: tenantId,
          account_id: 'default',
          key: 'kds_tickets_runtime_state',
          value: jsonStr,
        })
        .execute();
    }
  }

  /** All state writes are serialized on the tenant row and committed with the order update. */
  private async withKdsWrite<T>(tenantId: string, mutate: (trx: Kysely<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const tenant = await trx.selectFrom('tenants').select('id')
        .where('id', '=', tenantId).forUpdate().executeTakeFirst();
      if (!tenant) throw new NotFoundException('المنشأة غير موجودة');
      return mutate(trx);
    });
  }

  private async assertTicketOwned(
    db: Kysely<Database>, tenantId: string, ticketId: number, itemId?: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('رقم تذكرة المطبخ غير صالح');
    }
    if (ticketId >= 10_000_000) {
      const agg = await db.selectFrom('pos_aggregator_orders')
        .select(['id', 'status', 'order_payload', 'created_at'])
        .where('id', '=', ticketId - 10_000_000).where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!agg || !['received', 'preparing', 'ready', 'picked_up'].includes(String(agg.status))) {
        throw new NotFoundException('تذكرة التوصيل غير موجودة أو ألغيت');
      }
      // R4-E I18: state may only be written inside the 14h ticket window,
      // matching what getActiveTickets shows.
      assertWithinTicketWindow((agg as any).created_at);
      if (itemId !== undefined) {
        let payload: any;
        try { payload = typeof agg.order_payload === 'string' ? JSON.parse(agg.order_payload) : agg.order_payload; }
        catch { throw new BadRequestException('بيانات أصناف الطلب غير صالحة'); }
        if (!Array.isArray(payload?.items) || itemId < 1000 ||
            !Number.isSafeInteger(itemId) || itemId >= 1000 + payload.items.length) {
          throw new NotFoundException('صنف تذكرة التوصيل غير موجود');
        }
      }
      return;
    }
    const sale = await db.selectFrom('sales').select(['id', 'status', 'order_type', 'created_at'])
      .where('id', '=', ticketId).where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!sale || sale.status === 'cancelled' ||
        !['dine_in', 'takeaway', 'delivery'].includes(String(sale.order_type || 'dine_in'))) {
      throw new NotFoundException('تذكرة المطعم غير موجودة أو ألغيت');
    }
    // R4-E I18: state may only be written inside the 14h ticket window,
    // matching what getActiveTickets shows.
    assertWithinTicketWindow((sale as any).created_at);
    if (itemId !== undefined) {
      const item = await db.selectFrom('sale_items').select('id')
        .where('tenant_id', '=', tenantId).where('sale_id', '=', ticketId)
        .where('id', '=', itemId).executeTakeFirst();
      if (!item) throw new NotFoundException('صنف التذكرة غير موجود');
    }
  }

  /**
   * Hands a kitchen ticket's progress from one sale to another — used when a storefront QR order's
   * DRAFT sale (what the kitchen was cooking from) is replaced by the cashier's POSTED sale. Without it
   * the kitchen would see the order vanish and reappear as a brand-new pending ticket.
   * With `toSaleId = null` the draft's state is simply dropped (order cancelled).
   * Item-level status is keyed by sale_item id, which changes with the new sale, so only the ticket
   * status carries over.
   */
  async transferTicketState(tenantId: string, fromSaleId: number, toSaleId: number | null): Promise<void> {
    return this.withKdsWrite(tenantId, (trx) => this.transferTicketStateInTrx(tenantId, fromSaleId, toSaleId, trx));
  }

  /**
   * R4-E I17: the trx-aware transfer. createSale's release block runs
   * inside its own transaction, and opening a second transaction there
   * would nest transactions on the pool (the PGlite single-connection hang),
   * so the transfer inside createSale MUST use this variant, never the
   * public one. A corrupt runtime state skips the move with a loud log
   * instead of failing the caller's transaction: a sale must never fail
   * because KDS progress is unreadable.
   */
  async transferTicketStateInTrx(
    tenantId: string, fromSaleId: number, toSaleId: number | null, trx: Kysely<Database>,
  ): Promise<void> {
    const state = await this.getKdsStoreState(tenantId, trx);
    if (state.corrupt) {
      this.logger.warn(
        `Skipping KDS ticket transfer ${fromSaleId} -> ${toSaleId ?? 'null'}: runtime state is corrupt`,
      );
      return;
    }
    const fromKey = String(fromSaleId);
    const stored = state.tickets?.[fromKey];
    if (!stored) return;

    delete state.tickets[fromKey];
    if (toSaleId) {
      state.tickets[String(toSaleId)] = {
        status: stored.status,
        itemsStatus: {},
        updatedAt: new Date().toISOString(),
      };
    }
    await this.saveKdsStoreState(tenantId, state, trx);
  }

  /**
   * Get all active kitchen tickets (pending, cooking, ready) within the last 14 hours
   */
  async getActiveTickets(
    auth: AuthContext,
    filters?: { station?: KdsStation; orderType?: string; status?: KdsTicketStatus }
  ): Promise<{ tickets: KdsTicket[]; stats: KdsSummaryStats; lastServedId?: number; truncated: boolean; totalActive: number; kdsStateCorrupt: boolean }> {
    const { tenantId } = requireTenantScope(auth);
    const runtimeState = await this.getKdsStoreState(tenantId);

    // Fetch sales from the past 14 hours
    const fourteenHoursAgo = new Date(Date.now() - 14 * 60 * 60 * 1000);
    const servedIds = Object.entries(runtimeState.tickets)
      .filter(([, state]) => state.status === 'served')
      .map(([id]) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0);

    let salesQuery = this.db
      .selectFrom('sales as s')
      .leftJoin('users as u', (join) => join.onRef('u.id', '=', 's.created_by').onRef('u.tenant_id', '=', 's.tenant_id'))
      .leftJoin('customers as c', (join) => join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
      .select([
        's.id',
        's.doc_no',
        's.order_type',
        's.table_number',
        's.status as sale_status',
        's.note',
        's.created_at',
        's.customer_name',
        's.dining_course',
        's.aggregator_channel',
        's.pager_number',
        'c.name as customer_name_ref',
        'u.username as cashier_username',
      ])
      .where(this.tenantPredicate(auth, 's'))
      .where('s.created_at', '>=', fourteenHoursAgo)
      .where('s.status', '!=', 'cancelled')
      .where('s.order_type', 'in', ['dine_in', 'takeaway', 'delivery']);
    if (servedIds.length) salesQuery = salesQuery.where(sql<boolean>`s.id <> ALL(${servedIds}::bigint[])`);
    // R4-E I16: the banner needs the real total, not just the flag.
    const countRow = await salesQuery
      .clearSelect()
      .select(sql<number>`count(*)`.as('n'))
      .executeTakeFirst();
    const totalActive = Number(countRow?.n ?? 0);
    // Oldest outstanding tickets retain priority when the bounded kitchen queue overflows.
    const candidateRows = await salesQuery.orderBy('s.created_at', 'asc').orderBy('s.id', 'asc').limit(201).execute();
    const salesRows = candidateRows.slice(0, 200);
    const truncated = candidateRows.length > 200;

    const saleIds = salesRows.map((s) => Number(s.id));

    // Fetch sale items
    const itemRows = saleIds.length > 0
      ? await this.db
          .selectFrom('sale_items as si')
          .leftJoin('products as p', (join) => join
            .onRef('p.id', '=', 'si.product_id')
            .onRef('p.tenant_id', '=', 'si.tenant_id'))
          // R4-E I15: the category station is a real configured value
          // (product_categories.kitchen_station) and must be read, not guessed.
          .leftJoin('product_categories as pc', (join) => join
            .onRef('pc.id', '=', 'p.category_id')
            .onRef('pc.tenant_id', '=', 'si.tenant_id'))
          .select(['si.id', 'si.sale_id', 'si.product_id', 'si.product_name',
            'si.qty', 'si.unit_name', 'si.modifiers', 'si.notes',
            'p.kitchen_station as configured_station',
            'pc.kitchen_station as category_station',
            'pc.name as category_name'])
          .where('si.sale_id', 'in', saleIds)
          .where('si.tenant_id', '=', tenantId)
          .orderBy('si.id', 'asc')
          .execute()
      : [];

    const itemsBySale = new Map<number, typeof itemRows>();
    for (const item of itemRows) {
      const sid = Number(item.sale_id);
      if (!itemsBySale.has(sid)) itemsBySale.set(sid, []);
      itemsBySale.get(sid)!.push(item);
    }

    const now = Date.now();
    const tickets: KdsTicket[] = [];

    let totalMinutes = 0;
    let countedForAvg = 0;

    for (const sale of salesRows) {
      const saleId = Number(sale.id);
      const ticketStored = runtimeState.tickets[String(saleId)];
      const ticketStatus: KdsTicketStatus = ticketStored?.status || 'pending';

      // Skip already served tickets from main live grid
      if (ticketStatus === 'served') {
        continue;
      }

      if (filters?.status && filters.status !== ticketStatus) {
        continue;
      }

      const rawCreatedAt = sale.created_at;
      const saleCreatedAtMs = rawCreatedAt instanceof Date ? rawCreatedAt.getTime() : (rawCreatedAt ? new Date(rawCreatedAt).getTime() : now);
      const elapsedSeconds = Math.max(0, Math.floor((now - saleCreatedAtMs) / 1000));
      const elapsedMinutes = Math.floor(elapsedSeconds / 60);

      let urgencyLevel: KdsUrgencyLevel = 'normal';
      if (elapsedMinutes >= 15) {
        urgencyLevel = 'critical';
      } else if (elapsedMinutes >= 8) {
        urgencyLevel = 'warning';
      }

      const rawItems = itemsBySale.get(saleId) || [];
      const parsedItems: KdsTicketItem[] = rawItems.map((item) => {
        const itemId = Number(item.id);
        const itemStatus: KdsItemStatus = ticketStored?.itemsStatus?.[String(itemId)] || (ticketStatus === 'ready' ? 'ready' : 'pending');

        let mods: Array<{ name: string; qty?: number; price?: number }> = [];
        if (typeof item.modifiers === 'string') {
          try {
            mods = JSON.parse(item.modifiers);
          } catch {
            mods = [];
          }
        } else if (Array.isArray(item.modifiers)) {
          mods = item.modifiers;
        }

        return {
          id: itemId,
          productId: item.product_id ? Number(item.product_id) : undefined,
          name: item.product_name,
          qty: Number(item.qty) || 1,
          unitName: item.unit_name || 'وجبة',
          modifiers: mods,
          notes: item.notes || undefined,
          status: itemStatus,
          // R4-E I15: product station -> category station -> word-boundary
          // keyword inference (see kds-station.helper).
          station: resolveItemStation({
            productStation: (item as any).configured_station,
            categoryStation: (item as any).category_station,
            productName: item.product_name,
            categoryName: (item as any).category_name,
          }),
        };
      });

      // Filter items by station if requested
      const stationFilter = filters?.station && filters.station !== 'all' && filters.station !== 'expo' ? filters.station : null;
      const filteredItems = stationFilter
        ? parsedItems.filter((it) => it.station === stationFilter)
        : parsedItems;

      if (stationFilter && !filteredItems.length) {
        continue;
      }

      // Filter by orderType
      const orderTypeFilter = filters?.orderType && filters.orderType !== 'all' ? filters.orderType : null;
      const orderTypeVal = (sale.order_type || 'dine_in') as 'dine_in' | 'takeaway' | 'delivery';
      if (orderTypeFilter && orderTypeVal !== orderTypeFilter) {
        continue;
      }

      const shortMatch = String(sale.doc_no || sale.id).match(/-0*(\d+)$/);
      const orderNumber = shortMatch ? shortMatch[1] : String(sale.id);

      const createdAtStr = rawCreatedAt instanceof Date ? rawCreatedAt.toISOString() : (rawCreatedAt ? String(rawCreatedAt) : new Date().toISOString());

      tickets.push({
        id: saleId,
        docNo: String(sale.doc_no || `#${saleId}`),
        orderNumber: `#${orderNumber}`,
        orderType: orderTypeVal,
        tableNumber: sale.table_number || undefined,
        customerName: sale.customer_name || sale.customer_name_ref || undefined,
        cashierName: sale.cashier_username || undefined,
        status: ticketStatus,
        elapsedMinutes,
        elapsedSeconds,
        createdAt: createdAtStr,
        updatedAt: ticketStored?.updatedAt || createdAtStr,
        notes: sale.note || undefined,
        items: filteredItems,
        urgencyLevel,
        course: (sale as any).dining_course || undefined,
        aggregatorChannel: (sale as any).aggregator_channel || undefined,
        pagerNumber: (sale as any).pager_number || undefined,
      });

      totalMinutes += elapsedMinutes;
      countedForAvg++;
    }

    // Ingest live aggregator delivery orders (Jahez, Hungerstation, Talabat, Keeta, Deliveroo)
    const aggOrders = await this.db
      .selectFrom('pos_aggregator_orders as o')
      .innerJoin('pos_delivery_aggregators as a', 'a.id', 'o.aggregator_id')
      .select([
        'o.id',
        'o.display_number',
        'o.external_order_id',
        'o.status',
        'o.customer_name',
        'o.rider_name',
        'o.order_payload',
        'o.created_at',
        'a.code as aggregator_code',
        'a.name as aggregator_name',
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.created_at', '>=', fourteenHoursAgo)
      .where('o.status', 'in', ['received', 'preparing', 'ready'])
      .orderBy('o.created_at', 'asc')
      .execute();

    for (const agg of aggOrders) {
      const aggTicketId = 10_000_000 + Number(agg.id);
      const ticketStored = runtimeState.tickets[String(aggTicketId)];
      const mappedStatus: KdsTicketStatus = ticketStored?.status
        || (agg.status === 'received' ? 'pending' : agg.status === 'preparing' ? 'cooking' : 'ready');

      if (mappedStatus === 'served' || (filters?.status && filters.status !== mappedStatus)) {
        continue;
      }

      const rawCreatedAt = agg.created_at;
      const createdAtMs = rawCreatedAt instanceof Date ? rawCreatedAt.getTime() : new Date(rawCreatedAt).getTime();
      const elapsedSeconds = Math.max(0, Math.floor((now - createdAtMs) / 1000));
      const elapsedMinutes = Math.floor(elapsedSeconds / 60);

      const payload = (() => {
        try {
          const parsed = typeof agg.order_payload === 'string' ? JSON.parse(agg.order_payload) : (agg.order_payload || {});
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
          return parsed;
        } catch (e: any) {
          // R4-E I55: one corrupt aggregator row used to throw here, after
          // the sales tickets were built, and kill the whole response.
          // Skip the row loudly and keep the rest.
          this.logger.warn(`Skipping corrupt aggregator order payload ${agg.id}: ${e?.message || e}`);
          return null;
        }
      })();
      if (!payload) continue;
      const payloadItems = Array.isArray(payload.items) ? payload.items : [];
      const items: KdsTicketItem[] = payloadItems.map((pi: any, idx: number) => {
        const itemId = 1000 + idx;
        return {
          id: itemId,
          productId: pi.productId ? Number(pi.productId) : undefined,
          name: pi.name || 'صنف توصيل',
          qty: Number(pi.qty) || 1,
          unitName: 'وجبة',
          modifiers: Array.isArray(pi.modifiers) ? pi.modifiers : [],
          notes: pi.notes,
          status: ticketStored?.itemsStatus?.[String(itemId)] || (mappedStatus === 'ready' ? 'ready' : 'pending'),
          // Aggregator items have no category, so keyword inference is the
          // only option here — with word-boundary matching, not substrings.
          station: resolveItemStation({ productName: pi.name || '' }),
        };
      });

      const stationFilter = filters?.station && filters.station !== 'all' && filters.station !== 'expo' ? filters.station : null;
      const filteredItems = stationFilter
        ? items.filter((it) => it.station === stationFilter)
        : items;

      if (stationFilter && !filteredItems.length) {
        continue;
      }

      tickets.push({
        id: aggTicketId,
        docNo: agg.display_number || agg.external_order_id,
        orderNumber: agg.display_number || agg.external_order_id,
        orderType: 'delivery',
        customerName: `${agg.aggregator_name} - ${agg.customer_name || 'عميل'} (سائق: ${agg.rider_name || 'بانتظار'})`,
        cashierName: agg.aggregator_code,
        status: mappedStatus,
        elapsedMinutes,
        elapsedSeconds,
        createdAt: new Date(createdAtMs).toISOString(),
        updatedAt: ticketStored?.updatedAt || new Date(createdAtMs).toISOString(),
        items: filteredItems,
        urgencyLevel: elapsedMinutes >= 15 ? 'critical' : elapsedMinutes >= 8 ? 'warning' : 'normal',
        aggregatorChannel: agg.aggregator_code,
        aggregatorOrderId: agg.external_order_id,
      });

      totalMinutes += elapsedMinutes;
      countedForAvg++;
    }

    // Sort tickets: Critical / Warning first, then oldest elapsed time
    tickets.sort((a, b) => b.elapsedSeconds - a.elapsedSeconds);

    const stats: KdsSummaryStats = {
      pendingCount: tickets.filter((t) => t.status === 'pending').length,
      cookingCount: tickets.filter((t) => t.status === 'cooking').length,
      readyCount: tickets.filter((t) => t.status === 'ready').length,
      criticalCount: tickets.filter((t) => t.urgencyLevel === 'critical').length,
      avgPrepMinutes: countedForAvg > 0 ? Math.round(totalMinutes / countedForAvg) : 0,
    };

    return {
      tickets,
      stats,
      lastServedId: runtimeState.lastServedId,
      truncated,
      totalActive,
      kdsStateCorrupt: runtimeState.corrupt === true,
    };
  }

  /**
   * Advance ticket status to the next logical phase:
   * pending -> cooking -> ready -> served
   */
  async advanceTicketStatus(
    auth: AuthContext,
    ticketId: number
  ): Promise<{ ticketId: number; newStatus: KdsTicketStatus }> {
    const { tenantId } = requireTenantScope(auth);
    return this.withKdsWrite(tenantId, async (trx) => {
    await this.assertTicketOwned(trx, tenantId, ticketId);
    const runtimeState = await this.getKdsStoreState(tenantId, trx);
    const existing = runtimeState.tickets[String(ticketId)];
    let currentStatus: KdsTicketStatus = existing?.status || 'pending';
    // Provider orders may already have been auto-accepted before any manual KDS
    // state is saved. Advance from the visible database status, not a ghost pending.
    if (!existing && ticketId >= 10_000_000) {
      const aggregator = await trx.selectFrom('pos_aggregator_orders')
        .select('status').where('id', '=', ticketId - 10_000_000)
        .where('tenant_id', '=', tenantId).executeTakeFirstOrThrow();
      currentStatus = aggregator.status === 'preparing' ? 'cooking'
        : aggregator.status === 'ready' ? 'ready' : 'pending';
    }

    let nextStatus: KdsTicketStatus = 'cooking';
    if (currentStatus === 'pending') nextStatus = 'cooking';
    else if (currentStatus === 'cooking') nextStatus = 'ready';
    else if (currentStatus === 'ready') nextStatus = 'served';
    else nextStatus = 'served';

    const nowIso = new Date().toISOString();
    const updatedItemsStatus = { ...(existing?.itemsStatus || {}) };

    if (nextStatus === 'ready' || nextStatus === 'served') {
      Object.keys(updatedItemsStatus).forEach((k) => {
        updatedItemsStatus[k] = 'ready';
      });
    }

    runtimeState.tickets[String(ticketId)] = {
      status: nextStatus,
      itemsStatus: updatedItemsStatus,
      updatedAt: nowIso,
    };

    if (nextStatus === 'served') {
      runtimeState.lastServedId = ticketId;
    }

    if (ticketId >= 10_000_000) {
      const realAggId = ticketId - 10_000_000;
      const dbAggStatus = nextStatus === 'cooking' ? 'preparing' : nextStatus === 'ready' ? 'ready' : 'picked_up';
      await trx
        .updateTable('pos_aggregator_orders')
        .set({ status: dbAggStatus, updated_at: new Date() })
        .where('id', '=', realAggId)
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    await this.saveKdsStoreState(tenantId, runtimeState, trx);
    return { ticketId, newStatus: nextStatus };

    });
  }
  /**
   * Set ticket status explicitly
   */
  async setTicketStatus(
    auth: AuthContext,
    ticketId: number,
    status: KdsTicketStatus
  ): Promise<{ ticketId: number; status: KdsTicketStatus }> {
    const { tenantId } = requireTenantScope(auth);
    return this.withKdsWrite(tenantId, async (trx) => {
    await this.assertTicketOwned(trx, tenantId, ticketId);
    if (!['pending', 'cooking', 'ready', 'served'].includes(status)) {
      throw new BadRequestException('حالة تذكرة المطبخ غير صالحة');
    }
    const runtimeState = await this.getKdsStoreState(tenantId, trx);
    const existing = runtimeState.tickets[String(ticketId)];
    // R4-E I18: single-step forward only. Re-setting the current status is
    // an idempotent no-op, not a move. Aggregator tickets without stored
    // state advance from their visible database status, as in advanceTicketStatus.
    let current: KdsTicketStatus = existing?.status || 'pending';
    if (!existing && ticketId >= 10_000_000) {
      const aggregator = await trx.selectFrom('pos_aggregator_orders')
        .select('status').where('id', '=', ticketId - 10_000_000)
        .where('tenant_id', '=', tenantId).executeTakeFirst();
      if (aggregator) {
        current = aggregator.status === 'preparing' ? 'cooking'
          : aggregator.status === 'ready' ? 'ready'
          : aggregator.status === 'picked_up' ? 'served' : 'pending';
      }
    }
    if (status !== current && !isAllowedKdsTransition(current, status)) {
      throw new BadRequestException('لا يمكن نقل تذكرة المطبخ من هذه الحالة إلى تلك — التقدم خطوة واحدة للأمام فقط');
    }
    const nowIso = new Date().toISOString();

    runtimeState.tickets[String(ticketId)] = {
      status,
      itemsStatus: existing?.itemsStatus || {},
      updatedAt: nowIso,
    };

    if (status === 'served') {
      runtimeState.lastServedId = ticketId;
    }

    if (ticketId >= 10_000_000) {
      const realAggId = ticketId - 10_000_000;
      const dbAggStatus = status === 'cooking' ? 'preparing' : status === 'ready' ? 'ready' : status === 'served' ? 'picked_up' : 'received';
      await trx
        .updateTable('pos_aggregator_orders')
        .set({ status: dbAggStatus, updated_at: new Date() })
        .where('id', '=', realAggId)
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    await this.saveKdsStoreState(tenantId, runtimeState, trx);
    return { ticketId, status };

    });
  }
  /**
   * Toggle or set status of an individual item within a ticket
   */
  async setItemStatus(
    auth: AuthContext,
    ticketId: number,
    itemId: number,
    status: KdsItemStatus
  ): Promise<{ ticketId: number; itemId: number; itemStatus: KdsItemStatus }> {
    const { tenantId } = requireTenantScope(auth);
    return this.withKdsWrite(tenantId, async (trx) => {
    await this.assertTicketOwned(trx, tenantId, ticketId, itemId);
    if (!['pending', 'cooking', 'ready'].includes(status)) {
      throw new BadRequestException('حالة صنف المطبخ غير صالحة');
    }
    const runtimeState = await this.getKdsStoreState(tenantId, trx);
    const existing = runtimeState.tickets[String(ticketId)] || {
      status: 'pending',
      itemsStatus: {},
      updatedAt: new Date().toISOString(),
    };
    // R4-E I18: items move forward only. pending -> ready is the
    // tap-to-complete carve-out (KdsTicketCard marks an item done with one
    // tap and has no "start cooking" step); un-marking a ready item is
    // refused. Re-setting the current status is an idempotent no-op.
    const currentItem: KdsItemStatus = existing.itemsStatus[String(itemId)]
      || (existing.status === 'ready' ? 'ready' : 'pending');
    if (status !== currentItem && !isAllowedKdsItemTransition(currentItem, status)) {
      throw new BadRequestException('لا يمكن إعادة صنف المطبخ إلى حالة سابقة — التقدم للأمام فقط');
    }

    existing.itemsStatus[String(itemId)] = status;
    existing.updatedAt = new Date().toISOString();
    runtimeState.tickets[String(ticketId)] = existing;

    await this.saveKdsStoreState(tenantId, runtimeState, trx);
    return { ticketId, itemId, itemStatus: status };

    });
  }
  /**
   * Recall the last served ticket back to "ready"
   */
  async recallLastServedTicket(
    auth: AuthContext
  ): Promise<{ recalled: boolean; ticketId?: number; status?: KdsTicketStatus }> {
    const { tenantId } = requireTenantScope(auth);
    return this.withKdsWrite(tenantId, async (trx) => {
    const runtimeState = await this.getKdsStoreState(tenantId, trx);

    const lastId = runtimeState.lastServedId;
    if (!lastId || !runtimeState.tickets[String(lastId)]) {
      return { recalled: false };
    }

    runtimeState.tickets[String(lastId)].status = 'ready';
    runtimeState.tickets[String(lastId)].updatedAt = new Date().toISOString();
    runtimeState.lastServedId = undefined;

    await this.saveKdsStoreState(tenantId, runtimeState, trx);
    return { recalled: true, ticketId: lastId, status: 'ready' };

    });
  }
  /**
   * Fire or advance the dining course for a ticket (Course Firing)
   * e.g. 'appetizer' -> 'main' -> 'dessert'
   */
  async fireTicketCourse(
    auth: AuthContext,
    ticketId: number,
    course?: 'appetizer' | 'main' | 'dessert' | 'beverage'
  ): Promise<{ ticketId: number; course: string }> {
    const { tenantId } = requireTenantScope(auth);
    return this.withKdsWrite(tenantId, async (trx) => {
    if (ticketId >= 10_000_000) throw new BadRequestException('إطلاق دورة التحضير يخص فواتير المطعم فقط');
    await this.assertTicketOwned(trx, tenantId, ticketId);
    if (course && !['appetizer', 'main', 'dessert', 'beverage'].includes(course)) {
      throw new BadRequestException('مرحلة التحضير غير صالحة');
    }
    // R4-E I18: firing a course on a ready/served ticket used to force it
    // back to cooking. Refuse instead; lastServedId is never touched here.
    // The throw rolls back this transaction, so the dining_course update
    // below never lands for a refused fire either.
    {
      const fireState = await this.getKdsStoreState(tenantId, trx);
      const fireCurrent: KdsTicketStatus = fireState.tickets[String(ticketId)]?.status || 'pending';
      if (fireCurrent === 'ready' || fireCurrent === 'served') {
        throw new BadRequestException('لا يمكن إطلاق دورة تحضير لتذكرة جاهزة أو مُسلَّمة');
      }
    }
    let targetCourse = course;
    if (!targetCourse) {
      const sale = await trx
        .selectFrom('sales')
        .select(['dining_course'])
        .where('id', '=', ticketId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const current = (sale as any)?.dining_course || 'appetizer';
      if (current === 'appetizer') targetCourse = 'main';
      else if (current === 'main') targetCourse = 'dessert';
      else targetCourse = 'dessert';
    }

    await trx
      .updateTable('sales')
      .set({ dining_course: targetCourse } as any)
      .where('id', '=', ticketId)
      .where('tenant_id', '=', tenantId)
      .execute();

    const runtimeState = await this.getKdsStoreState(tenantId, trx);
    const existing = runtimeState.tickets[String(ticketId)];
    runtimeState.tickets[String(ticketId)] = {
      status: 'cooking',
      itemsStatus: existing?.itemsStatus || {},
      updatedAt: new Date().toISOString(),
    };
    await this.saveKdsStoreState(tenantId, runtimeState, trx);

    return { ticketId, course: targetCourse };

    });
  }}
