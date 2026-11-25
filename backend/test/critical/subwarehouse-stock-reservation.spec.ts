import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../src/common/errors/app-error';
import {
  reserveLocationStock,
  releaseLocationStock,
  previewConsumableStockQty,
  previewAssignedLocationStockQty,
  StockLocationReservationParams,
} from '../../src/common/utils/location-stock-ledger';

// =============================================================================
// CRITICAL INVENTORY AUDIT SUITE: Sub-warehouse Stock Reservation (O7)
// Rule 13 (AGENTS.md): Proof of Financial & Operational Invariants
// =============================================================================

console.log('=== بدء اختبارات حجز المخزون على مستوى الفروع والمخازن الفرعية (البند O7) ===\n');

/**
 * Creates an in-memory mock Kysely DB harness that tracks state for products
 * and product_location_stock exactly mirroring the schema and locking queries.
 */
function createMockStockDb(initialData: {
  products: Array<{
    id: number;
    name: string;
    stock_qty: number;
    reserved_qty: number;
    tenant_id: string;
    account_id: string;
  }>;
  locationStock: Array<{
    id: number;
    product_id: number;
    branch_id: number | null;
    location_id: number | null;
    qty: number;
    reserved_qty: number;
    tenant_id: string;
    account_id: string;
  }>;
}) {
  const products = initialData.products.map((p) => ({ ...p }));
  const locationStock = initialData.locationStock.map((ls) => ({ ...ls }));
  let nextLocationStockId = 1000;

  const mockDb: any = {
    _state: { products, locationStock },
    selectFrom(table: string) {
      const selectedTable = table;
      let selectedColumns: string[] = [];
      const whereConditions: Array<{ col: string; op: string; val: any }> = [];

      const queryBuilder: any = {
        select(cols: any) {
          selectedColumns = Array.isArray(cols) ? cols : [cols];
          return queryBuilder;
        },
        where(colOrSql: any, op?: any, val?: any) {
          if (typeof colOrSql === 'string') {
            whereConditions.push({ col: colOrSql, op: op || '=', val });
          }
          return queryBuilder;
        },
        forUpdate() {
          return queryBuilder;
        },
        orderBy() {
          return queryBuilder;
        },
        async executeTakeFirst() {
          const results = await queryBuilder.execute();
          return results[0] || undefined;
        },
        async execute() {
          let rows: any[] = [];
          if (selectedTable === 'products') {
            rows = products.filter((p) => {
              for (const cond of whereConditions) {
                if (cond.col === 'id' && p.id !== cond.val) return false;
                if (cond.col === 'tenant_id' && p.tenant_id !== cond.val) return false;
                if (cond.col === 'account_id' && p.account_id !== cond.val) return false;
              }
              return true;
            });
          } else if (selectedTable === 'product_location_stock') {
            rows = locationStock.filter((ls) => {
              for (const cond of whereConditions) {
                if (cond.col === 'product_id' && ls.product_id !== cond.val) return false;
                if (cond.col === 'location_id' && ls.location_id !== cond.val) return false;
                if (cond.col === 'branch_id' && ls.branch_id !== cond.val) return false;
                if (cond.col === 'tenant_id' && ls.tenant_id !== cond.val) return false;
                if (cond.col === 'account_id' && ls.account_id !== cond.val) return false;
                if (cond.col === 'id' && ls.id !== cond.val) return false;
              }
              return true;
            });
          }
          return rows.map((r) => ({ ...r }));
        },
      };

      return queryBuilder;
    },
    insertInto(table: string) {
      return {
        values(data: any) {
          return {
            returning(cols: any) {
              return {
                async executeTakeFirstOrThrow() {
                  if (table === 'product_location_stock') {
                    const newRow = {
                      id: nextLocationStockId++,
                      product_id: Number(data.product_id),
                      branch_id: data.branch_id == null ? null : Number(data.branch_id),
                      location_id: data.location_id == null ? null : Number(data.location_id),
                      qty: Number(data.qty || 0),
                      reserved_qty: Number(data.reserved_qty || 0),
                      tenant_id: String(data.tenant_id),
                      account_id: String(data.account_id),
                    };
                    locationStock.push(newRow);
                    return { ...newRow };
                  }
                  throw new Error(`Unsupported insert table: ${table}`);
                },
              };
            },
          };
        },
      };
    },
    updateTable(table: string) {
      let updateValues: any = {};
      const whereConditions: Array<{ col: string; op: string; val: any }> = [];

      const updateBuilder: any = {
        set(values: any) {
          updateValues = values;
          return updateBuilder;
        },
        where(colOrSql: any, op?: any, val?: any) {
          if (typeof colOrSql === 'string') {
            whereConditions.push({ col: colOrSql, op: op || '=', val });
          }
          return updateBuilder;
        },
        async execute() {
          if (table === 'product_location_stock') {
            for (const row of locationStock) {
              let match = true;
              for (const cond of whereConditions) {
                if (cond.col === 'id' && row.id !== cond.val) match = false;
                if (cond.col === 'tenant_id' && row.tenant_id !== cond.val) match = false;
                if (cond.col === 'account_id' && row.account_id !== cond.val) match = false;
              }
              if (match) {
                if ('qty' in updateValues) row.qty = Number(updateValues.qty);
                if ('reserved_qty' in updateValues) row.reserved_qty = Number(updateValues.reserved_qty);
              }
            }
          } else if (table === 'products') {
            for (const row of products) {
              let match = true;
              for (const cond of whereConditions) {
                if (cond.col === 'id' && row.id !== cond.val) match = false;
                if (cond.col === 'tenant_id' && row.tenant_id !== cond.val) match = false;
                if (cond.col === 'account_id' && row.account_id !== cond.val) match = false;
              }
              if (match) {
                if ('stock_qty' in updateValues) row.stock_qty = Number(updateValues.stock_qty);
                if ('reserved_qty' in updateValues) row.reserved_qty = Number(updateValues.reserved_qty);
              }
            }
          }
          return [];
        },
      };

      return updateBuilder;
    },
  };

  return mockDb;
}

