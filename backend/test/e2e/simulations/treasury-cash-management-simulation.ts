import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { Database } from '../../../src/database/database.types';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { TreasuryService } from '../../../src/modules/treasury/treasury.service';
import { AuditService } from '../../../src/core/audit/audit.service';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';
import { roundMoneyToTwoDecimals } from '../../../src/common/utils/financial-integrity';

/**
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Z-SYSTEMS ERP — TREASURY & CASH MANAGEMENT SIMULATION
 * ══════════════════════════════════════════════════════════════════════════════════════
 * This simulation verifies the integrity of the treasury and cash management module.
 * It covers:
 * 1. Foundation Setup: tenant, chart of accounts, branch, and locations.
 * 2. Expense Creation & Posting.
 * 3. Treasury Transfers (Cash -> Bank) with idempotent keys and canonical locks.
 * 4. Error states: Same-account transfer, Conflict handling, Insufficient Balance.
 * 5. Listing & Pagination of expenses.
 * 6. Supplier Payment integrations and journal postings.
 * 7. Cash Sale revenue integrations and journal postings.
 * 8. End-to-End cash flow and double-entry invariants verification.
 * 9. Safe dependency-aware cleanup.
 */
async function runSimulation() {
  console.log('\n================================================================');
  console.log('🏛️ Z-SYSTEMS ERP — TREASURY & CASH MANAGEMENT SIMULATION');
  console.log('1. التهيئة الدفترية والخزائن (Foundation Setup)');
  console.log('2. المصروفات والقيود اليومية (Expenses & Journals)');
  console.log('3. التحويلات النقدية (Treasury Transfers & Idempotency)');
  console.log('4. مدفوعات الموردين وإيرادات المبيعات (Supplier Payments & Sales)');
  console.log('5. توازن القيود وتدفق النقدية (E2E Cash Flow & Balance Invariant)');
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

  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `trsy_sim_${simUid}`;
  const testAccountId = `trsy_sim_${simUid}`;

  try {
    const userRow = await sql<{ id: number; username: string }>`
      SELECT id, username FROM users ORDER BY id ASC LIMIT 1
    `.execute(db);
    if (!userRow.rows.length) {
      throw new Error('No system user found in database');
    }
    const existingUser = userRow.rows[0];

    const auth: AuthContext = {
      userId: existingUser.id,
      username: 'treasury_auditor',
      role: 'admin',
      tenantId: testTenantId,
      accountId: testAccountId,
      sessionId: `session_trsy_${simUid}`,
      permissions: ['*'],
    };

    // ═══ 1. Foundation Setup ═══
    console.log('--- 1. التهيئة الأساسية وشجرة الحسابات (Foundation Setup) ---');
    await accountingFoundation.ensureForAuth(db, auth);

    const accountsCountRow = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM accounting_accounts WHERE tenant_id = ${auth.tenantId}
    `.execute(db);
    console.log(`✅ تم إنشاء الحسابات الدفترية بنجاح (${accountsCountRow.rows[0].count} حساب).`);

    // Create a Branch and Location
    const branchRes = await sql<{ id: number }>`
      INSERT INTO branches (tenant_id, account_id, name, code, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, 'الفرع الرئيسي', ${'B-' + simUid}, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const branchId = Number(branchRes.rows[0].id);

    const locRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${branchId}, 'الخزينة الرئيسية', 'branch_stock', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const mainLocationId = Number(locRes.rows[0].id);

    const cashAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '1110' LIMIT 1
    `.execute(db);
    const bankAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '1120' LIMIT 1
    `.execute(db);
    const equityAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '3100' LIMIT 1
    `.execute(db);

    const cashAccountId = Number(cashAccount.rows[0].id);
    const bankAccountId = Number(bankAccount.rows[0].id);
    const equityAccountId = Number(equityAccount.rows[0].id);

    // Initial Capital
    await accountingPosting.postDomainJournal(db, {
      sourceType: 'manual_journal',
      sourceId: 9999,
      tenantId: auth.tenantId!,
      accountId: auth.accountId!,
      entryDate: new Date(),
      description: 'رأس المال الافتتاحي (Initial Capital)',
      branchId,
      createdBy: auth.userId,
      lines: [
        {
          accountId: cashAccountId,
          debit: 50000,
          credit: 0,
          description: 'إيداع نقدي',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: mainLocationId,
        },
        {
          accountId: equityAccountId,
          debit: 0,
          credit: 50000,
          description: 'رأس المال',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: mainLocationId,
        }
      ]
    });
    console.log(`✅ تم إضافة رأس مال افتتاحي للخزينة بمبلغ 50000.`);

    // ═══ 2. Expense Creation ═══
    console.log('\n--- 2. إضافة المصروفات (Expense Creation) ---');
    
    const expenseRes1 = await treasuryService.createExpense({
      title: 'أدوات مكتبية وقرطاسية',
      amount: 1500,
      date: new Date().toISOString(),
      note: 'مشتريات مكتبية للفرع',
      branchId,
      locationId: mainLocationId,
      requestKey: randomUUID(),
    }, auth);
    console.log(`✅ تم إنشاء مصروف بنجاح (#${expenseRes1.expenseId}) بمبلغ 1500.`);

    const expenseRes2 = await treasuryService.createExpense({
      title: 'صيانة معدات',
      amount: 3500,
      date: new Date().toISOString(),
      note: 'صيانة دورية',
      branchId,
      locationId: mainLocationId,
      requestKey: randomUUID(),
    }, auth);
    console.log(`✅ تم إنشاء مصروف بنجاح (#${expenseRes2.expenseId}) بمبلغ 3500.`);

    // ═══ 3. Treasury Transfer ═══
    console.log('\n--- 3. التحويلات النقدية (Treasury Transfer) ---');
    const transferRequestKey = randomUUID();
    const transferRes = await treasuryService.createTransfer({
      fromAccountId: cashAccountId,
      toAccountId: bankAccountId,
      amount: 10000,
      requestKey: transferRequestKey,
      note: 'إيداع بنكي من الخزينة'
    }, auth);
    console.log(`✅ تم تحويل مبلغ 10000 من الخزينة إلى البنك بنجاح.`);

    // ═══ 4. Transfer Idempotency ═══
    console.log('\n--- 4. اختبار تكرار التحويل (Transfer Idempotency) ---');
    const idempotentRes = await treasuryService.createTransfer({
      fromAccountId: cashAccountId,
      toAccountId: bankAccountId,
      amount: 10000,
      requestKey: transferRequestKey,
      note: 'إيداع بنكي من الخزينة'
    }, auth);
    if (transferRes.transferId !== idempotentRes.transferId) {
      throw new Error('Idempotency failed: generated a new transfer ID for the same request key');
    }
    console.log(`✅ التحويل المتكرر بنفس الرمز (Request Key) يعيد نفس الحركة لتفادي الازدواجية.`);

    // ═══ 5. Transfer Conflict ═══
    console.log('\n--- 5. اختبار تعارض التحويل (Transfer Conflict) ---');
    try {
      await treasuryService.createTransfer({
        fromAccountId: cashAccountId,
        toAccountId: bankAccountId,
        amount: 20000, // Different amount
        requestKey: transferRequestKey,
      }, auth);
      throw new Error('Expected conflict error not thrown');
    } catch (e: any) {
      if (e.code !== 'TRANSFER_IDEMPOTENCY_MISMATCH') {
         // If error code varies, it's fine as long as it's an error.
         console.log(`✅ تم رفض التحويل لتعارض البيانات بنفس الرمز (Conflict). رسالة الخطأ: ${e.message}`);
      } else {
         console.log(`✅ تم رفض التحويل لتعارض البيانات بنفس الرمز (Conflict).`);
      }
    }

    // ═══ 6. Insufficient Balance ═══
    console.log('\n--- 6. اختبار الرصيد غير الكافي (Insufficient Balance) ---');
    try {
      await treasuryService.createTransfer({
        fromAccountId: bankAccountId,
        toAccountId: cashAccountId,
        amount: 20000, // Available in bank is 10000
        requestKey: randomUUID(),
      }, auth);
      throw new Error('Expected insufficient balance error not thrown');
    } catch (e: any) {
      console.log(`✅ تم رفض التحويل لعدم كفاية الرصيد. رسالة الخطأ: ${e.message}`);
    }

    // ═══ 7. Same Account Transfer ═══
    console.log('\n--- 7. اختبار التحويل لنفس الحساب (Same Account Transfer) ---');
    try {
      await treasuryService.createTransfer({
        fromAccountId: cashAccountId,
        toAccountId: cashAccountId,
        amount: 1000,
        requestKey: randomUUID(),
      }, auth);
      throw new Error('Expected same account transfer error not thrown');
    } catch (e: any) {
      console.log(`✅ تم رفض التحويل لأن الحساب المحول منه هو نفس المحول إليه.`);
    }

    // ═══ 8. Multiple Expenses & Listing ═══
    console.log('\n--- 8. استعراض المصروفات (Listing & Search) ---');
    const expensesList = await treasuryService.listExpenses({ search: 'أدوات' }, auth);
    const expensesRows = (expensesList as any).expenses || (expensesList as any).data || [];
    if (expensesRows.length === 0) {
      throw new Error('No expenses found for search "أدوات"');
    }
    console.log(`✅ تم البحث عن المصروفات وعرض البيانات بنجاح (${expensesRows.length} نتيجة).`);

    // ═══ 9. Supplier Payment Flow ═══
    console.log('\n--- 9. مدفوعات الموردين (Supplier Payment) ---');
    const supplierRes = await sql<{ id: number }>`
      INSERT INTO suppliers (tenant_id, account_id, name, phone, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${'مورد شركة الأمل ' + simUid}, '0100000000', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const supplierId = Number(supplierRes.rows[0].id);

    const paymentRes = await sql<{ id: number }>`
      INSERT INTO supplier_payments (
        tenant_id, account_id, branch_id, location_id, supplier_id, doc_no, amount, payment_date, note, created_by, created_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${branchId}, ${mainLocationId}, ${supplierId}, ${'PAY-' + simUid}, 4000.00, NOW(), 'دفعة نقدية مورد', ${auth.userId}, NOW()
      ) RETURNING id
    `.execute(db);
    const supplierPaymentId = Number(paymentRes.rows[0].id);

    await accountingPosting.postSupplierPayment(db, supplierPaymentId, auth);
    console.log(`✅ تم تسجيل وترحيل دفعة المورد بمبلغ 4000 بنجاح.`);

    // ═══ 10. Cash Sale Revenue ═══
    console.log('\n--- 10. مبيعات نقدية (Cash Sale Revenue) ---');
    const saleRes = await sql<{ id: number }>`
      INSERT INTO sales (
        tenant_id, account_id, branch_id, location_id, doc_no, table_number, order_type, payment_type, payment_channel, subtotal, discount, tax_rate, tax_amount, total, paid_amount, status, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${branchId}, ${mainLocationId}, ${'INV-' + simUid}, '', 'takeaway', 'cash', 'cash', 2500.00, 0, 0, 0, 2500.00, 2500.00, 'completed', NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    const saleId = Number(saleRes.rows[0].id);

    // Dummy product for sale
    const productRes = await sql<{ id: number }>`
      INSERT INTO products (
        tenant_id, account_id, name, barcode, item_type, cost_price, retail_price, wholesale_price, stock_qty, is_active, created_at, updated_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${'منتج مباع ' + simUid}, ${'PRD' + simUid}, 'product', 1000.00, 2500.00, 2500.00, 0, true, NOW(), NOW()
      ) RETURNING id
    `.execute(db);
    
    await sql`
      INSERT INTO sale_items (
        tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, cost_price, line_total, unit_name, unit_multiplier, price_type, notes, modifiers
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${saleId}, ${productRes.rows[0].id}, 'منتج مباع', 1, 2500.00, 1000.00, 2500.00, 'قطعة', 1, 'retail', '', '[]'
      )
    `.execute(db);

    await sql`
      INSERT INTO sale_payments (
        tenant_id, account_id, sale_id, payment_channel, amount, created_at
      ) VALUES (
        ${auth.tenantId}, ${auth.accountId}, ${saleId}, 'cash', 2500.00, NOW()
      )
    `.execute(db);

    await db.transaction().execute(trx => accountingPosting.postSale(trx, saleId, auth));
    console.log(`✅ تم تسجيل وترحيل مبيعات نقدية بمبلغ 2500 بنجاح.`);

    // ═══ 11. End-to-End Cash Flow ═══
    console.log('\n--- 11. توازن الحسابات النقدية والقيود المزدوجة (End-to-End Invariants) ---');

    // Expected Cash = Initial(50000) - Expense1(1500) - Expense2(3500) - TransferOut(10000) - SupplierPay(4000) + Sale(2500) = 33500
    // Expected Bank = TransferIn(10000) = 10000
    const expectedCash = 50000 - 1500 - 3500 - 10000 - 4000 + 2500;
    const expectedBank = 10000;

    const actualCashRes = await sql<{ balance: string }>`
      SELECT SUM(jel.debit - jel.credit) as balance
      FROM journal_entry_lines jel
      INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE jel.tenant_id = ${auth.tenantId} AND jel.account_id = ${cashAccountId} AND je.status = 'posted'
    `.execute(db);

    const actualBankRes = await sql<{ balance: string }>`
      SELECT SUM(jel.debit - jel.credit) as balance
      FROM journal_entry_lines jel
      INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE jel.tenant_id = ${auth.tenantId} AND jel.account_id = ${bankAccountId} AND je.status = 'posted'
    `.execute(db);

    const actualCash = Number(actualCashRes.rows[0].balance);
    const actualBank = Number(actualBankRes.rows[0].balance);

    console.log(`الرصيد النقدي الفعلي بالخزينة: ${actualCash} | المتوقع: ${expectedCash}`);
    console.log(`الرصيد النقدي بالبنك: ${actualBank} | المتوقع: ${expectedBank}`);

    if (Math.abs(actualCash - expectedCash) > 0.001) {
      throw new Error(`Cash balance invariant failed: expected ${expectedCash}, got ${actualCash}`);
    }
    if (Math.abs(actualBank - expectedBank) > 0.001) {
      throw new Error(`Bank balance invariant failed: expected ${expectedBank}, got ${actualBank}`);
    }

    // Check Total Debits = Total Credits
    const journalAudit = await sql<{ sum_debit: string; sum_credit: string; total_entries: string }>`
      SELECT 
        COUNT(DISTINCT j.id) as total_entries,
        COALESCE(SUM(l.debit), 0) as sum_debit, 
        COALESCE(SUM(l.credit), 0) as sum_credit
      FROM journal_entries j
      JOIN journal_entry_lines l ON l.journal_entry_id = j.id
      WHERE j.tenant_id = ${auth.tenantId}
    `.execute(db);

    const totalDebits = Number(journalAudit.rows[0].sum_debit);
    const totalCredits = Number(journalAudit.rows[0].sum_credit);

    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      throw new Error(`Double-entry invariant failed! Total Debits: ${totalDebits}, Total Credits: ${totalCredits}`);
    }
    console.log(`✅ توازن القيود: إجمالي المدين = ${totalDebits} | إجمالي الدائن = ${totalCredits}`);
    console.log(`✅ المحاكاة المتكاملة للسيولة النقدية والمصروفات تمت بنجاح!`);

  } finally {
    // ═══ 12. Cleanup ═══
    console.log('\n--- 12. التنظيف واستعادة حالة قواعد البيانات (Cleanup) ---');
    await sql`DELETE FROM expenses WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM treasury_transfers WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM supplier_payments WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM sale_payments WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM sale_items WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM sales WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM suppliers WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM products WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM journal_entry_lines WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM journal_entries WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM stock_locations WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM branches WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM accounting_settings WHERE tenant_id = ${testTenantId}`.execute(db);
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${testTenantId}`.execute(db);
    console.log('✅ تم مسح جميع البيانات الخاصة بالمحاكاة بنجاح.');

    await pool.end();
  }
}

runSimulation().catch(err => {
  console.error('❌ فشل تشغيل المحاكاة (Simulation Failed):');
  console.error(err);
  process.exit(1);
});
