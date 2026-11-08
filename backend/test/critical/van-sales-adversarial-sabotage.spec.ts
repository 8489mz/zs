import { strict as assert } from 'node:assert';
import {
  reconcileTripFinancials,
  reconcileVanStockAudit,
  evaluateCreditLimitCheck,
  evaluateOdometerReadings,
  evaluateMakerCheckerSettlement,
  evaluateNightStockRetention,
  evaluateFieldCardPayment,
  evaluateTripExpenseGovernance,
} from '../../src/modules/delivery-reps/van-trip-reconciliation.engine';
import {
  calculateHaversineDistanceMeters,
  evaluateGeofenceCompliance,
  extractCoordinatesFromCustomerLocation,
  isValidCoordinatePair,
  calculateRepTargetMetrics,
  calculateRepCommissionMetrics,
} from '../../src/modules/delivery-reps/rep-target.engine';

console.log('>>> [START] VAN SALES ADVERSARIAL SABOTAGE & ROGUE REP TEST SUITE');

// =========================================================================
// ATTACK VECTOR 1: Sidewalk Phantom Invoicing (فواتير الرصيف والبيع خارج دكان العميل)
// =========================================================================
console.log('--- Test Suite 1: Sidewalk Phantom Invoicing (Geofencing Gate) ---');

// Grocer Location: Tahrir Square, Cairo (30.0444, 31.2357)
const grocerLat = 30.0444;
const grocerLng = 31.2357;

// Scenario 1.1: Rogue rep sitting at a cafe 880m away trying to bill credit sale
const cafeRepLat = 30.0520;
const cafeRepLng = 31.2400;
const distCafe = calculateHaversineDistanceMeters(cafeRepLat, cafeRepLng, grocerLat, grocerLng);
assert.ok(distCafe > 200, `Expected distance > 200m, got: ${distCafe}m`);

const cafeGeofence = evaluateGeofenceCompliance({
  repLat: cafeRepLat,
  repLng: cafeRepLng,
  customerLat: grocerLat,
  customerLng: grocerLng,
  maxAllowedMeters: 200,
});
assert.equal(cafeGeofence.status, 'outside_geofence');
assert.equal(cafeGeofence.isCompliant, false);
assert.ok((cafeGeofence.distanceMeters ?? 0) > 200);

// Scenario 1.2: Honest rep at the doorstep (35 meters away)
const doorstepRepLat = 30.0446;
const doorstepRepLng = 31.2359;
const distDoorstep = calculateHaversineDistanceMeters(doorstepRepLat, doorstepRepLng, grocerLat, grocerLng);
assert.ok(distDoorstep <= 50, `Expected distance <= 50m, got: ${distDoorstep}m`);

const doorstepGeofence = evaluateGeofenceCompliance({
  repLat: doorstepRepLat,
  repLng: doorstepRepLng,
  customerLat: grocerLat,
  customerLng: grocerLng,
  maxAllowedMeters: 200,
});
assert.equal(doorstepGeofence.status, 'within_geofence');
assert.equal(doorstepGeofence.isCompliant, true);

// Scenario 1.3: Rep phone GPS turned off / missing coordinates
const noGpsGeofence = evaluateGeofenceCompliance({
  repLat: null,
  repLng: null,
  customerLat: grocerLat,
  customerLng: grocerLng,
  maxAllowedMeters: 200,
});
assert.equal(noGpsGeofence.status, 'no_rep_gps');
assert.equal(noGpsGeofence.isCompliant, null);

// Scenario 1.4: Legacy customer without GPS coordinates on file
const noCustomerGpsGeofence = evaluateGeofenceCompliance({
  repLat: doorstepRepLat,
  repLng: doorstepRepLng,
  customerLat: null,
  customerLng: null,
  maxAllowedMeters: 200,
});
assert.equal(noCustomerGpsGeofence.status, 'no_customer_gps');
assert.equal(noCustomerGpsGeofence.isCompliant, null);

// =========================================================================
// ATTACK VECTOR 2: Coordinate Forgery & Malformed Google Maps Links
// =========================================================================
console.log('--- Test Suite 2: Coordinate Parsing & Spoofing Resistance ---');

// Pattern A: Standard @lat,lng in Google Maps URL
const coordsA = extractCoordinatesFromCustomerLocation({
  locationUrl: 'https://www.google.com/maps/place/El-Nour+Market/@30.0444,31.2357,17z/data=!3m1!4b1',
});
assert.deepEqual(coordsA, { lat: 30.0444, lng: 31.2357 });

