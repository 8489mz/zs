/*
 * Trip lifecycle for van sales (split-1 out of VanSalesService).
 * Pure move: the trip start/load/settlement lifecycle methods, unchanged,
 * behind the VanSalesService delegating facade. The facade owns the shared
 * stock/auth helpers; this service receives them bound via
 * VanTripLifecycleDeps, so the moved bodies are byte-identical to the
 * originals.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import {
  evaluateOdometerReadings,
  evaluateMakerCheckerSettlement,
  evaluateNightStockRetention,
  reconcileVanStockAudit,
} from '../van-trip-reconciliation.engine';
import {
  normalizeCustomerCode,
  getCustomerRepBalancesMap,
  getMonthlyOfficialHolidayDates,
  resolveVanMoneyAuditActor,
} from './van-common.util';
import {
  calculateRepTargetMetrics,
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
  evaluateBatchExpiryStatus,
  extractAssignedRepIds,
  resolveIsolatedRepCustomerBalance,
  type RepTargetCalculationResult,
} from '../rep-target.engine';
import { todayLocalIsoDate } from '../../sales/helpers/sales-write.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { computeCashDrawerVariance } from '../../cash-drawer/helpers/cash-drawer.helper';
import { boundedPage } from '../../../common/utils/bounded-page';
import { VanFraudRadarService, RecordVanSuspicionParams } from './van-fraud-radar.service';
import { authorizeManagerSecret } from '../../../common/utils/manager-approval';

export interface VanStockItem {
  productId: number;
  productName: string;
  barcode: string;
  qty: number;
  mainWarehouseQty?: number;
  costPrice: number;
  retailPrice: number;
  unitName?: string;
  originalPrice?: number;
  discountPerUnit?: number;
  hasActiveOffer?: boolean;
  offerBadge?: string;
  packagingUnit?: { name: string; multiplier: number };
  availableUnits?: { id: number; name: string; multiplier: number; isBase: boolean }[];
  earliestExpiryDate?: string | null;
  batchNumber?: string | null;
  expiryStatus?: 'valid' | 'near_expiry' | 'expired' | 'no_expiry';
  daysToExpiry?: number | null;
}

export interface VanTripSummary {
  id: number;
  repId: number;
  repName: string;
  vehicleId?: number;
  vehiclePlate?: string;
  vehicleModel?: string;
  shiftName?: string;
  startOdometer?: number;
  endOdometer?: number;
  vanLocationId: number;
  vanLocationName: string;
  sourceWarehouseId: number;
  sourceWarehouseName: string;
  status: 'open' | 'settled' | string;
  settlementStatus?: 'open' | 'submitted_by_rep' | 'settled' | string;
  openedAt: string;
  closedAt?: string;
  submittedAt?: string;
  loadedAmount: number;
  salesAmount: number;
  cashCollected: number;
  creditSales: number;
  returnsAmount: number;
  cashRefunds?: number;
  variance: number;
  distanceKm?: number;
  stockVarianceAmount?: number;
  nightStockApproved?: boolean;
  totalInstapaySales?: number;
  totalInstapayCollections?: number;
  notes?: string;
}

export type VanTripLifecycleDeps = {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  vanFraudRadarService: VanFraudRadarService;
  getOrCreateVanLocation: (repId: number, tenantId: string, accountId: string) => Promise<{ id: number; name: string }>;
  sortItemsByProductId: <T extends { productId: number }>(items: T[]) => T[];
  moveVanStock: (
    trx: Kysely<Database>,
    params: {
      productId: number;
      delta: number;
      locationId: number;
      branchId?: number | null;
      tenantId: string;
      accountId: string;
      userId?: number | null;
      movementType: string;
      note: string;
      referenceType: string;
      referenceId: number;
      skipGlobalUpdate: boolean;
      unitCost?: number;
    },
  ) => Promise<{ scopeBefore: number; scopeAfter: number }>;
  moveVanPharmacyBatches: (
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ) => Promise<number>;
  deductVanSalePharmacyBatches: (
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed?: boolean,
  ) => Promise<Array<{ pharmacyBatchId: number; quantity: number }>>;
  resolveSystemAuthContext: (tenantId: string, accountId: string, repId?: number | null) => Promise<AuthContext>;
  recordSuspicionEvent: (params: RecordVanSuspicionParams) => Promise<any>;
  listRepServedCustomerIds: (tenantId: string, repId: number) => Promise<Set<number>>;
  resolveRepLinkedUserId: (dbConn: any, tenantId: string, repId: number | null) => Promise<number | null>;
};

@Injectable()
export class VanTripLifecycleService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly vanFraudRadarService: VanFraudRadarService;
  private readonly getOrCreateVanLocation: VanTripLifecycleDeps['getOrCreateVanLocation'];
  private readonly sortItemsByProductId: VanTripLifecycleDeps['sortItemsByProductId'];
  private readonly moveVanStock: VanTripLifecycleDeps['moveVanStock'];
  private readonly moveVanPharmacyBatches: VanTripLifecycleDeps['moveVanPharmacyBatches'];
  private readonly deductVanSalePharmacyBatches: VanTripLifecycleDeps['deductVanSalePharmacyBatches'];
  private readonly resolveSystemAuthContext: VanTripLifecycleDeps['resolveSystemAuthContext'];
  private readonly recordSuspicionEvent: VanTripLifecycleDeps['recordSuspicionEvent'];
  private readonly listRepServedCustomerIds: VanTripLifecycleDeps['listRepServedCustomerIds'];
  private readonly resolveRepLinkedUserId: VanTripLifecycleDeps['resolveRepLinkedUserId'];

  constructor(deps: VanTripLifecycleDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.vanFraudRadarService = deps.vanFraudRadarService;
    this.getOrCreateVanLocation = deps.getOrCreateVanLocation;
    this.sortItemsByProductId = deps.sortItemsByProductId;
    this.moveVanStock = deps.moveVanStock;
    this.moveVanPharmacyBatches = deps.moveVanPharmacyBatches;
    this.deductVanSalePharmacyBatches = deps.deductVanSalePharmacyBatches;
    this.resolveSystemAuthContext = deps.resolveSystemAuthContext;
    this.recordSuspicionEvent = deps.recordSuspicionEvent;
    this.listRepServedCustomerIds = deps.listRepServedCustomerIds;
    this.resolveRepLinkedUserId = deps.resolveRepLinkedUserId;
  }

  private get anyDb(): any {
    return this.db as any;
  }

/**
   * Verifies a supervisor approval secret via the ONE shared
   * manager-approval rule (INV-SPIRIT-MANAGER-APPROVAL-SHARED /
   * INV-VAN-SUPERVISOR-PIN-AUTHORIZED): the shared manager PIN from
   * settings (bcrypt via authorizeManagerSecret; a legacy plaintext
   * stored value verifies once then hashes in place) or the login
   * password of an ACTIVE admin / super_admin. Plaintext
   * users.pin / pin_hash and delivery_representatives.pin_hash are
   * NEVER compared here: a bcrypt hash can never match a plaintext
   * comparison, so hashed PINs could never verify under the old code.
   * Maker-checker still enforced where the secret is attributable:
   * account mode carries the approver id, so the rep's own login
   * password approving his own operation is refused; PIN mode
   * carries no id — the shared PIN belongs to no single user, so no
   * attribution is invented (same honest limit as cash-drawer).
   * A shared-PIN approval therefore records no individual
   * (settled_by / supervisor_id / journal created_by stay null);
   * the old "first supervisor by id" attribution was false and is gone.
   */
  async verifySupervisorPin(
    tenantId: string,
    pinInput?: string | null,
    repId?: number | null,
    queryable?: any,
    accountId?: string | null,
  ): Promise<{
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
    supervisorRole?: string;
    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): HOW the approval
    // was given. 'pin' carries no user id (the shared PIN belongs to
    // no single user) — callers must record supervisor_id NULL plus
    // this mode, never fabricate an id; 'account' carries the
    // approving login's id in supervisorId.
    approvalMode?: 'pin' | 'account';
  }> {
    const cleanPin = String(pinInput || '').trim();
    if (!cleanPin) {
      return { approved: false };
    }

    const dbConn = queryable || this.anyDb;
    // Maker-checker needs the rep's linked login id only. The rep's
    // stored PIN values are never read for comparison here.
    let repUserId: number | null = null;
    if (repId && Number(repId) > 0) {
      const repRow = await dbConn
        .selectFrom('delivery_representatives')
        .select(['phone'])
        .where('id', '=', Number(repId))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (repRow?.phone) {
        const repUser = await dbConn
          .selectFrom('users')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`(phone = ${String(repRow.phone)} or username = ${String(repRow.phone)})`)
          .executeTakeFirst();
        if (repUser) {
          repUserId = Number(repUser.id);
        }
      }
    }

    // The shared rule needs tenant + account scope. Every production
    // caller passes its accountId; a direct caller that does not gets
    // the tenant's earliest user account as a best effort, and a
    // tenant with no users at all fails closed in requireTenantScope.
    let scopeAccountId = String(accountId || '').trim();
    if (!scopeAccountId) {
      try {
        const scopeUser = await dbConn
          .selectFrom('users')
          .select(['account_id'])
          .where('tenant_id', '=', tenantId)
          .orderBy('id', 'asc')
          .executeTakeFirst();
        scopeAccountId = String((scopeUser as any)?.account_id || '').trim();
      } catch {
        scopeAccountId = '';
      }
    }
    const approvalAuth: AuthContext = {
      userId: 0,
      sessionId: 'van-supervisor-pin',
      username: 'supervisor-pin',
      role: 'supervisor',
      permissions: [],
      tenantId,
      accountId: scopeAccountId,
    };

    let approval: { mode: 'pin' | 'account'; authorizedByName: string; authorizedById?: number };
    try {
      approval = await authorizeManagerSecret(dbConn, approvalAuth, cleanPin);
    } catch (err) {
      const code = (err as AppError)?.code;
      if (code === 'MANAGER_AUTH_INVALID' || code === 'MANAGER_AUTH_REQUIRED') {
        await this.vanFraudRadarService.recordSuspicionEvent({
          tenantId,
          repId: repId ? Number(repId) : null,
          eventCode: 'VAN_SUSPICION_INVALID_PIN',
          severity: 'high',
          titleAr: 'إدخال رمز اعتماد مشرف (PIN) خاطئ أو غير مصرح',
          detailsAr: 'حاول المندوب إدخال رمز اعتماد مشرف غير صحيح لتمرير عملية استثنائية في الميدان.',
          // M18: the actor is the rep entering the PIN.
          actorUserId: repUserId,
        });
        throw new AppError(
          'رمز اعتماد المشرف (PIN) غير صحيح أو غير مصرح له بالاعتماد الاستثنائي',
          'INVALID_SUPERVISOR_PIN',
          403,
        );
      }
      throw err;
    }

    // Account mode carries attribution, so the rep approving his own
    // operation with his own login password is refused here. PIN mode
    // carries no id and is never attributed to any user.
    if (
      approval.mode === 'account' &&
      approval.authorizedById &&
      repUserId &&
      Number(approval.authorizedById) === repUserId
    ) {
      await this.vanFraudRadarService.recordSuspicionEvent({
        tenantId,
        repId: repId ? Number(repId) : null,
        eventCode: 'VAN_SUSPICION_SELF_APPROVAL',
        severity: 'critical',
        titleAr: 'محاولة اعتماد ذاتي من المندوب لنفسه (خرق فصل المهام Maker-Checker)',
        detailsAr: 'حاول المندوب إدخال رمزه السري الشخصي لاعتماد عملية استثنائية لنفسه في الميدان بدلاً من المشرف.',
        // M18: the actor is the rep attempting the self-approval.
        actorUserId: repUserId,
      });
      throw new AppError(
        'لا يجوز لمندوب المبيعات استخدام رمزه الشخصي لاعتماد عملياته الميدانية طبقاً لمبدأ فصل المهام الرقابي (Maker-Checker)',
        'MAKER_CHECKER_SELF_APPROVAL',
        403,
      );
    }

    if (approval.mode === 'account') {
      if (approval.authorizedById) {
        const supervisorUser = await dbConn
          .selectFrom('users')
          .select(['role', sql<string>`coalesce(display_name, username)`.as('name')])
          .where('id', '=', Number(approval.authorizedById))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        return {
          approved: true,
          supervisorId: Number(approval.authorizedById),
          supervisorName: String(supervisorUser?.name || approval.authorizedByName || 'مشرف معتمد'),
          supervisorRole: String(supervisorUser?.role || 'admin'),
          approvalMode: 'account',
        };
      }
      return {
        approved: true,
        supervisorName: String(approval.authorizedByName || 'مشرف معتمد'),
        supervisorRole: 'admin',
        approvalMode: 'account',
      };
    }

    return {
      approved: true,
      supervisorName: String(approval.authorizedByName || 'اعتماد المدير'),
      supervisorRole: 'supervisor',
      approvalMode: 'pin',
    };
  }

