import assert from 'node:assert/strict';
import { calculateSalesReturnCost } from '../../src/modules/accounting/engines/sales-return-cost.engine';
import { settlePosExchange } from '../../src/modules/sales/engines/pos-exchange.engine';
import { allocateRefundTenders } from '../../src/modules/returns/engines/refund-tender.engine';
import { allocateInvoiceDiscount } from '../../src/modules/sales/engines/invoice-discount.engine';
import { AppError } from '../../src/common/errors/app-error';

console.log('=== بدء اختبارات محرك احتساب تكلفة المرتجعات والتسويات ورد المبالغ (POS & Returns Engines) ===\n');

// -------------------------------------------------------------
// 1. اختبارات calculateSalesReturnCost (حساب تكلفة بضاعة المرتجع)
// -------------------------------------------------------------
const originalSaleItems = [
  { id: 11, product_id: 7, cost_price: 10 },
  { id: 12, product_id: 7, cost_price: 18 },
  { id: 13, product_id: 8, cost_price: 50 },
  { id: 14, product_id: 9, cost_price: 0 }, // صنف تكلفته صفر (عينة مجانية أو خدمة)
];

// أ. إرجاع مباشر بربط صريح بسطر الفاتورة
assert.equal(calculateSalesReturnCost([{ product_id: 7, sale_item_id: 12, qty: 2 }], originalSaleItems), 36);
assert.equal(calculateSalesReturnCost([
  { product_id: 7, sale_item_id: 11, qty: 1 },
  { product_id: 7, sale_item_id: 12, qty: 1 },
  { product_id: 8, sale_item_id: 13, qty: 3 },
  { product_id: 9, sale_item_id: 14, qty: 5 },
], originalSaleItems), 10 + 18 + 150 + 0);

// ب. تكلفة محفوظة مسبقاً في سطر المرتجع (تتجاوز الحساب التلقائي بأمان)
assert.equal(calculateSalesReturnCost([
  { product_id: 7, sale_item_id: 11, qty: 2, cost_price: 12.5 },
], originalSaleItems), 25);

// ج. إرجاع بدون sale_item_id عندما تكون تكلفة الصنف متطابقة في كل سطوره
const uniformCostSaleItems = [
  { id: 101, product_id: 15, cost_price: 25 },
  { id: 102, product_id: 15, cost_price: 25 },
];
assert.equal(calculateSalesReturnCost([{ product_id: 15, sale_item_id: null, qty: 4 }], uniformCostSaleItems), 100);

// د. منع الغموض الحسابي عندما تختلف التكلفة بين أسطر نفس الصنف
assert.throws(
  () => calculateSalesReturnCost([{ product_id: 7, sale_item_id: null, qty: 1 }], originalSaleItems),
  /Ambiguous/
);

// هـ. منع الإرجاع لسطر فاتورة غير موجود
assert.throws(
  () => calculateSalesReturnCost([{ product_id: 7, sale_item_id: 999, qty: 1 }], originalSaleItems),
  /missing/
);

// هـ-2. لا يجوز للتكلفة المحفوظة تجاوز فحص مرجع سطر البيع الأصلي.
assert.throws(
  () => calculateSalesReturnCost([{ product_id: 8, sale_item_id: 11, qty: 1, cost_price: 50 }], originalSaleItems),
  /mismatched/
);
assert.throws(
  () => calculateSalesReturnCost([{ product_id: 7, sale_item_id: 999, qty: 1, cost_price: 10 }], originalSaleItems),
  /missing/
);
assert.equal(calculateSalesReturnCost([{ product_id: 7, sale_item_id: 11, qty: 2, cost_price: 12.5 }], originalSaleItems), 25);

// و. منع كميات سالبة أو صفرية أو غير صالحة
assert.throws(() => calculateSalesReturnCost([{ product_id: 7, sale_item_id: 11, qty: 0 }], originalSaleItems), /Invalid sales return cost line/);
assert.throws(() => calculateSalesReturnCost([{ product_id: 7, sale_item_id: 11, qty: -2 }], originalSaleItems), /Invalid sales return cost line/);
assert.throws(() => calculateSalesReturnCost([{ product_id: -1, sale_item_id: 11, qty: 1 }], originalSaleItems), /Invalid sales return cost line/);

console.log('✓ 1. اختبارات حساب تكلفة المرتجع وحظر الغموض (calculateSalesReturnCost) اجتازت بنجاح');

