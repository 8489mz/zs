import { type MoneyDigits, roundMoney as roundBookMoney } from '../accounting/engines/money-minor-units.engine';

/**
 * Pure Calculation Engine for Representative Monthly Sales Targets.
 *
 * Complies with Rule 13 (Strict Financial & Operational Audit Protocol:
 * Tests Must Import Production Code). Both the backend service and unit
 * tests must import this exact file.
 *
 * Book digits are REQUIRED for the money functions in this file
 * (INV-REP-COMMISSION-DIGITS): commissions and rep-isolated customer
 * balances are money owed to people, so rounding them at an assumed 2
 * decimals would silently cut a 3-decimal tenant's payouts. The old
 * file-private 2-decimal rounder (which also swallowed non-finite
 * values to 0) is gone; rounding goes through the canonical engine
 * at the caller's digits and fails closed on non-finite input.
 * calculateRepTargetMetrics normalizes its money INPUTS at the
 * caller's book digits (INV-REP-TARGET-METRICS-DIGITS): the old
 * toFixed(2) normalization misstated a 3-decimal tenant's target
 * and actuals by up to half a minor unit and could even flip the
 * achieved comparison for a rep 0.001 short of target. Its
 * remaining/required-daily OUTPUTS deliberately stay whole
 * currency units (Math.round / Math.ceil) — a display convention
 * the frontend duplicates when it renders them — so only the
 * three input normalizations take digits, never the outputs.
 */

export interface RepTargetCalculationInput {
  targetAmount: number;
  actualSalesMTD: number;
  collectionTarget?: number | null;
  actualCollectionsMTD?: number;
  visitsTarget?: number | null;
  actualVisitsMTD?: number;
  currentDate?: Date | string;
  weekendDays?: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat (Default [5] for Friday)
  officialHolidays?: string[]; // Array of 'YYYY-MM-DD' strings
  // REQUIRED (INV-REP-TARGET-METRICS-DIGITS): normalizes the money
  // inputs at the tenant's book digits. The remaining/required-daily
  // outputs deliberately stay whole units and do not take digits.
  moneyDigits: MoneyDigits;
}

export interface RepTargetCalculationResult {
  periodMonth: string; // 'YYYY-MM'
  targetAmount: number;
  actualSalesMTD: number;
  achievementRate: number; // percentage (e.g. 62.5)
  remainingTarget: number;
  isTargetAchieved: boolean;
  totalDaysInMonth: number;
  currentDayOfMonth: number;
  remainingDaysTotal: number;
  remainingWorkingDays: number;
  requiredDailyTarget: number;
  excludedFridaysCount: number;
  excludedHolidaysCount: number;
  // Multi-dimensional targets
  collectionTarget?: number | null;
  actualCollectionsMTD?: number;
  collectionAchievementRate?: number | null;
  remainingCollection?: number;
  requiredDailyCollection?: number;
  isCollectionAchieved?: boolean;
  visitsTarget?: number | null;
  actualVisitsMTD?: number;
  visitsAchievementRate?: number | null;
  remainingVisits?: number;
  requiredDailyVisits?: number;
  isVisitsAchieved?: boolean;
}

