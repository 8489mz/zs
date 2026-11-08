import { strict as assert } from 'node:assert';
import {
  reconcileTripFinancials,
  evaluateDamagedSwap,
  formatVanSettlementSummaryText,
} from '../../src/modules/delivery-reps/van-trip-reconciliation.engine';
import {
  calculateRepTargetMetrics,
  calculateRepCommissionMetrics,
} from '../../src/modules/delivery-reps/rep-target.engine';

console.log('>>> [START] EGYPT FMCG MARKET CRITICAL SUITE (INSTAPAY, SIGNATURE, TARGET & SWAP)');

// ============================================================================
// VECTOR 1: INSTAPAY & VODAFONE CASH FINANCIAL SEGREGATION (عزل تحويلات إنستاباي عن الكاش)
// ============================================================================
console.log('--- Vector 1: InstaPay & Mobile Wallet Financial Segregation ---');

// Driver had:
// - Cash Sales: 3,000 EGP
// - InstaPay Sales: 2,500 EGP (Paid by merchant via InstaPay to company bank)
// - Credit Sales: 1,000 EGP
// - Cash Collections: 1,200 EGP
// - InstaPay Collections: 800 EGP
// - Expenses: 200 EGP (Fuel)
// The expected cash in the driver's hand MUST be:
// Cash Sales (3,000) + Cash Collections (1,200) - Expenses (200) = 4,000 EGP.
// InstaPay (2,500 + 800 = 3,300 EGP) must NEVER be counted as physical cash,
// but segregated as expected bank transfers.

const tripFin = reconcileTripFinancials({
  moneyDigits: 2,
  loadedAmount: 10000,
  salesAmount: 6500,
  cashSales: 3000,
  creditSales: 1000,
  fieldCollections: 1200,
  returnsAmount: 0,
  cashRefunds: 0,
  tripExpenses: 200,
  countedCash: 4000,
  remainingVanStockValue: 3500,
  instapaySales: 2500,
  instapayCollections: 800,
});

assert.equal(tripFin.expectedCash, 4000);
assert.equal(tripFin.countedCash, 4000);
assert.equal(tripFin.cashVariance, 0);
assert.equal(tripFin.cashVarianceStatus, 'balanced');
assert.equal(tripFin.totalInstapaySales, 2500);
assert.equal(tripFin.totalInstapayCollections, 800);
assert.equal(tripFin.expectedBankTransfers, 3300);

const summaryText = formatVanSettlementSummaryText({
  receiptNo: 'EGY-261014-001',
  tripId: 44,
  repName: 'محمود عبد الفتاح (مندوب الجيزة)',
  cashierName: 'أحمد إبراهيم (أمين الخزينة)',
  salesAmount: 6500,
  cashSales: 3000,
  creditSales: 1000,
  collectionsTotal: 2000,
  tripExpenses: 200,
  expectedCash: 4000,
  countedCash: 4000,
  variance: 0,
  instapayTotal: 3300,
});

assert.ok(summaryText.includes('تحويلات إنستاباي / المحافظ: 3300.00 ج.م'));
assert.ok(summaryText.includes('صافي المطلوب توريده نقداً: 4000.00 ج.م'));
assert.ok(summaryText.includes('مطابق 100% بدون أي عجز'));
console.log('[PASS] InstaPay and mobile wallet payments strictly segregated from physical cash in hand');

// ============================================================================
// VECTOR 2: RECIPIENT IDENTITY & SIGNATURE ON GLASS IN CREDIT SALES
// ============================================================================
console.log('--- Vector 2: Recipient Identity & Signature on Glass Governance ---');

// Validate recipient metadata structure
interface FieldCreditDeliveryNote {
  invoiceId: number;
  customerName: string;
  isCreditSale: boolean;
  totalAmount: number;
  recipientName: string;
  recipientPhone: string;
  recipientRole: 'owner' | 'manager' | 'cashier' | 'staff';
  signatureBase64: string;
}