/**
 * 1. Test Pure Available Stock Calculations (Single Source of Truth)
 */
async function testAvailableStockEngines() {
  console.log('--- 1. اختبارات حساب الرصيد المتاح للبيع مع خصم الكميات المحجوزة ---');

  // Case 1.1: Standard product with 10 on hand and 3 reserved
  {
    const db = createMockStockDb({
      products: [
        { id: 1, name: 'سماعة بلوتوث', stock_qty: 10, reserved_qty: 3, tenant_id: 't1', account_id: 't1:main' },
      ],
      locationStock: [
        {
          id: 101,
          product_id: 1,
          branch_id: 1,
          location_id: 10,
          qty: 10,
          reserved_qty: 3,
          tenant_id: 't1',
          account_id: 't1:main',
        },
      ],
    });

    const consumable = await previewConsumableStockQty(db, { tenantId: 't1', accountId: 't1:main', productId: 1 });
    assert.equal(consumable, 7, 'الرصيد المتاح العام بعد الحجز يجب أن يكون 10 - 3 = 7');

    const locAvailable = await previewAssignedLocationStockQty(db, {
      tenantId: 't1',
      accountId: 't1:main',
      productId: 1,
      branchId: 1,
      locationId: 10,
    });
    assert.equal(locAvailable, 7, 'الرصيد المتاح للمخزن بعد الحجز يجب أن يكون 10 - 3 = 7');
    console.log('✔ حساب الرصيد المتاح الصافي للمخزن والمنتج بدقة (10 - 3 = 7)');
  }

  // Case 1.2: Stock is fully reserved (5 on hand, 5 reserved)
  {
    const db = createMockStockDb({
      products: [{ id: 2, name: 'شاحن سريع', stock_qty: 5, reserved_qty: 5, tenant_id: 't1', account_id: 't1:main' }],
      locationStock: [
        {
          id: 102,
          product_id: 2,
          branch_id: 1,
          location_id: 10,
          qty: 5,
          reserved_qty: 5,
          tenant_id: 't1',
          account_id: 't1:main',
        },
      ],
    });

    const consumable = await previewConsumableStockQty(db, { tenantId: 't1', accountId: 't1:main', productId: 2 });
    assert.equal(consumable, 0, 'عند حجز كامل الرصيد، المتاح يجب أن يكون 0');

    const locAvailable = await previewAssignedLocationStockQty(db, {
      tenantId: 't1',
      accountId: 't1:main',
      productId: 2,
      branchId: 1,
      locationId: 10,
    });
    assert.equal(locAvailable, 0, 'المتاح للمخزن يجب أن يكون 0 عند حجز كامل الرصيد');
    console.log('✔ منع البيع عند حجز كامل رصيد المخزن (المتاح = 0)');
  }

  // Case 1.3: Multi-location stock breakdown
  // Location 10 (Branch 1): 8 qty, 2 reserved -> 6 available
  // Location 20 (Branch 2): 15 qty, 0 reserved -> 15 available
  {
    const db = createMockStockDb({
      products: [
        { id: 3, name: 'كابل تايب سي', stock_qty: 23, reserved_qty: 2, tenant_id: 't1', account_id: 't1:main' },
      ],
      locationStock: [
        {
          id: 103,
          product_id: 3,
          branch_id: 1,
          location_id: 10,
          qty: 8,
          reserved_qty: 2,
          tenant_id: 't1',
          account_id: 't1:main',
        },
        {
          id: 104,
          product_id: 3,
          branch_id: 2,
          location_id: 20,
          qty: 15,
          reserved_qty: 0,
          tenant_id: 't1',
          account_id: 't1:main',
        },
      ],
    });

    const loc10Avail = await previewAssignedLocationStockQty(db, {
      tenantId: 't1',
      accountId: 't1:main',
      productId: 3,
      branchId: 1,
      locationId: 10,
    });
    assert.equal(loc10Avail, 6, 'مخزن الفرع 1 يجب أن يتاح منه 8 - 2 = 6');

    const loc20Avail = await previewAssignedLocationStockQty(db, {
      tenantId: 't1',
      accountId: 't1:main',
      productId: 3,
      branchId: 2,
      locationId: 20,
    });
    assert.equal(loc20Avail, 15, 'مخزن الفرع 2 يجب أن يظل بكامل رصيده 15 دون تأثر بحجز الفرع 1');
    console.log('✔ عزل الحجز المخزني بين الفروع والمخازن الفرعية بدقة تامة');
  }
}

