import { strict as assert } from 'node:assert';
import {
  evaluateFieldReturnGovernance,
  evaluateItineraryVisitRules,
  splitRequisitionByWarehouse,
  reconcileTripFinancials,
  reconcileVanStockAudit,
  evaluateCreditLimitCheck,
  evaluateOdometerReadings,
  evaluateMakerCheckerSettlement,
  evaluateNightStockRetention,
  evaluateFieldCardPayment,
  evaluateTripExpenseGovernance,
  formatVanSettlementSummaryText,
} from '../../src/modules/delivery-reps/van-trip-reconciliation.engine';
import {
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
  aggregateCustomerBalancesByRep,
  calculateHaversineDistanceMeters,
  evaluateGeofenceCompliance,
  extractCoordinatesFromCustomerLocation,
  isValidCoordinatePair,
  evaluateBatchExpiryStatus,
  calculateRepTargetMetrics,
  calculateRepCommissionMetrics,
} from '../../src/modules/delivery-reps/rep-target.engine';

console.log('>>> [START] EXHAUSTIVE DEEP ADVERSARIAL TEST SUITE (ALL VAN SALES MODES)');

// ============================================================================
// SECTION 1: FIELD RETURNS DEEP ATTACK VECTORS (حوكمة وتدقيق المرتجعات الميدانية)
// ============================================================================
console.log('--- Section 1: Field Returns Deep Adversarial Vectors ---');

// Setup baseline sale data:
// Invoice INV-001 issued by Rep 1 to Customer 10.
// Item 101: 20 pcs sold @ 50 EGP each (lineTotal = 1,000 EGP).
// Item 102: 10 pcs sold @ 100 EGP with 20% discount (lineTotal = 800 EGP -> net unit price = 80 EGP).
const baselineSale = {
  saleId: 501,
  docNo: 'INV-261013-0001',
  customerId: 10,
  repId: 1,
  items: [
    {
      saleItemId: 1001,
      productId: 101,
      productName: 'جبنة بيضاء 500جم',
      soldQty: 20,
      unitPrice: 50,
      lineTotal: 1000,
      alreadyReturnedQty: 0,
    },
    {
      saleItemId: 1002,
      productId: 102,
      productName: 'زيت دوار الشمس 1لتر',
      soldQty: 10,
      unitPrice: 100,
      lineTotal: 800, // Discounted: net price = 80 EGP
      alreadyReturnedQty: 0,
    },
  ],
};

// Vector 1.1: Legitimate Linked Return (5 pcs of Item 101 @ 50 EGP = 250 EGP)
const legitReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 101, saleItemId: 1001, qty: 5, unitPrice: 50 }],
  refundMethod: 'credit',
  linkedSale: baselineSale,
});
assert.equal(legitReturn.allowed, true);
assert.equal(legitReturn.totalAmount, 250);

// Vector 1.2: Over-Quantity Attack (Returning 25 pcs when only 20 were sold)
const overQtyReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 101, saleItemId: 1001, qty: 25, unitPrice: 50 }],
  refundMethod: 'credit',
  linkedSale: baselineSale,
});
assert.equal(overQtyReturn.allowed, false);
assert.equal(overQtyReturn.reasonCode, 'RETURN_QTY_EXCEEDS_SOLD');
assert.equal(overQtyReturn.httpStatus, 400);

// Vector 1.3: Cumulative Double-Return Overdraft Attack
// Prior voucher returned 14 pcs. Rep now tries to return 8 more (14 + 8 = 22 > 20)
const partialPriorSale = {
  ...baselineSale,
  items: [
    {
      ...baselineSale.items[0],
      alreadyReturnedQty: 14, // 6 remaining returnable
    },
    baselineSale.items[1],
  ],
};
const cumulativeOverdraft = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 101, saleItemId: 1001, qty: 8, unitPrice: 50 }],
  refundMethod: 'credit',
  linkedSale: partialPriorSale,
});
assert.equal(cumulativeOverdraft.allowed, false);
assert.equal(cumulativeOverdraft.reasonCode, 'RETURN_QTY_EXCEEDS_SOLD');

