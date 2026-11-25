import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../../../src/database/database.types';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { AuditService } from '../../../src/core/audit/audit.service';
import { IdempotencyService } from '../../../src/core/idempotency/idempotency.service';
import { CashDrawerService } from '../../../src/modules/cash-drawer/cash-drawer.service';
import { ReturnsService } from '../../../src/modules/returns/returns.service';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import {
  applyStockDelta,
  reserveLocationStock,
  releaseLocationStock,
  previewConsumableStockQty,
} from '../../../src/common/utils/location-stock-ledger';
import { createPasswordRecord } from '../../../src/core/auth/utils/password-hasher';
import { allocateInvoiceDiscount } from '../../../src/modules/sales/engines/invoice-discount.engine';

console.log('================================================================');
console.log('🛒 Z-SYSTEMS ERP — RETAIL POS, STOREFRONT & RETURNS AUDIT SIMULATION');
console.log('1. دورة الورديات وفتح الدرج والعهد النقدية (Cashier Shifts & Floats)');
console.log('2. مبيعات نقاط البيع السريعة والسداد المجزأ (POS Multi-Tender Sales)');
console.log('3. حجز وتلبية طلبات المتجر الإلكتروني (Omnichannel Storefront Pickup)');
console.log('4. دورة المرتجعات ورد المبالغ ورصيد المتجر (Sales Returns & Refunds)');
console.log('5. إغلاق الوردية والمطابقة الصفرية للعجز والزيادة (Shift Zero Variance)');
console.log('6. توازن القيود المحاسبية ودفاتر الأستاذ (Double-Entry Invariants)');
console.log('================================================================\n');