/**
   * Checks whether the tenant requires supervisor PIN authorization for settling van trips.
   * Configurable via system settings (vanSettlementRequireSupervisorPin).
   * INV-VAN-SELF-SETTLE-PIN-REQUIRED: the PIN is required by DEFAULT
   * (fail closed). Only an explicit false setting disables it — a
   * missing row or an unparseable value never silently turns the PIN
   * off, because the driver settle endpoint must never let a rep
   * self-settle his own trip.
   */
  async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('key', '=', 'vanSettlementRequireSupervisorPin'),
          eb('key', '=', 'van_settlement_require_supervisor_pin'),
        ]),
      )
      .executeTakeFirst();
    if (!row?.value) return true;
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (parsed === false || parsed === 'false' || parsed === 0 || parsed === '0') return false;
      return true;
    } catch {
      return row.value === 'false' || row.value === '0' ? false : true;
    }
  }

/**
   * Checks whether the tenant enforces blind cash settlement for van trips.
   * In blind settlement mode, expected cash target and breakdown are hidden from the representative,
   * requiring physical cash counting without target confirmation.
   * Configurable via system settings (vanSettlementBlindMode).
   */
  async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('key', '=', 'vanSettlementBlindMode'),
          eb('key', '=', 'van_settlement_blind_mode'),
        ]),
      )
      .executeTakeFirst();
    if (!row?.value) return false;
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return Boolean(parsed === true || parsed === 'true' || parsed === 1 || parsed === '1');
    } catch {
      return row.value === 'true' || row.value === '1';
    }
  }

