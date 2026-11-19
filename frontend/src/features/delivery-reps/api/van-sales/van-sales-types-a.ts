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
  // INV-VAN-PIECE-COUNT-BASIS: base unit name for the stock balance
  // (qty is in pieces); unitName stays the packaging name.
  stockUnitName?: string;
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
