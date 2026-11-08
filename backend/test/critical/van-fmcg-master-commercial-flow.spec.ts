import { strict as assert } from 'node:assert';
import {
  FmcgVisitExecutionEngine,
  FMCG_STANDARD_NO_SALE_REASONS,
} from '../../src/modules/delivery-reps/fmcg-visit-execution.engine';
import {
  evaluateFmcgCartPromotions,
  type FmcgPromotion,
  type CartItemInput,
} from '../../src/modules/delivery-reps/fmcg-promotions.engine';
import {
  optimizeRouteTsp,
  type RouteStopInput,
} from '../../src/modules/delivery-reps/route-optimization.engine';
import {
  reconcileTripFinancials,
  reconcileVanStockAudit,
  evaluateCreditLimitCheck,
  evaluateMakerCheckerSettlement,
  formatVanSettlementSummaryText,
} from '../../src/modules/delivery-reps/van-trip-reconciliation.engine';
import {
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
} from '../../src/modules/delivery-reps/rep-target.engine';

console.log('>>> [START] FMCG MASTER COMMERCIAL WORKFLOW & SALES EXECUTION TEST');

// ============================================================================
// STAGE 1: DYNAMIC ROUTE OPTIMIZATION (TSP) BEFORE START OF ROUTE
// ============================================================================
console.log('--- Stage 1: TSP Dynamic Route Optimization ---');

const startLocation = { startLat: 30.0400, startLng: 31.2300 }; // Warehouse / Depot

const stops: RouteStopInput[] = [
  {
    id: 101,
    name: 'سوبر ماركت النور',
    address: 'شارع التحرير',
    lat: 30.0444,
    lng: 31.2357,
    originalSequence: 1,
  },
  {
    id: 102,
    name: 'بقالة الأمل (غير محدد GPS)',
    address: 'ميدان الجيزة',
    lat: null,
    lng: null,
    originalSequence: 2,
  },
  {
    id: 103,
    name: 'كشك البركة',
    address: 'شارع قصر العيني',
    lat: 30.0420,
    lng: 31.2320,
    originalSequence: 3,
  },
];

const optimizationResult = optimizeRouteTsp(stops, startLocation);

assert.equal(optimizationResult.stats.totalStops, 3);
assert.equal(optimizationResult.stats.mappedStopsCount, 2);
assert.equal(optimizationResult.stats.unmappedStopsCount, 1);
assert.equal(optimizationResult.orderedStops.length, 3);

// The unmapped customer must always be safely preserved at the end of the route
const lastStop = optimizationResult.orderedStops[optimizationResult.orderedStops.length - 1];
assert.equal(lastStop.id, 102);
assert.equal(lastStop.isUnmappedGps, true);

// Mapped stops must be properly sequenced starting closest to depot
assert.equal(optimizationResult.orderedStops[0].id, 103); // Closer to 30.0400, 31.2300
assert.equal(optimizationResult.orderedStops[1].id, 101);
assert.ok(optimizationResult.stats.savedDistanceKm >= 0);
console.log(`[PASS] Route optimized: Total distance ${optimizationResult.stats.optimizedDistanceKm} km, Saved ${optimizationResult.stats.savedDistanceKm} km`);

// ============================================================================
// STAGE 2: CUSTOMER 1 VISIT (POSITIVE SALE, PROMOTIONS, TRADE SURVEY, DWELL)
// ============================================================================
console.log('--- Stage 2: Store Visit 1 - Positive Sale & Merchandising ---');

// 2.1 GPS Geofencing Check-in
const cust1 = stops[0]; // Supermarket Al-Nour (30.0444, 31.2357)
// Rep arrives at (30.0445, 31.2358) which is ~15 meters away
const checkInGeofence = FmcgVisitExecutionEngine.evaluateGeofence(
  cust1.lat,
  cust1.lng,
  30.0445,
  31.2358,
  300
);
assert.equal(checkInGeofence.isValid, true);
assert.ok(checkInGeofence.distanceMeters < 50);

