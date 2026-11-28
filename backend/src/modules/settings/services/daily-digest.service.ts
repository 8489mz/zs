import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../database/database.constants';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { addDaysToDayKey } from '../../../common/utils/client-date-bounds.util';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { WhatsAppGatewayService } from './whatsapp-gateway.service';

export interface DailyDigestConfig {
  enabled: boolean;
  phone: string;
  timeOfDay: string; // e.g. "23:30"
  includeSales: boolean;
  includeTransfers: boolean;
  includeShortages: boolean;
  mainWarehouseId?: number;
  shopLocationId?: number;
}

@Injectable()
export class DailyDigestService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly whatsappGateway: WhatsAppGatewayService,
  ) {}

  async getConfig(actor: AuthContext): Promise<DailyDigestConfig> {
    const { tenantId } = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'like', 'daily_digest_%')
      .execute();

    const map = new Map<string, any>();
    for (const r of rows) {
      try {
        map.set(r.key, JSON.parse(r.value));
      } catch {
        map.set(r.key, r.value);
      }
    }

    const tenant = await this.db
      .selectFrom('tenants')
      .select('owner_phone')
      .where('id', '=', tenantId)
      .executeTakeFirst();

    return {
      enabled: map.get('daily_digest_enabled') === true,
      phone: map.get('daily_digest_phone') || tenant?.owner_phone || '',
      timeOfDay: map.get('daily_digest_time') || '23:30',
      includeSales: map.get('daily_digest_include_sales') !== false,
      includeTransfers: map.get('daily_digest_include_transfers') !== false,
      includeShortages: map.get('daily_digest_include_shortages') !== false,
      mainWarehouseId: map.get('daily_digest_main_warehouse_id')
        ? Number(map.get('daily_digest_main_warehouse_id'))
        : undefined,
      shopLocationId: map.get('daily_digest_shop_location_id')
        ? Number(map.get('daily_digest_shop_location_id'))
        : undefined,
    };
  }

  async saveConfig(payload: Partial<DailyDigestConfig>, actor: AuthContext): Promise<{ ok: boolean }> {
    const { tenantId, accountId } = requireTenantScope(actor);

    const updates: Array<{ key: string; val: any }> = [];
    if (payload.enabled !== undefined) updates.push({ key: 'daily_digest_enabled', val: payload.enabled });
    if (payload.phone !== undefined) updates.push({ key: 'daily_digest_phone', val: payload.phone });
    if (payload.timeOfDay !== undefined) updates.push({ key: 'daily_digest_time', val: payload.timeOfDay });
    if (payload.includeSales !== undefined)
      updates.push({ key: 'daily_digest_include_sales', val: payload.includeSales });
    if (payload.includeTransfers !== undefined)
      updates.push({ key: 'daily_digest_include_transfers', val: payload.includeTransfers });
    if (payload.includeShortages !== undefined)
      updates.push({ key: 'daily_digest_include_shortages', val: payload.includeShortages });
    if (payload.mainWarehouseId !== undefined)
      updates.push({ key: 'daily_digest_main_warehouse_id', val: payload.mainWarehouseId });
    if (payload.shopLocationId !== undefined)
      updates.push({ key: 'daily_digest_shop_location_id', val: payload.shopLocationId });

    for (const item of updates) {
      await sql`
        INSERT INTO settings (key, value, tenant_id, account_id)
        VALUES (${item.key}, ${JSON.stringify(item.val)}, ${tenantId}, ${accountId})
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
      `.execute(this.db);
    }

    return { ok: true };
  }

  async generateAndSendDigest(
    tenantId: string,
    overridePhone?: string,
  ): Promise<{ success: boolean; message?: string; text?: string }> {
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const businessName = tenant?.business_name || 'منظومة Z-Systems';

    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'like', 'daily_digest_%')
      .execute();

    const map = new Map<string, any>();
    for (const r of rows) {
      try {
        map.set(r.key, JSON.parse(r.value));
      } catch {
        map.set(r.key, r.value);
      }
    }

    const recipientPhone = overridePhone || map.get('daily_digest_phone') || tenant?.owner_phone;
    if (!recipientPhone) {
      return { success: false, message: 'لم يتم تحديد رقم هاتف لاستلام الملخص اليومي' };
    }

    const includeSales = map.get('daily_digest_include_sales') !== false;
    const includeTransfers = map.get('daily_digest_include_transfers') !== false;
    const includeShortages = map.get('daily_digest_include_shortages') !== false;

    // NEW-G (clock B6-P2): the digest's "today" is the tenant day, not
    // the DB host's UTC day and not the host's local date — CURRENT_DATE
    // starts every bucket at 02:00 Cairo, and the header rendered the
    // host-local date with no timeZone. Resolved once per digest.
    const tenantTz = await getTenantTimezone(this.db, tenantId);
    const todayKey = todayTenantDate(tenantTz);

    const todayDateStr = new Date().toLocaleDateString('ar-EG', {
      timeZone: tenantTz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const nowTimeStr = new Date().toLocaleTimeString('ar-EG', {
      timeZone: tenantTz,
      hour: '2-digit',
      minute: '2-digit',
    });

    let digestText =
      `🌙 *الملخص التنفيذي واللوجستي اليومي*\n` +
      `🏢 *${businessName}*\n` +
      `📅 ${todayDateStr} | ⏰ ${nowTimeStr}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n`;

    // 1. Sales Section
    if (includeSales) {
      const salesAgg = await this.db
        .selectFrom('sales')
        .select([
          sql<number>`COUNT(id)`.as('invoices_count'),
          sql<number>`COALESCE(SUM(total), 0)`.as('total_sales'),
          sql<number>`COALESCE(SUM(CASE WHEN payment_channel = 'cash' THEN paid_amount ELSE 0 END), 0)`.as(
            'cash_total',
          ),
          sql<number>`COALESCE(SUM(CASE WHEN payment_channel = 'card' THEN paid_amount ELSE 0 END), 0)`.as(
            'card_total',
          ),
          sql<number>`COALESCE(SUM(CASE WHEN payment_channel IN ('wallet', 'instapay') THEN paid_amount ELSE 0 END), 0)`.as(
            'instapay_total',
          ),
        ])
        .where('tenant_id', '=', tenantId)
        .where('status', '!=', 'cancelled')
        .where(sql<boolean>`DATE(created_at AT TIME ZONE ${tenantTz}) = ${todayKey}`)
        .executeTakeFirst();

      const totalSales = Number(salesAgg?.total_sales || 0).toLocaleString('ar-EG');
      const invoicesCount = Number(salesAgg?.invoices_count || 0).toLocaleString('ar-EG');
      const cashTotal = Number(salesAgg?.cash_total || 0).toLocaleString('ar-EG');
      const cardTotal = Number(salesAgg?.card_total || 0).toLocaleString('ar-EG');
      const instapayTotal = Number(salesAgg?.instapay_total || 0).toLocaleString('ar-EG');

      // Top 3 sold items
      const topItems = await this.db
        .selectFrom('sale_items as si')
        .innerJoin('sales as s', 's.id', 'si.sale_id')
        .select(['si.product_name', sql<number>`SUM(si.qty)`.as('qty_sold')])
        .where('s.tenant_id', '=', tenantId)
        .where('s.status', '!=', 'cancelled')
        .where(sql<boolean>`DATE(s.created_at AT TIME ZONE ${tenantTz}) = ${todayKey}`)
        .groupBy('si.product_name')
        .orderBy(sql`SUM(si.qty)`, 'desc')
        .limit(3)
        .execute();

      digestText +=
        `📊 *المبيعات والإيرادات اليومية:*\n` +
        `• إجمالي المبيعات: *${totalSales} ج.م* (${invoicesCount} فاتورة)\n` +
        `• نقدية بالصندوق (كاش): ${cashTotal} ج.م\n` +
        `• شبكة وماكينات دفع: ${cardTotal} ج.م\n` +
        `• إنستاباي ومحافظ: ${instapayTotal} ج.م\n`;

      if (topItems.length > 0) {
        digestText +=
          `🔥 الأكثر مبيعاً: ` + topItems.map((it) => `${it.product_name} (${it.qty_sold} ق)`).join('، ') + `\n`;
      }

      digestText += `\n`;
    }

    // 2. Detailed Warehouse Stock Transfers Issued Today
    if (includeTransfers) {
      const transfers = await this.db
        .selectFrom('stock_transfers as t')
        .leftJoin('stock_locations as fl', 'fl.id', 't.from_location_id')
        .leftJoin('stock_locations as tl', 'tl.id', 't.to_location_id')
        .leftJoin('users as u', 'u.id', 't.created_by')
        .select([
          't.id',
          't.doc_no',
          't.note',
          't.created_at',
          'fl.name as from_location_name',
          'tl.name as to_location_name',
          'u.username as created_by_name',
        ])
        .where('t.tenant_id', '=', tenantId)
        .where('t.status', '!=', 'cancelled')
        .where(sql<boolean>`DATE(t.created_at AT TIME ZONE ${tenantTz}) = ${todayKey}`)
        .orderBy('t.id', 'desc')
        .execute();

      digestText += `📦 *أذون الصرف والإمداد المنقولة للمحل اليوم:*\n`;

      if (transfers.length === 0) {
        digestText += `_لم يتم تسجيل أذون صرف للمحل اليوم_\n\n`;
      } else {
        for (const tr of transfers) {
          const items = await this.db
            .selectFrom('stock_transfer_items')
            .select(['product_name', 'qty'])
            .where('transfer_id', '=', tr.id)
            .where('tenant_id', '=', tenantId)
            .execute();

          const toLocName = tr.to_location_name || 'صالة المحل';
          const author = tr.created_by_name ? ` (بواسطة: ${tr.created_by_name})` : '';
          const totalPieces = items.reduce((sum, it) => sum + Number(it.qty || 0), 0);

          digestText += `📋 *إذن رقم #${tr.doc_no || tr.id}* ➔ ${toLocName}${author}:\n`;
          for (const item of items) {
            digestText += `  • ${item.product_name}: *${Number(item.qty || 0).toLocaleString('ar-EG')} قطعة*\n`;
          }
          digestText += `  _إجمالي إذن الصرف: ${totalPieces} قطعة_\n`;
        }
        digestText += `\n`;
      }
    }

    // 3. Main Warehouse Shortages & Predictive Purchase Deadlines
    if (includeShortages) {
      const shortages = await this.db
        .selectFrom('products as p')
        .select(['p.id', 'p.name', 'p.barcode', 'p.stock_qty', 'p.min_stock_qty'])
        .where('p.tenant_id', '=', tenantId)
        .where('p.is_active', '=', true)
        .where(sql<boolean>`p.stock_qty <= COALESCE(p.min_stock_qty, 0)`)
        .orderBy('p.stock_qty', 'asc')
        .limit(6)
        .execute();

      if (shortages.length > 0) {
        digestText += `⚠️ *نواقص المخازن وتنبيهات الشراء الاستباقية:*\n`;

        for (const sh of shortages) {
          const currentStock = Number(sh.stock_qty || 0);

          // Calculate past 7 days velocity
          const pastWeekSales = await this.db
            .selectFrom('sale_items as si')
            .innerJoin('sales as s', 's.id', 'si.sale_id')
            .select(sql<number>`COALESCE(SUM(si.qty), 0)`.as('sold_qty'))
            .where('s.tenant_id', '=', tenantId)
            .where('s.status', '!=', 'cancelled')
            .where('si.product_id', '=', sh.id)
            .where(sql<boolean>`s.created_at >= NOW() - INTERVAL '7 DAYS'`)
            .executeTakeFirst();

          const totalSoldWeek = Number(pastWeekSales?.sold_qty || 0);
          const dailyRate = Number((totalSoldWeek / 7).toFixed(1));

          if (currentStock <= 0) {
            digestText += `  • *${sh.name}*: 🔴 نفد تماماً (0) ➔ 🚨 *شراء فوري عاجل*\n`;
          } else if (dailyRate > 0) {
            const daysRemaining = Math.max(1, Math.floor(currentStock / dailyRate));
            // Same root cause as the header: the deadline label derives
            // from the tenant day, not the host clock. A calendar-date
            // label is formatted in UTC so the parts are the key's parts
            // in every zone (a noon-UTC instant would flip the day in
            // far-east zones; a midnight-UTC instant in far-west ones).
            const deadlineKey = addDaysToDayKey(todayKey, Math.max(1, daysRemaining - 1)) ?? todayKey;
            const deadlineStr = new Intl.DateTimeFormat('ar-EG', {
              timeZone: 'UTC',
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }).format(new Date(`${deadlineKey}T00:00:00.000Z`));

            digestText += `  • *${sh.name}*: 🟡 متبقي ${currentStock} (يكفي ${daysRemaining} أيام) ➔ *يجب الشراء قبل ${deadlineStr}*\n`;
          } else {
            digestText += `  • *${sh.name}*: 🟡 متبقي ${currentStock} قطعة (دون حد الأمان)\n`;
          }
        }
        digestText += `\n`;
      }
    }

    // 4. Loss Prevention & Anti-Theft Digest (Overdue In-Transit, Overdue Delivery Custody, POS Suspicious Events)
    try {
      const antiTheft = await loadAntiTheftSettings(this.db, tenantId);
      const inTransitThresholdMs = Math.max(1, antiTheft.inTransitAlertHours) * 3_600_000;
      const deliveryThresholdMs = Math.max(1, antiTheft.deliveryOverdueHours) * 3_600_000;
      const inTransitCutoff = new Date(Date.now() - inTransitThresholdMs);
      const deliveryCutoff = new Date(Date.now() - deliveryThresholdMs);

      const [overdueTransfers, overdueDeliveries, posSuspicionAgg] = await Promise.all([
        this.db
          .selectFrom('stock_transfers as t')
          .select(['t.doc_no', 't.carrier_name', 't.created_at'])
          .where('t.tenant_id', '=', tenantId)
          .where('t.status', '=', 'sent')
          .where('t.created_at', '<=', inTransitCutoff)
          .limit(5)
          .execute(),
        this.db
          .selectFrom('sales as s')
          .leftJoin('delivery_representatives as dr', (j) =>
            j.onRef('dr.id', '=', 's.delivery_rep_id').onRef('dr.tenant_id', '=', 's.tenant_id'),
          )
          .select([
            'dr.name as rep_name',
            sql<number>`COUNT(s.id)`.as('orders_count'),
            sql<number>`COALESCE(SUM(GREATEST(0, COALESCE(s.total, 0) - COALESCE(s.paid_amount, 0))), 0)`.as(
              'unsettled_cash',
            ),
          ])
          .where('s.tenant_id', '=', tenantId)
          .where('s.delivery_rep_id', 'is not', null)
          .where('s.status', '!=', 'cancelled')
          .where((eb) =>
            eb.and([
              eb.or([eb('s.driver_cash_settled', 'is', null), eb('s.driver_cash_settled', '=', false)]),
              eb.or([eb('s.delivery_status', 'is', null), eb('s.delivery_status', '!=', 'settled')]),
              eb.or([eb('s.collection_status', 'is', null), eb('s.collection_status', '!=', 'prepaid_online')]),
            ]),
          )
          .where('s.created_at', '<=', deliveryCutoff)
          .groupBy('dr.name')
          .execute(),
        this.db
          .selectFrom('pos_audit_events')
          .select([
            sql<number>`COUNT(*) FILTER (WHERE event_type = 'draft_cancel')`.as('cart_clears'),
            sql<number>`COUNT(*) FILTER (WHERE event_type = 'no_sale')`.as('no_sales'),
            sql<number>`COUNT(*) FILTER (WHERE event_type = 'receipt_reprint')`.as('reprints'),
          ])
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`DATE(created_at AT TIME ZONE ${tenantTz}) = ${todayKey}`)
          .executeTakeFirst(),
      ]);

      const cartClears = Number(posSuspicionAgg?.cart_clears || 0);
      const noSales = Number(posSuspicionAgg?.no_sales || 0);
      const reprints = Number(posSuspicionAgg?.reprints || 0);

      if (
        overdueTransfers.length > 0 ||
        overdueDeliveries.length > 0 ||
        cartClears > 0 ||
        noSales > 0 ||
        reprints > 0
      ) {
        digestText += `*تقرير درع منع الخسائر والرقابة اليومي:*\n`;
        if (cartClears > 0 || noSales > 0 || reprints > 0) {
          digestText += `• نقطة البيع: مسح سلة (${cartClears}) | فتح درج بلا بيع (${noSales}) | إعادة طباعة (${reprints})\n`;
        }
        if (overdueTransfers.length > 0) {
          digestText += `• تحويلات متأخرة بالطريق (+${antiTheft.inTransitAlertHours} ساعة): *${overdueTransfers.length} إذن*\n`;
          for (const tr of overdueTransfers) {
            digestText += `  - ${tr.doc_no || 'تحويل'}${tr.carrier_name ? ` (الناقل: ${tr.carrier_name})` : ''}\n`;
          }
        }
        if (overdueDeliveries.length > 0) {
          digestText += `• عهد مناديب متأخرة التسوية (+${antiTheft.deliveryOverdueHours} ساعة):\n`;
          for (const d of overdueDeliveries) {
            digestText += `  - ${d.rep_name || 'مندوب'}: ${Number(d.orders_count || 0)} طلب | متبقي *${Number(d.unsettled_cash || 0).toLocaleString('ar-EG')} ج.م*\n`;
          }
        }
        digestText += `\n`;
      }
    } catch {
      // Never block daily digest delivery if optional anti-theft metrics fail
    }

    digestText += `━━━━━━━━━━━━━━━━━━━━\n` + `_تم الإنشاء والإرسال آلياً عبر منظومة Z-Systems المؤسسية_`;

    const sendRes = await this.whatsappGateway.sendRawMessage(tenantId, recipientPhone, digestText);
    return {
      success: sendRes.success,
      message: sendRes.message,
      text: digestText,
    };
  }
}
