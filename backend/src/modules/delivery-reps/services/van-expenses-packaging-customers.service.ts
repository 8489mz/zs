/*
 * Trip expenses, returnable packaging + driver customers (van-sales split-4
 * out of VanSalesService).
 * Pure move: the 9 expense / packaging / customer methods, unchanged,
 * behind the VanSalesService delegating facade. The facade owns the shared
 * helpers; this service receives them bound via
 * VanExpensesPackagingCustomersDeps, so the moved bodies are byte-identical
 * to the originals. The accessor in the facade is LAZY-ONLY by design (S2
 * pattern): verifySupervisorPin is mocked by specs after construction, so
 * the binding must happen on first delegate call, never in the ctor.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { evaluateTripExpenseGovernance } from '../van-trip-reconciliation.engine';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import {
  formatCustomerCode,
  getCustomerRepBalancesMap,
  normalizeCustomerCode,
  resolveVanMoneyAuditActor,
} from './van-common.util';
import {
  extractAssignedRepIds,
  loadRepPermissions,
  resolveIsolatedRepCustomerBalance,
} from '../rep-target.engine';
import { DAY_KEY_TO_ARABIC, normalizeDayKey } from '../van-routes-schedule.util';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { type RecordVanSuspicionParams } from './van-fraud-radar.service';

export type VanExpensesPackagingCustomersDeps = {
  db: Kysely<Database>;
  audit: AuditService;
  verifySupervisorPin: (tenantId: string, pinInput?: string | null, repId?: number | null, queryable?: any, accountId?: string | null) => Promise<{ approved: boolean; supervisorId?: number; supervisorName?: string; supervisorRole?: string; approvalMode?: 'pin' | 'account' }>;
  recordSuspicionEvent: (params: RecordVanSuspicionParams) => Promise<void>;
  assertTripOwnedByRep: (tenantId: string, tripId: number, repId: number) => Promise<void>;
  assertRepServedCustomer: (tenantId: string, repId: number, customerId: number) => Promise<void>;
  getOrCreateVanLocation: (repId: number, tenantId: string, accountId: string) => Promise<{ id: number; name: string }>;
  resolveRepLinkedUserId: (dbConn: any, tenantId: string, repId: number | null) => Promise<number | null>;
};

@Injectable()
export class VanExpensesPackagingCustomersService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly verifySupervisorPin: VanExpensesPackagingCustomersDeps['verifySupervisorPin'];
  private readonly recordSuspicionEvent: VanExpensesPackagingCustomersDeps['recordSuspicionEvent'];
  private readonly assertTripOwnedByRep: VanExpensesPackagingCustomersDeps['assertTripOwnedByRep'];
  private readonly assertRepServedCustomer: VanExpensesPackagingCustomersDeps['assertRepServedCustomer'];
  private readonly getOrCreateVanLocation: VanExpensesPackagingCustomersDeps['getOrCreateVanLocation'];
  private readonly resolveRepLinkedUserId: VanExpensesPackagingCustomersDeps['resolveRepLinkedUserId'];

  constructor(deps: VanExpensesPackagingCustomersDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.verifySupervisorPin = deps.verifySupervisorPin;
    this.recordSuspicionEvent = deps.recordSuspicionEvent;
    this.assertTripOwnedByRep = deps.assertTripOwnedByRep;
    this.assertRepServedCustomer = deps.assertRepServedCustomer;
    this.getOrCreateVanLocation = deps.getOrCreateVanLocation;
    this.resolveRepLinkedUserId = deps.resolveRepLinkedUserId;
  }

  private get anyDb(): any {
    return this.db as any;
  }

  // =========================================================================
  // TRIP OPERATIONAL EXPENSES (Fuel, Tolls, Road Maintenance, Tips)
  // =========================================================================

  /**
   * Records an operational trip expense (fuel, toll, maintenance, tips, meals).
   */
  async recordTripExpense(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      expenseType: 'fuel' | 'toll' | 'maintenance' | 'tips' | 'meals' | 'other' | string;
      amount: number;
      notes?: string;
      receiptPhotoUrl?: string;
      supervisorOverridePin?: string;
    },
    authContext?: AuthContext,
  ): Promise<{ ok: boolean; expenseId: number; totalTripExpenses: number }> {
    if (!payload.amount || Number(payload.amount) <= 0) {
      throw new AppError('مبلغ المصروف يجب أن يكون أكبر من الصفر', 'INVALID_EXPENSE_AMOUNT', 400);
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'status'])
      .where('id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') {
      throw new AppError('لا يمكن تسجيل مصروفات على رحلة مغلقة أو غير موجودة', 'INVALID_TRIP', 400);
    }

    const existingSumRow = await this.anyDb
      .selectFrom('van_trip_expenses')
      .select(sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('totalExpenses'))
      .where('trip_id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    const existingTripExpenses = Number(existingSumRow?.totalExpenses || 0);

    let supervisorApproved = false;
    let approvedSupervisorId: number | undefined = undefined;
    let approvedSupervisorName: string | undefined = undefined;

    if (payload.supervisorOverridePin) {
      const pinCheck = await this.verifySupervisorPin(tenantId, payload.supervisorOverridePin, repId, undefined, accountId);
      supervisorApproved = pinCheck.approved;
      approvedSupervisorId = pinCheck.supervisorId;
      approvedSupervisorName = pinCheck.supervisorName;
    }

    // Book digits resolved once (D4) and passed to the governance engine.
    const expenseDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const governance = evaluateTripExpenseGovernance({
      moneyDigits: expenseDigits,
      expenseType: payload.expenseType || 'other',
      amount: Number(payload.amount),
      notes: payload.notes,
      existingTripExpenses,
      supervisorOverride: supervisorApproved
        ? {
            approved: true,
            supervisorId: approvedSupervisorId,
            supervisorName: approvedSupervisorName,
          }
        : undefined,
    });

    if (!governance.allowed) {
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_EXPENSE_ABUSE,
        severity: 'high',
        titleAr: 'محاولة تسجيل مصروف طريق مخالف لسقف الحوكمة',
        detailsAr:
          governance.errorMessageAr ||
          `حاول المندوب تسجيل مصروف (${payload.expenseType}) بمبلغ (${payload.amount}) يتجاوز السقف المعتمد بدون كود مشرف.`,
        amountInvolved: Number(payload.amount),
        // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the actor is the
        // rep recording the expense — his linked login, or the named
        // session caller when one exists.
        actorUserId:
          authContext?.userId && Number(authContext.userId) > 0
            ? Number(authContext.userId)
            : await this.resolveRepLinkedUserId(this.anyDb, tenantId, repId),
        metadata: {
          expenseType: payload.expenseType,
          amount: Number(payload.amount),
          existingTripExpenses,
          reasonCode: governance.reasonCode,
        },
      });
      throw new AppError(
        governance.errorMessageAr || 'تم رفض تسجيل المصروف الميداني',
        governance.reasonCode || 'EXPENSE_GOVERNANCE_REJECTED',
        governance.requiresSupervisorPin ? 403 : 400,
      );
    }

    const createdByUserId = approvedSupervisorId ?? (authContext?.userId ? Number(authContext.userId) : null);
    const finalNotes = approvedSupervisorName
      ? `${String(payload.notes || '').trim()} [اعتماد مشرف: ${approvedSupervisorName}]`
      : String(payload.notes || '').trim() || null;

    const [inserted] = await this.anyDb
      .insertInto('van_trip_expenses')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId,
        expense_type: payload.expenseType || 'other',
        amount: Number(payload.amount),
        notes: finalNotes,
        receipt_photo_url: payload.receiptPhotoUrl || null,
        created_by_user_id: createdByUserId,
      })
      .returning(['id'])
      .execute();

    const sumRow = await this.anyDb
      .selectFrom('van_trip_expenses')
      .select(sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('totalExpenses'))
      .where('trip_id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): one audit row per
    // trip expense, naming the rep who recorded it (his linked login;
    // a named session caller wins when one exists). A supervisor-PIN
    // approval is recorded in the details, not as the actor — the
    // approver did not record the expense. The function-check guards
    // harnesses that pass a `{}` audit stub.
    if (this.audit && typeof this.audit.log === 'function') {
      const auditActor = await resolveVanMoneyAuditActor(
        this.anyDb,
        tenantId,
        repId,
        authContext?.userId && Number(authContext.userId) > 0 ? Number(authContext.userId) : null,
      );
      await this.audit.log(
        'مصروف رحلة توزيع',
        `سجّل المندوب ${auditActor.repName} (#${Number(repId)}) مصروف ${payload.expenseType} بقيمة ${Number(payload.amount)} على الرحلة #${Number(payload.tripId)} (إجمالي مصروفات الرحلة ${Number(sumRow?.totalExpenses || 0)})${approvedSupervisorName ? ` — باعتماد المشرف ${approvedSupervisorName}` : ''}`,
        { userId: auditActor.userId, tenantId, accountId },
        { eventCode: AUDIT_EVENT_CODES.VAN_TRIP_EXPENSE },
      );
    }

    return {
      ok: true,
      expenseId: Number(inserted.id),
      totalTripExpenses: Number(sumRow?.totalExpenses || 0),
    };
  }

  /**
   * Retrieves all recorded trip expenses for a van trip.
   */
  async getTripExpenses(tripId: number, tenantId: string, repId?: number) {
    // Book digits resolved once (D4): the expenses total below rounds
    // at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    if (repId != null) {
      await this.assertTripOwnedByRep(tenantId, tripId, repId);
    }
    const rows = await this.anyDb
      .selectFrom('van_trip_expenses as te')
      .leftJoin('users as u', 'u.id', 'te.created_by_user_id')
      .select([
        'te.id',
        'te.trip_id as tripId',
        'te.expense_type as expenseType',
        sql<number>`cast(te.amount as numeric)`.as('amount'),
        'te.notes',
        'te.receipt_photo_url as receiptPhotoUrl',
        'te.created_at as createdAt',
        sql<string>`coalesce(u.display_name, u.username)`.as('createdByName'),
      ])
      .where('te.trip_id', '=', tripId)
      .where('te.tenant_id', '=', tenantId)
      .orderBy('te.created_at', 'desc')
      .execute();

    const total = rows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
    return {
      expenses: rows.map((r: any) => ({
        id: Number(r.id),
        tripId: Number(r.tripId),
        expenseType: r.expenseType,
        amount: Number(r.amount),
        notes: r.notes || '',
        receiptPhotoUrl: r.receiptPhotoUrl || null,
        createdAt: r.createdAt,
        createdByName: r.createdByName || null,
      })),
      totalExpenses: roundMoney(total, moneyDigits),
    };
  }

  // =========================================================================
  // RETURNABLE PACKAGING & EMPTIES LEDGER (Crates, Bottles, Pallets, Gas Cylinders)
  // =========================================================================

  /**
   * Records movement in the returnable packaging & empties ledger.
   */
  async recordPackagingMovement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      packageType: 'crate_plastic' | 'box_wooden' | 'bottle_glass' | 'cylinder_gas' | 'pallet' | string;
      deliveredQty: number;
      returnedQty: number;
      notes?: string;
    },
  ): Promise<{ ok: boolean; movementId: number }> {
    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): the trip must be the
    // caller's own — the repId parameter this method already carried
    // was never used, while the read side (getTripPackagingMovements)
    // already gated on it. No rep_id column is added: trip_id already
    // determines ownership deterministically (van_sales_trips.rep_id),
    // and the read side gates on the same trip — a redundant column
    // would duplicate that fact and need a backfill. The customerId
    // rides inside the owned trip; the customer-balance read stays
    // gated by assertRepServedCustomer, so a stray customerId cannot
    // leak another rep's customer data.
    await this.assertTripOwnedByRep(tenantId, payload.tripId, repId);

    const delivered = Math.max(0, Number(payload.deliveredQty || 0));
    const returned = Math.max(0, Number(payload.returnedQty || 0));

    if (delivered === 0 && returned === 0) {
      throw new AppError('يجب تسجيل كمية مسلمة أو مستلمة واحدة على الأقل', 'EMPTY_PACKAGING_QTY', 400);
    }

    const [inserted] = await this.anyDb
      .insertInto('van_trip_packaging_movements')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId,
        customer_id: payload.customerId ? Number(payload.customerId) : null,
        package_type: payload.packageType || 'crate_plastic',
        delivered_qty: delivered,
        returned_qty: returned,
        notes: payload.notes || null,
      })
      .returning(['id'])
      .execute();

    return {
      ok: true,
      movementId: Number(inserted.id),
    };
  }

  /**
   * Retrieves packaging movements for a van trip.
   */
  async getTripPackagingMovements(tripId: number, tenantId: string, repId?: number) {
    if (repId != null) {
      await this.assertTripOwnedByRep(tenantId, tripId, repId);
    }
    const rows = await this.anyDb
      .selectFrom('van_trip_packaging_movements as pm')
      .leftJoin('customers as c', 'c.id', 'pm.customer_id')
      .select([
        'pm.id',
        'pm.package_type as packageType',
        'pm.delivered_qty as deliveredQty',
        'pm.returned_qty as returnedQty',
        'pm.notes',
        'pm.created_at as createdAt',
        'c.id as customerId',
        'c.name as customerName',
      ])
      .where('pm.trip_id', '=', tripId)
      .where('pm.tenant_id', '=', tenantId)
      .orderBy('pm.created_at', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      packageType: r.packageType,
      deliveredQty: Number(r.deliveredQty || 0),
      returnedQty: Number(r.returnedQty || 0),
      netBalance: Number(r.deliveredQty || 0) - Number(r.returnedQty || 0),
      notes: r.notes || '',
      createdAt: r.createdAt,
      customerId: r.customerId ? Number(r.customerId) : null,
      customerName: r.customerName || null,
    }));
  }

  /**
   * Retrieves customer returnable packaging balance summary across all trips.
   *
   * INV-DRIVER-PORTAL-REP-SCOPED-READS-FOLLOWUP: the driver-portal read is
   * scoped through the same assertRepServedCustomer predicate C1 used for
   * the other customer reads. Staff callers pass no repId and skip the check.
   */
  async getCustomerPackagingBalance(customerId: number, tenantId: string, repId?: number) {
    if (repId != null) {
      await this.assertRepServedCustomer(tenantId, repId, customerId);
    }
    const rows = await this.anyDb
      .selectFrom('van_trip_packaging_movements')
      .select([
        'package_type as packageType',
        sql<number>`cast(coalesce(sum(delivered_qty), 0) as numeric)`.as('totalDelivered'),
        sql<number>`cast(coalesce(sum(returned_qty), 0) as numeric)`.as('totalReturned'),
      ])
      .where('customer_id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .groupBy('package_type')
      .execute();

    return rows.map((r: any) => ({
      packageType: r.packageType,
      totalDelivered: Number(r.totalDelivered || 0),
      totalReturned: Number(r.totalReturned || 0),
      netOwedToCompany: Number(r.totalDelivered || 0) - Number(r.totalReturned || 0),
    }));
  }

  /**
   * Driver creates a new field customer directly into their itinerary and customer database.
   */
  async createDriverCustomer(
    repId: number,
    tenantId: string,
    accountId: string,
    body: {
      name: string;
      phone?: string;
      address?: string;
      district?: string;
      route?: string;
      notes?: string;
      visitDays?: string[];
      metadata?: any;
    },
  ) {
    const name = String(body.name || '').trim();
    if (!name) {
      throw new AppError('اسم المحل أو العميل مطلوب', 'CUSTOMER_NAME_REQUIRED', 400);
    }

    // H9 (D4): field customer creation is gated on the acting rep's
    // can_add_customers flag. The gate runs before any read or write
    // on the customer, so a forbidden rep cannot even link himself to
    // an existing customer through this path.
    const repFlags = await loadRepPermissions(this.anyDb, tenantId, repId);
    if (!repFlags.can_add_customers) {
      throw new AppError(
        'صلاحية إنشاء العملاء (can_add_customers) مغلقة لهذا المندوب، فلا يمكنه إنشاء عميل جديد ميدانياً',
        'REP_CANNOT_ADD_CUSTOMERS',
        403,
      );
    }

    const district = (body.district || body.metadata?.district || '').trim();
    const route = (body.route || body.metadata?.route || '').trim();
    const phone = (body.phone || '').trim();
    const address = (body.address || district || '').trim();

    const rawDays = body.visitDays || body.metadata?.visit_days || body.metadata?.visitDays || (body.metadata?.visit_day ? [body.metadata.visit_day] : []);
    const normalizedDays = Array.isArray(rawDays)
      ? rawDays.map((d: string) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d).filter(Boolean)
      : [];
    const visit_days = normalizedDays;
    const visit_day = normalizedDays[0] || '';

    const metadata = {
      district: district || undefined,
      route: route || undefined,
      assigned_rep_id: repId,
      assigned_rep_ids: [repId],
      created_by_rep_id: repId,
      visit_days,
      visit_day,
      ...(body.metadata || {}),
    };

    const cleanPhone = phone ? phone.replace(/[\s-]/g, '') : '';
    let existing: any = null;
    if (cleanPhone) {
      existing = await this.anyDb
        .selectFrom('customers')
        .where('tenant_id', '=', tenantId)
        .where((eb: any) =>
          eb.or([
            eb('phone', '=', cleanPhone),
            eb('phone', '=', phone),
          ]),
        )
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .executeTakeFirst();
    }

    if (!existing) {
      existing = await this.anyDb
        .selectFrom('customers')
        .where('tenant_id', '=', tenantId)
        .where('name', '=', name)
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .executeTakeFirst();
    }

    if (existing) {
      let existingMeta: any = {};
      if (typeof existing.metadata === 'string') {
        try { existingMeta = JSON.parse(existing.metadata); } catch { existingMeta = {}; }
      } else if (existing.metadata && typeof existing.metadata === 'object') {
        existingMeta = existing.metadata;
      }

      const assignedRepIds = extractAssignedRepIds(existingMeta);
      if (!assignedRepIds.includes(Number(repId))) {
        assignedRepIds.push(Number(repId));
      }

      const existingVisitDays: string[] = Array.isArray(existingMeta.visit_days)
        ? existingMeta.visit_days
        : [];
      const mergedDays = Array.from(new Set([...existingVisitDays, ...visit_days]));
      const custCode = normalizeCustomerCode(existingMeta.customer_code || existingMeta.code, existing.id);

      const updatedMetadata = {
        ...existingMeta,
        assigned_rep_id: existingMeta.assigned_rep_id || repId,
        assigned_rep_ids: assignedRepIds,
        route: route || existingMeta.route,
        district: district || existingMeta.district,
        visit_days: mergedDays,
        visit_day: mergedDays[0] || existingMeta.visit_day || '',
        customer_code: custCode,
        code: custCode,
      };

      await this.anyDb
        .updateTable('customers')
        .set({ metadata: JSON.stringify(updatedMetadata) })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      const existingId = Number(existing.id);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
      const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
        customerIds: [existingId],
        customerTotalBalances: { [existingId]: Number(existing.balance || 0) },
        moneyDigits,
      });
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: Number(repId),
        breakdown: repBalancesMap.get(existingId),
        assignedRepIds,
        fallbackTotalBalance: Number(existing.balance || 0),
        moneyDigits,
      });

      return {
        ok: true,
        alreadyExisted: true,
        message: `المحل مسجل مسبقاً بكود [${custCode}] (${existing.name}) وتم ربطه بخط سيرك بنجاح (رصيدك المستقل معه: ${isolated.repBalance} ج.م)`,
        customer: {
          id: existingId,
          name: existing.name,
          phone: existing.phone,
          address: existing.address,
          balance: isolated.repBalance,
          totalCompanyBalance: isolated.totalCustomerBalance,
          customerCode: custCode,
          metadata: updatedMetadata,
        },
      };
    }

    const inserted = await this.anyDb
      .insertInto('customers')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name,
        phone,
        address,
        balance: 0,
        customer_type: 'cash',
        credit_limit: 0,
        store_credit_balance: 0,
        metadata: JSON.stringify(metadata),
        is_active: true,
      })
      .returning(['id', 'name', 'phone', 'address', 'balance'])
      .executeTakeFirstOrThrow();

    const customerCode = formatCustomerCode(inserted.id);
    const finalizedMetadata = {
      ...metadata,
      customer_code: customerCode,
      code: customerCode,
    };

    await this.anyDb
      .updateTable('customers')
      .set({ metadata: JSON.stringify(finalizedMetadata) })
      .where('id', '=', inserted.id)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      ok: true,
      alreadyExisted: false,
      customer: {
        id: Number(inserted.id),
        name: inserted.name,
        phone: inserted.phone,
        address: inserted.address,
        balance: 0,
        customerCode,
        metadata: finalizedMetadata,
      },
    };
  }

  // =========================================================================
  // FIELD WHOLESALE DOMINANCE: SUGGESTED ORDER & RE-ORDER
  // =========================================================================

  async getCustomerSuggestedOrder(tenantId: string, accountId: string, repId: number, customerId: number) {
    // INV-DRIVER-PORTAL-REP-SCOPED-READS-FOLLOWUP: the scope check runs
    // BEFORE the van location resolution. getOrCreateVanLocation inserts a
    // stock_locations row when the rep has none, and a forbidden read must
    // not create rows. The repId here is the calling rep (the driver route
    // passes the verified token's repId; there is no staff route), so the
    // same assertRepServedCustomer predicate C1 used applies verbatim.
    await this.assertRepServedCustomer(tenantId, repId, customerId);
    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);

    const recentSales = await this.anyDb
      .selectFrom('sales')
      .select(['id', 'doc_no', 'created_at'])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('status', 'in', ['posted', 'completed'])
      .orderBy('id', 'desc')
      .limit(3)
      .execute();

    if (!recentSales.length) {
      return {
        ok: true,
        customerId,
        lastOrderDocNo: null,
        lastOrderDate: null,
        items: [],
        hasPreviousOrders: false,
      };
    }

    const latestSaleId = Number(recentSales[0].id);
    const latestDocNo = String(recentSales[0].doc_no || '');
    const latestDate = recentSales[0].created_at;

    const saleItems = await this.anyDb
      .selectFrom('sale_items as si')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .leftJoin('packaging_units as pu', 'pu.id', 'p.packaging_unit_id')
      .select([
        'si.product_id as productId',
        sql<string>`coalesce(si.product_name, p.name, '')`.as('productName'),
        sql<number>`cast(coalesce(si.quantity, 0) as numeric)`.as('qty'),
        sql<number>`cast(coalesce(si.unit_price, 0) as numeric)`.as('unitPrice'),
        sql<string>`coalesce(si.unit_name, pu.name, 'قطعة')`.as('unitName'),
        sql<number>`cast(coalesce(si.unit_multiplier, 1) as numeric)`.as('unitMultiplier'),
        'p.barcode',
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
      ])
      .where('si.sale_id', '=', latestSaleId)
      .where('si.tenant_id', '=', tenantId)
      .execute();

    const productIds = saleItems.map((it: any) => Number(it.productId)).filter((id: number) => id > 0);
    const vanStocksMap = new Map<number, number>();

    if (productIds.length > 0) {
      const vanStocks = await this.anyDb
        .selectFrom('product_location_stock')
        .select(['product_id', sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', vanLoc.id)
        .where('tenant_id', '=', tenantId)
        .where('product_id', 'in', productIds)
        .execute();

      for (const vs of vanStocks) {
        vanStocksMap.set(Number(vs.product_id), Number(vs.qty || 0));
      }
    }

    const items = saleItems.map((it: any) => {
      const pid = Number(it.productId);
      const availableVanQty = vanStocksMap.get(pid) || 0;
      return {
        productId: pid,
        productName: String(it.productName || `صنف #${pid}`),
        suggestedQty: Number(it.qty || 1),
        unitPrice: Number(it.unitPrice || it.retailPrice || 0),
        unitName: String(it.unitName || 'قطعة'),
        unitMultiplier: Number(it.unitMultiplier || 1),
        barcode: it.barcode || null,
        availableVanQty,
        isAvailableInVan: availableVanQty > 0,
      };
    });

    return {
      ok: true,
      customerId,
      lastOrderDocNo: latestDocNo,
      lastOrderDate: latestDate,
      hasPreviousOrders: true,
      items,
    };
  }

  // =========================================================================
  // FIELD WHOLESALE DOMINANCE: LAST SOLD PRICES PER CUSTOMER
  // =========================================================================

  async getCustomerLastSoldPrices(tenantId: string, customerId: number, repId?: number) {
    if (repId != null) {
      await this.assertRepServedCustomer(tenantId, repId, customerId);
    }
    const lastSales = await this.anyDb
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select([
        'si.product_id as productId',
        sql<number>`cast(si.unit_price as numeric)`.as('lastPrice'),
        's.created_at as lastSaleDate',
        's.doc_no as lastDocNo',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.customer_id', '=', customerId)
      .where('s.status', 'in', ['posted', 'completed'])
      .distinctOn('si.product_id')
      .orderBy('si.product_id')
      .orderBy('s.id', 'desc')
      .execute();

    const pricesMap: Record<number, { lastPrice: number; lastSaleDate: string; lastDocNo: string }> = {};
    for (const row of lastSales) {
      pricesMap[Number(row.productId)] = {
        lastPrice: Number(row.lastPrice || 0),
        lastSaleDate: row.lastSaleDate ? await resolveBusinessDateKey(this.anyDb, tenantId, row.lastSaleDate) : '',
        lastDocNo: String(row.lastDocNo || ''),
      };
    }

    return {
      ok: true,
      customerId,
      lastPrices: pricesMap,
    };
  }

  // =========================================================================
  // FIELD WHOLESALE DOMINANCE: ON-THE-SPOT FIELD CUSTOMER STATEMENT
  // =========================================================================

  async getCustomerFieldStatement(tenantId: string, customerId: number, repId?: number) {
    // Book digits resolved once (D4): the overdue total below rounds
    // at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const customer = await this.anyDb
      .selectFrom('customers')
      .select([
        'id',
        'name',
        'phone',
        'address',
        sql<number>`cast(coalesce(balance, 0) as numeric)`.as('balance'),
        sql<number>`cast(coalesce(credit_limit, 0) as numeric)`.as('creditLimit'),
        'is_credit_blocked as isCreditBlocked',
        'customer_type as customerType',
        'metadata',
      ])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!customer) {
      throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
    }

    if (repId != null) {
      await this.assertRepServedCustomer(tenantId, repId, customerId);
    }

    const packaging = await this.getCustomerPackagingBalance(customerId, tenantId);

    const recentSales = await this.anyDb
      .selectFrom('sales')
      .select([
        'id',
        'doc_no as docNo',
        'created_at as saleDate',
        'payment_type as paymentType',
        sql<number>`cast(total as numeric)`.as('total'),
        sql<number>`cast(coalesce(paid_amount, 0) as numeric)`.as('paidAmount'),
        sql<number>`cast(total - coalesce(paid_amount, 0) as numeric)`.as('remaining'),
        'status',
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('status', 'in', ['posted', 'completed'])
      .orderBy('id', 'desc')
      .limit(5)
      .execute();

    let collectionsList: Array<{
      id: number;
      receiptNumber: string;
      paymentDate: any;
      amount: number;
      paymentMethod: string;
      notes: string;
    }> = [];

    const recentCustomerPayments = await this.anyDb
      .selectFrom('customer_payments')
      .select([
        'id',
        sql<number>`cast(amount as numeric)`.as('amount'),
        'note',
        'created_at as createdAt',
        'transfer_reference as transferReference',
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .orderBy('id', 'desc')
      .limit(5)
      .execute();

    if (recentCustomerPayments && recentCustomerPayments.length > 0) {
      collectionsList = recentCustomerPayments.map((c: any) => {
        const receiptMatch = c.note ? String(c.note).match(/#([A-Z0-9-]+)/) : null;
        const receiptNumber = receiptMatch ? receiptMatch[1] : (c.transferReference ? `TR-${c.id}` : `COL-${c.id}`);

        let paymentMethod = 'cash';
        const noteText = String(c.note || '').toLowerCase();
        if (c.transferReference || noteText.includes('إنستاباي') || noteText.includes('instapay')) {
          paymentMethod = 'instapay';
        } else if (noteText.includes('فودافون') || noteText.includes('vodafone')) {
          paymentMethod = 'vodafone_cash';
        } else if (noteText.includes('تحويل') || noteText.includes('bank')) {
          paymentMethod = 'bank_transfer';
        }

        return {
          id: Number(c.id),
          receiptNumber,
          paymentDate: c.createdAt,
          amount: Number(c.amount || 0),
          paymentMethod,
          notes: c.note || '',
        };
      });
    } else {
      const recentLedgerPayments = await this.anyDb
        .selectFrom('customer_ledger')
        .select([
          'id',
          sql<number>`cast(abs(coalesce(amount, 0)) as numeric)`.as('amount'),
          'note',
          'created_at as createdAt',
        ])
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', customerId)
        .where('entry_type', 'in', ['payment', 'customer_payment'])
        .orderBy('id', 'desc')
        .limit(5)
        .execute();

      collectionsList = recentLedgerPayments.map((l: any) => {
        const receiptMatch = l.note ? String(l.note).match(/#([A-Z0-9-]+)/) : null;
        const receiptNumber = receiptMatch ? receiptMatch[1] : `COL-${l.id}`;

        let paymentMethod = 'cash';
        const noteText = String(l.note || '').toLowerCase();
        if (noteText.includes('إنستاباي') || noteText.includes('instapay')) {
          paymentMethod = 'instapay';
        } else if (noteText.includes('فودافون') || noteText.includes('vodafone')) {
          paymentMethod = 'vodafone_cash';
        } else if (noteText.includes('تحويل') || noteText.includes('bank')) {
          paymentMethod = 'bank_transfer';
        }

        return {
          id: Number(l.id),
          receiptNumber,
          paymentDate: l.createdAt,
          amount: Number(l.amount || 0),
          paymentMethod,
          notes: l.note || '',
        };
      });
    }

    let custMeta: any = {};
    if (typeof customer.metadata === 'string') {
      try { custMeta = JSON.parse(customer.metadata); } catch { custMeta = {}; }
    } else if (customer.metadata && typeof customer.metadata === 'object') {
      custMeta = customer.metadata;
    }
    const allowedCreditDays = Number(custMeta?.credit_days || custMeta?.credit_terms_days || 30);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - allowedCreditDays);

    const overdueInvoices = await this.anyDb
      .selectFrom('sales')
      .select([
        'id',
        'doc_no as docNo',
        'created_at as saleDate',
        sql<number>`cast(total - coalesce(paid_amount, 0) as numeric)`.as('remaining'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('payment_type', '=', 'credit')
      .where('status', 'in', ['posted', 'completed'])
      .where(sql`total - coalesce(paid_amount, 0) > 0.05`)
      .where('created_at', '<', cutoffDate)
      .orderBy('created_at', 'asc')
      .execute();

    const totalOverdueAmount = roundMoney(
      overdueInvoices.reduce((sum: number, inv: any) => sum + Number(inv.remaining || 0), 0),
      moneyDigits,
    );
    const oldestOverdueDays = overdueInvoices.length > 0
      ? Math.max(0, Math.floor((Date.now() - new Date(overdueInvoices[0].saleDate).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    return {
      ok: true,
      customer: {
        id: Number(customer.id),
        name: String(customer.name),
        phone: String(customer.phone || ''),
        address: String(customer.address || ''),
        balance: Number(customer.balance || 0),
        creditLimit: Number(customer.creditLimit || 0),
        customerType: customer.customerType || 'cash',
        isCreditBlocked: Boolean(customer.isCreditBlocked),
        allowedCreditDays,
      },
      overdueAnalysis: {
        hasOverdueInvoices: overdueInvoices.length > 0,
        overdueCount: overdueInvoices.length,
        totalOverdueAmount,
        oldestOverdueDays,
      },
      packagingBalance: Array.isArray(packaging) ? packaging : (packaging?.packages || []),
      recentSales: recentSales.map((s: any) => ({
        id: Number(s.id),
        docNo: String(s.docNo || `INV-${s.id}`),
        saleDate: s.saleDate,
        paymentType: s.paymentType,
        total: Number(s.total || 0),
        paidAmount: Number(s.paidAmount || 0),
        remaining: Number(s.remaining || 0),
      })),
      recentCollections: collectionsList,
    };
  }
}