// Vector 1.4: Net Discount Price Inflation Attack
// Item 102 was sold net @ 80 EGP. Rogue rep tries to return at list price 100 EGP!
const priceInflationReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 102, saleItemId: 1002, qty: 3, unitPrice: 100 }],
  refundMethod: 'credit',
  linkedSale: baselineSale,
});
assert.equal(priceInflationReturn.allowed, false);
assert.equal(priceInflationReturn.reasonCode, 'RETURN_PRICE_EXCEEDS_NET');

// Vector 1.5: Cross-Customer Invoice Return Exploit
// Rep tries to file return for Customer 12 using Customer 10's invoice
const crossCustomerReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 12, // Mismatch!
  items: [{ productId: 101, saleItemId: 1001, qty: 2, unitPrice: 50 }],
  refundMethod: 'credit',
  linkedSale: baselineSale,
});
assert.equal(crossCustomerReturn.allowed, false);
assert.equal(crossCustomerReturn.reasonCode, 'SALE_CUSTOMER_MISMATCH');

// Vector 1.6: Cross-Rep Invoice Hijacking Attack
// Rep 2 tries to file a return against Rep 1's invoice
const crossRepReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 2, // Rogue rep trying to touch Rep 1's invoice
  customerId: 10,
  items: [{ productId: 101, saleItemId: 1001, qty: 2, unitPrice: 50 }],
  refundMethod: 'credit',
  linkedSale: baselineSale,
});
assert.equal(crossRepReturn.allowed, false);
assert.equal(crossRepReturn.reasonCode, 'SALE_REP_MISMATCH');
assert.equal(crossRepReturn.httpStatus, 403);

// Vector 1.7: Phantom Item Return Attack (Item 999 not on invoice)
const phantomItemReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 999, qty: 1, unitPrice: 50 }],
  refundMethod: 'credit',
  linkedSale: baselineSale,
});
assert.equal(phantomItemReturn.allowed, false);
assert.equal(phantomItemReturn.reasonCode, 'ITEM_NOT_IN_SALE');

// Vector 1.8: Unlinked Return Without Sales History Attack
const noHistoryReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 99,
  items: [{ productId: 101, qty: 2, unitPrice: 50 }],
  refundMethod: 'credit',
  linkedSale: null,
  repCustomerSalesHistory: [], // Zero sales history
});
assert.equal(noHistoryReturn.allowed, false);
assert.equal(noHistoryReturn.reasonCode, 'NO_REP_SALES_HISTORY_FOR_RETURN');
assert.equal(noHistoryReturn.httpStatus, 403);

// Vector 1.9: Unlinked Return Exceeding Historical Sales
const unlinkedOverQtyReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 101, qty: 15, unitPrice: 48 }],
  refundMethod: 'credit',
  linkedSale: null,
  repCustomerSalesHistory: [
    {
      productId: 101,
      totalSoldQty: 10, // only 10 sold historically
      maxNetUnitPrice: 50,
      alreadyReturnedQty: 0,
    },
  ],
});
assert.equal(unlinkedOverQtyReturn.allowed, false);
assert.equal(unlinkedOverQtyReturn.reasonCode, 'RETURN_QTY_EXCEEDS_SOLD');

// Vector 1.10: Unlinked Return Price Higher Than Historical Net
const unlinkedPriceSpikeReturn = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 101, qty: 2, unitPrice: 65 }], // 65 > 45 max net
  refundMethod: 'credit',
  linkedSale: null,
  repCustomerSalesHistory: [
    {
      productId: 101,
      totalSoldQty: 20,
      maxNetUnitPrice: 45,
      alreadyReturnedQty: 0,
    },
  ],
});
assert.equal(unlinkedPriceSpikeReturn.allowed, false);
assert.equal(unlinkedPriceSpikeReturn.reasonCode, 'RETURN_PRICE_EXCEEDS_NET');

