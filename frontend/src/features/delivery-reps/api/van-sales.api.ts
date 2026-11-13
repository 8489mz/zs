import { http } from '@/lib/http';

export interface VanStockItem {
  productId: number;
  productName: string;
  barcode: string;
  qty: number;
  mainWarehouseQty?: number;
  costPrice: number;
  retailPrice: number;
  // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: raw wholesale price (same
  // exposure as the already-exposed costPrice); the rep cart uses it
  // for wholesale-typed customers, the writer stays authoritative.
  wholesalePrice?: number;
  creditPrice?: number | null;
  consumerPrice?: number | null;
  unitName?: string;
  originalPrice?: number;
  discountPerUnit?: number;
  hasActiveOffer?: boolean;
  offerBadge?: string;
  packagingUnit?: { name: string; multiplier: number };
  availableUnits?: { id: number; name: string; multiplier: number; isBase: boolean }[];
  earliestExpiryDate?: string | null;
  batchNumber?: string | null;
  expiryStatus?: 'expired' | 'near_expiry' | 'valid' | 'no_expiry';
  daysToExpiry?: number | null;
}

export interface VanTripExpense {
  id: number;
  tripId: number;
  expenseType: 'fuel' | 'toll' | 'maintenance' | 'tips' | 'meals' | 'other' | string;
  amount: number;
  notes: string;
  receiptPhotoUrl?: string | null;
  createdAt: string;
  createdByName?: string | null;
}

export interface VanPackagingMovement {
  id: number;
  packageType: string;
  deliveredQty: number;
  returnedQty: number;
  netBalance: number;
  notes: string;
  createdAt: string;
  customerId?: number | null;
  customerName?: string | null;
}

export interface CustomerPackagingBalance {
  packageType: string;
  totalDelivered: number;
  totalReturned: number;
  netOwedToCompany: number;
}

export interface PreSalesCatalogItem {
  id: number;
  name: string;
  barcode: string;
  categoryName?: string;
  categoryId?: number | null;
  supplierId?: number | null;
  supplierName?: string | null;
  packagingUnit?: { name: string; multiplier: number } | null;
  costPrice: number;
  retailPrice: number;
  creditPrice?: number | null;
  consumerPrice?: number | null;
  warehouseStock: number;
  warehouseReserved: number;
  warehouseAvailable: number;
  units: Array<{
    id: number;
    name: string;
    multiplier: number;
    isBase: boolean;
    isSaleDefault: boolean;
  }>;
  offers: Array<{
    id: number;
    offerType: string;
    value: number;
    minQty: number;
  }>;
}

export interface PreSalesOrderItemInput {
  productId: number;
  unitName?: string;
  quantity: number;
  unitMultiplier?: number;
  unitPrice?: number;
}

export interface PreSalesOrderRecord {
  id: number;
  orderNumber: string;
  orderSource: string;
  status: string;
  paymentTerms: 'cash' | 'credit';
  repId: number;
  repName?: string;
  repPhone?: string;
  customerId: number;
  customerName?: string;
  customerPhone?: string;
  warehouseLocationId?: number;
  warehouseLocationName?: string;
  totalAmount: number;
  subtotalAmount: number;
  discountAmount?: number;
  itemsCount: number;
  notes?: string;
  deliveryDate?: string;
  supervisorApprovedAt?: string;
  supervisorApprovedByName?: string;
  supervisorRejectionReason?: string;
  createdAt: string;
  items?: Array<{
    id: number;
    productId: number;
    productName: string;
    unitName: string;
    quantity: number;
    unitMultiplier: number;
    unitPrice: number;
    consumerPrice?: number | null;
    pricingTierType: 'cash' | 'credit' | 'offer';
    unitOfferSavings?: number | null;
    lineTotal: number;
  }>;
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
  status: 'open' | 'settled';
  openedAt: string;
  closedAt?: string;
  loadedAmount: number;
  salesAmount: number;
  cashCollected: number;
  creditSales: number;
  returnsAmount: number;
  cashRefunds?: number;
  tripExpenses?: number;
  expectedCashToRemit?: number;
  totalInstapaySales?: number;
  totalInstapayCollections?: number;
  variance: number;
  notes?: string;
}

export interface FleetVehicle {
  id: number;
  plateNumber: string;
  modelName?: string;
  vehicleType: string;
  vinChassis?: string;
  vanLocationId: number;
  vanLocationName: string;
  branchId?: number;
  currentOdometer: number;
  fuelType: string;
  licenseExpiresAt?: string;
  status: 'available' | 'assigned' | 'maintenance' | 'retired';
  assignedRepId?: number | null;
  assignedRepName?: string;
  assignedRepPhone?: string;
  notes?: string;
  createdAt: string;
}

export interface RepTargetMetrics {
  periodMonth: string;
  targetAmount: number;
  actualSalesMTD: number;
  achievementRate: number;
  remainingTarget: number;
  isTargetAchieved: boolean;
  totalDaysInMonth: number;
  currentDayOfMonth: number;
  remainingDaysTotal: number;
  remainingWorkingDays: number;
  requiredDailyTarget: number;
  excludedFridaysCount: number;
  excludedHolidaysCount: number;
  todaySales?: number;
  collectionTarget?: number | null;
  actualCollectionsMTD?: number;
  todayCollections?: number;
  collectionAchievementRate?: number | null;
  remainingCollection?: number;
  requiredDailyCollection?: number;
  isCollectionAchieved?: boolean;
  visitsTarget?: number | null;
  actualVisitsMTD?: number;
  todayVisits?: number;
  visitsAchievementRate?: number | null;
  remainingVisits?: number;
  requiredDailyVisits?: number;
  isVisitsAchieved?: boolean;
  salesCommissionRate?: number;
  collectionCommissionRate?: number;
  targetBonusRate?: number;
  salesCommissionEarned?: number;
  collectionCommissionEarned?: number;
  targetBonusEarned?: number;
  totalCommissionEarned?: number;
  paidCommissionAmount?: number;
  remainingCommissionPayable?: number;
  isCommissionSettled?: boolean;
}

export interface VanAssignedVehicle {
  id: number;
  plateNumber: string;
  modelName?: string;
  vehicleType: string;
  currentOdometer: number;
  fuelType: string;
  licenseExpiresAt?: string;
  status: string;
}

export interface VanActiveTripResponse {
  hasActiveTrip: boolean;
  trip?: VanTripSummary;
  assignedVehicle?: VanAssignedVehicle | null;
  vanLocation?: { id: number; name: string };
  inventory: VanStockItem[];
  customers: {
    id: number;
    name: string;
    phone?: string;
    address?: string;
    balance: number;
    creditLimit?: number;
    customerCode?: string;
    route?: string;
    locationUrl?: string;
    // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: the rep cart prices by
    // customer type ('wholesale' charges wholesale_price).
    customer_type?: string;
  }[];
  recentSales: {
    id: number;
    docNo: string;
    total: number;
    paymentMethod: string;
    createdAt: string;
    customerName?: string;
  }[];
  sales?: {
    id: number;
    docNo: string;
    total: number;
    subtotal?: number;
    discount?: number;
    paymentMethod: string;
    createdAt: string;
    customerName?: string;
    customerPhone?: string;
  }[];
  collections?: {
    id: number;
    amount: number;
    createdAt: string;
    customerName: string;
    note?: string;
    gpsLat?: number;
    gpsLng?: number;
  }[];
  returns?: {
    id: number;
    docNo: string;
    totalAmount: number;
    returnReason: string;
    refundMethod?: 'credit' | 'cash';
    status: string;
    createdAt: string;
    customerName?: string;
  }[];
  swaps?: {
    id: number;
    damagedProductId: number;
    damagedProductName: string;
    damagedQty: number;
    damageReason: string;
    replacementProductId: number;
    replacementProductName: string;
    replacementQty: number;
    priceDifference: number;
    notes?: string | null;
    createdAt: string;
    customerName?: string;
  }[];
  targetMetrics?: RepTargetMetrics;
  requireSupervisorPinForSettlement?: boolean;
  isBlindSettlement?: boolean;
}

