import { strict as assert } from 'node:assert';
import {
  calculateRepTargetMetrics,
  calculateRepCommissionMetrics,
  extractCoordinatesFromCustomerLocation,
  calculateHaversineDistanceMeters,
  evaluateGeofenceCompliance,
  evaluateBatchExpiryStatus,
  extractAssignedRepIds,
  aggregateCustomerBalancesByRep,
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
} from '../../src/modules/delivery-reps/rep-target.engine';

// 1. Correctly calculates remaining working days excluding Fridays and official holidays
const result1 = calculateRepTargetMetrics({
  targetAmount: 100000,
  actualSalesMTD: 50000,
  currentDate: '2026-09-24',
  weekendDays: [5], // Friday
  officialHolidays: ['2026-09-28'],
  moneyDigits: 2,
});

assert.equal(result1.periodMonth, '2026-09');
assert.equal(result1.targetAmount, 100000);
assert.equal(result1.actualSalesMTD, 50000);
assert.equal(result1.achievementRate, 50);
assert.equal(result1.remainingTarget, 50000);
assert.equal(result1.isTargetAchieved, false);
assert.equal(result1.totalDaysInMonth, 30);
assert.equal(result1.remainingDaysTotal, 7);
assert.equal(result1.excludedFridaysCount, 1);
assert.equal(result1.excludedHolidaysCount, 1);
assert.equal(result1.remainingWorkingDays, 5);
// Required daily target: 50,000 / 5 = 10,000
assert.equal(result1.requiredDailyTarget, 10000);

// 2. Handles target fully achieved or exceeded
const result2 = calculateRepTargetMetrics({
  targetAmount: 80000,
  actualSalesMTD: 95000,
  currentDate: '2026-09-26',
  weekendDays: [5],
  moneyDigits: 2,
});

assert.equal(result2.achievementRate, 118.8);
assert.equal(result2.remainingTarget, 0);
assert.equal(result2.isTargetAchieved, true);
assert.equal(result2.requiredDailyTarget, 0);

// 3. Handles zero target gracefully
const result3 = calculateRepTargetMetrics({
  targetAmount: 0,
  actualSalesMTD: 5000,
  currentDate: '2026-09-26',
  moneyDigits: 2,
});

assert.equal(result3.achievementRate, 0);
assert.equal(result3.remainingTarget, 0);
assert.equal(result3.isTargetAchieved, false);
assert.equal(result3.requiredDailyTarget, 0);

// 4. Handles month end day
const result4 = calculateRepTargetMetrics({
  targetAmount: 50000,
  actualSalesMTD: 40000,
  currentDate: '2026-09-30',
  weekendDays: [5],
  moneyDigits: 2,
});

assert.equal(result4.remainingDaysTotal, 1);
assert.equal(result4.remainingWorkingDays, 1);
assert.equal(result4.remainingTarget, 10000);
assert.equal(result4.requiredDailyTarget, 10000);

// 5. Commission calculation when sales target >= 100% (includes achievement tier bonus)
const comm1 = calculateRepCommissionMetrics({
  actualSales: 120000,
  actualCollections: 95000,
  salesTarget: 100000,
  salesCommissionRatePercent: 1.5,
  collectionCommissionRatePercent: 1.0,
  targetBonusRatePercent: 0.5,
  alreadyPaidAmount: 1000,
  moneyDigits: 2,
});

assert.equal(comm1.salesCommissionAmount, 1800); // 120,000 * 1.5%
assert.equal(comm1.collectionCommissionAmount, 950); // 95,000 * 1.0%
assert.equal(comm1.isTargetBonusEligible, true);
assert.equal(comm1.targetBonusAmount, 600); // 120,000 * 0.5%
assert.equal(comm1.totalEarnedCommission, 3350); // 1800 + 950 + 600
assert.equal(comm1.alreadyPaidAmount, 1000);
assert.equal(comm1.remainingPayableCommission, 2350);

// 6. Commission calculation withholds target bonus when sales are below target
const comm2 = calculateRepCommissionMetrics({
  actualSales: 80000,
  actualCollections: 50000,
  salesTarget: 100000,
  salesCommissionRatePercent: 1.0,
  collectionCommissionRatePercent: 0.5,
  targetBonusRatePercent: 0.5,
  alreadyPaidAmount: 0,
  moneyDigits: 2,
});