/**
   * Retrieves active open trip and current car inventory for a delivery representative.
   */
  async getActiveTrip(repId: number, tenantId: string, accountId: string): Promise<{
    hasActiveTrip: boolean;
    trip?: VanTripSummary;
    assignedVehicle?: {
      id: number;
      plateNumber: string;
      modelName?: string;
      vehicleType: string;
      currentOdometer: number;
      fuelType: string;
      licenseExpiresAt?: string;
      status: string;
    } | null;
    vanLocation?: { id: number; name: string };
    inventory: VanStockItem[];
    customers: {
      id: number;
      name: string;
      phone?: string;
      address?: string;
      balance: number;
      otherRepsBalance?: number;
      totalCompanyBalance?: number;
      creditLimit?: number;
      customerCode?: string;
      route?: string;
      assignedRepIds?: number[];
      locationUrl?: string;
    }[];
    recentSales: any[];
    sales?: any[];
    collections?: any[];
    returns?: any[];
    swaps?: any[];
    targetMetrics?: RepTargetCalculationResult;
    requireSupervisorPinForSettlement?: boolean;
    isBlindSettlement?: boolean;
  }> {
    const requireSupervisorPinForSettlement = await this.isSupervisorPinRequiredForSettlement(tenantId);
    const isBlindSettlement = await this.isBlindSettlementEnabled(tenantId);
    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);

    const assignedVehicleRow = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select([
        'id',
        'plate_number as plateNumber',
        'model_name as modelName',
        'vehicle_type as vehicleType',
        sql<number>`cast(coalesce(current_odometer, 0) as numeric)`.as('currentOdometer'),
        'fuel_type as fuelType',
        'license_expires_at as licenseExpiresAt',
        'status',
      ])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('assigned_rep_id', '=', repId),
          eb('van_location_id', '=', vanLoc.id),
        ])
      )
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const assignedVehicle = assignedVehicleRow
      ? {
          id: Number(assignedVehicleRow.id),
          plateNumber: String(assignedVehicleRow.plateNumber || ''),
          modelName: assignedVehicleRow.modelName || '',
          vehicleType: assignedVehicleRow.vehicleType || 'van',
          currentOdometer: Number(assignedVehicleRow.currentOdometer || 0),
          fuelType: assignedVehicleRow.fuelType || 'petrol_92',
          licenseExpiresAt: assignedVehicleRow.licenseExpiresAt ? String(assignedVehicleRow.licenseExpiresAt) : undefined,
          status: String(assignedVehicleRow.status || 'assigned'),
        }
      : null;

    const tripRow = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        sql<number>`cast(coalesce(vt.start_odometer, fv.current_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.settlement_status as settlementStatus',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        'vt.submitted_at as submittedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        sql<number>`cast(coalesce(vt.distance_km, 0) as numeric)`.as('distanceKm'),
        sql<number>`cast(coalesce(vt.stock_variance_amount, 0) as numeric)`.as('stockVarianceAmount'),
        sql<number>`cast(coalesce(vt.total_instapay_sales, 0) as numeric)`.as('totalInstapaySales'),
        sql<number>`cast(coalesce(vt.total_instapay_collections, 0) as numeric)`.as('totalInstapayCollections'),
        'vt.night_stock_approved as nightStockApproved',
        'vt.notes',
      ])
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .orderBy('vt.id', 'desc')
      .executeTakeFirst();

    // Fetch current inventory in the Van
    const invRows = await this.anyDb
      .selectFrom('product_location_stock as pls')
      .innerJoin('products as p', 'p.id', 'pls.product_id')
      .leftJoin('product_units as pu', (join: any) =>
        join.onRef('pu.product_id', '=', 'p.id').on('pu.multiplier', '>', 1),
      )
      .select([
        'p.id as productId',
        'p.name as productName',
        'p.barcode',
        'p.metadata as productMetadata',
        sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
        sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        sql<number>`cast(coalesce(p.wholesale_price, 0) as numeric)`.as('wholesalePrice'),
        'pu.name as unitName',
      ])
      .where('pls.location_id', '=', vanLoc.id)
      .where('pls.tenant_id', '=', tenantId)
      .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
      .orderBy('p.name', 'asc')
      .execute();

    // Determine source warehouse to query main stock
    let sourceWarehouseId = tripRow?.sourceWarehouseId ? Number(tripRow.sourceWarehouseId) : null;
    if (!sourceWarehouseId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      if (defaultWh) sourceWarehouseId = Number(defaultWh.id);
    }

    const mainStockMap = new Map<number, number>();
    if (sourceWarehouseId) {
      const sourceStocks = await this.anyDb
        .selectFrom('product_location_stock')
        .select(['product_id', sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', sourceWarehouseId)
        .where('tenant_id', '=', tenantId)
        .execute();
      for (const s of sourceStocks) {
        mainStockMap.set(Number(s.product_id), Number(s.qty || 0));
      }
    }

    // Query active promotional offers for van inventory items
    const prodIds = invRows.map((r: any) => Number(r.productId)).filter((id: number) => id > 0);
    // Offer windows use the pinned shared clock (INV-OFFER-SELECTION-
    // SHARED-POS-VAN): the same helper the sale writers use, so the
    // inventory fetch agrees with the writer instead of sampling UTC.
    const todayIso = todayLocalIsoDate();
    const activeOffers = prodIds.length > 0
      ? await this.anyDb
          .selectFrom('product_offers')
          .select(['id', 'product_id', 'offer_type', 'value', 'start_date', 'end_date', 'min_qty', 'bogo_buy_qty', 'bogo_get_qty', 'bogo_discount_percent'])
          .where('product_id', 'in', prodIds)
          .where('tenant_id', '=', tenantId)
          .where('is_active', '=', true)
          .where((eb: any) =>
            eb.and([
              eb.or([eb('start_date', 'is', null), eb('start_date', '<=', todayIso)]),
              eb.or([eb('end_date', 'is', null), eb('end_date', '>=', todayIso)]),
            ])
          )
          .orderBy('id', 'desc')
          .execute()
      : [];

    const offersByProdId = new Map<number, any>();
    for (const off of activeOffers) {
      const pid = Number(off.product_id);
      if (!offersByProdId.has(pid)) {
        offersByProdId.set(pid, off);
      }
    }

    // Query product units and FEFO batches for van inventory items
    const [rawUnits, batchRows] = prodIds.length > 0
      ? await Promise.all([
          this.anyDb
            .selectFrom('product_units')
            .select(['id', 'product_id', 'name', 'multiplier', 'is_base_unit'])
            .where('product_id', 'in', prodIds)
            .orderBy('multiplier', 'asc')
            .execute(),
          this.anyDb
            .selectFrom('pharmacy_batches')
            .select(['product_id', 'batch_number', 'expiry_date', 'quantity'])
            .where('tenant_id', '=', tenantId)
            .where('product_id', 'in', prodIds)
            .where(sql<boolean>`cast(coalesce(quantity, 0) as numeric) > 0`)
            .orderBy('expiry_date', 'asc')
            .execute()
            .catch(() => []),
        ])
      : [[], []];

    const fefoBatchByProdId = new Map<number, { batchNumber: string | null; expiryDate: string }>();
    for (const b of batchRows || []) {
      const pid = Number(b.product_id);
      if (!pid || !b.expiry_date) continue;
      if (!fefoBatchByProdId.has(pid)) {
        fefoBatchByProdId.set(pid, {
          batchNumber: b.batch_number ? String(b.batch_number) : null,
          expiryDate: String(b.expiry_date),
        });
      }
    }

    const unitsByProdId = new Map<number, any[]>();
    for (const u of rawUnits) {
      const pid = Number(u.product_id);
      if (!unitsByProdId.has(pid)) unitsByProdId.set(pid, []);
      unitsByProdId.get(pid)!.push({
        id: Number(u.id),
        name: u.name,
        multiplier: Number(u.multiplier || 1),
        isBase: Boolean(u.is_base_unit) || Number(u.multiplier) === 1,
      });
    }

    // Book digits resolved once (D4): the offer prices below round
    // at book digits, never a hardcoded 2dp.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const nowRef = new Date();
    const inventory: VanStockItem[] = invRows.map((r: any) => {
      const pid = Number(r.productId);
      const baseRetail = Number(r.retailPrice || 0);
      const offer = offersByProdId.get(pid);
      const availUnits = unitsByProdId.get(pid) || [];
      const packUnitObj = availUnits.find((u) => u.multiplier > 1);
      let effectiveRetail = baseRetail;
      let discountPerUnit = 0;
      let offerBadge: string | undefined;

      if (offer) {
        const offVal = Number(offer.value || 0);
        if (offer.offer_type === 'percent' && offVal > 0) {
          discountPerUnit = roundMoney((baseRetail * offVal) / 100, moneyDigits);
          effectiveRetail = Math.max(0, roundMoney(baseRetail - discountPerUnit, moneyDigits));
          offerBadge = `خصم ${offVal}%`;
        } else if (offer.offer_type === 'fixed' && offVal > 0) {
          discountPerUnit = Math.min(baseRetail, offVal);
          effectiveRetail = Math.max(0, roundMoney(baseRetail - discountPerUnit, moneyDigits));
          offerBadge = `خصم ${offVal} ج.م`;
        } else if (offer.offer_type === 'price' && offVal > 0) {
          effectiveRetail = offVal;
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = `سعر عرض خاص`;
        } else if (offer.offer_type === 'bundle' && offVal > 0) {
          const minQ = Math.max(1, Number(offer.min_qty || 1));
          effectiveRetail = roundMoney(offVal / minQ, moneyDigits);
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = `باقة ${minQ} قطع بسعر ${offVal}`;
        } else if (offer.offer_type === 'bogo') {
          const buyQ = Number(offer.bogo_buy_qty || 1);
          const getQ = Number(offer.bogo_get_qty || 1);
          const discPct = Number(offer.bogo_discount_percent ?? 100);
          const cycle = buyQ + getQ;
          const fullDisc = getQ * baseRetail * (discPct / 100);
          effectiveRetail = roundMoney(Math.max(0, (cycle * baseRetail) - fullDisc) / cycle, moneyDigits);
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = discPct === 100 ? `اشتري ${buyQ} واحصل على ${getQ} مجاناً` : `اشتري ${buyQ} و${getQ} بخصم ${discPct}%`;
        }
      }

      let metaObj: any = null;
      if (r.productMetadata) {
        if (typeof r.productMetadata === 'string') {
          try { metaObj = JSON.parse(r.productMetadata); } catch { metaObj = null; }
        } else if (typeof r.productMetadata === 'object') {
          metaObj = r.productMetadata;
        }
      }
      const fefoBatch = fefoBatchByProdId.get(pid);
      const rawExpiry = fefoBatch?.expiryDate || metaObj?.expiry_date || metaObj?.expiryDate || null;
      const rawBatchNo = fefoBatch?.batchNumber || metaObj?.batch_number || metaObj?.batchNumber || null;
      const expiryInfo = evaluateBatchExpiryStatus(rawExpiry, nowRef, 60);

      return {
        productId: pid,
        productName: r.productName || `صنف #${pid}`,
        barcode: r.barcode || '',
        qty: Number(r.qty || 0),
        mainWarehouseQty: mainStockMap.get(pid) || 0,
        costPrice: Number(r.costPrice || 0),
        retailPrice: effectiveRetail,
        // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: raw wholesale price for
        // the rep cart (same exposure as the already-exposed costPrice);
        // the writer re-derives the authoritative price server-side.
        wholesalePrice: Number(r.wholesalePrice || 0),
        originalPrice: offer && discountPerUnit > 0 ? baseRetail : undefined,
        discountPerUnit: discountPerUnit > 0 ? discountPerUnit : undefined,
        hasActiveOffer: Boolean(offer && discountPerUnit > 0),
        offerBadge,
        unitName: r.unitName || 'قطعة',
        // INV-VAN-PIECE-COUNT-BASIS: qty is in BASE units
        // (product_location_stock.qty is pieces), so the stock balance
        // is labeled with the base unit name — not the packaging name.
        // unitName stays the packaging name for the cart/picker, which
        // legitimately sells in cartons.
        stockUnitName: availUnits.find((u) => u.isBase)?.name || 'قطعة',
        packagingUnit: packUnitObj ? { name: packUnitObj.name, multiplier: packUnitObj.multiplier } : undefined,
        availableUnits: availUnits.length > 0 ? availUnits : undefined,
        earliestExpiryDate: expiryInfo.earliestExpiryDate,
        batchNumber: rawBatchNo ? String(rawBatchNo) : null,
        expiryStatus: expiryInfo.status,
        daysToExpiry: expiryInfo.daysRemaining,
      };
    });

    // Fetch route customers with per-rep isolated debt balances.
    // INV-REP-SCOPED-CUSTOMER-READS (H7/D1): the trip row is rep-scoped
    // but this list was not — it returned every active tenant customer.
    // A rep now sees only his own customers: explicitly assigned
    // (assigned_rep_ids in the customer metadata) plus served (a field
    // visit, a pre-sale order, or a delivered sale — the same served
    // definition as assertRepServedCustomer). Another rep's customers
    // and unassigned customers are excluded, with the same per-customer
    // field shape as before.
    const customerRows = await this.anyDb
      .selectFrom('customers as c')
      .select([
        'c.id',
        'c.name',
        'c.phone',
        'c.address',
        'c.metadata',
        'c.customer_type',
        sql<number>`cast(coalesce(c.credit_limit, 0) as numeric)`.as('creditLimit'),
        sql<number>`coalesce(c.balance, 0)`.as('balance'),
      ])
      .where('c.tenant_id', '=', tenantId)
      .where('c.is_active', '=', true)
      .orderBy('c.name', 'asc')
      .limit(2500)
      .execute();

    const servedCustomerIds = await this.listRepServedCustomerIds(tenantId, Number(repId));
    const scopedCustomerRows = customerRows.filter((c: any) => {
      const cid = Number(c.id);
      return extractAssignedRepIds(c.metadata).includes(Number(repId)) || servedCustomerIds.has(cid);
    });

    const customerIds: number[] = [];
    const customerTotalBalances: Record<number, number> = {};
    for (const c of scopedCustomerRows) {
      const cid = Number(c.id);
      customerIds.push(cid);
      customerTotalBalances[cid] = Number(c.balance || 0);
    }

    const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
      customerIds,
      customerTotalBalances,
      moneyDigits,
    });

    const customers = scopedCustomerRows.map((c: any) => {
      const cid = Number(c.id);
      let meta: any = {};
      if (typeof c.metadata === 'string') {
        try { meta = JSON.parse(c.metadata); } catch { meta = {}; }
      } else if (c.metadata && typeof c.metadata === 'object') {
        meta = c.metadata;
      }
      const assignedRepIds = extractAssignedRepIds(meta);
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: Number(repId),
        breakdown: repBalancesMap.get(cid),
        assignedRepIds,
        fallbackTotalBalance: Number(c.balance || 0),
        moneyDigits,
      });
      return {
        id: cid,
        name: c.name || `عميل #${cid}`,
        phone: c.phone || '',
        address: c.address || '',
        balance: isolated.repBalance,
        otherRepsBalance: isolated.otherRepsBalance,
        totalCompanyBalance: isolated.totalCustomerBalance,
        creditLimit: Number(c.creditLimit || 0),
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cid),
        route: meta.route || '',
        // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: the rep cart prices by
        // customer type, so the type rides the trip customers payload.
        customer_type: (c as any).customer_type || 'cash',
        assignedRepIds,
        locationUrl: meta.location_url || (meta.gps_lat && meta.gps_lng ? `https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}` : ''),
      };
    });

    // Fetch sales, collections and returns on this trip
    let recentSales: any[] = [];
    let tripCollections: any[] = [];
    let tripReturns: any[] = [];
    let tripSwaps: any[] = [];
    if (tripRow?.id) {
      const rawSales = await this.anyDb
        .selectFrom('sales as s')
        .leftJoin('customers as c', 'c.id', 's.customer_id')
        .select([
          's.id',
          's.doc_no as docNo',
          sql<number>`cast(s.total as double precision)`.as('total'),
          sql<number>`cast(coalesce(s.subtotal, s.total) as double precision)`.as('subtotal'),
          sql<number>`cast(coalesce(s.discount, 0) as double precision)`.as('discount'),
          's.payment_type as paymentMethod',
          's.created_at as createdAt',
          'c.name as customerName',
        ])
        .where('s.tenant_id', '=', tenantId)
        .where(sql<boolean>`s.van_trip_id = ${Number(tripRow.id)}`)
        .orderBy('s.id', 'desc')
        .limit(100)
        .execute();

      recentSales = rawSales.map((s: any) => ({
        ...s,
        id: Number(s.id),
        total: Number(s.total || 0),
        subtotal: Number(s.subtotal || s.total || 0),
        discount: Number(s.discount || 0),
      }));

      tripCollections = await this.anyDb
        .selectFrom('customer_ledger as cl')
        .leftJoin('customers as c', 'c.id', 'cl.customer_id')
        .select([
          'cl.id',
          sql<number>`cast(abs(coalesce(cl.amount, 0)) as numeric)`.as('amount'),
          'cl.created_at as createdAt',
          sql<string>`coalesce(c.name, 'عميل')`.as('customerName'),
          'cl.note',
          sql<number>`cast(cl.gps_lat as double precision)`.as('gpsLat'),
          sql<number>`cast(cl.gps_lng as double precision)`.as('gpsLng'),
        ])
        .where('cl.tenant_id', '=', tenantId)
        .where(sql<boolean>`cl.van_trip_id = ${Number(tripRow.id)}`)
        .where('cl.entry_type', '=', 'payment')
        .orderBy('cl.id', 'desc')
        .execute();

      tripReturns = await this.anyDb
        .selectFrom('van_field_returns as vfr')
        .leftJoin('customers as c', 'c.id', 'vfr.customer_id')
        .select([
          'vfr.id',
          'vfr.doc_no as docNo',
          sql<number>`cast(coalesce(vfr.total_amount, 0) as numeric)`.as('totalAmount'),
          'vfr.return_reason as returnReason',
          'vfr.refund_method as refundMethod',
          'vfr.status',
          'vfr.created_at as createdAt',
          sql<string>`coalesce(c.name, '')`.as('customerName'),
        ])
        .where('vfr.tenant_id', '=', tenantId)
        .where(sql<boolean>`vfr.trip_id = ${Number(tripRow.id)}`)
        .orderBy('vfr.id', 'desc')
        .execute();

      tripSwaps = await this.anyDb
        .selectFrom('van_damaged_swaps as vds')
        .leftJoin('products as dp', 'dp.id', 'vds.damaged_product_id')
        .leftJoin('products as rp', 'rp.id', 'vds.replacement_product_id')
        .leftJoin('customers as c', 'c.id', 'vds.customer_id')
        .select([
          'vds.id',
          'vds.damaged_product_id as damagedProductId',
          sql<string>`coalesce(dp.name, 'صنف تالف')`.as('damagedProductName'),
          sql<number>`cast(vds.damaged_qty as numeric)`.as('damagedQty'),
          'vds.damage_reason as damageReason',
          'vds.replacement_product_id as replacementProductId',
          sql<string>`coalesce(rp.name, 'صنف بديل')`.as('replacementProductName'),
          sql<number>`cast(vds.replacement_qty as numeric)`.as('replacementQty'),
          sql<number>`cast(vds.price_difference as numeric)`.as('priceDifference'),
          'vds.notes',
          'vds.created_at as createdAt',
          sql<string>`coalesce(c.name, '')`.as('customerName'),
        ])
        .where('vds.tenant_id', '=', tenantId)
        .where(sql<boolean>`vds.trip_id = ${Number(tripRow.id)}`)
        .orderBy('vds.id', 'desc')
        .execute();
    }

    // Calculate Monthly Sales Target for this representative
    const now = new Date();
    const currentPeriodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const targetRow = await this.anyDb
      .selectFrom('delivery_rep_targets')
      .select(['target_amount', 'collection_target', 'visits_target'])
      .where('rep_id', '=', repId)
      .where('period_month', '=', currentPeriodMonth)
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
    const actualCollectionsMtd = Number(collectionsMtdRow?.total_collected || 0);

    const visitsMtdRow = await this.anyDb
      .selectFrom('van_field_visits')
      .select([sql<number>`count(*)`.as('total_visits')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('visited_at', '>=', startOfMonth)
      .where('visited_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualVisitsMtd = Number(visitsMtdRow?.total_visits || 0);

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const todayVisitsRow = await this.anyDb
      .selectFrom('van_field_visits')
      .select([sql<number>`count(*)`.as('today_visits')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('visited_at', '>=', startOfToday)
      .where('visited_at', '<=', endOfToday)
      .executeTakeFirst();
    const todayVisits = Number(todayVisitsRow?.today_visits || 0);

    const officialHolidays = await getMonthlyOfficialHolidayDates(this.anyDb, tenantId, startOfMonth, endOfMonth);

    const metricsMoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const baseMetrics = calculateRepTargetMetrics({
      targetAmount,
      actualSalesMTD: actualSalesMtd,
      collectionTarget,
      actualCollectionsMTD: actualCollectionsMtd,
      visitsTarget,
      actualVisitsMTD: actualVisitsMtd,
      currentDate: now,
      weekendDays: [5], // Friday
      officialHolidays,
      moneyDigits: metricsMoneyDigits,
    });

    const todaySales = Number(tripRow?.salesAmount || 0);
    const todayCollections = Number(tripRow?.cashCollected || 0);

    const targetMetrics = {
      ...baseMetrics,
      todaySales,
      todayCollections,
      todayVisits,
    };

    if (!tripRow) {
      return {
        hasActiveTrip: false,
        assignedVehicle,
        vanLocation: vanLoc,
        inventory,
        customers,
        recentSales: [],
        targetMetrics,
        requireSupervisorPinForSettlement,
        isBlindSettlement,
      };
    }

    const trip: VanTripSummary = {
      id: Number(tripRow.id),
      repId: Number(tripRow.repId),
      repName: tripRow.repName,
      vehicleId: tripRow.vehicleId ? Number(tripRow.vehicleId) : (assignedVehicle ? assignedVehicle.id : undefined),
      vehiclePlate: tripRow.vehiclePlate || assignedVehicle?.plateNumber,
      vehicleModel: tripRow.vehicleModel || assignedVehicle?.modelName,
      startOdometer: Number(tripRow.startOdometer || assignedVehicle?.currentOdometer || 0),
      endOdometer: Number(tripRow.endOdometer || 0),
      vanLocationId: Number(tripRow.vanLocationId),
      vanLocationName: tripRow.vanLocationName,
      sourceWarehouseId: Number(tripRow.sourceWarehouseId),
      sourceWarehouseName: tripRow.sourceWarehouseName,
      status: tripRow.status as any,
      openedAt: String(tripRow.openedAt),
      closedAt: tripRow.closedAt ? String(tripRow.closedAt) : undefined,
      loadedAmount: Number(tripRow.loadedAmount || 0),
      salesAmount: Number(tripRow.salesAmount || 0),
      cashCollected: Number(tripRow.cashCollected || 0),
      creditSales: Number(tripRow.creditSales || 0),
      returnsAmount: Number(tripRow.returnsAmount || 0),
      cashRefunds: Number((tripRow as any).cashRefunds || 0),
      totalInstapaySales: Number((tripRow as any).totalInstapaySales || 0),
      totalInstapayCollections: Number((tripRow as any).totalInstapayCollections || 0),
      variance: Number(tripRow.variance || 0),
      notes: tripRow.notes || '',
    };

    return {
      hasActiveTrip: true,
      trip,
      assignedVehicle,
      vanLocation: vanLoc,
      inventory,
      customers,
      recentSales,
      sales: recentSales,
      collections: tripCollections,
      returns: tripReturns,
      swaps: tripSwaps,
      targetMetrics,
      requireSupervisorPinForSettlement,
      isBlindSettlement,
    };
  }

/**
   * Opens a new morning trip and loads merchandise from the main warehouse into the car stock.
   */
  async openTripAndLoad(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      sourceWarehouseId?: number;
      startOdometer?: number;
      items?: { productId: number; qty: number }[];
      notes?: string;
    },
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id'])
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .executeTakeFirst();

    if (existingTrip) {
      throw new AppError('توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة', 'TRIP_ALREADY_OPEN', 400);
    }

    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);
    let sourceLocId = payload.sourceWarehouseId ? Number(payload.sourceWarehouseId) : null;
    if (!sourceLocId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      sourceLocId = defaultWh ? Number(defaultWh.id) : 0;
    }

    // Lookup rep's assigned vehicle for starting odometer & plate
    const assignedVehicle = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select(['id', 'current_odometer'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('assigned_rep_id', '=', repId),
          eb('van_location_id', '=', vanLoc.id),
        ])
      )
      .orderBy('id', 'desc')
      .executeTakeFirst();

    let totalLoadedValue = 0;
    let totalLoadedCost = 0;
    // Book digits resolved once, before the transaction below opens
    // (D4): the loaded value below rounds at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    let createdTripId = 0;
    const hasItemsToLoad = Boolean(payload.items && payload.items.length > 0);

    // INV-VAN-TRIP-STARTED-AUDIT: resolve the actor before the
    // transaction (same pattern as the field-sale row) so the audit
    // row below names the acting rep's linked login — or null with
    // the rep named in the details when the rep has no linked login.
    const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the pre-check above runs on
      // an unlocked read, so two concurrent opens both pass it. This
      // locked re-check is the first statement of the transaction; the
      // partial unique index uq_van_trips_one_open_per_rep (migration
      // 2040000000314) is the backstop for the zero-row case a FOR
      // UPDATE read cannot lock (see the .catch on the transaction
      // below, which translates its violation to TRIP_ALREADY_OPEN).
      const lockedExistingTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id'])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .forUpdate()
        .executeTakeFirst();
      if (lockedExistingTrip) {
        throw new AppError('توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة', 'TRIP_ALREADY_OPEN', 400);
      }

      if (hasItemsToLoad) {
        if (sourceLocId === vanLoc.id) {
          throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
        }

        for (const item of this.sortItemsByProductId(payload.items!)) {
          const pid = Number(item.productId);
          const qty = Number(item.qty || 0);
          if (qty <= 0) continue;

          const effectiveLocId = Number((item as any).sourceWarehouseId || sourceLocId);
          if (effectiveLocId === vanLoc.id) {
            throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
          }

          // CANONICAL LOCK ORDER: Lock products first!
          const prod = await trxAny
            .selectFrom('products')
            .select(['id', 'name', 'cost_price', 'retail_price'])
            .where('id', '=', pid)
            .where('tenant_id', '=', tenantId)
            .forUpdate()
            .executeTakeFirst();

          if (!prod) {
            throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
          }

          const sourceStock = await trxAny
            .selectFrom('product_location_stock')
            .select(['qty'])
            .where('product_id', '=', pid)
            .where('location_id', '=', effectiveLocId)
            .where('tenant_id', '=', tenantId)
            .forUpdate()
            .executeTakeFirst();

          const avail = Number(sourceStock?.qty || 0);
          if (avail < qty) {
            throw new AppError(
              `رصيد المستودع المصدر لا يكفي للصنف "${prod?.name || pid}". المتوفر: ${avail}، المطلوب: ${qty}`,
              'INSUFFICIENT_SOURCE_STOCK',
              400,
            );
          }

          const price = Number(prod?.retail_price || 0);
          const cost = Number(prod?.cost_price || 0);
          totalLoadedValue += price * qty;
          totalLoadedCost += cost * qty;

          // Loading a van is a location-to-location move
          await this.moveVanStock(trx, {
            productId: pid,
            delta: -qty,
            locationId: effectiveLocId,
            tenantId,
            accountId,
            userId: null,
            movementType: 'van_load_out',
            note: `تحميل سيارة توزيع - خروج من المستودع`,
            referenceType: 'van_sales_trip',
            referenceId: 0,
            skipGlobalUpdate: false,
            unitCost: cost,
          });

          // INV-VAN-FEFO-BATCHES: the batches travel with the goods.
          await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);

          await this.moveVanStock(trx, {
            productId: pid,
            delta: qty,
            locationId: vanLoc.id,
            tenantId,
            accountId,
            userId: null,
            movementType: 'van_load_in',
            note: `تحميل سيارة توزيع - دخول للسيارة`,
            referenceType: 'van_sales_trip',
            referenceId: 0,
            skipGlobalUpdate: false,
            unitCost: cost,
          });
        }
      } else {
        // Start trip with existing stock already in van
        const existingStock = await trxAny
          .selectFrom('product_location_stock as pls')
          .innerJoin('products as p', 'p.id', 'pls.product_id')
          .select([
            sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
            sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
            sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
          ])
          .where('pls.location_id', '=', vanLoc.id)
          .where('pls.tenant_id', '=', tenantId)
          .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
          .execute();

        for (const s of existingStock) {
          totalLoadedValue += Number(s.qty || 0) * Number(s.retailPrice || 0);
          totalLoadedCost += Number(s.qty || 0) * Number(s.costPrice || 0);
        }
      }

      const insertedTrip = await trxAny
        .insertInto('van_sales_trips')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          rep_id: repId,
          vehicle_id: assignedVehicle?.id ? Number(assignedVehicle.id) : null,
          start_odometer: payload.startOdometer != null ? Number(payload.startOdometer) : (assignedVehicle?.current_odometer ? Number(assignedVehicle.current_odometer) : null),
          van_location_id: vanLoc.id,
          source_warehouse_id: sourceLocId || vanLoc.id,
          status: 'open',
          settlement_status: 'open',
          loaded_amount: roundMoney(totalLoadedValue, moneyDigits),
          sales_amount: 0,
          cash_collected: 0,
          credit_sales: 0,
          returns_amount: 0,
          variance: 0,
          notes: payload.notes || (hasItemsToLoad ? 'تحميل وتجهيز بضاعة الصباح لرحلة التوزيع الميداني' : 'بدء رحلة التوزيع بالبضاعة المتوفرة بالسيارة'),
          opened_at: sql`NOW()`,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      createdTripId = Number(insertedTrip.id);

      // INV-VAN-TRIP-STARTED-AUDIT: one audit row per trip start, in
      // this same transaction — a rolled-back open leaves no audit
      // trace, and a committed open always has one. Before this the
      // trip start wrote nothing, so the trip was invisible in the
      // admin audit log while its settlement is audited. The
      // function-check guards harnesses that pass a `{}` audit stub;
      // in production Nest always injects the real AuditService.
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'بدء رحلة توزيع',
          `بدأ المندوب ${auditActor.repName} (#${Number(repId)}) رحلة التوزيع #${createdTripId} — بضاعة محملة بقيمة ${roundMoney(totalLoadedValue, moneyDigits)} (${Number(payload.items?.length || 0)} صنف)`,
          { userId: auditActor.userId, tenantId, accountId },
          { eventCode: AUDIT_EVENT_CODES.VAN_TRIP_STARTED },
        );
      }

      // Post van loading stock transfer journal
      if (hasItemsToLoad && totalLoadedCost > 0) {
        const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
        const vanLocRow = await trxAny
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLoc.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
        await this.accountingPosting.postVanStockTransfer(
          trx,
          createdTripId,
          {
            sourceLocationId: sourceLocId || vanLoc.id,
            targetLocationId: vanLoc.id,
            totalCost: totalLoadedCost,
            branchId,
            type: 'load',
          },
          systemAuth,
        );
      }
    }).catch((err: any) => {
      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the unique-index backstop
      // (uq_van_trips_one_open_per_rep) fired — a concurrent open won
      // the race. Translate only that index's violation; any other
      // error (journal dedup, stock) rethrows untouched.
      const message = String(err?.message || '');
      if (message.includes('uq_van_trips_one_open_per_rep')) {
        throw new AppError('توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة', 'TRIP_ALREADY_OPEN', 400);
      }
      throw err;
    });

    return {
      ok: true,
      tripId: createdTripId,
      totalLoadedValue: roundMoney(totalLoadedValue, moneyDigits),
      itemsCount: payload.items?.length || 0,
    };
  }

