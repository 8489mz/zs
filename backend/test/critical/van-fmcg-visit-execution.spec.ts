import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FmcgVisitExecutionEngine,
  FMCG_STANDARD_NO_SALE_REASONS,
} from '../../src/modules/delivery-reps/fmcg-visit-execution.engine';

describe('FMCG Visit Execution & Merchandising Engine Specification', () => {
  it('should accurately calculate geodesic distance between two GPS coordinates', () => {
    // Tahrir Square (30.0444, 31.2357) to Cairo Tower (30.0459, 31.2243)
    const distanceMeters = FmcgVisitExecutionEngine.calculateDistanceMeters(30.0444, 31.2357, 30.0459, 31.2243);

    // Distance should be approximately 1100m - 1150m
    assert.ok(distanceMeters >= 1050 && distanceMeters <= 1160, `Distance ${distanceMeters} should be ~1100m`);

    // Zero distance for identical points
    assert.equal(FmcgVisitExecutionEngine.calculateDistanceMeters(30.0, 31.0, 30.0, 31.0), 0);
  });

  it('should validate geofence within 300m and reject breach attempts beyond 300m', () => {
    const customerLat = 30.05;
    const customerLng = 31.24;

    // Driver 50 meters away (Valid)
    const validRepLat = 30.0504;
    const validRepLng = 31.24;
    const validResult = FmcgVisitExecutionEngine.evaluateGeofence(
      customerLat,
      customerLng,
      validRepLat,
      validRepLng,
      300,
    );
    assert.equal(validResult.isValid, true);
    assert.ok(validResult.distanceMeters < 300);

    // Driver 600 meters away (Breach)
    const breachRepLat = 30.0555;
    const breachRepLng = 31.24;
    const breachResult = FmcgVisitExecutionEngine.evaluateGeofence(
      customerLat,
      customerLng,
      breachRepLat,
      breachRepLng,
      300,
    );
    assert.equal(breachResult.isValid, false);
    assert.ok(breachResult.distanceMeters > 300);

    // Unmapped customer (null GPS) should pass gracefully with isUnmappedCustomer=true
    const unmappedResult = FmcgVisitExecutionEngine.evaluateGeofence(null, null, validRepLat, validRepLng, 300);
    assert.equal(unmappedResult.isValid, true);
    assert.equal(unmappedResult.isUnmappedCustomer, true);
  });

  it('should calculate dwell time in seconds and minutes between check-in and check-out', () => {
    const checkIn = new Date('2026-10-14T10:00:00Z');
    const checkOut = new Date('2026-10-14T10:14:30Z');

    const dwellSec = FmcgVisitExecutionEngine.calculateDwellTimeSeconds(checkIn, checkOut);
    assert.equal(dwellSec, 870); // 14 mins * 60 + 30 secs = 870
  });

  it('should compute Strike-Rate metrics and no-sale breakdown accurately', () => {
    const mockVisits = [
      { has_sale: true, sale_amount: 1500, collection_amount: 1500, dwell_time_seconds: 600 },
      { has_sale: true, sale_amount: 2200, collection_amount: 1000, dwell_time_seconds: 900 },
      { has_sale: false, sale_amount: 0, no_sale_reason: 'store_closed', dwell_time_seconds: 120 },
      { has_sale: false, sale_amount: 0, no_sale_reason: 'sufficient_stock', dwell_time_seconds: 300 },
      { has_sale: true, sale_amount: 850, collection_amount: 850, dwell_time_seconds: 480 },
    ];

    const metrics = FmcgVisitExecutionEngine.calculateStrikeRateMetrics(mockVisits);

    assert.equal(metrics.totalVisits, 5);
    assert.equal(metrics.productiveVisits, 3);
    assert.equal(metrics.nonProductiveVisits, 2);
    assert.equal(metrics.strikeRatePercentage, 60.0);
    assert.equal(metrics.totalSalesAmount, 4550);
    assert.equal(metrics.totalCollectionsAmount, 3350);
    assert.equal(metrics.noSaleReasonsCount['store_closed'], 1);
    assert.equal(metrics.noSaleReasonsCount['sufficient_stock'], 1);
  });

  it('should provide comprehensive standard FMCG no-sale reasons with Arabic translations', () => {
    assert.ok(FMCG_STANDARD_NO_SALE_REASONS.length >= 6);
    const closedReason = FMCG_STANDARD_NO_SALE_REASONS.find((r) => r.code === 'store_closed');
    assert.ok(closedReason);
    assert.equal(closedReason.nameAr, 'المحل مغلق');

    const stockReason = FMCG_STANDARD_NO_SALE_REASONS.find((r) => r.code === 'sufficient_stock');
    assert.ok(stockReason);
    assert.equal(stockReason.nameAr, 'لديه مخزون كافٍ من الأصناف');
  });
});