// -------------------------------------------------------------
// 2. اختبارات settlePosExchange (محرك استبدال نقطة البيع)
// -------------------------------------------------------------
// أ. استبدال متطابق القيمة تماماً
const exactExchange = settlePosExchange(150, 150);
assert.equal(exactExchange.appliedCredit, 150);
assert.equal(exactExchange.refundAmount, 0);
assert.equal(exactExchange.collectibleAmount, 0);

// ب. قيمة المرتجع أكبر من البديل -> استرداد للعميل
const refundExchange = settlePosExchange(250, 180);
assert.equal(refundExchange.appliedCredit, 180);
assert.equal(refundExchange.refundAmount, 70);
assert.equal(refundExchange.collectibleAmount, 0);

// ج. قيمة البديل أكبر من المرتجع -> تحصيل فارق من العميل
const collectExchange = settlePosExchange(100, 260.50);
assert.equal(collectExchange.appliedCredit, 100);
assert.equal(collectExchange.refundAmount, 0);
assert.equal(collectExchange.collectibleAmount, 160.50);

// د. منع مدخلات سالبة أو غير محددة
assert.throws(() => settlePosExchange(-10, 100), /EXCHANGE_AMOUNT_INVALID/);
assert.throws(() => settlePosExchange(100, -50), /EXCHANGE_AMOUNT_INVALID/);

console.log('✓ 2. اختبارات محرك الاستبدال المباشر بنقاط البيع (settlePosExchange) اجتازت بنجاح');

// -------------------------------------------------------------
// 3. اختبارات allocateRefundTenders (توزيع قنوات رد المبالغ ورد الحقوق)
// -------------------------------------------------------------
// أ. فاتورة مدفوعة كاش فقط: العميل يطلب كاش -> يسترد كاش حتى سقف المدفوع نقداً
const cashRefund = allocateRefundTenders({
  requested: 'cash',
  amount: 80,
  originalCashPaid: 100,
  originalNonCashPaid: 0,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: false,
});
assert.deepEqual(cashRefund, [{ tender: 'cash', amount: 80 }]);

// ب. فاتورة مدفوعة كارت فقط: العميل يطلب كاش -> النظام يمنع رد الكاش ويلزم بالرد كارت تلقائياً
const cardProtection = allocateRefundTenders({
  requested: 'cash',
  amount: 60,
  originalCashPaid: 0,
  originalNonCashPaid: 100,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: false,
});
assert.deepEqual(cardProtection, [{ tender: 'card', amount: 60 }]);

// ج. فاتورة سداد مجزأ (50 كاش + 50 كارت) وطلب رد 70 كاش:
// يسترد 50 كاش (الحد الأقصى المدفوع نقداً) + 20 كارت
const splitRefund = allocateRefundTenders({
  requested: 'cash',
  amount: 70,
  originalCashPaid: 50,
  originalNonCashPaid: 50,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: false,
});
assert.deepEqual(splitRefund, [
  { tender: 'cash', amount: 50 },
  { tender: 'card', amount: 20 },
]);

// د. فاتورة آجلة جزئياً (عليها مديونية 40، ومدفوع 60 كاش):
// رد المرتجع يبدأ دائماً بتخفيض مديونية العميل أولاً (receivable) ثم رد الكاش المتبقي
const debtReversalRefund = allocateRefundTenders({
  requested: 'cash',
  amount: 50,
  originalCashPaid: 60,
  originalNonCashPaid: 0,
  originalDebt: 40,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: true,
});
assert.deepEqual(debtReversalRefund, [
  { tender: 'receivable', amount: 40 },
  { tender: 'cash', amount: 10 },
]);

// هـ. رصيد متجر (Store Credit): يتطلب وجود عميل
assert.throws(() => allocateRefundTenders({
  requested: 'store_credit',
  amount: 30,
  originalCashPaid: 50,
  originalNonCashPaid: 0,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: false,
}), /REFUND_CUSTOMER_REQUIRED/);

const storeCreditSuccess = allocateRefundTenders({
  requested: 'store_credit',
  amount: 30,
  originalCashPaid: 50,
  originalNonCashPaid: 0,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: true,
});
assert.deepEqual(storeCreditSuccess, [{ tender: 'store_credit', amount: 30 }]);

