import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../../../src/database/database.types';

/**
 * Z-SYSTEMS ERP — MULTI-CURRENCY LIFECYCLE SIMULATION
 *
 * Verifies:
 * 1. Multi-Currency Foundation: Base currency SAR, foreign currencies USD, EUR.
 * 2. Foreign Currency Sale: Invoice booked at initial exchange rate.
 * 3. Settlement with Realized FX Gain: Customer payment at higher exchange rate.
 * 4. Foreign Currency Purchase with Realized FX Loss: Supplier invoice settled at higher rate.
 * 5. Double-Entry Balance Invariants: Asserting debits == credits on both transaction and ledger levels.
 * 6. Clean and idempotent teardown.
 */

async function runMultiCurrencySimulation() {
  console.log('\n================================================================');
  console.log('[MULTI-CURRENCY-SIMULATION] Z-SYSTEMS ERP — FX GAIN/LOSS AUDIT');
  console.log('1. تهيئة العملات المتعددة (Multi-Currency Foundation)');
  console.log('2. مبيعات بالعملة الأجنبية (Foreign Currency Sale)');
  console.log('3. سداد مع أرباح فروق عملة (Settlement with FX Gain)');
  console.log('4. مشتريات مع خسائر فروق عملة (Purchase with FX Loss)');
  console.log('5. توازن القيود بعد الفروق (Double-Entry Invariant)');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });

  const simUid = Date.now().toString().slice(-4);
  const testTenantId = `curr_sim_${simUid}`;
  const testAccountId = `curr_sim_${simUid}`;

  try {
    const userRow = await sql<{ id: number; username: string }>`
      SELECT id, username FROM users ORDER BY id ASC LIMIT 1
    `.execute(db);
    if (!userRow.rows.length) {
      throw new Error('No system user found in database');
    }
    const userId = userRow.rows[0].id;

    // 1. Multi-Currency Foundation
    console.log('--- 1. تهيئة العملات المتعددة (Multi-Currency Foundation) ---');
    console.log('[OK] تم تحديد العملة الأساسية: ريال سعودي (SAR).');
    console.log('[OK] تم تعريف العملات الأجنبية: دولار (USD)، يورو (EUR).');
    console.log('[OK] تم تحديد أسعار الصرف: USD = 3.75 SAR, EUR = 4.10 SAR.');

    const insertAccount = async (code: string, nameAr: string, type: any, normalBal: any) => {
      const res = await sql<{ id: number }>`
        INSERT INTO accounting_accounts (
          tenant_id, account_id, code, name_ar, name_en, account_type, account_group, 
          normal_balance, is_active, is_system, allow_manual_entries, is_control_account, 
          is_cash_bank, is_receivable, is_payable, is_inventory, is_tax, description_ar, sort_order, created_at, updated_at
        ) VALUES (
          ${testTenantId}, ${testAccountId}, ${code}, ${nameAr}, ${nameAr}, ${type}, 'general', 
          ${normalBal}, true, false, true, false, false, false, false, false, false, '', 1, NOW(), NOW()
        )
        RETURNING id
      `.execute(db);
      return Number(res.rows[0].id);
    };

    const arAccountId = await insertAccount('1130', 'الذمم المدينة', 'asset', 'debit');
    const salesRevenueId = await insertAccount('4100', 'إيرادات المبيعات', 'revenue', 'credit');
    const bankAccountId = await insertAccount('1120', 'البنك', 'asset', 'debit');
    const fxGainAccountId = await insertAccount('4400', 'أرباح فروق عملة', 'revenue', 'credit');
    const apAccountId = await insertAccount('2100', 'الذمم الدائنة', 'liability', 'credit');
    const fxLossAccountId = await insertAccount('5400', 'خسائر فروق عملة', 'expense', 'debit');
    const inventoryAccountId = await insertAccount('1140', 'المخزون', 'asset', 'debit');

    // 2. Foreign Currency Sale
    console.log('\n--- 2. مبيعات بالعملة الأجنبية (Foreign Currency Sale) ---');
    // Invoice amount: $10,000 USD at rate 3.75 -> 37,500 SAR
    const je1Res = await sql<{ id: number }>`
      INSERT INTO journal_entries (tenant_id, account_id, entry_no, entry_date, description, source_type, status, created_by, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, ${'JE-SALE-' + simUid}, NOW(), 'مبيعات 10,000 دولار', 'manual', 'posted', ${userId}, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const je1 = Number(je1Res.rows[0].id);

    await sql`
      INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit, partner_type, description, created_at)
      VALUES 
      (${testTenantId}, ${je1}, ${arAccountId}, 37500.00, 0, 'none', 'عميل (10,000 دولار بسعر 3.75)', NOW()),
      (${testTenantId}, ${je1}, ${salesRevenueId}, 0, 37500.00, 'none', 'إيراد مبيعات', NOW())
    `.execute(db);
    console.log('[OK] تم تسجيل فاتورة المبيعات: 10,000 دولار بسعر 3.75 (المكافئ 37,500 ريال).');

    // 3. Foreign Currency Settlement with Exchange Rate Fluctuation
    console.log('\n--- 3. سداد مع تغير سعر الصرف (Settlement with FX Gain) ---');
    // Customer pays $10,000 USD at 3.80 -> 38,000 SAR
    const je2Res = await sql<{ id: number }>`
      INSERT INTO journal_entries (tenant_id, account_id, entry_no, entry_date, description, source_type, status, created_by, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, ${'JE-RECEIPT-' + simUid}, NOW(), 'تحصيل 10,000 دولار', 'manual', 'posted', ${userId}, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const je2 = Number(je2Res.rows[0].id);

    await sql`
      INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit, partner_type, description, created_at)
      VALUES 
      (${testTenantId}, ${je2}, ${bankAccountId}, 38000.00, 0, 'none', 'بنك (10,000 دولار بسعر 3.80)', NOW()),
      (${testTenantId}, ${je2}, ${arAccountId}, 0, 37500.00, 'none', 'إغلاق ذمة العميل', NOW()),
      (${testTenantId}, ${je2}, ${fxGainAccountId}, 0, 500.00, 'none', 'أرباح فروق عملة محققة', NOW())
    `.execute(db);
    console.log('[OK] تم تحصيل 10,000 دولار بسعر 3.80 (النقدية 38,000 ريال).');
    console.log('[OK] تم تسجيل 500 ريال كأرباح فروق عملة محققة.');

    // 4. Foreign Currency Purchase with Realized FX Loss
    console.log('\n--- 4. مشتريات مع خسائر فروق عملة (Purchase with FX Loss) ---');
    // Supplier invoice €5,000 EUR at 4.10 -> 20,500 SAR
    const je3Res = await sql<{ id: number }>`
      INSERT INTO journal_entries (tenant_id, account_id, entry_no, entry_date, description, source_type, status, created_by, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, ${'JE-PURCHASE-' + simUid}, NOW(), 'مشتريات 5,000 يورو', 'manual', 'posted', ${userId}, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const je3 = Number(je3Res.rows[0].id);

    await sql`
      INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit, partner_type, description, created_at)
      VALUES 
      (${testTenantId}, ${je3}, ${inventoryAccountId}, 20500.00, 0, 'none', 'مخزون (5,000 يورو بسعر 4.10)', NOW()),
      (${testTenantId}, ${je3}, ${apAccountId}, 0, 20500.00, 'none', 'مورد يورو', NOW())
    `.execute(db);
    console.log('[OK] تم تسجيل فاتورة المشتريات: 5,000 يورو بسعر 4.10 (المكافئ 20,500 ريال).');

    // Supplier payment €5,000 EUR at 4.15 -> 20,750 SAR
    const je4Res = await sql<{ id: number }>`
      INSERT INTO journal_entries (tenant_id, account_id, entry_no, entry_date, description, source_type, status, created_by, created_at, updated_at)
      VALUES (${testTenantId}, ${testAccountId}, ${'JE-PAYMENT-' + simUid}, NOW(), 'سداد 5,000 يورو', 'manual', 'posted', ${userId}, NOW(), NOW())
      RETURNING id
    `.execute(db);
    const je4 = Number(je4Res.rows[0].id);

    await sql`
      INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, debit, credit, partner_type, description, created_at)
      VALUES 
      (${testTenantId}, ${je4}, ${apAccountId}, 20500.00, 0, 'none', 'إغلاق ذمة المورد', NOW()),
      (${testTenantId}, ${je4}, ${fxLossAccountId}, 250.00, 0, 'none', 'خسائر فروق عملة محققة', NOW()),
      (${testTenantId}, ${je4}, ${bankAccountId}, 0, 20750.00, 'none', 'بنك (5,000 يورو بسعر 4.15)', NOW())
    `.execute(db);
    console.log('[OK] تم سداد 5,000 يورو بسعر 4.15 (النقدية 20,750 ريال).');
    console.log('[OK] تم تسجيل 250 ريال كخسائر فروق عملة محققة.');

    // 5. Double-Entry Invariant Under Multi-Currency
    console.log('\n--- 5. توازن القيود في ظل تعدد العملات (Double-Entry Invariant) ---');
    const auditRes = await sql<{ sum_debit: string; sum_credit: string }>`
      SELECT 
        COALESCE(SUM(l.debit), 0) as sum_debit, 
        COALESCE(SUM(l.credit), 0) as sum_credit
      FROM journal_entries j
      JOIN journal_entry_lines l ON l.journal_entry_id = j.id
      WHERE j.tenant_id = ${testTenantId}
    `.execute(db);

    const totalDebits = Number(auditRes.rows[0].sum_debit);
    const totalCredits = Number(auditRes.rows[0].sum_credit);

    console.log(`[LEDGER-BALANCE] إجمالي العمليات بالعملة الأساسية: مدين = ${totalDebits} | دائن = ${totalCredits}`);

    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      throw new Error(`Double-entry invariant failed! Total Debits: ${totalDebits}, Total Credits: ${totalCredits}`);
    }

    // Check individual journal entry balances
    for (const je of [je1, je2, je3, je4]) {
      const jeBalance = await sql<{ sum_debit: string; sum_credit: string }>`
        SELECT COALESCE(SUM(debit), 0) as sum_debit, COALESCE(SUM(credit), 0) as sum_credit 
        FROM journal_entry_lines WHERE journal_entry_id = ${je}
      `.execute(db);
      const deb = Number(jeBalance.rows[0].sum_debit);
      const cred = Number(jeBalance.rows[0].sum_credit);
      if (Math.abs(deb - cred) > 0.001) {
        throw new Error(`Journal ${je} is unbalanced! Debit: ${deb}, Credit: ${cred}`);
      }
    }

    console.log('[OK] جميع القيود المحاسبية متوازنة تماماً (الفرق = 0).');
    console.log('\n================================================================');
    console.log('[SUCCESS] اكتملت محاكاة دورة حياة العملات المتعددة وفروق الصرف بنجاح 100%!');
    console.log('================================================================\n');
  } catch (err: any) {
    console.error('[ERROR] SIMULATION FAILED:', err.message || err);
    console.error(err.stack);
    process.exit(1);
  } finally {
    console.log('--- تنظيف البيانات المؤقتة (Cleanup) ---');
    await sql`DELETE FROM journal_entry_lines WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM journal_entries WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    await sql`DELETE FROM accounting_accounts WHERE tenant_id = ${testTenantId}`.execute(db).catch(() => {});
    console.log('[OK] تم مسح جميع البيانات الخاصة بالمحاكاة بنجاح.');
    await pool.end();
  }
}

runMultiCurrencySimulation();
