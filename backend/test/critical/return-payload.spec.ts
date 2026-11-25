import { strict as assert } from 'node:assert';
import { AppError } from '../../src/common/errors/app-error';
import { normalizeReturnItems } from '../../src/modules/returns/helpers/return-payload.helper';

console.log('=== بدء اختبارات التحقق من بيانات حمولة المرتجعات (Return Payload Guards) ===\n');

function expectAppError(fn: () => void, code: string): void {
  try {
    fn();
    assert.fail(`Expected AppError(${code})`);
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal((error as AppError).code, code);
  }
}

// 1. فحص الحالة الإيجابية للمرتجعات المتعددة
const saleItems = normalizeReturnItems({
  type: 'sale',
  invoiceId: 1,
  items: [
    { productId: 1, qty: 1 },
    { productId: 2, qty: 2 },
  ],
});
assert.equal(saleItems.length, 2);
assert.equal(saleItems[0].productId, 1);
assert.equal(saleItems[1].productId, 2);
console.log('✓ 1. قبول بنود المرتجع المتعددة الصحيحة');

// 2. حظر تكرار الصنف لنفس سطر الفاتورة
expectAppError(
  () =>
    normalizeReturnItems({
      type: 'sale',
      invoiceId: 1,
      items: [
        { productId: 1, qty: 1, saleItemId: 1 },
        { productId: 1, qty: 1, saleItemId: 1 },
      ],
    }),
  'RETURN_DUPLICATE_PRODUCT',
);
console.log('✓ 2. حظر تكرار نفس الصنف في نفس سطر الفاتورة (RETURN_DUPLICATE_PRODUCT)');

// 3. السماح بنفس الصنف إذا كان مرتبطاً بأسطر مختلفة من الفاتورة الأصلية (Different Sale Line Items)
const saleItemsDupOk = normalizeReturnItems({
  type: 'sale',
  invoiceId: 1,
  items: [
    { productId: 1, qty: 1, saleItemId: 1 },
    { productId: 1, qty: 1, saleItemId: 2 },
  ],
});
assert.equal(saleItemsDupOk.length, 2);
console.log('✓ 3. السماح بنفس الصنف إذا كان من أسطر شراء أو بيع مختلفة (Distinct Line IDs)');

// 4. حظر تسوية مرتجع المشتريات كرصيد متجر (Store Credit خاص بالعملاء فقط وليس الموردين)
expectAppError(
  () =>
    normalizeReturnItems({
      type: 'purchase',
      invoiceId: 1,
      settlementMode: 'store_credit',
      items: [{ productId: 1, qty: 1 }],
    }),
  'PURCHASE_RETURN_SETTLEMENT_INVALID',
);
console.log('✓ 4. حظر تسوية مرتجع المشتريات كرصيد متجر (PURCHASE_RETURN_SETTLEMENT_INVALID)');

// 5. حظر قائمة بنود فارغة
expectAppError(
  () =>
    normalizeReturnItems({
      type: 'sale',
      invoiceId: 1,
      items: [],
    }),
  'RETURN_ITEMS_REQUIRED',
);

// 6. حظر بنود بكميات صفرية أو سالبة حصراً
expectAppError(
  () =>
    normalizeReturnItems({
      type: 'sale',
      invoiceId: 1,
      items: [
        { productId: 1, qty: 0 },
        { productId: 2, qty: -5 },
      ],
    }),
  'RETURN_ITEM_INVALID',
);
console.log('✓ 5. تصفية الكميات الصفرية والسالبة وحظر القوائم الخالية (RETURN_ITEM_INVALID)');

console.log('\n=============================================================================');
console.log('  كافة اختبارات حمولة المرتجعات (return-payload.spec) اجتازت 100%');
console.log('=============================================================================\n');