// Pattern B: Query parameter ?q=lat,lng
const coordsB = extractCoordinatesFromCustomerLocation({
  locationUrl: 'https://maps.google.com/?q=30.0444,31.2357',
});
assert.deepEqual(coordsB, { lat: 30.0444, lng: 31.2357 });

// Pattern C: Bang parameter !3dLAT!4dLNG
const coordsC = extractCoordinatesFromCustomerLocation({
  locationUrl: 'https://www.google.com/maps/dir/30.01,31.02/data=!4m2!4m1!3e0!3d30.0444!4d31.2357',
});
assert.deepEqual(coordsC, { lat: 30.0444, lng: 31.2357 });

// Pattern D: Metadata JSON object
const coordsD = extractCoordinatesFromCustomerLocation({
  metadata: { gps_lat: 30.0444, gps_lng: 31.2357 },
});
assert.deepEqual(coordsD, { lat: 30.0444, lng: 31.2357 });

// Pattern E: Spoofed / Invalid coordinates (0,0) or out of bounds (-195, 300)
assert.equal(isValidCoordinatePair(0, 0), false);
assert.equal(isValidCoordinatePair(95, 31.2), false);
assert.equal(isValidCoordinatePair(30.0444, 250), false);
assert.equal(isValidCoordinatePair(NaN, 31.2), false);
assert.equal(isValidCoordinatePair(30.0444, 31.2357), true);

// =========================================================================
// ATTACK VECTOR 3: Cash Embezzlement & Handover Shortage Evasion
// =========================================================================
console.log('--- Test Suite 3: Cash Handover Reconciliation & Shortage Trapping ---');

// Context: Trip loaded with 20,000 EGP.
// Sales: 12,000 EGP (8,000 Cash, 4,000 Credit).
// Collections: 3,500 EGP.
// Cash Refunds: 200 EGP.
// Approved Fuel Expense: 150 EGP.
// Expected Cash to Handover = 8,000 + 3,500 - 200 - 150 = 11,150 EGP.

// Case 3.1: Rogue rep pockets 1,150 EGP and remits only 10,000 EGP
const repTheftReconciliation = reconcileTripFinancials({
  moneyDigits: 2,
  loadedAmount: 20000,
  salesAmount: 12000,
  cashSales: 8000,
  creditSales: 4000,
  fieldCollections: 3500,
  returnsAmount: 500,
  cashRefunds: 200,
  tripExpenses: 150,
  countedCash: 10000, // Shortage of 1,150 EGP
  remainingVanStockValue: 8500,
});

assert.equal(repTheftReconciliation.expectedCash, 11150);
assert.equal(repTheftReconciliation.countedCash, 10000);
assert.equal(repTheftReconciliation.cashVariance, -1150);
assert.equal(repTheftReconciliation.cashVarianceStatus, 'shortage');
assert.equal(repTheftReconciliation.cashShortageAmount, 1150);
assert.equal(repTheftReconciliation.cashOverageAmount, 0);

// Case 3.2: Honest rep remits exact 11,150 EGP -> 100% matched clearance
const honestReconciliation = reconcileTripFinancials({
  moneyDigits: 2,
  loadedAmount: 20000,
  salesAmount: 12000,
  cashSales: 8000,
  creditSales: 4000,
  fieldCollections: 3500,
  returnsAmount: 500,
  cashRefunds: 200,
  tripExpenses: 150,
  countedCash: 11150,
  remainingVanStockValue: 8500,
});

assert.equal(honestReconciliation.cashVariance, 0);
assert.equal(honestReconciliation.cashVarianceStatus, 'balanced');
assert.equal(honestReconciliation.cashShortageAmount, 0);

// Case 3.3: Extra cash overage handed over (11,400 EGP)
const overageReconciliation = reconcileTripFinancials({
  moneyDigits: 2,
  loadedAmount: 20000,
  salesAmount: 12000,
  cashSales: 8000,
  creditSales: 4000,
  fieldCollections: 3500,
  returnsAmount: 500,
  cashRefunds: 200,
  tripExpenses: 150,
  countedCash: 11400,
  remainingVanStockValue: 8500,
});

assert.equal(overageReconciliation.cashVariance, 250);
assert.equal(overageReconciliation.cashVarianceStatus, 'overage');
assert.equal(overageReconciliation.cashOverageAmount, 250);

// =========================================================================
// ATTACK VECTOR 4: Van Physical Stock Shortage & Black-Market Selling
// =========================================================================
console.log('--- Test Suite 4: Interactive Van Physical Stock Audit ---');

