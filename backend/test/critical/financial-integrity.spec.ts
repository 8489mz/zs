import { strict as assert } from 'node:assert';
import { AppError } from '../../src/common/errors/app-error';
import {
  ensureNonNegativeStock,
  ensureReturnQtyWithinLimit,
  ensureUniqueFlowItems,
  roundMoneyToTwoDecimals,
  roundQty,
  validateSalePayments,
} from '../../src/common/utils/financial-integrity';
import { canonicalLockIds } from '../../src/common/utils/canonical-lock-order';

function expectAppError(fn: () => void, code: string): void {
  try {
    fn();
    assert.fail(`Expected AppError(${code})`);
  } catch (error) {
    assert.ok(error instanceof AppError, `Expected AppError, got ${(error as Error)?.message}`);
    assert.equal((error as AppError).code, code);
  }
}

console.log('=== بدء اختبارات الثوابت المالية والحسابية المعززة (Financial Integrity Suite) ===\n');

// -----------------------------------------------------------------------------
// 1. اختبارات سلامة التقريب المالي والمخزني (Round Money & Qty)
// -----------------------------------------------------------------------------
{
  assert.equal(roundMoneyToTwoDecimals(10.555), 10.56);
  assert.equal(roundMoneyToTwoDecimals(10.554), 10.55);
  assert.equal(roundMoneyToTwoDecimals(0.0001), 0.0);
  assert.equal(roundMoneyToTwoDecimals(0), 0);
  assert.equal(roundMoneyToTwoDecimals(-0.0001), -0.0);

  assert.equal(roundQty(10.5554), 10.555);
  assert.equal(roundQty(10.5556), 10.556);
  assert.equal(roundQty(1.0001), 1.0);
  console.log('✓ 1. اختبارات الدقة الحسابية للتقريب المالي (2 خانات) والكميات (3 خانات) اجتازت بنجاح');
}

// -----------------------------------------------------------------------------
// 2. اختبارات فرادة بنود الفواتير وحركات المخزون (Unique Flow Items)
// -----------------------------------------------------------------------------
{
  // أصناف مختلفة لنفس الوحدة
  ensureUniqueFlowItems(
    [
      { productId: 1, qty: 1, unitMultiplier: 1 },
      { productId: 2, qty: 1, unitMultiplier: 1 },
    ],
    'DUP',
    'dup',
  );

  // نفس الصنف لكن بوحدات مختلفة (مثلاً: قطعة وكرتونة) مسموح به
  ensureUniqueFlowItems(
    [
      { productId: 1, qty: 5, unitMultiplier: 1 },
      { productId: 1, qty: 1, unitMultiplier: 12 },
    ],
    'DUP',
    'dup',
  );

  // نفس الصنف ونفس الوحدة مكرر -> يجب الرفض فوراً
  expectAppError(
    () =>
      ensureUniqueFlowItems(
        [
          { productId: 1, qty: 1, unitMultiplier: 1 },
          { productId: 1, qty: 2, unitMultiplier: 1 },
        ],
        'DUPLICATE_ITEM',
        'Duplicate product detected',
      ),
    'DUPLICATE_ITEM',
  );

  // استخدام lineId يسمح بتكرار الصنف إذا كانت السطور مميزة ومعتمدة صراحة
  ensureUniqueFlowItems(
    [
      { productId: 1, qty: 1, lineId: 101 },
      { productId: 1, qty: 2, lineId: 102 },
    ],
    'DUP',
    'dup',
  );

  // تكرار نفس الـ lineId يجب رفضه
  expectAppError(
    () =>
      ensureUniqueFlowItems(
        [
          { productId: 1, qty: 1, lineId: 101 },
          { productId: 1, qty: 2, lineId: 101 },
        ],
        'DUPLICATE_LINE',
        'Duplicate lineId detected',
      ),
    'DUPLICATE_LINE',
  );
  console.log('✓ 2. اختبارات فرادة بنود العمليات وحظر التكرار العشوائي اجتازت بنجاح');
}

// -----------------------------------------------------------------------------
// 3. اختبارات حدود مرتجعات المبيعات والمشتريات (Return Limits & Bounds)
// -----------------------------------------------------------------------------
{
  // إرجاع كمية صالحة ضمن الرصيد
  ensureReturnQtyWithinLimit(1, 0, 5);
  ensureReturnQtyWithinLimit(2, 3, 5); // 2 + 3 = 5 (الحد الأقصى تماماً)

  // إرجاع كمية صفرية أو سالبة -> مرفوض
  expectAppError(() => ensureReturnQtyWithinLimit(0, 0, 5), 'RETURN_QTY_INVALID');
  expectAppError(() => ensureReturnQtyWithinLimit(-1, 0, 5), 'RETURN_QTY_INVALID');

  // تجاوز الكمية المتبقية
  expectAppError(() => ensureReturnQtyWithinLimit(5.001, 0, 5), 'RETURN_QTY_EXCEEDED');
  expectAppError(() => ensureReturnQtyWithinLimit(2.1, 3, 5), 'RETURN_QTY_EXCEEDED');

  console.log('✓ 3. اختبارات حراسة كميات المرتجع ومنع تجاوز الأصل أو الكميات السالبة اجتازت بنجاح');
}