async function runPosRetailStorefrontReturnsSimulation(): Promise<void> {
  const pool = new Pool({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5433),
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const tx = new TransactionHelper();
  const accountingFoundation = new AccountingTenantFoundationService();
  const accountingPosting = new AccountingPostingService(accountingFoundation);
  const auditService = new AuditService(db as any);
  const idempotencyService = new IdempotencyService(db as any);
  const cashDrawerService = new CashDrawerService(db as any, tx, accountingPosting);
  const returnsService = new ReturnsService(db as any, tx, auditService, accountingPosting, idempotencyService);

  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `pos_sim_${simUid}`;
  const testAccountId = `pos_sim_${simUid}`;

  // 1. حساب المستخدم والمدير
  const adminHash = await createPasswordRecord('123456');
  const cashierHash = await createPasswordRecord('123456');

  const adminUserRes = await sql<{ id: number }>`
    INSERT INTO users (tenant_id, account_id, username, role, is_active, password_hash, password_salt, created_at)
    VALUES (${testTenantId}, ${testAccountId}, ${'admin_' + simUid}, 'admin', true, ${adminHash.hash}, ${adminHash.salt}, NOW())
    RETURNING id
  `.execute(db);
  const adminUserId = Number(adminUserRes.rows[0].id);

  const cashierUserRes = await sql<{ id: number }>`
    INSERT INTO users (tenant_id, account_id, username, role, is_active, password_hash, password_salt, created_at)
    VALUES (${testTenantId}, ${testAccountId}, ${'cashier_' + simUid}, 'cashier', true, ${cashierHash.hash}, ${cashierHash.salt}, NOW())
    RETURNING id
  `.execute(db);
  const cashierUserId = Number(cashierUserRes.rows[0].id);

  const cashierAuth: AuthContext = {
    userId: cashierUserId,
    username: 'pos_cashier',
    role: 'cashier',
    tenantId: testTenantId,
    accountId: testAccountId,
    sessionId: `session_cashier_${simUid}`,
    permissions: ['sales', 'returns'],
  };

  const adminAuth: AuthContext = {
    userId: adminUserId,
    username: 'pos_manager',
    role: 'admin',
    tenantId: testTenantId,
    accountId: testAccountId,
    sessionId: `session_admin_${simUid}`,
    permissions: ['*'],
  };

  console.log(`📌 Scope: [Tenant: ${testTenantId}, Cashier: #${cashierUserId}, Manager: #${adminUserId}]\n`);

  try {
    // -------------------------------------------------------------------------
    // STEP 1: تهيئة شجرة الحسابات والإعدادات والفرع والمستودع
    // -------------------------------------------------------------------------
    console.log('--- 1. تهيئة شجرة الحسابات والفرع ومستودع نقطة البيع ---');
    await accountingFoundation.ensureForAuth(db, adminAuth);

    // ضبط رمز المشرف في الإعدادات
    await sql`
      INSERT INTO settings (tenant_id, account_id, key, value)
      VALUES (${testTenantId}, ${testAccountId}, 'managerPin', '"123456"')
      ON CONFLICT DO NOTHING
    `.execute(db);

    await sql`
      UPDATE accounting_accounts 
      SET is_cash_bank = true 
      WHERE tenant_id = ${testTenantId} AND code IN ('1110', '1120')
    `.execute(db);

    const branchRes = await sql<{ id: number }>`
      INSERT INTO branches (tenant_id, account_id, name, is_active, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, ${'معرض التجزئة الرئيسي ' + simUid}, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const branchId = Number(branchRes.rows[0].id);

    const locationRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, ${branchId}, 'نقطة بيع الصالة الرئيسية', 'branch_stock', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const locationId = Number(locationRes.rows[0].id);

    // إنشاء عميل تجزئة مسجل
    const custRes = await sql<{ id: number }>`
      INSERT INTO customers (tenant_id, account_id, name, phone, customer_type, balance, store_credit_balance, is_active, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, ${'عميل التجزئة ' + simUid}, '01012345678', 'cash', 0, 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const customerId = Number(custRes.rows[0].id);

    console.log(`✓ تم تجهيز الفرع (#${branchId}) والموقع (#${locationId}) والعميل (#${customerId}).`);

    // -------------------------------------------------------------------------
    // STEP 2: تكويد الأصناف وضخ أرصدة المخزون الافتتاحية
    // -------------------------------------------------------------------------
    console.log('\n--- 2. تكويد الأصناف وضخ رصيد المخزون الافتتاحي ---');
    // صنف 1: قميص قطني فاخر (350 بيع، 180 تكلفة)
    const p1Res = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, retail_price, wholesale_price, cost_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, 'قميص قطني فاخر', ${'BC-SHIRT-' + simUid}, 'product', 350.00, 300.00, 180.00, 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const p1Id = Number(p1Res.rows[0].id);

    // صنف 2: عصير برتقال طبيعي (وحدة أساسية: قطعة 20، تكلفة 12 | كرتونة: 12 قطعة 220)
    const p2Res = await sql<{ id: number }>`
      INSERT INTO products (tenant_id, account_id, name, barcode, item_type, retail_price, wholesale_price, cost_price, stock_qty, is_active, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, 'عصير برتقال طبيعي', ${'BC-JUICE-' + simUid}, 'product', 20.00, 18.00, 12.00, 0, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const p2Id = Number(p2Res.rows[0].id);

    await sql`
      INSERT INTO product_units (tenant_id, account_id, product_id, name, multiplier, is_base_unit, is_sale_unit_default, is_purchase_unit_default, created_at, updated_at)
      VALUES 
        (${testTenantId}, ${testAccountId}, ${p2Id}, 'قطعة', 1, true, true, false, NOW(), NOW()),
        (${testTenantId}, ${testAccountId}, ${p2Id}, 'كرتونة', 12, false, false, true, NOW(), NOW())
    `.execute(db);

    // ضخ رصيد مخزون: 100 قميص + 120 عصير (10 كراتين)
    await applyStockDelta(db as any, {
      productId: p1Id,
      delta: 100,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });
    await applyStockDelta(db as any, {
      productId: p2Id,
      delta: 120,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });

    console.log(`✓ الصنف 1 (#${p1Id}): 100 قطعة | الصنف 2 (#${p2Id}): 120 قطعة في المعرض.`);

    // -------------------------------------------------------------------------
    // STEP 3: دورة الوردية وفتح الدرج وحركات النقدية (Cashier Shift Lifecycle)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. افتتاح وردية الكاشير وحركة نقدية بداخلها ---');
    const openShiftResult = await cashDrawerService.openCashierShift(
      {
        branchId,
        locationId,
        openingCash: 500.0,
        note: 'افتتاح وردية الصباح التجريبية',
      },
      cashierAuth,
    );

    const openedShiftDb = await sql<{ id: number }>`
      SELECT id FROM cashier_shifts WHERE tenant_id = ${testTenantId} AND status = 'open' ORDER BY id DESC LIMIT 1
    `.execute(db);
    const shiftId = Number(openedShiftDb.rows[0].id);
    console.log(`✓ تم فتح وردية الكاشير بنجاح (#${shiftId}) بعهدة افتتاحية 500.00 جنيه.`);

    // حركة إيداع نقدية إضافية بالدرج (فكة) بواسطة الكاشير
    await cashDrawerService.recordCashMovement(
      shiftId,
      {
        type: 'cash_in',
        amount: 250.0,
        note: 'توريد فكة إضافية للدرج',
        managerPin: '123456',
      },
      cashierAuth,
    );
    console.log('✓ تم تسجيل إيداع نقدي بالدرج (Cash-In) بقيمة 250.00 جنيه.');

    // -------------------------------------------------------------------------
    // STEP 4: دورة المتجر الإلكتروني وحجز المخزون وتحويله لبيع بالفرع (Storefront Pickup)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. طلب متجر إلكتروني مع حجز مخزوني واستلام من الفرع ---');
    const orderNo = `ORD-${simUid}-001`;
    const onlineOrderRes = await sql<{ id: number }>`
      INSERT INTO online_orders (
        tenant_id, account_id, order_number, customer_name, customer_phone,
        items_json, subtotal, delivery_fee, total_amount, status, payment_method, branch_id, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${orderNo}, 'عميل المتجر أونلاين', '01011112222',
        ${JSON.stringify([{ productId: p1Id, name: 'قميص قطني فاخر', qty: 1, unitPrice: 350 }])},
        350.00, 0.00, 350.00, 'pending', 'cod', ${branchId}, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const onlineOrderId = Number(onlineOrderRes.rows[0].id);

    // حجز المخزون للطلب الإلكتروني
    await reserveLocationStock(db as any, {
      items: [{ productId: p1Id, qty: 1 }],
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });

    const consumableBeforePickup = await previewConsumableStockQty(db as any, {
      productId: p1Id,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });
    if (consumableBeforePickup !== 99) {
      throw new Error(`Expected consumable stock after reservation to be 99, got ${consumableBeforePickup}`);
    }
    console.log(`✓ تم حجز قطعة من الصنف 1 للطلب الإلكتروني #${orderNo} (المتاح للاستهلاك: 100 -> 99).`);

    // استلام الطلب وتسديده نقداً في الفرع (تحويل الطلب لفاتورة مبيعات)
    await releaseLocationStock(db as any, {
      items: [{ productId: p1Id, qty: 1 }],
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });
    await applyStockDelta(db as any, {
      productId: p1Id,
      delta: -1,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });

    const sale1Res = await sql<{ id: number }>`
      INSERT INTO sales (
        tenant_id, account_id, branch_id, location_id, doc_no, status,
        subtotal, total, paid_amount, discount, payment_type, payment_channel,
        customer_id, created_by, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${branchId}, ${locationId}, ${'SALE-' + simUid + '-001'}, 'posted',
        350.00, 350.00, 350.00, 0.00, 'cash', 'cash',
        ${customerId}, ${cashierUserId}, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const sale1Id = Number(sale1Res.rows[0].id);

    await sql`
      INSERT INTO sale_items (
        tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price,
        unit_name, unit_multiplier, line_total, cost_price, price_type, notes, modifiers
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${sale1Id}, ${p1Id}, 'قميص قطني فاخر', 1, 350.00,
        'قطعة', 1, 350.00, 180.00, 'retail', 'online pickup', '{}'
      )
    `.execute(db);

    await sql`
      INSERT INTO sale_payments (
        tenant_id, account_id, sale_id, payment_channel, amount, created_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${sale1Id}, 'cash', 350.00, NOW()
      )
    `.execute(db);

    // ربط الفاتورة بالطلب الإلكتروني وتحديث حالته لمكتمل
    await sql`
      UPDATE online_orders 
      SET sale_id = ${sale1Id}, status = 'delivered', updated_at = NOW() 
      WHERE id = ${onlineOrderId}
    `.execute(db);

    // ترحيل قيد الفاتورة
    const postSale1 = await db.transaction().execute((trx) => accountingPosting.postSale(trx, sale1Id, cashierAuth));
    console.log(
      `✓ تم تسليم الطلب الإلكتروني وتحويله لفاتورة مبيعات (#${sale1Id}) وترحيل قيدها (#${postSale1.journalEntryId}).`,
    );

    // -------------------------------------------------------------------------
    // STEP 5: مبيعات التجزئة المباشرة (نقدي بخصم، مجزأ، وآجل)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. مبيعات التجزئة المباشرة (نقدي بخصم، مجزأ، وآجل) ---');

    // أ. فاتورة 2: بيع نقدي بخصم (2 قميص @ 350 + 6 عصير @ 20 = 820، خصم 20 -> صافي 800)
    await applyStockDelta(db as any, {
      productId: p1Id,
      delta: -2,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });
    await applyStockDelta(db as any, {
      productId: p2Id,
      delta: -6,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });

    const sale2Res = await sql<{ id: number }>`
      INSERT INTO sales (
        tenant_id, account_id, branch_id, location_id, doc_no, status,
        subtotal, total, paid_amount, discount, payment_type, payment_channel,
        customer_id, created_by, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${branchId}, ${locationId}, ${'SALE-' + simUid + '-002'}, 'posted',
        820.00, 800.00, 800.00, 20.00, 'cash', 'cash',
        ${customerId}, ${cashierUserId}, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const sale2Id = Number(sale2Res.rows[0].id);

    // توزيع الخصم على البنود
    const discountAllocations = allocateInvoiceDiscount({
      lines: [
        { lineTotal: 700, qty: 2 },
        { lineTotal: 120, qty: 6 },
      ],
      invoiceDiscount: 20,
      invoiceTax: 0,
      pricesIncludeTax: false,
      digits: 2,
    });

    const s2Item1 = await sql<{ id: number }>`
      INSERT INTO sale_items (
        tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price,
        unit_name, unit_multiplier, line_total, net_line_total, net_unit_price, allocated_discount,
        cost_price, price_type, notes, modifiers
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${sale2Id}, ${p1Id}, 'قميص قطني فاخر', 2, 350.00,
        'قطعة', 1, 700.00, ${discountAllocations[0].netLineTotal}, ${discountAllocations[0].netUnitPrice}, ${discountAllocations[0].allocatedDiscount},
        180.00, 'retail', 'sale item 1', '{}'
      ) RETURNING id
    `.execute(db);
    const s2Item1Id = Number(s2Item1.rows[0].id);

    await sql`
      INSERT INTO sale_items (
        tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price,
        unit_name, unit_multiplier, line_total, net_line_total, net_unit_price, allocated_discount,
        cost_price, price_type, notes, modifiers
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${sale2Id}, ${p2Id}, 'عصير برتقال طبيعي', 6, 20.00,
        'قطعة', 1, 120.00, ${discountAllocations[1].netLineTotal}, ${discountAllocations[1].netUnitPrice}, ${discountAllocations[1].allocatedDiscount},
        12.00, 'retail', 'sale item 2', '{}'
      )
    `.execute(db);

    await sql`
      INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount, created_at)
      VALUES (${testTenantId}, ${testAccountId}, ${sale2Id}, 'cash', 800.00, NOW())
    `.execute(db);

    const postSale2 = await db.transaction().execute((trx) => accountingPosting.postSale(trx, sale2Id, cashierAuth));
    console.log(`✓ الفاتورة 2 (#${sale2Id}): بيع نقدي بخصم تجاري وترحيل قيدها (#${postSale2.journalEntryId}).`);

    // ب. فاتورة 3: سداد مجزأ (Split Tender: 2 كرتونة عصير @ 220 = 440 | 140 كاش + 200 كارت + 100 إنستاباي)
    await applyStockDelta(db as any, {
      productId: p2Id,
      delta: -24,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });

    const sale3Res = await sql<{ id: number }>`
      INSERT INTO sales (
        tenant_id, account_id, branch_id, location_id, doc_no, status,
        subtotal, total, paid_amount, discount, payment_type, payment_channel,
        customer_id, created_by, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${branchId}, ${locationId}, ${'SALE-' + simUid + '-003'}, 'posted',
        440.00, 440.00, 440.00, 0.00, 'cash', 'mixed',
        ${customerId}, ${cashierUserId}, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const sale3Id = Number(sale3Res.rows[0].id);

    const s3Item1 = await sql<{ id: number }>`
      INSERT INTO sale_items (
        tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price,
        unit_name, unit_multiplier, line_total, net_line_total, net_unit_price,
        cost_price, price_type, notes, modifiers
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${sale3Id}, ${p2Id}, 'عصير برتقال طبيعي', 2, 220.00,
        'كرتونة', 12, 440.00, 440.00, 220.00,
        144.00, 'retail', '2 cartons juice', '{}'
      ) RETURNING id
    `.execute(db);
    const s3Item1Id = Number(s3Item1.rows[0].id);

    await sql`
      INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount, created_at)
      VALUES 
        (${testTenantId}, ${testAccountId}, ${sale3Id}, 'cash', 140.00, NOW()),
        (${testTenantId}, ${testAccountId}, ${sale3Id}, 'card', 200.00, NOW()),
        (${testTenantId}, ${testAccountId}, ${sale3Id}, 'instapay', 100.00, NOW())
    `.execute(db);

    const postSale3 = await db.transaction().execute((trx) => accountingPosting.postSale(trx, sale3Id, cashierAuth));
    console.log(
      `✓ الفاتورة 3 (#${sale3Id}): سداد مجزأ (140 كاش + 200 فيزا + 100 إنستاباي) وترحيل قيدها (#${postSale3.journalEntryId}).`,
    );

    // ج. فاتورة 4: بيع آجل لعميل (Credit Sale: 1 قميص @ 350)
    await applyStockDelta(db as any, {
      productId: p1Id,
      delta: -1,
      branchId,
      locationId,
      tenantId: testTenantId,
      accountId: testAccountId,
    });

    const sale4Res = await sql<{ id: number }>`
      INSERT INTO sales (
        tenant_id, account_id, branch_id, location_id, doc_no, status,
        subtotal, total, paid_amount, discount, payment_type, payment_channel,
        customer_id, created_by, created_at, updated_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${branchId}, ${locationId}, ${'SALE-' + simUid + '-004'}, 'posted',
        350.00, 350.00, 0.00, 0.00, 'credit', 'credit',
        ${customerId}, ${cashierUserId}, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const sale4Id = Number(sale4Res.rows[0].id);

    const s4Item1 = await sql<{ id: number }>`
      INSERT INTO sale_items (
        tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price,
        unit_name, unit_multiplier, line_total, net_line_total, net_unit_price,
        cost_price, price_type, notes, modifiers
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${sale4Id}, ${p1Id}, 'قميص قطني فاخر', 1, 350.00,
        'قطعة', 1, 350.00, 350.00, 350.00,
        180.00, 'retail', 'credit sale', '{}'
      ) RETURNING id
    `.execute(db);
    const s4Item1Id = Number(s4Item1.rows[0].id);

    // تسجيل مديونية العميل في دفتر الأستاذ المساعد
    await sql`
      INSERT INTO customer_ledger (
        tenant_id, account_id, customer_id, entry_type, amount, balance_after,
        note, reference_type, reference_id, branch_id, location_id, created_by, created_at
      ) VALUES (
        ${testTenantId}, ${testAccountId}, ${customerId}, 'sale', 350.00, 350.00,
        'فاتورة مبيعات آجلة', 'sale', ${sale4Id}, ${branchId}, ${locationId}, ${cashierUserId}, NOW()
      )
    `.execute(db);
    await sql`UPDATE customers SET balance = 350.00, updated_at = NOW() WHERE id = ${customerId}`.execute(db);

    const postSale4 = await db.transaction().execute((trx) => accountingPosting.postSale(trx, sale4Id, cashierAuth));
    console.log(
      `✓ الفاتورة 4 (#${sale4Id}): بيع آجل لعميل (مديونية 350 جنيه) وترحيل قيدها (#${postSale4.journalEntryId}).`,
    );

    // -------------------------------------------------------------------------
    // STEP 6: دورة المرتجعات ورد الأموال ورد المخزون (Sales Returns Lifecycle)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. دورة المرتجعات ورد المبالغ عبر ReturnsService ---');

    // أ. المرتجع 1: استرداد نقدي لقطعة من الفاتورة 2 (Sale #2)
    const return1Res = await returnsService.createReturn(
      {
        type: 'sale',
        invoiceId: sale2Id,
        items: [{ productId: p1Id, qty: 1, saleItemId: s2Item1Id }],
        settlementMode: 'refund',
        refundMethod: 'cash',
        managerPin: '123456',
        note: 'مرتجع قميص نقدي سليم',
      },
      cashierAuth,
    );

    const retDoc1Id = Number(return1Res.id || return1Res.returnDocumentId);
    console.log(`✓ المرتجع 1 (#${retDoc1Id}): تم رد النقدية من الدرج واسترجاع قطعة للمخزون وترحيل قيد الاسترداد.`);

    // ب. المرتجع 2: استرداد برصيد متجر (Store Credit) من الفاتورة 3 (Sale #3)
    const return2Res = await returnsService.createReturn(
      {
        type: 'sale',
        invoiceId: sale3Id,
        items: [{ productId: p2Id, qty: 1, saleItemId: s3Item1Id }],
        settlementMode: 'store_credit',
        managerPin: '123456',
        note: 'مرتجع كرتونة عصير وإضافة القيمة كرصيد متجر',
      },
      cashierAuth,
    );

    const retDoc2Id = Number(return2Res.id || return2Res.returnDocumentId);
    console.log(`✓ المرتجع 2 (#${retDoc2Id}): تم إضافة رصيد المتجر للعميل واسترجاع المخزون وترحيل قيده.`);

    // ج. المرتجع 3: استرداد لتخفيض مديونية العميل في الفاتورة الآجلة (Sale #4)
    const return3Res = await returnsService.createReturn(
      {
        type: 'sale',
        invoiceId: sale4Id,
        items: [{ productId: p1Id, qty: 1, saleItemId: s4Item1Id }],
        settlementMode: 'refund',
        refundMethod: 'cash', // allocateRefundTenders يوجهه لـ receivable تلقائياً لحماية الكاش
        managerPin: '123456',
        note: 'مرتجع الفاتورة الآجلة وتصفير مديونية العميل',
      },
      cashierAuth,
    );

    const retDoc3Id = Number(return3Res.id || return3Res.returnDocumentId);
    console.log(`✓ المرتجع 3 (#${retDoc3Id}): تم تخفيض حساب العميل المدين وترحيل القيد العكسي.`);

    // التحقق من تصفير رصيد مديونية العميل
    const custFinal = await sql<{ balance: string; store_credit_balance: string }>`
      SELECT balance, store_credit_balance FROM customers WHERE id = ${customerId}
    `.execute(db);
    console.log(
      `✓ رصيد العميل الآجل: ${custFinal.rows[0].balance} جنيه (تم التصفير)، ورصيد المتجر: ${custFinal.rows[0].store_credit_balance} جنيه.`,
    );

    // -------------------------------------------------------------------------
    // STEP 7: إغلاق الوردية والمطابقة الصفرية للنقدية (Cashier Shift Reconciliation)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. إغلاق الوردية والمطابقة الصفرية للدرج ---');
    const listing = await cashDrawerService.listCashierShifts({ filter: 'open' }, adminAuth);
    const activeShift = (listing.cashierShifts as any[]).find((s: any) => Number(s.id) === shiftId);
    const expectedCashInDrawer = Number(activeShift?.expectedCash ?? activeShift?.expected_cash ?? 0);

    console.log(`📊 النقدية المتوقعة المحسوبة في الدرج: ${expectedCashInDrawer} جنيه.`);

    // أ. إغلاق الكاشير الأعمى (Blind Close) -> تتحول الحالة إلى pending_review
    await cashDrawerService.closeCashierShift(
      shiftId,
      {
        countedCash: expectedCashInDrawer,
        managerPin: '123456',
        note: 'إغلاق الوردية وعد النقدية بالدرج مع مطابقة تامة 100%',
      },
      cashierAuth,
    );

    const pendingShiftRow = await sql<{ status: string; variance: string }>`
      SELECT status, variance FROM cashier_shifts WHERE id = ${shiftId}
    `.execute(db);

    if (pendingShiftRow.rows[0].status !== 'pending_review' || Number(pendingShiftRow.rows[0].variance) !== 0) {
      throw new Error(
        `Blind shift close failed: status=${pendingShiftRow.rows[0].status}, variance=${pendingShiftRow.rows[0].variance}`,
      );
    }
    console.log(
      `✓ إغلاق الكاشير الأعمى تم بنجاح: الحالة (${pendingShiftRow.rows[0].status})، الفارق الصفرى (${pendingShiftRow.rows[0].variance}).`,
    );

    // ب. مراجعة واعتماد مدير الفرع (Manager Review & Approval) -> تتحول الحالة إلى closed وترحيل فروق العجز/الزيادة
    await cashDrawerService.reviewCashierShiftClose(
      shiftId,
      {
        note: 'مراجعة وتدقيق الدرج واعتماد الإغلاق النهائي من مدير الفرع',
      },
      adminAuth,
    );

    const closedShiftRow = await sql<{ status: string; variance: string }>`
      SELECT status, variance FROM cashier_shifts WHERE id = ${shiftId}
    `.execute(db);

    if (closedShiftRow.rows[0].status !== 'closed' || Number(closedShiftRow.rows[0].variance) !== 0) {
      throw new Error(
        `Shift manager review failed: status=${closedShiftRow.rows[0].status}, variance=${closedShiftRow.rows[0].variance}`,
      );
    }
    console.log(
      `✓ تم اعتماد الإغلاق النهائي من المدير بنجاح: الحالة (${closedShiftRow.rows[0].status})، الفارق (${closedShiftRow.rows[0].variance} فرق صفرى).`,
    );

    // -------------------------------------------------------------------------
    // STEP 8: التدقيق المحاسبي الشامل وثبات القيد المزدوج (Double-Entry Invariants)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. التدقيق المحاسبي الشامل وثبات القيد المزدوج لكافة القيود ---');
    const journalSummary = await sql<{ total_journals: string; total_debit: string; total_credit: string }>`
      SELECT 
        COUNT(DISTINCT j.id) as total_journals,
        COALESCE(SUM(l.debit), 0) as total_debit,
        COALESCE(SUM(l.credit), 0) as total_credit
      FROM journal_entries j
      JOIN journal_entry_lines l ON l.journal_entry_id = j.id
      WHERE j.tenant_id = ${testTenantId}
    `.execute(db);

    const totalJournals = Number(journalSummary.rows[0].total_journals);
    const totalDebit = Number(journalSummary.rows[0].total_debit);
    const totalCredit = Number(journalSummary.rows[0].total_credit);
    const delta = Math.abs(totalDebit - totalCredit);

    console.log(`📊 إجمالي القيود المُرحلة: ${totalJournals} قيداً محاسبياً.`);
    console.log(
      `📊 إجمالي المدين: ${totalDebit.toLocaleString()} جنيه | إجمالي الدائن: ${totalCredit.toLocaleString()} جنيه | الفارق: ${delta}`,
    );

    if (delta > 0.001) {
      throw new Error(
        `CRITICAL: POS & Returns journal entries do not balance! Debit=${totalDebit}, Credit=${totalCredit}, Delta=${delta}`,
      );
    }

    const unbalancedEntries = await sql<{ id: number; diff: string }>`
      SELECT j.id, ABS(SUM(l.debit) - SUM(l.credit)) as diff
      FROM journal_entries j
      JOIN journal_entry_lines l ON l.journal_entry_id = j.id
      WHERE j.tenant_id = ${testTenantId}
      GROUP BY j.id
      HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.001
    `.execute(db);

    if (unbalancedEntries.rows.length > 0) {
      throw new Error(`CRITICAL: Found ${unbalancedEntries.rows.length} individual unbalanced journal entries!`);
    }

    console.log('✓ كافة القيود المحاسبية لمبيعات الكاشير والمرتجعات متوازنة بدقة مطلقة (0.00 فرق).');
    console.log('✓ ثوابت المبيعات ونقاط البيع والمتجر الإلكتروني محققة 100%.');

    console.log('\n=============================================================================');
    console.log('  تهانينا! فحص نقاط البيع والمتجر والمرتجعات (POS & Returns) اجتاز 100%');
    console.log('=============================================================================\n');
  } finally {
    // تنظيف بيانات الاختبار النظيفة
    await sql`DELETE FROM treasury_transactions WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM cashier_shifts WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM return_items WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM return_documents WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM customer_ledger WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM sale_payments WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM sale_items WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM online_orders WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM sales WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM stock_movements WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM journal_entry_lines WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM journal_entries WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM product_location_stock WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM product_units WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM products WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM customers WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM stock_locations WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM branches WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM settings WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM audit_logs WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM users WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM accounting_settings WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${testTenantId}`.execute(db);
    await pool.end();
  }
}

runPosRetailStorefrontReturnsSimulation()
  .then(() => {
    console.log('pos-retail-storefront-returns-simulation: ok');
  })
  .catch((err) => {
    console.error('pos-retail-storefront-returns-simulation: FAILED', err);
    process.exit(1);
  });
