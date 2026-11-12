import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { resolveRepLinkedUserId } from './van-common.util';

export type VanSuspicionSeverity = 'medium' | 'high' | 'critical';

export type VanSuspicionCategory =
  | 'price_bonus'
  | 'credit_customer'
  | 'collection_return'
  | 'expense_card'
  | 'odometer_auth'
  | 'geofence'
  | 'settlement_shortage';

export const VAN_RADAR_EVENT_CODES = [
  AUDIT_EVENT_CODES.VAN_SUSPICION_INVALID_PIN,
  AUDIT_EVENT_CODES.VAN_SUSPICION_SELF_APPROVAL,
  AUDIT_EVENT_CODES.VAN_SUSPICION_PRICE_MANIPULATION,
  AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_BONUS,
  AUDIT_EVENT_CODES.VAN_SUSPICION_CREDIT_BYPASS,
  AUDIT_EVENT_CODES.VAN_SUSPICION_FAKE_CARD_PAYMENT,
  AUDIT_EVENT_CODES.VAN_SUSPICION_EXPENSE_ABUSE,
  AUDIT_EVENT_CODES.VAN_SUSPICION_CROSS_REP_COLLECTION,
  AUDIT_EVENT_CODES.VAN_SUSPICION_FRAUDULENT_RETURN,
  AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK,
  AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
  AUDIT_EVENT_CODES.VAN_SUSPICION_GEOFENCE_VIOLATION,
  AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE,
] as const;

export type VanRadarEventCode = (typeof VAN_RADAR_EVENT_CODES)[number] | string;

export interface RecordVanSuspicionParams {
  tenantId: string;
  accountId?: string | null;
  repId?: number | null;
  repName?: string;
  tripId?: number | null;
  customerId?: number | null;
  customerName?: string | null;
  eventCode: VanRadarEventCode;
  severity?: VanSuspicionSeverity;
  titleAr?: string;
  detailsAr?: string;
  amountInvolved?: number | null;
  attemptedAmount?: number | null;
  metadata?: Record<string, any>;
  referenceType?: string;
  referenceId?: number;
  extraMetadata?: Record<string, any>;
  // Legacy/alias fields supported seamlessly
  actionTitle?: string;
  details?: string;
  amount?: number | null;
  wasBlocked?: boolean;
  actorUserId?: number | null;
}