// System expects 3 items remaining in van:
// Item 1: 100 pcs @ 15 EGP cost, retail 20 EGP
// Item 2: 50 pcs @ 40 EGP cost, retail 50 EGP
// Item 3: 20 pcs @ 80 EGP cost, retail 100 EGP
const stockAudit = reconcileVanStockAudit([
  {
    productId: 1,
    productName: 'جبنة بيضاء 500جم',
    systemQty: 100,
    countedQty: 75, // Shortage 25 pcs
    costPrice: 15,
    retailPrice: 20,
  },
  {
    productId: 2,
    productName: 'زيت خليط 800مل',
    systemQty: 50,
    countedQty: 40, // Shortage 10 pcs
    costPrice: 40,
    retailPrice: 50,
  },
  {
    productId: 3,
    productName: 'سمن نباتي 1كجم',
    systemQty: 20,
    countedQty: 20, // Balanced
    costPrice: 80,
    retailPrice: 100,
  },
], 2);

assert.equal(stockAudit.hasStockDiscrepancy, true);
assert.equal(stockAudit.totalStockShortageCost, 775); // (25*15) + (10*40) = 375 + 400
assert.equal(stockAudit.totalStockOverageCost, 0);
assert.equal(stockAudit.netStockVarianceCost, -775);

const item1Audit = stockAudit.itemVariances.find((iv) => iv.productId === 1)!;
assert.equal(item1Audit.status, 'shortage');
assert.equal(item1Audit.varianceQty, -25);
assert.equal(item1Audit.shortageCost, 375);

const item2Audit = stockAudit.itemVariances.find((iv) => iv.productId === 2)!;
assert.equal(item2Audit.status, 'shortage');
assert.equal(item2Audit.varianceQty, -10);
assert.equal(item2Audit.shortageCost, 400);

const item3Audit = stockAudit.itemVariances.find((iv) => iv.productId === 3)!;
assert.equal(item3Audit.status, 'balanced');
assert.equal(item3Audit.varianceQty, 0);
assert.equal(item3Audit.shortageCost, 0);

// =========================================================================
// ATTACK VECTOR 5: Rogue Credit Overdraft & Blocked Customer Bypass
// =========================================================================
console.log('--- Test Suite 5: Customer Credit Limit & Block Governance ---');

// Case 5.1: Customer is credit blocked (bad debtor)
const blockedCheck = evaluateCreditLimitCheck({
  moneyDigits: 2,
  customerId: 5,
  customerName: 'Bad Debtor',
  currentBalance: 1500,
  creditLimit: 5000,
  requestedCreditAmount: 800,
  isCreditBlocked: true,
});
assert.equal(blockedCheck.allowed, false);
assert.equal(blockedCheck.reasonCode, 'CUSTOMER_BLOCKED');

// Case 5.2: Cash-only customer (creditLimit = 0 with customerType = 'cash')
const cashOnlyCheck = evaluateCreditLimitCheck({
  moneyDigits: 2,
  customerId: 6,
  customerName: 'Cash Only Mart',
  currentBalance: 0,
  creditLimit: 0,
  requestedCreditAmount: 500,
  isCreditBlocked: false,
  customerType: 'cash',
});
assert.equal(cashOnlyCheck.allowed, false);
assert.equal(cashOnlyCheck.reasonCode, 'CASH_ONLY_CUSTOMER');

// Case 5.3: Credit limit breached without PIN
const limitExceededCheck = evaluateCreditLimitCheck({
  moneyDigits: 2,
  customerId: 7,
  customerName: 'Over Limit Shop',
  currentBalance: 4500,
  creditLimit: 5000,
  requestedCreditAmount: 1200, // projected: 5700 > 5000
  isCreditBlocked: false,
});
assert.equal(limitExceededCheck.allowed, false);
assert.equal(limitExceededCheck.reasonCode, 'LIMIT_EXCEEDED');
assert.equal(limitExceededCheck.projectedBalance, 5700);
assert.equal(limitExceededCheck.exceededAmount, 700);

