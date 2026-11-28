import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { loadAntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import { roundMoneyToTwoDecimals } from '../../../common/utils/financial-integrity';
import {
  evaluateCashierPeerBenchmarks,
  extractSnapshotFromDetails,
  type AuditSnapshotItem,
  type PeerBenchmarkSummary,
} from '../engines/cashier-peer-benchmark.engine';

export type RiskLevel = 'low' | 'medium' | 'high';

export type RadarEventKind =
  | 'cart_remove'
  | 'qty_decrease'
  | 'draft_cancel'
  | 'no_sale'
  | 'receipt_reprint'
  | 'held_sale_delete'
  | 'weighted_barcode_replay'
  | 'discount_override'
  | 'sale_return'
  | 'sale_cancelled';

const RADAR_EVENT_CODES = [
  AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED,
  AUDIT_EVENT_CODES.POS_CART_QTY_DECREASED,
  AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED,
  AUDIT_EVENT_CODES.POS_NO_SALE_DRAWER_OPEN,
  AUDIT_EVENT_CODES.POS_RECEIPT_REPRINTED,
  AUDIT_EVENT_CODES.POS_HELD_SALE_DELETED,
  AUDIT_EVENT_CODES.POS_WEIGHTED_BARCODE_REPLAY,
  AUDIT_EVENT_CODES.POS_DISCOUNT_OVERRIDE,
  AUDIT_EVENT_CODES.POS_SALE_RETURN,
] as const;

type RadarLogRow = { event_code?: string | null; action?: string | null };

function classifyRadarEvent(row: RadarLogRow): Exclude<RadarEventKind, 'sale_cancelled'> | null {
  const code = String(row.event_code || '');
  if (code === AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED) return 'cart_remove';
  if (code === AUDIT_EVENT_CODES.POS_CART_QTY_DECREASED) return 'qty_decrease';
  if (code === AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED) return 'draft_cancel';
  if (code === AUDIT_EVENT_CODES.POS_NO_SALE_DRAWER_OPEN) return 'no_sale';
  if (code === AUDIT_EVENT_CODES.POS_RECEIPT_REPRINTED) return 'receipt_reprint';
  if (code === AUDIT_EVENT_CODES.POS_HELD_SALE_DELETED) return 'held_sale_delete';
  if (code === AUDIT_EVENT_CODES.POS_WEIGHTED_BARCODE_REPLAY) return 'weighted_barcode_replay';
  if (code === AUDIT_EVENT_CODES.POS_DISCOUNT_OVERRIDE) return 'discount_override';
  if (code === AUDIT_EVENT_CODES.POS_SALE_RETURN) return 'sale_return';

  const action = String(row.action || '');
  if (action.includes('فتح درج بدون بيع')) return 'no_sale';
  if (action.includes('تنقيص كمية')) return 'qty_decrease';
  if (action.includes('إعادة طباعة')) return 'receipt_reprint';
  if (action.includes('فاتورة معلقة')) return 'held_sale_delete';
  if (action.includes('باركود ميزان')) return 'weighted_barcode_replay';
  if (action.includes('حذف عنصر من السلة')) return 'cart_remove';
  if (action.includes('إلغاء/حذف فاتورة') || action.includes('مسح سلة')) return 'draft_cancel';
  if (action.includes('خصم')) return 'discount_override';
  if (action.includes('مرتجع')) return 'sale_return';
  return null;
}

function formatCameraTime(dateValue: Date | string, timeZone: string): string {
  try {
    const dt = new Date(dateValue);
    return dt.toLocaleTimeString('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    const dt = new Date(dateValue);
    return dt.toISOString().slice(11, 19);
  }
}

export interface CashierRiskProfile {
  cashierId: number;
  cashierName: string;
  cartVoidsCount: number;
  qtyDecreasesCount: number;
  draftCancelsCount: number;
  noSaleOpensCount: number;
  receiptReprintsCount: number;
  heldDeletesCount: number;
  weightedReplaysCount: number;
  cancelledSalesCount: number;
  discountOverridesCount: number;
  saleReturnsCount: number;
  totalSuspiciousEvents: number;
  totalSalesCount: number;
  riskScore: number;
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
  peerBenchmarks: PeerBenchmarkSummary;
  thresholds: {
    maxHourlyVoidsAlert: number;
    cartClearAlertThreshold: number;
    whatsappAlertsEnabled: boolean;
  };
}

export interface FraudRadarEventItem {
  id: number;
  cashierId: number;
  cashierName: string;
  eventType: RadarEventKind;
  eventTitle: string;
  details: string;
  items: AuditSnapshotItem[];
  amount?: number;
  cameraTime: string;
  createdAt: string;
}

// In-memory debounce tracker for WhatsApp alerts: tenantId:cashierId:kind -> lastAlertTimestamp
const recentAlertTimestamps = new Map<string, number>();

@Injectable()
export class CashierFraudRadarService {
  private readonly logger = new Logger(CashierFraudRadarService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  private getTimeFilter(timeframe: 'today' | '7days' | '30days', tenantTz: string, todayKey: string, column: string) {
    if (timeframe === '7days') return sql<boolean>`${sql.ref(column)} >= NOW() - INTERVAL '7 DAYS'`;
    if (timeframe === '30days') return sql<boolean>`${sql.ref(column)} >= NOW() - INTERVAL '30 DAYS'`;
    return sql<boolean>`DATE(${sql.ref(column)} AT TIME ZONE ${tenantTz}) = ${todayKey}`;
  }

  private buildEventKindSql() {
    return sql<string>`case
      when event_code = ${AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED} then 'cart_remove'
      when event_code = ${AUDIT_EVENT_CODES.POS_CART_QTY_DECREASED} then 'qty_decrease'
      when event_code = ${AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED} then 'draft_cancel'
      when event_code = ${AUDIT_EVENT_CODES.POS_NO_SALE_DRAWER_OPEN} then 'no_sale'
      when event_code = ${AUDIT_EVENT_CODES.POS_RECEIPT_REPRINTED} then 'receipt_reprint'
      when event_code = ${AUDIT_EVENT_CODES.POS_HELD_SALE_DELETED} then 'held_sale_delete'
      when event_code = ${AUDIT_EVENT_CODES.POS_WEIGHTED_BARCODE_REPLAY} then 'weighted_barcode_replay'
      when event_code = ${AUDIT_EVENT_CODES.POS_DISCOUNT_OVERRIDE} then 'discount_override'
      when event_code = ${AUDIT_EVENT_CODES.POS_SALE_RETURN} then 'sale_return'
      when event_code is null and action like '%فتح درج بدون بيع%' then 'no_sale'
      when event_code is null and action like '%حذف عنصر من السلة%' then 'cart_remove'
      when event_code is null and action like '%إلغاء/حذف فاتورة%' then 'draft_cancel'
      when event_code is null and action like '%خصم%' then 'discount_override'
      else 'sale_return' end`;
  }

  async getSummary(
    timeframe: 'today' | '7days' | '30days' = 'today',
    auth: AuthContext,
  ): Promise<FraudRadarSummaryResponse> {
    const scope = requireTenantScope(auth);
    const tenantTz = await getTenantTimezone(this.db, scope.tenantId);
    const todayKey = todayTenantDate(tenantTz);
    const maxDetailedEvents = 2_000;
    const [moneyDigits, antiTheft] = await Promise.all([
      tenantBaseCurrency(this.db, scope.tenantId).then(currencyMoneyDigits),
      loadAntiTheftSettings(this.db, scope.tenantId),
    ]);

    const cashiers = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'role'])
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true)
      .execute();

    const auditBase = this.db
      .selectFrom('audit_logs')
      .where('tenant_id', '=', scope.tenantId)
      .where(this.getTimeFilter(timeframe, tenantTz, todayKey, 'created_at'))
      .where((eb) =>
        eb.or([
          eb('event_code', 'in', [...RADAR_EVENT_CODES]),
          eb.and([
            eb('event_code', 'is', null),
            eb.or([
              eb('action', 'like', '%حذف عنصر من السلة%'),
              eb('action', 'like', '%إلغاء/حذف فاتورة%'),
              eb('action', 'like', '%فتح درج بدون بيع%'),
              eb('action', 'like', '%خصم%'),
              eb('action', 'like', '%مرتجع%'),
            ]),
          ]),
        ]),
      );

    const eventKind = this.buildEventKindSql();
    const [auditRows, auditStats, cancelledSales, completedSales, lineItemStats] = await Promise.all([
      auditBase
        .select(['id', 'action', 'event_code', 'details', 'created_by', 'created_at'])
        .orderBy('id', 'desc')
        .limit(maxDetailedEvents + 1)
        .execute(),
      auditBase
        .select([
          'created_by',
          sql<number>`count(*)::int`.as('event_count'),
          sql<number>`count(*) filter (where ${eventKind} = 'cart_remove')::int`.as('cart_voids'),
          sql<number>`count(*) filter (where ${eventKind} = 'qty_decrease')::int`.as('qty_decreases'),
          sql<number>`count(*) filter (where ${eventKind} = 'draft_cancel')::int`.as('draft_cancels'),
          sql<number>`count(*) filter (where ${eventKind} = 'no_sale')::int`.as('no_sales'),
          sql<number>`count(*) filter (where ${eventKind} = 'receipt_reprint')::int`.as('receipt_reprints'),
          sql<number>`count(*) filter (where ${eventKind} = 'held_sale_delete')::int`.as('held_deletes'),
          sql<number>`count(*) filter (where ${eventKind} = 'weighted_barcode_replay')::int`.as('weighted_replays'),
          sql<number>`count(*) filter (where ${eventKind} = 'discount_override')::int`.as('discount_overrides'),
          sql<number>`count(*) filter (where ${eventKind} = 'sale_return')::int`.as('sale_returns'),
          sql<Date | null>`max(created_at)`.as('last_suspicious_at'),
        ])
        .groupBy('created_by')
        .execute(),
      this.db
        .selectFrom('sales')
        .select([
          'created_by',
          sql<number>`count(*)::int`.as('cancelled_count'),
          sql<number>`coalesce(sum(total), 0)`.as('cancelled_total'),
          sql<Date | null>`max(created_at)`.as('latest_cancelled_at'),
        ])
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'cancelled')
        .where(this.getTimeFilter(timeframe, tenantTz, todayKey, 'created_at'))
        .groupBy('created_by')
        .execute(),
      this.db
        .selectFrom('sales')
        .select([
          'created_by',
          sql<number>`COUNT(id)::int`.as('sales_count'),
          sql<number>`COALESCE(SUM(total), 0)`.as('total_revenue'),
        ])
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '!=', 'cancelled')
        .where(this.getTimeFilter(timeframe, tenantTz, todayKey, 'created_at'))
        .groupBy('created_by')
        .execute(),
      this.db
        .selectFrom('sale_items as si')
        .innerJoin('sales as s', (join) =>
          join.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id'),
        )
        .select(['s.created_by', sql<number>`COUNT(si.id)::int`.as('line_items_count')])
        .where('s.tenant_id', '=', scope.tenantId)
        .where('s.status', '!=', 'cancelled')
        .where(this.getTimeFilter(timeframe, tenantTz, todayKey, 's.created_at'))
        .groupBy('s.created_by')
        .execute(),
    ]);

    const sampled = auditRows.length > maxDetailedEvents;

    const salesStatsMap = new Map<number, { count: number; revenue: number; lineItems: number }>();
    for (const s of completedSales) {
      if (s.created_by) {
        salesStatsMap.set(Number(s.created_by), {
          count: Number(s.sales_count || 0),
          revenue: Number(s.total_revenue || 0),
          lineItems: 0,
        });
      }
    }
    for (const li of lineItemStats) {
      if (li.created_by) {
        const entry = salesStatsMap.get(Number(li.created_by));
        if (entry) entry.lineItems = Number(li.line_items_count || 0);
      }
    }

    type StatsBucket = {
      cartVoids: number;
      qtyDecreases: number;
      draftCancels: number;
      noSales: number;
      receiptReprints: number;
      heldDeletes: number;
      weightedReplays: number;
      discountOverrides: number;
      saleReturns: number;
      cancelledSales: number;
      lastSuspiciousAt?: string;
    };
    const emptyBucket = (): StatsBucket => ({
      cartVoids: 0,
      qtyDecreases: 0,
      draftCancels: 0,
      noSales: 0,
      receiptReprints: 0,
      heldDeletes: 0,
      weightedReplays: 0,
      discountOverrides: 0,
      saleReturns: 0,
      cancelledSales: 0,
    });

    const cashierStatsMap = new Map<number, StatsBucket>();
    for (const c of cashiers) {
      cashierStatsMap.set(Number(c.id), emptyBucket());
    }

    let estimatedProtectedLoss = 0;

    for (const row of auditStats) {
      const uid = Number(row.created_by || 0);
      let stats = cashierStatsMap.get(uid);
      if (!stats) {
        stats = emptyBucket();
        cashierStatsMap.set(uid, stats);
      }
      stats.cartVoids = Number(row.cart_voids || 0);
      stats.qtyDecreases = Number(row.qty_decreases || 0);
      stats.draftCancels = Number(row.draft_cancels || 0);
      stats.noSales = Number(row.no_sales || 0);
      stats.receiptReprints = Number(row.receipt_reprints || 0);
      stats.heldDeletes = Number(row.held_deletes || 0);
      stats.weightedReplays = Number(row.weighted_replays || 0);
      stats.discountOverrides = Number(row.discount_overrides || 0);
      stats.saleReturns = Number(row.sale_returns || 0);
      stats.lastSuspiciousAt = row.last_suspicious_at ? new Date(row.last_suspicious_at).toISOString() : undefined;
    }

    for (const log of auditRows.slice(0, maxDetailedEvents)) {
      const { cleanText, items } = extractSnapshotFromDetails(log.details);
      const match = cleanText.match(/(?:القيمة|الإجمالي|المبلغ):\s*([\d.]+)/);
      if (match && match[1]) {
        estimatedProtectedLoss += Number(match[1]) || 0;
      } else if (items.length > 0) {
        estimatedProtectedLoss += items.reduce((sum, it) => sum + Number(it.lineTotal || 0), 0);
      }
    }

    for (const cs of cancelledSales) {
      const uid = Number(cs.created_by || 0);
      let stats = cashierStatsMap.get(uid);
      if (!stats) {
        stats = emptyBucket();
        cashierStatsMap.set(uid, stats);
      }
      stats.cancelledSales = Number(cs.cancelled_count || 0);
      estimatedProtectedLoss += Number(cs.cancelled_total || 0);
      const cancelledAt = cs.latest_cancelled_at ? new Date(cs.latest_cancelled_at).toISOString() : undefined;
      if (cancelledAt && (!stats.lastSuspiciousAt || cancelledAt > stats.lastSuspiciousAt)) {
        stats.lastSuspiciousAt = cancelledAt;
      }
    }

    const profiles: CashierRiskProfile[] = [];
    let highRiskCount = 0;
    let mediumRiskCount = 0;

    const cashierById = new Map<number, { username: string }>();
    for (const c of cashiers) cashierById.set(Number(c.id), { username: c.username });
    const profileUids = new Set<number>([...cashierById.keys(), ...cashierStatsMap.keys(), ...salesStatsMap.keys()]);

    for (const uid of profileUids) {
      const stats = cashierStatsMap.get(uid) || emptyBucket();
      const salesMetrics = salesStatsMap.get(uid) || { count: 0, revenue: 0, lineItems: 0 };
      const salesCount = salesMetrics.count;
      const totalEvents =
        stats.cartVoids +
        stats.qtyDecreases +
        stats.draftCancels +
        stats.noSales +
        stats.receiptReprints +
        stats.heldDeletes +
        stats.weightedReplays +
        stats.cancelledSales +
        stats.discountOverrides +
        stats.saleReturns;

      let rawScore =
        stats.cartVoids * 12 +
        stats.qtyDecreases * 10 +
        stats.draftCancels * 18 +
        stats.noSales * 20 +
        stats.receiptReprints * 14 +
        stats.heldDeletes * 18 +
        stats.weightedReplays * 25 +
        stats.cancelledSales * 25 +
        stats.discountOverrides * 8 +
        stats.saleReturns * 10;

      if (salesCount > 10) {
        rawScore = rawScore / Math.max(1, salesCount / 20);
      }
      const riskScore = Math.min(100, Math.max(0, Math.round(rawScore)));

      let riskLevel: RiskLevel = 'low';
      if (
        riskScore >= 60 ||
        stats.cartVoids >= 5 ||
        stats.cancelledSales >= 3 ||
        stats.noSales >= 3 ||
        stats.weightedReplays >= 2
      ) {
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
        qtyDecreasesCount: stats.qtyDecreases,
        draftCancelsCount: stats.draftCancels,
        noSaleOpensCount: stats.noSales,
        receiptReprintsCount: stats.receiptReprints,
        heldDeletesCount: stats.heldDeletes,
        weightedReplaysCount: stats.weightedReplays,
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

    const totalSuspiciousEvents = profiles.reduce((sum, p) => sum + p.totalSuspiciousEvents, 0);
    profiles.sort((a, b) => b.riskScore - a.riskScore);

    const peerBenchmarks = evaluateCashierPeerBenchmarks(
      profiles.map((p) => {
        const sm = salesStatsMap.get(p.cashierId) || { count: 0, revenue: 0, lineItems: 0 };
        return {
          cashierId: p.cashierId,
          cashierName: p.cashierName,
          salesCount: sm.count,
          totalRevenue: sm.revenue,
          totalLineItems: sm.lineItems,
          suspiciousEventsCount: p.totalSuspiciousEvents,
          returnsCount: p.saleReturnsCount,
        };
      }),
    );

    return {
      timeframe,
      sampled,
      totalSuspiciousEvents,
      highRiskCashiersCount: highRiskCount,
      mediumRiskCashiersCount: mediumRiskCount,
      estimatedProtectedLoss: roundMoney(estimatedProtectedLoss, moneyDigits),
      cashiers: profiles,
      peerBenchmarks,
      thresholds: {
        maxHourlyVoidsAlert: 5,
        cartClearAlertThreshold: antiTheft.cartClearAlertThreshold,
        whatsappAlertsEnabled: true,
      },
    };
  }

  async getEvents(
    limit = 40,
    auth: AuthContext,
    timeframe: 'today' | '7days' | '30days' = 'today',
  ): Promise<FraudRadarEventItem[]> {
    const scope = requireTenantScope(auth);
    const safeLimit = Math.min(100, Math.max(5, limit));
    const tenantTz = await getTenantTimezone(this.db, scope.tenantId);
    const todayKey = todayTenantDate(tenantTz);

    const [auditRows, cancelledRows] = await Promise.all([
      this.db
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
        .where(this.getTimeFilter(timeframe, tenantTz, todayKey, 'a.created_at'))
        .where((eb) =>
          eb.or([
            eb('a.event_code', 'in', [...RADAR_EVENT_CODES]),
            eb.and([
              eb('a.event_code', 'is', null),
              eb.or([
                eb('a.action', 'like', '%حذف عنصر من السلة%'),
                eb('a.action', 'like', '%إلغاء/حذف فاتورة%'),
                eb('a.action', 'like', '%فتح درج بدون بيع%'),
                eb('a.action', 'like', '%خصم%'),
                eb('a.action', 'like', '%مرتجع%'),
              ]),
            ]),
          ]),
        )
        .orderBy('a.id', 'desc')
        .limit(safeLimit)
        .execute(),
      this.db
        .selectFrom('sales as s')
        .leftJoin('users as u', 'u.id', 's.created_by')
        .select(['s.id', 's.doc_no', 's.total', 's.created_by', 's.created_at', 'u.username as cashier_name'])
        .where('s.tenant_id', '=', scope.tenantId)
        .where('s.status', '=', 'cancelled')
        .where(this.getTimeFilter(timeframe, tenantTz, todayKey, 's.created_at'))
        .orderBy('s.id', 'desc')
        .limit(safeLimit)
        .execute(),
    ]);

    const items: FraudRadarEventItem[] = auditRows.map((row) => {
      const kind = classifyRadarEvent(row) || 'cart_remove';
      const { cleanText, items: snapshotItems } = extractSnapshotFromDetails(row.details);
      let amount: number | undefined;
      const match = cleanText.match(/(?:القيمة|الإجمالي|المبلغ):\s*([\d.]+)/);
      if (match && match[1]) {
        amount = Number(match[1]);
      } else if (snapshotItems.length > 0) {
        amount = roundMoneyToTwoDecimals(snapshotItems.reduce((sum, it) => sum + Number(it.lineTotal || 0), 0));
      }
      const createdIso = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();

      return {
        id: Number(row.id),
        cashierId: Number(row.created_by || 0),
        cashierName: row.cashier_name || `مستخدم #${row.created_by || 0}`,
        eventType: kind,
        eventTitle: String(row.action || ''),
        details: cleanText,
        items: snapshotItems,
        amount,
        cameraTime: formatCameraTime(createdIso, tenantTz),
        createdAt: createdIso,
      };
    });

    for (const sale of cancelledRows) {
      const createdIso = sale.created_at ? new Date(sale.created_at).toISOString() : new Date().toISOString();
      items.push({
        id: -Number(sale.id),
        cashierId: Number(sale.created_by || 0),
        cashierName: sale.cashier_name || `مستخدم #${sale.created_by || 0}`,
        eventType: 'sale_cancelled',
        eventTitle: 'فاتورة ملغاة',
        details: `فاتورة ملغاة${sale.doc_no ? ` ${sale.doc_no}` : ''} — الإجمالي: ${Number(sale.total || 0)}`,
        items: [],
        amount: Number(sale.total || 0),
        cameraTime: formatCameraTime(createdIso, tenantTz),
        createdAt: createdIso,
      });
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
    return items.slice(0, safeLimit);
  }

  async checkAndAlertAnomaly(
    tenantId: string,
    cashierId: number,
    cashierName: string,
    eventType: string,
    details?: string,
    eventAmount = 0,
  ): Promise<void> {
    if (!this.whatsappService) return;

    try {
      const antiTheft = await loadAntiTheftSettings(this.db, tenantId);
      const tenantTz = await getTenantTimezone(this.db, tenantId);
      const cameraTime = formatCameraTime(new Date(), tenantTz);

      let shouldAlert = false;
      let alertReason = '';
      let alertKey = eventType;

      if (
        eventType === 'draft_cancel' &&
        eventAmount >= antiTheft.cartClearAlertThreshold &&
        antiTheft.cartClearAlertThreshold > 0
      ) {
        shouldAlert = true;
        alertReason = `الكاشير *(${cashierName})* قام بـ *مسح سلة كاملة بقيمة ${eventAmount}* قبل إتمام البيع`;
        alertKey = 'draft_cancel_high';
      } else if (eventType === 'weighted_barcode_replay') {
        shouldAlert = true;
        alertReason = `الكاشير *(${cashierName})* قام بـ *تكرار مسح نفس باركود الميزان* داخل نفس الوردية`;
      } else {
        const hourlyRule: Record<string, { code: string; threshold: number; label: string }> = {
          cart_remove: { code: AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED, threshold: 5, label: 'حذف أصناف من السلة' },
          qty_decrease: {
            code: AUDIT_EVENT_CODES.POS_CART_QTY_DECREASED,
            threshold: 5,
            label: 'تنقيص كميات أصناف بالسلة',
          },
          no_sale: { code: AUDIT_EVENT_CODES.POS_NO_SALE_DRAWER_OPEN, threshold: 2, label: 'فتح الدرج بدون بيع' },
          receipt_reprint: { code: AUDIT_EVENT_CODES.POS_RECEIPT_REPRINTED, threshold: 3, label: 'إعادة طباعة فواتير' },
          held_sale_delete: { code: AUDIT_EVENT_CODES.POS_HELD_SALE_DELETED, threshold: 2, label: 'حذف فواتير معلقة' },
        };
        const rule = hourlyRule[eventType];
        if (rule) {
          const pastHour = await this.db
            .selectFrom('audit_logs')
            .select(sql<number>`COUNT(id)`.as('cnt'))
            .where('tenant_id', '=', tenantId)
            .where('created_by', '=', cashierId)
            .where('event_code', '=', rule.code)
            .where(sql<boolean>`created_at >= NOW() - INTERVAL '60 MINUTES'`)
            .executeTakeFirst();
          const cnt = Number(pastHour?.cnt || 0);
          if (cnt >= rule.threshold) {
            shouldAlert = true;
            alertReason = `الكاشير *(${cashierName})* قام بـ *${cnt} عمليات (${rule.label})* خلال آخر ساعة`;
          }
        }
      }

      if (!shouldAlert) return;

      const debounceKey = `${tenantId}:${cashierId}:${alertKey}`;
      const lastAlert = recentAlertTimestamps.get(debounceKey) || 0;
      const now = Date.now();
      if (recentAlertTimestamps.size > 2_000) {
        for (const [key, timestamp] of recentAlertTimestamps) {
          if (now - timestamp > 60 * 60 * 1000) recentAlertTimestamps.delete(key);
        }
      }

      // High-value cart clear alerts debounce at 10 minutes; hourly pattern alerts debounce at 60 minutes
      const debounceWindowMs = alertKey === 'draft_cancel_high' ? 10 * 60 * 1000 : 60 * 60 * 1000;
      if (now - lastAlert <= debounceWindowMs) return;
      recentAlertTimestamps.set(debounceKey, now);

      const tenant = await this.db
        .selectFrom('tenants')
        .select(['business_name', 'owner_phone'])
        .where('id', '=', tenantId)
        .executeTakeFirst();

      if (tenant?.owner_phone) {
        const alertText =
          `*رادار الرقابة ومنع الخسائر - إنذار تلاعب كاشير*\n` +
          `*${tenant.business_name || 'إدارة المتجر'}*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `${alertReason}\n\n` +
          `التفاصيل: ${details || 'راجع شاشة رادار الكاشير'}\n` +
          `توقيت الكاميرا (CCTV): *${cameraTime}*\n\n` +
          `_راجع كاميرا الكاشير على التوقيت أعلاه أو افتح شاشة غرفة منع الخسائر._`;

        await this.whatsappService.sendRawMessage(tenantId, tenant.owner_phone, alertText);
        this.logger.warn(`Fraud alert sent to owner for cashier ${cashierName} (${alertKey})`);
      }
    } catch (err: any) {
      this.logger.warn(`Fraud anomaly check error: ${err?.message}`);
    }
  }
}