export function calculateRepTargetMetrics(input: RepTargetCalculationInput): RepTargetCalculationResult {
  const target = Math.max(0, roundBookMoney(Number(input.targetAmount || 0), input.moneyDigits));
  const actual = Math.max(0, roundBookMoney(Number(input.actualSalesMTD || 0), input.moneyDigits));

  // Date parsing in local/UTC context
  let dateObj: Date;
  if (!input.currentDate) {
    dateObj = new Date();
  } else if (input.currentDate instanceof Date) {
    dateObj = new Date(input.currentDate.getTime());
  } else {
    // If string like '2026-09-26'
    const parts = String(input.currentDate).split('T')[0].split('-');
    if (parts.length === 3) {
      dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    } else {
      dateObj = new Date(input.currentDate);
    }
  }

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth(); // 0-indexed (0=Jan, 8=Sep)
  const currentDay = dateObj.getDate();

  const periodMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Total calendar days in this month
  const lastDayOfMonthObj = new Date(year, month + 1, 0);
  const totalDaysInMonth = lastDayOfMonthObj.getDate();

  const weekendDays = input.weekendDays && input.weekendDays.length ? input.weekendDays : [5]; // Default Friday (5)
  const holidaySet = new Set<string>((input.officialHolidays || []).map((h) => String(h).trim().slice(0, 10)));

  // Remaining days counting from today inclusive through end of month
  let remainingDaysTotal = 0;
  let remainingWorkingDays = 0;
  let excludedFridaysCount = 0;
  let excludedHolidaysCount = 0;

  for (let d = currentDay; d <= totalDaysInMonth; d++) {
    remainingDaysTotal++;
    const testDate = new Date(year, month, d);
    const dayOfWeek = testDate.getDay(); // 0=Sun, 5=Fri, 6=Sat
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const isWeekend = weekendDays.includes(dayOfWeek);
    const isHoliday = holidaySet.has(dateStr);

    if (isWeekend) {
      excludedFridaysCount++;
    } else if (isHoliday) {
      excludedHolidaysCount++;
    } else {
      remainingWorkingDays++;
    }
  }

  const achievementRate = target > 0 ? Number(((actual / target) * 100).toFixed(1)) : 0;
  const remainingTarget = Math.max(0, Math.round(target - actual));
  const isTargetAchieved = actual >= target && target > 0;

  let requiredDailyTarget = 0;
  if (!isTargetAchieved && remainingTarget > 0) {
    if (remainingWorkingDays > 0) {
      requiredDailyTarget = Math.ceil(remainingTarget / remainingWorkingDays);
    } else {
      // If no working days left in the month, remaining must be done today
      requiredDailyTarget = remainingTarget;
    }
  }

  // Multi-dimensional: Collection Target Calculations
  const colTarget = input.collectionTarget !== undefined && input.collectionTarget !== null && !isNaN(Number(input.collectionTarget))
    ? Math.max(0, Math.round(Number(input.collectionTarget)))
    : null;
  const colActual = input.actualCollectionsMTD !== undefined && input.actualCollectionsMTD !== null
    ? Math.max(0, roundBookMoney(Number(input.actualCollectionsMTD), input.moneyDigits))
    : 0;

  const collectionAchievementRate = colTarget && colTarget > 0 ? Number(((colActual / colTarget) * 100).toFixed(1)) : null;
  const remainingCollection = colTarget && colTarget > 0 ? Math.max(0, Math.round(colTarget - colActual)) : 0;
  const isCollectionAchieved = colTarget && colTarget > 0 ? colActual >= colTarget : false;
  let requiredDailyCollection = 0;
  if (colTarget && colTarget > 0 && !isCollectionAchieved && remainingCollection > 0) {
    requiredDailyCollection = remainingWorkingDays > 0 ? Math.ceil(remainingCollection / remainingWorkingDays) : remainingCollection;
  }

  // Multi-dimensional: Visits Target Calculations
  const visTarget = input.visitsTarget !== undefined && input.visitsTarget !== null && !isNaN(Number(input.visitsTarget))
    ? Math.max(0, Math.round(Number(input.visitsTarget)))
    : null;
  const visActual = input.actualVisitsMTD !== undefined && input.actualVisitsMTD !== null
    ? Math.max(0, Math.round(Number(input.actualVisitsMTD)))
    : 0;

  const visitsAchievementRate = visTarget && visTarget > 0 ? Number(((visActual / visTarget) * 100).toFixed(1)) : null;
  const remainingVisits = visTarget && visTarget > 0 ? Math.max(0, visTarget - visActual) : 0;
  const isVisitsAchieved = visTarget && visTarget > 0 ? visActual >= visTarget : false;
  let requiredDailyVisits = 0;
  if (visTarget && visTarget > 0 && !isVisitsAchieved && remainingVisits > 0) {
    requiredDailyVisits = remainingWorkingDays > 0 ? Math.ceil(remainingVisits / remainingWorkingDays) : remainingVisits;
  }

  return {
    periodMonth,
    targetAmount: target,
    actualSalesMTD: actual,
    achievementRate,
    remainingTarget,
    isTargetAchieved,
    totalDaysInMonth,
    currentDayOfMonth: currentDay,
    remainingDaysTotal,
    remainingWorkingDays,
    requiredDailyTarget,
    excludedFridaysCount,
    excludedHolidaysCount,
    collectionTarget: colTarget,
    actualCollectionsMTD: colActual,
    collectionAchievementRate,
    remainingCollection,
    requiredDailyCollection,
    isCollectionAchieved,
    visitsTarget: visTarget,
    actualVisitsMTD: visActual,
    visitsAchievementRate,
    remainingVisits,
    requiredDailyVisits,
    isVisitsAchieved,
  };
}