// -----------------------------------------------------------------------------
// 4. اختبارات سلامة سداد الفواتير وطرق الدفع (Sale Payments Invariants)
// -----------------------------------------------------------------------------
{
  // بيع آجل (Credit) بدون دفعات نقدية -> سليم
  const creditResult = validateSalePayments({
    paymentType: 'credit',
    collectibleTotal: 500,
    payments: [],
  });
  assert.equal(creditResult.paidAmount, 0);

  // بيع آجل مع سداد فوري بالخطأ -> مرفوض
  expectAppError(
    () =>
      validateSalePayments({
        paymentType: 'credit',
        collectibleTotal: 500,
        payments: [{ paymentChannel: 'cash', amount: 100 }],
      }),
    'CREDIT_PAYMENTS_NOT_ALLOWED',
  );

  // بيع نقدي بمدفوع كامل
  const cashResult = validateSalePayments({
    paymentType: 'cash',
    collectibleTotal: 150.75,
    payments: [{ paymentChannel: 'cash', amount: 150.75 }],
  });
  assert.equal(cashResult.paidAmount, 150.75);

  // بيع نقدي بطرق دفع متعددة (Split Tender: كاش + فيزا)
  const splitResult = validateSalePayments({
    paymentType: 'cash',
    collectibleTotal: 300,
    payments: [
      { paymentChannel: 'cash', amount: 100 },
      { paymentChannel: 'card', amount: 200 },
    ],
  });
  assert.equal(splitResult.paidAmount, 300);

  // بيع نقدي بمدفوع غير كافٍ -> مرفوض
  expectAppError(
    () =>
      validateSalePayments({
        paymentType: 'cash',
        collectibleTotal: 100,
        payments: [{ paymentChannel: 'cash', amount: 99.95 }],
      }),
    'PAYMENT_AMOUNT_INSUFFICIENT',
  );

  // بيع نقدي يحتوي على دفعة صفرية أو سالبة -> مرفوض
  expectAppError(
    () =>
      validateSalePayments({
        paymentType: 'cash',
        collectibleTotal: 100,
        payments: [
          { paymentChannel: 'cash', amount: 100 },
          { paymentChannel: 'card', amount: 0 },
        ],
      }),
    'PAYMENT_AMOUNT_INVALID',
  );

  expectAppError(
    () =>
      validateSalePayments({
        paymentType: 'cash',
        collectibleTotal: 100,
        payments: [{ paymentChannel: 'cash', amount: -50 }],
      }),
    'PAYMENT_AMOUNT_INVALID',
  );

  console.log('✓ 4. اختبارات التحقق من تسديدات الفواتير وتعدد قنوات الدفع اجتازت بنجاح');
}

// -----------------------------------------------------------------------------
// 5. اختبارات حظر المخزون السالب (Non-Negative Stock Guard)
// -----------------------------------------------------------------------------
{
  ensureNonNegativeStock(0);
  ensureNonNegativeStock(0.001);
  ensureNonNegativeStock(150);

  expectAppError(() => ensureNonNegativeStock(-0.001), 'INSUFFICIENT_STOCK');
  expectAppError(() => ensureNonNegativeStock(-10), 'INSUFFICIENT_STOCK');

  console.log('✓ 5. اختبارات حظر المخزون السالب وحماية الأرصدة اجتازت بنجاح');
}

// -----------------------------------------------------------------------------
// 6. اختبارات ترتيب الأقفال القانوني لمنع الـ Deadlock (Canonical Lock Order)
// -----------------------------------------------------------------------------
{
  // ترتيب المعرفات تصاعدياً يمنع حدوث Deadlock في المعاملات المتزامنة
  const sorted1 = canonicalLockIds([99, 12, 45, 1, 88]);
  assert.deepEqual(sorted1, [1, 12, 45, 88, 99]);

  const sorted2 = canonicalLockIds([10, 5]);
  assert.deepEqual(sorted2, [5, 10]);

  // إزالة التكرارات مع الترتيب
  const sortedWithDups = canonicalLockIds([5, 10, 5, 2, 10]);
  assert.deepEqual(sortedWithDups, [2, 5, 10]);

  console.log('✓ 6. اختبارات ترتيب الأقفال القانوني (Canonical Lock Order) اجتازت بنجاح');
}

// -----------------------------------------------------------------------------
// 7. اختبارات توزيع الأقساط بدون انحراف سنتات (Zero Penny Drift Invariant)
// -----------------------------------------------------------------------------
{
  function computeInstallmentSchedule(total: number, count: number): number[] {
    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / count);
    const extraCents = totalCents % count;
    const schedule: number[] = [];
    for (let i = 1; i <= count; i++) {
      schedule.push((baseCents + (i <= extraCents ? 1 : 0)) / 100);
    }
    return schedule;
  }

  const cases = [
    { total: 100.0, count: 3 }, // 33.34, 33.33, 33.33 = 100.00
    { total: 1000.1, count: 7 },
    { total: 99.99, count: 12 },
    { total: 0.1, count: 3 },
  ];

  for (const c of cases) {
    const schedule = computeInstallmentSchedule(c.total, c.count);
    assert.equal(schedule.length, c.count);
    const sum = Number(schedule.reduce((acc, cur) => acc + cur, 0).toFixed(2));
    assert.equal(sum, c.total, `Penny drift detected for total ${c.total}: sum is ${sum}`);
  }

  console.log('✓ 7. اختبارات التوزيع الدقيق للأقساط دون فقدان أو انحراف أي سنت اجتازت بنجاح');
}

console.log('\n=============================================================================');
console.log('  كافة اختبارات الثوابت المالية والحسابية المعززة (Financial Integrity) اجتازت 100%');
console.log('=============================================================================\n');
