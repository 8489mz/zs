/**
 * FMCG Visit Execution & Merchandising Engine (Pure Engine)
 * Handles geodesic geofencing, dwell time calculations, strike-rate metrics,
 * and structured store visit transitions.
 */

import { type MoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';

export interface VisitCoordinates {
  latitude: number;
  longitude: number;
}

export interface GeofenceEvaluationResult {
  isValid: boolean;
  distanceMeters: number;
  thresholdMeters: number;
  isUnmappedCustomer: boolean;
}

export interface NoSaleReasonDefinition {
  code: string;
  nameAr: string;
  category: 'operational' | 'commercial' | 'credit' | 'logistics';
  requiresNotes?: boolean;
}

export const FMCG_STANDARD_NO_SALE_REASONS: NoSaleReasonDefinition[] = [
  { code: 'store_closed', nameAr: 'المحل مغلق', category: 'operational' },
  { code: 'sufficient_stock', nameAr: 'لديه مخزون كافٍ من الأصناف', category: 'commercial' },
  { code: 'owner_absent', nameAr: 'صاحب القرار أو التاجر غير متواجد', category: 'operational' },
  { code: 'price_dispute', nameAr: 'خلاف في الأسعار أو عروض المنافسين', category: 'commercial', requiresNotes: true },
  { code: 'credit_limit_exceeded', nameAr: 'تجاوز سقف الائتمان أو مديونية متأخرة', category: 'credit' },
  { code: 'expired_goods_pending', nameAr: 'بضاعة منتهية الصلاحية لم تُستبدل بعد', category: 'logistics', requiresNotes: true },
  { code: 'liquidity_shortage', nameAr: 'نقص سيولة نقدية لدى التاجر اليوم', category: 'commercial' },
  { code: 'other', nameAr: 'أسباب أخرى', category: 'operational', requiresNotes: true },
];

export class FmcgVisitExecutionEngine {
  /**
   * Calculates geodesic distance in meters between two lat/lng pairs using Haversine formula
   */
  static calculateDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    if (lat1 === lat2 && lon1 === lon2) return 0;
    const R = 6371000; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  /**
   * Evaluates if driver's check-in coordinates are within the customer's geofence radius
   */
  static evaluateGeofence(
    customerLat: number | null | undefined,
    customerLng: number | null | undefined,
    repLat: number | null | undefined,
    repLng: number | null | undefined,
    thresholdMeters = 300,
  ): GeofenceEvaluationResult {
    const cLat = customerLat != null ? Number(customerLat) : null;
    const cLng = customerLng != null ? Number(customerLng) : null;
    const rLat = repLat != null ? Number(repLat) : null;
    const rLng = repLng != null ? Number(repLng) : null;

    if (cLat == null || cLng == null || isNaN(cLat) || isNaN(cLng)) {
      return {
        isValid: true,
        distanceMeters: 0,
        thresholdMeters,
        isUnmappedCustomer: true,
      };
    }

    if (rLat == null || rLng == null || isNaN(rLat) || isNaN(rLng)) {
      return {
        isValid: false,
        distanceMeters: 999999,
        thresholdMeters,
        isUnmappedCustomer: false,
      };
    }

    const dist = this.calculateDistanceMeters(cLat, cLng, rLat, rLng);
    return {
      isValid: dist <= thresholdMeters,
      distanceMeters: dist,
      thresholdMeters,
      isUnmappedCustomer: false,
    };
  }

  /**
   * Calculates dwell time in seconds between check-in and check-out
   */
  static calculateDwellTimeSeconds(
    checkInAt: Date | string,
    checkOutAt: Date | string = new Date(),
  ): number {
    const start = new Date(checkInAt).getTime();
    const end = new Date(checkOutAt).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return 0;
    return Math.round((end - start) / 1000);
  }

  /**
   * Computes Strike-Rate (نجاح التغطية والإنتاجية) and visit KPI aggregates.
   * Money totals round at the tenant's book digits (default 2 for
   * pure-engine callers); the live caller (VanFieldExecutionService
   * .getVisitsHistory) passes the tenant's book digits.
   */
  static calculateStrikeRateMetrics(visits: Array<{
    has_sale?: boolean;
    has_collection?: boolean;
    sale_amount?: number | string;
    collection_amount?: number | string;
    dwell_time_seconds?: number;
    no_sale_reason?: string | null;
  }>, moneyDigits: MoneyDigits = 2) {
    const totalVisits = visits.length;
    let productiveVisits = 0;
    let totalSales = 0;
    let totalCollections = 0;
    let totalDwellSeconds = 0;
    const noSaleReasonsCount: Record<string, number> = {};

    for (const v of visits) {
      const hasSale = Boolean(v.has_sale) || Number(v.sale_amount || 0) > 0;
      if (hasSale) {
        productiveVisits++;
      } else if (v.no_sale_reason) {
        noSaleReasonsCount[v.no_sale_reason] = (noSaleReasonsCount[v.no_sale_reason] || 0) + 1;
      }
      totalSales += Number(v.sale_amount || 0);
      totalCollections += Number(v.collection_amount || 0);
      totalDwellSeconds += Number(v.dwell_time_seconds || 0);
    }

    const strikeRatePercentage = totalVisits > 0 ? Number(((productiveVisits / totalVisits) * 100).toFixed(1)) : 0;
    const avgDwellTimeMinutes = totalVisits > 0 ? Number(((totalDwellSeconds / totalVisits) / 60).toFixed(1)) : 0;

    return {
      totalVisits,
      productiveVisits,
      nonProductiveVisits: totalVisits - productiveVisits,
      strikeRatePercentage,
      totalSalesAmount: roundMoney(totalSales, moneyDigits),
      totalCollectionsAmount: roundMoney(totalCollections, moneyDigits),
      avgDwellTimeMinutes,
      noSaleReasonsCount,
    };
  }
}
