import { strict as assert } from 'node:assert';
import { computeThreeWayMatch } from '../../src/modules/purchases/three-way-match.engine';

// =============================================================================
// Regression guards for the procurement three-way match.
// Imports the PRODUCTION engine directly — a local copy would pass even if the
// shipped engine regressed, which is the failure mode these tests exist to catch.
// =============================================================================

console.log('=== اختبارات المطابقة الثلاثية للمشتريات ===\n');

const poItems = [{ id: 1, productId: 100, qty: 100, unitCost: 10 }];
const grnLines = [{ id: 1, grnId: 1, poItemId: 1, productId: 100, receivedQty: 100, acceptedQty: 100, rejectedQty: 0, unitCost: 10 }];

// --- MATCH-1: prior invoices consume the receipt -----------------------------
const r1 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  poItems,
  grnLines,
  invoiceItems: [{ productId: 100, poItemId: 1, qty: 100, unitCost: 10 }],
  historicalInvoicedLines: [],
});
assert.equal(r1.isValidForPosting, true, 'أول فاتورة بكامل الكمية المستلمة يجب أن تمر');

const r2 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  poItems,
  grnLines,
  invoiceItems: [{ productId: 100, poItemId: 1, qty: 100, unitCost: 10 }],
  // The same delivery was already billed in full by another invoice.
  historicalInvoicedLines: [{ poItemId: 1, productId: 100, qty: 100 }],
});
assert.equal(r2.isValidForPosting, false, 'MATCH-1: فوترة نفس الشحنة مرتين يجب أن تُحجب');
assert.ok(r2.blockingCodes.includes('QTY_EXCEEDS_RECEIPT'), 'MATCH-1: كود الحجب يجب أن يكون تجاوز كمية الاستلام');
console.log('✔ MATCH-1: منع ازدواج فوترة نفس الشحنة');

// --- MATCH-1: split lines inside ONE invoice cannot bypass the receipt -------
const r3 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  poItems,
  grnLines,
  invoiceItems: [
    { productId: 100, poItemId: 1, qty: 60, unitCost: 10 },
    { productId: 100, poItemId: 1, qty: 60, unitCost: 10 },
  ],
});
assert.equal(r3.isValidForPosting, false, 'MATCH-1: تقسيم البند داخل الفاتورة لا يتجاوز الكمية المستلمة');
assert.ok(r3.blockingCodes.includes('QTY_EXCEEDS_RECEIPT'));
console.log('✔ MATCH-1: تقسيم السطور داخل الفاتورة الواحدة لا يتجاوز الحد');

// --- MATCH-2: overcharging blocked, undercharging allowed -------------------
const r4 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  poItems,
  grnLines,
  invoiceItems: [{ productId: 100, poItemId: 1, qty: 100, unitCost: 11 }], // +10%
  tolerancePercentage: 2,
});
assert.equal(r4.isValidForPosting, false, 'MATCH-2: تجاوز السعر لأعلى يجب أن يُحجب');
assert.ok(r4.blockingCodes.includes('PRICE_TOLERANCE_EXCEEDED'));

const r5 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  poItems,
  grnLines,
  invoiceItems: [{ productId: 100, poItemId: 1, qty: 100, unitCost: 9 }], // -10%, in our favour
  tolerancePercentage: 2,
});
assert.equal(r5.isValidForPosting, true, 'MATCH-2: الفرق في مصلحة المشتري يجب ألا يُحجب');
console.log('✔ MATCH-2: حجب الزيادة السعرية فقط دون الفرق المواتي');

// --- Override scoping --------------------------------------------------------
const qtyBlocked = {
  poItems,
  grnLines,
  invoiceItems: [{ productId: 100, poItemId: 1, qty: 150, unitCost: 10 }],
};

const r6 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  ...qtyBlocked,
  allowOverride: true,
  overrideReason: 'اعتماد تجاوز من مدير المشتريات بعد المراجعة',
  overrideScope: 'price_only',
});
assert.equal(r6.isValidForPosting, false, 'تجاوز السعر لا يجوز أن يُسقط حجب الكمية');

const r7 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  ...qtyBlocked,
  allowOverride: true,
  overrideReason: 'اعتماد إداري موثق لاستلام لاحق مؤكد',
  overrideScope: 'full',
});
assert.equal(r7.isValidForPosting, true, 'التجاوز الكامل بصلاحية الإدارة يسمح بالترحيل');

const r8 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  ...qtyBlocked,
  allowOverride: true,
  overrideReason: '', // undocumented: an empty reason must not pass
  overrideScope: 'full',
});
assert.equal(r8.isValidForPosting, false, 'سبب تجاوز غير مُوثّق يجب ألا يُقبل');
console.log('✔ نطاق التجاوز: السعر لا يُسقط حجب الكمية، والسبب يجب أن يكون موثقاً');

// --- Per-line VAT on a mixed-rate invoice -----------------------------------
const r9 = computeThreeWayMatch({
  minorUnits: 2,
  poItems: [
    { id: 1, productId: 100, qty: 10, unitCost: 10 },
    { id: 2, productId: 200, qty: 10, unitCost: 10 },
  ],
  grnLines: [
    { id: 1, grnId: 1, poItemId: 1, productId: 100, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, unitCost: 10 },
    { id: 2, grnId: 1, poItemId: 2, productId: 200, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, unitCost: 10 },
  ],
  invoiceItems: [
    { productId: 100, poItemId: 1, qty: 10, unitCost: 10 },
    { productId: 200, poItemId: 2, qty: 10, unitCost: 10 },
  ],
  vatRate: 0.14,
  vatRateByProduct: { 200: 0 }, // zero-rated line
});
// 100 taxed at 14% = 14, 100 zero-rated = 0
assert.equal(r9.totalVat, 14, 'ضريبة القيمة المضافة تُحتسب لكل سطر بمعدله لا بمعدل واحد للفاتورة');
console.log('✔ ضريبة القيمة المضافة على مستوى السطر للفواتير مختلطة المعدلات');

// --- Reconciliation is enforced, not merely reported ------------------------
const r10 = computeThreeWayMatch({
  minorUnits: 2,
  vatRate: 0.14,
  poItems,
  grnLines,
  invoiceItems: [{ productId: 100, poItemId: 1, qty: 100, unitCost: 10 }],
});
assert.equal(r10.reconciliationDiscrepancy, 0, 'فاتورة سليمة يجب ألا يكون بها فارق تسوية');
assert.equal(
  r10.totalInvoicedAmount,
  Number((r10.totalGrniClearing + r10.totalPpv).toFixed(2)),
  'الإجمالي = تصفية GRNI + فرق السعر',
);
console.log('✔ التسوية المحاسبية: الإجمالي يساوي تصفية GRNI مضافاً إليها فرق السعر');

// --- Status derives from codes, not from Arabic prose -----------------------
assert.equal(r2.overallStatus, 'quantity_mismatch', 'الحالة تُشتق من الأكواد');
assert.equal(r4.overallStatus, 'tolerance_exceeded', 'الحالة تُشتق من الأكواد');
assert.ok(Array.isArray(r2.blockingIssues) && r2.blockingIssues[0].code, 'أسباب الحجب منظمة وليست نصاً فقط');
console.log('✔ تحديد الحالة من أكواد منظمة لا من مطابقة نصوص عربية');

console.log('\n=============================================================');
console.log('كافة اختبارات المطابقة الثلاثية اجتازت بنجاح');
console.log('=============================================================');