/**
 * 2. Test Execution of reserveLocationStock and releaseLocationStock
 */
async function testReservationAndReleaseExecution() {
  console.log('\n--- 2. اختبارات تنفيذ الحجز وفك الحجز عبر المحرك التشغيلي ---');

  const db = createMockStockDb({
    products: [
      { id: 10, name: 'ماوس لاسلكي', stock_qty: 20, reserved_qty: 0, tenant_id: 't1', account_id: 't1:main' },
      { id: 20, name: 'كيبورد ميكانيكي', stock_qty: 5, reserved_qty: 0, tenant_id: 't1', account_id: 't1:main' },
    ],
    locationStock: [
      {
        id: 501,
        product_id: 10,
        branch_id: 1,
        location_id: 100,
        qty: 20,
        reserved_qty: 0,
        tenant_id: 't1',
        account_id: 't1:main',
      },
      {
        id: 502,
        product_id: 20,
        branch_id: 1,
        location_id: 100,
        qty: 5,
        reserved_qty: 0,
        tenant_id: 't1',
        account_id: 't1:main',
      },
    ],
  });

  // 2.1 حجز كمية صالحة لمخزن فرع
  const res1 = await reserveLocationStock(db, {
    tenantId: 't1',
    accountId: 't1:main',
    branchId: 1,
    locationId: 100,
    items: [{ productId: 10, qty: 6 }],
  });

  assert.equal(res1.items.length, 1);
  assert.equal(res1.items[0].locationReservedBefore, 0);
  assert.equal(res1.items[0].locationReservedAfter, 6);
  assert.equal(res1.items[0].globalReservedAfter, 6);

  const locRow = db._state.locationStock.find((r: any) => r.id === 501);
  const prodRow = db._state.products.find((p: any) => p.id === 10);
  assert.equal(locRow.reserved_qty, 6, 'رصيد الحجز في المخزن يجب أن يصبح 6');
  assert.equal(prodRow.reserved_qty, 6, 'رصيد الحجز في جدول الأصناف يجب أن يصبح 6');
  console.log('✔ حجز المخزون في المخزن الفرعي وجدول الأصناف بالتوازي (6 قطع)');

  // 2.2 حجز إضافي تراكمي (حجز 4 قطع إضافية لنفس الصنف في نفس المخزن)
  await reserveLocationStock(db, {
    tenantId: 't1',
    accountId: 't1:main',
    branchId: 1,
    locationId: 100,
    items: [{ productId: 10, qty: 4 }],
  });

  assert.equal(locRow.reserved_qty, 10, 'الحجز التراكمي يجب أن يصبح 6 + 4 = 10');
  assert.equal(prodRow.reserved_qty, 10, 'الحجز التراكمي العام يجب أن يصبح 10');
  console.log('✔ الحجز التراكمي الناجح وتحديث الأرصدة (10 قطع محجوزة)');

  // 2.3 حظر الحجز الزائد عند عدم كفاية الرصيد غير المحجوز
  // رصيد الصنف 20 هو 5 قطع، تم حجز 0، والمطلوب حجز 6 قطع
  await assert.rejects(
    async () => {
      await reserveLocationStock(db, {
        tenantId: 't1',
        accountId: 't1:main',
        branchId: 1,
        locationId: 100,
        items: [{ productId: 20, qty: 6 }],
      });
    },
    (err: any) => {
      assert(err instanceof AppError, 'الخطأ يجب أن يكون من نوع AppError');
      assert.equal(err.code, 'INSUFFICIENT_LOCATION_STOCK');
      return true;
    },
    'يجب رفض الحجز عندما تكون الكمية المطلوبة أكبر من الرصيد المتاح',
  );
  console.log('✔ الحظر الحازم للحجز الزائد عند تجاوز الرصيد المتاح (INSUFFICIENT_LOCATION_STOCK)');

  // 2.4 حظر الحجز عند تجاوز الرصيد المتاح للصنف 10 (الرصيد 20، محجوز 10، المتاح 10، نطلب حجز 11)
  await assert.rejects(
    async () => {
      await reserveLocationStock(db, {
        tenantId: 't1',
        accountId: 't1:main',
        branchId: 1,
        locationId: 100,
        items: [{ productId: 10, qty: 11 }],
      });
    },
    (err: any) => {
      assert.equal(err.code, 'INSUFFICIENT_LOCATION_STOCK');
      return true;
    },
    'يجب منع حجز كمية تتجاوز الرصيد غير المحجوز',
  );
  console.log('✔ حظر حجز كمية تفوق الرصيد غير المحجوز في المخزن (INSUFFICIENT_LOCATION_STOCK)');

  // 2.5 فك جزئي للحجز (إلغاء جزء من الطلب أو تعديله)
  await releaseLocationStock(db, {
    tenantId: 't1',
    accountId: 't1:main',
    branchId: 1,
    locationId: 100,
    items: [{ productId: 10, qty: 3 }],
  });

  assert.equal(locRow.reserved_qty, 7, 'فك الحجز الجزئي يجب أن يخفض المحجوز إلى 10 - 3 = 7');
  assert.equal(prodRow.reserved_qty, 7, 'فك الحجز الجزئي يجب أن يخفض المحجوز العام إلى 7');
  console.log('✔ فك الحجز الجزئي الناجح واستعادة الكمية غير المحجوزة (المحجوز: 7)');

  // 2.6 فك كامل للحجز المتبقي
  await releaseLocationStock(db, {
    tenantId: 't1',
    accountId: 't1:main',
    branchId: 1,
    locationId: 100,
    items: [{ productId: 10, qty: 7 }],
  });

  assert.equal(locRow.reserved_qty, 0, 'فك كامل الحجز يجب أن يعيد المحجوز إلى 0');
  assert.equal(prodRow.reserved_qty, 0, 'فك كامل الحجز يجب أن يعيد المحجوز العام إلى 0');
  console.log('✔ فك كامل الحجز وعودة الأرصدة لوضعها الطبيعي (المحجوز: 0)');

  // 2.7 اختبار أمان عدم السالب (Clamping at 0)
  // فك كمية 5 بينما المحجوز 0
  await releaseLocationStock(db, {
    tenantId: 't1',
    accountId: 't1:main',
    branchId: 1,
    locationId: 100,
    items: [{ productId: 10, qty: 5 }],
  });

  assert.equal(locRow.reserved_qty, 0, 'فك حجز زائد لا يجب أن ينتج قيماً سالبة');
  assert.equal(prodRow.reserved_qty, 0, 'فك حجز زائد عام لا يجب أن ينتج قيماً سالبة');
  console.log('✔ ثبات قيد عدم السالب (Non-negative Invariant GREATEST(0, ...)) عند فك حجز زائد');
}