// Vector 1.11: Cash Refund Exceeding Van Trip Cash Collected
const excessiveCashRefund = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 101, saleItemId: 1001, qty: 10, unitPrice: 50 }], // 500 EGP refund
  refundMethod: 'cash',
  tripCashCollected: 200, // Only 200 EGP collected so far!
  linkedSale: baselineSale,
});
assert.equal(excessiveCashRefund.allowed, false);
assert.equal(excessiveCashRefund.reasonCode, 'INSUFFICIENT_REP_CASH_FOR_REFUND');

// Vector 1.12: Legitimate Cash Refund Within Van Cash Limits
const legitCashRefund = evaluateFieldReturnGovernance({
  moneyDigits: 2,
  repId: 1,
  customerId: 10,
  items: [{ productId: 101, saleItemId: 1001, qty: 3, unitPrice: 50 }], // 150 EGP refund
  refundMethod: 'cash',
  tripCashCollected: 800, // 800 EGP collected > 150
  linkedSale: baselineSale,
});
assert.equal(legitCashRefund.allowed, true);
assert.equal(legitCashRefund.totalAmount, 150);

// ============================================================================
// SECTION 2: FIELD COLLECTIONS (التحصيل الجزئي والكلي وعزل المناديب)
// ============================================================================
console.log('--- Section 2: Field Collections & Isolated Debt Segregation ---');

// Vector 2.1: Partial Collection on Isolated Balance
// Rep 1 is owed 2,500 EGP. Collects partial payment of 1,000 EGP.
const partialCol = validateIsolatedRepCollection({
  repId: 1,
  collectionAmount: 1000,
  repBalance: 2500,
  otherRepsBalance: 0,
  totalCustomerBalance: 2500,
  moneyDigits: 2,
});
assert.equal(partialCol.allowed, true);
assert.equal(partialCol.repPreviousBalance, 2500);
assert.equal(partialCol.repNewBalance, 1500);
assert.equal(partialCol.companyPreviousBalance, 2500);
assert.equal(partialCol.companyNewBalance, 1500);

// Vector 2.2: Full Settlement of Rep Debt
const fullCol = validateIsolatedRepCollection({
  repId: 1,
  collectionAmount: 1500,
  repBalance: 1500,
  otherRepsBalance: 0,
  totalCustomerBalance: 1500,
  moneyDigits: 2,
});
assert.equal(fullCol.allowed, true);
assert.equal(fullCol.repNewBalance, 0);
assert.equal(fullCol.companyNewBalance, 0);

// Vector 2.3: Cross-Rep Debt Encroachment Attack
// Shared customer owes Rep 1: 500 EGP, and Rep 2: 2,000 EGP (Total = 2,500 EGP).
// Rep 1 attempts to collect 1,200 EGP (eating into Rep 2's balance).
const crossRepEncroachment = validateIsolatedRepCollection({
  repId: 1,
  collectionAmount: 1200,
  repBalance: 500,
  otherRepsBalance: 2000,
  totalCustomerBalance: 2500,
  moneyDigits: 2,
});
assert.equal(crossRepEncroachment.allowed, false);
assert.equal(crossRepEncroachment.errorCode, 'REP_ISOLATED_BALANCE_EXCEEDED');
assert.ok(crossRepEncroachment.errorMessage?.includes('تخص مناديب آخرين'));

// Vector 2.4: Zero-Balance Rep Attempting Collection on Shared Debtor
// Rep 1 has 0 balance, Rep 2 has 3,000 EGP. Rep 1 tries to collect 500 EGP.
const zeroBalanceRepAttack = validateIsolatedRepCollection({
  repId: 1,
  collectionAmount: 500,
  repBalance: 0,
  otherRepsBalance: 3000,
  totalCustomerBalance: 3000,
  moneyDigits: 2,
});
assert.equal(zeroBalanceRepAttack.allowed, false);
assert.equal(zeroBalanceRepAttack.errorCode, 'REP_ISOLATED_BALANCE_EXCEEDED');