// و. تجاوز المدير باعتماد رسمي (Manager Override):
// العميل دفع كارت ويريد استرداد نقدي، المشرف يوافق مع سبب لا يقل عن 10 أحرف
const overrideSuccess = allocateRefundTenders({
  requested: 'cash',
  amount: 100,
  originalCashPaid: 0,
  originalNonCashPaid: 100,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: false,
  override: true,
  overrideReason: 'موافقة المدير التنفيذي بسبب تعطل ماكينة البطاقات',
});
assert.deepEqual(overrideSuccess, [{ tender: 'cash', amount: 100 }]);

// حظر التجاوز إن كان السبب فارغاً؛ كلمة واحدة واضحة تُقبل
assert.throws(() => allocateRefundTenders({
  requested: 'cash',
  amount: 100,
  originalCashPaid: 0,
  originalNonCashPaid: 100,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: false,
  override: true,
  overrideReason: '',
}), /REFUND_OVERRIDE_REASON_REQUIRED/);

// كلمة واحدة واضحة تُقبل سبباً للتجاوز
assert.deepEqual(allocateRefundTenders({
  requested: 'cash',
  amount: 100,
  originalCashPaid: 0,
  originalNonCashPaid: 100,
  originalDebt: 0,
  previousCashRefunded: 0,
  previousNonCashRefunded: 0,
  previousDebtReversed: 0,
  hasCustomer: false,
  override: true,
  overrideReason: 'قصير',
}), [{ tender: 'cash', amount: 100 }]);

console.log('✓ 3. اختبارات حماية وسائل الاسترداد والاعتماد الإداري (allocateRefundTenders) اجتازت بنجاح');

// -------------------------------------------------------------
// 4. اختبارات allocateInvoiceDiscount (التوزيع الدقيق للخصم والضريبة على أسطر الفاتورة)
// -------------------------------------------------------------
const discountLines = [
  { lineTotal: 100, qty: 1 },
  { lineTotal: 100, qty: 1 },
  { lineTotal: 100, qty: 1 },
];
// خصم 10 جنيه على إجمالي 300 جنيه (يقسم 3.33 + 3.33 + 3.34 لامتصاص التقريب)
const allocated = allocateInvoiceDiscount({
  lines: discountLines,
  invoiceDiscount: 10,
  invoiceTax: 0,
  pricesIncludeTax: false,
  digits: 2,
});
assert.equal(allocated.length, 3);
const totalAllocatedDiscount = allocated.reduce((sum, l) => sum + l.allocatedDiscount, 0);
assert.equal(Number(totalAllocatedDiscount.toFixed(2)), 10.00);
assert.equal(allocated[0].allocatedDiscount, 3.33);
assert.equal(allocated[1].allocatedDiscount, 3.33);
assert.equal(allocated[2].allocatedDiscount, 3.34); // السطر الأخير يمتص باقي السنتات بدقة

// التحقق من حظر خصم أكبر من إجمالي الفاتورة
assert.throws(() => allocateInvoiceDiscount({
  lines: discountLines,
  invoiceDiscount: 350,
  invoiceTax: 0,
  pricesIncludeTax: false,
  digits: 2,
}), /INVALID_INVOICE_ALLOCATION/);

console.log('✓ 4. اختبارات التوزيع الرياضي العادل للخصومات والضرائب (allocateInvoiceDiscount) اجتازت بنجاح');

console.log('\n=============================================================================');
console.log('  كافة اختبارات محركات نقاط البيع والمرتجعات المعززة اجتازت 100%');
console.log('=============================================================================\n');

const kwdReceivableRefund = allocateRefundTenders({
  requested: 'cash', amount: 0.001, originalCashPaid: 0,
  originalNonCashPaid: 0, originalDebt: 0.001,
  previousCashRefunded: 0, previousNonCashRefunded: 0, previousDebtReversed: 0,
  hasCustomer: true, digits: 3,
});
assert.deepEqual(kwdReceivableRefund, [{ tender: 'receivable', amount: 0.001 }]);
const kwdCashRefund = allocateRefundTenders({
  requested: 'cash', amount: 0.002, originalCashPaid: 0.003,
  originalNonCashPaid: 0, originalDebt: 0,
  previousCashRefunded: 0, previousNonCashRefunded: 0, previousDebtReversed: 0,
  hasCustomer: true, digits: 3,
});
assert.deepEqual(kwdCashRefund, [{ tender: 'cash', amount: 0.002 }]);