// Case 5.4: Credit limit breached with verified supervisor override PIN
const supervisorApprovedCheck = evaluateCreditLimitCheck({
  moneyDigits: 2,
  customerId: 7,
  customerName: 'Over Limit Shop',
  currentBalance: 4500,
  creditLimit: 5000,
  requestedCreditAmount: 1200,
  isCreditBlocked: false,
  supervisorOverride: {
    approved: true,
    supervisorId: 3,
    supervisorName: 'مدير المبيعات',
    reason: 'اعتماد شحنة إضافية بضمان تحصيل الغد',
  },
});
assert.equal(supervisorApprovedCheck.allowed, true);
assert.equal(supervisorApprovedCheck.isOverridden, true);
assert.equal(supervisorApprovedCheck.reasonCode, 'SUPERVISOR_OVERRIDE');

// =========================================================================
// ATTACK VECTOR 6: Fake Bank Slip & Unverified Card Payment
// =========================================================================
console.log('--- Test Suite 6: Field POS/Card Payment Slips ---');

// Case 6.1: Rep claims 3,000 EGP card payment without supervisor PIN
const cardNoPin = evaluateFieldCardPayment({
  totalSaleAmount: 3000,
  referenceReason: 'POS-REC-984210',
});
assert.equal(cardNoPin.allowed, false);
assert.equal(cardNoPin.reasonCode, 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN');

// Case 6.2: Rep has supervisor PIN verified but entered invalid/empty slip reference (< 3 chars)
const cardNoRef = evaluateFieldCardPayment({
  totalSaleAmount: 3000,
  referenceReason: 'x',
  supervisorOverride: {
    approved: true,
    supervisorId: 2,
    supervisorName: 'مشرف المبيعات',
  },
});
assert.equal(cardNoRef.allowed, false);
assert.equal(cardNoRef.reasonCode, 'CARD_PAYMENT_REFERENCE_REQUIRED');

// Case 6.3: Valid bank authorization with supervisor PIN and valid slip verified
const validCardCheck = evaluateFieldCardPayment({
  totalSaleAmount: 3000,
  referenceReason: 'POS-REC-984210',
  supervisorOverride: {
    approved: true,
    supervisorId: 2,
    supervisorName: 'مشرف الحركة',
    reason: 'إشعار تحويل فوري معتمد',
  },
});
assert.equal(validCardCheck.allowed, true);
assert.equal(validCardCheck.reasonCode, 'SUPERVISOR_APPROVED');
assert.equal(validCardCheck.approvedReference, 'POS-REC-984210');

// =========================================================================
// ATTACK VECTOR 7: Fictitious Expense Inflation
// =========================================================================
console.log('--- Test Suite 7: Trip Expense Ceilings & Petty Theft ---');

// Case 7.1: Fuel expense exceeding single limit of 250 EGP without PIN
const overSingleFuel = evaluateTripExpenseGovernance({
  moneyDigits: 2,
  expenseType: 'fuel',
  amount: 320,
  notes: 'تموين سولار كامل',
  existingTripExpenses: 0,
});
assert.equal(overSingleFuel.allowed, false);
assert.equal(overSingleFuel.requiresSupervisorPin, true);
assert.equal(overSingleFuel.reasonCode, 'EXPENSE_REQUIRES_SUPERVISOR_PIN');

// Case 7.2: Cumulative expenses exceeding 400 EGP ceiling without PIN
const overCumulativeToll = evaluateTripExpenseGovernance({
  moneyDigits: 2,
  expenseType: 'toll',
  amount: 150,
  notes: 'بوابات الإسكندرية',
  existingTripExpenses: 300, // projected: 450 > 400
});
assert.equal(overCumulativeToll.allowed, false);
assert.equal(overCumulativeToll.requiresSupervisorPin, true);

// Case 7.3: Routine fuel within ceiling (120 EGP) with proper notes
const routineFuel = evaluateTripExpenseGovernance({
  moneyDigits: 2,
  expenseType: 'fuel',
  amount: 120,
  notes: 'بنزين 92 محطة شل إيصال 4402',
  existingTripExpenses: 50,
});
assert.equal(routineFuel.allowed, true);
assert.equal(routineFuel.requiresSupervisorPin, false);
assert.equal(routineFuel.reasonCode, 'ROUTINE_PETTY_ALLOWED');

// =========================================================================
// ATTACK VECTOR 8: Odometer Tampering & Mileage Inflation
// =========================================================================
console.log('--- Test Suite 8: Odometer Fraud Resistance ---');

// Case 8.1: Rep rolls back odometer (End < Start)
const reversedOdo = evaluateOdometerReadings({
  startOdometer: 150400,
  endOdometer: 150200,
});
assert.equal(reversedOdo.valid, false);
assert.ok(reversedOdo.errorMessageAr?.includes('أقل من قراءة بداية'));

// Case 8.2: Normal daily route distance (75 km)
const normalOdo = evaluateOdometerReadings({
  startOdometer: 150000,
  endOdometer: 150075,
});
assert.equal(normalOdo.valid, true);
assert.equal(normalOdo.distanceKm, 75);

// =========================================================================
// ATTACK VECTOR 9: Maker-Checker Bypass (Self-Settlement Attempt)
// =========================================================================
console.log('--- Test Suite 9: Maker-Checker Separation of Duties ---');

// Rep (ID 7) attempts to settle his own trip using his own user ID
const selfSettlementAttempt = evaluateMakerCheckerSettlement({
  repUserId: 7,
  actorUserId: 7,
  actorRole: 'admin',
  isSupervisorOrAdmin: true,
});
assert.equal(selfSettlementAttempt.allowed, false);
assert.equal(selfSettlementAttempt.reasonCode, 'MAKER_CHECKER_SELF_APPROVAL');

// Legitimate clearance by supervisor (User ID 2)
const legitimateSettlement = evaluateMakerCheckerSettlement({
  repUserId: 7,
  actorUserId: 2,
  actorRole: 'admin',
  isSupervisorOrAdmin: true,
});
assert.equal(legitimateSettlement.allowed, true);

// =========================================================================
// ATTACK VECTOR 10: Unauthorized Night Stock Retention
// =========================================================================
console.log('--- Test Suite 10: Night Stock Governance ---');

// Rep has unsold stock and attempts to keep it overnight without supervisor approval
const unauthorizedNightStock = evaluateNightStockRetention({
  unloadRemainingToWarehouse: false,
  remainingItemsCount: 10,
  nightStockApproved: false,
});
assert.equal(unauthorizedNightStock.allowed, false);
assert.equal(unauthorizedNightStock.status, 'rejected_missing_approval');

// Supervisor grants signed night stock retention exception
const approvedNightStock = evaluateNightStockRetention({
  unloadRemainingToWarehouse: false,
  remainingItemsCount: 10,
  nightStockApproved: true,
  nightStockNotes: 'معتمد للمندوب لبدء مسار الفجر مبكراً',
});
assert.equal(approvedNightStock.allowed, true);

// =========================================================================
// ATTACK VECTOR 11: Multi-Dimensional Rep Target Pacing & Commission Integrity
// =========================================================================
console.log('--- Test Suite 11: Rep Targets & Pacing Under Manipulation ---');

// Target: 100,000 EGP sales, 80,000 EGP collections, 120 visits.
// MTD Actual: 40,000 sales, 30,000 collections, 50 visits on Day 15 of 30 days.
const targetMetrics = calculateRepTargetMetrics({
  targetAmount: 100000,
  actualSalesMTD: 40000,
  collectionTarget: 80000,
  actualCollectionsMTD: 30000,
  visitsTarget: 120,
  actualVisitsMTD: 50,
  currentDate: new Date('2026-10-15T12:00:00Z'),
  officialHolidays: [],
  moneyDigits: 2,
});

assert.equal(targetMetrics.achievementRate, 40.0);
assert.equal(targetMetrics.remainingTarget, 60000);
assert.ok(targetMetrics.requiredDailyTarget > 0);
assert.equal(targetMetrics.collectionAchievementRate, 37.5);
assert.equal(targetMetrics.visitsAchievementRate, 41.7);

// Commission calculation with achievement bonus
const commMetrics = calculateRepCommissionMetrics({
  actualSales: 120000, // Exceeded 100,000 target -> Eligible for target bonus!
  salesTarget: 100000,
  actualCollections: 75000,
  salesCommissionRatePercent: 1.5,
  collectionCommissionRatePercent: 0.5,
  targetBonusRatePercent: 1.0,
  alreadyPaidAmount: 500,
  moneyDigits: 2,
});

assert.equal(commMetrics.salesCommissionAmount, 1800); // 120,000 * 1.5%
assert.equal(commMetrics.collectionCommissionAmount, 375); // 75,000 * 0.5%
assert.equal(commMetrics.isTargetBonusEligible, true);
assert.equal(commMetrics.targetBonusAmount, 1200); // 120,000 * 1.0%
assert.equal(commMetrics.totalEarnedCommission, 3375); // 1800 + 375 + 1200
assert.equal(commMetrics.remainingPayableCommission, 2875); // 3375 - 500

console.log('>>> [SUCCESS] ALL 11 ADVERSARIAL ATTACK VECTORS THWARTED AND VERIFIED 100%!');