// Vector 2.5: Multi-Rep Customer Ledger Aggregation Engine
// Customer 50 has activity from Rep 1, Rep 2, and unassigned opening balance
const aggregatedLedger = aggregateCustomerBalancesByRep(
  [
    { customerId: 50, repId: 1, repName: 'أحمد مندوب', amount: 2000 },
    { customerId: 50, repId: 1, repName: 'أحمد مندوب', amount: -800 }, // Rep 1 net: 1,200
    { customerId: 50, repId: 2, repName: 'محمود مندوب', amount: 3500 },
    { customerId: 50, repId: 2, repName: 'محمود مندوب', amount: -1000 }, // Rep 2 net: 2,500
    { customerId: 50, repId: null, amount: 300 }, // Unassigned: 300
  ],
  { 50: 4000 }, // Total company balance: 1,200 + 2,500 + 300 = 4,000
  2,
);

const cust50Breakdown = aggregatedLedger.get(50)!;
assert.equal(cust50Breakdown.totalCustomerBalance, 4000);
assert.equal(cust50Breakdown.byRepId[1].balance, 1200);
assert.equal(cust50Breakdown.byRepId[2].balance, 2500);
assert.equal(cust50Breakdown.unassignedBalance, 300);

// Resolving isolated view for Rep 1
const rep1View = resolveIsolatedRepCustomerBalance({
  repId: 1,
  breakdown: cust50Breakdown,
  assignedRepIds: [1, 2],
  fallbackTotalBalance: 4000,
  moneyDigits: 2,
});
assert.equal(rep1View.repBalance, 1200);
assert.equal(rep1View.otherRepsBalance, 2500);
assert.equal(rep1View.totalCustomerBalance, 4000);

// Resolving isolated view for Rep 3 (not on this customer)
const rep3View = resolveIsolatedRepCustomerBalance({
  repId: 3,
  breakdown: cust50Breakdown,
  assignedRepIds: [1, 2],
  fallbackTotalBalance: 4000,
  moneyDigits: 2,
});
assert.equal(rep3View.repBalance, 0); // Never leaks another rep's debt!
assert.equal(rep3View.otherRepsBalance, 3700);

// ============================================================================
// SECTION 3: ROUTE ITINERARY & VISIT TRACKING (خط السير ومكافحة الزيارات الوهمية)
// ============================================================================
console.log('--- Section 3: Route Itinerary, Visit Types & Ghost Visit Shield ---');

// Vector 3.1: Scheduled Day Matching (Arabic & English)
const saturdayVisit = evaluateItineraryVisitRules({
  customerId: 77,
  visitType: 'positive',
  customerVisitDays: ['السبت', 'الثلاثاء'],
  currentDayName: 'السبت',
  currentEnglishDayName: 'saturday',
});
assert.equal(saturdayVisit.isValid, true);
assert.equal(saturdayVisit.isScheduledToday, true);

const offScheduleVisit = evaluateItineraryVisitRules({
  customerId: 77,
  visitType: 'positive',
  customerVisitDays: ['السبت', 'الثلاثاء'],
  currentDayName: 'الأربعاء',
  currentEnglishDayName: 'wednesday',
});
assert.equal(offScheduleVisit.isValid, true);
assert.equal(offScheduleVisit.isScheduledToday, false); // Flagged as ad-hoc off-schedule visit!

// Vector 3.2: Valid Negative Visit With All 6 Operational Business Reasons
const validReasons = ['no_cash', 'shop_closed', 'sufficient_stock', 'item_unavailable', 'postponed', 'other'] as const;
for (const reason of validReasons) {
  const negVisit = evaluateItineraryVisitRules({
    customerId: 77,
    visitType: 'negative',
    negativeReason: reason,
  });
  assert.equal(negVisit.isValid, true, `Failed for reason: ${reason}`);
}

// Vector 3.3: Missing or Invalid Negative Reason Attack
const missingReasonVisit = evaluateItineraryVisitRules({
  customerId: 77,
  visitType: 'negative',
  negativeReason: null,
});
assert.equal(missingReasonVisit.isValid, false);
assert.equal(missingReasonVisit.reasonCode, 'MISSING_NEGATIVE_REASON');

const invalidReasonVisit = evaluateItineraryVisitRules({
  customerId: 77,
  visitType: 'negative',
  negativeReason: 'rep_was_sleepy',
});
assert.equal(invalidReasonVisit.isValid, false);
assert.equal(invalidReasonVisit.reasonCode, 'INVALID_NEGATIVE_REASON');