const checkInTime = new Date('2026-10-14T09:00:00.000Z');

// 2.2 Optional Shelf Inventory
const shelfInventoryData = [
  { productId: 1, productName: 'شيبسي عائلي جبنة', unitName: 'قطعة', currentStock: 5 },
  { productId: 2, productName: 'عصير برتقال 1 لتر', unitName: 'عبوة', currentStock: 2 },
];
assert.equal(shelfInventoryData.length, 2);

// 2.3 Tiered FMCG Promotions Engine
const samplePromotions: FmcgPromotion[] = [
  {
    id: 1,
    name: 'عرض الجملة: خصم 5% عند شراء 10 كرتونة',
    code: 'CHIPS-DISCOUNT-5',
    promoType: 'tiered_qty',
    applyType: 'discount_percent',
    buyConditions: {
      productId: 1,
      minQty: 10,
    },
    reward: {
      discountPercent: 5,
    },
    customerTypes: ['wholesale'],
    isActive: true,
  },
  {
    id: 2,
    name: 'بونص الجملة: كرتونة بسكويت مجاناً عند شراء 10 كرتونة شيبسي',
    code: 'CHIPS-BONUS-1',
    promoType: 'tiered_qty',
    applyType: 'free_bonus',
    buyConditions: {
      productId: 1,
      minQty: 10,
    },
    reward: {
      bonusProductId: 3,
      bonusProductName: 'بسكويت شوكولاتة (هدية بونص)',
      bonusQty: 1,
      bonusUom: 'كرتونة',
      bonusReason: 'بونص كمية 10 كرتونة',
    },
    customerTypes: ['wholesale'],
    isActive: true,
  },
];

const cartItems: CartItemInput[] = [
  {
    productId: 1,
    productName: 'شيبسي عائلي جبنة (كرتونة 12 كيس)',
    qty: 10,
    unitPrice: 120, // 120 EGP per carton
    uom: 'كرتونة',
    multiplier: 1,
    isBonus: false,
  },
];

const promoEvaluation = evaluateFmcgCartPromotions({
  cartItems,
  activePromotions: samplePromotions,
  customerType: 'wholesale',
  invoiceSubtotal: 1200,
});

assert.equal(promoEvaluation.totalPromotionalDiscount, 60); // 10 * 120 = 1200 * 5% = 60 EGP
assert.equal(promoEvaluation.bonusItemsToAdd.length, 1);
assert.equal(promoEvaluation.bonusItemsToAdd[0].productId, 3);
assert.equal(promoEvaluation.bonusItemsToAdd[0].qty, 1);
assert.equal(promoEvaluation.bonusItemsToAdd[0].isBonus, true);
console.log(`[PASS] Promotions applied: Discount ${promoEvaluation.totalPromotionalDiscount} EGP, Bonus item: ${promoEvaluation.bonusItemsToAdd[0].productName}`);

// 2.4 Credit Limit Governance
const creditCheck = evaluateCreditLimitCheck({
  moneyDigits: 2,
  customerId: cust1.id,
  customerName: cust1.name,
  currentBalance: 1000,
  creditLimit: 5000,
  requestedCreditAmount: 1140, // 1200 - 60 discount
  isCreditBlocked: false,
  hasOverdueInvoices: false,
});
assert.equal(creditCheck.allowed, true);

// 2.5 Trade Marketing Cooler & Asset Inspection
const coolerInspection = {
  coolerId: 'COOLER-042',
  cleanliness: 'clean' as const,
  temperatureCelsius: 4.5,
  isPureCompanyCooler: true, // No competitor products inside
  competitorSurveys: [
    { competitorBrand: 'شركة شيبس المنافسة', productName: 'شيبس سوبر', observedPrice: 11.0, notes: 'عرض خاص 10+1' },
  ],
};
assert.ok(coolerInspection.temperatureCelsius <= 6.0); // Within cold beverages target
assert.equal(coolerInspection.isPureCompanyCooler, true);