assert.equal(comm2.salesCommissionAmount, 800);
assert.equal(comm2.collectionCommissionAmount, 250);
assert.equal(comm2.isTargetBonusEligible, false);
assert.equal(comm2.targetBonusAmount, 0);
assert.equal(comm2.totalEarnedCommission, 1050);
assert.equal(comm2.remainingPayableCommission, 1050);

// 7. Geofence & coordinate extraction from Google Maps URLs
const coordsAt = extractCoordinatesFromCustomerLocation({
  locationUrl: 'https://www.google.com/maps/place/Cairo/@30.0444196,31.2357116,17z',
});
assert.deepEqual(coordsAt, { lat: 30.0444196, lng: 31.2357116 });

const coordsQuery = extractCoordinatesFromCustomerLocation({
  metadata: { location_url: 'https://maps.google.com/?q=30.0561,31.2394' },
});
assert.deepEqual(coordsQuery, { lat: 30.0561, lng: 31.2394 });

const dist = calculateHaversineDistanceMeters(30.0444, 31.2357, 30.045, 31.236);
assert.ok(dist > 50 && dist < 100, `Expected distance between 50m and 100m, got ${dist}`);

const geoCompliant = evaluateGeofenceCompliance({
  repLat: 30.0444,
  repLng: 31.2357,
  customerLat: 30.045,
  customerLng: 31.236,
  maxAllowedMeters: 300,
});
assert.equal(geoCompliant.status, 'within_geofence');
assert.equal(geoCompliant.isCompliant, true);

const geoViolation = evaluateGeofenceCompliance({
  repLat: 30.0444,
  repLng: 31.2357,
  customerLat: 30.09,
  customerLng: 31.3,
  maxAllowedMeters: 300,
});
assert.equal(geoViolation.status, 'outside_geofence');
assert.equal(geoViolation.isCompliant, false);
assert.ok((geoViolation.distanceMeters ?? 0) > 5000);

// 8. FEFO Batch Expiry Evaluation
const refDate = new Date('2026-10-13T00:00:00Z');
const expiredBatch = evaluateBatchExpiryStatus('2026-10-01', refDate, 60);
assert.equal(expiredBatch.status, 'expired');
assert.equal(expiredBatch.daysRemaining, -12);

const nearExpiryBatch = evaluateBatchExpiryStatus('2026-11-12', refDate, 60);
assert.equal(nearExpiryBatch.status, 'near_expiry');
assert.equal(nearExpiryBatch.daysRemaining, 30);

const validBatch = evaluateBatchExpiryStatus('2027-06-01', refDate, 60);
assert.equal(validBatch.status, 'valid');
assert.ok((validBatch.daysRemaining ?? 0) > 200);

// 9. Multi-Rep Customer Account Isolation & Supervisor Breakdown ("محل البركة" 0002 Scenario)
// Rep 1 (ID 101) is owed 500 EGP; Rep 2 (ID 102) is owed 2,000 EGP; Total Customer Debt = 2,500 EGP
const assignedIds = extractAssignedRepIds({
  assigned_rep_id: 101,
  assigned_rep_ids: [101, '102', 101],
});
assert.deepEqual(assignedIds, [101, 102]);

const barakaLedgerMap = aggregateCustomerBalancesByRep(
  [
    // Rep 1 sold 800 on credit (+800 debit) and collected 300 (-300 credit) => 500 EGP owed
    { customerId: 2, repId: 101, repName: 'مندوب 1', amount: 800 },
    { customerId: 2, repId: 101, repName: 'مندوب 1', amount: -300 },
    // Rep 2 sold 2,500 on credit (+2500 debit) and collected 500 (-500 credit) => 2,000 EGP owed
    { customerId: 2, repId: 102, repName: 'مندوب 2', amount: 2500 },
    { customerId: 2, repId: 102, repName: 'مندوب 2', amount: -500 },
  ],
  { 2: 2500 },
  2,
);