// Vector 3.4: Repeated Consecutive Negative Visits Escalation (3 in a row)
const consecutiveNegVisit = evaluateItineraryVisitRules({
  customerId: 77,
  visitType: 'negative',
  negativeReason: 'shop_closed',
  recentCustomerVisits: [
    { visitType: 'negative' },
    { visitType: 'negative' },
  ],
});
assert.equal(consecutiveNegVisit.isValid, true);
assert.equal(consecutiveNegVisit.hasConsecutiveNegativeAlert, true);

// Vector 3.5: Ghost Visit Detection (Geofence Distance Violation)
// Customer at (30.0444, 31.2357). Rep logs visit at (30.0510, 31.2400) ~830m away
const ghostVisit = evaluateItineraryVisitRules({
  customerId: 77,
  visitType: 'negative',
  negativeReason: 'no_cash',
  repGps: { lat: 30.0510, lng: 31.2400 },
  customerGps: { lat: 30.0444, lng: 31.2357 },
  maxAllowedGeofenceMeters: 300,
});
assert.equal(ghostVisit.isValid, true);
assert.equal(ghostVisit.isWithinGeofence, false);
assert.ok((ghostVisit.distanceMeters ?? 0) > 300);

// ============================================================================
// SECTION 4: STREET INTER-VAN TRANSFERS & MULTI-WAREHOUSE REQUISITIONS
// ============================================================================
console.log('--- Section 4: Street Inter-Van Transfers & Multi-Warehouse Requisitions ---');

// Vector 4.1: Multi-Warehouse Auto-Split Engine
const mixedRequisitionItems = [
  { productId: 101, qty: 50, sourceWarehouseId: 1, sourceWarehouseName: 'المستودع الرئيسي' },
  { productId: 102, qty: 30, sourceWarehouseId: 1, sourceWarehouseName: 'المستودع الرئيسي' },
  { productId: 201, qty: 20, sourceWarehouseId: 2, sourceWarehouseName: 'مستودع المبردات' },
  { productId: 301, qty: 15, sourceWarehouseId: 3, sourceWarehouseName: 'مستودع الجملة' },
];

const splitGroups = splitRequisitionByWarehouse(mixedRequisitionItems, 1);
assert.equal(splitGroups.length, 3);

// Group 1: Warehouse 1 (Main)
assert.equal(splitGroups[0].warehouseId, 1);
assert.equal(splitGroups[0].items.length, 2);
assert.equal(splitGroups[0].totalQty, 80);

// Group 2: Warehouse 2 (Refrigerated)
assert.equal(splitGroups[1].warehouseId, 2);
assert.equal(splitGroups[1].items.length, 1);
assert.equal(splitGroups[1].totalQty, 20);

// Group 3: Warehouse 3 (Wholesale)
assert.equal(splitGroups[2].warehouseId, 3);
assert.equal(splitGroups[2].items.length, 1);
assert.equal(splitGroups[2].totalQty, 15);

// Vector 4.2: FEFO Batch Expiry Status Governance
const expiredStatus = evaluateBatchExpiryStatus('2026-09-01', new Date('2026-10-13T12:00:00Z'));
assert.equal(expiredStatus.status, 'expired');
assert.ok((expiredStatus.daysRemaining ?? 0) < 0);

const nearExpiryStatus = evaluateBatchExpiryStatus('2026-11-10', new Date('2026-10-13T12:00:00Z'), 60);
assert.equal(nearExpiryStatus.status, 'near_expiry');
assert.ok((nearExpiryStatus.daysRemaining ?? 0) <= 60);

const validBatchStatus = evaluateBatchExpiryStatus('2027-06-30', new Date('2026-10-13T12:00:00Z'), 60);
assert.equal(validBatchStatus.status, 'valid');

// ============================================================================
// SECTION 5: CASHIER HANDOVER CLEARANCE & 80MM THERMAL RECEIPT
// ============================================================================
console.log('--- Section 5: Handover Certificate & 80mm Thermal Clearance Receipt ---');

