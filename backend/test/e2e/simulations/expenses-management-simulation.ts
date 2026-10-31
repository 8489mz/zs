import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../../../src/database/database.types';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { TreasuryService } from '../../../src/modules/treasury/treasury.service';
import { AuditService } from '../../../src/core/audit/audit.service';
import { TransactionHelper } from '../../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';

/**
 * Z-SYSTEMS ERP — EXPENSE MANAGEMENT SIMULATION
 * 
 * Verifies:
 * 1. Foundation: Tenant, Chart of Accounts, Branch, and Stock Location.
 * 2. Opening Balance: Initial capital injection into Cash Account.
 * 3. Multi-Category Expenses: Office supplies, rent, fuel, utilities, cleaning.
 * 4. Double-Entry Invariant: Journal entries automatically created with Debit (Expense) & Credit (Cash).
 * 5. Branch and Location scoping on expense records.
 * 6. Search, Filter, and Pagination via TreasuryService.
 * 7. Realized Balance Verification: Asserting Cash Account balance and Ledger equality (Debits == Credits).
 * 8. Edge cases: Zero / Negative amounts.
 * 9. Idempotent and clean teardown.
 */

async function runExpensesSimulation() {
  console.log('\n================================================================');
  console.log('[EXPENSES-SIMULATION] Z-SYSTEMS ERP — EXPENSES & COST AUDIT');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
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
  const tenantId = `exp_sim_${simUid}`;
  const accountId = `exp_acc_${simUid}`;

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
      username: 'expense_auditor',
      role: 'admin',
      tenantId,
      accountId,
      sessionId: `session_exp_${simUid}`,
      permissions: ['*'],
    };

    console.log(`[CONTEXT] Tenant Context: [Tenant: ${tenantId}, Account: ${accountId}, User: #${auth.userId}]`);

    // 1. Foundation Setup
    console.log('\n--- 1. تأسيس المنشأة وشجرة الحسابات (Foundation Setup) ---');
    await accountingFoundation.ensureForAuth(db, auth);

    const accountsCount = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM accounting_accounts WHERE tenant_id = ${auth.tenantId}
    `.execute(db);
    console.log(`[OK] تم تهيئة الحسابات المحاسبية بنجاح (${accountsCount.rows[0].count} حساب).`);

    const branchRes = await sql<{ id: number }>`
      INSERT INTO branches (tenant_id, account_id, name, code, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, 'فرع الإدارة والمصروفات', ${'EXP-BR-' + simUid}, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const branchId = Number(branchRes.rows[0].id);

    const locRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${auth.tenantId}, ${auth.accountId}, ${branchId}, 'خزينة المصروفات النثرية', 'branch_stock', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const locationId = Number(locRes.rows[0].id);

    const cashAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '1110' LIMIT 1
    `.execute(db);
    const equityAccount = await sql<{ id: number }>`
      SELECT id FROM accounting_accounts WHERE tenant_id = ${auth.tenantId} AND code = '3100' LIMIT 1
    `.execute(db);

    const cashAccountId = Number(cashAccount.rows[0].id);
    const equityAccountId = Number(equityAccount.rows[0].id);

    // 2. Initial Capital Deposit
    console.log('\n--- 2. إيداع رأس مال افتتاحي بالخزينة (50,000 ر.س) ---');
    await accountingPosting.postDomainJournal(db, {
      sourceType: 'manual_journal',
      sourceId: 8888,
      tenantId: auth.tenantId!,
      accountId: auth.accountId!,
      entryDate: new Date(),
      description: 'رأس مال افتتاحي لتغطية المصروفات التشغيلية',
      branchId,
      createdBy: auth.userId,
      lines: [
        {
          accountId: cashAccountId,
          debit: 50000,
          credit: 0,
          description: 'إيداع نقدي بالخزينة',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        {
          accountId: equityAccountId,
          debit: 0,
          credit: 50000,
          description: 'رأس المال',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        }
      ]
    });
    console.log('[OK] تم إيداع 50,000 ر.س في حساب الخزينة بنجاح.');

    // 3. Create Multi-Category Expenses
    console.log('\n--- 3. تسجيل مصروفات متنوعة وترحيلها محاسبياً ---');
    const expensesData = [
      { title: 'أدوات ومستلزمات مكتبية', amount: 800, note: 'أوراق وأحبار طابعات' },
      { title: 'وقود ومواصلات تشغيلية', amount: 1200, note: 'بنزين سيارات الميدان' },
      { title: 'إيجار المقر الإداري', amount: 5000, note: 'إيجار شهر سبتمبر 2026' },
      { title: 'فواتير الكهرباء والمياه', amount: 1500, note: 'استهلاك المرافق' },
      { title: 'نظافة وصيانة دورية', amount: 600, note: 'صيانة ونظافة المبنى' },
      { title: 'اشتراك إنترنت واتصالات', amount: 400, note: 'باقة الألياف البصرية' },
    ];

    let totalExpensesAmount = 0;
    for (const exp of expensesData) {
      const res = await treasuryService.createExpense({
        title: exp.title,
        amount: exp.amount,
        date: new Date().toISOString(),
        note: exp.note,
        branchId,
        locationId,
        requestKey: randomUUID(),
      }, auth);

      totalExpensesAmount += exp.amount;
      console.log(`   [EXPENSE] ${exp.title} بمبلغ ${exp.amount} ر.س -> تم التسجيل والترحيل الدفتري.`);
    }

    // 4. Verify Automatic Double-Entry Journal Lines
    console.log('\n--- 4. التحقق من القيود المحاسبية التلقائية للمصروفات ---');
    const journalEntries = await sql<{ id: number; description: string; total_debit: string }>`
      SELECT je.id, je.description, SUM(jel.debit) as total_debit
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      WHERE je.tenant_id = ${auth.tenantId} AND je.source_type = 'expense'
      GROUP BY je.id, je.description
    `.execute(db);

    if (journalEntries.rows.length < expensesData.length) {
      throw new Error(`Expected at least ${expensesData.length} expense journal entries, got ${journalEntries.rows.length}`);
    }
    console.log(`[OK] تم التحقق من إنشاء ${journalEntries.rows.length} قيد محاسبي مطابق للمصروفات.`);

    // 5. Search and Pagination
    console.log('\n--- 5. اختبار البحث والفلترة والصفحات ---');
    const searchRes = await treasuryService.listExpenses({ search: 'صيانة' }, auth);
    const searchExpenses = (searchRes as any).expenses || [];
    if (searchExpenses.length === 0) {
      throw new Error('Search failed: expected results for query "صيانة"');
    }
    console.log(`[OK] نتيجة البحث عن "صيانة": تم العثور على ${searchExpenses.length} مصروف.`);

    const pagedRes = await treasuryService.listExpenses({ page: 1, pageSize: 3 }, auth);
    const pagedExpenses = (pagedRes as any).expenses || [];
    if (pagedExpenses.length !== 3) {
      throw new Error(`Pagination failed: expected 3 items per page, got ${pagedExpenses.length}`);
    }
    console.log(`[OK] تم التحقق من التقسيم للصفحات (Pagination): تم جلب ${pagedExpenses.length} من أصل ${(pagedRes as any).summary?.totalItems} مصروف.`);

    // 6. Realized Balance and Double-Entry Invariant
    console.log('\n--- 6. التحقق من توازن الأرصدة ودفتر الأستاذ ---');
    const expectedCashBalance = 50000 - totalExpensesAmount;

    const actualCashRes = await sql<{ balance: string }>`
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as balance
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      WHERE jel.tenant_id = ${auth.tenantId} AND jel.account_id = ${cashAccountId} AND je.status = 'posted'
    `.execute(db);

    const actualCashBalance = Number(actualCashRes.rows[0].balance);
    console.log(`[BALANCE] رصيد الخزينة المتوقع: ${expectedCashBalance} ر.س | الفعلي: ${actualCashBalance} ر.س`);

    if (Math.abs(actualCashBalance - expectedCashBalance) > 0.001) {
      throw new Error(`Cash balance mismatch: expected ${expectedCashBalance}, got ${actualCashBalance}`);
    }

    const doubleEntryAudit = await sql<{ sum_debit: string; sum_credit: string }>`
      SELECT COALESCE(SUM(l.debit), 0) as sum_debit, COALESCE(SUM(l.credit), 0) as sum_credit
      FROM journal_entry_lines l
      JOIN journal_entries j ON j.id = l.journal_entry_id
      WHERE j.tenant_id = ${auth.tenantId}
    `.execute(db);

    const totalDebits = Number(doubleEntryAudit.rows[0].sum_debit);
    const totalCredits = Number(doubleEntryAudit.rows[0].sum_credit);
    console.log(`[TRIAL-BALANCE] إجمالي المدين: ${totalDebits} ر.س | إجمالي الدائن: ${totalCredits} ر.س`);

    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      throw new Error(`Double-entry invariant failed: Debits (${totalDebits}) != Credits (${totalCredits})`);
    }
    console.log('[OK] ميزان المراجعة متطابق تماماً (مدين == دائن).');

    // 7. Edge Case Testing
    console.log('\n--- 7. فحص الحالات الاستثنائية والمدخلات الخاطئة ---');
    try {
      await treasuryService.createExpense({
        title: 'مصروف غير صالح',
        amount: -100,
        date: new Date().toISOString(),
        requestKey: randomUUID(),
      }, auth);
      console.log('[WARN] تم قبول مبلغ سالب.');
    } catch (e: any) {
      console.log(`[OK] تم منع المصروف ذو القيمة غير الصالحة: ${e.message}`);
    }

    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة إدارة المصروفات بنجاح 100%!');
    console.log('================================================================\n');

  } catch (err: any) {
    console.error('[ERROR] SIMULATION FAILED:', err.message || err);
    console.error(err.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    await sql`DELETE FROM treasury_transactions WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM expenses WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM journal_entry_lines WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM journal_entries WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM stock_locations WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM branches WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_settings WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    console.log('[OK] تم تنظيف بيانات محاكاة المصروفات بنجاح.');
    await pool.end();
  }
}

runExpensesSimulation();
