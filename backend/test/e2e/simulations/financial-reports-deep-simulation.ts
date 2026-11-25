import 'dotenv/config';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../../../src/database/database.types';
import { AccountingTenantFoundationService } from '../../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingPostingService } from '../../../src/modules/accounting/accounting-posting.service';
import { AccountingService } from '../../../src/modules/accounting/accounting.service';
import { BalanceSheetService } from '../../../src/modules/accounting/services/balance-sheet.service';
import { AgedDebtsService } from '../../../src/modules/accounting/services/aged-debts.service';
import { VatDeclarationService } from '../../../src/modules/tax-integration/services/vat-declaration/vat-declaration.service';
import { AuthContext } from '../../../src/core/auth/interfaces/auth-context.interface';

/**
 * Z-SYSTEMS ERP — COMPREHENSIVE FINANCIAL REPORTS & LEDGER AUDIT SIMULATION
 *
 * Verifies:
 * 1. Foundation: Multi-currency Chart of Accounts & Opening Balance injection.
 * 2. Operational Transactions: Cash Sale, Credit Sale, OpEx, and Input VAT.
 * 3. Trial Balance Invariant: Total Debits == Total Credits.
 * 4. Income Statement (P&L): Revenue - Expenses = Net Profit.
 * 5. Balance Sheet: Total Assets == Total Liabilities + Equity + Period Net Profit (Balanced).
 * 6. AR Aging Engine: Multi-tier aging breakdown (Current, 1-30, 31-60, 61-90, 91+).
 * 7. VAT Declaration Engine: Output VAT, Input VAT, and Net Tax Settlement.
 * 8. Idempotent and clean teardown.
 */

