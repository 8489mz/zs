import { Injectable } from '@nestjs/common';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { VanTripPinGatesService } from './van-trip-lifecycle/pin-gates.service';
import { GetActiveTripService } from './van-trip-lifecycle/get-active-trip.service';
import { TripOpenLoadService } from './van-trip-lifecycle/trip-open-load.service';
import { SubmitSettlementService } from './van-trip-lifecycle/submit-settlement.service';
import { SettleTripService } from './van-trip-lifecycle/settle-trip.service';
import { SettlementHelpersService } from './van-trip-lifecycle/settlement-helpers.service';
import { TripAdminReadsService } from './van-trip-lifecycle/trip-admin-reads.service';
import { type RepTargetCalculationResult } from '../rep-target.engine';
import { type DayBucket, type PerDayCashInput } from '../van-settlement-split.engine';
import { type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import type { VanStockItem, VanTripSummary, VanTripLifecycleDeps } from './van-trip-lifecycle/van-trip-types';
export type { VanStockItem, VanTripSummary };

@Injectable()
export class VanTripLifecycleService {
  private readonly pinGates: VanTripPinGatesService;
  private readonly settlementHelpersService: SettlementHelpersService;
  private readonly activeTrip: GetActiveTripService;
  private readonly tripOpenLoadService: TripOpenLoadService;
  private readonly submitSettlement: SubmitSettlementService;
  private readonly settleTripService: SettleTripService;
  private readonly tripAdminReads: TripAdminReadsService;

  constructor(deps: VanTripLifecycleDeps) {
    this.pinGates = new VanTripPinGatesService(deps.db, deps.vanFraudRadarService);
    this.settlementHelpersService = new SettlementHelpersService();
    this.activeTrip = new GetActiveTripService(
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
    this.submitSettlement = new SubmitSettlementService(
      deps.db,
      deps.audit,
      deps.recordSuspicionEvent,
      deps.resolveRepLinkedUserId,
    );
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
    this.tripAdminReads = new TripAdminReadsService(
      deps.db,
      this.settlementHelpersService.computeTripDayBuckets.bind(this.settlementHelpersService),
    );
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

  async getActiveTrip(
    repId: number,
    tenantId: string,
    accountId: string,
  ): Promise<{
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
    return this.activeTrip.getActiveTrip(repId, tenantId, accountId);
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
    return this.tripAdminReads.getTripDueByDay(repId, tenantId, tripId);
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

  async listTripsForAdmin(
    tenantId: string,
    filters?: { repId?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<VanTripSummary[]> {
    return this.tripAdminReads.listTripsForAdmin(tenantId, filters);
  }

  async getTripDetailsForAdmin(tenantId: string, tripId: number, pagination?: { page?: number; pageSize?: number }) {
    return this.tripAdminReads.getTripDetailsForAdmin(tenantId, tripId, pagination);
  }
}