/**
   * Loads supplementary stock into an existing active van trip (e.g. from an approved load requisition).
   * Adheres strictly to canonical lock order, dual stock movements, and ledger posting invariants.
   */
  async loadSupplementaryStockToActiveTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    tripId: number,
    payload: {
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number }[];
      notes?: string;
    },
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', tripId)
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .executeTakeFirst();

    if (!existingTrip) {
      throw new AppError('رحلة التوزيع المحددة غير موجودة أو تم إغلاقها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);
    let sourceLocId = payload.sourceWarehouseId ? Number(payload.sourceWarehouseId) : null;
    if (!sourceLocId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      sourceLocId = defaultWh ? Number(defaultWh.id) : 0;
    }

    let totalLoadedValue = 0;
    let totalLoadedCost = 0;
    // Book digits resolved once, before the transaction below opens
    // (D4): the loaded value below rounds at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const hasItemsToLoad = Boolean(payload.items && payload.items.length > 0);

    if (!hasItemsToLoad) {
      return { ok: true, tripId, totalLoadedValue: 0, itemsCount: 0 };
    }

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      if (sourceLocId === vanLoc.id) {
        throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
      }

      for (const item of this.sortItemsByProductId(payload.items)) {
        const pid = Number(item.productId);
        const qty = Number(item.qty || 0);
        if (qty <= 0) continue;

        const effectiveLocId = Number((item as any).sourceWarehouseId || sourceLocId);
        if (effectiveLocId === vanLoc.id) {
          throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
        }

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['id', 'name', 'cost_price', 'retail_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!prod) {
          throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
        }

        const sourceStock = await trxAny
          .selectFrom('product_location_stock')
          .select(['qty'])
          .where('product_id', '=', pid)
          .where('location_id', '=', effectiveLocId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        const avail = Number(sourceStock?.qty || 0);
        if (avail < qty) {
          throw new AppError(
            `رصيد المستودع المصدر لا يكفي للصنف "${prod?.name || pid}". المتوفر: ${avail}، المطلوب: ${qty}`,
            'INSUFFICIENT_SOURCE_STOCK',
            400,
          );
        }

        const price = Number(prod?.retail_price || 0);
        const cost = Number(prod?.cost_price || 0);
        totalLoadedValue += price * qty;
        totalLoadedCost += cost * qty;

        // Loading supplementary van stock is a location-to-location move
        await this.moveVanStock(trx, {
          productId: pid,
          delta: -qty,
          locationId: effectiveLocId,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_load_out',
          note: `تحميل سيارة توزيع إضافي (استعواض) - خروج من المستودع`,
          referenceType: 'van_sales_trip',
          referenceId: tripId,
          skipGlobalUpdate: false,
          unitCost: cost,
        });

        // INV-VAN-FEFO-BATCHES: the batches travel with the goods.
        await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);

        await this.moveVanStock(trx, {
          productId: pid,
          delta: qty,
          locationId: vanLoc.id,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_load_in',
          note: `تحميل سيارة توزيع إضافي (استعواض) - دخول للسيارة`,
          referenceType: 'van_sales_trip',
          referenceId: tripId,
          skipGlobalUpdate: false,
          unitCost: cost,
        });
      }

      const additionalNote = payload.notes || 'تحميل بضاعة إضافية (استعواض أثناء اليوم)';
      await trxAny
        .updateTable('van_sales_trips')
        .set({
          loaded_amount: sql`coalesce(loaded_amount, 0) + ${roundMoney(totalLoadedValue, moneyDigits)}`,
          notes: sql`case 
            when notes is null or notes = '' then ${additionalNote}
            else notes || E'\n' || ${additionalNote}
          end`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', tripId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Post van loading stock transfer journal
      if (totalLoadedCost > 0) {
        const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
        const vanLocRow = await trxAny
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLoc.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
        await this.accountingPosting.postVanStockTransfer(
          trx,
          tripId,
          {
            sourceLocationId: sourceLocId || vanLoc.id,
            targetLocationId: vanLoc.id,
            totalCost: totalLoadedCost,
            branchId,
            type: 'load',
          },
          systemAuth,
        );
      }
    });

    return {
      ok: true,
      tripId,
      totalLoadedValue: roundMoney(totalLoadedValue, moneyDigits),
      itemsCount: payload.items.length,
    };
  }

/**
   * Driver submits daily trip closing report (cash handover, odometer reading, and stock unload request).
   * Status transitions to `submitted_by_rep`, pending supervisor review.
   */
  async submitTripSettlement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      countedCash: number;
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    variance: number;
    distanceKm: number;
    status: 'submitted_by_rep';
    message: string;
  }> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .where((eb: any) => eb.or([eb('vt.status', '=', 'open'), eb('vt.settlement_status', '=', 'open')]))
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('الرحلة غير موجودة أو تم تقديم إقرارها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    const odometerResult = evaluateOdometerReadings({
      startOdometer: trip.start_odometer,
      endOdometer: payload.endOdometer,
    });

    if (!odometerResult.valid) {
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK,
        severity: 'high',
        titleAr: 'تلاعب في قراءة عداد الكيلومترات عند تقديم إقرار التصفية',
        detailsAr: odometerResult.errorMessageAr || `قراءة العداد النهائية (${payload.endOdometer}) غير متسقة مع قراءة البداية (${trip.start_odometer}).`,
        // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the actor is the
        // rep submitting the statement — his linked login, resolved
        // here; the radar falls back to the same resolution when it
        // is absent, so this is explicit threading, not a new path.
        actorUserId: await this.resolveRepLinkedUserId(this.anyDb, tenantId, repId),
        metadata: {
          startOdometer: trip.start_odometer,
          endOdometer: payload.endOdometer,
        },
      });
      throw new AppError(odometerResult.errorMessageAr!, 'INVALID_ODOMETER', 400);
    }

    const expectedCash = Number(trip.cash_collected || 0);
    const countedCash = Number(payload.countedCash || 0);
    // Cash variance at tenant book digits via the shared drawer helper
    // (was hardcoded toFixed(2)).
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const variance = computeCashDrawerVariance(countedCash, expectedCash, bookDigits);

    await this.anyDb
      .updateTable('van_sales_trips')
      .set({
        settlement_status: 'submitted_by_rep',
        submitted_at: sql`NOW()`,
        end_odometer: payload.endOdometer !== undefined ? payload.endOdometer : null,
        distance_km: odometerResult.distanceKm,
        variance,
        notes: payload.notes || `إقرار تصفية مقدم من المندوب بانتظار اعتماد المشرف. عجز/زيادة: ${variance}`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .execute();

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the submitted
    // statement is itself a money action (the rep declares the cash
    // he holds); it gets its own audit row naming the submitting
    // rep. Best-effort is wrong here — this method has no
    // transaction, so the row is written right after the update it
    // describes. The function-check guards harnesses that pass a
    // `{}` audit stub.
    if (this.audit && typeof this.audit.log === 'function') {
      const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);
      await this.audit.log(
        'تقديم إقرار تصفية رحلة',
        `قدّم المندوب ${auditActor.repName} (#${Number(repId)}) إقرار تصفية الرحلة #${Number(payload.tripId)} — متوقع ${expectedCash}، معدود ${countedCash}، فرق ${variance} — بانتظار اعتماد المشرف`,
        { userId: auditActor.userId, tenantId, accountId },
        { eventCode: AUDIT_EVENT_CODES.VAN_TRIP_SETTLEMENT_SUBMITTED },
      );
    }

    // Auto-record / end active visit if rep had an open visit upon submission
    if (payload.activeVisitCustomerId) {
      const custId = Number(payload.activeVisitCustomerId);
      if (custId > 0) {
        const existingVisit = await this.anyDb
          .selectFrom('van_field_visits')
          .select(['id'])
          .where('trip_id', '=', payload.tripId)
          .where('customer_id', '=', custId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (!existingVisit) {
          const custSale = await this.anyDb
            .selectFrom('sales')
            .select(['id'])
            .where('van_trip_id', '=', payload.tripId)
            .where('customer_id', '=', custId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();

          await this.anyDb
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
              notes: 'تم إنهاء وتوثيق الزيارة تلقائياً عند تقديم إقرار التصفية',
              visited_at: sql`NOW()`,
              created_at: sql`NOW()`,
            })
            .execute();
        }
      }
    }

    return {
      ok: true,
      tripId: payload.tripId,
      expectedCash,
      countedCash,
      variance,
      distanceKm: odometerResult.distanceKm,
      status: 'submitted_by_rep',
      message: 'تم تسليم إقرار الرحلة والنقدية بنجاح، وبانتظار اعتماد المشرف وأمين المستودع',
    };
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
      ? (payload.supervisorId != null && Number(payload.supervisorId) > 0 ? Number(payload.supervisorId) : 0)
      : (authContext?.userId ? Number(authContext.userId) : 0);
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
          authContext.permissions.some((p: string) =>
            ['deliveryReps', 'accounting'].includes(p),
          ));

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
    const effectiveEndOdometer = payload.endOdometer !== undefined ? payload.endOdometer : (trip.end_odometer !== null ? Number(trip.end_odometer) : undefined);
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
        detailsAr: odometerResult.errorMessageAr || `قراءة العداد النهائية (${effectiveEndOdometer}) أقل من قراءة البداية (${trip.start_odometer}).`,
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
        .select(['id', 'status', 'van_location_id', 'source_warehouse_id', 'cash_collected', 'vehicle_id', 'sales_amount', 'credit_sales', 'returns_amount', 'cash_refunds', 'total_instapay_sales', 'total_instapay_collections'])
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
        const names = stockAuditResult.uncountedItems
          .map((u) => `${u.productName} (#${u.productId})`)
          .join('، ');
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
          await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, vanLocationId, Number(lockedTrip.source_warehouse_id));

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
      await trxAny
        .updateTable('van_sales_trips')
        .set({
          status: 'settled',
          settlement_status: 'settled',
          closed_at: sql`NOW()`,
          settled_by: actorUserId || null,
          supervisor_id: actorUserId || null,
          stock_variance_amount: totalStockVarianceCost,
          stock_variance_details: stockAuditResult?.itemVariances?.length ? JSON.stringify(stockAuditResult.itemVariances) : null,
          night_stock_approved: Boolean(payload.nightStockApproved),
          night_stock_approved_by: payload.nightStockApproved ? (actorUserId || null) : null,
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
            settled_by: effectiveChargeToRep ? null : (actorUserId || null),
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
      const remittedCash = roundMoney(countedCash, bookDigits);
      if (remittedCash > 0) {
        await this.insertRepCashRemittanceRow(trx, {
          tenantId,
          accountId,
          tripId: payload.tripId,
          repName: rep?.name ? String(rep.name) : 'مندوب التوزيع',
          amount: remittedCash,
          branchId,
          actorUserId,
          createdBy: actorUserId > 0 ? actorUserId : (systemAuth.userId ? Number(systemAuth.userId) : null),
        });
      }

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
      expectedBankTransfers: roundMoney(Number(lockedTripTotals.total_instapay_sales || 0) + Number(lockedTripTotals.total_instapay_collections || 0), bookDigits),
      stockVariances: (stockAuditResult as any)?.itemVariances || [],
    };
  }

