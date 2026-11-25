// Signature types for the van-sales split (file #50, S0).
// Each named type is the verbatim text of one top-level multi-line literal
// from a VanSalesService method signature (payload param or return type).
// The facade delegates and the slice methods use these types; they are
// type-identical to the pristine literals, including embedded INV comments.
import type { VanStockItem, VanTripSummary } from '../services/van-trip-lifecycle.service';
import type { RepTargetCalculationResult } from '../rep-target.engine';

export type GetFraudRadarEventsOptions = {
  days?: number;
  repId?: number;
  eventCode?: string;
  limit?: number;
};

export type VerifySupervisorPinResult = {
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
};

export type MoveVanStockParams = {
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
};

export type GetActiveTripResult = {
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
  // INV-VAN-OFFLINE-TIMESTAMPS: the server clock anchor for the
  // van page (useServerClock).
  serverTime: string;
  serverTimezone: string;
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the tenant rep
  // discount cap % (default 5).
  discountCapPercent: number;
};

export type OpenTripAndLoadPayload = {
  sourceWarehouseId?: number;
  startOdometer?: number;
  items?: { productId: number; qty: number }[];
  notes?: string;
};

export type LoadSupplementaryStockToActiveTripPayload = {
  sourceWarehouseId?: number;
  items: { productId: number; qty: number; sourceWarehouseId?: number }[];
  notes?: string;
};

export type ExecuteFieldSalePayload = {
  tripId: number;
  customerId?: number;
  customerName?: string;
  customerPhone?: string;
  paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
  paidAmount?: number;
  transferReference?: string;
  transferReceiptUrl?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientRole?: string;
  recipientSignature?: string;
  items: {
    productId: number;
    qty: number;
    unitPrice?: number;
    unitName?: string;
    unitMultiplier?: number;
    isBonus?: boolean;
    bonusReason?: string;
    originalPrice?: number;
    // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line TOTAL
    // discount amount (POS lineDiscount semantics).
    lineDiscount?: number;
  }[];
  notes?: string;
  deliveryGpsLat?: number;
  deliveryGpsLng?: number;
  // INV-VAN-OFFLINE-TIMESTAMPS: why no GPS fix was captured at
  // submit time ('timeout' | 'denied' | 'unavailable').
  gpsMissingReason?: 'timeout' | 'denied' | 'unavailable';
  deliveryProofPhoto?: string;
  packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
  clientTxId?: string;
  supervisorOverridePin?: string;
  supervisorOverrideReason?: string;
  cashDiscountAmount?: number;
  // INV-VAN-OFFLINE-TIMESTAMPS: the instant the sale was made
  // offline (outbox createdAt, ISO with offset).
  offlineCreatedAt?: string;
};

export type ExecuteFieldSaleResult = {
  ok: boolean;
  saleId: number;
  docNo: string;
  total: number;
  subtotal?: number;
  discount?: number;
  // INV-VAN-PRICE-LIST-WIRING: the system cash discount for this
  // sale (server-computed from the tenant setting, after the
  // rep-cap check). Included in `discount` above.
  systemCashDiscountAmount?: number;
  paymentMethod: string;
  customerName: string;
  itemsCount: number;
  cashPaid?: number;
  creditOwed?: number;
};

export type ExecuteFieldSaleInternalPayload = {
  tripId: number;
  customerId?: number;
  customerName?: string;
  customerPhone?: string;
  paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
  paidAmount?: number;
  transferReference?: string;
  transferReceiptUrl?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientRole?: string;
  recipientSignature?: string;
  items: {
    productId: number;
    qty: number;
    unitPrice?: number;
    unitName?: string;
    unitMultiplier?: number;
    isBonus?: boolean;
    bonusReason?: string;
    originalPrice?: number;
    // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line TOTAL
    // discount amount (POS lineDiscount semantics).
    lineDiscount?: number;
  }[];
  notes?: string;
  deliveryGpsLat?: number;
  deliveryGpsLng?: number;
  deliveryProofPhoto?: string;
  packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
  clientTxId?: string;
  supervisorOverridePin?: string;
  supervisorOverrideReason?: string;
  cashDiscountAmount?: number;
};