export interface VanFraudRadarEvent {
  id: number;
  eventCode: string;
  severity: VanSuspicionSeverity;
  repId: number;
  repName: string;
  tripId: number | null;
  customerId: number | null;
  customerName: string | null;
  titleAr: string;
  detailsAr: string;
  amountInvolved: number;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface VanRepRiskProfile {
  repId: number;
  repName: string;
  phone: string;
  totalSuspicionEvents: number;
  criticalEventsCount: number;
  highEventsCount: number;
  mediumEventsCount: number;
  priceManipulationCount: number;
  unauthorizedBonusCount: number;
  creditBypassCount: number;
  crossRepCollectionCount: number;
  fakeCardCount: number;
  fraudulentReturnCount: number;
  expenseAbuseCount: number;
  odometerRollbackCount: number;
  geofenceViolationCount: number;
  selfApprovalCount: number;
  invalidPinCount: number;
  unauthorizedLoadOrSettleCount: number;
  settlementShortageCount: number;
  totalAmountAtRisk: number;
  riskScore: number;
  riskLevel: 'safe' | 'watch' | 'high_risk';
  flags: string[];
  lastEventAt: string | null;
}

export interface VanFraudRadarSummaryResponse {
  periodDays: number;
  kpis: {
    totalRepsMonitored: number;
    highRiskRepsCount: number;
    watchRepsCount: number;
    totalSuspicionEvents: number;
    criticalEventsCount: number;
    totalAmountAtRisk: number;
    blockedTamperAttemptsCount: number;
    settlementShortageEventsCount: number;
  };
  repProfiles: VanRepRiskProfile[];
  recentEvents: VanFraudRadarEvent[];
}

export function classifyVanSuspicionCategory(eventCode: string): VanSuspicionCategory {
  switch (eventCode) {
    case AUDIT_EVENT_CODES.VAN_SUSPICION_PRICE_MANIPULATION:
    case AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_BONUS:
      return 'price_bonus';
    case AUDIT_EVENT_CODES.VAN_SUSPICION_CREDIT_BYPASS:
      return 'credit_customer';
    case AUDIT_EVENT_CODES.VAN_SUSPICION_CROSS_REP_COLLECTION:
    case AUDIT_EVENT_CODES.VAN_SUSPICION_FRAUDULENT_RETURN:
      return 'collection_return';
    case AUDIT_EVENT_CODES.VAN_SUSPICION_FAKE_CARD_PAYMENT:
    case AUDIT_EVENT_CODES.VAN_SUSPICION_EXPENSE_ABUSE:
      return 'expense_card';
    case AUDIT_EVENT_CODES.VAN_SUSPICION_GEOFENCE_VIOLATION:
      return 'geofence';
    case AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE:
      return 'settlement_shortage';
    default:
      return 'odometer_auth';
  }
}

// In-memory debounce for WhatsApp owner alerts: tenantId:repId:eventCode -> timestamp
const recentVanAlertTimestamps = new Map<string, number>();

@Injectable()
export class VanFraudRadarService {
  private readonly logger = new Logger(VanFraudRadarService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Records a tamper/suspicion attempt on the root DB connection pool (outside any failing transaction)
   * so that even when an AppError rolls back the fraudulent transaction, the suspicion event is
   * permanently persisted in `audit_logs`, surfaces in the Owner Notification Bell, and triggers
   * an instant WhatsApp alert to the business owner if configured.
   */
  async recordSuspicionEvent(params: RecordVanSuspicionParams): Promise<void> {
    try {
      const repIdNum = params.repId != null ? Number(params.repId) : 0;
      let resolvedRepName = params.repName ? String(params.repName).trim() : '';
      if (!resolvedRepName && repIdNum > 0) {
        const repRow = await this.anyDb
          .selectFrom('delivery_representatives')
          .select(['name'])
          .where('id', '=', repIdNum)
          .where('tenant_id', '=', params.tenantId)
          .executeTakeFirst();
        resolvedRepName = repRow?.name ? String(repRow.name).trim() : `مندوب #${repIdNum}`;
      }
      if (!resolvedRepName) {
        resolvedRepName = `مندوب #${repIdNum}`;
      }

      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): a suspicion event
      // names its actor. Callers pass actorUserId when a named human
      // is at hand; every other call site passes only the rep, so the
      // writer itself resolves the rep's linked login here — the one
      // canonical place — instead of leaving created_by null on every
      // row. A rep with no linked login stays honestly null (the rep
      // id/name are already inside the JSON details); a fabricated id
      // (0 or the tenant's first user) is never substituted. No
      // scheduled-sweep suspicion path exists: every caller carries a
      // repId, so there is no actorless system event to mark.
      let actorUserId: number | null =
        params.actorUserId && Number(params.actorUserId) > 0 ? Number(params.actorUserId) : null;
      if (actorUserId === null && repIdNum > 0) {
        actorUserId = await resolveRepLinkedUserId(this.anyDb, params.tenantId, repIdNum);
      }

      let resolvedCustomerName = params.customerName ? String(params.customerName).trim() : '';
      if (!resolvedCustomerName && params.customerId && Number(params.customerId) > 0) {
        const custRow = await this.anyDb
          .selectFrom('customers')
          .select(['name'])
          .where('id', '=', Number(params.customerId))
          .where('tenant_id', '=', params.tenantId)
          .executeTakeFirst();
        resolvedCustomerName = custRow?.name ? String(custRow.name).trim() : '';
      }

      const titleAr = String(params.titleAr || params.actionTitle || 'شبهة تلاعب ميداني مرصودة').trim();
      const detailsAr = String(params.detailsAr || params.details || titleAr).trim();
      const severity: VanSuspicionSeverity = params.severity || 'high';
      const rawAmount = params.amountInvolved ?? params.attemptedAmount ?? params.amount ?? 0;
      // amountInvolved is money stored in the audit log: round at the
      // tenant's book digits (a 3-decimal tenant keeps its third decimal;
      // the old 2-decimal cut dropped it before the event was persisted).
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, params.tenantId));
      const amountInvolved = Number.isFinite(Number(rawAmount)) ? roundMoney(Number(rawAmount), moneyDigits) : 0;
      const wasBlocked = params.wasBlocked !== undefined ? params.wasBlocked : params.eventCode !== AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE;

      const payloadJson = {
        repId: repIdNum,
        repName: resolvedRepName,
        actorUserId,
        tripId: params.tripId != null ? Number(params.tripId) : null,
        customerId: params.customerId != null ? Number(params.customerId) : null,
        customerName: resolvedCustomerName || null,
        severity,
        titleAr,
        detailsAr,
        amountInvolved,
        wasBlocked,
        metadata: params.metadata || {},
      };