/**
   * INV-REP-CASH-REMITTANCE-SHIFT: links a settled trip's counted cash
   * to the receiving shift with a single treasury row — no GL journal.
   * The rep's custody is discharged by the same transaction that
   * posts the settlement journal and marks the trip settled, so the
   * row, the journal, and the custody release commit or roll back
   * together; there is no separate custody balance to update. The
   * receiving shift is the settle actor's own open shift on the
   * branch (the PIN supervisor / admin settler is the person the rep
   * hands the cash to); with no actor, the branch's latest open shift
   * receives it — the same branch-only fallback granularity the
   * cross-shift cancel refund uses. No open shift on the branch fails
   * closed: cash with no drawer must not settle. The deterministic
   * request key (one per trip, scoped by the partial unique index on
   * drawer rows) makes a retried handover collide instead of
   * doubling the shift's expected cash. The note carries 'مندوب' so
   * the drawer listing classifies the row as a delivery receipt, as
   * it does for every other rep handover row operators record.
   */
  private async insertRepCashRemittanceRow(
    trx: any,
    params: {
      tenantId: string;
      accountId: string;
      tripId: number;
      repName: string;
      amount: number;
      branchId: number | null;
      actorUserId: number;
      createdBy: number | null;
    },
  ): Promise<void> {
    const { tenantId, accountId, tripId, amount, branchId } = params;
    const branchMatch = (eb: any) =>
      branchId == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', branchId);
    type ShiftRow = { id: number; branch_id: number | null; location_id: number | null };
    let shift: ShiftRow | undefined;
    if (params.actorUserId > 0) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where('opened_by', '=', params.actorUserId)
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    if (!shift) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    if (!shift) {
      throw new AppError('يجب فتح وردية على الفرع قبل توريد نقدية المندوب', 'OPEN_SHIFT_REQUIRED', 400);
    }
    await trx
      .insertInto('treasury_transactions')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        txn_type: 'rep_cash_remittance',
        amount,
        note: `توريد نقدية مندوب ${params.repName} - رحلة #${tripId}`,
        reference_type: 'cashier_shift',
        reference_id: Number(shift.id),
        branch_id: shift.branch_id ? Number(shift.branch_id) : null,
        location_id: shift.location_id ? Number(shift.location_id) : null,
        created_by: params.createdBy,
        payment_channel: 'cash',
        request_key: `rep-remittance:trip:${tripId}`,
      } as any)
      .execute();
  }