export type RecordFieldCollectionPayload = {
  tripId: number;
  customerId: number;
  amount: number;
  paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
  transferReference?: string;
  transferReceiptUrl?: string;
  supervisorOverridePin?: string;
  notes?: string;
  gpsLat?: number;
  gpsLng?: number;
  clientTxId?: string;
  // INV-VAN-OFFLINE-TIMESTAMPS: the instant the collection was
  // made offline (outbox createdAt, ISO with offset).
  offlineCreatedAt?: string;
};

export type RecordFieldCollectionInternalPayload = {
  tripId: number;
  customerId: number;
  amount: number;
  paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
  transferReference?: string;
  transferReceiptUrl?: string;
  supervisorOverridePin?: string;
  notes?: string;
  gpsLat?: number;
  gpsLng?: number;
  clientTxId?: string;
};

export type ExecuteDamagedSwapPayload = {
  tripId: number;
  customerId?: number;
  damagedProductId: number;
  damagedQty: number;
  damageReason?: string;
  replacementProductId: number;
  replacementQty: number;
  notes?: string;
  clientTxId?: string;
};

export type ExecuteDamagedSwapResult = {
  ok: boolean;
  swapId: number;
  damagedProductName: string;
  replacementProductName: string;
  damagedQty: number;
  replacementQty: number;
  priceDifference: number;
  messageAr: string;
};

export type SubmitTripSettlementPayload = {
  tripId: number;
  countedCash: number;
  // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash; stored
  // on the trip and used by the settle step when it sends none.
  perDayCash?: { businessDay: string; countedCash: number }[];
  endOdometer?: number;
  unloadRemainingToWarehouse: boolean;
  activeVisitCustomerId?: number;
  notes?: string;
};

export type SubmitTripSettlementResult = {
  ok: boolean;
  tripId: number;
  expectedCash: number;
  countedCash: number;
  perDayCash?: { businessDay: string; countedCash: number }[];
  variance: number;
  distanceKm: number;
  status: 'submitted_by_rep';
  message: string;
};

export type SettleTripPayload = {
  tripId: number;
  countedCash: number;
  // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash (see the
  // lifecycle service for the fallback + refusal rules).
  perDayCash?: { businessDay: string; countedCash: number }[];
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
};

export type SettleTripResult = {
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
};

export type ListDriverSalesFilters = {
  dateScope?: 'today' | 'yesterday' | 'week' | 'all';
  customerId?: number;
  paymentMethod?: string;
  search?: string;
  tripId?: number;
  discountedOnly?: boolean;
  limit?: number;
};

export type CreateFleetVehiclePayload = {
  plateNumber: string;
  modelName?: string;
  vehicleType?: string;
  vinChassis?: string;
  branchId?: number;
  currentOdometer?: number;
  fuelType?: string;
  licenseExpiresAt?: string;
  assignedRepId?: number;
  notes?: string;
};

export type UpdateFleetVehiclePayload = {
  plateNumber?: string;
  modelName?: string;
  vehicleType?: string;
  vinChassis?: string;
  branchId?: number;
  currentOdometer?: number;
  fuelType?: string;
  licenseExpiresAt?: string;
  status?: string;
  assignedRepId?: number | null;
  notes?: string;
};

export type RecordFuelLogPayload = {
  vehicleId: number;
  tripId?: number | null;
  odometer: number;
  liters: number;
  pricePerLiter: number;
  stationName?: string;
  notes?: string;
};

export type RecordOilChangePayload = {
  vehicleId: number;
  odometerAtChange: number;
  oilType: string;
  ratedKm: number;
  withFilter: boolean;
  alertKmBefore?: number;
  cost?: number;
  performedBy?: string;
  notes?: string;
};

export type AssignVehicleDriverPayload = {
  vehicleId: number;
  repId: number;
  shiftName: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  notes?: string;
};