export interface RepCommissionInput {
  actualSales: number;
  actualCollections: number;
  salesTarget?: number | null;
  collectionTarget?: number | null;
  salesCommissionRatePercent?: number | null;
  collectionCommissionRatePercent?: number | null;
  targetBonusRatePercent?: number | null;
  alreadyPaidAmount?: number | null;
  moneyDigits: MoneyDigits;
}

export interface RepCommissionMetricsResult {
  salesCommissionRatePercent: number;
  collectionCommissionRatePercent: number;
  targetBonusRatePercent: number;
  salesCommissionAmount: number;
  collectionCommissionAmount: number;
  isTargetBonusEligible: boolean;
  targetBonusAmount: number;
  totalEarnedCommission: number;
  alreadyPaidAmount: number;
  remainingPayableCommission: number;
}

/**
 * Pure calculation engine for Delivery & Van Sales Representative Commissions.
 * Calculates commission on net sales, commission on cash/credit collections,
 * and achievement tier bonus when monthly sales target is met (>= 100%).
 */
export function calculateRepCommissionMetrics(input: RepCommissionInput): RepCommissionMetricsResult {
  const actualSales = Math.max(0, Number(input.actualSales || 0));
  const actualCollections = Math.max(0, Number(input.actualCollections || 0));
  const salesTarget = Math.max(0, Number(input.salesTarget || 0));

  const salesRate = input.salesCommissionRatePercent !== undefined && input.salesCommissionRatePercent !== null
    ? Math.max(0, Number(input.salesCommissionRatePercent))
    : 1.0;
  const collectionRate = input.collectionCommissionRatePercent !== undefined && input.collectionCommissionRatePercent !== null
    ? Math.max(0, Number(input.collectionCommissionRatePercent))
    : 0.5;
  const bonusRate = input.targetBonusRatePercent !== undefined && input.targetBonusRatePercent !== null
    ? Math.max(0, Number(input.targetBonusRatePercent))
    : 0.5;

  const salesCommissionAmount = roundBookMoney((actualSales * salesRate) / 100, input.moneyDigits);
  const collectionCommissionAmount = roundBookMoney((actualCollections * collectionRate) / 100, input.moneyDigits);
  const isTargetBonusEligible = salesTarget > 0 && actualSales >= salesTarget;
  const targetBonusAmount = isTargetBonusEligible ? roundBookMoney((actualSales * bonusRate) / 100, input.moneyDigits) : 0;

  const totalEarnedCommission = roundBookMoney(
    salesCommissionAmount + collectionCommissionAmount + targetBonusAmount,
    input.moneyDigits,
  );
  const alreadyPaidAmount = roundBookMoney(Math.max(0, Number(input.alreadyPaidAmount || 0)), input.moneyDigits);
  const remainingPayableCommission = roundBookMoney(
    Math.max(0, totalEarnedCommission - alreadyPaidAmount),
    input.moneyDigits,
  );

  return {
    salesCommissionRatePercent: salesRate,
    collectionCommissionRatePercent: collectionRate,
    targetBonusRatePercent: bonusRate,
    salesCommissionAmount,
    collectionCommissionAmount,
    isTargetBonusEligible,
    targetBonusAmount,
    totalEarnedCommission,
    alreadyPaidAmount,
    remainingPayableCommission,
  };
}

