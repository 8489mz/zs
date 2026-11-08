import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import {
  calculateRepTargetMetrics,
  calculateRepCommissionMetrics,
} from '../rep-target.engine';
import { getMonthlyOfficialHolidayDates } from './van-common.util';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

export interface VanRepCommissionConfig {
  salesCommissionRatePercent: number;
  collectionCommissionRatePercent: number;
  targetBonusRatePercent: number;
  repOverrides?: Record<
    string,
    {
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
    }
  >;
}

const DEFAULT_COMMISSION_CONFIG: VanRepCommissionConfig = {
  salesCommissionRatePercent: 1.0,
  collectionCommissionRatePercent: 0.5,
  targetBonusRatePercent: 0.5,
  repOverrides: {},
};

@Injectable()
export class VanTargetsService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Optional() private readonly accountingPosting?: AccountingPostingService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  async getCommissionConfig(tenantId: string): Promise<VanRepCommissionConfig> {
    const row = await this.anyDb
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'van_rep_commission_config')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!row?.value) {
      return { ...DEFAULT_COMMISSION_CONFIG, repOverrides: {} };
    }
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return {
        salesCommissionRatePercent:
          parsed?.salesCommissionRatePercent !== undefined
            ? Math.max(0, Number(parsed.salesCommissionRatePercent))
            : DEFAULT_COMMISSION_CONFIG.salesCommissionRatePercent,
        collectionCommissionRatePercent:
          parsed?.collectionCommissionRatePercent !== undefined
            ? Math.max(0, Number(parsed.collectionCommissionRatePercent))
            : DEFAULT_COMMISSION_CONFIG.collectionCommissionRatePercent,
        targetBonusRatePercent:
          parsed?.targetBonusRatePercent !== undefined
            ? Math.max(0, Number(parsed.targetBonusRatePercent))
            : DEFAULT_COMMISSION_CONFIG.targetBonusRatePercent,
        repOverrides:
          parsed?.repOverrides && typeof parsed.repOverrides === 'object'
            ? parsed.repOverrides
            : {},
      };
    } catch {
      return { ...DEFAULT_COMMISSION_CONFIG, repOverrides: {} };
    }
  }

  async saveCommissionConfig(
    tenantId: string,
    accountId: string,
    payload: {
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
      repId?: number;
    },
  ): Promise<VanRepCommissionConfig> {
    const current = await this.getCommissionConfig(tenantId);
    if (payload.repId && Number(payload.repId) > 0) {
      const repKey = String(Number(payload.repId));
      const existingRep = current.repOverrides?.[repKey] || {};
      current.repOverrides = {
        ...(current.repOverrides || {}),
        [repKey]: {
          salesCommissionRatePercent:
            payload.salesCommissionRatePercent !== undefined
              ? Math.max(0, Number(payload.salesCommissionRatePercent))
              : existingRep.salesCommissionRatePercent,
          collectionCommissionRatePercent:
            payload.collectionCommissionRatePercent !== undefined
              ? Math.max(0, Number(payload.collectionCommissionRatePercent))
              : existingRep.collectionCommissionRatePercent,
          targetBonusRatePercent:
            payload.targetBonusRatePercent !== undefined
              ? Math.max(0, Number(payload.targetBonusRatePercent))
              : existingRep.targetBonusRatePercent,
        },
      };
    } else {
      if (payload.salesCommissionRatePercent !== undefined) {
        current.salesCommissionRatePercent = Math.max(0, Number(payload.salesCommissionRatePercent));
      }
      if (payload.collectionCommissionRatePercent !== undefined) {
        current.collectionCommissionRatePercent = Math.max(
          0,
          Number(payload.collectionCommissionRatePercent),
        );
      }
      if (payload.targetBonusRatePercent !== undefined) {
        current.targetBonusRatePercent = Math.max(0, Number(payload.targetBonusRatePercent));
      }
    }

    const serialized = JSON.stringify(current);
    const existingRow = await this.anyDb
      .selectFrom('settings')
      .select(['key'])
      .where('key', '=', 'van_rep_commission_config')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (existingRow) {
      await this.anyDb
        .updateTable('settings')
        .set({ value: serialized })
        .where('key', '=', 'van_rep_commission_config')
        .where('tenant_id', '=', tenantId)
        .execute();
    } else {
      await this.anyDb
        .insertInto('settings')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          key: 'van_rep_commission_config',
          value: serialized,
        })
        .execute();
    }

    return current;
  }

  private resolveRepCommissionRates(config: VanRepCommissionConfig, repId: number) {
    const ov = config.repOverrides?.[String(repId)];
    return {
      salesCommissionRatePercent:
        ov?.salesCommissionRatePercent !== undefined
          ? Number(ov.salesCommissionRatePercent)
          : config.salesCommissionRatePercent,
      collectionCommissionRatePercent:
        ov?.collectionCommissionRatePercent !== undefined
          ? Number(ov.collectionCommissionRatePercent)
          : config.collectionCommissionRatePercent,
      targetBonusRatePercent:
        ov?.targetBonusRatePercent !== undefined
          ? Number(ov.targetBonusRatePercent)
          : config.targetBonusRatePercent,
    };
  }

  private async getPaidCommissionsMapForMonth(
    tenantId: string,
    month: string,
  ): Promise<Map<number, number>> {
    // Book digits resolved once (D4): the accumulated commission sums
    // below round at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const map = new Map<number, number>();
    const rows = await this.anyDb
      .selectFrom('expenses')
      .select(['amount', 'note'])
      .where('tenant_id', '=', tenantId)
      .where('note', 'like', `%[REP_COMM:%:${month}]%`)
      .execute();

    for (const r of rows || []) {
      const noteStr = String(r.note || '');
      const m = noteStr.match(/\[REP_COMM:(\d+):([0-9]{4}-[0-9]{2})\]/);
      if (m && m[2] === month) {
        const rId = Number(m[1]);
        const amt = Number(r.amount || 0);
        if (rId > 0 && amt > 0) {
          map.set(rId, roundMoney((map.get(rId) || 0) + amt, moneyDigits));
        }
      }
    }
    return map;
  }

  /**
   * Sets or updates a representative's monthly sales, collection, and visits targets,
   * plus optional commission rate overrides.
   */
  async setRepTarget(
    tenantId: string,
    accountId: string,
    repId: number,
    periodMonth: string,
    targetAmount: number,
    collectionTarget?: number | null,
    visitsTarget?: number | null,
    commissionRates?: {
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
    },
  ) {
    // Book digits resolved once (D4): target amounts round at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const target = Math.max(0, roundMoney(Number(targetAmount || 0), moneyDigits));
    const colTarget = collectionTarget !== undefined && collectionTarget !== null && !isNaN(Number(collectionTarget))
      ? Math.max(0, roundMoney(Number(collectionTarget), moneyDigits))
      : null;
    const visTarget = visitsTarget !== undefined && visitsTarget !== null && !isNaN(Number(visitsTarget))
      ? Math.max(0, Math.round(Number(visitsTarget)))
      : null;

    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!rep) throw new AppError('المندوب غير موجود', 'REP_NOT_FOUND', 404);

    const existing = await this.anyDb
      .selectFrom('delivery_rep_targets')
      .select(['id'])
      .where('rep_id', '=', repId)
      .where('period_month', '=', periodMonth)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (existing) {
      await this.anyDb
        .updateTable('delivery_rep_targets')
        .set({
          target_amount: target,
          collection_target: colTarget,
          visits_target: visTarget,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', tenantId)
        .execute();
    } else {
      await this.anyDb
        .insertInto('delivery_rep_targets')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          rep_id: repId,
          period_month: periodMonth,
          target_amount: target,
          collection_target: colTarget,
          visits_target: visTarget,
        })
        .execute();
    }

    if (
      commissionRates &&
      (commissionRates.salesCommissionRatePercent !== undefined ||
        commissionRates.collectionCommissionRatePercent !== undefined ||
        commissionRates.targetBonusRatePercent !== undefined)
    ) {
      await this.saveCommissionConfig(tenantId, accountId, {
        repId,
        ...commissionRates,
      });
    }

    return this.getRepTarget(tenantId, repId, periodMonth);
  }

  /**
   * Gets computed target & commission metrics for a representative.
   */
  async getRepTarget(tenantId: string, repId: number, periodMonth?: string) {
    const now = new Date();
    const month = periodMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = month.split('-').map(Number);
    const startOfMonth = new Date(y, m - 1, 1);
    const endOfMonth = new Date(y, m, 0, 23, 59, 59);

    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'phone', 'vehicle_plate as vehiclePlate'])
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!rep) throw new AppError('المندوب غير موجود', 'REP_NOT_FOUND', 404);

    const targetRow = await this.anyDb
      .selectFrom('delivery_rep_targets')
      .select(['target_amount', 'collection_target', 'visits_target'])
      .where('rep_id', '=', repId)
      .where('period_month', '=', month)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    const targetAmount = Number(targetRow?.target_amount || 0);
    const collectionTarget = targetRow?.collection_target !== null && targetRow?.collection_target !== undefined
      ? Number(targetRow.collection_target)
      : null;
    const visitsTarget = targetRow?.visits_target !== null && targetRow?.visits_target !== undefined
      ? Number(targetRow.visits_target)
      : null;

    const salesMtdRow = await this.anyDb
      .selectFrom('sales')
      .select([sql<number>`coalesce(sum(cast(total as numeric)), 0)`.as('total_mtd')])
      .where('delivery_rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'posted')
      .where('created_at', '>=', startOfMonth)
      .where('created_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualSalesMtd = Number(salesMtdRow?.total_mtd || 0);

    const collectionsMtdRow = await this.anyDb
      .selectFrom('van_sales_trips')
      .select([sql<number>`coalesce(sum(cast(cash_collected as numeric)), 0)`.as('total_collected')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('opened_at', '>=', startOfMonth)
      .where('opened_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualCollections = Number(collectionsMtdRow?.total_collected || 0);

    const [visitsFieldRow, visitsStoreRow] = await Promise.all([
      this.anyDb
        .selectFrom('van_field_visits')
        .select([sql<number>`count(*)`.as('total_visits')])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('visited_at', '>=', startOfMonth)
        .where('visited_at', '<=', endOfMonth)
        .executeTakeFirst(),
      this.anyDb
        .selectFrom('van_store_visits')
        .select([sql<number>`count(*)`.as('total_visits')])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('check_in_at', '>=', startOfMonth)
        .where('check_in_at', '<=', endOfMonth)
        .executeTakeFirst(),
    ]);
    const actualVisits = Number(visitsFieldRow?.total_visits || 0) + Number(visitsStoreRow?.total_visits || 0);

    const [officialHolidays, commissionConfig, paidMap] = await Promise.all([
      getMonthlyOfficialHolidayDates(this.anyDb, tenantId, startOfMonth, endOfMonth),
      this.getCommissionConfig(tenantId),
      this.getPaidCommissionsMapForMonth(tenantId, month),
    ]);

    // Book digits for the target-tracking inputs (INV-REP-TARGET-METRICS-DIGITS).
    const metricsMoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const metrics = calculateRepTargetMetrics({
      targetAmount,
      actualSalesMTD: actualSalesMtd,
      collectionTarget,
      actualCollectionsMTD: actualCollections,
      visitsTarget,
      actualVisitsMTD: actualVisits,
      currentDate: now,
      weekendDays: [5], // Friday
      officialHolidays,
      moneyDigits: metricsMoneyDigits,
    });

    const rates = this.resolveRepCommissionRates(commissionConfig, repId);
    const commission = calculateRepCommissionMetrics({
      actualSales: actualSalesMtd,
      actualCollections,
      salesTarget: targetAmount,
      collectionTarget,
      salesCommissionRatePercent: rates.salesCommissionRatePercent,
      collectionCommissionRatePercent: rates.collectionCommissionRatePercent,
      targetBonusRatePercent: rates.targetBonusRatePercent,
      alreadyPaidAmount: paidMap.get(repId) || 0,
      moneyDigits: currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId)),
    });

    return {
      repId,
      repName: rep.name,
      phone: rep.phone,
      vehiclePlate: rep.vehiclePlate,
      metrics,
      collectionTarget,
      actualCollections,
      collectionAchievementRate: metrics.collectionAchievementRate,
      remainingCollection: metrics.remainingCollection,
      requiredDailyCollection: metrics.requiredDailyCollection,
      isCollectionAchieved: metrics.isCollectionAchieved,
      visitsTarget,
      actualVisits,
      visitsAchievementRate: metrics.visitsAchievementRate,
      remainingVisits: metrics.remainingVisits,
      requiredDailyVisits: metrics.requiredDailyVisits,
      isVisitsAchieved: metrics.isVisitsAchieved,
      commission,
      salesCommissionRatePercent: commission.salesCommissionRatePercent,
      collectionCommissionRatePercent: commission.collectionCommissionRatePercent,
      targetBonusRatePercent: commission.targetBonusRatePercent,
      salesCommissionAmount: commission.salesCommissionAmount,
      collectionCommissionAmount: commission.collectionCommissionAmount,
      targetBonusAmount: commission.targetBonusAmount,
      totalEarnedCommission: commission.totalEarnedCommission,
      alreadyPaidCommission: commission.alreadyPaidAmount,
      remainingPayableCommission: commission.remainingPayableCommission,
    };
  }

  /**
   * Lists all delivery representatives with their target & commission metrics for a given month.
   */
  async listAllRepTargets(tenantId: string, periodMonth?: string) {
    const now = new Date();
    const month = periodMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = month.split('-').map(Number);
    const startOfMonth = new Date(y, m - 1, 1);
    const endOfMonth = new Date(y, m, 0, 23, 59, 59);

    const reps = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'phone', 'vehicle_plate as vehiclePlate', 'rep_type as repType'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('name', 'asc')
      .execute();

    const targets = await this.anyDb
      .selectFrom('delivery_rep_targets')
      .select(['rep_id', 'target_amount', 'collection_target', 'visits_target'])
      .where('period_month', '=', month)
      .where('tenant_id', '=', tenantId)
      .execute();
    const targetMap = new Map<number, { targetAmount: number; collectionTarget: number | null; visitsTarget: number | null }>();
    for (const t of targets) {
      targetMap.set(Number(t.rep_id), {
        targetAmount: Number(t.target_amount || 0),
        collectionTarget: t.collection_target !== null && t.collection_target !== undefined ? Number(t.collection_target) : null,
        visitsTarget: t.visits_target !== null && t.visits_target !== undefined ? Number(t.visits_target) : null,
      });
    }

    const salesMtd = await this.anyDb
      .selectFrom('sales')
      .select(['delivery_rep_id', sql<number>`coalesce(sum(cast(total as numeric)), 0)`.as('total_mtd')])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'posted')
      .where('created_at', '>=', startOfMonth)
      .where('created_at', '<=', endOfMonth)
      .where(sql<boolean>`delivery_rep_id is not null`)
      .groupBy('delivery_rep_id')
      .execute();
    const salesMap = new Map<number, number>();
    for (const s of salesMtd) salesMap.set(Number(s.delivery_rep_id), Number(s.total_mtd || 0));

    const collectionsMtd = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['rep_id', sql<number>`coalesce(sum(cast(cash_collected as numeric)), 0)`.as('total_collected')])
      .where('tenant_id', '=', tenantId)
      .where('opened_at', '>=', startOfMonth)
      .where('opened_at', '<=', endOfMonth)
      .where(sql<boolean>`rep_id is not null`)
      .groupBy('rep_id')
      .execute();
    const collectionsMap = new Map<number, number>();
    for (const c of collectionsMtd) collectionsMap.set(Number(c.rep_id), Number(c.total_collected || 0));

    const [visitsFieldMtd, visitsStoreMtd] = await Promise.all([
      this.anyDb
        .selectFrom('van_field_visits')
        .select(['rep_id', sql<number>`count(*)`.as('total_visits')])
        .where('tenant_id', '=', tenantId)
        .where('visited_at', '>=', startOfMonth)
        .where('visited_at', '<=', endOfMonth)
        .where(sql<boolean>`rep_id is not null`)
        .groupBy('rep_id')
        .execute(),
      this.anyDb
        .selectFrom('van_store_visits')
        .select(['rep_id', sql<number>`count(*)`.as('total_visits')])
        .where('tenant_id', '=', tenantId)
        .where('check_in_at', '>=', startOfMonth)
        .where('check_in_at', '<=', endOfMonth)
        .where(sql<boolean>`rep_id is not null`)
        .groupBy('rep_id')
        .execute(),
    ]);
    const visitsMap = new Map<number, number>();
    for (const v of visitsFieldMtd) {
      visitsMap.set(Number(v.rep_id), (visitsMap.get(Number(v.rep_id)) || 0) + Number(v.total_visits || 0));
    }
    for (const v of visitsStoreMtd) {
      visitsMap.set(Number(v.rep_id), (visitsMap.get(Number(v.rep_id)) || 0) + Number(v.total_visits || 0));
    }

    const [officialHolidays, commissionConfig, paidMap] = await Promise.all([
      getMonthlyOfficialHolidayDates(this.anyDb, tenantId, startOfMonth, endOfMonth),
      this.getCommissionConfig(tenantId),
      this.getPaidCommissionsMapForMonth(tenantId, month),
    ]);
    // Derived here (not inside the sync map below) because the
    // commission call needs the tenant's book digits.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));

    return reps.map((r: any) => {
      const repId = Number(r.id);
      const repTargetInfo = targetMap.get(repId);
      const targetAmount = repTargetInfo?.targetAmount || 0;
      const collectionTarget = repTargetInfo?.collectionTarget ?? null;
      const visitsTarget = repTargetInfo?.visitsTarget ?? null;
      const actualSales = salesMap.get(repId) || 0;
      const actualCollections = collectionsMap.get(repId) || 0;
      const actualVisits = visitsMap.get(repId) || 0;

      const metrics = calculateRepTargetMetrics({
        targetAmount,
        actualSalesMTD: actualSales,
        collectionTarget,
        actualCollectionsMTD: actualCollections,
        visitsTarget,
        actualVisitsMTD: actualVisits,
        currentDate: now,
        weekendDays: [5],
        officialHolidays,
        moneyDigits,
      });

      const rates = this.resolveRepCommissionRates(commissionConfig, repId);
      const commission = calculateRepCommissionMetrics({
        actualSales,
        actualCollections,
        salesTarget: targetAmount,
        collectionTarget,
        salesCommissionRatePercent: rates.salesCommissionRatePercent,
        collectionCommissionRatePercent: rates.collectionCommissionRatePercent,
        targetBonusRatePercent: rates.targetBonusRatePercent,
        alreadyPaidAmount: paidMap.get(repId) || 0,
        moneyDigits,
      });

      return {
        repId,
        repName: r.name,
        phone: r.phone || '',
        vehiclePlate: r.vehiclePlate || '',
        repType: r.repType || 'van_sales',
        targetAmount,
        actualSales,
        achievementRate: metrics.achievementRate,
        remainingTarget: metrics.remainingTarget,
        remainingWorkingDays: metrics.remainingWorkingDays,
        requiredDailyTarget: metrics.requiredDailyTarget,
        isTargetAchieved: metrics.isTargetAchieved,
        collectionTarget,
        actualCollections,
        collectionAchievementRate: metrics.collectionAchievementRate,
        remainingCollection: metrics.remainingCollection,
        requiredDailyCollection: metrics.requiredDailyCollection,
        isCollectionAchieved: metrics.isCollectionAchieved,
        visitsTarget,
        actualVisits,
        visitsAchievementRate: metrics.visitsAchievementRate,
        remainingVisits: metrics.remainingVisits,
        requiredDailyVisits: metrics.requiredDailyVisits,
        isVisitsAchieved: metrics.isVisitsAchieved,
        commission,
        salesCommissionRatePercent: commission.salesCommissionRatePercent,
        collectionCommissionRatePercent: commission.collectionCommissionRatePercent,
        targetBonusRatePercent: commission.targetBonusRatePercent,
        salesCommissionAmount: commission.salesCommissionAmount,
        salesCommissionEarned: commission.salesCommissionAmount,
        collectionCommissionAmount: commission.collectionCommissionAmount,
        collectionCommissionEarned: commission.collectionCommissionAmount,
        targetBonusAmount: commission.targetBonusAmount,
        targetBonusEarned: commission.targetBonusAmount,
        totalEarnedCommission: commission.totalEarnedCommission,
        totalCommissionEarned: commission.totalEarnedCommission,
        alreadyPaidCommission: commission.alreadyPaidAmount,
        paidCommissionAmount: commission.alreadyPaidAmount,
        remainingPayableCommission: commission.remainingPayableCommission,
        remainingCommissionPayable: commission.remainingPayableCommission,
        isCommissionSettled: commission.remainingPayableCommission <= 0 && commission.totalEarnedCommission > 0,
      };
    });
  }

  /**
   * Settles and disburses a rep's earned monthly commission as an official expense & treasury voucher
   * with full double-entry accounting journal posting.
   */
  async settleRepCommission(
    tenantId: string,
    accountId: string,
    auth: AuthContext,
    payload: {
      repId: number;
      periodMonth: string;
      amount?: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    expenseId: number;
    paidAmount: number;
    remainingPayableCommission: number;
  }> {
    // Book digits resolved once, before the transaction below opens
    // (D4): the requested payout and remaining payable below round at
    // book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const repId = Number(payload.repId || 0);
    if (!repId || repId <= 0) {
      throw new AppError('يرجى تحديد المندوب لصرف العمولة', 'REP_REQUIRED', 400);
    }

    const repSummary = await this.getRepTarget(tenantId, repId, payload.periodMonth);
    const maxPayable = Number(repSummary.remainingPayableCommission || 0);

    if (maxPayable <= 0.009) {
      throw new AppError(
        'لا توجد عمولات مستحقة غير مصروفة لهذا المندوب عن هذا الشهر',
        'NO_PAYABLE_COMMISSION',
        400,
      );
    }

    const requestedAmount =
      payload.amount !== undefined && payload.amount !== null && Number(payload.amount) > 0
        ? roundMoney(Number(payload.amount), moneyDigits)
        : maxPayable;

    if (requestedAmount <= 0) {
      throw new AppError('مبلغ الصرف يجب أن يكون أكبر من الصفر', 'INVALID_COMMISSION_AMOUNT', 400);
    }

    // Rule 13 Invariant Ceiling: Never allow disbursing more than the remaining earned commission
    const effectivePayout = Math.min(requestedAmount, maxPayable);

    return await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      const primaryBranch = await trxAny
        .selectFrom('branches')
        .select(['id', 'default_stock_location_id'])
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      const branchId = primaryBranch?.id ? Number(primaryBranch.id) : null;
      const locationId = primaryBranch?.default_stock_location_id
        ? Number(primaryBranch.default_stock_location_id)
        : null;

      const title = `عمولات وحوافز مندوب توزيع - ${repSummary.repName} (${repSummary.metrics.periodMonth})`;
      const note = [
        `[REP_COMM:${repId}:${repSummary.metrics.periodMonth}]`,
        `عمولة مبيعات (${repSummary.salesCommissionRatePercent}%): ${repSummary.salesCommissionAmount}`,
        `عمولة تحصيل (${repSummary.collectionCommissionRatePercent}%): ${repSummary.collectionCommissionAmount}`,
        repSummary.targetBonusAmount > 0
          ? `مكافأة تحقيق الهدف (${repSummary.targetBonusRatePercent}%): ${repSummary.targetBonusAmount}`
          : '',
        payload.notes ? String(payload.notes).trim() : '',
      ]
        .filter(Boolean)
        .join(' | ');

      const insertedExpense = await trxAny
        .insertInto('expenses')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          title,
          amount: effectivePayout,
          expense_date: new Date().toISOString().slice(0, 10),
          note,
          branch_id: branchId,
          location_id: locationId,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      const expenseId = Number(insertedExpense.id);

      await trxAny
        .insertInto('treasury_transactions')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          txn_type: 'expense',
          amount: -effectivePayout,
          note: `${title} - ${note}`,
          reference_type: 'expense',
          reference_id: expenseId,
          branch_id: branchId,
          location_id: locationId,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .execute();

      if (this.accountingPosting) {
        await this.accountingPosting.postExpense(trx as any, expenseId, auth);
      }

      const remainingAfter = roundMoney(Math.max(0, maxPayable - effectivePayout), moneyDigits);
      return {
        ok: true,
        expenseId,
        paidAmount: effectivePayout,
        remainingPayableCommission: remainingAfter,
      };
    });
  }
}