export type SubmitLoadRequisitionPayload = {
  sourceWarehouseId?: number;
  items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
  notes?: string;
  allowMultiplePending?: boolean;
};

export type CreateLoadRequisitionByAdminPayload = {
  repId: number;
  sourceWarehouseId?: number;
  items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
  notes?: string;
  dispatchImmediately?: boolean;
};

export type SubmitFieldReturnPayload = {
  tripId: number;
  customerId: number;
  saleId?: number | null;
  returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
  refundMethod?: 'credit' | 'cash';
  items: {
    productId: number;
    qty: number;
    unitPrice: number;
    saleItemId?: number;
  }[];
  notes?: string;
  // INV-VAN-OFFLINE-TIMESTAMPS: the instant the return was made
  // offline (outbox createdAt, ISO with offset).
  offlineCreatedAt?: string;
};

export type SetRepTargetCommissionRates = {
  salesCommissionRatePercent?: number;
  collectionCommissionRatePercent?: number;
  targetBonusRatePercent?: number;
};

export type SaveCommissionConfigPayload = {
  salesCommissionRatePercent?: number;
  collectionCommissionRatePercent?: number;
  targetBonusRatePercent?: number;
  repId?: number;
};

export type SettleRepCommissionPayload = {
  repId: number;
  // The admin caller sends `month`, not periodMonth; the service
  // defaults an absent value to the current month (getRepTarget), so
  // it is optional here.
  periodMonth?: string;
  amount?: number;
  notes?: string;
};

export type CreateInterVanTransferPayload = {
  toRepId: number;
  fromTripId?: number;
  toTripId?: number;
  items: { productId: number; qty: number }[];
  notes?: string;
};

export type RecordFieldVisitPayload = {
  tripId: number;
  customerId: number;
  visitType: 'positive' | 'negative';
  saleId?: number | null;
  negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
  postponedToDate?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  notes?: string;
};

export type SetCustomerRouteSchedulePayload = {
  route?: string;
  routeSequence?: number;
  visitDays?: string[];
  customerCode?: string;
  locationUrl?: string;
  assignedRepId?: number | null;
  assignedRepIds?: number[];
  assignedRepName?: string | null;
  repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
};

export type BulkAssignCustomerRoutesPayload = {
  customerIds: number[];
  assignedRepId?: number | null;
  assignedRepIds?: number[];
  appendReps?: boolean;
  assignedRepName?: string | null;
  route?: string;
  visitDays?: string[];
};

export type GetSupervisorCustomerRoutesFilters = {
  search?: string;
  repId?: number | string;
  route?: string;
  unassignedOnly?: boolean;
};

export type RecordTripExpensePayload = {
  tripId: number;
  expenseType: 'fuel' | 'toll' | 'maintenance' | 'tips' | 'meals' | 'other' | string;
  amount: number;
  notes?: string;
  receiptPhotoUrl?: string;
  supervisorOverridePin?: string;
};

export type RecordPackagingMovementPayload = {
  tripId: number;
  customerId?: number;
  packageType: 'crate_plastic' | 'box_wooden' | 'bottle_glass' | 'cylinder_gas' | 'pallet' | string;
  deliveredQty: number;
  returnedQty: number;
  notes?: string;
};

export type CreateDriverCustomerBody = {
  name: string;
  phone?: string;
  address?: string;
  district?: string;
  route?: string;
  notes?: string;
  visitDays?: string[];
  metadata?: any;
};

export type GetRepFinancialLedgerFilters = {
  repId?: number;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type SettleRepFinancialItemPayload = {
  method: 'cash' | 'waiver';
  notes?: string;
  reason?: string;
  supervisorPin?: string;
};

export type PushRepShortagesToPayrollPayload = {
  settlementIds: number[];
  targetMonth?: string;
};

export type AddRepBonusOrCommissionPayload = {
  repId: number;
  entryType: 'bonus' | 'commission';
  amount: number;
  notes: string;
};