/**
   * Admin audit list of all van trips.
   */
  async listTripsForAdmin(
    tenantId: string,
    filters?: { repId?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<VanTripSummary[]> {
    let query = this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        'vt.shift_name as shiftName',
        sql<number>`cast(coalesce(vt.start_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.settlement_status as settlementStatus',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        'vt.submitted_at as submittedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        sql<number>`cast(coalesce(vt.distance_km, 0) as numeric)`.as('distanceKm'),
        sql<number>`cast(coalesce(vt.stock_variance_amount, 0) as numeric)`.as('stockVarianceAmount'),
        'vt.night_stock_approved as nightStockApproved',
        'vt.notes',
      ])
      .where('vt.tenant_id', '=', tenantId);

    if (filters?.repId) {
      query = query.where('vt.rep_id', '=', Number(filters.repId));
    }
    if (filters?.status) {
      query = query.where('vt.status', '=', filters.status);
    }
    if (filters?.dateFrom) {
      query = query.where('vt.opened_at', '>=', new Date(filters.dateFrom));
    }
    if (filters?.dateTo) {
      query = query.where('vt.opened_at', '<=', new Date(filters.dateTo));
    }

    const rows = await query.orderBy('vt.id', 'desc').limit(50).execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      repId: Number(r.repId),
      repName: r.repName,
      vehicleId: r.vehicleId ? Number(r.vehicleId) : undefined,
      vehiclePlate: r.vehiclePlate || undefined,
      vehicleModel: r.vehicleModel || undefined,
      shiftName: r.shiftName || 'صباحي',
      startOdometer: Number(r.startOdometer || 0),
      endOdometer: r.endOdometer ? Number(r.endOdometer) : undefined,
      vanLocationId: Number(r.vanLocationId),
      vanLocationName: r.vanLocationName,
      sourceWarehouseId: Number(r.sourceWarehouseId),
      sourceWarehouseName: r.sourceWarehouseName,
      status: r.status as any,
      openedAt: String(r.openedAt),
      closedAt: r.closedAt ? String(r.closedAt) : undefined,
      loadedAmount: Number(r.loadedAmount || 0),
      salesAmount: Number(r.salesAmount || 0),
      cashCollected: Number(r.cashCollected || 0),
      creditSales: Number(r.creditSales || 0),
      returnsAmount: Number(r.returnsAmount || 0),
      cashRefunds: Number(r.cashRefunds || 0),
      variance: Number(r.variance || 0),
      notes: r.notes || '',
    }));
  }

/**
   * Admin detailed audit of a single van trip, including all sales (with GPS), collections (with GPS), and returns.
   */
  async getTripDetailsForAdmin(tenantId: string, tripId: number, pagination?: { page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = boundedPage(pagination?.page, pagination?.pageSize);
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<string>`coalesce(dr.phone, '')`.as('repPhone'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        'vt.shift_name as shiftName',
        sql<number>`cast(coalesce(vt.start_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        'vt.notes',
      ])
      .where('vt.id', '=', tripId)
      .where('vt.tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('رحلة التوزيع الميداني غير موجودة', 'TRIP_NOT_FOUND', 404);
    }

    // Sales executed in this trip
    const sales = await this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', (join: any) => join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
      .select([
        's.id',
        's.doc_no as docNo',
        sql<number>`cast(coalesce(s.total, 0) as numeric)`.as('total'),
        sql<string>`coalesce(s.payment_type, 'cash')`.as('paymentMethod'),
        's.created_at as createdAt',
        sql<string>`coalesce(c.name, 'عميل نقدي')`.as('customerName'),
        sql<string>`coalesce(c.phone, '')`.as('customerPhone'),
        'c.metadata as customerMetadata',
        sql<number>`cast(s.delivery_gps_lat as double precision)`.as('deliveryGpsLat'),
        sql<number>`cast(s.delivery_gps_lng as double precision)`.as('deliveryGpsLng'),
      ])
      .where('s.tenant_id', '=', tenantId)
      .where(sql<boolean>`s.van_trip_id = ${tripId}`)
      .orderBy('s.id', 'desc')
      .limit(pageSize + 1).offset(offset)
      .execute();

    // Collections recorded in this trip
    const collections = await this.anyDb
      .selectFrom('customer_ledger as cl')
      .leftJoin('customers as c', (join: any) => join.onRef('c.id', '=', 'cl.customer_id').onRef('c.tenant_id', '=', 'cl.tenant_id'))
      .select([
        'cl.id',
        sql<number>`cast(abs(coalesce(cl.amount, 0)) as numeric)`.as('amount'),
        'cl.created_at as createdAt',
        sql<string>`coalesce(c.name, 'عميل')`.as('customerName'),
        'c.metadata as customerMetadata',
        'cl.note',
        sql<number>`cast(cl.gps_lat as double precision)`.as('gpsLat'),
        sql<number>`cast(cl.gps_lng as double precision)`.as('gpsLng'),
      ])
      .where('cl.tenant_id', '=', tenantId)
      .where(sql<boolean>`cl.van_trip_id = ${tripId}`)
      .where('cl.entry_type', '=', 'payment')
      .orderBy('cl.id', 'desc')
      .limit(pageSize + 1).offset(offset)
      .execute();

    // Field returns recorded in this trip
    const returns = await this.anyDb
      .selectFrom('van_field_returns as vfr')
      .leftJoin('customers as c', (join: any) => join.onRef('c.id', '=', 'vfr.customer_id').onRef('c.tenant_id', '=', 'vfr.tenant_id'))
      .select([
        'vfr.id',
        'vfr.doc_no as docNo',
        sql<number>`cast(coalesce(vfr.total_amount, 0) as numeric)`.as('totalAmount'),
        'vfr.return_reason as returnReason',
        'vfr.refund_method as refundMethod',
        'vfr.status',
        'vfr.created_at as createdAt',
        sql<string>`coalesce(c.name, '')`.as('customerName'),
      ])
      .where('vfr.tenant_id', '=', tenantId)
      .where('vfr.trip_id', '=', tripId)
      .orderBy('vfr.id', 'desc')
      .limit(pageSize + 1).offset(offset)
      .execute();

    // Inventory currently on van location
    const vanStock = await this.anyDb
      .selectFrom('product_location_stock as pls')
      .innerJoin('products as p', 'p.id', 'pls.product_id')
      .select([
        'p.id as productId',
        'p.name as productName',
        'p.barcode as barcode',
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
      ])
      .where('pls.location_id', '=', Number(trip.vanLocationId))
      .where('pls.tenant_id', '=', tenantId)
      .where(sql<boolean>`pls.qty > 0`)
      .orderBy('p.name', 'asc')
      .execute();

    return {
      trip: {
        ...trip,
        id: Number(trip.id),
        repId: Number(trip.repId),
        startOdometer: Number(trip.startOdometer || 0),
        endOdometer: trip.endOdometer ? Number(trip.endOdometer) : undefined,
        loadedAmount: Number(trip.loadedAmount || 0),
        salesAmount: Number(trip.salesAmount || 0),
        cashCollected: Number(trip.cashCollected || 0),
        creditSales: Number(trip.creditSales || 0),
        returnsAmount: Number(trip.returnsAmount || 0),
        cashRefunds: Number((trip as any).cashRefunds || 0),
        variance: Number(trip.variance || 0),
      },
      pagination: { page, pageSize, salesHasMore: sales.length > pageSize, collectionsHasMore: collections.length > pageSize, returnsHasMore: returns.length > pageSize },
      sales: sales.slice(0, pageSize).map((s: any) => {
        const custCoords = extractCoordinatesFromCustomerLocation({ metadata: s.customerMetadata });
        const geo = evaluateGeofenceCompliance({
          repLat: s.deliveryGpsLat != null ? Number(s.deliveryGpsLat) : null,
          repLng: s.deliveryGpsLng != null ? Number(s.deliveryGpsLng) : null,
          customerLat: custCoords?.lat ?? null,
          customerLng: custCoords?.lng ?? null,
          maxAllowedMeters: 300,
        });
        const { customerMetadata: _cm, ...rest } = s;
        return {
          ...rest,
          id: Number(s.id),
          total: Number(s.total || 0),
          deliveryGpsLat: s.deliveryGpsLat != null ? Number(s.deliveryGpsLat) : undefined,
          deliveryGpsLng: s.deliveryGpsLng != null ? Number(s.deliveryGpsLng) : undefined,
          distanceMeters: geo.distanceMeters,
          isWithinGeofence: geo.isCompliant,
          geofenceStatus: geo.status,
        };
      }),
      collections: collections.slice(0, pageSize).map((c: any) => {
        const custCoords = extractCoordinatesFromCustomerLocation({ metadata: c.customerMetadata });
        const geo = evaluateGeofenceCompliance({
          repLat: c.gpsLat != null ? Number(c.gpsLat) : null,
          repLng: c.gpsLng != null ? Number(c.gpsLng) : null,
          customerLat: custCoords?.lat ?? null,
          customerLng: custCoords?.lng ?? null,
          maxAllowedMeters: 300,
        });
        const { customerMetadata: _cm, ...rest } = c;
        return {
          ...rest,
          id: Number(c.id),
          amount: Number(c.amount || 0),
          gpsLat: c.gpsLat != null ? Number(c.gpsLat) : undefined,
          gpsLng: c.gpsLng != null ? Number(c.gpsLng) : undefined,
          distanceMeters: geo.distanceMeters,
          isWithinGeofence: geo.isCompliant,
          geofenceStatus: geo.status,
        };
      }),
      returns: returns.slice(0, pageSize).map((r: any) => ({
        ...r,
        id: Number(r.id),
        totalAmount: Number(r.totalAmount || 0),
        refundMethod: r.refundMethod || 'credit',
      })),
      vanStock: vanStock.map((v: any) => ({
        ...v,
        productId: Number(v.productId),
        retailPrice: Number(v.retailPrice || 0),
        qty: Number(v.qty || 0),
      })),
    };
  }
}
