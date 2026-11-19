import { http } from '@/lib/http';
import { vanVisitsLedgerApi } from './van-sales/van-sales-visits-ledger';
import { vanFraudPromotionsApi } from './van-sales/van-sales-fraud-promotions';
import { vanExpensesPackagingApi } from './van-sales/van-sales-expenses-packaging';
import { vanPreSalesApi } from './van-sales/van-sales-presales';
import { vanAdminOpsApi } from './van-sales/van-sales-admin-ops';
import { vanAdminTripsApi } from './van-sales/van-sales-admin-trips';
import { vanDriverFleetApi } from './van-sales/van-sales-driver-fleet';
import { vanDriverCoreApi } from './van-sales/van-sales-driver-core';

export type {
  VanStockItem,
  VanTripExpense,
  VanPackagingMovement,
  CustomerPackagingBalance,
  PreSalesCatalogItem,
  PreSalesOrderItemInput,
  PreSalesOrderRecord,
  VanTripSummary,
  FleetVehicle,
  RepTargetMetrics,
  VanAssignedVehicle,
} from './van-sales/van-sales-types-a';


export type { RepTargetSummary, TripAdminDetails, VanCustomerItineraryItem, FleetFuelLogRecord, FleetOilChangeRecord, FleetMaintenanceAlert, VehicleDriverShiftRecord, InterVanTransferRecord, SupervisorRouteKpiSummary } from './van-sales/van-sales-types-c';


export const vanSalesApi = {
  ...vanDriverCoreApi,

  ...vanDriverFleetApi,

  ...vanAdminTripsApi,

  ...vanAdminOpsApi,

  ...vanPreSalesApi,

  ...vanExpensesPackagingApi,

  ...vanFraudPromotionsApi,

  ...vanVisitsLedgerApi,
};

export type { VanRepFinancialSettlementItem, VanRepLedgerBreakdown, VanRepFinancialLedgerResponse, FmcgPromotion, RouteOptimizationResult, VanFraudRadarEvent, VanRepRiskProfile, VanFraudRadarSummaryResponse } from './van-sales/van-sales-types-d';

export type {
  CustomerEligibleSale,
  CustomerEligibleSaleItem,
  CustomerRepBalanceItem,
  DriverAvailableProduct,
  DriverProductStock,
  DriverSaleHistoryItem,
  DriverWarehouse,
  RequisitionItemRecord,
  SupervisorCustomerRouteItem,
  VanActiveTripResponse,
  VanFieldReturnRecord,
  VanLoadRequisitionRecord,
} from './van-sales/van-sales-types-b';