      await this.anyDb
        .insertInto('audit_logs')
        .values({
          action: titleAr,
          details: JSON.stringify(payloadJson),
          event_code: String(params.eventCode),
          created_by: actorUserId,
          tenant_id: params.tenantId,
          account_id: params.accountId || 'default',
        })
        .execute();

      await this.dispatchOwnerWhatsAppAlert({
        tenantId: params.tenantId,
        repId: repIdNum,
        repName: resolvedRepName,
        eventCode: String(params.eventCode),
        actionTitle: titleAr,
        details: detailsAr,
        amount: amountInvolved > 0 ? amountInvolved : null,
        wasBlocked,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to record van suspicion event (${params.eventCode}): ${err?.message}`);
    }
  }

  private async dispatchOwnerWhatsAppAlert(params: {
    tenantId: string;
    repId: number;
    repName: string;
    eventCode: string;
    actionTitle: string;
    details: string;
    amount: number | null;
    wasBlocked: boolean;
  }): Promise<void> {
    if (!this.whatsappService) return;
    try {
      const debounceKey = `${params.tenantId}:${params.repId}:${params.eventCode}`;
      const now = Date.now();
      const lastSent = recentVanAlertTimestamps.get(debounceKey) || 0;
      if (now - lastSent < 15 * 60 * 1000) {
        return;
      }
      recentVanAlertTimestamps.set(debounceKey, now);

      const tenant = await this.anyDb
        .selectFrom('tenants')
        .select(['business_name', 'owner_phone'])
        .where('id', '=', params.tenantId)
        .executeTakeFirst();

      if (!tenant?.owner_phone) return;

      const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      const statusLine = params.wasBlocked
        ? 'حالة النظام: تم حظر العملية تلقائياً ومنع التلاعب'
        : 'حالة النظام: تم تسجيل المخالفة في رادار الشبهات للمراجعة';

      const alertText =
        `*رادار رقابة مناديب التوزيع والجملة - إنذار شبهة تلاعب*\n` +
        `*${tenant.business_name || 'إدارة المنشأة'}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `*المندوب:* ${params.repName}\n` +
        `*نوع الشبهة:* ${params.actionTitle}\n` +
        `*التفاصيل:* ${params.details}\n` +
        (params.amount ? `*القيمة المرتبطة:* ${params.amount.toFixed(2)} ج.م\n` : '') +
        `*التوقيت:* ${timeStr}\n` +
        `${statusLine}`;

      await this.whatsappService.sendRawMessage(params.tenantId, tenant.owner_phone, alertText);
    } catch (err: any) {
      this.logger.warn(`Failed to send WhatsApp van radar alert: ${err?.message}`);
    }
  }

  private parseAuditLogRow(row: any): VanFraudRadarEvent {
    let parsed: Record<string, any> = {};
    try {
      parsed = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {});
    } catch {
      parsed = { detailsAr: String(row.details || '') };
    }
    const eventCode = String(row.event_code || '');
    const severity: VanSuspicionSeverity =
      parsed.severity === 'critical' || parsed.severity === 'high' || parsed.severity === 'medium'
        ? parsed.severity
        : 'high';

    return {
      id: Number(row.id),
      eventCode,
      severity,
      repId: Number(parsed.repId || 0),
      repName: String(parsed.repName || `مندوب #${parsed.repId || 0}`),
      tripId: parsed.tripId != null ? Number(parsed.tripId) : null,
      customerId: parsed.customerId != null ? Number(parsed.customerId) : null,
      customerName: parsed.customerName ? String(parsed.customerName) : null,
      titleAr: String(parsed.titleAr || row.action || 'شبهة تلاعب ميداني'),
      detailsAr: String(parsed.detailsAr || row.details || ''),
      amountInvolved: Number(parsed.amountInvolved || 0),
      metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {},
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }

  async getSummary(
    tenantId: string,
    options?: { days?: number; repId?: number },
  ): Promise<VanFraudRadarSummaryResponse> {
    const periodDays = Math.min(365, Math.max(1, Number(options?.days || 30)));
    const cutoff = new Date(Date.now() - periodDays * 24 * 3600 * 1000);
    // Amount-at-risk totals are money: round at the tenant's book digits.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));

    const [repsRows, logsRows] = await Promise.all([
      this.anyDb
        .selectFrom('delivery_representatives')
        .select(['id', 'name', 'phone', 'is_van_rep', 'rep_type'])
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .orderBy('name', 'asc')
        .execute(),
      this.anyDb
        .selectFrom('audit_logs')
        .select(['id', 'action', 'event_code', 'details', 'created_at'])
        .where('tenant_id', '=', tenantId)
        .where('event_code', 'in', [...VAN_RADAR_EVENT_CODES])
        .where('created_at', '>=', cutoff)
        .orderBy('id', 'desc')
        .limit(1000)
        .execute(),
    ]);

    const repMap = new Map<number, VanRepRiskProfile>();
    for (const r of repsRows) {
      const rid = Number(r.id);
      if (options?.repId && rid !== Number(options.repId)) continue;
      repMap.set(rid, {
        repId: rid,
        repName: String(r.name || `مندوب #${rid}`),
        phone: String(r.phone || ''),
        totalSuspicionEvents: 0,
        criticalEventsCount: 0,
        highEventsCount: 0,
        mediumEventsCount: 0,
        priceManipulationCount: 0,
        unauthorizedBonusCount: 0,
        creditBypassCount: 0,
        crossRepCollectionCount: 0,
        fakeCardCount: 0,
        fraudulentReturnCount: 0,
        expenseAbuseCount: 0,
        odometerRollbackCount: 0,
        geofenceViolationCount: 0,
        selfApprovalCount: 0,
        invalidPinCount: 0,
        unauthorizedLoadOrSettleCount: 0,
        settlementShortageCount: 0,
        totalAmountAtRisk: 0,
        riskScore: 0,
        riskLevel: 'safe',
        flags: [],
        lastEventAt: null,
      });
    }

    const recentEvents: VanFraudRadarEvent[] = [];
    let totalSuspicionEvents = 0;
    let criticalEventsCount = 0;
    let totalAmountAtRisk = 0;
    let blockedTamperAttemptsCount = 0;
    let settlementShortageEventsCount = 0;

    for (const row of logsRows) {
      const ev = this.parseAuditLogRow(row);
      if (options?.repId && ev.repId !== Number(options.repId)) {
        continue;
      }

      if (recentEvents.length < 150) {
        recentEvents.push(ev);
      }

      totalSuspicionEvents++;
      if (ev.severity === 'critical') criticalEventsCount++;
      if (ev.amountInvolved > 0) {
        totalAmountAtRisk = roundMoney(totalAmountAtRisk + ev.amountInvolved, moneyDigits);
      }
      if (ev.eventCode === AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE) {
        settlementShortageEventsCount++;
      } else {
        blockedTamperAttemptsCount++;
      }

      let profile = repMap.get(ev.repId);
      if (!profile && ev.repId > 0) {
        profile = {
          repId: ev.repId,
          repName: ev.repName,
          phone: '',
          totalSuspicionEvents: 0,
          criticalEventsCount: 0,
          highEventsCount: 0,
          mediumEventsCount: 0,
          priceManipulationCount: 0,
          unauthorizedBonusCount: 0,
          creditBypassCount: 0,
          crossRepCollectionCount: 0,
          fakeCardCount: 0,
          fraudulentReturnCount: 0,
          expenseAbuseCount: 0,
          odometerRollbackCount: 0,
          geofenceViolationCount: 0,
          selfApprovalCount: 0,
          invalidPinCount: 0,
          unauthorizedLoadOrSettleCount: 0,
          settlementShortageCount: 0,
          totalAmountAtRisk: 0,
          riskScore: 0,
          riskLevel: 'safe',
          flags: [],
          lastEventAt: null,
        };
        repMap.set(ev.repId, profile);
      }

      if (profile) {
        profile.totalSuspicionEvents++;
        if (ev.severity === 'critical') profile.criticalEventsCount++;
        else if (ev.severity === 'high') profile.highEventsCount++;
        else profile.mediumEventsCount++;

        if (ev.amountInvolved > 0) {
          profile.totalAmountAtRisk = roundMoney(profile.totalAmountAtRisk + ev.amountInvolved, moneyDigits);
        }
        if (!profile.lastEventAt || ev.createdAt > profile.lastEventAt) {
          profile.lastEventAt = ev.createdAt;
        }

        switch (ev.eventCode) {
          case AUDIT_EVENT_CODES.VAN_SUSPICION_PRICE_MANIPULATION:
            profile.priceManipulationCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_BONUS:
            profile.unauthorizedBonusCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_CREDIT_BYPASS:
            profile.creditBypassCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_CROSS_REP_COLLECTION:
            profile.crossRepCollectionCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_FAKE_CARD_PAYMENT:
            profile.fakeCardCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_FRAUDULENT_RETURN:
            profile.fraudulentReturnCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_EXPENSE_ABUSE:
            profile.expenseAbuseCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK:
            profile.odometerRollbackCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_GEOFENCE_VIOLATION:
            profile.geofenceViolationCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_SELF_APPROVAL:
            profile.selfApprovalCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_INVALID_PIN:
            profile.invalidPinCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE:
            profile.unauthorizedLoadOrSettleCount++;
            break;
          case AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE:
            profile.settlementShortageCount++;
            break;
        }
      }
    }

    let highRiskRepsCount = 0;
    let watchRepsCount = 0;
    const repProfiles: VanRepRiskProfile[] = [];

    for (const p of repMap.values()) {
      const rawScore =
        p.criticalEventsCount * 28 +
        p.highEventsCount * 16 +
        p.mediumEventsCount * 8 +
        (p.totalAmountAtRisk >= 1000 ? 15 : p.totalAmountAtRisk > 0 ? 5 : 0);

      p.riskScore = Math.min(100, rawScore);
      const flags: string[] = [];
      if (p.priceManipulationCount > 0) flags.push(`تلاعب أسعار (${p.priceManipulationCount})`);
      if (p.unauthorizedBonusCount > 0) flags.push(`بونص بدون صلاحية (${p.unauthorizedBonusCount})`);
      if (p.crossRepCollectionCount > 0) flags.push(`تحصيل عميل مشترك (${p.crossRepCollectionCount})`);
      if (p.creditBypassCount > 0) flags.push(`كسر ائتمان (${p.creditBypassCount})`);
      if (p.fraudulentReturnCount > 0) flags.push(`مرتجعات مشبوهة (${p.fraudulentReturnCount})`);
      if (p.fakeCardCount > 0) flags.push(`دفع شبكة وهمي (${p.fakeCardCount})`);
      if (p.expenseAbuseCount > 0) flags.push(`تجاوز مصروفات (${p.expenseAbuseCount})`);
      if (p.odometerRollbackCount > 0) flags.push(`تلاعب عداد (${p.odometerRollbackCount})`);
      if (p.geofenceViolationCount > 0) flags.push(`خارج النطاق الجغرافي (${p.geofenceViolationCount})`);
      if (p.selfApprovalCount > 0 || p.unauthorizedLoadOrSettleCount > 0) {
        flags.push(`خرق فصل المهام (${p.selfApprovalCount + p.unauthorizedLoadOrSettleCount})`);
      }
      if (p.invalidPinCount > 0) flags.push(`تخمين رمز المشرف (${p.invalidPinCount})`);
      if (p.settlementShortageCount > 0) flags.push(`عجز تصفية (${p.settlementShortageCount})`);
      p.flags = flags;

      if (p.riskScore >= 50 || p.criticalEventsCount >= 1) {
        p.riskLevel = 'high_risk';
        highRiskRepsCount++;
      } else if (p.riskScore >= 15 || p.totalSuspicionEvents >= 1) {
        p.riskLevel = 'watch';
        watchRepsCount++;
      } else {
        p.riskLevel = 'safe';
      }

      repProfiles.push(p);
    }

    repProfiles.sort((a, b) => b.riskScore - a.riskScore || b.totalSuspicionEvents - a.totalSuspicionEvents);

    return {
      periodDays,
      kpis: {
        totalRepsMonitored: repProfiles.length,
        highRiskRepsCount,
        watchRepsCount,
        totalSuspicionEvents,
        criticalEventsCount,
        totalAmountAtRisk,
        blockedTamperAttemptsCount,
        settlementShortageEventsCount,
      },
      repProfiles,
      recentEvents,
    };
  }

