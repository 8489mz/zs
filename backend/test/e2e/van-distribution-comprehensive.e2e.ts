import 'dotenv/config';
import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../../src/database/database.types';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import type { AuditService } from '../../src/core/audit/audit.service';
import type { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';

/**
 * Comprehensive End-to-End Test Suite for Wholesale & Van Distribution
 *
 * Validates the full enterprise route-to-market lifecycle:
 * 1. Morning dispatch and van stock allocation.
 * 2. Multi-UOM sales conversions (carton multiplier deducted as base pieces).
 * 3. Free Goods / Bonus items (0.00 price, base units deducted from van).
 * 4. Customer credit limit evaluation + Supervisor PIN override.
 * 5. Field customer debt collection.
 * 6. Returnable packaging & empties ledger (crates delivered vs returned).
 * 7. Field trip operational expenses (fuel & tolls).
 * 8. Trip closing, physical cash count reconciliation with expense deduction.
 * 9. Double-entry general ledger posting and remaining stock return to warehouse.
 */

const TENANT = '__van_distribution_complete_e2e__';
const ACCOUNT = 'e2e-van-distribution';

async function cleanup(db: Kysely<Database>): Promise<void> {
  const dbAny = db as any;
  const tables = [
    'journal_entry_lines',
    'journal_entries',
    'accounting_posting_failures',
    'customer_ledger',
    'customer_payments',
    'van_field_visits',
    'sale_items',
    'sales',
    'van_trip_expenses',
    'van_trip_packaging_movements',
    'van_sales_trips',
    'stock_movements',
    'product_location_stock',
    'customers',
    'products',
    'delivery_representatives',
    'stock_locations',
    'accounting_settings',
    'accounting_accounts',
    'users',
    'branches',
  ];
  for (const table of tables) {
    if (table === 'journal_entry_lines') {
      await sql`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = ${TENANT})`.execute(db);
      continue;
    }
    await dbAny.deleteFrom(table).where('tenant_id', '=', TENANT).execute();
  }
}

async function runVanDistributionCompleteSuite(): Promise<void> {
  const pool = new Pool({
    host: process.env.TEST_DB_HOST || '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT || 5433),
    user: process.env.TEST_DB_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || 'postgres',
    database: process.env.TEST_DB_NAME || 'zs_dev',
    application_name: 'backend-e2e-van-distribution',
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const dbAny = db as any;

  await cleanup(db);

  try {
    process.stdout.write('\n====================================================================\n');
    process.stdout.write(' [E2E] بدء اختبار دورة مبيعات الجملة والفان المتكاملة\n');
    process.stdout.write('====================================================================\n');

    // --- 1. Fixtures -----------------------------------------------------------------------
    const branch = await dbAny
      .insertInto('branches')
      .values({ name: `Van Branch ${Date.now()}`, tenant_id: TENANT, account_id: ACCOUNT, is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const warehouse = await dbAny
      .insertInto('stock_locations')
      .values({ name: 'Central Distribution Warehouse', branch_id: branch.id, location_type: 'internal_warehouse', is_active: true, tenant_id: TENANT, account_id: ACCOUNT })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Supervisor user with PIN
    const supervisor = await dbAny
      .insertInto('users')
      .values({
        username: `supervisor-${Date.now()}`,
        display_name: 'أحمد كمال (مشرف التوزيع)',
        password_hash: 'x',
        password_salt: 'x',
        pin: '1234',
        role: 'admin',
        permissions_json: JSON.stringify(['deliveryReps', 'sales']),
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id', 'display_name as name'])
      .executeTakeFirstOrThrow();

    const rep = await dbAny
      .insertInto('delivery_representatives')
      .values({ tenant_id: TENANT, account_id: ACCOUNT, name: 'محمود المندوب', phone: '01011122334', is_active: true })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Product 1: Juice Box (Base unit piece, Carton = 12 pieces). Cost: 10 EGP, Retail: 20 EGP
    const productJuice = await dbAny
      .insertInto('products')
      .values({
        name: 'عصير برتقال طبيعي 1 لتر',
        cost_price: 10,
        retail_price: 20,
        wholesale_price: 18,
        stock_qty: 120,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Product 2: Rice Bag (5 kg). Cost: 25 EGP, Retail: 40 EGP
    const productRice = await dbAny
      .insertInto('products')
      .values({
        name: 'أرز فاخر درجة أولى 5 كجم',
        cost_price: 25,
        retail_price: 40,
        wholesale_price: 38,
        stock_qty: 50,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        is_active: true,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await dbAny
      .insertInto('product_location_stock')
      .values([
        { product_id: productJuice.id, location_id: warehouse.id, branch_id: branch.id, qty: 120, tenant_id: TENANT, account_id: ACCOUNT },
        { product_id: productRice.id, location_id: warehouse.id, branch_id: branch.id, qty: 50, tenant_id: TENANT, account_id: ACCOUNT },
      ])
      .execute();

    // Customer A: Wholesale customer with initial debt 500 EGP, credit limit 600 EGP
    const customerA = await dbAny
      .insertInto('customers')
      .values({
        name: 'سوبرماركت التوحيد (جملة)',
        balance: 500,
        credit_limit: 600,
        is_credit_blocked: false,
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id', 'balance'])
      .executeTakeFirstOrThrow();

    // Customer B: Retail cash customer
    const customerB = await dbAny
      .insertInto('customers')
      .values({
        name: 'بقالة الحمد (قطاعي)',
        balance: 0,
        credit_limit: 0,
        is_credit_blocked: false,
        is_active: true,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Services
    const foundation = new AccountingTenantFoundationService();
    const accountingPosting = new AccountingPostingService(foundation);
    const vanSales = new VanSalesService(
      db,
      {} as AuditService,
      {} as DeliveryRepsService,
      accountingPosting,
    );

    const repId = Number(rep.id);

    // --- STEP 1: Open Trip & Load Van ------------------------------------------------------
    process.stdout.write('  1. تحميل بضاعة الصباح لسيارة الفان:\n');
    const loadResult = await vanSales.openTripAndLoad(repId, TENANT, ACCOUNT, {
      sourceWarehouseId: Number(warehouse.id),
      items: [
        { productId: Number(productJuice.id), qty: 60 }, // 60 pieces = 5 cartons
        { productId: Number(productRice.id), qty: 20 },  // 20 bags
      ],
    });
    assert.equal(loadResult.ok, true);
    // Value: 60 * 20 + 20 * 40 = 1200 + 800 = 2000
    assert.equal(loadResult.totalLoadedValue, 2000);

    const warehouseJuice = await dbAny
      .selectFrom('product_location_stock')
      .select(['qty'])
      .where('product_id', '=', productJuice.id)
      .where('location_id', '=', warehouse.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(warehouseJuice.qty), 60, 'Warehouse juice decreased from 120 to 60');

    process.stdout.write(`     ✓ تم فتح الرحلة #${loadResult.tripId} وتحميل بضاعة بقيمة 2,000 ج.م\n`);

    // --- STEP 2: Multi-UOM & Free Bonus Sale (Cash) -----------------------------------------
    process.stdout.write('  2. بيع بوحدة مجمعة (كرتونة = 12 قطعة) + بونص مجاني عينة ترويجية:\n');
    // Sell 2 cartons of Juice (multiplier 12 -> 24 base pieces) + 1 piece BONUS (price 0)
    const sale1 = await vanSales.executeFieldSale(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      customerId: Number(customerB.id),
      paymentMethod: 'cash',
      supervisorOverridePin: '1234',
      items: [
        {
          productId: Number(productJuice.id),
          qty: 2,
          unitPrice: 240, // 2 cartons * 240 = 480
          unitName: 'كرتونة 12 عبوة',
          unitMultiplier: 12,
        },
        {
          productId: Number(productJuice.id),
          qty: 1,
          unitPrice: 0,
          isBonus: true,
          bonusReason: 'بونص ترويجي افتتاح صنف جديد',
          unitName: 'قطعة',
          unitMultiplier: 1,
        },
      ],
    });

    assert.equal(sale1.ok, true);
    assert.equal(sale1.total, 480);

    // Verify 24 + 1 = 25 base units deducted from van stock: 60 - 25 = 35 pieces left
    const vanLocation = await vanSales.getOrCreateVanLocation(repId, TENANT, ACCOUNT);
    const vanJuiceStock = await dbAny
      .selectFrom('product_location_stock')
      .select(['qty'])
      .where('product_id', '=', productJuice.id)
      .where('location_id', '=', vanLocation.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(vanJuiceStock.qty), 35, 'Van stock: 60 - (2*12 + 1) = 35 pieces remaining');

    // Verify sale_items records contain multi-UOM and bonus tags
    const sale1Items = (await dbAny.selectFrom('sale_items').selectAll().where('sale_id', '=', sale1.saleId).execute()) as any[];
    assert.equal(sale1Items.length, 2);
    const bonusItem = sale1Items.find((it) => it.is_bonus === true);
    assert.ok(bonusItem, 'Bonus line item exists');
    assert.equal(Number(bonusItem?.line_total), 0);
    assert.equal(bonusItem?.bonus_reason, 'بونص ترويجي افتتاح صنف جديد');

    const regularCartonItem = sale1Items.find((it) => it.is_bonus === false);
    assert.equal(Number(regularCartonItem?.unit_multiplier), 12);
    assert.equal(regularCartonItem?.unit_name, 'كرتونة 12 عبوة');
    assert.equal(Number(regularCartonItem?.line_total), 480);

    process.stdout.write(`     ✓ تم بيع 2 كرتونة + 1 عبوة بونص مجاني، وخصمت 25 عبوة من رصيد السيارة\n`);

    // --- STEP 3: Credit Sale with Supervisor PIN Override -----------------------------------
    process.stdout.write('  3. بيع آجل مع تجاوز سقف الائتمان واعتماد رمز المشرف (PIN):\n');
    // Customer A has balance 500, credit limit 600.
    // Try to buy 10 bags of rice on credit = 10 * 40 = 400 EGP.
    // Projected balance = 900 EGP > 600 EGP (Exceeded by 300 EGP).

    // Attempt A: Without supervisor PIN -> Must be REJECTED!
    await assert.rejects(
      async () => {
        await vanSales.executeFieldSale(repId, TENANT, ACCOUNT, {
          tripId: loadResult.tripId,
          customerId: Number(customerA.id),
          paymentMethod: 'credit',
          items: [{ productId: Number(productRice.id), qty: 10 }],
        });
      },
      /سقف الائتمان|CREDIT_LIMIT_REJECTED/i,
      'Sale without supervisor PIN must be rejected when credit limit is exceeded',
    );
    process.stdout.write('     ✓ تم حظر البيع الآجل تلقائياً لتجاوز سقف الائتمان بدون PIN المشرف\n');

    // Attempt B: With WRONG supervisor PIN -> Must be REJECTED!
    await assert.rejects(
      async () => {
        await vanSales.executeFieldSale(repId, TENANT, ACCOUNT, {
          tripId: loadResult.tripId,
          customerId: Number(customerA.id),
          paymentMethod: 'credit',
          items: [{ productId: Number(productRice.id), qty: 10 }],
          supervisorOverridePin: '9999',
          supervisorOverrideReason: 'محاولة خاطئة',
        });
      },
      /رمز اعتماد المشرف|INVALID_SUPERVISOR_PIN/i,
      'Sale with incorrect supervisor PIN must be rejected',
    );
    process.stdout.write('     ✓ تم رفض رمز المشرف غير الصحيح (9999)\n');

    // Attempt C: With VALID supervisor PIN ('1234') -> Must SUCCEED!
    const sale2 = await vanSales.executeFieldSale(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      customerId: Number(customerA.id),
      paymentMethod: 'credit',
      items: [{ productId: Number(productRice.id), qty: 10 }],
      supervisorOverridePin: '1234',
      supervisorOverrideReason: 'موافقة استثنائية لعميل استراتيجي معتمد من الإدارة',
    });
    assert.equal(sale2.ok, true);
    assert.equal(sale2.total, 400);

    // Verify audit columns on sales row
    const sale2Row = await dbAny
      .selectFrom('sales')
      .select(['is_credit_overridden', 'credit_override_by_user_id', 'credit_override_reason'])
      .where('id', '=', sale2.saleId)
      .executeTakeFirstOrThrow();
    assert.equal(sale2Row.is_credit_overridden, true);
    assert.equal(Number(sale2Row.credit_override_by_user_id), Number(supervisor.id));
    assert.equal(sale2Row.credit_override_reason, 'موافقة استثنائية لعميل استراتيجي معتمد من الإدارة');

    // Customer A balance: 500 + 400 = 900
    const custAAfterSale = await db.selectFrom('customers').select(['balance']).where('id', '=', customerA.id).executeTakeFirstOrThrow();
    assert.equal(Number(custAAfterSale.balance), 900);

    process.stdout.write('     ✓ تم اعتماد البيع الآجل بنجاح بواسطة PIN المشرف وسجلت بيانات التدقيق\n');

    // --- STEP 4: Field Customer Debt Collection --------------------------------------------
    process.stdout.write('  4. تحصيل نقدي ميداني من مديونية العميل:\n');
    const collection = await vanSales.recordFieldCollection(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      customerId: Number(customerA.id),
      amount: 300,
    });
    assert.equal(collection.newBalance, 600, '900 minus 300 collected = 600 EGP balance');

    const tripAfterCol = await dbAny.selectFrom('van_sales_trips').select(['cash_collected']).where('id', '=', loadResult.tripId).executeTakeFirstOrThrow();
    // Cash collected = 480 (cash sale) + 300 (collection) = 780 EGP
    assert.equal(Number(tripAfterCol.cash_collected), 780);
    process.stdout.write('     ✓ تم تحصيل 300 ج.م وأصبح إجمالي الكاش في عهدة المندوب 780 ج.م\n');

    // --- STEP 5: Returnable Packaging & Empties Ledger ------------------------------------
    process.stdout.write('  5. حركة ذمة الفوارغ والصناديق والبالتات المستردة:\n');
    // Movement 1: 10 plastic crates delivered, 4 returned for Customer A
    const pkg1 = await vanSales.recordPackagingMovement(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      customerId: Number(customerA.id),
      packageType: 'crate_plastic',
      deliveredQty: 10,
      returnedQty: 4,
      notes: 'تسليم 10 أقفاص بلاستيك واسترجاع 4 فارغ',
    });
    assert.equal(pkg1.ok, true);

    const tripPackaging = await vanSales.getTripPackagingMovements(loadResult.tripId, TENANT);
    assert.equal(tripPackaging.length, 1);
    assert.equal(tripPackaging[0]?.deliveredQty, 10);
    assert.equal(tripPackaging[0]?.returnedQty, 4);
    assert.equal(tripPackaging[0]?.netBalance, 6);

    const custPackaging = await vanSales.getCustomerPackagingBalance(Number(customerA.id), TENANT);
    assert.equal(custPackaging.length, 1);
    assert.equal(custPackaging[0]?.netOwedToCompany, 6, 'Customer owes 6 plastic crates to company');
    process.stdout.write('     ✓ تم تسجيل حركة الفوارغ وصافي ذمة العميل = 6 صناديق في ذمته\n');

    // --- STEP 6: Field Trip Operational Expenses -------------------------------------------
    process.stdout.write('  6. تسجيل مصروفات تشغيلية ميدانية للرحلة (وقود وكارتات):\n');
    const exp1 = await vanSales.recordTripExpense(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      expenseType: 'fuel',
      amount: 150,
      notes: 'تفويل سولار من محطة وطنية',
    });
    assert.equal(exp1.ok, true);
    assert.equal(exp1.totalTripExpenses, 150);

    const exp2 = await vanSales.recordTripExpense(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      expenseType: 'toll',
      amount: 30,
      notes: 'كارتة وبوابة طريق',
    });
    assert.equal(exp2.ok, true);
    assert.equal(exp2.totalTripExpenses, 180);

    const allExpenses = await vanSales.getTripExpenses(loadResult.tripId, TENANT);
    assert.equal(allExpenses.expenses.length, 2);
    assert.equal(allExpenses.totalExpenses, 180);
    process.stdout.write('     ✓ تم تسجيل 180 ج.م مصروفات تشغيل (وقود 150 + كارتة 30)\n');

    // --- STEP 7: Van Settlement with Expense Deduction & General Ledger Balance ------------
    process.stdout.write('  7. تصفية الرحلة وتوريد الكاش مع خصم المصروفات وترحيل القيود:\n');
    // Gross Cash Collected = 780 EGP
    // Total Trip Expenses = 180 EGP
    // Net Expected Cash = 780 - 180 = 600 EGP!
    // Hand over exactly 600 EGP:
    const settlement = await vanSales.settleTrip(repId, TENANT, ACCOUNT, {
      tripId: loadResult.tripId,
      countedCash: 600,
      countedStock: [
        { productId: Number(productJuice.id), countedQty: 35 },
        { productId: Number(productRice.id), countedQty: 10 },
      ],
      unloadRemainingToWarehouse: true,
      notes: 'تصفية اليوم وإرجاع المتبقي للمستودع',
    });

    assert.equal(settlement.ok, true);
    assert.equal(settlement.expectedCash, 600, 'Expected cash deducted trip expenses: 780 - 180 = 600');
    assert.equal(settlement.countedCash, 600);
    assert.equal(settlement.tripExpenses, 180);
    assert.equal(settlement.variance, 0, 'Variance is exactly 0.00');

    // Stock check after unload to warehouse:
    // Product 1: 35 pieces returned to warehouse: 60 + 35 = 95 pieces in warehouse
    const warehouseJuiceAfter = await dbAny
      .selectFrom('product_location_stock')
      .select(['qty'])
      .where('product_id', '=', productJuice.id)
      .where('location_id', '=', warehouse.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(warehouseJuiceAfter.qty), 95);

    // Product 2: 10 bags returned to warehouse: 30 + 10 = 40 bags in warehouse
    const warehouseRiceAfter = await dbAny
      .selectFrom('product_location_stock')
      .select(['qty'])
      .where('product_id', '=', productRice.id)
      .where('location_id', '=', warehouse.id)
      .executeTakeFirstOrThrow();
    assert.equal(Number(warehouseRiceAfter.qty), 40);

    // Van stock completely empty (0)
    const vanJuiceFinal = await dbAny.selectFrom('product_location_stock').select(['qty']).where('product_id', '=', productJuice.id).where('location_id', '=', vanLocation.id).executeTakeFirstOrThrow();
    assert.equal(Number(vanJuiceFinal.qty), 0);

    // Verify Settlement Journal Entry:
    // Debit Cash (Account 1110): 600
    // Debit Delivery/Fuel Expense (Account 6400): 180
    // Credit Driver Custody Receivable (Account 1130): 780
    const setJournal = await db
      .selectFrom('journal_entries')
      .selectAll()
      .where('source_type', '=', 'van_trip_settlement')
      .where('source_id', '=', loadResult.tripId)
      .executeTakeFirstOrThrow();

    const setLines = await db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', setJournal.id).execute();
    const setDebit = setLines.reduce((s, l) => s + Number(l.debit), 0);
    const setCredit = setLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.ok(Math.abs(setDebit - setCredit) < 0.01, 'Settlement journal MUST balance');
    assert.equal(setDebit, 780);
    assert.equal(setCredit, 780);

    const expenseLine = setLines.find((l) => Number(l.debit) === 180);
    assert.ok(expenseLine, 'Operational expense line is debited for 180 EGP');
    assert.match(expenseLine.description, /مصروفات تشغيلية ووقود/);

    const cashLine = setLines.find((l) => Number(l.debit) === 600);
    assert.ok(cashLine, 'Cash line is debited for 600 EGP');

    const receivableLine = setLines.find((l) => Number(l.credit) === 780);
    assert.ok(receivableLine, 'Driver custody receivable line is credited for 780 EGP');

    // --- STEP 8: Whole-Tenant Ledgers Zero-Discrepancy Sanity -----------------------------
    const allLines = await db
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .select(['jel.debit', 'jel.credit'])
      .where('je.tenant_id', '=', TENANT)
      .execute();

    const grandDebit = allLines.reduce((s, l) => s + Number(l.debit), 0);
    const grandCredit = allLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.ok(Math.abs(grandDebit - grandCredit) < 0.01, `All journal entries across tenant must balance (debit=${grandDebit}, credit=${grandCredit})`);

    process.stdout.write(`     ✓ قيد التسوية المحاسبي متزن بالمليم: مدين ${setDebit} ج.م = دائن ${setCredit} ج.م\n`);
    process.stdout.write(`     ✓ كافة قيود اليومية للشركة متزنة بالكامل: مدين ${grandDebit} = دائن ${grandCredit}\n`);

    process.stdout.write('  تهانينا! نجحت دورة مبيعات الجملة والفان الكاملة بنسبة 100% دون أي خطأ\n');
    process.stdout.write('====================================================================\n\n');
  } finally {
    await cleanup(db);
    await pool.end();
  }
}

runVanDistributionCompleteSuite().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`Van distribution complete suite failed:\n${msg}\n`);
  process.exit(1);
});