// Scenario 5.1: Cash Shortage & Stock Shortage Handover Reconciliation
const shortageReconciliation = reconcileTripFinancials({
  moneyDigits: 2,
  loadedAmount: 20000,
  salesAmount: 15000,
  cashSales: 10000,
  creditSales: 5000,
  fieldCollections: 4000,
  returnsAmount: 600,
  cashRefunds: 200,
  tripExpenses: 150,
  countedCash: 12500, // Shortage of 1,150 EGP
  remainingVanStockValue: 5000,
});

assert.equal(shortageReconciliation.expectedCash, 13650); // 10,000 + 4,000 - 200 - 150 = 13,650
assert.equal(shortageReconciliation.countedCash, 12500);
assert.equal(shortageReconciliation.cashVariance, -1150);
assert.equal(shortageReconciliation.cashVarianceStatus, 'shortage');
assert.equal(shortageReconciliation.cashShortageAmount, 1150);

const stockShortageAudit = reconcileVanStockAudit([
  {
    productId: 101,
    productName: 'جبنة بيضاء 500جم',
    systemQty: 25,
    countedQty: 0,
    costPrice: 15,
    retailPrice: 20,
  },
], 2);
assert.equal(stockShortageAudit.hasStockDiscrepancy, true);
assert.equal(stockShortageAudit.totalStockShortageCost, 375); // 25 * 15

const shortageSummaryText = formatVanSettlementSummaryText({
  receiptNo: 'REC-261013-0042',
  tripId: 42,
  repName: 'أحمد فتحي حسن',
  cashierName: 'محمد أمين الخزينة',
  salesAmount: 15000,
  cashSales: 10000,
  creditSales: 5000,
  collectionsTotal: 4000,
  tripExpenses: 150,
  expectedCash: shortageReconciliation.expectedCash,
  countedCash: shortageReconciliation.countedCash,
  variance: shortageReconciliation.cashVariance,
  stockVarianceCost: stockShortageAudit.totalStockShortageCost,
  currency: 'ج.م',
});

assert.ok(shortageSummaryText.includes('سند توريد نقدية الخزينة وإخلاء طرف عهدة'));
assert.ok(shortageSummaryText.includes('REC-261013-0042'));
assert.ok(shortageSummaryText.includes('أحمد فتحي حسن'));
assert.ok(shortageSummaryText.includes('محمد أمين الخزينة'));
assert.ok(shortageSummaryText.includes('يوجد عجز نقدي بقيمة 1150.00 ج.م'));
assert.ok(shortageSummaryText.includes('عجز بضاعة بالجرد: 375.00 ج.م'));

// Scenario 5.2: 100% Balanced Handover Clearance
const balancedReconciliation = reconcileTripFinancials({
  moneyDigits: 2,
  loadedAmount: 20000,
  salesAmount: 15000,
  cashSales: 10000,
  creditSales: 5000,
  fieldCollections: 4000,
  returnsAmount: 600,
  cashRefunds: 200,
  tripExpenses: 150,
  countedCash: 13650, // 100% Matched
  remainingVanStockValue: 5000,
});

assert.equal(balancedReconciliation.cashVariance, 0);
assert.equal(balancedReconciliation.cashVarianceStatus, 'balanced');

const balancedSummaryText = formatVanSettlementSummaryText({
  receiptNo: 'REC-261013-0043',
  tripId: 43,
  repName: 'محمود المندوب',
  cashierName: 'محمد أمين الخزينة',
  salesAmount: 15000,
  cashSales: 10000,
  creditSales: 5000,
  collectionsTotal: 4000,
  tripExpenses: 150,
  expectedCash: balancedReconciliation.expectedCash,
  countedCash: balancedReconciliation.countedCash,
  variance: balancedReconciliation.cashVariance,
  currency: 'ج.م',
});

assert.ok(balancedSummaryText.includes('مطابق 100% بدون أي عجز'));
assert.ok(balancedSummaryText.includes('تم الاعتماد والإبراء بنجاح عبر Z-Systems ERP.'));

console.log('>>> [SUCCESS] ALL ADVERSARIAL ATTACK VECTORS & SCENARIOS PASSED 100%!');
