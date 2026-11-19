import type { VanTripSummary } from './van-sales-types-a';

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
