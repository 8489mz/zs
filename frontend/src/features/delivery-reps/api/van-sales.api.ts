import { vanDriverCoreApi } from '@/features/delivery-reps/api/van-sales/van-sales-driver-core';
import { vanDriverFleetApi } from '@/features/delivery-reps/api/van-sales/van-sales-driver-fleet';
import { vanAdminTripsApi } from '@/features/delivery-reps/api/van-sales/van-sales-admin-trips';
import { vanAdminOpsApi } from '@/features/delivery-reps/api/van-sales/van-sales-admin-ops';
import { vanPreSalesApi } from '@/features/delivery-reps/api/van-sales/van-sales-presales';
import { vanExpensesPackagingApi } from '@/features/delivery-reps/api/van-sales/van-sales-expenses-packaging';
import { vanFraudPromotionsApi } from '@/features/delivery-reps/api/van-sales/van-sales-fraud-promotions';
import { vanVisitsLedgerApi } from '@/features/delivery-reps/api/van-sales/van-sales-visits-ledger';

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

export type { VanStockItem, VanTripExpense, VanPackagingMovement, CustomerPackagingBalance, PreSalesCatalogItem, PreSalesOrderItemInput, PreSalesOrderRecord, VanTripSummary, FleetVehicle, RepTargetMetrics, VanAssignedVehicle } from '@/features/delivery-reps/api/van-sales/van-sales-types-a';

export type { VanActiveTripResponse, DriverSaleHistoryItem, CustomerEligibleSaleItem, CustomerEligibleSale, VanFieldReturnRecord, CustomerRepBalanceItem, SupervisorCustomerRouteItem, RequisitionItemRecord, VanLoadRequisitionRecord, DriverWarehouse, DriverProductStock, DriverAvailableProduct } from '@/features/delivery-reps/api/van-sales/van-sales-types-b';

export type { RepTargetSummary, TripAdminDetails, VanCustomerItineraryItem, FleetFuelLogRecord, FleetOilChangeRecord, FleetMaintenanceAlert, VehicleDriverShiftRecord, InterVanTransferRecord, SupervisorRouteKpiSummary } from '@/features/delivery-reps/api/van-sales/van-sales-types-c';

export type { VanRepFinancialSettlementItem, VanRepLedgerBreakdown, VanRepFinancialLedgerResponse, FmcgPromotion, RouteOptimizationResult, VanFraudRadarEvent, VanRepRiskProfile, VanFraudRadarSummaryResponse } from '@/features/delivery-reps/api/van-sales/van-sales-types-d';
