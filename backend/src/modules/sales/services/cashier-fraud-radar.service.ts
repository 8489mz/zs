import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Detection keys off `audit_logs.event_code`, never off the human-facing Arabic `action` text —
 * rewording a log message must not silently blind the radar.
 * The legacy text predicates below are kept ONLY to classify rows written before event_code existed
 * and that the backfill could not reach; new detections must extend the code list, not the text list.
 */
const RADAR_EVENT_CODES = [
  AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED,
  AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED,
  AUDIT_EVENT_CODES.POS_DISCOUNT_OVERRIDE,
  AUDIT_EVENT_CODES.POS_SALE_RETURN,
] as const;

type RadarLogRow = { event_code?: string | null; action?: string | null };

function classifyRadarEvent(row: RadarLogRow): 'cart_remove' | 'draft_cancel' | 'discount_override' | 'sale_return' | null {
  const code = String(row.event_code || '');
  if (code === AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED) return 'cart_remove';
  if (code === AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED) return 'draft_cancel';
  if (code === AUDIT_EVENT_CODES.POS_DISCOUNT_OVERRIDE) return 'discount_override';
  if (code === AUDIT_EVENT_CODES.POS_SALE_RETURN) return 'sale_return';

  // Legacy rows only (no event_code).
  const action = String(row.action || '');
  if (action.includes('حذف عنصر من السلة')) return 'cart_remove';
  if (action.includes('إلغاء/حذف فاتورة')) return 'draft_cancel';
  if (action.includes('خصم')) return 'discount_override';
  if (action.includes('مرتجع')) return 'sale_return';
  return null;
}

export interface CashierRiskProfile {
  cashierId: number;
  cashierName: string;
  cartVoidsCount: number;
  draftCancelsCount: number;
  cancelledSalesCount: number;
  discountOverridesCount: number;
  saleReturnsCount: number;
  totalSuspiciousEvents: number;
  totalSalesCount: number;
  riskScore: number; // 0 to 100
  riskLevel: RiskLevel;
  lastSuspiciousAt?: string;
}

export interface FraudRadarSummaryResponse {
  timeframe: 'today' | '7days' | '30days';
  sampled: boolean;
  totalSuspiciousEvents: number;
  highRiskCashiersCount: number;
  mediumRiskCashiersCount: number;
  estimatedProtectedLoss: number;
  cashiers: CashierRiskProfile[];
  thresholds: {
    maxHourlyVoidsAlert: number;
    whatsappAlertsEnabled: boolean;
  };
}

export interface FraudRadarEventItem {
  id: number;
  cashierId: number;
  cashierName: string;
  eventType: 'cart_remove' | 'draft_cancel' | 'sale_cancelled' | 'discount_override' | 'sale_return';
  eventTitle: string;
  details: string;
  amount?: number;
  createdAt: string;
}

// In-memory debounce tracker for WhatsApp alerts: tenantId:cashierId -> lastAlertTimestamp
const recentAlertTimestamps = new Map<string, number>();

@Injectable()
export class CashierFraudRadarService {
  private readonly logger = new Logger(CashierFraudRadarService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  private getTimeFilter(timeframe: 'today' | '7days' | '30days'): string {
    if (timeframe === '7days') return "NOW() - INTERVAL '7 DAYS'";
    if (timeframe === '30days') return "NOW() - INTERVAL '30 DAYS'";
    return 'CURRENT_DATE';
  }

  async getSummary(timeframe: 'today' | '7days' | '30days' = 'today', auth: AuthContext): Promise<FraudRadarSummaryResponse> {
    const scope = requireTenantScope(auth);
    const timeSql = this.getTimeFilter(timeframe);
    const maxDetailedEvents = 2_000;
    // estimatedProtectedLoss is money: round at the tenant's book digits
    // (the old 2-decimal cut dropped a 3-decimal tenant's fils).
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));