const barakaBreakdown = barakaLedgerMap.get(2)!;
assert.ok(barakaBreakdown);
assert.equal(barakaBreakdown.totalCustomerBalance, 2500);
assert.equal(barakaBreakdown.totalRepBalance, 2500);
assert.equal(barakaBreakdown.unassignedBalance, 0);
assert.equal(barakaBreakdown.repBalances.length, 2);
// Sorted descending by balance: Rep 2 (2000) then Rep 1 (500)
assert.equal(barakaBreakdown.repBalances[0].repId, 102);
assert.equal(barakaBreakdown.repBalances[0].repName, 'مندوب 2');
assert.equal(barakaBreakdown.repBalances[0].balance, 2000);
assert.equal(barakaBreakdown.repBalances[1].repId, 101);
assert.equal(barakaBreakdown.repBalances[1].repName, 'مندوب 1');
assert.equal(barakaBreakdown.repBalances[1].balance, 500);

// Rep 1 isolated view of "محل البركة" (0002)
const rep1View = resolveIsolatedRepCustomerBalance({
  repId: 101,
  breakdown: barakaBreakdown,
  assignedRepIds: [101, 102],
  fallbackTotalBalance: 2500,
  moneyDigits: 2,
});
assert.equal(rep1View.repBalance, 500);
assert.equal(rep1View.otherRepsBalance, 2000);
assert.equal(rep1View.totalCustomerBalance, 2500);

// Rep 2 isolated view of "محل البركة" (0002)
const rep2View = resolveIsolatedRepCustomerBalance({
  repId: 102,
  breakdown: barakaBreakdown,
  assignedRepIds: [101, 102],
  fallbackTotalBalance: 2500,
  moneyDigits: 2,
});
assert.equal(rep2View.repBalance, 2000);
assert.equal(rep2View.otherRepsBalance, 500);
assert.equal(rep2View.totalCustomerBalance, 2500);

// Uninvolved Rep 3 (ID 103) view of "محل البركة"
const rep3View = resolveIsolatedRepCustomerBalance({
  repId: 103,
  breakdown: barakaBreakdown,
  assignedRepIds: [101, 102],
  fallbackTotalBalance: 2500,
  moneyDigits: 2,
});
assert.equal(rep3View.repBalance, 0);
assert.equal(rep3View.otherRepsBalance, 2500);

// Collection Isolation Validation:
// Case A: Rep 1 collects 300 EGP out of his 500 EGP -> Allowed, new Rep 1 balance = 200 EGP, company balance = 2200 EGP
const colValid = validateIsolatedRepCollection({
  repId: 101,
  collectionAmount: 300,
  repBalance: rep1View.repBalance,
  otherRepsBalance: rep1View.otherRepsBalance,
  totalCustomerBalance: rep1View.totalCustomerBalance,
  moneyDigits: 2,
});
assert.equal(colValid.allowed, true);
assert.equal(colValid.repPreviousBalance, 500);
assert.equal(colValid.repNewBalance, 200);
assert.equal(colValid.companyPreviousBalance, 2500);
assert.equal(colValid.companyNewBalance, 2200);

// Case B: Rep 1 tries to collect 700 EGP (which would encroach on Rep 2's 2,000 EGP!) -> Blocked!
const colCrossRepBlocked = validateIsolatedRepCollection({
  repId: 101,
  collectionAmount: 700,
  repBalance: rep1View.repBalance,
  otherRepsBalance: rep1View.otherRepsBalance,
  totalCustomerBalance: rep1View.totalCustomerBalance,
  moneyDigits: 2,
});
assert.equal(colCrossRepBlocked.allowed, false);
assert.equal(colCrossRepBlocked.errorCode, 'REP_ISOLATED_BALANCE_EXCEEDED');
assert.equal(colCrossRepBlocked.repPreviousBalance, 500);
assert.equal(colCrossRepBlocked.repNewBalance, 500);

// Case C: Legacy single-rep customer with opening balance (no ledger rows yet)
const legacySingleRepView = resolveIsolatedRepCustomerBalance({
  repId: 101,
  breakdown: null,
  assignedRepIds: [101],
  fallbackTotalBalance: 1200,
  moneyDigits: 2,
});
assert.equal(legacySingleRepView.repBalance, 1200);
assert.equal(legacySingleRepView.otherRepsBalance, 0);

console.log(
  '[OK] RepTargetEngine tests (targets, commissions, geofence, FEFO, Rep-to-Rep Isolation) passed successfully!',
);