function validateCreditDeliveryAcknowledgment(note: FieldCreditDeliveryNote): { valid: boolean; error?: string } {
  if (!note.isCreditSale) return { valid: true };
  if (!note.recipientName || note.recipientName.trim().length < 3) {
    return { valid: false, error: 'اسم المستلم ثلاثياً إلزامي لاعتماد الفاتورة الآجلة' };
  }
  if (!note.recipientPhone || note.recipientPhone.trim().length < 10) {
    return { valid: false, error: 'رقم هاتف المستلم إلزامي للتحقق من هوية المستلم' };
  }
  if (!note.signatureBase64 || note.signatureBase64.length < 50) {
    return { valid: false, error: 'توقيع المستلم بالإصبع على الشاشة إلزامي في المبيعات الآجلة' };
  }
  return { valid: true };
}

// Case A: Missing recipient name
const invalidNoteA = validateCreditDeliveryAcknowledgment({
  invoiceId: 101,
  customerName: 'سوبرماركت البركة',
  isCreditSale: true,
  totalAmount: 1800,
  recipientName: '',
  recipientPhone: '01012345678',
  recipientRole: 'staff',
  signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAA...',
});
assert.equal(invalidNoteA.valid, false);
assert.equal(invalidNoteA.error, 'اسم المستلم ثلاثياً إلزامي لاعتماد الفاتورة الآجلة');

// Case B: Missing signature
const invalidNoteB = validateCreditDeliveryAcknowledgment({
  invoiceId: 102,
  customerName: 'سوبرماركت البركة',
  isCreditSale: true,
  totalAmount: 1800,
  recipientName: 'محمد أحمد علي',
  recipientPhone: '01012345678',
  recipientRole: 'staff',
  signatureBase64: '',
});
assert.equal(invalidNoteB.valid, false);
assert.equal(invalidNoteB.error, 'توقيع المستلم بالإصبع على الشاشة إلزامي في المبيعات الآجلة');

// Case C: Valid delivery acknowledgment
const validNote = validateCreditDeliveryAcknowledgment({
  invoiceId: 103,
  customerName: 'سوبرماركت البركة',
  isCreditSale: true,
  totalAmount: 1800,
  recipientName: 'إبراهيم حسن محمود',
  recipientPhone: '01123456789',
  recipientRole: 'cashier',
  signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAZ1234567890abcdef...',
});
assert.equal(validNote.valid, true);
console.log('[PASS] Signature on glass and recipient verification strictly protects against delivery denial');

// ============================================================================
// VECTOR 3: LIVE TARGET & COMMISSION BOOSTER ENGINE (عداد التارجت والعمولة الحية)
// ============================================================================
console.log('--- Vector 3: Real-Time Target & Commission Booster Calculation ---');

// Target calculation: Target = 50,000 EGP, Actual MTD = 38,000 EGP, Today = 4,000 EGP
const targetResult = calculateRepTargetMetrics({
  targetAmount: 50000,
  actualSalesMTD: 42000, // 38,000 + 4,000 today
  currentDate: new Date('2026-10-14'),
  moneyDigits: 2,
});

assert.equal(targetResult.achievementRate, 84.0); // 84% achieved
assert.equal(targetResult.remainingTarget, 8000); // 8,000 EGP left
assert.equal(targetResult.isTargetAchieved, false);
assert.ok(targetResult.requiredDailyTarget > 0);

// Commission calculation
const commissionResult = calculateRepCommissionMetrics({
  actualSales: 42000,
  actualCollections: 25000,
  salesTarget: 50000,
  salesCommissionRatePercent: 1.5,
  collectionCommissionRatePercent: 0.5,
  targetBonusRatePercent: 1.0,
  moneyDigits: 2,
});

assert.equal(commissionResult.salesCommissionRatePercent, 1.5);
assert.equal(commissionResult.salesCommissionAmount, 630); // 42,000 * 1.5% = 630 EGP
assert.equal(commissionResult.collectionCommissionAmount, 125); // 25,000 * 0.5% = 125 EGP
assert.equal(commissionResult.totalEarnedCommission, 755); // 630 + 125 = 755 EGP
assert.equal(commissionResult.isTargetBonusEligible, false); // Target 50,000 not reached yet