    // 1. Fetch active users / cashiers for this tenant
    const cashiers = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'role'])
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true)
      .execute();

    // Keep exact per-cashier counts in PostgreSQL; only detailed monetary parsing is sampled.
    const auditBase = this.db
      .selectFrom('audit_logs')
      .where('tenant_id', '=', scope.tenantId)
      .where(sql<boolean>`created_at >= ${sql.raw(timeSql)}`)
      .where((eb) =>
        eb.or([
          eb('event_code', 'in', [...RADAR_EVENT_CODES]),
          // Legacy rows without event_code (see note above).
          eb.and([
            eb('event_code', 'is', null),
            eb.or([
              eb('action', 'like', '%حذف عنصر من السلة%'),
              eb('action', 'like', '%إلغاء/حذف فاتورة%'),
              eb('action', 'like', '%خصم%'),
              eb('action', 'like', '%مرتجع%'),
            ]),
          ]),
        ]),
      );
    const eventKind = sql<string>`case
      when event_code = ${AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED} then 'cart_remove'
      when event_code = ${AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED} then 'draft_cancel'
      when event_code = ${AUDIT_EVENT_CODES.POS_DISCOUNT_OVERRIDE} then 'discount_override'
      when event_code is null and action like '%حذف عنصر من السلة%' then 'cart_remove'
      when event_code is null and action like '%إلغاء/حذف فاتورة%' then 'draft_cancel'
      when event_code is null and action like '%خصم%' then 'discount_override'
      else 'sale_return' end`;
    const [auditRows, auditStats] = await Promise.all([
      auditBase.select(['id', 'action', 'event_code', 'details', 'created_by', 'created_at'])
      .orderBy('id', 'desc')
      .limit(maxDetailedEvents + 1)
      .execute(),
      auditBase.select([
        'created_by',
        sql<number>`count(*)::int`.as('event_count'),
        sql<number>`count(*) filter (where ${eventKind} = 'cart_remove')::int`.as('cart_voids'),
        sql<number>`count(*) filter (where ${eventKind} = 'draft_cancel')::int`.as('draft_cancels'),
        sql<number>`count(*) filter (where ${eventKind} = 'discount_override')::int`.as('discount_overrides'),
        sql<number>`count(*) filter (where ${eventKind} = 'sale_return')::int`.as('sale_returns'),
        sql<Date | null>`max(created_at) filter (where ${eventKind} in ('cart_remove', 'draft_cancel', 'discount_override', 'sale_return'))`.as('last_suspicious_at'),
      ]).groupBy('created_by').execute(),
    ]);

    const cancelledSales = await this.db
      .selectFrom('sales')
      .select([
        'created_by',
        sql<number>`count(*)::int`.as('cancelled_count'),
        sql<number>`coalesce(sum(total), 0)`.as('cancelled_total'),
        sql<Date | null>`max(created_at)`.as('latest_cancelled_at'),
      ])
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'cancelled')
      .where(sql<boolean>`created_at >= ${sql.raw(timeSql)}`)
      .groupBy('created_by')
      .execute();
    const sampled = auditRows.length > maxDetailedEvents;

    // 4. Fetch total completed sales by cashier to calculate normal baseline
    const completedSales = await this.db
      .selectFrom('sales')
      .select([
        'created_by',
        sql<number>`COUNT(id)`.as('sales_count'),
      ])
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '!=', 'cancelled')
      .where(sql<boolean>`created_at >= ${sql.raw(timeSql)}`)
      .groupBy('created_by')
      .execute();

    const salesCountMap = new Map<number, number>();
    for (const s of completedSales) {
      if (s.created_by) salesCountMap.set(Number(s.created_by), Number(s.sales_count || 0));
    }

    // Process statistics per cashier
    const cashierStatsMap = new Map<number, {
      cartVoids: number;
      draftCancels: number;
      discountOverrides: number;
      saleReturns: number;
      cancelledSales: number;
      lastSuspiciousAt?: string;
    }>();

    for (const c of cashiers) {
      cashierStatsMap.set(Number(c.id), {
        cartVoids: 0,
        draftCancels: 0,
        discountOverrides: 0,
        saleReturns: 0,
        cancelledSales: 0,
      });
    }

    let totalSuspiciousEvents = 0;
    let estimatedProtectedLoss = 0;

    for (const row of auditStats) {
      const uid = Number(row.created_by || 0);
      let stats = cashierStatsMap.get(uid);
      if (!stats) {
        stats = { cartVoids: 0, draftCancels: 0, discountOverrides: 0, saleReturns: 0, cancelledSales: 0 };
        cashierStatsMap.set(uid, stats);
      }
      stats.cartVoids = Number(row.cart_voids);
      stats.draftCancels = Number(row.draft_cancels);
      stats.discountOverrides = Number(row.discount_overrides);
      stats.saleReturns = Number(row.sale_returns);
      stats.lastSuspiciousAt = row.last_suspicious_at ? new Date(row.last_suspicious_at).toISOString() : undefined;
    }
    for (const log of auditRows.slice(0, maxDetailedEvents)) {
      // Extract amount if present in details
      const match = String(log.details || '').match(/(?:الإجمالي|المبلغ|القيمة):\s*([\d.]+)/);
      if (match && match[1]) {
        estimatedProtectedLoss += Number(match[1]) || 0;
      }
    }

    for (const cs of cancelledSales) {
      const uid = Number(cs.created_by || 0);
      let stats = cashierStatsMap.get(uid);
      if (!stats) {
        stats = { cartVoids: 0, draftCancels: 0, discountOverrides: 0, saleReturns: 0, cancelledSales: 0 };
        cashierStatsMap.set(uid, stats);
      }
      stats.cancelledSales = Number(cs.cancelled_count);
      estimatedProtectedLoss += Number(cs.cancelled_total || 0);
      const cancelledAt = cs.latest_cancelled_at ? new Date(cs.latest_cancelled_at).toISOString() : undefined;
      if (cancelledAt && (!stats.lastSuspiciousAt || cancelledAt > stats.lastSuspiciousAt)) stats.lastSuspiciousAt = cancelledAt;
    }

    const profiles: CashierRiskProfile[] = [];
    let highRiskCount = 0;
    let mediumRiskCount = 0;

    // One shared aggregation: the header below is the sum of the
    // per-cashier detail counts, so it can never drift from the detail
    // again. Profiles cover every user with events in the window, not
    // just active cashiers — an event by an inactive/unknown user used
    // to inflate the header while having no detail row at all.
    const cashierById = new Map<number, { username: string }>();
    for (const c of cashiers) cashierById.set(Number(c.id), { username: c.username });
    const profileUids = new Set<number>([...cashierById.keys(), ...cashierStatsMap.keys()]);

    for (const uid of profileUids) {
      const stats = cashierStatsMap.get(uid) || { cartVoids: 0, draftCancels: 0, discountOverrides: 0, saleReturns: 0, cancelledSales: 0 };
      const salesCount = salesCountMap.get(uid) || 0;
      const totalEvents = stats.cartVoids + stats.draftCancels + stats.cancelledSales + stats.discountOverrides + stats.saleReturns;

      // Risk score algorithm (0 - 100)
      let rawScore = (stats.cartVoids * 12) + (stats.draftCancels * 18) + (stats.cancelledSales * 25) + (stats.discountOverrides * 8) + (stats.saleReturns * 10);
      if (salesCount > 10) {
        rawScore = rawScore / Math.max(1, (salesCount / 20));
      }
      const riskScore = Math.min(100, Math.max(0, Math.round(rawScore)));

      let riskLevel: RiskLevel = 'low';
      if (riskScore >= 60 || stats.cartVoids >= 5 || stats.cancelledSales >= 3) {
        riskLevel = 'high';
        highRiskCount++;
      } else if (riskScore >= 30 || totalEvents >= 3) {
        riskLevel = 'medium';
        mediumRiskCount++;
      }

      profiles.push({
        cashierId: uid,
        cashierName: cashierById.get(uid)?.username || `مستخدم #${uid}`,
        cartVoidsCount: stats.cartVoids,
        draftCancelsCount: stats.draftCancels,
        cancelledSalesCount: stats.cancelledSales,
        discountOverridesCount: stats.discountOverrides,
        saleReturnsCount: stats.saleReturns,
        totalSuspiciousEvents: totalEvents,
        totalSalesCount: salesCount,
        riskScore,
        riskLevel,
        lastSuspiciousAt: stats.lastSuspiciousAt,
      });
    }

    // The header IS the sum of the detail counts — by construction.
    totalSuspiciousEvents = profiles.reduce((sum, p) => sum + p.totalSuspiciousEvents, 0);

    // Sort cashiers by riskScore descending
    profiles.sort((a, b) => b.riskScore - a.riskScore);

    return {
      timeframe,
      sampled,
      totalSuspiciousEvents,
      highRiskCashiersCount: highRiskCount,
      mediumRiskCashiersCount: mediumRiskCount,
      estimatedProtectedLoss: roundMoney(estimatedProtectedLoss, moneyDigits),
      cashiers: profiles,
      thresholds: {
        maxHourlyVoidsAlert: 5,
        whatsappAlertsEnabled: true,
      },
    };
  }

  async getEvents(limit = 40, auth: AuthContext, timeframe: 'today' | '7days' | '30days' = 'today'): Promise<FraudRadarEventItem[]> {
    const scope = requireTenantScope(auth);
    const safeLimit = Math.min(100, Math.max(5, limit));
    const timeSql = this.getTimeFilter(timeframe);

    const auditRows = await this.db
      .selectFrom('audit_logs as a')
      .leftJoin('users as u', 'u.id', 'a.created_by')
      .select([
        'a.id',
        'a.action',
        'a.event_code',
        'a.details',
        'a.created_by',
        'a.created_at',
        'u.username as cashier_name',
      ])
      .where('a.tenant_id', '=', scope.tenantId)
      .where(sql<boolean>`a.created_at >= ${sql.raw(timeSql)}`)
      .where((eb) =>
        eb.or([
          eb('a.event_code', 'in', [...RADAR_EVENT_CODES]),
          // Legacy rows without event_code (see note at top of file).
          eb.and([
            eb('a.event_code', 'is', null),
            eb.or([
              eb('a.action', 'like', '%حذف عنصر من السلة%'),
              eb('a.action', 'like', '%إلغاء/حذف فاتورة%'),
              eb('a.action', 'like', '%خصم%'),
              eb('a.action', 'like', '%مرتجع%'),
            ]),
          ]),
        ]),
      )
      .orderBy('a.id', 'desc')
      .limit(safeLimit)
      .execute();

    // Cancelled sales are the second source of the summary counts (same
    // window), so the strip lists them too — otherwise a cancelled sale
    // counts in the header and the detail but never appears in the strip.
    const cancelledRows = await this.db
      .selectFrom('sales as s')
      .leftJoin('users as u', 'u.id', 's.created_by')
      .select([
        's.id',
        's.doc_no',
        's.total',
        's.created_by',
        's.created_at',
        'u.username as cashier_name',
      ])
      .where('s.tenant_id', '=', scope.tenantId)
      .where('s.status', '=', 'cancelled')
      .where(sql<boolean>`s.created_at >= ${sql.raw(timeSql)}`)
      .orderBy('s.id', 'desc')
      .limit(safeLimit)
      .execute();

    const items: FraudRadarEventItem[] = auditRows.map((row) => {
      const kind = classifyRadarEvent(row);
      let eventType: FraudRadarEventItem['eventType'] = 'cart_remove';
      if (kind === 'draft_cancel') eventType = 'draft_cancel';
      else if (kind === 'discount_override') eventType = 'discount_override';
      else if (kind === 'sale_return') eventType = 'sale_return';

      let amount: number | undefined;
      const match = String(row.details || '').match(/(?:الإجمالي|المبلغ|القيمة):\s*([\d.]+)/);
      if (match && match[1]) {
        amount = Number(match[1]);
      }

      return {
        id: Number(row.id),
        cashierId: Number(row.created_by || 0),
        cashierName: row.cashier_name || `مستخدم #${row.created_by || 0}`,
        eventType,
        eventTitle: String(row.action || ''),
        details: row.details || '',
        amount,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      };
    });

    for (const sale of cancelledRows) {
      items.push({
        // Negative id: a cancelled sale has no audit_logs row, and the
        // id must never collide with an audit event id (React key).
        id: -Number(sale.id),
        cashierId: Number(sale.created_by || 0),
        cashierName: sale.cashier_name || `مستخدم #${sale.created_by || 0}`,
        eventType: 'sale_cancelled',
        eventTitle: 'فاتورة ملغاة',
        details: `فاتورة ملغاة${sale.doc_no ? ` ${sale.doc_no}` : ''} — الإجمالي: ${Number(sale.total || 0)}`,
        amount: Number(sale.total || 0),
        createdAt: sale.created_at ? new Date(sale.created_at).toISOString() : new Date().toISOString(),
      });
    }

    items.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id,
    );
    return items.slice(0, safeLimit);
  }

  async checkAndAlertAnomaly(
    tenantId: string,
    cashierId: number,
    cashierName: string,
    eventType: string,
    details?: string,
  ): Promise<void> {
    if (!this.whatsappService) return;

    try {
      // Check count of void events for this cashier in the past 60 minutes
      const pastHourEvents = await this.db
        .selectFrom('audit_logs')
        .select(sql<number>`COUNT(id)`.as('cnt'))
        .where('tenant_id', '=', tenantId)
        .where('created_by', '=', cashierId)
        .where((eb) =>
          eb.or([
            eb('event_code', '=', AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED),
            eb.and([eb('event_code', 'is', null), eb('action', 'like', '%حذف عنصر من السلة%')]),
          ]),
        )
        .where(sql<boolean>`created_at >= NOW() - INTERVAL '60 MINUTES'`)
        .executeTakeFirst();

      const voidCount = Number(pastHourEvents?.cnt || 0);

      // Trigger alert threshold: 5 or more voids in 1 hour
      if (voidCount >= 5) {
        const debounceKey = `${tenantId}:${cashierId}`;
        const lastAlert = recentAlertTimestamps.get(debounceKey) || 0;
        const now = Date.now();
        if (recentAlertTimestamps.size > 2_000) {
          for (const [key, timestamp] of recentAlertTimestamps) {
            if (now - timestamp > 60 * 60 * 1000) recentAlertTimestamps.delete(key);
          }
          while (recentAlertTimestamps.size > 2_000) {
            const oldest = recentAlertTimestamps.keys().next().value;
            if (oldest === undefined) break;
            recentAlertTimestamps.delete(oldest);
          }
        }

        // Limit alert to once every 60 minutes per cashier
        if (now - lastAlert > 60 * 60 * 1000) {
          recentAlertTimestamps.set(debounceKey, now);

          const tenant = await this.db
            .selectFrom('tenants')
            .select(['business_name', 'owner_phone'])
            .where('id', '=', tenantId)
            .executeTakeFirst();

          if (tenant?.owner_phone) {
            const alertText =
              `🚨 *رادار الرقابة ومنع الخسائر - إنذار تلاعب كاشير*\n` +
              `🏢 *${tenant.business_name || 'إدارة المتجر'}*\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `⚠️ تم رصد نمط مريب: الكاشير *(${cashierName})* قام بـ *${voidCount} عمليات حذف أصناف من السلة* خلال آخر ساعة!\n\n` +
              `📝 تفاصيل آخر عملية: ${details || 'حذف صنف بعد مسحه'}\n` +
              `⏰ التوقيت: ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}\n\n` +
              `🔍 _يُرجى فحص شاشة رادار الكاشير أو كاميرا المراقبة للتحقق من سلامة البيع._`;

            await this.whatsappService.sendRawMessage(tenantId, tenant.owner_phone, alertText);
            this.logger.warn(`Fraud alert sent to owner for cashier ${cashierName} (${voidCount} voids/hr)`);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Fraud anomaly check error: ${err?.message}`);
    }
  }
}