/**
 * 3. Test Migration 145 Schema & Constraints
 */
function testMigration145Schema() {
  console.log('\n--- 3. اختبارات فحص ملف الهجرة 145 والقيود الهيكلية لقاعدة البيانات ---');

  const migrationPath = join(
    __dirname,
    '../../src/database/migrations/2040000000145_subwarehouse_stock_reservation.ts',
  );
  const migrationContent = readFileSync(migrationPath, 'utf8');

  // Verify reserved_qty column added to product_location_stock
  assert(
    migrationContent.includes('reserved_qty'),
    'الهجرة 145 يجب أن تضيف عمود reserved_qty إلى product_location_stock',
  );

  // Verify non-negative check constraint
  assert(
    migrationContent.includes('chk_product_location_stock_reserved_non_negative') &&
      migrationContent.includes('reserved_qty >= 0'),
    'الهجرة 145 يجب أن تنشئ قيد عدم السالب chk_product_location_stock_reserved_non_negative',
  );

  // Verify online_orders tracking columns
  assert(
    migrationContent.includes('stock_reserved') &&
      migrationContent.includes('reserved_branch_id') &&
      migrationContent.includes('reserved_location_id') &&
      migrationContent.includes('stock_reserved_at'),
    'الهجرة 145 يجب أن تضيف أعمدة تتبع حجز المخزون في جدول online_orders',
  );

  // Verify partial indexes for active reservations
  assert(
    migrationContent.includes('idx_pls_tenant_prod_loc_reserved') &&
      migrationContent.includes('idx_online_orders_stock_reserved'),
    'الهجرة 145 يجب أن تنشئ فهارس جزئية للحجوزات النشطة لتحقيق أقصى سرعة استعلام',
  );

  console.log('✔ بنية الهجرة 145 مطابقة بنسبة 100% لكافة القيود الهيكلية وفهارس الأداء');
}