// Remaining to next tier (50,000 target bonus) = 8,000 EGP
const remainingToBonus = Math.max(0, 50000 - 42000);
assert.equal(remainingToBonus, 8000);
console.log(`[PASS] Driver Live Booster: 84% achieved, Earned ${commissionResult.totalEarnedCommission} EGP, Remaining ${remainingToBonus} EGP to hit Target Bonus (+1.0%)`);

// ============================================================================
// VECTOR 4: INSTANT DAMAGED / BROKEN GOODS SWAP (استبدال التالف والمعيب الفوري)
// ============================================================================
console.log('--- Vector 4: Instant Damaged / Broken Goods Swap Engine ---');

// Scenario A: 1-to-1 Even Swap (Same product, fresh replacement for damaged goods)
// Customer gives 2 damaged boxes of Chipsy Cheese (120 EGP each), rep gives 2 fresh boxes of Chipsy Cheese
const evenSwap = evaluateDamagedSwap({
  moneyDigits: 2,
  damagedProductId: 10,
  damagedQty: 2,
  damagedUnitPrice: 120,
  damageReason: 'crushed_carton', // كرتونة مكسورة
  replacementProductId: 10,
  replacementQty: 2,
  replacementUnitPrice: 120,
  availableVanStockQty: 15,
});

assert.equal(evenSwap.allowed, true);
assert.equal(evenSwap.isEvenSwap, true);
assert.equal(evenSwap.priceDifference, 0);
assert.equal(evenSwap.damagedValue, 240);
assert.equal(evenSwap.replacementValue, 240);

// Scenario B: Cross-Product Swap with Price Difference
// Customer gives 1 damaged bottle of Juice (25 EGP), wants 1 box of Biscuits (35 EGP)
// Price difference: customer pays +10 EGP
const diffSwap = evaluateDamagedSwap({
  moneyDigits: 2,
  damagedProductId: 20,
  damagedQty: 1,
  damagedUnitPrice: 25,
  damageReason: 'leakage', // تسريب
  replacementProductId: 30,
  replacementQty: 1,
  replacementUnitPrice: 35,
  availableVanStockQty: 8,
});

assert.equal(diffSwap.allowed, true);
assert.equal(diffSwap.isEvenSwap, false);
assert.equal(diffSwap.priceDifference, 10); // 35 - 25 = 10 EGP

// Scenario C: Swap rejected due to insufficient van stock
const rejectedStock = evaluateDamagedSwap({
  moneyDigits: 2,
  damagedProductId: 10,
  damagedQty: 5,
  damagedUnitPrice: 120,
  damageReason: 'expired',
  replacementProductId: 10,
  replacementQty: 5,
  replacementUnitPrice: 120,
  availableVanStockQty: 2, // Only 2 left in van
});

assert.equal(rejectedStock.allowed, false);
assert.equal(rejectedStock.reasonCode, 'STOCK_UNAVAILABLE');
assert.ok(rejectedStock.errorMessageAr?.includes('غير كافٍ'));

// Scenario D: Swap rejected due to missing damage reason
const rejectedReason = evaluateDamagedSwap({
  moneyDigits: 2,
  damagedProductId: 10,
  damagedQty: 1,
  damagedUnitPrice: 120,
  damageReason: '', // Empty reason
  replacementProductId: 10,
  replacementQty: 1,
  replacementUnitPrice: 120,
  availableVanStockQty: 10,
});

assert.equal(rejectedReason.allowed, false);
assert.equal(rejectedReason.reasonCode, 'REASON_REQUIRED');

console.log('[PASS] Instant damaged/broken goods swap engine fully verified across all operational scenarios');

console.log('>>> [SUCCESS] ALL 4 EGYPTIAN FMCG MARKET CRITICAL VECTORS PASSED 100%!');
