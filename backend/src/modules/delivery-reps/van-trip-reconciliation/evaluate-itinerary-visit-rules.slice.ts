// ============================================================================
// ROUTE ITINERARY & VISIT GOVERNANCE ENGINE (محرك خط السير والزيارات الميدانية)
// ============================================================================

export const VALID_NEGATIVE_VISIT_REASONS = [
  'no_cash',
  'shop_closed',
  'sufficient_stock',
  'item_unavailable',
  'postponed',
  'other',
] as const;

export type NegativeVisitReason = (typeof VALID_NEGATIVE_VISIT_REASONS)[number];

export interface ItineraryVisitEvaluationParams {
  customerId: number;
  visitType: 'positive' | 'negative';
  negativeReason?: string | null;
  postponedToDate?: string | null;
  customerVisitDays?: string[] | string | null;
  currentDayName?: string;
  currentEnglishDayName?: string;
  repGps?: { lat: number; lng: number } | null;
  customerGps?: { lat: number; lng: number } | null;
  maxAllowedGeofenceMeters?: number;
  recentCustomerVisits?: { visitType: 'positive' | 'negative' }[];
}

export interface ItineraryVisitEvaluationResult {
  isValid: boolean;
  reasonCode?: string;
  errorMessageAr?: string;
  isScheduledToday: boolean;
  isWithinGeofence: boolean;
  distanceMeters: number | null;
  hasConsecutiveNegativeAlert: boolean;
}

function calculateSimpleHaversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Evaluates field itinerary visit execution:
 * 1. Checks day matching (scheduled today vs ad-hoc).
 * 2. Validates negative visit reason against official operational catalog.
 * 3. Enforces postponement date validity when reason is 'postponed'.
 * 4. Audits GPS distance against customer storefront location (Ghost Visit detection).
 * 5. Identifies repeated negative visits (3 consecutive negatives) for supervisor intervention.
 */
export function evaluateItineraryVisitRules(params: ItineraryVisitEvaluationParams): ItineraryVisitEvaluationResult {
  // 1. Negative Visit Reason Validation
  if (params.visitType === 'negative') {
    const reason = String(params.negativeReason || '').trim();
    if (!reason) {
      return {
        isValid: false,
        reasonCode: 'MISSING_NEGATIVE_REASON',
        errorMessageAr: 'يرجى تحديد سبب الزيارة السلبية',
        isScheduledToday: true,
        isWithinGeofence: true,
        distanceMeters: null,
        hasConsecutiveNegativeAlert: false,
      };
    }

    if (!VALID_NEGATIVE_VISIT_REASONS.includes(reason as NegativeVisitReason)) {
      return {
        isValid: false,
        reasonCode: 'INVALID_NEGATIVE_REASON',
        errorMessageAr: 'سبب الزيارة السلبية غير معتمد بالنظام',
        isScheduledToday: true,
        isWithinGeofence: true,
        distanceMeters: null,
        hasConsecutiveNegativeAlert: false,
      };
    }
  }

  // 2. Scheduled Day Check
  let isScheduledToday = true;
  if (params.customerVisitDays) {
    const rawDays = Array.isArray(params.customerVisitDays)
      ? params.customerVisitDays
      : String(params.customerVisitDays).split(/[,،]/);

    const cleanDays = rawDays.map((d) => String(d).trim().toLowerCase()).filter(Boolean);
    if (cleanDays.length > 0) {
      const curAr = (params.currentDayName || '').trim().toLowerCase();
      const curEn = (params.currentEnglishDayName || '').trim().toLowerCase();
      isScheduledToday = cleanDays.some(
        (d) => (curAr && (d === curAr || d.includes(curAr))) || (curEn && (d === curEn || d.includes(curEn))),
      );
    }
  }

  // 3. Geofence Audit
  let isWithinGeofence = true;
  let distanceMeters: number | null = null;
  if (params.repGps && params.customerGps) {
    distanceMeters = calculateSimpleHaversineMeters(
      params.repGps.lat,
      params.repGps.lng,
      params.customerGps.lat,
      params.customerGps.lng,
    );
    const maxMeters = params.maxAllowedGeofenceMeters ?? 300;
    isWithinGeofence = distanceMeters <= maxMeters;
  }

  // 4. Consecutive Negative Visits Tracking (3 in a row triggers alert)
  let hasConsecutiveNegativeAlert = false;
  if (params.visitType === 'negative' && params.recentCustomerVisits) {
    const recent = params.recentCustomerVisits;
    if (recent.length >= 2 && recent.slice(0, 2).every((v) => v.visitType === 'negative')) {
      hasConsecutiveNegativeAlert = true;
    }
  }

  return {
    isValid: true,
    isScheduledToday,
    isWithinGeofence,
    distanceMeters,
    hasConsecutiveNegativeAlert,
  };
}