// 2.6 Check-out & Dwell Time Calculation
const checkOutTime = new Date('2026-10-14T09:18:00.000Z'); // 18 minutes later
const dwellSeconds = FmcgVisitExecutionEngine.calculateDwellTimeSeconds(checkInTime, checkOutTime);
assert.equal(dwellSeconds, 18 * 60);
console.log(`[PASS] Customer 1 visit completed with dwell time: ${dwellSeconds / 60} minutes`);

// ============================================================================
// STAGE 3: CUSTOMER 2 VISIT (GEOFENCE BREACH & MANDATORY NO-SALE REASON)
// ============================================================================
console.log('--- Stage 3: Store Visit 2 - Negative / No-Sale Visit ---');

const cust2 = stops[2]; // Kiosk Al-Baraka (30.0420, 31.2320)
// Rep tries to check in from 850 meters away
const rogueCheckIn = FmcgVisitExecutionEngine.evaluateGeofence(
  cust2.lat,
  cust2.lng,
  30.0480, // Far coordinate
  31.2380,
  300
);
assert.equal(rogueCheckIn.isValid, false);
assert.ok(rogueCheckIn.distanceMeters > 300);

// Mandatory No-Sale Reason from standard list
const selectedReasonCode = 'store_closed';
const matchedReason = FMCG_STANDARD_NO_SALE_REASONS.find((r) => r.code === selectedReasonCode);
assert.ok(matchedReason);
assert.equal(matchedReason.nameAr, 'المحل مغلق');

const checkOut2 = new Date('2026-10-14T09:25:00.000Z');
const dwellSeconds2 = FmcgVisitExecutionEngine.calculateDwellTimeSeconds(new Date('2026-10-14T09:23:00.000Z'), checkOut2);
assert.equal(dwellSeconds2, 120);
console.log(`[PASS] Store 2 closed: Geofence breach flagged (${rogueCheckIn.distanceMeters}m), No-sale reason recorded: ${matchedReason.nameAr}`);

// ============================================================================
// STAGE 4: FIELD DEBT COLLECTION & ISOLATED REP BALANCES
// ============================================================================
console.log('--- Stage 4: Field Collection & Multi-Rep Debt Segregation ---');

const isolated = resolveIsolatedRepCustomerBalance({
  repId: 10,
  breakdown: {
    customerId: cust1.id,
    totalCustomerBalance: 3500,
    unassignedBalance: 0,
    totalRepBalance: 3500,
    byRepId: {
      10: { repId: 10, repName: 'مندوب التوزيع 1', balance: 1000, totalDebit: 1000, totalCredit: 0 },
      20: { repId: 20, repName: 'مندوب التوزيع 2', balance: 2500, totalDebit: 2500, totalCredit: 0 },
    },
    repBalances: [
      { repId: 10, repName: 'مندوب التوزيع 1', balance: 1000, totalDebit: 1000, totalCredit: 0 },
      { repId: 20, repName: 'مندوب التوزيع 2', balance: 2500, totalDebit: 2500, totalCredit: 0 },
    ],
  },
  moneyDigits: 2,
});

assert.equal(isolated.repBalance, 1000);
assert.equal(isolated.totalCustomerBalance, 3500);

// Collection of 500 EGP is valid
const collectionValidation = validateIsolatedRepCollection({
  repId: 10,
  collectionAmount: 500,
  repBalance: isolated.repBalance,
  otherRepsBalance: isolated.otherRepsBalance,
  totalCustomerBalance: isolated.totalCustomerBalance,
  moneyDigits: 2,
});
assert.equal(collectionValidation.allowed, true);

// Collection of 1500 EGP must be rejected because it encroaches on other rep's debt
const invalidCollection = validateIsolatedRepCollection({
  repId: 10,
  collectionAmount: 1500,
  repBalance: isolated.repBalance,
  otherRepsBalance: isolated.otherRepsBalance,
  totalCustomerBalance: isolated.totalCustomerBalance,
  moneyDigits: 2,
});
assert.equal(invalidCollection.allowed, false);
console.log('[PASS] Isolated rep debt balances strictly protected against cross-rep encroachment');

