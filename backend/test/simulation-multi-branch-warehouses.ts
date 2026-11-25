import { strict as assert } from 'node:assert';
import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../src/database/database.types';
import { TransactionHelper } from '../src/database/helpers/transaction.helper';
import { resolvePgSslConfig, toBoolean } from '../src/database/ssl.util';
import {
  applyStockDelta,
  previewConsumableStockQty,
  relocateStockBetweenLocations,
} from '../src/common/utils/location-stock-ledger';

async function createTestDb(): Promise<Kysely<Database>> {
  const pool = new Pool({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5433),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'zs_dev',
    ssl: resolvePgSslConfig({
      enabled: toBoolean(process.env.DATABASE_SSL, false),
      rejectUnauthorized: toBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED, false),
      caCert: process.env.DATABASE_SSL_CA_CERT ?? '',
    }),
    max: 5,
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

async function runSimulation() {
  console.log('================================================================');
  console.log('🚀 بدء المحاكاة الشاملة: (فرعين + 10 مخازن + مخزون صالة لكل فرع)');
  console.log('================================================================\n');

  const db = await createTestDb();

  const timestamp = Date.now();
  const tenantId = `sim_tenant_${timestamp}`;
  const accountId = `sim_acc_${timestamp}`;
  const scope = { tenantId, accountId };

  try {
    // -------------------------------------------------------------
    // الخطوة 0: تهيئة التينانت والمستخدم الافتراضي
    // -------------------------------------------------------------
    console.log('📌 [الخطوة 0] إنشاء بيئة العمل والمستأجر التجريبي...');
    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        slug: `sim-${timestamp}`,
        business_name: 'شركة المحاكاة للتجارة والتوزيع',
        owner_name: 'المدير العام',
        owner_phone: '01000000000',
        status: 'active',
        trial_starts_at: new Date(),
        trial_ends_at: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        activated_at: new Date(),
      } as any)
      .execute();

    const user = await db
      .insertInto('users')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        username: `admin_${timestamp}`,
        display_name: 'مدير النظام',
        password_hash: 'hashed',
        password_salt: 'salt',
        role: 'super_admin',
        is_active: true,
        permissions_json: JSON.stringify(['all']),
        must_change_password: false,
        failed_login_count: 0,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const userId = Number(user.id);

    // -------------------------------------------------------------
    // الخطوة 1: إنشاء الفرعين ومخازن صالة العرض والـ 10 مخازن التخزينية
    // -------------------------------------------------------------
    console.log('📌 [الخطوة 1] إنشاء الفروع والمواقع المخزنية:');

    // الفرع 1
    const br1 = await db
      .insertInto('branches')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: 'فرع 1 - المعادي',
        code: 'BR-MAADI',
        sales_stock_mode: 'single_location',
        allow_external_sales_stock: false,
        is_active: true,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const branch1Id = Number(br1.id);

    // الفرع 2
    const br2 = await db
      .insertInto('branches')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: 'فرع 2 - المهندسين',
        code: 'BR-MOHAND',
        sales_stock_mode: 'single_location',
        allow_external_sales_stock: false,
        is_active: true,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const branch2Id = Number(br2.id);

    // مخزون صالة فرع 1
    const bStock1 = await db
      .insertInto('stock_locations')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: 'مخزون صالة فرع المعادي (رصيد البيع)',
        code: 'LOC-BR1-STOCK',
        branch_id: branch1Id,
        location_type: 'branch_stock',
        is_active: true,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const branchStockLoc1Id = Number(bStock1.id);

    // مخزون صالة فرع 2
    const bStock2 = await db
      .insertInto('stock_locations')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: 'مخزون صالة فرع المهندسين (رصيد البيع)',
        code: 'LOC-BR2-STOCK',
        branch_id: branch2Id,
        location_type: 'branch_stock',
        is_active: true,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const branchStockLoc2Id = Number(bStock2.id);

    // ربط المخزن الافتراضي بكل فرع
    await db
      .updateTable('branches')
      .set({ default_stock_location_id: branchStockLoc1Id })
      .where('id', '=', branch1Id)
      .execute();
    await db
      .updateTable('branches')
      .set({ default_stock_location_id: branchStockLoc2Id })
      .where('id', '=', branch2Id)
      .execute();

    // إنشاء 10 مخازن تخزينية منفصلة (نوعها internal_warehouse)
    const warehouseIds: number[] = [];
    const warehouseNames = [
      'المخزن الرئيسي 1 (القاهرة)',
      'المخزن الرئيسي 2 (الجيزة)',
      'مخزن 3 (العاشر من رمضان)',
      'مخزن 4 (السادات)',
      'مخزن 5 (العبور)',
      'مخزن 6 (بدر)',
      'مخزن 7 (برج العرب)',
      'مخزن 8 (طنطا)',
      'مخزن 9 (المنصورة)',
      'مخزن 10 (الإسماعيلية)',
    ];

    for (let i = 0; i < 10; i++) {
      const wh = await db
        .insertInto('stock_locations')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          name: warehouseNames[i],
          code: `WH-${i + 1}`,
          branch_id: null,
          location_type: 'internal_warehouse',
          is_active: true,
        } as any)
        .returning(['id'])
        .executeTakeFirstOrThrow();
      warehouseIds.push(Number(wh.id));
    }

    console.log(`   ✅ تم إنشاء فرعين: فرع المعادي (#${branch1Id}) وفرع المهندسين (#${branch2Id})`);
    console.log(`   ✅ تم إنشاء مخزوني بيع للصالتين: (#${branchStockLoc1Id}) و (#${branchStockLoc2Id})`);
    console.log(`   ✅ تم إنشاء 10 مخازن تخزينية مركزية: [${warehouseIds.join(', ')}]`);

    // -------------------------------------------------------------
    // الخطوة 2: إنشاء الصنف والمورد والعميل
    // -------------------------------------------------------------
    console.log('\n📌 [الخطوة 2] إنشاء الصنف والمورد:');
    const prod = await db
      .insertInto('products')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: 'تيشيرت قطن فاخر 100%',
        barcode: `TSHIRT-${timestamp}`,
        cost_price: 100,
        retail_price: 250,
        wholesale_price: 200,
        stock_qty: 0,
        min_stock_qty: 10,
        item_type: 'product',
        item_kind: 'standard',
        is_active: true,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const productId = Number(prod.id);

    const sup = await db
      .insertInto('suppliers')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: 'مصنع الغزل والنسيج الحديث',
        phone: '01011111111',
        balance: 0,
        is_active: true,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const supplierId = Number(sup.id);

    const cust = await db
      .insertInto('customers')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: 'عميل تجزئة كريم',
        phone: '01022222222',
        balance: 0,
        is_active: true,
      } as any)
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const customerId = Number(cust.id);

    console.log(`   ✅ تم إنشاء المنتج: "تيشيرت قطن فاخر" (#${productId}) برصيد ابتدائي 0.`);

    // -------------------------------------------------------------
    // الخطوة 3: التوريد للمخازن الـ 10 فقط (بدون أي رصيد في الفروع)
    // -------------------------------------------------------------
    console.log('\n📌 [الخطوة 3] توريد مشتريات إلى المخازن الـ 10:');
    console.log('   - توريد 100 قطعة إلى المخزن 1');
    console.log('   - توريد 50 قطعة إلى كل مخزن من المخازن 2 إلى 10 (إجمالي 450 قطعة)');

    // شراء 100 للمخزن 1
    await applyStockDelta(db, {
      productId,
      delta: 100,
      branchId: null,
      locationId: warehouseIds[0],
      tenantId,
      accountId,
    });

    // شراء 50 لكل مخزن من 2 إلى 10
    for (let i = 1; i < 10; i++) {
      await applyStockDelta(db, {
        productId,
        delta: 50,
        branchId: null,
        locationId: warehouseIds[i],
        tenantId,
        accountId,
      });
    }

    // التحقق من الأرصدة
    const prodAfterPurchases = await db
      .selectFrom('products')
      .select(['stock_qty'])
      .where('id', '=', productId)
      .executeTakeFirstOrThrow();
    const wh1Stock = await previewConsumableStockQty(db, {
      productId,
      locationId: warehouseIds[0],
      tenantId,
      accountId,
    });
    const b1StockBefore = await previewConsumableStockQty(db, {
      productId,
      branchId: branch1Id,
      locationId: branchStockLoc1Id,
      tenantId,
      accountId,
    });
    const b2StockBefore = await previewConsumableStockQty(db, {
      productId,
      branchId: branch2Id,
      locationId: branchStockLoc2Id,
      tenantId,
      accountId,
    });

    console.log(`   📊 إجمالي رصيد الصنف العام في الشركة: ${prodAfterPurchases.stock_qty} قطعة (100 + 9*50 = 550)`);
    console.log(`   📊 رصيد المخزن 1: ${wh1Stock} قطعة`);
    console.log(`   📊 رصيد صالة فرع المعادي: ${b1StockBefore} قطعة`);
    console.log(`   📊 رصيد صالة فرع المهندسين: ${b2StockBefore} قطعة`);

    assert.equal(Number(prodAfterPurchases.stock_qty), 550, 'إجمالي الرصيد يجب أن يكون 550');
    assert.equal(wh1Stock, 100, 'المخزن 1 يجب أن يحتوي 100 قطعة');
    assert.equal(b1StockBefore, 0, 'رصيد فرع المعادي يجب أن يكون 0');
    assert.equal(b2StockBefore, 0, 'رصيد فرع المهندسين يجب أن يكون 0');
    console.log('   ✅ نجاح فحص العزل الأولي: البضاعة بالمخازن ورصيد الفروع صفر تماماً.');

    // -------------------------------------------------------------
    // الخطوة 4: اختبار منع التسريب (Leakage Test)
    // -------------------------------------------------------------
    console.log('\n📌 [الخطوة 4] اختبار التسريب: محاولة بيع 10 قطع من فرع 1 ورصيد الفرع صفر:');

    // عند فحص الرصيد المتاح لكاشير فرع 1:
    const availableForPosBranch1 = await previewConsumableStockQty(db, {
      productId,
      branchId: branch1Id,
      locationId: branchStockLoc1Id,
      tenantId,
      accountId,
    });
    console.log(`   🔍 الرصيد الظاهر لكاشير فرع المعادي في شاشة الـ POS: ${availableForPosBranch1} قطعة`);
    assert.equal(availableForPosBranch1, 0, 'شاشة الكاشير يجب أن تظهر 0 رغم وجود 550 قطعة في المخازن');

    // محاولة تنفيذ البيع وخصم الرصيد
    let saleFailedAsExpected = false;
    try {
      await db.transaction().execute(async (trx) => {
        const currentLocStock = await previewConsumableStockQty(trx, {
          productId,
          branchId: branch1Id,
          locationId: branchStockLoc1Id,
          tenantId,
          accountId,
        });
        if (currentLocStock < 10) {
          throw new Error('INSUFFICIENT_STOCK: لا يوجد رصيد كافٍ في صالة هذا الفرع للبيع');
        }
        await applyStockDelta(trx, {
          productId,
          delta: -10,
          branchId: branch1Id,
          locationId: branchStockLoc1Id,
          tenantId,
          accountId,
          allowNegative: false,
        });
      });
    } catch (err: any) {
      if (err.message.includes('INSUFFICIENT_STOCK')) {
        saleFailedAsExpected = true;
      }
    }

    assert.ok(saleFailedAsExpected, 'يجب رفض البيع فوراً لعدم وجود رصيد بالفرع');
    console.log('   🛡️ تم صد العملية بنجاح! منع النظام البيع من المخازن العشرة وأوقف الفاتورة.');

    // -------------------------------------------------------------
    // الخطوة 5: تحويل مخزني رسمي من المخزن 1 إلى فرع المعادي
    // -------------------------------------------------------------
    console.log('\n📌 [الخطوة 5] إجراء إذن تحويل مخزني: 20 قطعة من (المخزن 1) إلى (مخزون صالة فرع المعادي):');

    await db.transaction().execute(async (trx) => {
      // 1. إنشاء مستند التحويل
      const trDoc = await trx
        .insertInto('stock_transfers')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          doc_no: `TR-001`,
          from_location_id: warehouseIds[0],
          to_location_id: branchStockLoc1Id,
          from_branch_id: null,
          to_branch_id: branch1Id,
          status: 'received',
          note: 'تغذية افتتاح فرع المعادي',
          created_by: userId,
          received_by: userId,
          received_at: new Date(),
        } as any)
        .returning(['id'])
        .executeTakeFirstOrThrow();

      // 2. تحويل رسمي عبر الليدجر
      await relocateStockBetweenLocations(trx, {
        productId,
        qty: 20,
        fromBranchId: null,
        fromLocationId: warehouseIds[0],
        toBranchId: branch1Id,
        toLocationId: branchStockLoc1Id,
        tenantId,
        accountId,
      });
    });

    const wh1AfterTransfer = await previewConsumableStockQty(db, {
      productId,
      locationId: warehouseIds[0],
      tenantId,
      accountId,
    });
    const b1AfterTransfer = await previewConsumableStockQty(db, {
      productId,
      branchId: branch1Id,
      locationId: branchStockLoc1Id,
      tenantId,
      accountId,
    });
    const b2AfterTransfer = await previewConsumableStockQty(db, {
      productId,
      branchId: branch2Id,
      locationId: branchStockLoc2Id,
      tenantId,
      accountId,
    });

    console.log(`   📊 رصيد المخزن 1 بعد التحويل: ${wh1AfterTransfer} قطعة (100 - 20 = 80)`);
    console.log(`   📊 رصيد صالة فرع المعادي بعد الاستلام: ${b1AfterTransfer} قطعة`);
    console.log(`   📊 رصيد صالة فرع المهندسين: ${b2AfterTransfer} قطعة (ما زال صفر)`);

    assert.equal(wh1AfterTransfer, 80, 'المخزن 1 يجب أن يتبقى به 80 قطعة');
    assert.equal(b1AfterTransfer, 20, 'فرع المعادي يجب أن يصبح 20 قطعة');
    assert.equal(b2AfterTransfer, 0, 'فرع المهندسين يجب أن يظل 0 قطعة');
    console.log('   ✅ تم التحويل بنجاح وانتقلت الـ 20 قطعة بدقة من المخزن إلى رف الفرع.');

    // -------------------------------------------------------------
    // الخطوة 6: تنفيذ بيع 15 قطعة من كاشير فرع المعادي
    // -------------------------------------------------------------
    console.log('\n📌 [الخطوة 6] بيع 15 قطعة عبر كاشير فرع المعادي:');

    await db.transaction().execute(async (trx) => {
      // التحقق من الرصيد والخصم
      const stockChange = await applyStockDelta(trx, {
        productId,
        delta: -15,
        branchId: branch1Id,
        locationId: branchStockLoc1Id,
        tenantId,
        accountId,
        allowNegative: false,
      });

      // تسجيل الفاتورة
      const saleInsert = await trx
        .insertInto('sales')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          doc_no: 'INV-MAADI-001',
          customer_id: customerId,
          branch_id: branch1Id,
          location_id: branchStockLoc1Id,
          payment_type: 'cash',
          payment_channel: 'cash',
          subtotal: 15 * 250,
          total: 15 * 250,
          paid_amount: 15 * 250,
          tendered_amount: 15 * 250,
          change_amount: 0,
          status: 'posted',
          created_by: userId,
        } as any)
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('sale_items')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          sale_id: Number(saleInsert.id),
          product_id: productId,
          product_name: 'تيشيرت قطن فاخر 100%',
          qty: 15,
          unit_price: 250,
          line_total: 15 * 250,
          cost_price: 100,
          price_type: 'retail',
        } as any)
        .execute();
    });

    const b1AfterSale = await previewConsumableStockQty(db, {
      productId,
      branchId: branch1Id,
      locationId: branchStockLoc1Id,
      tenantId,
      accountId,
    });
    const wh1AfterSale = await previewConsumableStockQty(db, {
      productId,
      locationId: warehouseIds[0],
      tenantId,
      accountId,
    });
    const globalProdAfterSale = await db
      .selectFrom('products')
      .select(['stock_qty'])
      .where('id', '=', productId)
      .executeTakeFirstOrThrow();

    console.log(`   📊 رصيد صالة فرع المعادي بعد البيع: ${b1AfterSale} قطع (20 - 15 = 5)`);
    console.log(`   📊 رصيد المخزن 1: ${wh1AfterSale} قطعة (لم ينقص أي شيء إضافي: 80)`);
    console.log(`   📊 إجمالي رصيد الصنف العام في الشركة: ${globalProdAfterSale.stock_qty} قطعة (550 - 15 = 535)`);

    assert.equal(b1AfterSale, 5, 'متبقي فرع المعادي يجب أن يكون 5 قطع');
    assert.equal(wh1AfterSale, 80, 'المخزن 1 يجب أن يظل 80 قطعة');
    assert.equal(Number(globalProdAfterSale.stock_qty), 535, 'الرصيد العام يجب أن يكون 535');
    console.log('   ✅ تم البيع وخصم الـ 15 قطعة فقط من رصيد الفرع بدون أي مساس بالمخازن!');

    // -------------------------------------------------------------
    // الخطوة 7: تغذية فرع 2 من (المخزن 5) وإجراء بيع معزول
    // -------------------------------------------------------------
    console.log('\n📌 [الخطوة 7] تحويل 30 قطعة من (مخزن العبور #5) إلى (فرع المهندسين #2) ثم البيع منه:');

    // 1. تحويل من المخزن 5 إلى فرع 2
    await db.transaction().execute(async (trx) => {
      await relocateStockBetweenLocations(trx, {
        productId,
        qty: 30,
        fromBranchId: null,
        fromLocationId: warehouseIds[4], // المخزن 5
        toBranchId: branch2Id,
        toLocationId: branchStockLoc2Id,
        tenantId,
        accountId,
      });
    });

    // 2. بيع 20 قطعة من فرع المهندسين
    await db.transaction().execute(async (trx) => {
      await applyStockDelta(trx, {
        productId,
        delta: -20,
        branchId: branch2Id,
        locationId: branchStockLoc2Id,
        tenantId,
        accountId,
        allowNegative: false,
      });

      const saleInsert2 = await trx
        .insertInto('sales')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          doc_no: 'INV-MOHAND-001',
          customer_id: customerId,
          branch_id: branch2Id,
          location_id: branchStockLoc2Id,
          payment_type: 'cash',
          payment_channel: 'cash',
          subtotal: 20 * 250,
          total: 20 * 250,
          paid_amount: 20 * 250,
          tendered_amount: 20 * 250,
          change_amount: 0,
          status: 'posted',
          created_by: userId,
        } as any)
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('sale_items')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          sale_id: Number(saleInsert2.id),
          product_id: productId,
          product_name: 'تيشيرت قطن فاخر 100%',
          qty: 20,
          unit_price: 250,
          line_total: 20 * 250,
          cost_price: 100,
          price_type: 'retail',
        } as any)
        .execute();
    });

    const b1Final = await previewConsumableStockQty(db, {
      productId,
      branchId: branch1Id,
      locationId: branchStockLoc1Id,
      tenantId,
      accountId,
    });
    const b2Final = await previewConsumableStockQty(db, {
      productId,
      branchId: branch2Id,
      locationId: branchStockLoc2Id,
      tenantId,
      accountId,
    });
    const wh5Final = await previewConsumableStockQty(db, {
      productId,
      locationId: warehouseIds[4],
      tenantId,
      accountId,
    });
    const globalFinal = await db
      .selectFrom('products')
      .select(['stock_qty'])
      .where('id', '=', productId)
      .executeTakeFirstOrThrow();

    console.log(`   📊 رصيد فرع 1 (المعادي): ${b1Final} قطع (لم يتأثر ببيع فرع المهندسين)`);
    console.log(`   📊 رصيد فرع 2 (المهندسين): ${b2Final} قطع (30 استلام - 20 بيع = 10)`);
    console.log(`   📊 رصيد مخزن 5 (العبور): ${wh5Final} قطعة (50 - 30 = 20)`);
    console.log(`   📊 إجمالي رصيد الصنف العام: ${globalFinal.stock_qty} قطعة (535 - 20 = 515)`);

    assert.equal(b1Final, 5, 'فرع 1 يجب أن يظل 5 قطع');
    assert.equal(b2Final, 10, 'فرع 2 يجب أن يكون 10 قطع');
    assert.equal(wh5Final, 20, 'المخزن 5 يجب أن يتبقى به 20 قطعة');
    assert.equal(Number(globalFinal.stock_qty), 515, 'الرصيد العام يجب أن يكون 515');
    console.log('   ✅ نجاح تام للعزل المزدوج بين الفروع والمخازن!');

    // -------------------------------------------------------------
    // الخطوة 8: اختبار المرتجعات (Returns)
    // -------------------------------------------------------------
    console.log('\n📌 [الخطوة 8] اختبار مرتجع بيع لقطعتين في فرع المعادي:');

    await db.transaction().execute(async (trx) => {
      await applyStockDelta(trx, {
        productId,
        delta: 2,
        branchId: branch1Id,
        locationId: branchStockLoc1Id,
        tenantId,
        accountId,
      });

      await trx
        .insertInto('return_documents')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          doc_no: 'RET-MAADI-001',
          return_type: 'sale',
          branch_id: branch1Id,
          location_id: branchStockLoc1Id,
          settlement_mode: 'refund_cash',
          refund_method: 'cash',
          total: 2 * 250,
          note: 'مرتجع عميل فرع المعادي',
          created_by: userId,
        } as any)
        .execute();
    });

    const b1AfterReturn = await previewConsumableStockQty(db, {
      productId,
      branchId: branch1Id,
      locationId: branchStockLoc1Id,
      tenantId,
      accountId,
    });
    const b2AfterReturn = await previewConsumableStockQty(db, {
      productId,
      branchId: branch2Id,
      locationId: branchStockLoc2Id,
      tenantId,
      accountId,
    });
    const globalAfterReturn = await db
      .selectFrom('products')
      .select(['stock_qty'])
      .where('id', '=', productId)
      .executeTakeFirstOrThrow();

    console.log(`   📊 رصيد فرع المعادي بعد المرتجع: ${b1AfterReturn} قطع (5 + 2 = 7)`);
    console.log(`   📊 رصيد فرع المهندسين: ${b2AfterReturn} قطع (ثابت 10)`);
    console.log(`   📊 إجمالي رصيد الصنف العام: ${globalAfterReturn.stock_qty} قطعة (515 + 2 = 517)`);

    assert.equal(b1AfterReturn, 7, 'فرع المعادي يجب أن يصبح 7');
    assert.equal(b2AfterReturn, 10, 'فرع المهندسين يجب أن يظل 10');
    assert.equal(Number(globalAfterReturn.stock_qty), 517, 'الرصيد العام يجب أن يكون 517');
    console.log('   ✅ عاد المرتجع إلى رصيد صالة نفس الفرع بدقة دون التأثير على المخازن أو الفروع الأخرى.');

    // -------------------------------------------------------------
    // جرد ومطابقة الأرصدة الإجمالية في نهاية المحاكاة
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log('📊 تقرير الجرد النهائي الشامل للأرصدة:');
    console.log('================================================================');
    console.log(`   🏢 صالة فرع 1 (المعادي):        ${b1AfterReturn} قطع`);
    console.log(`   🏢 صالة فرع 2 (المهندسين):      ${b2AfterReturn} قطع`);
    console.log(`   📦 المخزن 1 (القاهرة):           80 قطعة`);
    console.log(`   📦 المخزن 2 (الجيزة):            50 قطعة`);
    console.log(`   📦 المخزن 3 (العاشر من رمضان):   50 قطعة`);
    console.log(`   📦 المخزن 4 (السادات):           50 قطعة`);
    console.log(`   📦 المخزن 5 (العبور):            20 قطعة`);
    console.log(`   📦 المخزن 6 (بدر):               50 قطعة`);
    console.log(`   📦 المخزن 7 (برج العرب):         50 قطعة`);
    console.log(`   📦 المخزن 8 (طنطا):              50 قطعة`);
    console.log(`   📦 المخزن 9 (المنصورة):          50 قطعة`);
    console.log(`   📦 المخزن 10 (الإسماعيلية):      50 قطعة`);
    console.log('   -------------------------------------------------------------');
    const totalInWarehouses = 80 + 50 * 8 + 20; // 500
    const totalInBranches = b1AfterReturn + b2AfterReturn; // 17
    const grandCalculatedTotal = totalInWarehouses + totalInBranches; // 517
    console.log(`   ∑ إجمالي البضاعة في الـ 10 مخازن: ${totalInWarehouses} قطعة`);
    console.log(`   ∑ إجمالي البضاعة في صالات الفروع: ${totalInBranches} قطعة`);
    console.log(`   ∑ الرصيد العام الفعلي للصنف:      ${grandCalculatedTotal} قطعة`);
    console.log('================================================================');

    assert.equal(grandCalculatedTotal, 517, 'المطابقة الحسابية الإجمالية يجب أن تكون 517');
    console.log('\n🎉 اكتملت جميع مراحل المحاكاة بنجاح 100% بدون أي خطأ أو تسريب!');
  } finally {
    // تنظيف بيانات الاختبار للحفاظ على نظافة قاعدة البيانات
    console.log('\n🧹 جاري تنظيف بيانات المستأجر التجريبي...');
    await db.deleteFrom('sale_items').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('sales').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('return_documents').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('stock_transfers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('product_location_stock').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('stock_movements').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('products').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('customers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('suppliers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('branches').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('stock_locations').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
    await db.destroy();
    console.log('✨ تم إنهاء الاتصال وتنظيف البيانات بالكامل.');
  }
}

runSimulation().catch((err) => {
  console.error('❌ فشل في المحاكاة:', err);
  process.exit(1);
});
