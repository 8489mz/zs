import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import {
  evaluateOdometerReadings,
} from '../van-trip-reconciliation.engine';
import {
  resolveVanMoneyAuditActor,
} from './van-common.util';
import {
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
} from '../rep-target.engine';
import { getTenantTimezone, normalizePgDateOnly, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import {
  normalizePerDayCash,
  sumPerDayCash,
  type DayBucket,
  type PerDayCashInput,
} from '../van-settlement-split.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { computeCashDrawerVariance } from '../../cash-drawer/helpers/cash-drawer.helper';
import { boundedPage } from '../../../common/utils/bounded-page';
import { VanFraudRadarService } from './van-fraud-radar.service';
import { VanTripPinGatesService } from './van-trip-lifecycle/pin-gates.service';
import { GetActiveTripService } from './van-trip-lifecycle/get-active-trip.service';
import { TripOpenLoadService } from './van-trip-lifecycle/trip-open-load.service';
import { SubmitSettlementService } from './van-trip-lifecycle/submit-settlement.service';
import { SettleTripService } from './van-trip-lifecycle/settle-trip.service';
import { SettlementHelpersService } from './van-trip-lifecycle/settlement-helpers.service';
import { type RepTargetCalculationResult } from '../rep-target.engine';
import type {
  VanStockItem,
  VanTripSummary,
  VanTripLifecycleDeps,
} from './van-trip-lifecycle/van-trip-types';
export type { VanStockItem, VanTripSummary };


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
  private readonly moveVanInventoryBatches: VanTripLifecycleDeps['moveVanInventoryBatches'];
  private readonly deductVanSalePharmacyBatches: VanTripLifecycleDeps['deductVanSalePharmacyBatches'];
  private readonly deductVanSaleInventoryBatches: VanTripLifecycleDeps['deductVanSaleInventoryBatches'];
  private readonly resolveSystemAuthContext: VanTripLifecycleDeps['resolveSystemAuthContext'];
  private readonly recordSuspicionEvent: VanTripLifecycleDeps['recordSuspicionEvent'];
  private readonly listRepServedCustomerIds: VanTripLifecycleDeps['listRepServedCustomerIds'];
  private readonly resolveRepLinkedUserId: VanTripLifecycleDeps['resolveRepLinkedUserId'];
  private readonly getActiveTripService: GetActiveTripService;
  private readonly tripOpenLoadService: TripOpenLoadService;
  private readonly submitSettlement: SubmitSettlementService;
  private readonly settleTripService: SettleTripService;
  private readonly settlementHelpersService: SettlementHelpersService;
  private readonly pinGates: VanTripPinGatesService;

  constructor(deps: VanTripLifecycleDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.vanFraudRadarService = deps.vanFraudRadarService;
    this.getOrCreateVanLocation = deps.getOrCreateVanLocation;
    this.sortItemsByProductId = deps.sortItemsByProductId;
    this.moveVanStock = deps.moveVanStock;
    this.moveVanPharmacyBatches = deps.moveVanPharmacyBatches;
    this.moveVanInventoryBatches = deps.moveVanInventoryBatches;
    this.deductVanSalePharmacyBatches = deps.deductVanSalePharmacyBatches;
    this.deductVanSaleInventoryBatches = deps.deductVanSaleInventoryBatches;
    this.resolveSystemAuthContext = deps.resolveSystemAuthContext;
    this.recordSuspicionEvent = deps.recordSuspicionEvent;
    this.listRepServedCustomerIds = deps.listRepServedCustomerIds;
    this.resolveRepLinkedUserId = deps.resolveRepLinkedUserId;
    this.getActiveTripService = new GetActiveTripService(
      deps.db,
      deps.getOrCreateVanLocation,
      deps.listRepServedCustomerIds,
      this.pinGates.isSupervisorPinRequiredForSettlement.bind(this.pinGates),
      this.pinGates.isBlindSettlementEnabled.bind(this.pinGates),
    );
    this.tripOpenLoadService = new TripOpenLoadService(
      deps.db,
      deps.audit,
      deps.accountingPosting,
      deps.getOrCreateVanLocation,
      deps.sortItemsByProductId,
      deps.moveVanStock,
      deps.moveVanPharmacyBatches,
      deps.moveVanInventoryBatches,
      deps.resolveSystemAuthContext,
    );
    this.submitSettlement = new SubmitSettlementService(deps.db, deps.audit, deps.recordSuspicionEvent, deps.resolveRepLinkedUserId);
    this.settleTripService = new SettleTripService(
      deps.db,
      deps.audit,
      deps.accountingPosting,
      deps.moveVanStock,
      deps.moveVanPharmacyBatches,
      deps.moveVanInventoryBatches,
      deps.deductVanSalePharmacyBatches,
      deps.deductVanSaleInventoryBatches,
      deps.resolveSystemAuthContext,
      deps.recordSuspicionEvent,
      this.settlementHelpersService.computeTripDayBuckets.bind(this.settlementHelpersService),
      this.settlementHelpersService.insertRepCashRemittanceRow.bind(this.settlementHelpersService),
    );
    this.settlementHelpersService = new SettlementHelpersService();
    this.pinGates = new VanTripPinGatesService(deps.db, deps.vanFraudRadarService);
  }

  private get anyDb(): any {
    return this.db as any;
  }

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
    approvalMode?: 'pin' | 'account';
  }> {
    return this.pinGates.verifySupervisorPin(tenantId, pinInput, repId, queryable, accountId);
  }

  async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    return this.pinGates.isSupervisorPinRequiredForSettlement(tenantId);
  }

  async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    return this.pinGates.isBlindSettlementEnabled(tenantId);
  }

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
    serverTime: string;
    serverTimezone: string;
    discountCapPercent: number;
  }> {
    return this.getActiveTripService.getActiveTrip(repId, tenantId, accountId);
  }

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
    return this.tripOpenLoadService.openTripAndLoad(repId, tenantId, accountId, payload);
  }

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
    return this.tripOpenLoadService.loadSupplementaryStockToActiveTrip(repId, tenantId, accountId, tripId, payload);
  }

  async submitTripSettlement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      countedCash: number;
      perDayCash?: PerDayCashInput[];
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
    perDayCash?: PerDayCashInput[];
    variance: number;
    distanceKm: number;
    status: 'submitted_by_rep';
    message: string;
  }> {
    return this.submitSettlement.submitTripSettlement(repId, tenantId, accountId, payload);
  }

  async settleTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      countedCash: number;
      perDayCash?: PerDayCashInput[];
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      nightStockApproved?: boolean;
      nightStockNotes?: string;
      endOdometer?: number;
      chargeStockVarianceToRep?: boolean;
      chargeStockVarianceDecidedBySupervisor?: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
      supervisorApprovalMethod?: 'shared_manager_pin' | 'account' | 'unrecorded';
      supervisorId?: number | null;
    },
    authContext?: AuthContext,
  ): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
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
    return this.settleTripService.settleTrip(repId, tenantId, accountId, payload, authContext);
  }

  private async computeTripDayBuckets(
    queryable: any,
    tenantId: string,
    tripId: number,
    timezone: string,
    bookDigits: MoneyDigits,
  ): Promise<DayBucket[]> {
    return this.settlementHelpersService.computeTripDayBuckets(queryable, tenantId, tripId, timezone, bookDigits);
  }

  /**
   * INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day cash due for one trip —
   * the same buckets the settle step settles from, so the UI's
   * per-day inputs and the server's per-day guard can never disagree.
   */
  async getTripDueByDay(
    repId: number,
    tenantId: string,
    tripId: number,
  ): Promise<{
    ok: boolean;
    tripId: number;
    businessDay: string | null;
    timezone: string;
    days: DayBucket[];
    totalDue: number;
  }> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'business_day', 'cash_collected'])
      .where('id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .executeTakeFirst();
    if (!trip) {
      throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
    }
    const timezone = await getTenantTimezone(this.anyDb, tenantId);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const days = await this.computeTripDayBuckets(this.anyDb, tenantId, tripId, timezone, bookDigits);
    return {
      ok: true,
      tripId,
      businessDay: (trip as any).business_day ? normalizePgDateOnly((trip as any).business_day) : null,
      timezone,
      days,
      totalDue: roundMoney(days.reduce((s, d) => s + d.due, 0), bookDigits),
    };
  }

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
      businessDay?: string;
    },
  ): Promise<void> {
    return this.settlementHelpersService.insertRepCashRemittanceRow(trx, params);
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
