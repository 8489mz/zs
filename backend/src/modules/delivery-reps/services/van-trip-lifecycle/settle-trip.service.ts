import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../../core/audit/audit.service';
import { AppError } from '../../../../common/errors/app-error';
import { Database } from '../../../../database/database.types';
import { AccountingPostingService } from '../../../accounting/accounting-posting.service';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import {
  evaluateOdometerReadings,
  evaluateMakerCheckerSettlement,
  evaluateNightStockRetention,
  reconcileVanStockAudit,
} from '../../van-trip-reconciliation.engine';
import {
  allocateDayRemittance,
  normalizePerDayCash,
  parseSubmittedPerDayCash,
  sumPerDayCash,
  type PerDayCashInput,
} from '../../van-settlement-split.engine';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import {
  currencyMoneyDigits,
  roundMoney,
  type MoneyDigits,
} from '../../../accounting/engines/money-minor-units.engine';
import { computeCashDrawerVariance } from '../../../cash-drawer/helpers/cash-drawer.helper';
import { getTenantTimezone, normalizePgDateOnly, todayTenantDate } from '../../../../common/utils/tenant-timezone.util';
import type { VanTripLifecycleDeps } from './van-trip-types';
import type { SettlementHelpersService } from './settlement-helpers.service';

@Injectable()
export class SettleTripService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly moveVanStock: VanTripLifecycleDeps['moveVanStock'],
    private readonly moveVanPharmacyBatches: VanTripLifecycleDeps['moveVanPharmacyBatches'],
    private readonly moveVanInventoryBatches: VanTripLifecycleDeps['moveVanInventoryBatches'],
    private readonly deductVanSalePharmacyBatches: VanTripLifecycleDeps['deductVanSalePharmacyBatches'],
    private readonly deductVanSaleInventoryBatches: VanTripLifecycleDeps['deductVanSaleInventoryBatches'],
    private readonly resolveSystemAuthContext: VanTripLifecycleDeps['resolveSystemAuthContext'],
    private readonly recordSuspicionEvent: VanTripLifecycleDeps['recordSuspicionEvent'],
    private readonly computeTripDayBuckets: SettlementHelpersService['computeTripDayBuckets'],
    private readonly insertRepCashRemittanceRow: SettlementHelpersService['insertRepCashRemittanceRow'],
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Final audit and settlement of a van trip.
   * Can be executed by supervisor/cashier (with Maker-Checker check against the rep).
   * Performs physical stock audit, handles overnight stock (Night Stock), unloads inventory
   * to warehouse if requested, updates fleet vehicle odometer, and posts closing GL journals.
   */
  async settleTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      countedCash: number;
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: counted cash split per tenant
      // day. When absent, the rep's submitted declaration is used;
      // when neither exists and the trip spans days, the settle is
      // refused (SETTLEMENT_REQUIRES_PER_DAY_BREAKDOWN).
      perDayCash?: PerDayCashInput[];
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      nightStockApproved?: boolean;
      nightStockNotes?: string;
      endOdometer?: number;
      chargeStockVarianceToRep?: boolean;
      // INV-VAN-SELF-SETTLE-PIN-REQUIRED: whether the charge/waive
      // flag above was decided by a supervisor (admin settle path).
      // The driver path passes false: the rep's phone never decides
      // whether his own shortage is charged or waived. Callers that
      // pass neither (legacy direct callers) keep the old behavior.
      chargeStockVarianceDecidedBySupervisor?: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): HOW the
      // settlement was approved, and by WHOM when the approver is
      // identified. The driver controller passes both: 'account' +
      // the supervisor's user id when approval came from a login
      // password, 'shared_manager_pin' + null when it came from the
      // shared manager PIN (which belongs to no single user — the
      // trip then records supervisor_id NULL plus this method, never
      // a fabricated id). The admin console passes 'account' + its
      // own user id. Legacy direct callers pass neither: the method
      // is then 'unrecorded' and settled_by stays null.
      supervisorApprovalMethod?: 'shared_manager_pin' | 'account' | 'unrecorded';
      supervisorId?: number | null;
    },
    authContext?: AuthContext,
  ): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    // INV-VAN-DAILY-SPLIT-SETTLEMENT: the per-day split as settled
    // (one entry per day with counted cash, including zero days).
    dailySplit?: Array<{ businessDay: string; due: number; countedCash: number; remittedCash: number }>;
    tripExpenses?: number;
    variance: number;
    stockVarianceAmount: number;
    stockOverageAmount?: number;
    unloadedItemsCount: number;
    distanceKm: number;
    status: 'settled';
    cashierName?: string;
    cashierId?: number | null;
    repName?: string;
    settledAt?: string;
    salesAmount?: number;
    cashSales?: number;
    creditSales?: number;
    collectionsTotal?: number;
    returnsAmount?: number;
    cashRefunds?: number;
    creditReturns?: number;
    totalInstapaySales?: number;
    totalInstapayCollections?: number;
    expectedBankTransfers?: number;
    stockVariances?: any[];
  }> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .where('vt.status', '!=', 'settled')
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('الرحلة غير موجودة أو تم تصفيتها واعتمادها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    // Lookup rep details to check Maker-Checker against linked user
    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'phone'])
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the approver id.
    // An explicitly passed supervisorId wins — including an explicit
    // null, which means "shared-PIN approval, no identified
    // supervisor" and must NOT fall back to authContext.userId (the
    // driver controller builds that context with userId 0 in PIN
    // mode, because AuthContext.userId is number-typed; 0 is "no
    // user", never a user id, and every writer below guards it with
    // `> 0` / `|| null`). Without an explicit supervisorId, a real
    // session user id is the approver (admin console); with neither,
    // the approver is unknown (legacy direct call) and stays null.
    const hasExplicitSupervisor = payload.supervisorId !== undefined;
    const actorUserId = hasExplicitSupervisor
      ? payload.supervisorId != null && Number(payload.supervisorId) > 0
        ? Number(payload.supervisorId)
        : 0
      : authContext?.userId
        ? Number(authContext.userId)
        : 0;
    // The approval method, for the trip notes and the settlement
    // audit row: explicit when the caller recorded it, 'account'
    // when a named session settled it, 'unrecorded' otherwise.
    const supervisorApprovalMethod: 'shared_manager_pin' | 'account' | 'unrecorded' =
      payload.supervisorApprovalMethod ??
      (authContext?.userId && Number(authContext.userId) > 0 ? 'account' : 'unrecorded');
    const supervisorApprovalLabel =
      supervisorApprovalMethod === 'shared_manager_pin'
        ? 'اعتماد برمز المدير المشترك (لا مشرف محدَّد الهوية)'
        : supervisorApprovalMethod === 'account'
          ? 'اعتماد حساب مشرف محدَّد'
          : 'تصفية بلا سجل اعتماد مسجَّل';
    let repUserId: number | null = null;
    if (rep?.phone) {
      const linkedUser = await this.anyDb
        .selectFrom('users')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`(phone = ${String(rep.phone)} or username = ${String(rep.phone)})`)
        .executeTakeFirst();
      if (linkedUser?.id) repUserId = Number(linkedUser.id);
    }

    // M18: the posting identity for the settlement journal when no
    // session authContext exists (legacy direct call). Resolved here
    // on the pool handle, before the transaction below opens (P2
    // pattern — a pool read inside it deadlocks on PGlite); the
    // transaction uses the hoisted value. It prefers the acting
    // rep's linked login over the tenant's first active user.
    const fallbackSystemAuth = authContext ? null : await this.resolveSystemAuthContext(tenantId, accountId, repId);

    if (authContext) {
      const isSupervisor =
        ['admin', 'super_admin'].includes(authContext.role) ||
        (authContext.permissions &&
          authContext.permissions.some((p: string) => ['deliveryReps', 'accounting'].includes(p)));

      const makerChecker = evaluateMakerCheckerSettlement({
        repUserId,
        actorUserId,
        actorRole: authContext.role,
        isSupervisorOrAdmin: Boolean(isSupervisor),
      });

      if (!makerChecker.allowed) {
        await this.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          repName: rep?.name ? String(rep.name) : undefined,
          tripId: payload.tripId,
          eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
          severity: 'critical',
          titleAr: 'محاولة تصفية رحلة ذاتياً بدون صلاحية مشرف (خرق Maker-Checker)',
          detailsAr: makerChecker.errorMessageAr || 'حاول المندوب اعتماد وتصفية رحلته بنفسه دون مراجعة المشرف.',
          // M18: the actor attempting the self-settle is the rep —
          // his linked login, not the 0 the fabricated PIN-mode
          // context would have carried.
          actorUserId: repUserId ?? (actorUserId > 0 ? actorUserId : null),
          metadata: {
            reasonCode: makerChecker.reasonCode,
            actorUserId,
            repUserId,
          },
        });
        throw new AppError(makerChecker.errorMessageAr!, makerChecker.reasonCode!, 403);
      }
    }

    // INV-VAN-SELF-SETTLE-PIN-REQUIRED: the rep never decides whether
    // his own stock shortage is charged to him or waived to warehouse
    // losses. Only a supervisor's decision counts (admin settle path,
    // chargeStockVarianceDecidedBySupervisor === true). On the driver
    // path no supervisor charge/waive decision exists, so the shortage
    // stays pending on the rep (fail closed) until a supervisor settles
    // or waives it via settleRepFinancialItem — it is never silently
    // written off by the person charged. Legacy direct callers pass no
    // decision flag and keep the old behavior.
    const effectiveChargeToRep =
      payload.chargeStockVarianceDecidedBySupervisor === true
        ? Boolean(payload.chargeStockVarianceToRep)
        : payload.chargeStockVarianceDecidedBySupervisor === false
          ? true
          : Boolean(payload.chargeStockVarianceToRep);

    // Odometer validation
    const effectiveEndOdometer =
      payload.endOdometer !== undefined
        ? payload.endOdometer
        : trip.end_odometer !== null
          ? Number(trip.end_odometer)
          : undefined;
    const odometerResult = evaluateOdometerReadings({
      startOdometer: trip.start_odometer,
      endOdometer: effectiveEndOdometer,
    });
    if (!odometerResult.valid) {
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        repName: rep?.name ? String(rep.name) : undefined,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK,
        severity: 'high',
        titleAr: 'تلاعب في قراءة عداد الكيلومترات عند التصفية النهائية',
        detailsAr:
          odometerResult.errorMessageAr ||
          `قراءة العداد النهائية (${effectiveEndOdometer}) أقل من قراءة البداية (${trip.start_odometer}).`,
        // M18: the actor is the rep settling the trip.
        actorUserId: repUserId ?? (actorUserId > 0 ? actorUserId : null),
        metadata: {
          startOdometer: trip.start_odometer,
          endOdometer: effectiveEndOdometer,
        },
      });
      throw new AppError(odometerResult.errorMessageAr!, 'INVALID_ODOMETER', 400);
    }

    // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the money inputs below used
    // to be read here, on the pool handle before the transaction — a
    // sale, collection, or expense posted between this read and the
    // settlement commit settled the trip on stale cash. The inputs are
    // now re-read inside the transaction, under the trip row lock
    // (step 0 below), and only the locked values are ever used. The
    // pre-check trip read above stays for the rep/odometer fast-fail
    // only; it no longer feeds any money.
    let totalTripExpenses = 0;
    let grossCashCollected = 0;
    let expectedCash = 0;
    let cashVariance = 0;
    let bookDigits: MoneyDigits = 2;
    let lockedTripTotals: any = null;
    const countedCash = Number(payload.countedCash || 0);
    // INV-VAN-DAILY-SPLIT-SETTLEMENT: the settled per-day split, for
    // the return echo — assigned inside the transaction below.
    let settleDailySplit: Array<{ businessDay: string; due: number; countedCash: number; remittedCash: number }> = [];
    // INV-VAN-DAILY-SPLIT-SETTLEMENT: the tenant timezone is resolved
    // on the pool handle before the transaction (P2 pattern) — the
    // per-day buckets inside it derive tenant days from it.
    const tenantTimezone = await getTenantTimezone(this.anyDb, tenantId);
    let unloadedItemsCount = 0;
    let totalStockVarianceCost = 0;
    let totalStockOverageCost = 0;
    let totalUnloadedCost = 0;
    let stockAuditResult: ReturnType<typeof reconcileVanStockAudit> | null = null;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // 0. Re-read the trip row under lock and re-check its status inside
      // the transaction. The pre-check above runs on an unlocked read
      // outside any transaction, so two concurrent settles both pass it;
      // without this locked re-check both would run the stock deductions,
      // unload transfers, and trip update, while only the journal was
      // saved (postVanTripSettlement skips a duplicate by its SELECT
      // guard) — duplicated stock effects with no journal. The lock
      // serializes concurrent settlers: the second waits, then sees
      // 'settled' and fails closed instead of repeating the effects.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select([
          'id',
          'status',
          'van_location_id',
          'source_warehouse_id',
          'cash_collected',
          'vehicle_id',
          'sales_amount',
          'credit_sales',
          'returns_amount',
          'cash_refunds',
          'total_instapay_sales',
          'total_instapay_collections',
          'business_day',
          'submitted_per_day_cash',
        ])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip) {
        throw new AppError('الرحلة غير موجودة أو تم تصفيتها واعتمادها بالفعل', 'TRIP_NOT_FOUND', 404);
      }
      if (lockedTrip.status === 'settled') {
        throw new AppError('تم تصفية هذه الرحلة بالفعل؛ لا يمكن تصفيتها مرة أخرى', 'TRIP_ALREADY_SETTLED', 409);
      }

      // 0b. Re-read the money inputs inside the transaction, under the
      // lock above: the expenses total and the collected cash as of
      // this instant — never the pre-transaction snapshot. The
      // INV-VAN-SETTLE-BOOK-DIGITS-VARIANCE rule still applies: the
      // variance is computed at tenant book digits through the shared
      // drawer helper, exactly like submitTripSettlement, and the
      // expected side is rounded to book digits before the variance
      // is taken.
      bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      const lockedExpensesRow = await trxAny
        .selectFrom('van_trip_expenses')
        .select(sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('totalExpenses'))
        .where('trip_id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      totalTripExpenses = Number(lockedExpensesRow?.totalExpenses || 0);
      grossCashCollected = Number(lockedTrip.cash_collected || 0);
      lockedTripTotals = lockedTrip;
      expectedCash = roundMoney(grossCashCollected - totalTripExpenses, bookDigits);
      cashVariance = computeCashDrawerVariance(countedCash, expectedCash, bookDigits);

      // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day buckets, computed
      // inside the transaction from locked rows (F3) — never from an
      // unlocked read. The effective breakdown is the settler's
      // payload, else the rep's submitted declaration; a trip whose
      // activity spans more than one tenant day settles ONLY with a
      // breakdown, or the old lump sum re-enters through the back door.
      const dayBuckets = await this.computeTripDayBuckets(trxAny, tenantId, payload.tripId, tenantTimezone, bookDigits);
      const spannedDays = dayBuckets.filter((b) => b.hasActivity);
      let effectivePerDay: PerDayCashInput[] | null = null;
      if (payload.perDayCash !== undefined) {
        try {
          effectivePerDay = normalizePerDayCash(payload.perDayCash, bookDigits);
        } catch (e: any) {
          throw new AppError('تفصيل النقدية بالأيام غير صالح', String(e?.message || 'SETTLEMENT_PER_DAY_INVALID'), 400);
        }
      } else {
        try {
          effectivePerDay = parseSubmittedPerDayCash((lockedTrip as any).submitted_per_day_cash, bookDigits);
        } catch (e: any) {
          throw new AppError(
            'تفصيل النقدية بالأيام المحفوظ غير صالح',
            String(e?.message || 'SETTLEMENT_PER_DAY_INVALID'),
            400,
          );
        }
      }
      if (spannedDays.length > 1 && !effectivePerDay) {
        throw new AppError(
          'هذه الرحلة تمتد على أكثر من يوم؛ يجب إدخال النقدية المعدودة لكل يوم على حدة قبل التصفية',
          'SETTLEMENT_REQUIRES_PER_DAY_BREAKDOWN',
          400,
        );
      }
      if (effectivePerDay) {
        if (sumPerDayCash(effectivePerDay, bookDigits) !== roundMoney(countedCash, bookDigits)) {
          throw new AppError(
            'مجموع النقدية بالأيام لا يساوي إجمالي النقدية المعدودة',
            'SETTLEMENT_PER_DAY_MISMATCH',
            400,
          );
        }
        const spannedKeys = new Set(spannedDays.map((b) => b.businessDay));
        for (const day of effectivePerDay) {
          if (!spannedKeys.has(day.businessDay) && day.countedCash > 0) {
            throw new AppError(
              `لا توجد حركة نقدية في يوم ${day.businessDay} ضمن هذه الرحلة`,
              'SETTLEMENT_PER_DAY_UNKNOWN_DAY',
              400,
            );
          }
        }
        for (const b of spannedDays) {
          if (!effectivePerDay.some((d) => d.businessDay === b.businessDay)) {
            throw new AppError(
              `يوم ${b.businessDay} له حركة نقدية ولم يُدخل له مبلغ معدود`,
              'SETTLEMENT_PER_DAY_MISSING_DAY',
              400,
            );
          }
        }
      }

      // 1. Fetch current remaining van stock
      const vanLocationId = Number(lockedTrip.van_location_id);
      const remainingStocks = await trxAny
        .selectFrom('product_location_stock as pls')
        .innerJoin('products as p', 'p.id', 'pls.product_id')
        .select([
          'pls.id as stockLocationRecordId',
          'pls.product_id as productId',
          sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
          sql<string>`coalesce(p.name, '')`.as('name'),
          sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
          sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        ])
        .where('pls.location_id', '=', vanLocationId)
        .where('pls.tenant_id', '=', tenantId)
        .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
        .execute();

      // 2. Physical Stock Audit Reconciliation via pure engine
      const auditItems = remainingStocks.map((rs: any) => {
        const countedMatch = payload.countedStock?.find((cs) => Number(cs.productId) === Number(rs.productId));
        return {
          productId: Number(rs.productId),
          productName: rs.name,
          systemQty: Number(rs.qty),
          countedQty: countedMatch ? Number(countedMatch.countedQty) : undefined,
          costPrice: Number(rs.costPrice),
          retailPrice: Number(rs.retailPrice),
        };
      });

      const stockAuditDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      stockAuditResult = reconcileVanStockAudit(auditItems, stockAuditDigits);
      totalStockVarianceCost = stockAuditResult.totalStockShortageCost;
      totalStockOverageCost = stockAuditResult.totalStockOverageCost;

      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: an item nobody counted
      // is NOT certified balanced. Refuse the settle — inside the
      // transaction, before any stock deduction, journal, or trip
      // update — and name the uncounted products in the error so the
      // caller knows exactly what to count. There is no supervisor
      // bypass flag: the supervisor's explicit decision IS a physical
      // count (submit the verified countedQty for that product); a
      // flag certifying an unverified item as balanced would be the
      // same false certification this fix removes. A van with no
      // remaining stock has no uncounted items and settles normally.
      if (stockAuditResult.hasUncountedItems) {
        const names = stockAuditResult.uncountedItems.map((u) => `${u.productName} (#${u.productId})`).join('، ');
        throw new AppError(
          `لا يمكن تصفية الرحلة قبل اكتمال الجرد: الأصناف التالية لم تُعدّ بعد — ${names}. أعدّ كل صنف في السيارة (أو أكّد كميته بعد الفحص الفعلي) ثم أعد التصفية.`,
          'VAN_STOCK_AUDIT_INCOMPLETE',
          422,
        );
      }

      // Deduct missing stock items if shortage was detected
      for (const itemVariance of stockAuditResult.itemVariances) {
        if (itemVariance.status === 'shortage' && itemVariance.varianceQty < 0) {
          const shortageQty = Math.abs(itemVariance.varianceQty);
          await this.moveVanStock(trx, {
            productId: itemVariance.productId,
            delta: -shortageQty,
            locationId: vanLocationId,
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_stock_shortage',
            note: `عجز جرد سيارة توزيع - رحلة #${payload.tripId}`,
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: itemVariance.costPrice,
          });
          // INV-VAN-FEFO-BATCHES: missing stock leaves the van's batches too.
          // Never fail-closed here: the shortage itself is the variance being
          // settled, so deduct whatever batch cover exists.
          await this.deductVanSalePharmacyBatches(
            trx,
            itemVariance.productId,
            shortageQty,
            { tenantId, accountId },
            vanLocationId,
            false,
          );
          // INV-VAN-GENERIC-FEFO: the shortage leaves the van's generic
          // batches too; same never-fail-closed rule as above.
          await this.deductVanSaleInventoryBatches(
            trx,
            itemVariance.productId,
            shortageQty,
            { tenantId, accountId },
            vanLocationId,
            false,
          );
        }
      }

      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: mirror of the shortage
      // loop above. Overage units physically in the van are added to
      // van stock (movement 'van_stock_overage') so the system qty
      // matches the count; the added value is accounted by the
      // settlement journal (Dr 1140 / Cr 7100 in
      // postVanTripSettlement), never by a silent stock or income
      // increase. No pharmacy-batch move: found units carry no batch
      // identity to attach them to.
      for (const itemVariance of stockAuditResult.itemVariances) {
        if (itemVariance.status === 'overage' && itemVariance.varianceQty > 0) {
          await this.moveVanStock(trx, {
            productId: itemVariance.productId,
            delta: itemVariance.varianceQty,
            locationId: vanLocationId,
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_stock_overage',
            note: `زيادة جرد سيارة توزيع - رحلة #${payload.tripId}`,
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: itemVariance.costPrice,
          });
        }
      }

      // 3. Night Stock Governance
      const nightStockEval = evaluateNightStockRetention({
        unloadRemainingToWarehouse: payload.unloadRemainingToWarehouse,
        remainingItemsCount: remainingStocks.length,
        nightStockApproved: Boolean(payload.nightStockApproved),
        nightStockNotes: payload.nightStockNotes,
      });

      if (!nightStockEval.allowed) {
        throw new AppError(nightStockEval.errorMessageAr!, 'NIGHT_STOCK_UNAPPROVED', 422);
      }

      // 4. Unload remaining stock to warehouse if requested
      if (payload.unloadRemainingToWarehouse && remainingStocks.length > 0) {
        // Query remaining stock after any shortage deductions, sorted by product_id
        const postAuditStocks = await trxAny
          .selectFrom('product_location_stock as pls')
          .innerJoin('products as p', 'p.id', 'pls.product_id')
          .select([
            'pls.product_id as productId',
            sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
            sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
          ])
          .where('pls.location_id', '=', vanLocationId)
          .where('pls.tenant_id', '=', tenantId)
          .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
          .orderBy('pls.product_id', 'asc')
          .execute();

        for (const rem of postAuditStocks) {
          const pid = Number(rem.productId);
          const qty = Number(rem.qty);
          const cost = Number(rem.costPrice);
          if (qty <= 0) continue;

          // CANONICAL LOCK ORDER: Lock products first!
          await trxAny
            .selectFrom('products')
            .select(['id'])
            .where('id', '=', pid)
            .where('tenant_id', '=', tenantId)
            .forUpdate()
            .executeTakeFirst();

          // Out from van
          await this.moveVanStock(trx, {
            productId: pid,
            delta: -qty,
            locationId: vanLocationId,
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_unload_out',
            note: 'تصفية رحلة - خروج من السيارة',
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: cost,
          });

          // INV-VAN-FEFO-BATCHES: the batches return with the goods.
          await this.moveVanPharmacyBatches(
            trx,
            { tenantId, accountId },
            pid,
            qty,
            vanLocationId,
            Number(lockedTrip.source_warehouse_id),
          );
          // INV-VAN-GENERIC-FEFO: the generic batches return too.
          await this.moveVanInventoryBatches(
            trx,
            { tenantId, accountId },
            pid,
            qty,
            vanLocationId,
            Number(lockedTrip.source_warehouse_id),
          );

          // In to warehouse
          await this.moveVanStock(trx, {
            productId: pid,
            delta: qty,
            locationId: Number(lockedTrip.source_warehouse_id),
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_unload_in',
            note: 'تصفية رحلة - عودة للمستودع',
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: cost,
          });

          totalUnloadedCost += qty * cost;
          unloadedItemsCount++;
        }
      }

      // 5. Update vehicle current odometer if vehicle was tracked
      if (lockedTrip.vehicle_id && effectiveEndOdometer !== undefined) {
        await trxAny
          .updateTable('fleet_vehicles')
          .set({
            current_odometer: effectiveEndOdometer,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', Number(lockedTrip.vehicle_id))
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // 6. Update trip status to settled
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: stamp a legacy trip's day
      // when its activity falls on exactly one tenant day; a
      // multi-day legacy trip keeps its open day (its split lives in
      // the per-day rows below, not on the trip).
      const tripBusinessDay = (lockedTrip as any).business_day
        ? normalizePgDateOnly((lockedTrip as any).business_day)
        : spannedDays.length === 1
          ? spannedDays[0].businessDay
          : '';
      await trxAny
        .updateTable('van_sales_trips')
        .set({
          status: 'settled',
          settlement_status: 'settled',
          closed_at: sql`NOW()`,
          ...(tripBusinessDay ? { business_day: tripBusinessDay } : {}),
          settled_by: actorUserId || null,
          supervisor_id: actorUserId || null,
          stock_variance_amount: totalStockVarianceCost,
          stock_variance_details: stockAuditResult?.itemVariances?.length
            ? JSON.stringify(stockAuditResult.itemVariances)
            : null,
          night_stock_approved: Boolean(payload.nightStockApproved),
          night_stock_approved_by: payload.nightStockApproved ? actorUserId || null : null,
          night_stock_notes: payload.nightStockNotes || null,
          end_odometer: effectiveEndOdometer ?? null,
          distance_km: odometerResult.distanceKm,
          variance: cashVariance,
          notes: payload.notes
            ? `${payload.notes} — ${supervisorApprovalLabel}`
            : `تم إغلاق وتصفية رحلة التوزيع بنجاح. عجز/زيادة الكاش: ${cashVariance}، عجز المخزون: ${totalStockVarianceCost} — ${supervisorApprovalLabel}`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Record cash variance in rep financial ledger. The gate is
      // nonzero-at-book-digits (INV-VAN-SETTLE-BOOK-DIGITS-VARIANCE):
      // the old fixed 0.01 gate dropped real fils variances on
      // 3-decimal tenants. The 0.5 suspicion gate below is a currency
      // materiality policy and is deliberately unchanged.
      if (cashVariance < 0) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'cash_shortage',
            amount: Math.abs(cashVariance),
            status: 'pending',
            notes: `عجز كاش تصفية رحلة #${payload.tripId} (متوقع ${expectedCash} - مسلّم ${countedCash})`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      } else if (cashVariance > 0) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'cash_overage',
            amount: cashVariance,
            status: 'settled',
            settled_at: sql`NOW()`,
            settled_by: actorUserId || null,
            settlement_method: 'cash',
            notes: `فائض كاش تصفية رحلة #${payload.tripId} (متوقع ${expectedCash} - مسلّم ${countedCash})`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      }

      // Record stock shortage in rep financial ledger
      if (totalStockVarianceCost > 0.01) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'stock_shortage',
            amount: totalStockVarianceCost,
            status: effectiveChargeToRep ? 'pending' : 'waived',
            settled_at: effectiveChargeToRep ? null : sql`NOW()`,
            settled_by: effectiveChargeToRep ? null : actorUserId || null,
            settlement_method: effectiveChargeToRep ? null : 'waiver',
            notes: `عجز جرد بضاعة رحلة #${payload.tripId} ${effectiveChargeToRep ? '(محمل على المندوب)' : '(خسائر مستودع معفاة)'}`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      }

      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: record stock overage in
      // the rep financial ledger (mirror of the shortage row above).
      // It is settled at once — an overage is a recorded gain, never
      // a claim on the rep — so operators see it in the same ledger
      // where shortages appear, instead of only in the journal. The
      // 0.01 gate mirrors the shortage row's gate exactly.
      if (totalStockOverageCost > 0.01) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'stock_overage',
            amount: totalStockOverageCost,
            status: 'settled',
            settled_at: sql`NOW()`,
            settled_by: actorUserId || null,
            settlement_method: 'stock_audit',
            notes: `زيادة جرد بضاعة رحلة #${payload.tripId} (مسجلة كزيادة مخزنية، غير محملة على المندوب)`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      }

      // Auto-record / finish any ongoing active customer visit upon settlement
      if (payload.activeVisitCustomerId) {
        const custId = Number(payload.activeVisitCustomerId);
        if (custId > 0) {
          const existingVisit = await trxAny
            .selectFrom('van_field_visits')
            .select(['id'])
            .where('trip_id', '=', payload.tripId)
            .where('customer_id', '=', custId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();

          if (!existingVisit) {
            const custSale = await trxAny
              .selectFrom('sales')
              .select(['id'])
              .where('van_trip_id', '=', payload.tripId)
              .where('customer_id', '=', custId)
              .where('tenant_id', '=', tenantId)
              .executeTakeFirst();

            await trxAny
              .insertInto('van_field_visits')
              .values({
                tenant_id: tenantId,
                account_id: accountId,
                trip_id: payload.tripId,
                rep_id: repId,
                customer_id: custId,
                visit_type: custSale?.id ? 'positive' : 'negative',
                sale_id: custSale?.id ? Number(custSale.id) : null,
                negative_reason: custSale?.id ? null : 'other',
                notes: 'تم إنهاء وتوثيق الزيارة تلقائياً عند تصفية وإغلاق اليومية',
                visited_at: sql`NOW()`,
                created_at: sql`NOW()`,
              })
              .execute();
          }
        }
      }

      // 7. General Ledger Double-Entry Postings
      const vanLocRow = await trxAny
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', vanLocationId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
      // M18: the fallback identity was resolved before the transaction
      // above (P2 pattern); the in-transaction pool read is gone.
      const systemAuth = authContext || fallbackSystemAuth!;

      // Post van trip settlement (cash collected + shortage/overage + stock shortage allocation)
      await this.accountingPosting.postVanTripSettlement(
        trx,
        payload.tripId,
        {
          expectedCash,
          countedCash,
          tripExpenses: totalTripExpenses,
          branchId,
          locationId: vanLocationId,
          stockShortageAmount: totalStockVarianceCost,
          stockOverageAmount: totalStockOverageCost,
          chargeStockVarianceToRep: effectiveChargeToRep,
        },
        systemAuth,
      );

      // 7b. INV-REP-CASH-REMITTANCE-SHIFT: the counted cash the rep
      // physically hands over is drawer cash from here on — the
      // settlement journal above already debited 1110 for it — but no
      // shift's expected cash sees it until a treasury row links it
      // to the receiving shift. Write that row here, in the same
      // transaction as the journal, and post NO second GL leg:
      // postCashDrawerMovement must never run for a handover (it
      // would debit 1110 a second time and credit 7100 income for
      // rep cash). A settle with no counted cash writes no row. The
      // remittance row is written unconditionally once the posting
      // call returns: postVanTripSettlement's contract is
      // journalEntryId: number | null, and a null id with counted
      // cash > 0 is impossible in production (counted cash always
      // builds a 1110 line, so the posting either journals or
      // throws) — gating the row on the id would only break
      // callers that stub the posting, not protect the books.
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: one remittance row + one
      // 'cash_remittance' ledger row + allocation rows PER DAY. The
      // single-day / legacy shape keeps the old request key; an
      // explicit breakdown uses per-day keys. The trip journal above
      // stays one per trip — the split lives in treasury + ledger +
      // allocations only. A day with zero counted cash writes no rows.
      const remittanceDays: PerDayCashInput[] = effectivePerDay
        ? effectivePerDay.filter((d) => d.countedCash > 0)
        : [
            {
              businessDay:
                spannedDays.length === 1
                  ? spannedDays[0].businessDay
                  : normalizePgDateOnly((lockedTrip as any).business_day) || todayTenantDate(tenantTimezone),
              countedCash,
            },
          ];
      const dailySplitEcho: Array<{ businessDay: string; due: number; countedCash: number; remittedCash: number }> = [];
      for (const day of remittanceDays) {
        const remittedCash = roundMoney(day.countedCash, bookDigits);
        const bucket = dayBuckets.find((b) => b.businessDay === day.businessDay);
        const due = bucket ? bucket.due : 0;
        if (remittedCash <= 0) {
          dailySplitEcho.push({ businessDay: day.businessDay, due, countedCash: day.countedCash, remittedCash: 0 });
          continue;
        }
        await this.insertRepCashRemittanceRow(trx, {
          tenantId,
          accountId,
          tripId: payload.tripId,
          repName: rep?.name ? String(rep.name) : 'مندوب التوزيع',
          amount: remittedCash,
          branchId,
          actorUserId,
          createdBy: actorUserId > 0 ? actorUserId : systemAuth.userId ? Number(systemAuth.userId) : null,
          businessDay: effectivePerDay ? day.businessDay : undefined,
        });
        const insertedSettlement = await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'cash_remittance',
            amount: remittedCash,
            status: 'settled',
            business_day: day.businessDay,
            settled_at: sql`NOW()`,
            settled_by: actorUserId || null,
            settlement_method: 'cash',
            notes: `توريد نقدية مندوب يوم ${day.businessDay} — رحلة #${payload.tripId}`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();
        if (bucket) {
          const allocations = allocateDayRemittance(bucket, remittedCash, bookDigits);
          for (const alloc of allocations) {
            await trxAny
              .insertInto('settlement_allocations')
              .values({
                tenant_id: tenantId,
                settlement_id: Number(insertedSettlement.id),
                sale_id: alloc.saleId,
                customer_payment_id: alloc.customerPaymentId,
                amount: alloc.amount,
                business_day: alloc.businessDay,
                created_at: sql`NOW()`,
              })
              .execute();
          }
        }
        dailySplitEcho.push({ businessDay: day.businessDay, due, countedCash: day.countedCash, remittedCash });
      }
      settleDailySplit = dailySplitEcho;

      // Post unload stock transfer if items were returned to warehouse
      if (payload.unloadRemainingToWarehouse && totalUnloadedCost > 0) {
        await this.accountingPosting.postVanStockTransfer(
          trx,
          payload.tripId,
          {
            sourceLocationId: vanLocationId,
            targetLocationId: Number(lockedTrip.source_warehouse_id),
            totalCost: totalUnloadedCost,
            branchId,
            type: 'unload',
          },
          systemAuth,
        );
      }

      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): one audit row per
      // trip settlement, in this same transaction — a rolled-back
      // settlement leaves no audit trace, and a committed one always
      // has one. The actor is the identified approver (account-mode
      // supervisor or admin session); a shared-PIN approval records
      // created_by null and says so in the details, naming the rep
      // whose trip was settled — never a fabricated supervisor 0.
      // The function-check guards harnesses that pass a `{}` audit stub.
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'تسوية رحلة توزيع',
          `تمت تسوية رحلة التوزيع #${Number(payload.tripId)} للمندوب ${rep?.name ? String(rep.name) : `مندوب #${Number(repId)}`} (#${Number(repId)}) — متوقع ${expectedCash}، معدود ${countedCash}، فرق ${cashVariance}، عجز مخزون ${totalStockVarianceCost} — ${supervisorApprovalLabel}`,
          { userId: actorUserId > 0 ? actorUserId : null, tenantId, accountId },
          { eventCode: AUDIT_EVENT_CODES.VAN_TRIP_SETTLEMENT },
        );
      }
    });

    if (cashVariance < -0.5 || totalStockVarianceCost > 0.5) {
      const cashShortageAmount = cashVariance < 0 ? Math.abs(cashVariance) : 0;
      const totalShortage = roundMoney(cashShortageAmount + totalStockVarianceCost, bookDigits);
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        repName: rep?.name ? String(rep.name) : undefined,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE,
        severity: totalShortage >= 500 ? 'critical' : 'high',
        titleAr: 'رصد عجز نقدي أو مخزني عند تصفية رحلة التوزيع',
        detailsAr: `تم تصفية الرحلة #${payload.tripId} بعجز نقدي قدره (${cashShortageAmount.toFixed(2)}) وعجز بضاعة مفقودة بتكلفة (${totalStockVarianceCost.toFixed(2)}). إجمالي العجز المسجل على المندوب: (${totalShortage.toFixed(2)}).`,
        amountInvolved: totalShortage,
        // M18: the actor is the rep whose trip settled short.
        actorUserId: repUserId ?? (actorUserId > 0 ? actorUserId : null),
        metadata: {
          expectedCash,
          countedCash,
          cashVariance,
          stockVarianceAmount: totalStockVarianceCost,
          chargeStockVarianceToRep: effectiveChargeToRep,
        },
      });
    }

    // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the return echo reads the
    // locked row's aggregates (captured inside the transaction below),
    // never the pre-transaction snapshot.
    const salesAmount = Number(lockedTripTotals.sales_amount || 0);
    const creditSales = Number(lockedTripTotals.credit_sales || 0);
    const cashSales = Math.max(0, salesAmount - creditSales);
    const returnsAmount = Number(lockedTripTotals.returns_amount || 0);
    const cashRefunds = Number(lockedTripTotals.cash_refunds || 0);
    const creditReturns = Math.max(0, returnsAmount - cashRefunds);
    const collectionsTotal = Math.max(0, roundMoney(grossCashCollected - cashSales + cashRefunds, bookDigits));

    return {
      ok: true,
      tripId: payload.tripId,
      expectedCash,
      countedCash,
      dailySplit: settleDailySplit,
      tripExpenses: totalTripExpenses,
      variance: cashVariance,
      stockVarianceAmount: totalStockVarianceCost,
      stockOverageAmount: totalStockOverageCost,
      unloadedItemsCount,
      distanceKm: odometerResult.distanceKm,
      status: 'settled',
      cashierName: authContext?.username || 'أمين الخزينة',
      cashierId: actorUserId || null,
      repName: rep?.name ? String(rep.name) : 'مندوب التوزيع',
      settledAt: new Date().toISOString(),
      salesAmount,
      cashSales,
      creditSales,
      collectionsTotal,
      returnsAmount,
      cashRefunds,
      creditReturns,
      totalInstapaySales: Number(lockedTripTotals.total_instapay_sales || 0),
      totalInstapayCollections: Number(lockedTripTotals.total_instapay_collections || 0),
      expectedBankTransfers: roundMoney(
        Number(lockedTripTotals.total_instapay_sales || 0) + Number(lockedTripTotals.total_instapay_collections || 0),
        bookDigits,
      ),
      stockVariances: (stockAuditResult as any)?.itemVariances || [],
    };
  }
}