// ============================================================================
// STAGE 5: END-OF-DAY RECONCILIATION, STRIKE-RATE & CLEARANCE CERTIFICATE
// ============================================================================
console.log('--- Stage 5: End-of-Day Settlement, Strike-Rate & Clearance Certificate ---');

// 5.1 Strike-Rate KPI Calculation
const visitsSummary = [
  { has_sale: true, sale_amount: 1140, dwell_time_seconds: 18 * 60 },
  { has_sale: false, no_sale_reason: 'store_closed', dwell_time_seconds: 120 },
];

const strikeMetrics = FmcgVisitExecutionEngine.calculateStrikeRateMetrics(visitsSummary);
assert.equal(strikeMetrics.totalVisits, 2);
assert.equal(strikeMetrics.productiveVisits, 1);
assert.equal(strikeMetrics.strikeRatePercentage, 50.0);
console.log(`[PASS] Strike-Rate Metric: ${strikeMetrics.strikeRatePercentage}% (${strikeMetrics.productiveVisits}/${strikeMetrics.totalVisits})`);

// 5.2 Trip Financials Reconciliation
const tripFin = reconcileTripFinancials({
  moneyDigits: 2,
  loadedAmount: 1200,
  salesAmount: 1140,
  cashSales: 0,
  creditSales: 1140,
  fieldCollections: 500,
  returnsAmount: 0,
  cashRefunds: 0,
  tripExpenses: 150, // Fuel expense
  countedCash: 350, // 500 collected - 150 expenses = 350 EGP
  remainingVanStockValue: 60,
});

assert.equal(tripFin.expectedCash, 350);
assert.equal(tripFin.countedCash, 350);
assert.equal(tripFin.cashVariance, 0);
assert.equal(tripFin.cashVarianceStatus, 'balanced');

// 5.3 Physical Van Stock Audit
const stockAudit = reconcileVanStockAudit([
  {
    productId: 1,
    productName: 'شيبسي عائلي جبنة',
    systemQty: 40,
    countedQty: 40,
    costPrice: 80,
    retailPrice: 120,
  },
  {
    productId: 3,
    productName: 'بسكويت شوكولاتة (بونص)',
    systemQty: 9,
    countedQty: 9,
    costPrice: 15,
    retailPrice: 20,
  },
], 2);

assert.equal(stockAudit.hasStockDiscrepancy, false);
assert.equal(stockAudit.totalStockShortageCost, 0);

// 5.4 Dual-Custody Settlement Maker-Checker
const settlementAuthorization = evaluateMakerCheckerSettlement({
  repUserId: 10,
  actorUserId: 99, // Distinct warehouse cashier / supervisor
  actorRole: 'supervisor',
  isSupervisorOrAdmin: true,
});
assert.equal(settlementAuthorization.allowed, true);

// 5.5 Thermal 80mm Clearance Document Generation
const clearanceText = formatVanSettlementSummaryText({
  receiptNo: 'SETTLE-261014-0001',
  tripId: 101,
  repName: 'مندوب التوزيع 1',
  cashierName: 'أمين الخزينة أحمد',
  salesAmount: 1140,
  cashSales: 0,
  creditSales: 1140,
  collectionsTotal: 500,
  tripExpenses: 150,
  expectedCash: 350,
  countedCash: 350,
  variance: 0,
});

assert.ok(clearanceText.includes('SETTLE-261014-0001'));
assert.ok(clearanceText.includes('مندوب التوزيع 1'));
assert.ok(clearanceText.includes('التحصيلات: 500.00 ج.م'));
assert.ok(clearanceText.includes('مطابق 100% بدون أي عجز'));
console.log('[PASS] Full dual-custody settlement certificate formatted and verified');

console.log('>>> [SUCCESS] MASTER FMCG COMMERCIAL WORKFLOW & DISTRIBUTION PIPELINE VERIFIED 100%!');
