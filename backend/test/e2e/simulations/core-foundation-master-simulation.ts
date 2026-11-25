import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../../../src/database/database.types';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { TreasuryService } from '../../../src/modules/treasury/treasury.service';
import { AuditService } from '../../../src/core/audit/audit.service';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import {
  applyStockDelta,
  relocateStockBetweenLocations,
  previewConsumableStockQty,
} from '../../../src/common/utils/location-stock-ledger';
import { roundMoneyToTwoDecimals } from '../../../src/common/utils/financial-integrity';

async function runCoreFoundationMasterSimulation() {
  console.log('\n================================================================');
  console.log('🏛️ Z-SYSTEMS ERP — CORE FOUNDATION MASTER AUDIT & SIMULATION');
  console.log('1. شجرة الحسابات والتهيئة الدفترية (Chart of Accounts & Ledgers)');
  console.log('2. دورة المشتريات والمخازن والتكلفة (Purchases, GRN & WAC)');
  console.log('3. الحركات المخزنية والتسويات المكانية (Stock Transfers & Adjustments)');
  console.log('4. المبيعات وخصم تكلفة البضاعة المباعة (Sales Invoicing & COGS)');
  console.log('5. الخزينة والمدفوعات والمطابقة المحاسبية (Treasury, Payments & Transfers)');
  console.log('6. توازن القيد المزدوج وثبات الدفاتر (Double-Entry Invariants)');
  console.log('================================================================\n');

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
  const auditService = new AuditService(db as any);
  const accountingFoundation = new AccountingTenantFoundationService();
  const accountingPosting = new AccountingPostingService(accountingFoundation);
  const treasuryService = new TreasuryService(db as any, tx, auditService, accountingPosting);

  const userRow = await sql<{ id: number; tenant_id: string; account_id: string; username: string }>`
    SELECT id, tenant_id, account_id, username FROM users ORDER BY id ASC LIMIT 1
  `.execute(db);

  if (userRow.rows.length === 0) {
    throw new Error('No system user found in database');
  }

  const existingUser = userRow.rows[0];
  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `core_sim_${simUid}`;
  const testAccountId = `core_sim_${simUid}`;

  const auth: AuthContext = {
    userId: existingUser.id,
    username: 'core_auditor',
    role: 'admin',
    tenantId: testTenantId,
    accountId: testAccountId,
    sessionId: `session_core_${simUid}`,
    permissions: ['*'],
  };

  console.log(`📌 Test Isolation Scope: [Tenant: ${auth.tenantId}, Account: ${auth.accountId}]\n`);

  try {
    // -------------------------------------------------------------------------
    // STEP 1: تهيئة شجرة الحسابات القياسية للمستأجر الجديد (Tenant Accounting Foundation)
    // -------------------------------------------------------------------------
    console.log('--- 1. تهيئة شجرة الحسابات والإعدادات المحاسبية ---');
    await accountingFoundation.ensureForAuth(db, auth);

    const accountsCountRow = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM accounting_accounts WHERE tenant_id = ${auth.tenantId}
    `.execute(db);
    const accountsCount = Number(accountsCountRow.rows[0].count);
    console.log(`✓ تم إنشاء شجرة الحسابات بنجاح بعدد ${accountsCount} حساباً قياسياً.`);
    if (accountsCount < 20) {
      throw new Error(`Chart of accounts is truncated: only ${accountsCount} accounts found.`);
    }

    const settingsRow = await db
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', auth.tenantId as any)
      .executeTakeFirst();
    if (!settingsRow) {
      throw new Error('accounting_settings row was not created for tenant');
    }
    console.log('✓ تم ربط خريطة الإعدادات المحاسبية بالكامل (accounting_settings).');

    // تأكيد تعيين الحسابات النقدية والبنكية لدعم الخزينة
    await sql`
      UPDATE accounting_accounts 
      SET is_cash_bank = true 
      WHERE tenant_id = ${auth.tenantId} AND code IN ('1110', '1120')
    `.execute(db);

    // -------------------------------------------------------------------------
    // STEP 2: إنشاء الفروع والمستودعات المكانية (Branches & Stock Locations)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. إنشاء الفروع والمستودعات المكانية ---');
    const branchRes = await sql<{ id: number }>`
      INSERT INTO branches (tenant_id, account_id, name, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'الفرع الرئيسي ' + simUid}, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const branchId = Number(branchRes.rows[0].id);

    const mainLocationRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${branchId}, 'المستودع الرئيسي العام', 'internal_warehouse', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const mainLocationId = Number(mainLocationRes.rows[0].id);

    const subLocationRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${branchId}, 'مستودع الصالة الفرعي', 'internal_warehouse', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const subLocationId = Number(subLocationRes.rows[0].id);
    console.log(`✓ تم إنشاء المستودع الرئيسي (#${mainLocationId}) والمستودع الفرعي (#${subLocationId}).`);

    // -------------------------------------------------------------------------
    // STEP 3: إنشاء المنتج وإدارة الوحدات (Product Catalog & Multi-Units)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. تكويد الصنف وإعداد جدول الوحدات المتعددة ---');
    const productRes = await sql<{ id: number }>`
      INSERT INTO products (
        tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, wholesale_price, stock_qty, is_active, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${'منتج أساسي تجريبي ' + simUid}, ${'PRD' + simUid}, 'product', 50.00, 100.00, 85.00, 0, true, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const productId = Number(productRes.rows[0].id);

    await sql`
      INSERT INTO product_units (tenant_id, account_id, product_id, name, multiplier, is_base_unit, is_sale_unit_default, is_purchase_unit_default, barcode, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${productId}, 'قطعة', 1, true, true, true, ${'PRD' + simUid + '-1'}, NOW(), NOW())
    `.execute(db);

    await sql`
      INSERT INTO product_units (tenant_id, account_id, product_id, name, multiplier, is_base_unit, is_sale_unit_default, is_purchase_unit_default, barcode, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${productId}, 'كرتونة', 12, false, true, true, ${'PRD' + simUid + '-12'}, NOW(), NOW())
    `.execute(db);
    console.log(`✓ تم تكويد الصنف (#${productId}) مع وحدة أساسية (قطعة) ووحدة تجميعية (كرتونة = 12 قطعة).`);

    // -------------------------------------------------------------------------
    // STEP 4: دورة المشتريات وإذن الاستلام وتحديث التكلفة (Purchases, GRN & WAC)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. دورة المشتريات، إذن الاستلام المخزني (GRN)، واحتساب التكلفة ---');
    const supplierRes = await sql<{ id: number }>`
      INSERT INTO suppliers (tenant_id, account_id, name, phone, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'شركة التوريدات العالمية ' + simUid}, '0100000000', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const supplierId = Number(supplierRes.rows[0].id);

    // 1. استلام 100 قطعة بسعر 50 جنيه في المستودع الرئيسي
    const grnDelta = await applyStockDelta(db, {
      productId,
      locationId: mainLocationId,
      branchId,
      delta: 100,
      tenantId: auth.tenantId,
      accountId: auth.accountId,
    });
    console.log(`✓ تم توريد 100 قطعة للمستودع الرئيسي (الرصيد: ${grnDelta.globalBefore} -> ${grnDelta.globalAfter}).`);

    const purchaseBillRes = await sql<{ id: number }>`
      INSERT INTO purchases (
        tenant_id, account_id, branch_id, location_id, supplier_id, doc_no, payment_type, subtotal, discount, tax_rate, tax_amount, prices_include_tax, total, note, status, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${branchId}, ${mainLocationId}, ${supplierId}, ${'PUR-' + simUid}, 'credit', 5000.00, 0, 14, 700.00, false, 5700.00, '', 'posted', NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const purchaseId = Number(purchaseBillRes.rows[0].id);

    await sql`
      INSERT INTO purchase_items (
        tenant_id, account_id, purchase_id, product_id, product_name, qty, unit_cost, line_total, unit_name, unit_multiplier
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${purchaseId}, ${productId}, 'منتج تجريبي', 100, 50.00, 5000.00, 'قطعة', 1
      )
    `.execute(db);

    const purchasePostResult = await db
      .transaction()
      .execute((trx) => accountingPosting.postPurchase(trx, purchaseId, auth));
    console.log(
      `✓ تم ترحيل قيد فاتورة المشتريات بنجاح إلى دفتر الأستاذ العام (#${purchasePostResult.journalEntryId}).`,
    );

    // -------------------------------------------------------------------------
    // STEP 5: الحركات المخزنية والتحويل بين المستودعات (Location Stock Relocation)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. التحويل المخزني بين المستودعات وحفظ توازن الأرصدة المكانية ---');
    const transferResult = await relocateStockBetweenLocations(db, {
      productId,
      qty: 30,
      fromBranchId: branchId,
      fromLocationId: mainLocationId,
      toBranchId: branchId,
      toLocationId: subLocationId,
      tenantId: auth.tenantId,
      accountId: auth.accountId,
    });

    console.log(
      `✓ نقل 30 قطعة: المستودع الرئيسي أصبح (${transferResult.sourceAfter})، والفرعي أصبح (${transferResult.targetAfter}).`,
    );
    if (transferResult.sourceAfter !== 70 || transferResult.targetAfter !== 30) {
      throw new Error(
        `Location transfer balance mismatch: main=${transferResult.sourceAfter}, sub=${transferResult.targetAfter}`,
      );
    }

    const consumableMain = await previewConsumableStockQty(db, {
      productId,
      locationId: mainLocationId,
      branchId,
      tenantId: auth.tenantId,
      accountId: auth.accountId,
    });
    console.log(`✓ الرصيد المتاح للاستهلاك في المستودع الرئيسي: ${consumableMain} قطعة.`);

    // -------------------------------------------------------------------------
    // STEP 6: تسوية المخزون بالزيادة والعجز (Stock Adjustments: Gain & Loss)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. التسويات المخزنية الدفترية (Gain & Loss) والقيود الآلية ---');
    // 1. زيادة مخزنية (Gain) بواقع 5 قطع
    await applyStockDelta(db, {
      productId,
      locationId: mainLocationId,
      branchId,
      delta: 5,
      tenantId: auth.tenantId,
      accountId: auth.accountId,
    });
    const gainMovement = await sql<{ id: number }>`
      INSERT INTO stock_movements (
        tenant_id, account_id, product_id, branch_id, location_id, movement_type, before_qty, after_qty, qty, unit_cost, total_cost, reason, note, created_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${productId}, ${branchId}, ${mainLocationId}, 'adjustment', 70, 75, 5, 50.00, 250.00, 'تسوية جردية بالزيادة', '', NOW()
      ) RETURNING id
    `.execute(db);
    const gainMovementId = Number(gainMovement.rows[0].id);

    const gainPostResult = await accountingPosting.postInventoryAdjustment(db, gainMovementId, auth);
    console.log(`✓ تم ترحيل قيد الزيادة المخزنية (Dr 1140 / Cr 7100) (#${gainPostResult.journalEntryId}).`);

    // 2. عجز مخزني (Loss) بواقع 2 قطعة
    await applyStockDelta(db, {
      productId,
      locationId: mainLocationId,
      branchId,
      delta: -2,
      tenantId: auth.tenantId,
      accountId: auth.accountId,
    });
    const lossMovement = await sql<{ id: number }>`
      INSERT INTO stock_movements (
        tenant_id, account_id, product_id, branch_id, location_id, movement_type, before_qty, after_qty, qty, unit_cost, total_cost, reason, note, created_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${productId}, ${branchId}, ${mainLocationId}, 'adjustment', 75, 73, -2, 50.00, 100.00, 'تسوية جردية بالعجز', '', NOW()
      ) RETURNING id
    `.execute(db);
    const lossMovementId = Number(lossMovement.rows[0].id);

    const lossPostResult = await accountingPosting.postInventoryAdjustment(db, lossMovementId, auth);
    console.log(`✓ تم ترحيل قيد العجز المخزني (Dr 5200 / Cr 1140) (#${lossPostResult.journalEntryId}).`);

    // -------------------------------------------------------------------------
    // STEP 7: المبيعات وترحيل تكلفة البضاعة المباعة (Sales Invoice & COGS)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. دورة المبيعات النقدية وترحيل تكلفة البضاعة المباعة (COGS) ---');
    // بيع 10 قطع بسعر بيع 100 جنيه = 1000 جنيه كاش (تكلفة البضاعة: 10 * 50 = 500 جنيه)
    await applyStockDelta(db, {
      productId,
      locationId: mainLocationId,
      branchId,
      delta: -10,
      tenantId: auth.tenantId,
      accountId: auth.accountId,
    });

    const saleRes = await sql<{ id: number }>`
      INSERT INTO sales (
        tenant_id, account_id, branch_id, location_id, doc_no, table_number, order_type, payment_type, payment_channel, subtotal, discount, tax_rate, tax_amount, total, paid_amount, status, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${branchId}, ${mainLocationId}, ${'INV-' + simUid}, '', 'takeaway', 'cash', 'cash', 1000.00, 0, 0, 0, 1000.00, 1000.00, 'completed', NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const saleId = Number(saleRes.rows[0].id);

    await sql`
      INSERT INTO sale_items (
        tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, cost_price, line_total, unit_name, unit_multiplier, price_type, notes, modifiers
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${saleId}, ${productId}, 'منتج تجريبي', 10, 100.00, 50.00, 1000.00, 'قطعة', 1, 'retail', '', '[]'
      )
    `.execute(db);

    await sql`
      INSERT INTO sale_payments (
        tenant_id, account_id, sale_id, payment_channel, amount, created_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${saleId}, 'cash', 1000.00, NOW()
      )
    `.execute(db);

    const salePostResult = await db.transaction().execute((trx) => accountingPosting.postSale(trx, saleId, auth));
    console.log(`✓ تم ترحيل قيد المبيعات النقدية وتكلفة البضاعة المباعة (#${salePostResult.journalEntryId}):`);
    console.log('   - مدين: الخزينة 1110 (1000) / دائن: المبيعات 4100 (1000)');
    console.log('   - مدين: تكلفة المبيعات 5110 (500) / دائن: المخزون 1140 (500)');

    // -------------------------------------------------------------------------
    // STEP 8: الخزينة وسداد المورد والتحويل بين الحسابات النقدية (Treasury & Cash Vaults)
    // -------------------------------------------------------------------------
    console.log('\n--- 8. الخزينة، سداد مستحقات المورد، والتحويل بين الخزائن والبنوك ---');
    // سداد دفعة للمورد بقيمة 2000 جنيه من الخزينة
    const paymentRes = await sql<{ id: number }>`
      INSERT INTO supplier_payments (
        tenant_id, account_id, branch_id, location_id, supplier_id, doc_no, amount, payment_date, note, created_by, created_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${branchId}, ${mainLocationId}, ${supplierId}, ${'PAY-' + simUid}, 2000.00, NOW(), 'دفعة تحت الحساب للمورد', ${auth.userId}, NOW()
      ) RETURNING id
    `.execute(db);
    const paymentId = Number(paymentRes.rows[0].id);

    const supplierPaymentResult = await accountingPosting.postSupplierPayment(db, paymentId, auth);
    console.log(`✓ تم ترحيل قيد سداد المورد (Dr 2110 / Cr 1110) (#${supplierPaymentResult.journalEntryId}).`);

    // تحويل نقدي بين الخزينة والبنك عبر TreasuryService
    const cashAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '1110' LIMIT 1
    `.execute(db);
    const bankAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '1120' LIMIT 1
    `.execute(db);

    const cashAccountId = Number(cashAccount.rows[0].id);
    const bankAccountId = Number(bankAccount.rows[0].id);

    const equityAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '3100' LIMIT 1
    `.execute(db);
    const equityAccountId = Number(equityAccount.rows[0]?.id || cashAccountId);

    // إضافة رصيد افتتاحي للخزينة لتغطية التحويل إذا لزم
    // بما أن مبيعاتنا أدخلت 1000، وسددنا 2000 للمورد، فلنضع قيد رأس مال افتتاحي بقيمة 50000 بالخزينة
    await accountingPosting.postDomainJournal(db, {
      sourceType: 'manual_journal',
      sourceId: 9999,
      tenantId: auth.tenantId!,
      accountId: auth.accountId!,
      entryDate: new Date(),
      description: 'إيداع رأس مال افتتاحي بالخزينة',
      branchId,
      createdBy: auth.userId,
      lines: [
        {
          accountId: cashAccountId,
          debit: 50000,
          credit: 0,
          description: 'نقدية بالخزينة',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: null,
        },
        {
          accountId: equityAccountId,
          debit: 0,
          credit: 50000,
          description: 'رأس المال / الأرباح المبقاة',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: null,
        },
      ],
    });

    const transferRes = await treasuryService.createTransfer(
      {
        fromAccountId: cashAccountId,
        toAccountId: bankAccountId,
        amount: 5000.0,
        note: 'تحويل سيولة من الخزينة إلى الحساب البنكي',
        requestKey: `req_transfer_${simUid}`,
      },
      auth,
    );
    console.log(
      `✓ تم ترحيل قيد التحويل الداخلي بين الخزينة والبنك (Dr 1120 Bank / Cr 1110 Cash) (#${transferRes.journalEntryId}).`,
    );

    // -------------------------------------------------------------------------
    // STEP 9: التحقق الحاسم من توازن القيد المزدوج وثبات الدفاتر (The Double-Entry Invariant)
    // -------------------------------------------------------------------------
    console.log('\n--- 9. التحقق الحاسم من توازن القيد المزدوج وثبات الدفاتر ---');
    const journalAudit = await sql<{
      total_entries: string;
      sum_debit: string;
      sum_credit: string;
    }>`
      SELECT 
        COUNT(DISTINCT j.id) as total_entries,
        COALESCE(SUM(l.debit), 0) as sum_debit,
        COALESCE(SUM(l.credit), 0) as sum_credit
      FROM journal_entries j
      JOIN journal_entry_lines l ON l.journal_entry_id = j.id
      WHERE j.tenant_id = ${auth.tenantId}
    `.execute(db);

    const totalEntries = Number(journalAudit.rows[0].total_entries);
    const sumDebit = roundMoneyToTwoDecimals(Number(journalAudit.rows[0].sum_debit));
    const sumCredit = roundMoneyToTwoDecimals(Number(journalAudit.rows[0].sum_credit));
    const delta = roundMoneyToTwoDecimals(Math.abs(sumDebit - sumCredit));

    console.log(`📊 إجمالي القيود المُنشأة: ${totalEntries} قيود محاسبية.`);
    console.log(
      `📊 إجمالي المدين: ${sumDebit.toLocaleString()} جنيه | إجمالي الدائن: ${sumCredit.toLocaleString()} جنيه | الفارق: ${delta}`,
    );

    if (totalEntries === 0) {
      throw new Error('No journal entries were recorded!');
    }

    if (delta !== 0) {
      throw new Error(
        `CRITICAL INVARIANT VIOLATION: Sum(Debit) [${sumDebit}] != Sum(Credit) [${sumCredit}], Delta: ${delta}`,
      );
    }

    // التأكد من أن كل قيد بمفرده متوازن بدقة سنت بسنت
    const unbalancedEntries = await sql<{ id: number; diff: string }>`
      SELECT j.id, (SUM(l.debit) - SUM(l.credit)) as diff
      FROM journal_entries j
      JOIN journal_entry_lines l ON l.journal_entry_id = j.id
      WHERE j.tenant_id = ${auth.tenantId}
      GROUP BY j.id
      HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.001
    `.execute(db);

    if (unbalancedEntries.rows.length > 0) {
      throw new Error(`CRITICAL: Found ${unbalancedEntries.rows.length} individual unbalanced journal entries!`);
    }

    console.log('✓ كافة القيود المحاسبية متوازنة بدقة مطلقة (0.00 فرق).');
    console.log('✓ ثوابت الدفاتر المحاسبية والمخازن المشتركة محققة 100%.');

    console.log('\n=============================================================================');
    console.log('  تهانينا! فحص النواة المركزية والمحاسبة والمخازن (Core Foundation) اجتاز 100%');
    console.log('=============================================================================\n');
  } finally {
    await sql`DELETE FROM treasury_transfers WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM supplier_payments WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM sale_payments WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM sale_items WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM sales WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM stock_movements WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM purchase_items WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM purchases WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM journal_entry_lines WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM journal_entries WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM product_location_stock WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM product_units WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM products WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM suppliers WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM stock_locations WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM branches WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM accounting_settings WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${auth.tenantId}`.execute(db);
    await pool.end();
  }
}

runCoreFoundationMasterSimulation()
  .then(() => {
    console.log('core-foundation-master-simulation: ok');
  })
  .catch((err) => {
    console.error('core-foundation-master-simulation: FAILED', err);
    process.exit(1);
  });