export interface DriverSaleHistoryItem {
  id: number;
  docNo: string;
  total: number;
  subtotal: number;
  discount: number;
  paymentMethod: 'cash' | 'credit' | 'card' | 'split';
  paymentChannel?: string;
  paidAmount?: number;
  remainingCredit?: number;
  createdAt: string;
  packagingBreakdown?: {
    cartonsCount?: number;
    piecesCount?: number;
    itemsCount?: number;
  } | null;
  deliveryProofPhoto?: string | null;
  customerId?: number | null;
  customerName: string;
  customerPhone?: string | null;
  customerCode?: string | null;
  customerAddress?: string | null;
  repName?: string;
  vehiclePlate?: string | null;
  tripId?: number | null;
  itemsCount: number;
  items: Array<{
    productId: number;
    name: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

export interface CustomerEligibleSaleItem {
  saleItemId: number;
  productId: number;
  productName: string;
  soldQty: number;
  alreadyReturnedQty: number;
  remainingReturnableQty: number;
  unitPrice: number;
  netUnitPrice: number;
}

export interface CustomerEligibleSale {
  id: number;
  docNo: string;
  createdAt: string;
  total: number;
  discount: number;
  items: CustomerEligibleSaleItem[];
}

export interface VanFieldReturnRecord {
  id: number;
  docNo: string;
  tripId: number;
  repId: number;
  repName: string;
  customerId: number;
  customerName: string;
  saleId?: number;
  saleDocNo?: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
  totalAmount: number;
  items: Array<{ productId: number; productName?: string; qty: number; unitPrice: number; saleItemId?: number }>;
  notes?: string;
  rejectionReason?: string;
  approvedByName?: string;
  approvedAt?: string;
  createdAt: string;
}

export interface CustomerRepBalanceItem {
  repId: number;
  repName: string;
  balance: number;
  totalDebit: number;
  totalCredit: number;
}

export interface SupervisorCustomerRouteItem {
  customerId: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerCode: string;
  route: string;
  routeSequence: number;
  visitDays: string[];
  visitDay?: string;
  assignedRepId: number | null;
  assignedRepIds?: number[];
  assignedRepNames?: string[];
  assignedRepName: string | null;
  locationUrl?: string;
  balance: number;
  repBalances?: CustomerRepBalanceItem[];
  unassignedBalance?: number;
  creditLimit: number;
}


export interface RequisitionItemRecord {
  productId: number;
  productName: string;
  barcode?: string;
  retailPrice?: number;
  qty: number;
  unit?: string;
  unitName?: string;
  cartonMultiplier?: number;
  packagingUnitName?: string;
  packagingUnit?: { name: string; multiplier: number };
  isWeight?: boolean;
  cartons?: number;
  pieces?: number;
  packingText?: string;
  warehouseAvailQty?: number;
  sourceWarehouseId?: number;
  sourceWarehouseName?: string;
}

export interface VanLoadRequisitionRecord {
  id: number;
  docNo: string;
  repId: number;
  repName: string;
  vehiclePlate: string;
  sourceWarehouseId: number;
  sourceWarehouseName: string;
  status: 'pending' | 'approved' | 'rejected' | 'dispatched';
  requestedItems: RequisitionItemRecord[];
  approvedItems: RequisitionItemRecord[];
  notes?: string;
  rejectionReason?: string;
  tripId?: number;
  vanLocationName?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface DriverWarehouse {
  id: number;
  name: string;
  code: string;
  locationType: string;
}

export interface DriverProductStock {
  warehouseId: number;
  warehouseName: string;
  qty: number;
}

export interface DriverAvailableProduct {
  id: number;
  name: string;
  barcode: string;
  sku: string;
  retailPrice: number;
  unit: string;
  totalStock: number;
  warehouseStocks: DriverProductStock[];
  packagingUnit?: { name: string; multiplier: number };
  isWeight?: boolean;
  supplierId?: number;
  supplierName?: string;
  categoryId?: number;
  categoryName?: string;
  earliestExpiryDate?: string | null;
  batchNumber?: string | null;
  expiryStatus?: 'expired' | 'near_expiry' | 'valid' | 'no_expiry';
  daysToExpiry?: number | null;
}

export interface RepTargetSummary {
  repId: number;
  repName: string;
  phone: string;
  vehiclePlate: string;
  repType: string;
  targetAmount: number;
  actualSales: number;
  achievementRate: number;
  remainingTarget: number;
  remainingWorkingDays: number;
  requiredDailyTarget: number;
  isTargetAchieved: boolean;
  collectionTarget?: number | null;
  actualCollections?: number;
  collectionAchievementRate?: number | null;
  remainingCollection?: number;
  requiredDailyCollection?: number;
  isCollectionAchieved?: boolean;
  visitsTarget?: number | null;
  actualVisits?: number;
  visitsAchievementRate?: number | null;
  remainingVisits?: number;
  requiredDailyVisits?: number;
  isVisitsAchieved?: boolean;
  salesCommissionRate?: number;
  collectionCommissionRate?: number;
  targetBonusRate?: number;
  salesCommissionEarned?: number;
  collectionCommissionEarned?: number;
  targetBonusEarned?: number;
  totalCommissionEarned?: number;
  paidCommissionAmount?: number;
  remainingCommissionPayable?: number;
  isCommissionSettled?: boolean;
}

export interface TripAdminDetails {
  trip: VanTripSummary & { repPhone?: string };
  sales: Array<{
    id: number;
    docNo: string;
    total: number;
    paymentMethod: string;
    createdAt: string;
    customerName: string;
    customerPhone: string;
    deliveryGpsLat?: number;
    deliveryGpsLng?: number;
    distanceMeters?: number | null;
    isWithinGeofence?: boolean | null;
    geofenceStatus?: 'within_range' | 'out_of_range' | 'missing_rep_gps' | 'missing_customer_gps';
    isCreditOverridden?: boolean;
    creditOverrideReason?: string;
  }>;
  collections: Array<{
    id: number;
    amount: number;
    createdAt: string;
    customerName: string;
    note?: string;
    gpsLat?: number;
    gpsLng?: number;
    distanceMeters?: number | null;
    isWithinGeofence?: boolean | null;
    geofenceStatus?: 'within_range' | 'out_of_range' | 'missing_rep_gps' | 'missing_customer_gps';
  }>;
  returns: Array<{
    id: number;
    docNo: string;
    totalAmount: number;
    returnReason: string;
    status: string;
    createdAt: string;
    customerName: string;
  }>;
  vanStock: Array<{
    productId: number;
    productName: string;
    barcode?: string;
    retailPrice: number;
    qty: number;
  }>;
}

export interface VanCustomerItineraryItem {
  customerId: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerCode: string;
  route: string;
  district?: string;
  visitDay?: string;
  visitDays: string[];
  isScheduledToday?: boolean;
  currentDayName?: string;
  assignedRepId?: number | null;
  assignedRepName?: string;
  locationUrl: string;
  gpsLat?: number | null;
  gpsLng?: number | null;
  balance: number;
  creditLimit: number;
  visitStatus: 'pending' | 'positive' | 'negative';
  todayVisit?: {
    id: number;
    visitType: 'positive' | 'negative';
    saleId?: number;
    saleDocNo?: string;
    saleTotal?: number;
    negativeReason?: string;
    postponedToDate?: string;
    visitedAt?: string;
    notes?: string;
  } | null;
  repeatedNegativesCount: number;
  hasRepeatedNegativeAlert: boolean;
}

export interface FleetFuelLogRecord {
  id: number;
  vehicleId: number;
  plateNumber: string;
  modelName?: string;
  tripId?: number;
  repId?: number;
  repName?: string;
  odometer: number;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  stationName?: string;
  kmSinceLastFuel: number;
  consumptionRate: number;
  notes?: string;
  createdAt: string;
}

export interface FleetOilChangeRecord {
  id: number;
  vehicleId: number;
  plateNumber: string;
  modelName?: string;
  currentOdometer: number;
  repId?: number;
  repName?: string;
  odometerAtChange: number;
  oilType: string;
  ratedKm: number;
  withFilter: boolean;
  alertKmBefore: number;
  nextDueOdometer: number;
  cost: number;
  performedBy?: string;
  status: 'active' | 'completed' | 'overdue';
  notes?: string;
  createdAt: string;
}

export interface FleetMaintenanceAlert {
  id: string;
  vehicleId: number;
  plateNumber: string;
  repName: string;
  type: 'oil_change' | 'license_expiry';
  severity: 'warning' | 'critical';
  title: string;
  description: string;
  currentValue: string | number;
  thresholdValue: string | number;
  dueDate?: string;
}

export interface VehicleDriverShiftRecord {
  id: number;
  vehicleId: number;
  repId: number;
  repName: string;
  repPhone: string;
  shiftName: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  isActive: boolean;
  notes?: string;
  createdAt: string;
}

export interface InterVanTransferRecord {
  id: number;
  transferNo: string;
  fromRepId: number;
  fromRepName: string;
  toRepId: number;
  toRepName: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  totalItemsCount: number;
  totalQty: number;
  notes?: string;
  createdAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
  items: Array<{
    transferId: number;
    productId: number;
    productName: string;
    barcode: string;
    qty: number;
    unitPrice: number;
  }>;
}

export interface SupervisorRouteKpiSummary {
  totalVisits: number;
  positiveVisits: number;
  negativeVisits: number;
  strikeRate: number;
  withinGeofenceCount?: number;
  outOfGeofenceCount?: number;
  geofenceComplianceRate?: number;
  negativeReasonsBreakdown: Record<string, number>;
  repeatedNegativeCustomersCount: number;
  totalFuelLiters: number;
  totalFuelCost: number;
  totalKmDriven: number;
  avgConsumptionRate: number;
  alertsCount: number;
  alerts: FleetMaintenanceAlert[];
}

function getDriverAuthHeaders() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('zs_driver_portal_token') : null;
  return { Authorization: `Bearer ${token || ''}` };
}

export const vanSalesApi = {
  getActiveTrip: async (): Promise<VanActiveTripResponse> => {
    return http<VanActiveTripResponse>('/api/driver-portal/van-sales/active-trip', {
      headers: getDriverAuthHeaders(),
    });
  },

  openTrip: async (payload?: {
    sourceWarehouseId?: number;
    items?: { productId: number; qty: number }[];
    notes?: string;
  }): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> => {
    return http('/api/driver-portal/van-sales/trips/open', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
  },

  executeSale: async (payload: {
    tripId: number;
    customerId?: number;
    customerName?: string;
    customerPhone?: string;
    paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
    paidAmount?: number;
    items: {
      productId: number;
      qty: number;
      unitPrice?: number;
      unitName?: string;
      unitMultiplier?: number;
      isBonus?: boolean;
      bonusReason?: string;
      originalPrice?: number;
    }[];
    notes?: string;
    deliveryGpsLat?: number;
    deliveryGpsLng?: number;
    deliveryProofPhoto?: string;
    packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
    clientTxId?: string;
    cashDiscountAmount?: number;
    supervisorOverridePin?: string;
    supervisorOverrideReason?: string;
    transferReference?: string;
    transferReceiptUrl?: string;
    recipientName?: string;
    recipientPhone?: string;
    recipientRole?: string;
    recipientSignature?: string;
  }): Promise<{
    ok: boolean;
    saleId: number;
    docNo: string;
    total: number;
    paymentMethod: string;
    customerName: string;
    itemsCount: number;
    cashPaid?: number;
    creditOwed?: number;
  }> => {
    return http('/api/driver-portal/van-sales/sales', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverSales: async (params?: {
    dateScope?: 'today' | 'yesterday' | 'week' | 'all';
    customerId?: number;
    paymentMethod?: string;
    search?: string;
    tripId?: number;
  }): Promise<{ ok: boolean; sales: DriverSaleHistoryItem[] }> => {
    const sp = new URLSearchParams();
    if (params?.dateScope) sp.set('dateScope', params.dateScope);
    if (params?.customerId) sp.set('customerId', String(params.customerId));
    if (params?.paymentMethod) sp.set('paymentMethod', params.paymentMethod);
    if (params?.search) sp.set('search', params.search);
    if (params?.tripId) sp.set('tripId', String(params.tripId));
    const qs = sp.toString();
    return http(`/api/driver-portal/van-sales/sales${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: getDriverAuthHeaders(),
    });
  },

  recordCollection: async (payload: {
    tripId: number;
    customerId: number;
    amount: number;
    paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
    transferReference?: string;
    transferReceiptUrl?: string;
    notes?: string;
    gpsLat?: number;
    gpsLng?: number;
  }): Promise<{
    ok: boolean;
    receiptNo: string;
    amount: number;
    customerName: string;
    newBalance: number;
  }> => {
    return http('/api/driver-portal/van-sales/collections', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  executeDamagedSwap: async (
    tripId: number,
    payload: {
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/damaged-swap`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  listTripDamagedSwaps: async (
    tripId: number,
  ): Promise<{
    ok: boolean;
    swaps: Array<{
      id: number;
      tripId: number;
      repId: number;
      customerId?: number | null;
      customerName?: string;
      damagedProductId: number;
      damagedProductName: string;
      damagedQty: number;
      damageReason: string;
      replacementProductId: number;
      replacementProductName: string;
      replacementQty: number;
      priceDifference: number;
      notes?: string | null;
      createdAt: string;
    }>;
  }> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/damaged-swaps`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getCustomerEligibleSales: async (customerId: number): Promise<CustomerEligibleSale[]> => {
    const res = await http<{ ok: boolean; sales: CustomerEligibleSale[] }>(
      `/api/driver-portal/van-sales/customers/${customerId}/eligible-sales`,
      { headers: getDriverAuthHeaders() },
    );
    return res.sales || [];
  },

  submitFieldReturn: async (payload: {
    tripId: number;
    customerId: number;
    saleId?: number | null;
    returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
    refundMethod?: 'credit' | 'cash';
    items: { productId: number; qty: number; unitPrice: number; saleItemId?: number }[];
    notes?: string;
  }): Promise<{ ok: boolean; returnDocNo: string; returnId: number; status: string; totalAmount: number }> => {
    return http('/api/driver-portal/van-sales/field-returns', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  submitLoadRequisition: async (payload: {
    sourceWarehouseId?: number;
    items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
    notes?: string;
  }): Promise<{ ok: boolean; docNo: string; requisitionId: number }> => {
    return http('/api/driver-portal/van-sales/requisitions', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  listMyRequisitions: async (): Promise<VanLoadRequisitionRecord[]> => {
    const res = await http<{ ok: boolean; requisitions: VanLoadRequisitionRecord[] }>(
      '/api/driver-portal/van-sales/requisitions',
      { headers: getDriverAuthHeaders() },
    );
    return res.requisitions || [];
  },

  cancelMyRequisition: async (id: number): Promise<{
    ok: boolean;
    requisitionId: number;
    docNo: string;
    previousItems: any[];
    notes?: string;
    sourceWarehouseId?: number;
  }> => {
    return http(`/api/driver-portal/van-sales/requisitions/${id}`, {
      method: 'DELETE',
      headers: getDriverAuthHeaders(),
    });
  },

  getWarehouses: async (): Promise<DriverWarehouse[]> => {
    const res = await http<{ ok: boolean; warehouses: DriverWarehouse[] }>(
      '/api/driver-portal/van-sales/warehouses',
      { headers: getDriverAuthHeaders() },
    );
    return res.warehouses || [];
  },

  getAvailableProducts: async (warehouseId?: string): Promise<DriverAvailableProduct[]> => {
    const query = warehouseId && warehouseId !== 'all' ? `?warehouseId=${warehouseId}` : '';
    const res = await http<{ ok: boolean; products: DriverAvailableProduct[] }>(
      `/api/driver-portal/van-sales/available-products${query}`,
      { headers: getDriverAuthHeaders() },
    );
    return res.products || [];
  },

  getMyTarget: async (month?: string): Promise<{ repId: number; repName: string; metrics: RepTargetMetrics }> => {
    return http(`/api/driver-portal/van-sales/my-target${month ? `?month=${month}` : ''}`, {
      headers: getDriverAuthHeaders(),
    });
  },

  settleTrip: async (payload: {
    tripId: number;
    countedCash: number;
    unloadRemainingToWarehouse: boolean;
    countedStock?: { productId: number; countedQty: number }[];
    // INV-VAN-SELF-SETTLE-PIN-REQUIRED: the rep's phone never sends a
    // charge/waive decision. nightStockApproved is the supervisor's
    // explicit approval (authorized by the supervisor PIN) to keep
    // remaining stock in the van overnight instead of unloading it.
    nightStockApproved?: boolean;
    endOdometer?: number;
    activeVisitCustomerId?: number;
    notes?: string;
    supervisorPin?: string;
  }): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    tripExpenses?: number;
    variance: number;
    stockVarianceAmount?: number;
    unloadedItemsCount: number;
    distanceKm?: number;
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
    stockVariances?: Array<{
      productId: number;
      productName: string;
      systemQty: number;
      countedQty?: number;
      varianceQty: number;
      costPrice: number;
      varianceCost: number;
      status: string;
    }>;
  }> => {
    return http('/api/driver-portal/van-sales/trips/settle', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  // Driver Field Itinerary & Visits
  getMyItinerary: async (): Promise<VanCustomerItineraryItem[]> => {
    const res = await http<{ ok: boolean; itinerary: VanCustomerItineraryItem[] }>(
      '/api/driver-portal/van-sales/itinerary',
      { headers: getDriverAuthHeaders() },
    );
    return res.itinerary || [];
  },

  recordFieldVisit: async (payload: {
    tripId: number;
    customerId: number;
    visitType: 'positive' | 'negative';
    saleId?: number;
    negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
    postponedToDate?: string;
    gpsLat?: number;
    gpsLng?: number;
    notes?: string;
  }): Promise<{ ok: boolean; visitId: number; consecutiveNegativeAlert: boolean }> => {
    return http('/api/driver-portal/van-sales/field-visits', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  // Driver Fleet Fuel & Maintenance
  recordDriverFuelLog: async (payload: {
    vehicleId: number;
    tripId?: number;
    odometer: number;
    liters: number;
    pricePerLiter: number;
    stationName?: string;
    notes?: string;
  }): Promise<{ ok: boolean; fuelLogId: number; kmSinceLastFuel: number; consumptionRate: number; totalCost: number }> => {
    return http('/api/driver-portal/van-sales/fuel-logs', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverFuelLogs: async (): Promise<FleetFuelLogRecord[]> => {
    const res = await http<{ ok: boolean; logs: FleetFuelLogRecord[] }>(
      '/api/driver-portal/van-sales/fuel-logs',
      { headers: getDriverAuthHeaders() },
    );
    return res.logs || [];
  },

  recordDriverOilChange: async (payload: {
    vehicleId: number;
    odometerAtChange: number;
    oilType: string;
    ratedKm: number;
    withFilter: boolean;
    alertKmBefore?: number;
    cost?: number;
    performedBy?: string;
    notes?: string;
  }): Promise<{ ok: boolean; oilChangeId: number; nextDueOdometer: number; alertKmBefore: number }> => {
    return http('/api/driver-portal/van-sales/oil-changes', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverMaintenanceAlerts: async (): Promise<FleetMaintenanceAlert[]> => {
    const res = await http<{ ok: boolean; alerts: FleetMaintenanceAlert[] }>(
      '/api/driver-portal/van-sales/maintenance-alerts',
      { headers: getDriverAuthHeaders() },
    );
    return res.alerts || [];
  },

  // Driver Inter-Van Transfers
  createDriverTransfer: async (payload: {
    toRepId: number;
    fromTripId?: number;
    toTripId?: number;
    items: { productId: number; qty: number }[];
    notes?: string;
  }): Promise<{ ok: boolean; transferId: number; transferNo: string; status: string }> => {
    return http('/api/driver-portal/van-sales/transfers', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverTransfers: async (): Promise<InterVanTransferRecord[]> => {
    const res = await http<{ ok: boolean; transfers: InterVanTransferRecord[] }>(
      '/api/driver-portal/van-sales/transfers',
      { headers: getDriverAuthHeaders() },
    );
    return res.transfers || [];
  },

  acceptDriverTransfer: async (transferId: number): Promise<{ ok: boolean; transferId: number; status: string }> => {
    return http(`/api/driver-portal/van-sales/transfers/${transferId}/accept`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
    });
  },

  rejectDriverTransfer: async (transferId: number, reason?: string): Promise<{ ok: boolean; transferId: number; status: string }> => {
    return http(`/api/driver-portal/van-sales/transfers/${transferId}/reject`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
  },

  getPeerReps: async (): Promise<Array<{ id: number; name: string; phone?: string; vehiclePlate?: string }>> => {
    const res = await http<{ ok: boolean; reps: any[] }>('/api/driver-portal/van-sales/peer-reps', {
      headers: getDriverAuthHeaders(),
    });
    return res.reps || [];
  },

  listAdminTrips: async (filters?: {
    repId?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<VanTripSummary[]> => {
    const searchParams = new URLSearchParams();
    if (filters?.repId) searchParams.set('repId', String(filters.repId));
    if (filters?.status) searchParams.set('status', filters.status);
    if (filters?.dateFrom) searchParams.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) searchParams.set('dateTo', filters.dateTo);
    const qs = searchParams.toString();
    const res = await http<{ ok: boolean; trips: VanTripSummary[] }>(`/api/van-sales/admin/trips${qs ? `?${qs}` : ''}`);
    return res.trips || [];
  },

  getTripDetails: async (tripId: number): Promise<TripAdminDetails> => {
    return http<TripAdminDetails>(`/api/van-sales/admin/trips/${tripId}`);
  },

  listVehicles: async (): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>('/api/van-sales/admin/vehicles');
    return res.vehicles || [];
  },

  createVehicle: async (payload: {
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
  }): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>('/api/van-sales/admin/vehicles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.vehicles || [];
  },

  updateVehicle: async (
    id: number,
    payload: {
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
    },
  ): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>(`/api/van-sales/admin/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.vehicles || [];
  },

  assignVehicleRep: async (
    vehicleId: number,
    payload: { repId: number | null; shiftName?: string },
  ): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>(`/api/van-sales/admin/vehicles/${vehicleId}/assign`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.vehicles || [];
  },

  // Admin Field Returns API
  listAdminReturns: async (filters?: {
    status?: string;
    repId?: number;
    tripId?: number;
    customerId?: number;
  }): Promise<VanFieldReturnRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.status) sp.set('status', filters.status);
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.tripId) sp.set('tripId', String(filters.tripId));
    if (filters?.customerId) sp.set('customerId', String(filters.customerId));
    const qs = sp.toString();
    const res = await http<{ ok: boolean; returns: VanFieldReturnRecord[] }>(`/api/van-sales/admin/returns${qs ? `?${qs}` : ''}`);
    return res.returns || [];
  },

  approveReturn: async (id: number): Promise<{ ok: boolean; returnId: number; status: string }> => {
    return http(`/api/van-sales/admin/returns/${id}/approve`, { method: 'POST' });
  },

  rejectReturn: async (id: number, reason: string): Promise<{ ok: boolean; returnId: number; status: string }> => {
    return http(`/api/van-sales/admin/returns/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // Admin Loading Requisitions API
  listAdminRequisitions: async (filters?: {
    status?: string;
    repId?: number;
  }): Promise<VanLoadRequisitionRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.status) sp.set('status', filters.status);
    if (filters?.repId) sp.set('repId', String(filters.repId));
    const qs = sp.toString();
    const res = await http<{ ok: boolean; requisitions: VanLoadRequisitionRecord[] }>(`/api/van-sales/admin/requisitions${qs ? `?${qs}` : ''}`);
    return res.requisitions || [];
  },

  getAdminWarehouses: async (): Promise<DriverWarehouse[]> => {
    const res = await http<{ ok: boolean; warehouses: DriverWarehouse[] }>('/api/van-sales/admin/warehouses');
    return res.warehouses || [];
  },

  createAdminLoadRequisition: async (payload: {
    repId: number;
    sourceWarehouseId?: number;
    items: { productId: number; qty: number; productName?: string; barcode?: string }[];
    notes?: string;
    dispatchImmediately?: boolean;
  }): Promise<{ ok: boolean; docNo: string; requisitionId: number; dispatched: boolean; tripId?: number }> => {
    return http('/api/van-sales/admin/requisitions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getAdminAvailableProducts: async (warehouseId?: number | string): Promise<DriverAvailableProduct[]> => {
    const query = warehouseId && warehouseId !== 'all' ? `?warehouseId=${warehouseId}` : '';
    const res = await http<{ ok: boolean; products: DriverAvailableProduct[] }>(
      `/api/van-sales/admin/available-products${query}`,
    );
    return res.products || [];
  },

  reviewRequisition: async (
    id: number,
    approvedItems: { productId: number; qty: number }[],
    notes?: string,
    sourceWarehouseId?: number,
  ) => {
    return http(`/api/van-sales/admin/requisitions/${id}/review`, {
      method: 'PUT',
      body: JSON.stringify({ approvedItems, notes, sourceWarehouseId }),
    });
  },

  dispatchRequisition: async (id: number): Promise<{ ok: boolean; requisitionId: number; tripId: number; docNo: string; isSupplementary?: boolean }> => {
    return http(`/api/van-sales/admin/requisitions/${id}/dispatch`, { method: 'POST' });
  },

  rejectRequisition: async (id: number, reason: string): Promise<{ ok: boolean; requisitionId: number; status: string }> => {
    return http(`/api/van-sales/admin/requisitions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  deleteRequisition: async (id: number): Promise<{ ok: boolean; requisitionId: number; docNo: string }> => {
    return http(`/api/van-sales/admin/requisitions/${id}`, {
      method: 'DELETE',
    });
  },

  // Admin Rep Targets API
  listRepTargets: async (month?: string): Promise<RepTargetSummary[]> => {
    const res = await http<{ ok: boolean; targets: RepTargetSummary[] }>(`/api/van-sales/admin/targets${month ? `?month=${month}` : ''}`);
    return res.targets || [];
  },

  setRepTarget: async (
    repId: number,
    month: string,
    targetAmount: number,
    collectionTarget?: number | null,
    visitsTarget?: number | null,
    commissionRates?: {
      salesCommissionRate?: number;
      collectionCommissionRate?: number;
      targetBonusRate?: number;
    },
  ) => {
    return http('/api/van-sales/admin/targets', {
      method: 'POST',
      body: JSON.stringify({
        repId,
        month,
        targetAmount,
        collectionTarget,
        visitsTarget,
        ...(commissionRates || {}),
      }),
    });
  },

  getCommissionConfig: async (): Promise<{
    defaultSalesRate: number;
    defaultCollectionRate: number;
    defaultTargetBonusRate: number;
    repRates: Record<string, { salesRate: number; collectionRate: number; targetBonusRate: number }>;
  }> => {
    return http('/api/van-sales/admin/targets/commission-config');
  },

  saveCommissionConfig: async (payload: {
    defaultSalesRate?: number;
    defaultCollectionRate?: number;
    defaultTargetBonusRate?: number;
    repId?: number;
    salesRate?: number;
    collectionRate?: number;
    targetBonusRate?: number;
  }) => {
    return http('/api/van-sales/admin/targets/commission-config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  settleRepCommission: async (payload: {
    repId: number;
    month: string;
    amount: number;
    paymentMethod?: 'cash' | 'bank_transfer';
    notes?: string;
  }): Promise<{
    ok: boolean;
    repId: number;
    month: string;
    settledAmount: number;
    expenseId?: number;
  }> => {
    return http('/api/van-sales/admin/targets/settle-commission', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Supervisor Route KPIs & Field Visits API
  fetchSupervisorRouteKpis: async (params?: { dateFrom?: string; dateTo?: string }): Promise<SupervisorRouteKpiSummary> => {
    const sp = new URLSearchParams();
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    const qs = sp.toString();
    const res = await http<SupervisorRouteKpiSummary & { ok: boolean }>(`/api/van-sales/admin/kpis${qs ? `?${qs}` : ''}`);
    return res;
  },

  fetchAdminFieldVisits: async (filters?: {
    repId?: number;
    customerId?: number;
    visitType?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<any[]> => {
    const sp = new URLSearchParams();
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.customerId) sp.set('customerId', String(filters.customerId));
    if (filters?.visitType) sp.set('visitType', filters.visitType);
    if (filters?.dateFrom) sp.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) sp.set('dateTo', filters.dateTo);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; visits: any[] }>(`/api/van-sales/admin/field-visits${qs ? `?${qs}` : ''}`);
    return res.visits || [];
  },

  setCustomerRouteSchedule: async (
    customerId: number,
    payload: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) => {
    return http(`/api/van-sales/admin/customers/${customerId}/route-schedule`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getSupervisorCustomerRoutes: async (filters?: {
    search?: string;
    repId?: number | string;
    route?: string;
    unassignedOnly?: boolean;
  }): Promise<SupervisorCustomerRouteItem[]> => {
    const sp = new URLSearchParams();
    if (filters?.search) sp.set('search', filters.search);
    if (filters?.repId && filters.repId !== 'all') sp.set('repId', String(filters.repId));
    if (filters?.route && filters.route !== 'all') sp.set('route', filters.route);
    if (filters?.unassignedOnly) sp.set('unassignedOnly', 'true');
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    const res = await http<{ ok: boolean; customers: SupervisorCustomerRouteItem[] }>(
      `/api/van-sales/admin/supervisor/customer-routes${qs}`,
    );
    return res.customers || [];
  },

  bulkAssignCustomerRoutes: async (payload: {
    customerIds: number[];
    assignedRepId?: number | null;
    assignedRepIds?: number[];
    appendReps?: boolean;
    assignedRepName?: string;
    route?: string;
    visitDays?: string[];
  }): Promise<{ ok: boolean; updatedCount: number; assignedRepId?: number | null; assignedRepName?: string | null }> => {
    return http<{ ok: boolean; updatedCount: number; assignedRepId?: number | null; assignedRepName?: string | null }>(
      `/api/van-sales/admin/supervisor/customer-routes/bulk-assign`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },


  // Fleet Fuel Logs API
  fetchAdminFuelLogs: async (filters?: { vehicleId?: number; repId?: number; dateFrom?: string; dateTo?: string }): Promise<FleetFuelLogRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.vehicleId) sp.set('vehicleId', String(filters.vehicleId));
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.dateFrom) sp.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) sp.set('dateTo', filters.dateTo);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; logs: FleetFuelLogRecord[] }>(`/api/van-sales/admin/fuel-logs${qs ? `?${qs}` : ''}`);
    return res.logs || [];
  },

  recordAdminFuelLog: async (payload: {
    vehicleId: number;
    tripId?: number;
    repId?: number;
    odometer: number;
    liters: number;
    pricePerLiter: number;
    stationName?: string;
    notes?: string;
  }) => {
    return http('/api/van-sales/admin/fuel-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Fleet Oil Changes API
  fetchAdminOilChanges: async (vehicleId?: number): Promise<FleetOilChangeRecord[]> => {
    const res = await http<{ ok: boolean; changes: FleetOilChangeRecord[] }>(
      `/api/van-sales/admin/oil-changes${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
    );
    return res.changes || [];
  },

  recordAdminOilChange: async (payload: {
    vehicleId: number;
    odometerAtChange: number;
    oilType: string;
    ratedKm: number;
    withFilter: boolean;
    alertKmBefore?: number;
    cost?: number;
    performedBy?: string;
    notes?: string;
    repId?: number;
  }) => {
    return http('/api/van-sales/admin/oil-changes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  fetchMaintenanceAlerts: async (): Promise<FleetMaintenanceAlert[]> => {
    const res = await http<{ ok: boolean; alerts: FleetMaintenanceAlert[] }>('/api/van-sales/admin/maintenance-alerts');
    return res.alerts || [];
  },

  // Multi-Driver Vehicle Shifts API
  fetchVehicleDrivers: async (vehicleId: number): Promise<VehicleDriverShiftRecord[]> => {
    const res = await http<{ ok: boolean; drivers: VehicleDriverShiftRecord[] }>(
      `/api/van-sales/admin/vehicles/${vehicleId}/drivers`,
    );
    return res.drivers || [];
  },

  assignVehicleDriver: async (
    vehicleId: number,
    payload: {
      repId: number;
      shiftName: string;
      shiftStartTime?: string;
      shiftEndTime?: string;
      notes?: string;
    },
  ) => {
    return http(`/api/van-sales/admin/vehicles/${vehicleId}/drivers`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  removeVehicleDriver: async (vehicleId: number, driverId: number) => {
    return http(`/api/van-sales/admin/vehicles/${vehicleId}/drivers/${driverId}`, {
      method: 'DELETE',
    });
  },

  // Inter-Van Transfers Audit API
  fetchAdminTransfers: async (filters?: { repId?: number; status?: string }): Promise<InterVanTransferRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.status) sp.set('status', filters.status);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; transfers: InterVanTransferRecord[] }>(`/api/van-sales/admin/transfers${qs ? `?${qs}` : ''}`);
    return res.transfers || [];
  },

  // Field Pre-Sales (Order Booking from Main Warehouse) API
  fetchPreSalesCatalog: async (params?: { warehouseLocationId?: number; search?: string; categoryId?: number }): Promise<PreSalesCatalogItem[]> => {
    const sp = new URLSearchParams();
    if (params?.warehouseLocationId) sp.set('warehouseLocationId', String(params.warehouseLocationId));
    if (params?.search) sp.set('search', params.search);
    if (params?.categoryId) sp.set('categoryId', String(params.categoryId));
    const qs = sp.toString();
    const res = await http<any>(
      `/api/driver-portal/van-sales/pre-sales/catalog${qs ? `?${qs}` : ''}`,
      { headers: getDriverAuthHeaders() }
    );
    return res.products || res.items || [];
  },

  createPreSalesOrder: async (payload: {
    customerId: number;
    paymentMethod: 'cash' | 'credit';
    warehouseLocationId?: number;
    notes?: string;
    deliveryDate?: string;
    items: PreSalesOrderItemInput[];
  }): Promise<{ ok: boolean; orderId: number; orderNumber: string; totalAmount: number; status: string }> => {
    return http('/api/driver-portal/van-sales/pre-sales/orders', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  fetchMyPreSalesOrders: async (params?: { status?: string; dateFrom?: string; dateTo?: string; search?: string }): Promise<PreSalesOrderRecord[]> => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; orders: PreSalesOrderRecord[] }>(
      `/api/driver-portal/van-sales/pre-sales/my-orders${qs ? `?${qs}` : ''}`,
      { headers: getDriverAuthHeaders() }
    );
    return res.orders || [];
  },

  getPreSalesOrderDetails: async (orderId: number): Promise<PreSalesOrderRecord> => {
    const res = await http<any>(
      `/api/driver-portal/van-sales/pre-sales/orders/${orderId}`,
      { headers: getDriverAuthHeaders() }
    );
    return res.order || res;
  },

  // Supervisor Admin Pre-Sales Endpoints
  listAdminPreSalesOrders: async (filters?: {
    repId?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }): Promise<PreSalesOrderRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.status) sp.set('status', filters.status);
    if (filters?.dateFrom) sp.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) sp.set('dateTo', filters.dateTo);
    if (filters?.search) sp.set('search', filters.search);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; orders: PreSalesOrderRecord[] }>(`/api/van-sales/admin/pre-sales-orders${qs ? `?${qs}` : ''}`);
    return res.orders || [];
  },

  getAdminPreSalesOrderDetails: async (orderId: number): Promise<PreSalesOrderRecord> => {
    const res = await http<any>(`/api/van-sales/admin/pre-sales-orders/${orderId}`);
    return res.order || res;
  },

  approveAdminPreSalesOrder: async (orderId: number): Promise<{ ok: boolean; status: string }> => {
    return http(`/api/van-sales/admin/pre-sales-orders/${orderId}/approve`, {
      method: 'POST',
    });
  },

  rejectAdminPreSalesOrder: async (orderId: number, reason?: string): Promise<{ ok: boolean; status: string }> => {
    return http(`/api/van-sales/admin/pre-sales-orders/${orderId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  consolidateAdminPreSalesOrdersToRequisition: async (payload: {
    orderIds: number[];
    deliveryRepId: number;
    notes?: string;
  }): Promise<{
    ok: boolean;
    requisitionId: number;
    requisitionDocNo: string;
    consolidatedOrdersCount: number;
    totalDistinctItems: number;
  }> => {
    return http('/api/van-sales/admin/pre-sales-orders/consolidate-requisition', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  convertAdminPreSalesOrderToInvoice: async (
    orderId: number,
    payload?: { paymentMethod?: 'cash' | 'credit'; notes?: string },
  ): Promise<{
    ok: boolean;
    orderId: number;
    orderNumber: string;
    saleId: number;
    invoiceDocNo: string;
    totalAmount: number;
  }> => {
    return http(`/api/van-sales/admin/pre-sales-orders/${orderId}/convert-invoice`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  // =========================================================================
  // Trip Operational Expenses API
  // =========================================================================

  recordTripExpense: async (
    payloadOrTripId: number | { tripId: number; expenseType: string; amount: number; notes?: string; description?: string; receiptPhotoUrl?: string; receiptPhoto?: string; supervisorOverridePin?: string },
    extraPayload?: { expenseType: string; amount: number; notes?: string; description?: string; receiptPhotoUrl?: string; receiptPhoto?: string; supervisorOverridePin?: string },
  ): Promise<{ ok: boolean; expenseId: number; totalTripExpenses: number }> => {
    let tripId: number;
    let body: any;
    if (typeof payloadOrTripId === 'number') {
      tripId = payloadOrTripId;
      body = {
        tripId,
        expenseType: extraPayload?.expenseType,
        amount: extraPayload?.amount,
        notes: extraPayload?.notes || extraPayload?.description,
        receiptPhotoUrl: extraPayload?.receiptPhotoUrl || extraPayload?.receiptPhoto,
        supervisorOverridePin: extraPayload?.supervisorOverridePin,
      };
    } else {
      tripId = payloadOrTripId.tripId;
      body = {
        tripId,
        expenseType: payloadOrTripId.expenseType,
        amount: payloadOrTripId.amount,
        notes: payloadOrTripId.notes || payloadOrTripId.description,
        receiptPhotoUrl: payloadOrTripId.receiptPhotoUrl || payloadOrTripId.receiptPhoto,
        supervisorOverridePin: payloadOrTripId.supervisorOverridePin,
      };
    }
    return http(`/api/driver-portal/van-sales/trips/${tripId}/expenses`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(body),
    });
  },

  getTripExpenses: async (tripId: number): Promise<{ expenses: VanTripExpense[]; totalExpenses: number }> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/expenses`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getAdminTripExpenses: async (tripId: number): Promise<{ expenses: VanTripExpense[]; totalExpenses: number }> => {
    return http(`/api/van-sales/admin/trips/${tripId}/expenses`);
  },

  // =========================================================================
  // Returnable Packaging & Empties Ledger API
  // =========================================================================

  recordPackagingMovement: async (
    payloadOrTripId: number | { tripId: number; customerId?: number; packageType?: string; packagingType?: string; deliveredQty?: number; qtyOut?: number; returnedQty?: number; qtyIn?: number; notes?: string },
    extraPayload?: { customerId?: number; packageType?: string; packagingType?: string; deliveredQty?: number; qtyOut?: number; returnedQty?: number; qtyIn?: number; notes?: string },
  ): Promise<{ ok: boolean; movementId: number }> => {
    let tripId: number;
    let p: any;
    if (typeof payloadOrTripId === 'number') {
      tripId = payloadOrTripId;
      p = extraPayload || {};
    } else {
      tripId = payloadOrTripId.tripId;
      p = payloadOrTripId;
    }
    const body = {
      tripId,
      customerId: p.customerId,
      packageType: p.packageType || p.packagingType || 'crate_plastic',
      deliveredQty: p.deliveredQty ?? p.qtyOut ?? 0,
      returnedQty: p.returnedQty ?? p.qtyIn ?? 0,
      notes: p.notes,
    };
    return http(`/api/driver-portal/van-sales/trips/${tripId}/packaging`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(body),
    });
  },

  getTripPackagingMovements: async (tripId: number): Promise<VanPackagingMovement[]> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/packaging`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getAdminTripPackaging: async (tripId: number): Promise<VanPackagingMovement[]> => {
    return http(`/api/van-sales/admin/trips/${tripId}/packaging`);
  },

  getCustomerPackagingBalance: async (customerId: number): Promise<CustomerPackagingBalance[]> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/packaging`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getAdminCustomerPackaging: async (customerId: number): Promise<CustomerPackagingBalance[]> => {
    return http(`/api/van-sales/admin/customers/${customerId}/packaging`);
  },

  createCustomer: async (payload: {
    name: string;
    phone?: string;
    address?: string;
    district?: string;
    route?: string;
    notes?: string;
    visitDays?: string[];
    metadata?: any;
  }): Promise<{ ok: boolean; customer: any }> => {
    return http('/api/driver-portal/van-sales/customers', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  // =========================================================================
  // Van Sales Anti-Theft & Suspicion Radar (رادار الشبهات ومكافحة التلاعب)
  // =========================================================================

  getFraudRadarSummary: async (filters?: {
    days?: number;
    repId?: number;
  }): Promise<VanFraudRadarSummaryResponse> => {
    const params = new URLSearchParams();
    if (filters?.days) params.set('days', String(filters.days));
    if (filters?.repId) params.set('repId', String(filters.repId));
    const q = params.toString();
    return http(`/api/van-sales/admin/fraud-radar/summary${q ? `?${q}` : ''}`);
  },

  getFraudRadarEvents: async (filters?: {
    days?: number;
    repId?: number;
    eventCode?: string;
    limit?: number;
  }): Promise<{ ok: boolean; events: VanFraudRadarEvent[] }> => {
    const params = new URLSearchParams();
    if (filters?.days) params.set('days', String(filters.days));
    if (filters?.repId) params.set('repId', String(filters.repId));
    if (filters?.eventCode) params.set('eventCode', filters.eventCode);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const q = params.toString();
    return http(`/api/van-sales/admin/fraud-radar/events${q ? `?${q}` : ''}`);
  },

  getCustomerSuggestedOrder: async (customerId: number): Promise<{
    ok: boolean;
    customerId: number;
    lastOrderDocNo: string | null;
    lastOrderDate: string | null;
    hasPreviousOrders: boolean;
    items: Array<{
      productId: number;
      productName: string;
      suggestedQty: number;
      unitPrice: number;
      unitName: string;
      unitMultiplier: number;
      barcode?: string | null;
      availableVanQty: number;
      isAvailableInVan: boolean;
    }>;
  }> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/suggested-order`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getCustomerLastSoldPrices: async (customerId: number): Promise<{
    ok: boolean;
    customerId: number;
    lastPrices: Record<number, { lastPrice: number; lastSaleDate: string; lastDocNo: string }>;
  }> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/last-prices`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getCustomerFieldStatement: async (customerId: number): Promise<{
    ok: boolean;
    customer: {
      id: number;
      name: string;
      phone: string;
      address: string;
      balance: number;
      creditLimit: number;
      customerType: string;
      isCreditBlocked: boolean;
      allowedCreditDays: number;
    };
    overdueAnalysis: {
      hasOverdueInvoices: boolean;
      overdueCount: number;
      totalOverdueAmount: number;
      oldestOverdueDays: number;
    };
    packagingBalance: Array<{ packageType: string; totalDelivered: number; totalReturned: number; netOwedToCompany: number }>;
    recentSales: Array<{
      id: number;
      docNo: string;
      saleDate: string;
      paymentType: string;
      total: number;
      paidAmount: number;
      remaining: number;
    }>;
    recentCollections: Array<{
      id: number;
      receiptNumber: string;
      paymentDate: string;
      amount: number;
      paymentMethod: string;
      notes: string;
    }>;
  }> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/field-statement`, {
      headers: getDriverAuthHeaders(),
    });
  },

  // FMCG Mix & Match Promotions Endpoints
  fetchDriverPromotions: async (): Promise<{ ok: boolean; promotions: FmcgPromotion[] }> => {
    return http('/api/driver-portal/van-sales/promotions', {
      headers: getDriverAuthHeaders(),
    });
  },

  evaluateCartPromotions: async (payload: {
    cartItems: any[];
    invoiceSubtotal?: number;
    customerType?: string;
  }): Promise<{
    ok: boolean;
    appliedPromotions: any[];
    bonusItemsToAdd: any[];
    totalPromotionalDiscount: number;
    upsellNudges: any[];
  }> => {
    return http('/api/driver-portal/van-sales/promotions/evaluate-cart', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  optimizeDriverRoute: async (payload: {
    customerIds?: number[];
    startLat?: number;
    startLng?: number;
    persistSequence?: boolean;
    route?: string;
  }): Promise<{ ok: boolean } & RouteOptimizationResult> => {
    return http('/api/driver-portal/van-sales/routes/optimize', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  fetchAdminPromotions: async (filters?: { isActive?: boolean; promoType?: string }): Promise<{ ok: boolean; promotions: FmcgPromotion[] }> => {
    const params = new URLSearchParams();
    if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive));
    if (filters?.promoType) params.set('promoType', filters.promoType);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return http(`/api/van-sales/admin/promotions${qs}`);
  },

  createAdminPromotion: async (dto: Partial<FmcgPromotion>): Promise<{ ok: boolean; promotion: FmcgPromotion }> => {
    return http('/api/van-sales/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  updateAdminPromotion: async (id: number, dto: Partial<FmcgPromotion>): Promise<{ ok: boolean; promotion: FmcgPromotion }> => {
    return http(`/api/van-sales/admin/promotions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
  },

  deleteAdminPromotion: async (id: number): Promise<{ ok: boolean }> => {
    return http(`/api/van-sales/admin/promotions/${id}`, {
      method: 'DELETE',
    });
  },

  toggleAdminPromotionActive: async (id: number, isActive: boolean): Promise<{ ok: boolean; promotion: FmcgPromotion }> => {
    return http(`/api/van-sales/admin/promotions/${id}/toggle-active`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },

  optimizeSupervisorRoute: async (payload: {
    customerIds?: number[];
    route?: string;
    repId?: number;
    startLat?: number;
    startLng?: number;
    persistSequence?: boolean;
  }): Promise<{ ok: boolean } & RouteOptimizationResult> => {
    return http('/api/van-sales/admin/routes/optimize', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // =========================================================================
  // FMCG FIELD EXECUTION, VISITS, TRADE MARKETING & BREADCRUMBS
  // =========================================================================

  checkInVisit: async (payload: {
    tripId?: number;
    customerId: number;
    customerName?: string;
    latitude?: number | null;
    longitude?: number | null;
  }): Promise<{ ok: boolean; visitId: number; customerName: string; geofence: any; checkInAt: string }> => {
    return http('/api/driver-portal/van-sales/visits/check-in', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  recordVisitInventory: async (visitId: number, payload: { items: any[] }): Promise<{ ok: boolean; visitId: number }> => {
    return http(`/api/driver-portal/van-sales/visits/${visitId}/inventory`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  recordVisitNoSale: async (visitId: number, payload: { noSaleReason: string; noSaleNotes?: string }): Promise<{ ok: boolean; visitId: number; reason: string }> => {
    return http(`/api/driver-portal/van-sales/visits/${visitId}/no-sale`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  checkOutVisit: async (visitId: number, payload?: {
    hasSale?: boolean;
    saleId?: number;
    saleAmount?: number;
    hasCollection?: boolean;
    collectionAmount?: number;
  }): Promise<{ ok: boolean; visitId: number; dwellTimeSeconds: number; dwellTimeMinutes: number }> => {
    return http(`/api/driver-portal/van-sales/visits/${visitId}/check-out`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
      headers: getDriverAuthHeaders(),
    });
  },

  recordTradeSurvey: async (payload: any): Promise<{ ok: boolean; surveyId: number }> => {
    return http('/api/driver-portal/van-sales/trade-surveys', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  recordBreadcrumb: async (payload: { tripId: number; latitude: number; longitude: number; speedKmh?: number; batteryLevel?: number }): Promise<{ ok: boolean }> => {
    return http('/api/driver-portal/van-sales/breadcrumbs', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  getVisitsHistory: async (params?: {
    tripId?: number;
    repId?: number;
    customerId?: number;
    date?: string;
    noSaleOnly?: boolean;
  }): Promise<{ ok: boolean; metrics: any; visits: any[] }> => {
    const q = new URLSearchParams();
    if (params?.tripId) q.set('tripId', String(params.tripId));
    if (params?.repId) q.set('repId', String(params.repId));
    if (params?.customerId) q.set('customerId', String(params.customerId));
    if (params?.date) q.set('date', params.date);
    if (params?.noSaleOnly) q.set('noSaleOnly', 'true');
    const qs = q.toString() ? `?${q.toString()}` : '';
    return http(`/api/van-sales/admin/visits${qs}`);
  },

  getTradeSurveys: async (params?: {
    tripId?: number;
    customerId?: number;
    surveyType?: string;
  }): Promise<{ ok: boolean; surveys: any[] }> => {
    const q = new URLSearchParams();
    if (params?.tripId) q.set('tripId', String(params.tripId));
    if (params?.customerId) q.set('customerId', String(params.customerId));
    if (params?.surveyType) q.set('surveyType', params.surveyType);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return http(`/api/van-sales/admin/trade-surveys${qs}`);
  },

  getLiveTripBreadcrumbs: async (tripId: number): Promise<{ ok: boolean; tripId: number; pointsCount: number; breadcrumbs: any[] }> => {
    return http(`/api/van-sales/admin/trips/${tripId}/breadcrumbs`);
  },

  getRepFinancialLedger: async (params?: {
    repId?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<VanRepFinancialLedgerResponse> => {
    const q = new URLSearchParams();
    if (params?.repId) q.set('repId', String(params.repId));
    if (params?.status) q.set('status', params.status);
    if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params?.dateTo) q.set('dateTo', params.dateTo);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return http<VanRepFinancialLedgerResponse>(`/api/van-sales/admin/financial-ledger${qs}`);
  },

  settleRepFinancialItem: async (
    id: number,
    payload: { method: 'cash' | 'waiver'; notes?: string; reason?: string; supervisorPin?: string }
  ): Promise<{ ok: boolean; id: number; status: string; receiptVoucherNo?: string }> => {
    return http(`/api/van-sales/admin/financial-ledger/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  pushRepShortagesToPayroll: async (payload: {
    settlementIds: number[];
    targetMonth?: string;
  }): Promise<{ ok: boolean; targetMonth: string; processedCount: number; results: any[] }> => {
    return http('/api/van-sales/admin/financial-ledger/push-to-payroll', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  addRepBonusOrCommission: async (payload: {
    repId: number;
    entryType: 'bonus' | 'commission';
    amount: number;
    notes: string;
  }): Promise<{ ok: boolean; repName: string; settlement: any }> => {
    return http('/api/van-sales/admin/financial-ledger/bonus', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  linkRepToEmployee: async (payload: {
    repId: number;
    employeeId: number | null;
  }): Promise<{ ok: boolean; repId: number; employeeId: number | null }> => {
    return http('/api/van-sales/admin/financial-ledger/link-employee', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getCandidateEmployees: async (): Promise<
    Array<{ id: number; employeeNo?: string | null; displayName: string; nationalId?: string | null }>
  > => {
    return http('/api/van-sales/admin/financial-ledger/candidate-employees');
  },

  autoCreateEmployee: async (payload: {
    repId: number;
  }): Promise<{ ok: boolean; employeeId: number; displayName: string; employeeNo?: string; message?: string }> => {
    return http('/api/van-sales/admin/financial-ledger/auto-create-employee', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export interface VanRepFinancialSettlementItem {
  id: number;
  tenantId: string;
  repId: number;
  repName: string;
  repPhone?: string;
  employeeId?: number | null;
  employeeName?: string | null;
  employeeNo?: string | null;
  tripId?: number | null;
  shiftName?: string | null;
  vehiclePlate?: string | null;
  entryType: 'cash_shortage' | 'stock_shortage' | 'cash_overage' | 'commission' | 'bonus' | 'cash_reimbursement' | 'waiver' | 'payroll_deduction' | string;
  amount: number;
  status: 'pending' | 'settled' | 'waived' | 'pushed_to_payroll' | string;
  settledAt?: string | null;
  settledById?: number | null;
  settledByName?: string | null;
  settlementMethod?: 'cash' | 'payroll' | 'waiver' | string | null;
  notes?: string | null;
  receiptVoucherNo?: string | null;
  payrollRunId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VanRepLedgerBreakdown {
  repId: number;
  repName: string;
  repPhone?: string;
  employeeId?: number | null;
  employeeName?: string | null;
  pendingShortages: number;
  settledShortages: number;
  waivedShortages: number;
  pushedToPayroll: number;
  commissions: number;
  netBalance: number;
  itemsCount: number;
}

export interface VanRepFinancialLedgerResponse {
  items: VanRepFinancialSettlementItem[];
  summary: {
    totalPendingShortages: number;
    totalSettledShortages: number;
    totalWaivedShortages: number;
    totalPushedToPayroll: number;
    totalCommissions: number;
    netRepBalance: number;
    repsBreakdown: VanRepLedgerBreakdown[];
  };
}

export interface FmcgPromotion {
  id: number;
  name: string;
  code: string;
  promoType: 'mix_and_match' | 'tiered_qty' | 'invoice_threshold' | string;
  applyType: 'free_bonus' | 'discount_percent' | 'discount_amount' | string;
  buyConditions: any;
  reward: {
    bonusProductId?: number;
    bonusProductName?: string;
    bonusQty?: number;
    bonusUom?: string;
    bonusReason?: string;
    discountPercent?: number;
    discountAmount?: number;
    targetProductId?: number;
  };
  customerTypes?: string[];
  startDate?: string | null;
  endDate?: string | null;
  isActive: boolean;
  maxApplicationsPerOrder: number;
  priority: number;
  notes?: string | null;
}

export interface RouteOptimizationResult {
  stats: {
    totalStops: number;
    mappedStopsCount: number;
    unmappedStopsCount: number;
    originalDistanceMeters: number;
    optimizedDistanceMeters: number;
    savedDistanceMeters: number;
    originalDistanceKm: number;
    optimizedDistanceKm: number;
    savedDistanceKm: number;
    savingsPercent: number;
  };
  orderedStops: Array<{
    id: number;
    name: string;
    lat?: number | null;
    lng?: number | null;
    address?: string;
    district?: string;
    customerCode?: string;
    sequenceIndex: number;
    legDistanceMeters: number;
    cumulativeDistanceMeters: number;
    isUnmappedGps?: boolean;
  }>;
  persistedCount?: number;
}

export interface VanFraudRadarEvent {
  id: number;
  eventCode: string;
  severity: 'medium' | 'high' | 'critical';
  repId: number;
  repName: string;
  tripId: number | null;
  customerId: number | null;
  customerName: string | null;
  titleAr: string;
  detailsAr: string;
  amountInvolved: number;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface VanRepRiskProfile {
  repId: number;
  repName: string;
  phone: string;
  totalSuspicionEvents: number;
  criticalEventsCount: number;
  highEventsCount: number;
  mediumEventsCount: number;
  priceManipulationCount: number;
  unauthorizedBonusCount: number;
  creditBypassCount: number;
  crossRepCollectionCount: number;
  fakeCardCount: number;
  fraudulentReturnCount: number;
  expenseAbuseCount: number;
  odometerRollbackCount: number;
  geofenceViolationCount: number;
  selfApprovalCount: number;
  invalidPinCount: number;
  unauthorizedLoadOrSettleCount: number;
  settlementShortageCount: number;
  totalAmountAtRisk: number;
  riskScore: number;
  riskLevel: 'safe' | 'watch' | 'high_risk';
  flags: string[];
  lastEventAt: string | null;
}

export interface VanFraudRadarSummaryResponse {
  ok?: boolean;
  periodDays: number;
  kpis: {
    totalRepsMonitored: number;
    highRiskRepsCount: number;
    watchRepsCount: number;
    totalSuspicionEvents: number;
    criticalEventsCount: number;
    totalAmountAtRisk: number;
    blockedTamperAttemptsCount: number;
    settlementShortageEventsCount: number;
  };
  repProfiles: VanRepRiskProfile[];
  recentEvents: VanFraudRadarEvent[];
}