export function isValidCoordinatePair(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Extracts GPS coordinates (lat, lng) from customer metadata or Google Maps location URL.
 */
export function extractCoordinatesFromCustomerLocation(input: {
  locationUrl?: string | null;
  metadata?: Record<string, any> | string | null;
}): { lat: number; lng: number } | null {
  let metaObj: Record<string, any> | null = null;
  if (input.metadata) {
    if (typeof input.metadata === 'string') {
      try {
        metaObj = JSON.parse(input.metadata);
      } catch {
        metaObj = null;
      }
    } else if (typeof input.metadata === 'object') {
      metaObj = input.metadata;
    }
  }

  if (metaObj) {
    const directLat = Number(metaObj.gps_lat ?? metaObj.lat ?? metaObj.latitude);
    const directLng = Number(metaObj.gps_lng ?? metaObj.lng ?? metaObj.longitude);
    if (isValidCoordinatePair(directLat, directLng)) {
      return { lat: directLat, lng: directLng };
    }
  }

  const rawUrl = String(
    input.locationUrl ||
      metaObj?.location_url ||
      metaObj?.locationUrl ||
      metaObj?.google_maps_url ||
      '',
  ).trim();
  if (!rawUrl) return null;

  // Pattern 1: @lat,lng (e.g. https://www.google.com/maps/place/.../@30.0444,31.2357,17z)
  const atMatch = rawUrl.match(/@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  // Pattern 2: ?q=lat,lng or &q=lat,lng or query=lat,lng or ll=lat,lng or destination=lat,lng
  const queryMatch = rawUrl.match(/(?:[?&](?:q|query|ll|center|daddr|saddr|destination)=)(-?\d+(?:\.\d+)?)\s*(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if (queryMatch) {
    const lat = Number(queryMatch[1]);
    const lng = Number(queryMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  // Pattern 3: !3dLAT!4dLNG in Google Maps embed/place URLs
  const bangMatch = rawUrl.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bangMatch) {
    const lat = Number(bangMatch[1]);
    const lng = Number(bangMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  // Pattern 4: Direct "lat, lng" string
  const plainMatch = rawUrl.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (plainMatch) {
    const lat = Number(plainMatch[1]);
    const lng = Number(plainMatch[2]);
    if (isValidCoordinatePair(lat, lng)) return { lat, lng };
  }

  return null;
}

/**
 * Calculates great-circle distance in meters between two GPS coordinates using Haversine formula.
 */
export function calculateHaversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export interface GeofenceEvaluationResult {
  status: 'within_geofence' | 'outside_geofence' | 'no_rep_gps' | 'no_customer_gps';
  distanceMeters: number | null;
  isCompliant: boolean | null;
  maxAllowedMeters: number;
}

/**
 * Evaluates whether a field rep's GPS coordinates fall within the customer's geofence radius.
 */
export function evaluateGeofenceCompliance(params: {
  repLat?: number | null;
  repLng?: number | null;
  customerLat?: number | null;
  customerLng?: number | null;
  maxAllowedMeters?: number;
}): GeofenceEvaluationResult {
  const maxAllowedMeters = Math.max(50, Number(params.maxAllowedMeters || 300));
  const repLat = params.repLat !== undefined && params.repLat !== null ? Number(params.repLat) : NaN;
  const repLng = params.repLng !== undefined && params.repLng !== null ? Number(params.repLng) : NaN;
  if (!isValidCoordinatePair(repLat, repLng)) {
    return {
      status: 'no_rep_gps',
      distanceMeters: null,
      isCompliant: null,
      maxAllowedMeters,
    };
  }

  const custLat = params.customerLat !== undefined && params.customerLat !== null ? Number(params.customerLat) : NaN;
  const custLng = params.customerLng !== undefined && params.customerLng !== null ? Number(params.customerLng) : NaN;
  if (!isValidCoordinatePair(custLat, custLng)) {
    return {
      status: 'no_customer_gps',
      distanceMeters: null,
      isCompliant: null,
      maxAllowedMeters,
    };
  }

  const distanceMeters = calculateHaversineDistanceMeters(repLat, repLng, custLat, custLng);
  const isCompliant = distanceMeters <= maxAllowedMeters;
  return {
    status: isCompliant ? 'within_geofence' : 'outside_geofence',
    distanceMeters,
    isCompliant,
    maxAllowedMeters,
  };
}

export interface BatchExpiryStatusResult {
  status: 'valid' | 'near_expiry' | 'expired' | 'no_expiry';
  daysRemaining: number | null;
  earliestExpiryDate: string | null;
}

/**
 * Evaluates FEFO / Batch Expiry status for Van Stock and Warehouse Load items.
 */
export function evaluateBatchExpiryStatus(
  expiryDateStr: string | null | undefined,
  referenceDate: Date = new Date(),
  nearExpiryDaysThreshold = 60,
): BatchExpiryStatusResult {
  const raw = String(expiryDateStr || '').trim();
  if (!raw) {
    return { status: 'no_expiry', daysRemaining: null, earliestExpiryDate: null };
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { status: 'no_expiry', daysRemaining: null, earliestExpiryDate: null };
  }

  const refDayStart = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const expDayStart = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
  const daysRemaining = Math.floor((expDayStart - refDayStart) / (1000 * 60 * 60 * 24));
  const isoDate = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;

  if (daysRemaining < 0) {
    return { status: 'expired', daysRemaining, earliestExpiryDate: isoDate };
  }
  if (daysRemaining <= nearExpiryDaysThreshold) {
    return { status: 'near_expiry', daysRemaining, earliestExpiryDate: isoDate };
  }
  return { status: 'valid', daysRemaining, earliestExpiryDate: isoDate };
}

export interface CustomerRepLedgerEntryInput {
  customerId: number;
  repId: number | null;
  repName?: string | null;
  amount: number; // positive = debit (sale), negative = credit (payment / return)
}

export interface CustomerRepBalanceItem {
  repId: number;
  repName: string;
  balance: number;
  totalDebit: number;
  totalCredit: number;
}

export interface CustomerRepBalanceBreakdown {
  customerId: number;
  totalCustomerBalance: number;
  totalRepBalance: number;
  unassignedBalance: number;
  repBalances: CustomerRepBalanceItem[];
  byRepId: Record<number, CustomerRepBalanceItem>;
}

/**
 * Extracts all assigned representative IDs from customer metadata,
 * supporting both legacy single `assigned_rep_id` and multi-rep `assigned_rep_ids`.
 */
export function extractAssignedRepIds(
  metadata: Record<string, any> | string | null | undefined,
): number[] {
  let metaObj: Record<string, any> | null = null;
  if (metadata) {
    if (typeof metadata === 'string') {
      try {
        metaObj = JSON.parse(metadata);
      } catch {
        metaObj = null;
      }
    } else if (typeof metadata === 'object') {
      metaObj = metadata;
    }
  }
  if (!metaObj) return [];

  const ids = new Set<number>();
  if (Array.isArray(metaObj.assigned_rep_ids)) {
    for (const raw of metaObj.assigned_rep_ids) {
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) ids.add(n);
    }
  }
  if (metaObj.assigned_rep_id !== undefined && metaObj.assigned_rep_id !== null) {
    const single = Number(metaObj.assigned_rep_id);
    if (Number.isInteger(single) && single > 0) ids.add(single);
  }
  if (Array.isArray(metaObj.rep_schedules)) {
    for (const item of metaObj.rep_schedules) {
      const n = Number(item?.repId ?? item?.rep_id);
      if (Number.isInteger(n) && n > 0) ids.add(n);
    }
  }
  return Array.from(ids);
}

/**
 * Pure aggregation engine for Rep-to-Rep Customer Account Isolation (عزل حسابات المناديب للعميل المشترك).
 * Ensures that if Rep 1 is owed 500 EGP and Rep 2 is owed 2,000 EGP by the same shop (e.g. "محل البركة" C-0002),
 * each rep's balance is strictly isolated, while the Supervisor/Owner sees the unified 2,500 EGP total
 * alongside each rep's exact share.
 */
export function aggregateCustomerBalancesByRep(
  entries: CustomerRepLedgerEntryInput[],
  // Defaulted (not `?`) so the required `digits` may follow it: a
  // required parameter cannot follow an optional one (TS1016).
  customerTotalBalances: Record<number, number> | undefined = undefined,
  digits: MoneyDigits,
): Map<number, CustomerRepBalanceBreakdown> {
  const result = new Map<number, CustomerRepBalanceBreakdown>();

  const ensureCustomer = (customerId: number): CustomerRepBalanceBreakdown => {
    let item = result.get(customerId);
    if (!item) {
      item = {
        customerId,
        totalCustomerBalance: 0,
        totalRepBalance: 0,
        unassignedBalance: 0,
        repBalances: [],
        byRepId: {},
      };
      result.set(customerId, item);
    }
    return item;
  };

  if (customerTotalBalances) {
    for (const [cidKey, bal] of Object.entries(customerTotalBalances)) {
      const cid = Number(cidKey);
      if (Number.isInteger(cid) && cid > 0) {
        const item = ensureCustomer(cid);
        item.totalCustomerBalance = roundBookMoney(Number(bal || 0), digits);
      }
    }
  }

  for (const row of entries || []) {
    const cid = Number(row.customerId);
    if (!Number.isInteger(cid) || cid <= 0) continue;
    const amt = roundBookMoney(Number(row.amount || 0), digits);
    if (amt === 0) continue;

    const item = ensureCustomer(cid);
    const repId = row.repId !== undefined && row.repId !== null ? Number(row.repId) : null;

    if (repId && Number.isInteger(repId) && repId > 0) {
      let repItem = item.byRepId[repId];
      if (!repItem) {
        repItem = {
          repId,
          repName: String(row.repName || `مندوب #${repId}`).trim(),
          balance: 0,
          totalDebit: 0,
          totalCredit: 0,
        };
        item.byRepId[repId] = repItem;
      } else if (row.repName && repItem.repName.startsWith('مندوب #')) {
        repItem.repName = String(row.repName).trim();
      }

      repItem.balance = roundBookMoney(repItem.balance + amt, digits);
      if (amt > 0) {
        repItem.totalDebit = roundBookMoney(repItem.totalDebit + amt, digits);
      } else {
        repItem.totalCredit = roundBookMoney(repItem.totalCredit + Math.abs(amt), digits);
      }
    } else {
      item.unassignedBalance = roundBookMoney(item.unassignedBalance + amt, digits);
    }
  }

  for (const [cid, item] of result.entries()) {
    const repList = Object.values(item.byRepId).sort((a, b) => {
      if (b.balance !== a.balance) return b.balance - a.balance;
      return a.repId - b.repId;
    });
    item.repBalances = repList;
    item.totalRepBalance = roundBookMoney(repList.reduce((sum, r) => sum + r.balance, 0), digits);

    const hasExplicitCustomerTotal =
      customerTotalBalances !== undefined &&
      Object.prototype.hasOwnProperty.call(customerTotalBalances, cid);

    if (hasExplicitCustomerTotal) {
      const explicitTotal = roundBookMoney(Number(customerTotalBalances![cid] || 0), digits);
      item.totalCustomerBalance = explicitTotal;
      item.unassignedBalance = roundBookMoney(explicitTotal - item.totalRepBalance, digits);
    } else {
      item.totalCustomerBalance = roundBookMoney(item.totalRepBalance + item.unassignedBalance, digits);
    }
  }

  return result;
}

/**
 * Resolves the isolated balance visible to a specific rep (`repId`) for a customer.
 * - Strictly returns only `repId`'s own ledger balance (`byRepId[repId].balance`).
 * - Fallback: If no rep has any ledger balance on this customer (`totalRepBalance === 0`)
 *   AND the customer has a legacy opening balance (`unassignedBalance > 0`)
 *   AND the customer is exclusively assigned to this single rep (`assignedRepIds.length === 1 && assignedRepIds[0] === repId`),
 *   returns `unassignedBalance`.
 * - Otherwise returns `0` if `repId` has no ledger transactions with the customer (never leaks another rep's balance).
 */
export function resolveIsolatedRepCustomerBalance(params: {
  repId: number;
  breakdown?: CustomerRepBalanceBreakdown | null;
  assignedRepIds?: number[];
  fallbackTotalBalance?: number;
  moneyDigits: MoneyDigits;
}): {
  repBalance: number;
  otherRepsBalance: number;
  totalCustomerBalance: number;
} {
  const repId = Number(params.repId);
  const breakdown = params.breakdown;
  const assignedIds = params.assignedRepIds || [];

  if (!breakdown) {
    const total = roundBookMoney(Number(params.fallbackTotalBalance || 0), params.moneyDigits);
    const isExclusivelyAssignedToRep = assignedIds.length === 1 && Number(assignedIds[0]) === repId;
    const repBal = isExclusivelyAssignedToRep ? total : 0;
    return {
      repBalance: repBal,
      otherRepsBalance: roundBookMoney(Math.max(0, total - repBal), params.moneyDigits),
      totalCustomerBalance: total,
    };
  }

  const ownEntry = breakdown.byRepId[repId];
  const ownLedgerBalance = ownEntry ? roundBookMoney(ownEntry.balance, params.moneyDigits) : 0;
  const otherRepsLedgerBalance = roundBookMoney(
    breakdown.repBalances
      .filter((r) => r.repId !== repId && r.balance > 0)
      .reduce((sum, r) => sum + r.balance, 0),
    params.moneyDigits,
  );

  const isExclusivelyAssignedToRep =
    assignedIds.length === 1 &&
    Number(assignedIds[0]) === repId &&
    otherRepsLedgerBalance === 0;

  const effectiveRepBalance =
    isExclusivelyAssignedToRep && breakdown.unassignedBalance > 0
      ? roundBookMoney(ownLedgerBalance + breakdown.unassignedBalance, params.moneyDigits)
      : ownLedgerBalance;

  return {
    repBalance: effectiveRepBalance,
    otherRepsBalance: otherRepsLedgerBalance,
    totalCustomerBalance: breakdown.totalCustomerBalance,
  };
}

/**
 * Validates that a field representative's collection from a shared customer
 * does not encroach upon or deduct from another representative's isolated debt balance.
 */
export function validateIsolatedRepCollection(params: {
  repId: number;
  collectionAmount: number;
  repBalance: number;
  otherRepsBalance: number;
  totalCustomerBalance: number;
  moneyDigits: MoneyDigits;
}): {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
  repPreviousBalance: number;
  repNewBalance: number;
  companyPreviousBalance: number;
  companyNewBalance: number;
} {
  const amount = roundBookMoney(Number(params.collectionAmount || 0), params.moneyDigits);
  const repPreviousBalance = roundBookMoney(Number(params.repBalance || 0), params.moneyDigits);
  const otherRepsBalance = roundBookMoney(Number(params.otherRepsBalance || 0), params.moneyDigits);
  const companyPreviousBalance = roundBookMoney(Number(params.totalCustomerBalance || 0), params.moneyDigits);

  if (amount <= 0) {
    return {
      allowed: false,
      errorCode: 'INVALID_COLLECTION_AMOUNT',
      errorMessage: 'يجب أن تكون قيمة التحصيل أكبر من الصفر',
      repPreviousBalance,
      repNewBalance: repPreviousBalance,
      companyPreviousBalance,
      companyNewBalance: companyPreviousBalance,
    };
  }

  // If the amount exceeds this rep's own balance AND another rep has balance on this customer,
  // block immediately to prevent mixing rep accounts!
  if (amount > repPreviousBalance && otherRepsBalance > 0) {
    return {
      allowed: false,
      errorCode: 'REP_ISOLATED_BALANCE_EXCEEDED',
      errorMessage:
        repPreviousBalance <= 0
          ? `لا توجد مديونية مستحقة لك على هذا العميل (رصيدك معه: 0 ج.م)، بينما توجد مديونية بقيمة (${otherRepsBalance} ج.م) تخص مناديب آخرين وعهدهم مستقلة.`
          : `لا يمكن تحصيل مبلغ (${amount} ج.م) أكبر من مديونية العميل الخاصة بعهدتك (${repPreviousBalance} ج.م). باقي مديونية العميل (${otherRepsBalance} ج.م) تخص مناديب آخرين وعهدهم مستقلة.`,
      repPreviousBalance,
      repNewBalance: repPreviousBalance,
      companyPreviousBalance,
      companyNewBalance: companyPreviousBalance,
    };
  }

  // INV-REP-COLLECTION-TOTAL-BALANCE-CAP: a field collection must never
  // exceed the customer's TOTAL debt (this rep's share + other reps'
  // balances + any unassigned balance). Before this cap the only guard
  // above fired when another rep held balance on the same customer, so
  // a sole-rep customer could be collected past zero and
  // customers.balance (and 1130) went negative with no recorded advance
  // intent. There is no advance concept on the field-collection path
  // (no advance flag on the payload, no advance column on
  // customer_payments), so anything above the total debt is refused
  // hard with a specific error naming both amounts. The cross-rep guard
  // above still runs first: collecting another rep's share stays
  // refused under its own code even when the total would allow it.
  if (amount > companyPreviousBalance) {
    return {
      allowed: false,
      errorCode: 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
      errorMessage: `لا يمكن تحصيل مبلغ (${amount} ج.م) أكبر من إجمالي مديونية العميل (${companyPreviousBalance} ج.م). لا توجد سلفة مسجلة على هذا العميل تسمح بالتحصيل الزائد.`,
      repPreviousBalance,
      repNewBalance: repPreviousBalance,
      companyPreviousBalance,
      companyNewBalance: companyPreviousBalance,
    };
  }

  return {
    allowed: true,
    repPreviousBalance,
    repNewBalance: roundBookMoney(repPreviousBalance - amount, params.moneyDigits),
    companyPreviousBalance,
    companyNewBalance: roundBookMoney(companyPreviousBalance - amount, params.moneyDigits),
  };
}


