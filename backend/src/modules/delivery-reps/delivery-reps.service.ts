import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AuthCacheService } from '../../core/auth/services/auth-cache.service';
import { checkPortalTenantStatus } from '../../core/auth/utils/portal-tenant-status';
import { boundedPage } from '../../common/utils/bounded-page';
import {
  PORTAL_TOKEN_TTL_MS,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenErrorSpec,
} from '../../core/auth/utils/portal-token';
import { AppError } from '../../common/errors/app-error';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { UpsertDeliveryRepDto } from './dto/upsert-delivery-rep.dto';
import { LoginAttemptLimiter } from '../../common/utils/login-attempt-limiter';
import { assertPortalTenantAllowed } from '../../core/auth/utils/portal-tenant-status';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';

import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { SalesFinanceService } from '../sales/services/sales-finance.service';

const DRIVER_TOKEN_ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'غير مصرح - مطلوب تسجيل الدخول', code: 'UNAUTHORIZED_DRIVER' },
  invalid: { message: 'رمز الدخول غير صالح', code: 'INVALID_DRIVER_TOKEN' },
  signature: { message: 'رمز الدخول غير صالح أو مزور', code: 'INVALID_DRIVER_TOKEN' },
  expired: { message: 'انتهت صلاحية جلسة المندوب، يرجى إعادة تسجيل الدخول', code: 'DRIVER_SESSION_EXPIRED' },
};