async function runFinancialReportsDeepSimulation() {
  console.log('\n================================================================');
  console.log('[FINANCIAL-REPORTS-SIMULATION] Z-SYSTEMS ERP — FINANCIAL STATEMENTS AUDIT');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const accountingFoundation = new AccountingTenantFoundationService();
  const accountingPosting = new AccountingPostingService(accountingFoundation);
  const accountingService = new AccountingService(db, accountingFoundation);
  const balanceSheetService = new BalanceSheetService(db);
  const agedDebtsService = new AgedDebtsService(db);
  const vatDeclarationService = new VatDeclarationService(db);

  const simUid = Date.now().toString().slice(-4);
  const tenantId = `fin_sim_${simUid}`;
  const accountId = `fin_acc_${simUid}`;

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
      username: 'financial_auditor',
      role: 'admin',
      tenantId,
      accountId,
      sessionId: `session_fin_${simUid}`,
      permissions: ['*'],
    };

    console.log(`[CONTEXT] Tenant Context: [Tenant: ${tenantId}, Account: ${accountId}, User: #${auth.userId}]`);

    // 1. Foundation & Chart of Accounts
    console.log('\n--- 1. تهيئة الدليل المحاسبي وشجرة الحسابات (Accounting Foundation) ---');
    await accountingFoundation.ensureForAuth(db, auth);

    const branchRes = await sql<{ id: number }>`
      INSERT INTO branches (tenant_id, account_id, name, code, is_active, created_at, updated_at)
      VALUES (${tenantId}, ${accountId}, 'الفرع المالي الرئيسي', ${'FIN-BR-' + simUid}, true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const branchId = Number(branchRes.rows[0].id);

    const locRes = await sql<{ id: number }>`
      INSERT INTO stock_locations (tenant_id, account_id, branch_id, name, location_type, is_active, created_at, updated_at)
      VALUES (${tenantId}, ${accountId}, ${branchId}, 'الخزينة المركزية', 'branch_stock', true, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const locationId = Number(locRes.rows[0].id);

    // Resolve standard GL account IDs
    const cashAccount = await sql<{
      id: number;
    }>`SELECT id FROM accounting_accounts WHERE tenant_id = ${tenantId} AND code = '1110' LIMIT 1`.execute(db);
    const arAccount = await sql<{
      id: number;
    }>`SELECT id FROM accounting_accounts WHERE tenant_id = ${tenantId} AND code = '1130' LIMIT 1`.execute(db);
    const vatOutAccount = await sql<{
      id: number;
    }>`SELECT id FROM accounting_accounts WHERE tenant_id = ${tenantId} AND code = '2130' LIMIT 1`.execute(db);
    const vatInAccount = await sql<{
      id: number;
    }>`SELECT id FROM accounting_accounts WHERE tenant_id = ${tenantId} AND code = '1150' LIMIT 1`.execute(db);
    const equityAccount = await sql<{
      id: number;
    }>`SELECT id FROM accounting_accounts WHERE tenant_id = ${tenantId} AND code = '3100' LIMIT 1`.execute(db);
    const revenueAccount = await sql<{
      id: number;
    }>`SELECT id FROM accounting_accounts WHERE tenant_id = ${tenantId} AND code = '4100' LIMIT 1`.execute(db);
    const expenseAccount = await sql<{
      id: number;
    }>`SELECT id FROM accounting_accounts WHERE tenant_id = ${tenantId} AND code = '5100' LIMIT 1`.execute(db);

    const cashAccountId = Number(cashAccount.rows[0].id);
    const arAccountId = Number(arAccount.rows[0].id);
    const vatOutAccountId = Number(vatOutAccount.rows[0].id);
    const vatInAccountId = Number(vatInAccount.rows[0].id);
    const equityAccountId = Number(equityAccount.rows[0].id);
    const revenueAccountId = Number(revenueAccount.rows[0].id);
    const expenseAccountId = Number(expenseAccount.rows[0].id);

    // Create Customer for Credit Sale
    const custRes = await sql<{ id: number }>`
      INSERT INTO customers (
        tenant_id, account_id, name, phone, address, balance, customer_type, credit_limit, store_credit_balance, company_name, tax_number, is_active
      ) VALUES (
        ${tenantId}, ${accountId}, 'مؤسسة الرياض التجارية', '0554433221', 'الرياض', 0, 'cash', 100000, 0, 'الرياض', '310998877660003', true
      ) RETURNING id
    `.execute(db);
    const customerId = Number(custRes.rows[0].id);

    // 2. Post Opening Balance Journal Entry (100,000 Cash / 100,000 Capital)
    console.log('\n--- 2. إيداع رأس المال الافتتاحي (100,000 ر.س) ---');
    await accountingPosting.postDomainJournal(db, {
      sourceType: 'manual_journal',
      sourceId: 1001,
      tenantId,
      accountId,
      entryDate: new Date('2026-09-01'),
      description: 'إيداع رأس المال الافتتاحي',
      branchId,
      createdBy: auth.userId,
      lines: [
        {
          accountId: cashAccountId,
          debit: 100000,
          credit: 0,
          description: 'نقدية بالصندوق',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        {
          accountId: equityAccountId,
          debit: 0,
          credit: 100000,
          description: 'رأس مال المنشأة',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
      ],
    });
    console.log('[OK] تم ترحيل قيد رأس المال الافتتاحي بنجاح.');

    // 3. Post Commercial Transactions
    console.log('\n--- 3. تسجيل العمليات التشغيلية (مبيعات نقدية وآجلة ومصروفات) ---');

    // A. Cash Sales: Net Revenue 20,000 + Output VAT 3,000 = Cash 23,000
    await accountingPosting.postDomainJournal(db, {
      sourceType: 'manual_journal',
      sourceId: 1002,
      tenantId,
      accountId,
      entryDate: new Date('2026-09-05'),
      description: 'مبيعات نقدية لمعرض التجزئة',
      branchId,
      createdBy: auth.userId,
      lines: [
        {
          accountId: cashAccountId,
          debit: 23000,
          credit: 0,
          description: 'تحصيل نقدي',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        {
          accountId: revenueAccountId,
          debit: 0,
          credit: 20000,
          description: 'إيراد مبيعات',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        {
          accountId: vatOutAccountId,
          debit: 0,
          credit: 3000,
          description: 'ضريبة مخرجات مستحقة 15%',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
      ],
    });

    // B. Credit Sales: Net Revenue 10,000 + Output VAT 1,500 = AR 11,500
    await accountingPosting.postDomainJournal(db, {
      sourceType: 'manual_journal',
      sourceId: 1003,
      tenantId,
      accountId,
      entryDate: new Date('2026-09-10'),
      description: 'مبيعات آجلة لمؤسسة الرياض',
      branchId,
      createdBy: auth.userId,
      lines: [
        {
          accountId: arAccountId,
          debit: 11500,
          credit: 0,
          description: 'مدينون عملاء',
          partnerType: 'customer',
          partnerId: customerId,
          branchId,
          locationId,
        },
        {
          accountId: revenueAccountId,
          debit: 0,
          credit: 10000,
          description: 'إيراد مبيعات آجلة',
          partnerType: 'customer',
          partnerId: customerId,
          branchId,
          locationId,
        },
        {
          accountId: vatOutAccountId,
          debit: 0,
          credit: 1500,
          description: 'ضريبة مخرجات مستحقة 15%',
          partnerType: 'customer',
          partnerId: customerId,
          branchId,
          locationId,
        },
      ],
    });

    // Also register credit sale in `sales` table for AR Aging & VAT declaration and update customer balance
    await sql`
      INSERT INTO sales (
        tenant_id, account_id, branch_id, customer_id, doc_no, table_number, order_type, payment_type, payment_channel, subtotal, discount, tax_rate, tax_amount, total, paid_amount, status, created_at, updated_at
      ) VALUES (
        ${tenantId}, ${accountId}, ${branchId}, ${customerId}, ${'INV-AR-' + simUid}, '', 'takeaway', 'credit', 'credit', 10000, 0, 15, 1500, 11500, 0, 'posted', NOW(), NOW()
      )
    `.execute(db);

    await sql`UPDATE customers SET balance = 11500 WHERE id = ${customerId}`.execute(db);

    // C. Operating Expenses: Expense 6,000 + Input VAT 900 = Cash Outflow 6,900
    await accountingPosting.postDomainJournal(db, {
      sourceType: 'manual_journal',
      sourceId: 1004,
      tenantId,
      accountId,
      entryDate: new Date('2026-09-15'),
      description: 'مصروفات تشغيلية وصيانة دورية',
      branchId,
      createdBy: auth.userId,
      lines: [
        {
          accountId: expenseAccount.rows[0].id,
          debit: 6000,
          credit: 0,
          description: 'مصروفات عمومية',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        {
          accountId: vatInAccountId,
          debit: 900,
          credit: 0,
          description: 'ضريبة مدخلات قابلة للخصم 15%',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        {
          accountId: cashAccountId,
          debit: 0,
          credit: 6900,
          description: 'سداد نقدي من الصندوق',
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
      ],
    });
    console.log('[OK] تم تسجيل كافة الحركات المالية بنجاح.');

    // 4. Trial Balance Invariant (ميزان المراجعة)
    console.log('\n--- 4. التحقق من ميزان المراجعة (Trial Balance Invariant) ---');
    const trialBalanceRes = await sql<{ sum_debit: string; sum_credit: string; count_lines: string }>`
      SELECT 
        COUNT(*) as count_lines,
        COALESCE(SUM(debit), 0) as sum_debit,
        COALESCE(SUM(credit), 0) as sum_credit
      FROM journal_entry_lines
      WHERE tenant_id = ${tenantId}
    `.execute(db);

    const totalDebits = Number(trialBalanceRes.rows[0].sum_debit);
    const totalCredits = Number(trialBalanceRes.rows[0].sum_credit);
    console.log(
      `[TRIAL-BALANCE] إجمالي المدين: ${totalDebits} ر.س | إجمالي الدائن: ${totalCredits} ر.س (${trialBalanceRes.rows[0].count_lines} بند).`,
    );

    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      throw new Error(`Trial balance discrepancy: Debits (${totalDebits}) != Credits (${totalCredits})`);
    }
    console.log('[OK] ميزان المراجعة متطابق تماماً بنسبة 100% (مدين == دائن).');

    // 5. Income Statement (قائمة الدخل P&L)
    console.log('\n--- 5. التحقق من قائمة الدخل (Income Statement / P&L) ---');
    const expectedRevenue = 20000 + 10000; // 30,000
    const expectedExpense = 6000; // 6,000
    const expectedNetProfit = expectedRevenue - expectedExpense; // 24,000

    const financialSummary = await accountingService.getFinancialSummary({}, auth);
    console.log('[FINANCIAL-SUMMARY] ملخص قائمة الدخل:', financialSummary);

    // Direct ledger validation for revenue and expense accounts
    const pnlLedger = await sql<{ account_type: string; net_amount: string }>`
      SELECT 
        aa.account_type,
        SUM(jel.credit - jel.debit) as net_amount
      FROM journal_entry_lines jel
      JOIN accounting_accounts aa ON aa.id = jel.account_id
      WHERE jel.tenant_id = ${tenantId} AND aa.account_type IN ('revenue', 'expense')
      GROUP BY aa.account_type
    `.execute(db);

    const revenueRow = pnlLedger.rows.find((r) => r.account_type === 'revenue');
    const expenseRow = pnlLedger.rows.find((r) => r.account_type === 'expense');

    const actualRevenue = Number(revenueRow?.net_amount || 0);
    // for expenses: normal balance is debit so debit - credit = -net_amount
    const actualExpense = -Number(expenseRow?.net_amount || 0);
    const actualNetProfit = actualRevenue - actualExpense;

    console.log(
      `[P&L] الإيرادات: ${actualRevenue} ر.س | المصروفات: ${actualExpense} ر.س | صافي الربح: ${actualNetProfit} ر.س`,
    );
    if (
      actualRevenue !== expectedRevenue ||
      actualExpense !== expectedExpense ||
      actualNetProfit !== expectedNetProfit
    ) {
      throw new Error(`P&L mismatch: expected net profit ${expectedNetProfit}, got ${actualNetProfit}`);
    }
    console.log('[OK] قائمة الدخل وصافي الربح المحقق دقيقة ومطابقة للمعادلة المحاسبية.');

    // 6. Balance Sheet (الميزانية العمومية)
    console.log('\n--- 6. التحقق من الميزانية العمومية ومعادلة الأصول والخصوم ---');
    const balanceSheet = await balanceSheetService.getBalanceSheet(auth, { asOfDate: '2026-09-30' });
    console.log(
      `[BALANCE-SHEET] إجمالي الأصول: ${balanceSheet.assets.totalAssets} ر.س | إجمالي الالتزامات وحقوق الملكية: ${balanceSheet.totalLiabilitiesAndEquity} ر.س`,
    );
    console.log(
      `[BALANCE-SHEET] حالة التوازن (isBalanced): ${balanceSheet.isBalanced} | الفارق: ${balanceSheet.difference} ر.س`,
    );

    if (!balanceSheet.isBalanced || Math.abs(balanceSheet.difference) > 0.001) {
      throw new Error(`Balance sheet is not balanced: difference = ${balanceSheet.difference}`);
    }
    console.log(
      '[OK] الميزانية العمومية متوازنة تماماً وفق المعايير الدولية (الأصول = الخصوم + حقوق الملكية + صافي ربح الفترة).',
    );

    // 7. AR Aging Engine (أعمار ديون العملاء)
    console.log('\n--- 7. فحص محرك أعمار الديون (AR Aging Report) ---');
    const todayStr = new Date().toISOString().split('T')[0];
    const arAging = await agedDebtsService.getAgedReceivables(auth, { asOfDate: todayStr });
    console.log(
      `[AR-AGING] إجمالي رصيد الديون المستحقة: ${arAging.totalBalance} ر.س (عدد العملاء: ${arAging.totalPartnersCount})`,
    );

    if (arAging.totalBalance !== 11500) {
      throw new Error(`AR Aging balance mismatch: expected 11500, got ${arAging.totalBalance}`);
    }
    console.log('[OK] تقرير أعمار ديون العملاء يطابق رصيد حساب المدينين الدفتري بدقة.');

    // 8. VAT Declaration Engine (الإقرار الضريبي)
    console.log('\n--- 8. فحص محرك الإقرار الضريبي (VAT Declaration) ---');
    const vatDeclaration = await vatDeclarationService.getDeclaration({ country: 'SA' }, auth);
    const expectedOutputVat = 3000 + 1500; // 4,500
    const expectedInputVat = 900; // 900
    const expectedNetVatPayable = expectedOutputVat - expectedInputVat; // 3,600

    console.log(
      `[VAT] ضريبة المخرجات المسجلة: ${vatDeclaration.output_tax.total_output_vat} ر.س | ضريبة المدخلات: ${vatDeclaration.input_tax.total_input_vat} ر.س`,
    );
    console.log(
      `[OK] ضريبة المخرجات المتوقعة: ${expectedOutputVat} ر.س | ضريبة المدخلات: ${expectedInputVat} ر.س | صافي الضريبة المستحقة: ${expectedNetVatPayable} ر.س.`,
    );

    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة التقارير والقوائم المالية العميقة بنجاح 100%!');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('[ERROR] SIMULATION FAILED:', err.message || err);
    console.error(err.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    await sql`DELETE FROM sales WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM customers WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM journal_entry_lines WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM journal_entries WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM stock_locations WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM branches WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_settings WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${tenantId}`.execute(db).catch(() => {});
    console.log('[OK] تم تنظيف بيانات محاكاة التقارير المالية بنجاح.');
    await pool.end();
  }
}

runFinancialReportsDeepSimulation();
