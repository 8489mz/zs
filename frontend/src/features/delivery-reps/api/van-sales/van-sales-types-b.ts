import type {
  RepTargetMetrics,
  VanAssignedVehicle,
  VanStockItem,
  VanTripSummary,
} from './van-sales-types-a';

export interface VanActiveTripResponse {
  hasActiveTrip: boolean;
  // INV-VAN-OFFLINE-TIMESTAMPS: server clock anchor for useServerClock
  // — the receipt date and every displayed date derive from this.
  serverTime?: string;
  serverTimezone?: string;
  // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the tenant rep
  // discount cap % (default 5) — the checkout gates on this.
  discountCapPercent?: number;
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
    // INV-VAN-PIECE-COUNT-BASIS: sale-unit multiplier so the
    // no-breakdown fallback can count pieces (qty x multiplier).
    unitMultiplier?: number;
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
  // INV-VAN-FIELD-RETURN-CARTON-QTY: the sale unit the qty is in —
  // without it a carton return posts its raw qty as pieces.
  unitMultiplier?: number;
  unitName?: string;
}

export interface CustomerEligibleSale {
  id: number;
  docNo: string;
  createdAt: string;
  total: number;
  discount: number;
  // INV-VAN-RETURN-REFUND-METHOD-DEFAULT: the source invoice's
  // payment type — the return form defaults the settlement from it
  // ('credit' for a credit sale, 'cash' for any other method).
  paymentType?: string;
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
  /** Reserved qty at this warehouse (F10: the gate nets it off). */
  reservedQty?: number;
  /** Canonical available at this warehouse (F10: on-hand minus reserved, capped by the global leg). */
  availableQty?: number;
}

export interface VanLoadPendingHold {
  docNo: string;
  repId?: number;
  repName?: string;
  qty: number;
  sourceWarehouseId?: number;
}

export interface DriverAvailableProduct {
  id: number;
  name: string;
  barcode: string;
  sku: string;
  retailPrice: number;
  unit: string;
  totalStock: number;
  /** Canonical available for a load (F10) — the number the form clamp, the pre-check and the gate all use. */
  availableQty?: number;
  /** On-hand qty at the requested scope (same number as totalStock, named so the two stay distinguishable). */
  onHandQty?: number;
  /** Reserved qty at the requested scope. */
  reservedQty?: number;
  /** Pending load permits that will draw from the same stock (informational — they reserve nothing). */
  pendingHolds?: VanLoadPendingHold[];
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