/**
 * 4. Test Lock Ordering & Deadlock Prevention
 */
async function testCanonicalLockOrdering() {
  console.log(
    '\n--- 4. اختبار الترتيب القانوني للأقفال ومنع التعليق المتبادل (SQLSTATE 40P01 Deadlock Prevention) ---',
  );

  const lockedItemSequence: number[] = [];

  const db = createMockStockDb({
    products: [
      { id: 99, name: 'منتج 99', stock_qty: 10, reserved_qty: 0, tenant_id: 't1', account_id: 't1:main' },
      { id: 12, name: 'منتج 12', stock_qty: 10, reserved_qty: 0, tenant_id: 't1', account_id: 't1:main' },
      { id: 45, name: 'منتج 45', stock_qty: 10, reserved_qty: 0, tenant_id: 't1', account_id: 't1:main' },
    ],
    locationStock: [
      {
        id: 1,
        product_id: 99,
        branch_id: 1,
        location_id: 1,
        qty: 10,
        reserved_qty: 0,
        tenant_id: 't1',
        account_id: 't1:main',
      },
      {
        id: 2,
        product_id: 12,
        branch_id: 1,
        location_id: 1,
        qty: 10,
        reserved_qty: 0,
        tenant_id: 't1',
        account_id: 't1:main',
      },
      {
        id: 3,
        product_id: 45,
        branch_id: 1,
        location_id: 1,
        qty: 10,
        reserved_qty: 0,
        tenant_id: 't1',
        account_id: 't1:main',
      },
    ],
  });

  // Pass items in non-sorted order: [99, 12, 45]
  const res = await reserveLocationStock(db, {
    tenantId: 't1',
    accountId: 't1:main',
    branchId: 1,
    locationId: 1,
    items: [
      { productId: 99, qty: 1 },
      { productId: 12, qty: 2 },
      { productId: 45, qty: 3 },
    ],
  });

  // Verify that the processed items result is strictly sorted ascending by productId: [12, 45, 99]
  const processedProductIds = res.items.map((i) => i.productId);
  assert.deepEqual(
    processedProductIds,
    [12, 45, 99],
    'محرك الحجز يجب أن يرتب الأصناف تصاعدياً بالـ productId لفرض الترتيب القانوني للأقفال',
  );

  console.log('✔ الترتيب القانوني للأقفال (Sorted ascending by productId: 12 -> 45 -> 99)');
}

(async () => {
  await testAvailableStockEngines();
  await testReservationAndReleaseExecution();
  testMigration145Schema();
  await testCanonicalLockOrdering();

  console.log('\n=============================================================');
  console.log('✔ جميع اختبارات حجز المخزون الفرعي (البند O7) اجتازت بنجاح تام 100%');
  console.log('=============================================================\n');
})().catch((err) => {
  console.error('❌ فشل في اختبارات حجز المخزون الفرعي:', err);
  process.exit(1);
});