@Injectable()
export class DeliveryRepsService {
  private readonly driverLoginLimiter = new LoginAttemptLimiter();

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly salesFinance: SalesFinanceService,
    @Optional() private readonly authCache: AuthCacheService = new AuthCacheService(),
  ) {}

  private tenantPredicate(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    return sql<boolean>`tenant_id = ${tenantId}`;
  }

  private tenantFields(actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    return { tenant_id: tenantId, account_id: accountId };
  }

  private async findOwnOpenShift(trx: Kysely<Database>, actor: AuthContext): Promise<{ id: number; branchId: number | null; locationId: number | null } | null> {
    const shift = await trx
      .selectFrom('cashier_shifts')
      .select(['id', 'branch_id', 'location_id'])
      .where('opened_by', '=', actor.userId)
      .where('status', '=', 'open')
      .where(this.tenantPredicate(actor))
      .orderBy('id', 'desc')
      .executeTakeFirst();
      
    if (!shift || !shift.id) return null;
    return { id: Number(shift.id), branchId: shift.branch_id ? Number(shift.branch_id) : null, locationId: shift.location_id ? Number(shift.location_id) : null };
  }

  private async getDeliveryFeeMode(trx: Kysely<Database>, actor: AuthContext): Promise<'freelance_courier' | 'store_fleet'> {
    const row = await trx
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'deliveryFeeMode')
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!row?.value) return 'freelance_courier';
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return parsed === 'store_fleet' ? 'store_fleet' : 'freelance_courier';
    } catch {
      return String(row.value).includes('store_fleet') ? 'store_fleet' : 'freelance_courier';
    }
  }

  async list(actor: AuthContext): Promise<Record<string, unknown>> {
    const reps = await this.db
      .selectFrom('delivery_representatives as dr')
      .selectAll('dr')
      .select([
        sql<string | null>`coalesce(
          (SELECT fv.plate_number 
           FROM fleet_vehicle_drivers fvd 
           JOIN fleet_vehicles fv ON fv.id = fvd.vehicle_id 
           WHERE fvd.rep_id = dr.id AND fvd.tenant_id = dr.tenant_id AND fvd.is_active = true 
           ORDER BY fvd.id DESC LIMIT 1),
          (SELECT fv2.plate_number 
           FROM fleet_vehicles fv2 
           WHERE fv2.assigned_rep_id = dr.id AND fv2.tenant_id = dr.tenant_id 
           ORDER BY fv2.id DESC LIMIT 1),
          dr.vehicle_plate
        )`.as('vehicle_plate'),
        sql<number | null>`coalesce(
          (SELECT fv.van_location_id 
           FROM fleet_vehicle_drivers fvd 
           JOIN fleet_vehicles fv ON fv.id = fvd.vehicle_id 
           WHERE fvd.rep_id = dr.id AND fvd.tenant_id = dr.tenant_id AND fvd.is_active = true 
           ORDER BY fvd.id DESC LIMIT 1),
          (SELECT fv2.van_location_id 
           FROM fleet_vehicles fv2 
           WHERE fv2.assigned_rep_id = dr.id AND fv2.tenant_id = dr.tenant_id 
           ORDER BY fv2.id DESC LIMIT 1),
          dr.van_location_id
        )`.as('van_location_id'),
        sql<string | null>`(
          SELECT fvd.shift_name 
          FROM fleet_vehicle_drivers fvd 
          WHERE fvd.rep_id = dr.id AND fvd.tenant_id = dr.tenant_id AND fvd.is_active = true 
          ORDER BY fvd.id DESC LIMIT 1
        )`.as('shift_name'),
      ])
      .where(this.tenantPredicate(actor))
      .orderBy('dr.is_active', 'desc')
      .orderBy('dr.name', 'asc')
      .execute();

    const sanitized = reps.map((r) => {
      const { pin_hash, pin_salt, ...rest } = r as any;
      return {
        ...rest,
        // حالة وجود الرمز فقط كقيمة منطقية دون تسريب التجزئة (البند O20)
        has_pin: Boolean(pin_hash),
      };
    });

    return { ok: true, deliveryReps: sanitized };
  }

  async create(payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Name is required', 'NAME_REQUIRED', 400);

    // الرمز يُجزَّأ قبل الكتابة — لا يُخزَّن نصاً صريحاً (البند O20)
    if (payload.pinCode) {
      assertSecurePasscode(String(payload.pinCode), { phone: payload.phone });
    }
    const createPinRecord = payload.pinCode ? await createPasswordRecord(String(payload.pinCode)) : null;

    const isVanRep = payload.isVanRep !== undefined
      ? Boolean(payload.isVanRep)
      : (payload.repType === 'van' || payload.repType === 'both');
    const repType = payload.repType || (isVanRep ? 'van' : 'delivery');

    const defaultPermissions = {
      can_edit_routes: false,
      can_add_customers: true,
      require_gps_on_visit: true,
      can_give_discount: false,
      max_discount_percent: 0,
      can_sell_over_credit_limit: false,
      can_collect_cash: true,
    };
    const permissions = payload.permissions ? { ...defaultPermissions, ...payload.permissions } : defaultPermissions;

    const [inserted] = await this.db
      .insertInto('delivery_representatives')
      .values({
        name,
        phone: payload.phone || null,
        full_name: payload.fullName || null,
        national_id: payload.nationalId || null,
        address: payload.address || null,
        vehicle_plate: payload.vehiclePlate || null,
        pin_hash: createPinRecord?.hash ?? null,
        pin_salt: createPinRecord?.salt ?? null,
        rep_type: repType,
        is_van_rep: isVanRep,
        is_active: payload.isActive !== false,
        permissions: permissions as any,
        metadata: (payload.metadata || {}) as any,
        ...this.tenantFields(actor),
      } as any)
      .returning(['id'])
      .execute();

    await this.audit.log('إضافة مندوب توصيل', `تم إضافة المندوب ${name} (${repType}) بواسطة ${actor.username}`, actor);
    return this.list(actor);
  }

  async update(id: number, payload: UpsertDeliveryRepDto, actor: AuthContext): Promise<Record<string, unknown>> {
    const name = String(payload.name || '').trim();
    if (!name) throw new AppError('Name is required', 'NAME_REQUIRED', 400);

    const existing = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'permissions', 'phone'])
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!existing) throw new AppError('Delivery representative not found', 'NOT_FOUND', 404);

    if (payload.pinCode) {
      assertSecurePasscode(String(payload.pinCode), { phone: payload.phone || existing.phone || undefined });
    }
    const updatePinRecord = payload.pinCode ? await createPasswordRecord(String(payload.pinCode)) : null;

    const isVanRep = payload.isVanRep !== undefined
      ? Boolean(payload.isVanRep)
      : (payload.repType ? (payload.repType === 'van' || payload.repType === 'both') : undefined);

    let mergedPermissions: any = undefined;
    if (payload.permissions !== undefined) {
      let currentPerms: any = {};
      if (typeof existing.permissions === 'string') {
        try { currentPerms = JSON.parse(existing.permissions); } catch { currentPerms = {}; }
      } else if (existing.permissions && typeof existing.permissions === 'object') {
        currentPerms = existing.permissions;
      }
      mergedPermissions = { ...currentPerms, ...payload.permissions };
    }

    await this.db
      .updateTable('delivery_representatives')
      .set({
        name,
        phone: payload.phone || null,
        full_name: payload.fullName !== undefined ? (payload.fullName || null) : undefined,
        national_id: payload.nationalId !== undefined ? (payload.nationalId || null) : undefined,
        address: payload.address !== undefined ? (payload.address || null) : undefined,
        vehicle_plate: payload.vehiclePlate !== undefined ? (payload.vehiclePlate || null) : undefined,
        pin_hash: updatePinRecord ? updatePinRecord.hash : undefined,
        pin_salt: updatePinRecord ? updatePinRecord.salt : undefined,
        rep_type: payload.repType !== undefined ? payload.repType : undefined,
        is_van_rep: isVanRep !== undefined ? isVanRep : undefined,
        is_active: payload.isActive !== undefined ? payload.isActive : undefined,
        ...(mergedPermissions !== undefined ? { permissions: mergedPermissions as any } : {}),
        ...(payload.metadata !== undefined ? { metadata: payload.metadata as any } : {}),
        updated_at: sql`NOW()`,
      } as any)
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('تعديل مندوب توصيل', `تم تعديل المندوب #${id} بواسطة ${actor.username}`, actor);
    return this.list(actor);
  }

  async remove(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const existing = await this.db
      .selectFrom('delivery_representatives')
      .select(['id'])
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!existing) throw new AppError('Delivery representative not found', 'NOT_FOUND', 404);

    await this.db
      .updateTable('delivery_representatives')
      .set({ is_active: false, updated_at: sql`NOW()` })
      .where('id', '=', id)
      .where(this.tenantPredicate(actor))
      .execute();

    await this.audit.log('حذف مندوب توصيل', `تم تعطيل المندوب #${id} بواسطة ${actor.username}`, actor);
    return this.list(actor);
  }

  async listOrders(repId: number, actor: AuthContext, filters?: { dateFrom?: string; dateTo?: string; status?: string; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(actor);
    const { page, pageSize, offset } = boundedPage(filters?.page, filters?.pageSize);
    let query = this.db
      .selectFrom('sales')
      .leftJoin('customers', (join) => join.onRef('customers.id', '=', 'sales.customer_id').onRef('customers.tenant_id', '=', 'sales.tenant_id'))
      .leftJoin('users as settled_user', (join) => join.onRef('settled_user.id', '=', 'sales.settled_by').onRef('settled_user.tenant_id', '=', 'sales.tenant_id'))
      .leftJoin('users as created_user', (join) => join.onRef('created_user.id', '=', 'sales.created_by').onRef('created_user.tenant_id', '=', 'sales.tenant_id'))
      .select([
        'sales.id',
        'sales.doc_no as docNo',
        'sales.total',
        'sales.delivery_fee as deliveryFee',
        'sales.delivery_fee_mode as deliveryFeeMode',
        'customers.name as customerName',
        'customers.phone as customerPhone',
        'customers.address as customerAddress',
        'sales.order_type as orderType',
        'sales.delivery_rep_id as deliveryRepId',
        'sales.delivery_status as deliveryStatus',
        'sales.collection_status as collectionStatus',
        sql<string | null>`sales.delivery_signature`.as('deliverySignature'),
        sql<string | null>`sales.delivery_photo_url`.as('deliveryPhotoUrl'),
        sql<number | null>`sales.delivery_gps_lat`.as('deliveryGpsLat'),
        sql<number | null>`sales.delivery_gps_lng`.as('deliveryGpsLng'),
        sql<string | null>`sales.delivery_notes`.as('deliveryNotes'),
        'sales.settled_at as settledAt',
        'sales.created_at as createdAt',
        'settled_user.username as settledByName',
        'created_user.username as createdByName'
      ])
      .where('sales.delivery_rep_id', '=', repId)
      .where('sales.tenant_id', '=', tenantId);

    if (filters?.status) {
      if (filters.status === 'unsettled') {
        query = query.where((eb) => eb.or([
          eb('sales.delivery_status', '!=', 'settled'),
          eb('sales.delivery_status', 'is', null)
        ]));
      } else {
        query = query.where('sales.delivery_status', '=', filters.status as any);
      }
    }
    
    if (filters?.dateFrom) {
      query = query.where('sales.created_at', '>=', new Date(filters.dateFrom));
    }

    if (filters?.dateTo) {
      const dateTo = new Date(filters.dateTo);
      dateTo.setHours(23, 59, 59, 999);
      query = query.where('sales.created_at', '<=', dateTo);
    }

    const orders = await query.orderBy('sales.created_at', 'desc').orderBy('sales.id', 'desc').limit(pageSize + 1).offset(offset).execute();
    // INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): each row carries
    // its remaining cash due from deliverySettlementBasis, so the
    // row and the badge agree with the settle gate. `total` stays
    // the invoice total; `remainingAmount` is what the rep still
    // owes for this order (0 for a fully-returned order). Only
    // the page rows are priced (pageSize <= 200), never the
    // lookahead row.
    const pageRows = orders.slice(0, pageSize);
    const defaultMode = await this.getDeliveryFeeMode(this.db, actor);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const ordersWithRemaining = [];
    for (const row of pageRows) {
      const remainingAmount = await this.repOrderCashDue(
        { id: Number(row.id), delivery_fee_mode: row.deliveryFeeMode ?? null },
        defaultMode,
        moneyDigits,
        actor,
      );
      ordersWithRemaining.push({ ...row, remainingAmount });
    }
    return { ok: true, orders: ordersWithRemaining, pagination: { page, pageSize, hasMore: orders.length > pageSize } };
  }

  async listSettlements(repId: number, actor: AuthContext, filters?: { dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(actor);
    const { page, pageSize, offset } = boundedPage(filters?.page, filters?.pageSize);
    let query = this.db
      .selectFrom('sales as s')
      .leftJoin('users as u', (join) => join.onRef('u.id', '=', 's.settled_by').onRef('u.tenant_id', '=', 's.tenant_id'))
      .leftJoin('users as cu', (join) => join.onRef('cu.id', '=', 's.created_by').onRef('cu.tenant_id', '=', 's.tenant_id'))
      .select([
        's.id',
        's.doc_no as docNo',
        's.total as amount',
        's.delivery_fee as deliveryFee',
        's.collection_status as collectionStatus',
        's.created_at as orderDate',
        's.settled_at as createdAt',
        'u.username as settledByName',
        'cu.username as createdByName'
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.delivery_rep_id', '=', repId)
      .where('s.delivery_status', '=', 'settled');

    if (filters?.dateFrom) {
      query = query.where('s.settled_at', '>=', new Date(filters.dateFrom));
    }

    if (filters?.dateTo) {
      const dateTo = new Date(filters.dateTo);
      dateTo.setHours(23, 59, 59, 999);
      query = query.where('s.settled_at', '<=', dateTo);
    }

    const settlements = await query.orderBy('s.settled_at', 'desc').orderBy('s.id', 'desc').limit(pageSize + 1).offset(offset).execute();
    return { ok: true, settlements: settlements.slice(0, pageSize), pagination: { page, pageSize, hasMore: settlements.length > pageSize } };
  }

  async getRepKPIs(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(actor);
    
    const totals = await this.db
      .selectFrom('sales')
      .select([
        sql<number>`count(*)::int`.as('total_orders'),
        sql<number>`count(*) filter (where status = 'returned')::int`.as('returned_orders'),
        sql<number>`count(*) filter (where status is distinct from 'returned' and delivery_status = 'settled')::int`.as('successful_orders'),
        sql<number>`coalesce(avg(extract(epoch from (settled_at - created_at)) * 1000)
          filter (where status is distinct from 'returned' and delivery_status = 'settled' and settled_at > created_at), 0)`.as('average_delay_ms'),
      ])
      .where('delivery_rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    const totalOrders = Number(totals.total_orders);
    const returnedOrders = Number(totals.returned_orders);
    const successfulOrders = Number(totals.successful_orders);
    const averageDelayMs = Number(totals.average_delay_ms);
    const averageDelayHours = averageDelayMs / 3_600_000;
    const averageDelayMins = Math.round(averageDelayMs / 60_000);
    const successRate = totalOrders > 0 ? (successfulOrders / totalOrders) * 100 : 0;
    
    // Rating logic (Starts at 5, deducts based on issues)
    let rating = 5.0;
    
    // Deduct 0.5 for every 10% returns
    const returnRate = totalOrders > 0 ? (returnedOrders / totalOrders) * 100 : 0;
    rating -= (returnRate / 10) * 0.5;
    
    // Deduct for delay: 0.1 for every hour of average delay above 2 hours
    if (averageDelayHours > 2) {
      rating -= (averageDelayHours - 2) * 0.1;
    }
    
    // Ensure rating is between 0 and 5
    rating = Math.max(0, Math.min(5, Number(rating.toFixed(1))));

    return { 
      ok: true, 
      kpis: {
        totalOrders,
        successfulOrders,
        returnedOrders,
        successRate: Number(successRate.toFixed(1)),
        averageDelayHours: Number(averageDelayHours.toFixed(1)),
        averageDelayMins,
        rating
      } 
    };
  }

  async settleOrder(
    saleId: number,
    actor: AuthContext,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string; countedCashAmount?: number }
  ): Promise<Record<string, unknown>> {
    let settlementSummary: { countedCash: number; expectedCash: number; variance: number } | null = null;
    await this.db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sales')
        .select(['id', 'total', 'delivery_fee', 'delivery_fee_mode', 'delivery_status', 'delivery_rep_id', 'collection_status', 'customer_id', 'paid_amount', 'status', 'order_type'])
        .where('id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .forUpdate()
        .executeTakeFirst();

      if (!sale) throw new AppError('Order not found', 'ORDER_NOT_FOUND', 404);
      if (!sale.delivery_rep_id) throw new AppError('Order is not assigned to a delivery rep', 'NOT_ASSIGNED', 400);
      if (sale.delivery_status === 'settled') throw new AppError('Order is already settled', 'ALREADY_SETTLED', 400);
      if (sale.status === 'cancelled' || sale.order_type !== 'delivery') {
        throw new AppError('Only active delivery orders may be settled', 'DELIVERY_SETTLEMENT_INVALID_ORDER', 409);
      }
      const isCourierCash = sale.collection_status === 'cod';
      if (isCourierCash && Number(sale.paid_amount || 0) > 0.009) {
        // The current GL posting contract expects the entire invoice as an
        // outstanding receivable. Refuse partially paid orders until reconciled.
        throw new AppError('طلب الدليفري محصل جزئياً ويتطلب تسوية منفصلة قبل إقفال عهدة المندوب', 'DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }
      // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): a counted
      // cash amount is validated up front, before any write. It
      // must be a non-negative number; a positive counted amount
      // on a non-COD order has no cash to settle and fails closed
      // instead of being silently ignored (a zero amount on a
      // non-COD order is a no-op and is ignored).
      if (payload?.countedCashAmount !== undefined && payload?.countedCashAmount !== null) {
        const rawCounted = Number(payload.countedCashAmount);
        if (!Number.isFinite(rawCounted) || rawCounted < 0) {
          throw new AppError('Counted cash amount must be a non-negative number', 'SETTLEMENT_AMOUNT_INVALID', 400);
        }
        if (!isCourierCash && rawCounted > 0) {
          throw new AppError('Counted cash applies only to cash-on-delivery orders', 'DELIVERY_SETTLEMENT_COUNTED_CASH_NOT_APPLICABLE', 400);
        }
      }

      let shiftId: number | null = null;
      let branchId: number | null = null;
      let locationId: number | null = null;

      if (isCourierCash) {
        const openShift = await this.findOwnOpenShift(trx, actor);
        if (!openShift) throw new AppError('لا بد من فتح وردية أولاً لاستلام الفلوس من المندوب', 'NO_OPEN_SHIFT', 400);
        shiftId = openShift.id;
        branchId = openShift.branchId;
        locationId = openShift.locationId;

        // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: settle the
        // REMAINING amounts, not the original sale row. A prior
        // return already reversed part of the receivable (and
        // relieved part of the fee), so total - originalFee fails
        // closed in postDeliveryRepSettlement, and crediting the
        // full total would over-credit 1130. The basis is the
        // single source of truth shared with the posting gate.
        const basis = await this.accountingPosting.deliverySettlementBasis(trx, saleId, actor);
        const deliveryFeeMode = (sale as any).delivery_fee_mode || await this.getDeliveryFeeMode(trx, actor);
        const remainingFee = deliveryFeeMode === 'store_fleet' ? 0 : basis.remainingFee;
        const { tenantId: settleTenantId } = requireTenantScope(actor);
        const settleDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, settleTenantId));
        const cashDue = roundMoney(Math.max(0, basis.remainingReceivable - remainingFee), settleDigits);
        // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): the cash
        // the rep actually handed over, counted by the cashier.
        // When no counted amount is supplied (older clients, the
        // driver mobile page) it defaults to the book cash due,
        // preserving the old behaviour exactly. A counted amount
        // is never silently replaced by the book amount: a
        // shortage is booked to 7200 and an overage to 7100 by
        // postDeliveryRepSettlement, and the receivable is cleared
        // by cash received + variance, never by unreceived cash.
        const countedCash = payload?.countedCashAmount !== undefined && payload?.countedCashAmount !== null
          ? roundMoney(Number(payload.countedCashAmount), settleDigits)
          : null;
        const settledCashAmount = countedCash ?? cashDue;
        const settlementVariance = roundMoney(settledCashAmount - cashDue, settleDigits);
        settlementSummary = { countedCash: settledCashAmount, expectedCash: cashDue, variance: settlementVariance };

        if (settledCashAmount > 0) {
          const repRow = sale.delivery_rep_id ? await trx.selectFrom('delivery_representatives').select(['name']).where('id', '=', Number(sale.delivery_rep_id)).where(this.tenantPredicate(actor)).executeTakeFirst() : null;
          const repLabel = repRow?.name ? `${repRow.name} (#${sale.delivery_rep_id})` : `مندوب #${sale.delivery_rep_id}`;
          const varianceNote = settlementVariance < 0
            ? ` (عجز ${roundMoney(Math.abs(settlementVariance), settleDigits)} ج)`
            : settlementVariance > 0
              ? ` (زيادة ${settlementVariance} ج)`
              : '';
          await trx.insertInto('treasury_transactions').values({
            txn_type: 'cash_in',
            amount: settledCashAmount,
            note: `تسوية أوردر دليفري رقم #${saleId} من ${repLabel}${remainingFee > 0 && deliveryFeeMode === 'freelance_courier' ? ` (مخصوماً منها ${remainingFee} ج رسوم المندوب)` : ''}${varianceNote}`,
            reference_type: 'cashier_shift',
            reference_id: shiftId,
            branch_id: branchId,
            location_id: locationId,
            created_by: actor.userId,
            ...this.tenantFields(actor)
          }).execute();
        }

        // D-SF-02 (INV-SF-COD-CUSTODY-GL): the receivable left the
        // customer's books at dispatch (custody transfer), so the
        // settle must not credit the customer ledger again — it
        // would drive the balance negative. A sale settled without
        // dispatch keeps the old credit.
        if (sale.customer_id && basis.remainingReceivable > 0
          && !(await this.accountingPosting.hasDeliveryCustodyReclassification(trx, saleId, actor))) {
          await this.salesFinance.createCustomerLedgerEntry(trx, sale.customer_id, -basis.remainingReceivable, `تسديد من مندوب للأوردر #${saleId}`, saleId, actor);
        }

        await this.accountingPosting.postDeliveryRepSettlement(trx, saleId, cashDue, branchId, locationId, actor, { countedCash: settledCashAmount });
      }

      const updateData: Record<string, any> = {
        delivery_status: 'settled',
        settled_at: sql`NOW()`,
        settled_by: actor.userId,
        updated_at: sql`NOW()`,
      };
      if (payload?.signatureDataUrl) updateData.delivery_signature = payload.signatureDataUrl;
      if (payload?.proofPhotoUrl) updateData.delivery_photo_url = payload.proofPhotoUrl;
      if (payload?.gpsLat !== undefined && payload?.gpsLat !== null) updateData.delivery_gps_lat = payload.gpsLat;
      if (payload?.gpsLng !== undefined && payload?.gpsLng !== null) updateData.delivery_gps_lng = payload.gpsLng;
      if (payload?.notes) updateData.delivery_notes = payload.notes;

      await trx
        .updateTable('sales')
        .set(updateData)
        .where('id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', '=', saleId)
        .where(this.tenantPredicate(actor))
        .where('status', '!=', 'cancelled')
        .execute();
    });

    await this.audit.log('تسوية طلب توصيل', `تمت تسوية الطلب #${saleId} بواسطة ${actor.username}`, actor);
    return { ok: true, ...(settlementSummary ? settlementSummary : {}) };
  }

  /**
   * INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): the cash a rep still
   * owes (pending) or has handed over (collected) for ONE order,
   * derived from deliverySettlementBasis — the single source of
   * truth the settle gates and postDeliveryRepSettlement already
   * use — never from gross sales.total. A prior return already
   * reversed part of the receivable (and relieved part of the
   * fee), so the gross total charges the rep for money the
   * customer no longer owes (live divergence 131.60: return
   * ZR-261110-0601 reversed the sale JE while the badge kept
   * 131.60). The formula is settleAllOrders' cashDue exactly:
   * store-fleet owes the remaining receivable; a freelance
   * courier owes it minus the remaining fee, floored at zero.
   */
  private async repOrderCashDue(
    order: { id: number; delivery_fee_mode: string | null },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ): Promise<number> {
    const basis = await this.accountingPosting.deliverySettlementBasis(this.db, Number(order.id), actor);
    return (order.delivery_fee_mode || defaultMode) === 'store_fleet'
      ? basis.remainingReceivable
      : Math.max(0, roundMoney(basis.remainingReceivable - basis.remainingFee, moneyDigits));
  }

  async getRepSummary(repId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('id', '=', repId)
      .where(this.tenantPredicate(actor))
      .executeTakeFirst();
    if (!rep) throw new AppError('Delivery representative not found', 'NOT_FOUND', 404);

    const defaultMode = await this.getDeliveryFeeMode(this.db, actor);
    const { tenantId } = requireTenantScope(actor);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    // INV-SF-REP-CUSTODY-NET-RETURNS (D-SF-10): the summary is
    // computed from deliverySettlementBasis per order — the same
    // single source of truth the settle gates and the posting
    // use — not from gross sales.total. A fully-returned
    // unsettled order contributes 0 (its receivable is already
    // zero via the return journal), so the phantom clears without
    // any status flip; a settled-then-returned order likewise
    // stops counting the returned share as collected. Per-order
    // basis calls match the settleAllOrders precedent (<= 200
    // orders); re-implementing the basis in SQL would create the
    // second computation this fix exists to delete.
    const orders = await this.db
      .selectFrom('sales')
      .select(['id', 'delivery_fee_mode', 'delivery_status', 'collection_status'])
      .where('delivery_rep_id', '=', repId)
      .where(this.tenantPredicate(actor))
      .execute();
    let collectedAmount = 0;
    let pendingAmount = 0;
    for (const order of orders) {
      const cashDue = await this.repOrderCashDue(
        { id: Number(order.id), delivery_fee_mode: order.delivery_fee_mode ?? null },
        defaultMode, moneyDigits, actor,
      );
      if (order.delivery_status === 'settled') {
        collectedAmount += cashDue;
      } else if (order.collection_status === 'cod') {
        pendingAmount += cashDue;
      }
    }

    return {
      ok: true,
      summary: {
        totalOrders: orders.length,
        collectedAmount: roundMoney(collectedAmount, moneyDigits),
        pendingAmount: roundMoney(pendingAmount, moneyDigits),
      }
    };
  }

  async settleAllOrders(repId: number, expectedAmount: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const result = await this.db.transaction().execute(async (trx) => {
      const openShift = await this.findOwnOpenShift(trx, actor);
      if (!openShift) throw new AppError('لا بد من فتح وردية أولاً لاستلام الفلوس من المندوب', 'NO_OPEN_SHIFT', 400);

      const unsettledOrders = await trx
        .selectFrom('sales')
        .select(['id', 'total', 'customer_id', 'delivery_fee', 'delivery_fee_mode', 'paid_amount'])
        .where('delivery_rep_id', '=', repId)
        .where('collection_status', '=', 'cod')
        .where('order_type', '=', 'delivery')
        .where('status', '!=', 'cancelled')
        .where((eb) => eb.or([
          eb('delivery_status', '!=', 'settled'),
          eb('delivery_status', 'is', null)
        ]))
        .where(this.tenantPredicate(actor))
        .orderBy('id', 'asc')
        .limit(201)
        .forUpdate()
        .execute();

      if (unsettledOrders.length > 200) {
        throw new AppError('Too many unsettled orders for one settlement; settle a smaller batch', 'SETTLEMENT_BATCH_TOO_LARGE', 409);
      }

      if (unsettledOrders.length === 0) {
        throw new AppError('No unsettled orders found for this representative', 'NO_ORDERS', 400);
      }

      if (unsettledOrders.some((order) => Number(order.paid_amount || 0) > 0.009)) {
        throw new AppError('بعض طلبات المندوب مدفوعة جزئياً وتتطلب تسوية منفصلة', 'DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }
      const defaultMode = await this.getDeliveryFeeMode(trx, actor);
      // Cash due is money: round at the tenant's book digits. Currency
      // resolves on the transaction handle (never the pool) inside the
      // open transaction; the old 2-decimal cut dropped a 3-decimal tenant's
      // fils before the amount was posted to treasury.
      const { tenantId } = requireTenantScope(actor);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: cash due is the
      // REMAINING receivable minus the REMAINING fee per order
      // (deliverySettlementBasis, shared with the posting gate) —
      // a prior return already reversed part of each order's
      // receivable and relieved part of its fee. The basis is read
      // up front so the AMOUNT_MISMATCH pre-check and the per-order
      // posts below agree on the same numbers.
      const basisByOrderId = new Map<number, { remainingReceivable: number; remainingFee: number }>();
      for (const order of unsettledOrders) {
        basisByOrderId.set(Number(order.id), await this.accountingPosting.deliverySettlementBasis(trx, Number(order.id), actor));
      }
      const cashDue = (order: typeof unsettledOrders[number]) => {
        const basis = basisByOrderId.get(Number(order.id))!;
        return (order.delivery_fee_mode || defaultMode) === 'store_fleet'
          ? basis.remainingReceivable
          : Math.max(0, roundMoney(basis.remainingReceivable - basis.remainingFee, moneyDigits));
      };
      const actualTotal = roundMoney(unsettledOrders.reduce((sum, order) => sum + cashDue(order), 0), moneyDigits);

      if (Math.abs(actualTotal - expectedAmount) > 0.01) {
        throw new AppError(`مبلغ التسوية (${expectedAmount}) لا يتطابق مع إجمالي المطلوب من المندوب (${actualTotal}).`, 'AMOUNT_MISMATCH', 400);
      }

      const saleIds = unsettledOrders.map(o => o.id);
      
      const repRow = await trx.selectFrom('delivery_representatives').select(['name']).where('id', '=', repId).where(this.tenantPredicate(actor)).executeTakeFirst();
      const repLabel = repRow?.name ? `${repRow.name} (#${repId})` : `مندوب #${repId}`;

      // R7-A F2: no cash row when the batch hands over nothing
      // (every order fully returned) — a zero treasury row is noise.
      if (actualTotal > 0) {
        await trx.insertInto('treasury_transactions').values({
          txn_type: 'cash_in',
          amount: actualTotal,
          note: `تسوية أوردرات دليفري (${saleIds.length} أوردر) من ${repLabel}`,
          reference_type: 'cashier_shift',
          reference_id: openShift.id,
          branch_id: openShift.branchId,
          location_id: openShift.locationId,
          created_by: actor.userId,
          ...this.tenantFields(actor)
        }).execute();
      }

      for (const order of unsettledOrders) {
        const basis = basisByOrderId.get(Number(order.id))!;
        // D-SF-02 (INV-SF-COD-CUSTODY-GL): same as settleOrder —
        // the receivable already left the customer's books at
        // dispatch, so the batch settle must not credit the
        // customer ledger again.
        if (order.customer_id && basis.remainingReceivable > 0
          && !(await this.accountingPosting.hasDeliveryCustodyReclassification(trx, Number(order.id), actor))) {
          await this.salesFinance.createCustomerLedgerEntry(trx, order.customer_id, -basis.remainingReceivable, `تسديد من مندوب للأوردر #${order.id}`, order.id, actor);
        }
        await this.accountingPosting.postDeliveryRepSettlement(trx, order.id, cashDue(order), openShift.branchId, openShift.locationId, actor);
      }

      await trx
        .updateTable('sales')
        .set({
          delivery_status: 'settled',
          settled_at: sql`NOW()`,
          settled_by: actor.userId,
          updated_at: sql`NOW()`,
        })
        .where('id', 'in', saleIds)
        .where(this.tenantPredicate(actor))
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', 'in', saleIds)
        .where(this.tenantPredicate(actor))
        .where('status', '!=', 'cancelled')
        .execute();

      return { settledCount: saleIds.length, totalAmount: actualTotal };
    });

    await this.audit.log('تسوية كل الطلبات', `تمت تسوية ${result.settledCount} طلب للمندوب #${repId} بواسطة ${actor.username}`, actor);
    return { ok: true, settledCount: result.settledCount, totalAmount: result.totalAmount };
  }

  async driverLogin(payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: boolean }> {
    const rawPhone = String(payload?.phone || '').trim();
    const pinCode = String(payload?.pinCode || '').trim();
    const companyScope = payload?.companyCode || payload?.tenantId;

    if (!rawPhone || !pinCode) {
      throw new AppError('رقم الهاتف ورمز الدخول السريع (PIN) مطلوبان', 'INVALID_CREDENTIALS', 400);
    }

    const rateLimitKey = `driver-portal:${rawPhone.toLowerCase()}:${String(companyScope || '').toLowerCase()}`;
    this.driverLoginLimiter.assertNotLocked(rateLimitKey);

    try {
      return await this.driverLoginInternal(payload, rawPhone, pinCode, companyScope, rateLimitKey);
    } catch (error) {
      if (error instanceof AppError && ['UNAUTHORIZED_DRIVER'].includes(error.code)) {
        this.driverLoginLimiter.recordFailure(rateLimitKey);
      }
      throw error;
    }
  }

  private async driverLoginInternal(
    payload: { phone: string; pinCode: string; companyCode?: string; tenantId?: string },
    rawPhone: string,
    pinCode: string,
    companyScope: string | undefined,
    rateLimitKey: string,
  ): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: boolean }> {
    const cleanDigits = rawPhone.replace(/\D/g, '');
    const cleanNoCountry = cleanDigits.startsWith('20') ? cleanDigits.slice(2) : (cleanDigits.startsWith('0') ? cleanDigits.slice(1) : cleanDigits);

    let resolvedTenantId = companyScope ? String(companyScope).trim() : undefined;
    if (resolvedTenantId) {
      const tenantKey = resolvedTenantId;
      try {
        const tenantRow = await this.db
          .selectFrom('tenants')
          .select(['id', 'slug'])
          .where((eb) => eb.or([eb('id', '=', tenantKey), eb('slug', '=', tenantKey)]))
          .executeTakeFirst();
        if (tenantRow?.id) {
          resolvedTenantId = tenantRow.id;
        }
      } catch {
        // fallback
      }
    }

    let repsQuery = this.db
      .selectFrom('delivery_representatives')
      .selectAll()
      .where('is_active', '=', true);

    if (resolvedTenantId) {
      repsQuery = repsQuery.where('tenant_id', '=', resolvedTenantId);
    }

    const reps = await repsQuery.execute();

    // الهاتف يُرشَّح أولاً (مقارنة نصية رخيصة)، ثم يُتحقق من الـPIN بالتجزئة على
    // المرشحين الباقين فقط — bcrypt مكلف ولا يصح تشغيله على كل المناديب.
    const phoneMatches = reps.filter((r) => {
      if (!r.phone || !r.pin_hash) return false;
      const rDigits = String(r.phone).replace(/\D/g, '');
      const rNoCountry = rDigits.startsWith('20') ? rDigits.slice(2) : (rDigits.startsWith('0') ? rDigits.slice(1) : rDigits);
      return rNoCountry === cleanNoCountry || rDigits === cleanDigits;
    });

    const pinChecks = await Promise.all(
      phoneMatches.map(async (r) => {
        const res = await verifyPassword(pinCode, String(r.pin_hash), String(r.pin_salt || ''));
        return res.valid;
      }),
    );
    const matchedReps = phoneMatches.filter((_, idx) => pinChecks[idx]);

    if (!matchedReps || matchedReps.length === 0) {
      throw new AppError('بيانات الدخول غير صحيحة أو حساب المندوب غير مفعّل', 'UNAUTHORIZED_DRIVER', 401);
    }

    if (matchedReps.length > 1) {
      const candidateTenantIds = Array.from(
        new Set(matchedReps.map((r) => String(r.tenant_id).trim())),
      ).filter(Boolean);

      let tenantRows: any[] = [];
      try {
        tenantRows = await this.db
          .selectFrom('tenants')
          .select(['id', 'slug', 'business_name'])
          .where('id', 'in', candidateTenantIds)
          .execute();
      } catch {
        tenantRows = [];
      }

      const tenantMap = new Map((tenantRows || []).map((t: any) => [t.id, t]));
      const tenantOptions = candidateTenantIds.map((tId) => {
        const t = tenantMap.get(tId);
        return {
          id: tId,
          name: t?.business_name || t?.slug || tId,
          slug: t?.slug || tId,
        };
      });

      throw new AppError(
        'رقم هاتف المندوب مسجل لدى أكثر من منشأة. يرجى اختيار المنشأة المراد العمل معها لمنع تداخل الحسابات.',
        'MULTIPLE_TENANTS',
        401,
        { tenants: tenantOptions },
      );
    }

    const matchedRep = matchedReps[0];

    // Fetch tenant name for active driver session
    let tenantName = matchedRep.tenant_id;
    try {
      const tenantRow = await this.db
        .selectFrom('tenants')
        .select(['business_name', 'slug'])
        .where('id', '=', matchedRep.tenant_id)
        .executeTakeFirst();
      if (tenantRow?.business_name || tenantRow?.slug) {
        tenantName = tenantRow.business_name || tenantRow.slug;
      }
    } catch {
      // fallback to tenant_id
    }

    // INV-PORTAL-TENANT-STATUS-ENFORCED: no fresh login for a
    // suspended / expired / trial-expired tenant, even with a valid PIN.
    await assertPortalTenantAllowed(this.db as any, this.authCache, String(matchedRep.tenant_id));

    // INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: a PIN that is still the public
    // default must be changed at first login. Detection is a real password
    // check against the stored hash — never a comparison with a stored
    // value — and the default itself is never returned or displayed.
    const mustChangePin = matchedRep.pin_hash
      ? (await verifyPassword('1234', String(matchedRep.pin_hash), String(matchedRep.pin_salt || ''))).valid
      : false;

    const token = signPortalToken(
      {
        repId: Number(matchedRep.id),
        tenantId: matchedRep.tenant_id,
        accountId: matchedRep.account_id,
        name: matchedRep.name,
        phone: matchedRep.phone,
      },
      PORTAL_TOKEN_TTL_MS,
    );
    this.driverLoginLimiter.recordSuccess(rateLimitKey);

    return {
      token,
      mustChangePin,
      rep: {
        id: matchedRep.id,
        name: matchedRep.name,
        fullName: matchedRep.full_name,
        phone: matchedRep.phone,
        vehiclePlate: matchedRep.vehicle_plate,
        tenantId: matchedRep.tenant_id,
        tenantName,
        isVanRep: Boolean((matchedRep as any).is_van_rep),
        vanLocationId: (matchedRep as any).van_location_id || null,
        permissions: (matchedRep as any).permissions || {},
      },
    };
  }

  /**
   * INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: driver self-service PIN change.
   * The current PIN must verify first; the new credential must pass the
   * shared `assertSecurePasscode` policy (never a trivial value such as
   * 1234/0000) and differ from the current one. Returns a fresh token:
   * once the PIN is no longer the default the session is unflagged.
   * The driver token is stateless HMAC with no version, so a PIN change
   * cannot invalidate tokens already issued — that is M14's package.
   */
  async driverChangePin(
    driver: { repId: number; tenantId: string; accountId: string; name: string; phone: string },
    body: { currentPin?: string; newPin?: string },
  ): Promise<{ token: string; rep: Record<string, unknown>; mustChangePin: false }> {
    const currentPin = String(body?.currentPin || '').trim();
    const newPin = String(body?.newPin || '').trim();
    if (!currentPin || !newPin) {
      throw new AppError('يرجى إدخال الرمز الحالي والرمز الجديد', 'INVALID_PIN', 400);
    }

    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'full_name', 'phone', 'vehicle_plate', 'is_active', 'tenant_id', 'account_id', 'pin_hash', 'pin_salt', 'is_van_rep', 'van_location_id', 'permissions'])
      .where('id', '=', driver.repId)
      .where('tenant_id', '=', driver.tenantId)
      .executeTakeFirst();

    if (!rep || rep.is_active === false) {
      throw new AppError('تم إيقاف حساب المندوب. يرجى مراجعة الإدارة', 'DRIVER_INACTIVE', 401);
    }
    if (
      !rep.pin_hash ||
      !(await verifyPassword(currentPin, String(rep.pin_hash), String(rep.pin_salt || ''))).valid
    ) {
      throw new AppError('رمز الدخول الحالي غير صحيح', 'INVALID_PIN', 401);
    }

    assertSecurePasscode(newPin, { phone: String(rep.phone || '') });

    if ((await verifyPassword(newPin, String(rep.pin_hash), String(rep.pin_salt || ''))).valid) {
      throw new AppError('الرمز الجديد يجب أن يختلف عن الرمز الحالي', 'WEAK_PIN', 400);
    }

    const record = await createPasswordRecord(newPin);
    await this.db
      .updateTable('delivery_representatives')
      .set({ pin_hash: record.hash, pin_salt: record.salt })
      .where('id', '=', driver.repId)
      .where('tenant_id', '=', driver.tenantId)
      .execute();

    let tenantName = String(rep.tenant_id);
    try {
      const tenantRow = await this.db
        .selectFrom('tenants')
        .select(['business_name', 'slug'])
        .where('id', '=', rep.tenant_id)
        .executeTakeFirst();
      if (tenantRow?.business_name || tenantRow?.slug) {
        tenantName = tenantRow.business_name || tenantRow.slug;
      }
    } catch {
      // fallback to tenant_id
    }

    const token = signPortalToken(
      {
        repId: Number(rep.id),
        tenantId: rep.tenant_id,
        accountId: rep.account_id,
        name: rep.name,
        phone: rep.phone,
      },
      PORTAL_TOKEN_TTL_MS,
    );

    return {
      token,
      mustChangePin: false,
      rep: {
        id: rep.id,
        name: rep.name,
        fullName: rep.full_name,
        phone: rep.phone,
        vehiclePlate: rep.vehicle_plate,
        tenantId: rep.tenant_id,
        tenantName,
        isVanRep: Boolean((rep as any).is_van_rep),
        vanLocationId: (rep as any).van_location_id || null,
        permissions: (rep as any).permissions || {},
      },
    };
  }

  /**
   * INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: no driver-portal data is served
   * while the rep still uses the default PIN. The flag is re-derived
   * from the live stored hash on every call, never trusted from the
   * token — so a rep who changes the PIN unflags immediately, even on
   * an old token. The change-PIN endpoint is the only escape hatch and
   * does not call this guard. Mirrors the staff portal's
   * assertPinChanged (INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE).
   */
  async assertDriverPinChanged(driver: { repId: number; tenantId: string }): Promise<void> {
    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['pin_hash', 'pin_salt'])
      .where('id', '=', driver.repId)
      .where('tenant_id', '=', driver.tenantId)
      .executeTakeFirst();
    if (
      rep?.pin_hash &&
      (await verifyPassword('1234', String(rep.pin_hash), String(rep.pin_salt || ''))).valid
    ) {
      throw new AppError('يجب تغيير رمز الدخول الافتراضي قبل المتابعة', 'PIN_CHANGE_REQUIRED', 403);
    }
  }

  /**
   * يتحقق من رمز بوابة المندوب.
   *
   * الرمز بلا حالة وعمره 30 يوماً، فبعد التحقق من التوقيع يُعاد التأكد من قاعدة
   * البيانات أن المندوب ما زال نشطاً داخل نفس المستأجر — وإلا ظل مندوب موقوف قادراً
   * على البيع والتحصيل باسم المنشأة لمدة شهر بعد إيقافه.
   */
  /**
   * INV-PORTAL-TENANT-STATUS-ENFORCED: the driver token is stateless,
   * so every request re-checks the rep row AND the tenant status.
   * `settleOnly` is the narrow finish-and-settle path: a suspended
   * tenant's driver may still settle his already-open trip (the settle
   * service methods themselves enforce open-trip + rep ownership), and
   * the caller learns the tenant is suspended via `tenantSuspended`.
   * Every other caller uses the strict form, which throws.
   */
  private async verifyDriverTokenCore(
    token: string,
    settleOnly: boolean,
  ): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string; tenantSuspended: boolean }> {
    const payload = verifyPortalToken<Record<string, any>>(token, DRIVER_TOKEN_ERRORS);

    const repId = Number(payload.repId || 0);
    const tenantId = String(payload.tenantId || '').trim();
    const accountId = String(payload.accountId || '').trim();

    if (!repId || !tenantId || !accountId) {
      throw new AppError('رمز الدخول غير صالح', 'INVALID_DRIVER_TOKEN', 401);
    }

    const rep = await this.db
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'phone', 'is_active', 'tenant_id', 'account_id'])
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!rep || rep.is_active === false) {
      throw new AppError('تم إيقاف حساب المندوب. يرجى مراجعة الإدارة', 'DRIVER_INACTIVE', 401);
    }

    const decision = await checkPortalTenantStatus(this.db as any, this.authCache, tenantId);
    if (decision.blocked && !settleOnly) {
      throw new AppError(decision.message || 'تم إيقاف أو انتهاء اشتراك هذه النسخة.', decision.code || 'TENANT_NOT_ALLOWED', 401);
    }
    const tenantSuspended = decision.blocked;

    return {
      repId,
      tenantId: String(rep.tenant_id),
      accountId: String(rep.account_id || accountId),
      name: String(rep.name || payload.name || ''),
      phone: String(rep.phone || payload.phone || ''),
      tenantSuspended,
    };
  }

  async verifyDriverToken(token: string): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string }> {
    const { tenantSuspended: _tenantSuspended, ...driver } = await this.verifyDriverTokenCore(token, false);
    return driver;
  }

  async verifyDriverTokenForSettlement(token: string): Promise<{ repId: number; tenantId: string; accountId: string; name: string; phone: string; tenantSuspended: boolean }> {
    return this.verifyDriverTokenCore(token, true);
  }

  async driverListOrders(repId: number, tenantId: string, accountId: string, filters?: { dateFrom?: string; dateTo?: string; status?: string; page?: number; pageSize?: number }): Promise<Record<string, unknown>> {
    const { page, pageSize, offset } = boundedPage(filters?.page, filters?.pageSize);
    let query = this.db
      .selectFrom('sales')
      .leftJoin('customers', (join) => join.onRef('customers.id', '=', 'sales.customer_id').onRef('customers.tenant_id', '=', 'sales.tenant_id'))
      .select([
        'sales.id',
        'sales.doc_no as docNo',
        'sales.total',
        'sales.delivery_fee as deliveryFee',
        'sales.delivery_fee_mode as deliveryFeeMode',
        'customers.name as customerName',
        'customers.phone as customerPhone',
        'customers.address as customerAddress',
        'sales.order_type as orderType',
        'sales.delivery_rep_id as deliveryRepId',
        'sales.delivery_status as deliveryStatus',
        'sales.collection_status as collectionStatus',
        sql<string | null>`sales.delivery_signature`.as('deliverySignature'),
        sql<string | null>`sales.delivery_photo_url`.as('deliveryPhotoUrl'),
        sql<number | null>`sales.delivery_gps_lat`.as('deliveryGpsLat'),
        sql<number | null>`sales.delivery_gps_lng`.as('deliveryGpsLng'),
        sql<string | null>`sales.delivery_notes`.as('deliveryNotes'),
        'sales.settled_at as settledAt',
        'sales.created_at as createdAt',
      ])
      .where('sales.delivery_rep_id', '=', repId)
      .where('sales.tenant_id', '=', tenantId);

    if (filters?.status) {
      if (filters.status === 'pending') {
        query = query.where((eb) => eb.or([
          eb('sales.delivery_status', '!=', 'settled'),
          eb('sales.delivery_status', 'is', null),
        ]));
      } else if (filters.status === 'settled') {
        query = query.where('sales.delivery_status', '=', 'settled');
      }
    }

    const orders = await query.orderBy('sales.created_at', 'desc').orderBy('sales.id', 'desc').limit(pageSize + 1).offset(offset).execute();
    // INV-DRIVER-PORTAL-REMAINING-AMOUNT (M15): the driver portal
    // showed the raw invoice total per row (and summed it into the
    // pending badge) although the rep owes only the remaining cash
    // due — a prior return already reversed part of the receivable.
    // Mirror the listOrders pattern: each page row carries its
    // remaining cash due from deliverySettlementBasis (store-fleet:
    // remaining receivable; freelance: remaining receivable minus
    // remaining fee, floored at zero) as `remainingAmount`, while
    // `total` stays the invoice total. The driver token carries no
    // full session, so the basis runs on a minimal { tenantId,
    // accountId } scope — the only fields requireTenantScope reads.
    // Only the page rows are priced (pageSize <= 200), never the
    // lookahead row.
    const pageRows = orders.slice(0, pageSize);
    const driverActor = { tenantId, accountId } as AuthContext;
    const defaultMode = await this.getDeliveryFeeMode(this.db, driverActor);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const ordersWithRemaining = [];
    for (const row of pageRows) {
      const remainingAmount = await this.repOrderCashDue(
        { id: Number(row.id), delivery_fee_mode: (row as any).deliveryFeeMode ?? null },
        defaultMode,
        moneyDigits,
        driverActor,
      );
      ordersWithRemaining.push({ ...row, remainingAmount });
    }
    return { ok: true, orders: ordersWithRemaining, pagination: { page, pageSize, hasMore: orders.length > pageSize } };
  }

  async driverSettleOrder(
    saleId: number,
    repId: number,
    tenantId: string,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string }
  ): Promise<Record<string, unknown>> {
    await this.db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sales')
        .select(['id', 'delivery_rep_id', 'delivery_status', 'tenant_id'])
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!sale) throw new AppError('الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
      if (Number(sale.delivery_rep_id) !== Number(repId)) {
        throw new AppError('هذا الطلب غير مسند إلى هذا المندوب', 'NOT_ASSIGNED', 403);
      }
      if (sale.delivery_status === 'settled') {
        throw new AppError('تمت تسوية هذا الطلب مسبقاً', 'ALREADY_SETTLED', 400);
      }

      // Proof of delivery is not a cash settlement. The authorized cashier must
      // still post the courier's COD custody/treasury/GL atomically via settleOrder.
      if (sale.delivery_status === 'delivered') return;

      // C5 (INV-DISPATCH-STATE-GUARDS-AUDIT): proof of delivery is only
      // meaningful after dispatch — a pending order was never handed to
      // any rep, so marking it delivered would skip dispatch/custody
      // entirely (pending -> delivered directly).
      if (sale.delivery_status !== 'out_for_delivery') {
        throw new AppError('لا يمكن إثبات توصيل طلب لم يُصرف بعد؛ اصرف الطلب إلى المندوب أولاً', 'DELIVERY_NOT_DISPATCHED', 409);
      }

      const updateData: Record<string, any> = {
        delivery_status: 'delivered',
        updated_at: sql`NOW()`,
      };
      if (payload?.signatureDataUrl) updateData.delivery_signature = payload.signatureDataUrl;
      if (payload?.proofPhotoUrl) updateData.delivery_photo_url = payload.proofPhotoUrl;
      if (payload?.gpsLat !== undefined && payload?.gpsLat !== null) updateData.delivery_gps_lat = payload.gpsLat;
      if (payload?.gpsLng !== undefined && payload?.gpsLng !== null) updateData.delivery_gps_lng = payload.gpsLng;
      if (payload?.notes) updateData.delivery_notes = payload.notes;

      await trx
        .updateTable('sales')
        .set(updateData)
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .where('status', '!=', 'cancelled')
        .execute();
    });

    return { ok: true, message: 'تم إثبات تسليم الشحنة؛ عهدة التحصيل قيد التسوية' };
  }

  /**
   * Restaurant & F&B Dispatch Console: 1-click batch order dispatch to driver
   */
  async dispatchOrders(
    actor: AuthContext,
    payload: { repId: number; saleIds?: number[]; onlineOrderIds?: number[]; notes?: string }
  ) {
    const validateIds = (ids: number[] | undefined): number[] => {
      const values = ids || [];
      if (!Array.isArray(values) || values.length > 200 ||
          values.some(id => !Number.isSafeInteger(id) || id <= 0) ||
          new Set(values).size !== values.length) {
        throw new AppError('معرفات الطلبات غير صالحة أو مكررة', 'DELIVERY_DISPATCH_INVALID_IDS', 400);
      }
      return values;
    };
    const saleIds = validateIds(payload.saleIds);
    const onlineOrderIds = validateIds(payload.onlineOrderIds);
    if (!saleIds.length && !onlineOrderIds.length) {
      throw new AppError('اختر طلباً واحداً على الأقل', 'DELIVERY_DISPATCH_EMPTY', 400);
    }

    const result = await this.db.transaction().execute(async (trx) => {
      const rep = await trx.selectFrom('delivery_representatives')
        .select(['id', 'name', 'phone', 'is_active'])
        .where('id', '=', payload.repId).where(this.tenantPredicate(actor))
        .executeTakeFirst();
      if (!rep || !rep.is_active) {
        throw new AppError('مندوب التوصيل غير موجود أو غير نشط', 'DELIVERY_REP_NOT_FOUND', 404);
      }
      const now = new Date();
      const notifications: Array<{ recipientPhone: string; orderNumber: string; text: string }> = [];
      // D-SF-02 (INV-SF-COD-CUSTODY-GL): the sales dispatched in this
      // transaction (direct ids + online-order links) are the ones
      // whose receivable moves to courier custody below.
      const dispatchedSaleIds: number[] = [...saleIds];

      // C12 (INV-DISPATCH-STATE-GUARDS-AUDIT): one audit row per
      // dispatched item (sale or online order), written in this same
      // transaction so a rolled-back dispatch leaves no audit trace.
      // A re-assignment (oldRepId set) records old rep -> new rep.
      const auditEntries: Array<{ orderLabel: string; oldRepId: number | null }> = [];

      if (saleIds.length) {
        const sales = await trx.selectFrom('sales')
          .select(['id','doc_no','customer_phone','order_type','status','delivery_status','delivery_rep_id'])
          .where('id', 'in', saleIds).where(this.tenantPredicate(actor))
          .orderBy('id', 'asc').forUpdate().execute();
        if (sales.length !== saleIds.length ||
            sales.some(s => s.status === 'cancelled' ||
              ['delivered', 'settled'].includes(String(s.delivery_status)) ||
              (s.delivery_rep_id && Number(s.delivery_rep_id) !== Number(rep.id) &&
                !['pending', null].includes(s.delivery_status)))) {
          throw new AppError('لا يمكن إسناد طلب ملغي أو مسلّم بالفعل أو في عهدة مندوب آخر', 'DELIVERY_DISPATCH_FORBIDDEN', 409);
        }
        // C4: a pending order re-assigned to another rep is allowed,
        // but the old -> new rep move must be recorded, not silent.
        for (const s of sales) {
          auditEntries.push({
            orderLabel: `#${s.id}`,
            oldRepId: s.delivery_rep_id && Number(s.delivery_rep_id) !== Number(rep.id)
              ? Number(s.delivery_rep_id)
              : null,
          });
        }
        await trx.updateTable('sales').set({
          order_type: 'delivery',
          delivery_rep_id: rep.id,
          delivery_status: 'out_for_delivery',
          dispatched_at: now,
          ...(payload.notes ? { note: sql`COALESCE(note, '') || ${' [' + payload.notes + ']'}` as any } : {}),
        }).where('id', 'in', saleIds).where(this.tenantPredicate(actor)).execute();

        for (const s of sales) if (s.customer_phone) {
          notifications.push({
            recipientPhone: s.customer_phone,
            orderNumber: s.doc_no || `SALE-${s.id}`,
            text: `عزيزي العميل، طلبك رقم #${s.doc_no || s.id} في الطريق إليك مع كابتن التوصيل ${rep.name} (${rep.phone || ''}). نتمنى لك وجبة شهية!`,
          });
        }
      }

      if (onlineOrderIds.length) {
        const orders = await trx.selectFrom('online_orders')
          .select(['id','order_number','customer_phone','status','sale_id'])
          .where('id', 'in', onlineOrderIds).where(this.tenantPredicate(actor))
          .orderBy('id', 'asc').forUpdate().execute();
        if (orders.length !== onlineOrderIds.length ||
            orders.some(order => ['cancelled','delivered','returned'].includes(String(order.status)))) {
          throw new AppError('طلب أونلاين غير موجود أو أُلغي أو سُلّم بالفعل', 'DELIVERY_DISPATCH_FORBIDDEN', 409);
        }
        await trx.updateTable('online_orders').set({
          status: 'shipped', dispatched_at: now,
        }).where('id','in',onlineOrderIds).where(this.tenantPredicate(actor)).execute();

        const linkedSaleIds = orders.map(o => o.sale_id).filter((id): id is number => Boolean(id) && Number(id) > 0);
        dispatchedSaleIds.push(...linkedSaleIds);
        if (linkedSaleIds.length > 0) {
          // C2 (INV-DISPATCH-STATE-GUARDS-AUDIT): mirror the saleIds
          // guard on the linked sale — a settled sale, or one already
          // out for delivery in another rep's custody, must be
          // refused here too, not silently overwritten.
          const linkedSales = await trx.selectFrom('sales')
            .select(['id', 'status', 'delivery_status', 'delivery_rep_id'])
            .where('id', 'in', [...new Set(linkedSaleIds)]).where(this.tenantPredicate(actor))
            .orderBy('id', 'asc').forUpdate().execute();
          if (linkedSales.length !== new Set(linkedSaleIds).size ||
              linkedSales.some(s => s.status === 'cancelled' ||
                ['delivered', 'settled'].includes(String(s.delivery_status)) ||
                (s.delivery_rep_id && Number(s.delivery_rep_id) !== Number(rep.id) &&
                  !['pending', null].includes(s.delivery_status)))) {
            throw new AppError('لا يمكن إسناد طلب أونلاين مسلّم بالفعل أو مُسوَّى أو في عهدة مندوب آخر', 'DELIVERY_DISPATCH_FORBIDDEN', 409);
          }
          const linkedById = new Map(linkedSales.map(s => [Number(s.id), s]));
          for (const order of orders) {
            if (!order.sale_id) {
              auditEntries.push({ orderLabel: `أونلاين #${order.order_number || order.id}`, oldRepId: null });
              continue;
            }
            const linked = linkedById.get(Number(order.sale_id));
            auditEntries.push({
              orderLabel: `#${order.sale_id}`,
              oldRepId: linked && linked.delivery_rep_id && Number(linked.delivery_rep_id) !== Number(rep.id)
                ? Number(linked.delivery_rep_id)
                : null,
            });
          }
          await trx.updateTable('sales').set({
            order_type: 'delivery',
            delivery_rep_id: rep.id,
            delivery_status: 'out_for_delivery',
            dispatched_at: now,
            ...(payload.notes ? { note: sql`COALESCE(note, '') || ${' [' + payload.notes + ']'}` as any } : {}),
          }).where('id', 'in', linkedSaleIds).where(this.tenantPredicate(actor)).execute();
        } else {
          // Online orders with no linked sale still get an audit row.
          for (const order of orders) {
            auditEntries.push({ orderLabel: `أونلاين #${order.order_number || order.id}`, oldRepId: null });
          }
        }

        for (const order of orders) if (order.customer_phone) {
          notifications.push({
            recipientPhone: order.customer_phone,
            orderNumber: order.order_number,
            text: `عزيزي العميل، طلبك رقم #${order.order_number} في الطريق إليك مع كابتن التوصيل ${rep.name} (${rep.phone || ''}). نتمنى لك وجبة شهية!`,
          });
        }
      }
      // D-SF-02 (INV-SF-COD-CUSTODY-GL): dispatch moves the COD
      // receivable off the customer to courier custody — GL
      // reclassification plus the customer-ledger leg that takes
      // the customer balance to zero for the order, in this same
      // transaction. Prepaid / fully-returned sales are a no-op
      // inside the reclassification (remaining 0). A re-dispatch
      // to the same rep is idempotent there and writes no second
      // ledger leg.
      for (const dispatchedSaleId of dispatchedSaleIds) {
        const reclass = await this.accountingPosting.postDeliveryCustodyReclassification(trx, dispatchedSaleId, rep.id, actor);
        if (reclass.posted && reclass.amount > 0 && reclass.customerId) {
          await this.salesFinance.addCustomerLedgerLeg(trx, reclass.customerId, -reclass.amount, 'delivery_custody_transfer', `نقل عهدة فاتورة #${reclass.docNo} إلى مندوب التوصيل ${rep.name}`, 'sale', dispatchedSaleId, actor);
        }
      }
      // C12: one audit row per dispatched item, in this same
      // transaction. A re-assignment row names the old rep too.
      for (const entry of auditEntries) {
        const reassigned = entry.oldRepId !== null;
        await this.audit.logWithExecutor(trx,
          reassigned ? 'إعادة إسناد طلب توصيل' : 'إسناد طلب توصيل',
          reassigned
            ? `تمت إعادة إسناد الطلب ${entry.orderLabel} من المندوب #${entry.oldRepId} إلى المندوب ${rep.name} (#${rep.id}) بواسطة ${actor.username}`
            : `تم إسناد الطلب ${entry.orderLabel} إلى المندوب ${rep.name} (#${rep.id}) بواسطة ${actor.username}`,
          actor,
          { eventCode: 'DELIVERY_ORDER_DISPATCHED' });
      }
      return { rep, notifications };
    });

    return {
      success: true,
      repId: result.rep.id,
      repName: result.rep.name,
      dispatchedCount: saleIds.length + onlineOrderIds.length,
      notifications: result.notifications,
      message: `تم إسناد وانطلاق ${saleIds.length + onlineOrderIds.length} طلب بنجاح مع الكابتن ${result.rep.name}`,
    };
  }
}