  async getEvents(
    tenantId: string,
    options?: {
      days?: number;
      repId?: number;
      eventCode?: string;
      limit?: number;
    },
  ): Promise<VanFraudRadarEvent[]> {
    const periodDays = Math.min(365, Math.max(1, Number(options?.days || 30)));
    const cutoff = new Date(Date.now() - periodDays * 24 * 3600 * 1000);
    const safeLimit = Math.min(300, Math.max(5, Number(options?.limit || 100)));

    let query = this.anyDb
      .selectFrom('audit_logs')
      .select(['id', 'action', 'event_code', 'details', 'created_at'])
      .where('tenant_id', '=', tenantId)
      .where('created_at', '>=', cutoff);

    if (options?.eventCode && options.eventCode !== 'all') {
      query = query.where('event_code', '=', options.eventCode);
    } else {
      query = query.where('event_code', 'in', [...VAN_RADAR_EVENT_CODES]);
    }

    const rows = await query.orderBy('id', 'desc').limit(500).execute();

    const events: VanFraudRadarEvent[] = [];
    for (const row of rows) {
      const ev = this.parseAuditLogRow(row);
      if (options?.repId && ev.repId !== Number(options.repId)) {
        continue;
      }
      events.push(ev);
      if (events.length >= safeLimit) break;
    }

    return events;
  }
}
