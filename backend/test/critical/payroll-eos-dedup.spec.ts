/*
 * R1 (U4): payroll/EOS duplication review — the two live duplicates the
 * review found, pinned through their single canonical engines.
 *
 * DUPLICATE 1 — delay deduction: HrService.calculatePayrollOperationalReview
 * recomputed the progressive tier loop and the standard minute rate inline,
 * byte-for-byte the same math as calculateProgressiveDelayDeduction in
 * payroll-calculation.engine (which production never called). The review
 * now calls the engine for progressive / standard / disabled; 'strict'
 * (half a day per incident, no grace) has no engine mode and stays inline.
 * Base 9000 over February 2026 (28 days): daily rate 321.43.
 *   progressive, 2 incidents (tiers 0.25 + 0.50) -> 321.43 * 0.75 = 241.07
 *   standard, 60 late + 30 early minutes -> (321.43 / 8) * 90 / 60 = 60.27
 *   strict, 2 incidents -> 321.43 * 0.5 * 2 = 321.43
 *   disabled, 3 incidents / 120 minutes -> 0
 *
 * DUPLICATE 2 — EOS absorption: AccountingPostingService
 * .postEndOfServiceSettlement recomputed the absorption pool inline
 * (assets, then other, then loans, each capped at the remaining pool),
 * the same math as calculateSettlementAbsorption in eos-calculation.engine
 * (which priced the settlement). The posting now calls the engine.
 * Over-absorbed stored row: entitlements 10,000, assets 3,000, other
 * 2,000, loans 9,000 -> applied loans 5,000, net payable 0, journal
 * Dr 6200 10,000 / Cr 1160 5,000 / Cr 7100 5,000, no 2140 leg.
 * The asserted lines are also compared against the engine's own outputs
 * for the same inputs, so the posting cannot drift from the engine.
 *
 * ROUTING PIN (why values alone are not enough): the old inline code
 * computed the SAME numbers as the engines, so a value-only spec passes
 * with the duplicates still in place. This spec therefore also counts
 * engine calls: the review must call calculateProgressiveDelayDeduction
 * once per progressive / standard / disabled employee and never for
 * 'strict', and each posting must call calculateSettlementAbsorption
 * exactly once. Reverting the two service files leaves every counter
 * at zero and the spec fails. The engines are CommonJS modules shared
 * with the services, so wrapping their exports here intercepts the
 * services' calls too; expected values are computed from the saved
 * originals so the spec's own reads never inflate the counters.
 *
 * Run: npx ts-node test/critical/payroll-eos-dedup.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { calculateProgressiveDelayDeduction } from '../../src/modules/hr/engines/payroll-calculation.engine';
import { calculateSettlementAbsorption } from '../../src/modules/hr/engines/eos-calculation.engine';

// Routing-pin handles: the same CommonJS module objects the services
// imported, so assigning a wrapper here intercepts the services' calls.
const payrollEngineModule = require('../../src/modules/hr/engines/payroll-calculation.engine') as {
  calculateProgressiveDelayDeduction: typeof calculateProgressiveDelayDeduction;
};
const eosEngineModule = require('../../src/modules/hr/engines/eos-calculation.engine') as {
  calculateSettlementAbsorption: typeof calculateSettlementAbsorption;
};

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;
const FOUNDATION_STUB = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const hr = new HrService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    {} as never,
    undefined,
  );
  let originalDelay: typeof calculateProgressiveDelayDeduction | undefined;
  let originalAbsorption: typeof calculateSettlementAbsorption | undefined;
  try {
    // Install the counting wrappers before any service call.
    originalDelay = payrollEngineModule.calculateProgressiveDelayDeduction;
    originalAbsorption = eosEngineModule.calculateSettlementAbsorption;
    let delayEngineCalls = 0;
    let absorptionEngineCalls = 0;
    payrollEngineModule.calculateProgressiveDelayDeduction = ((params: Parameters<typeof calculateProgressiveDelayDeduction>[0]) => {
      delayEngineCalls += 1;
      return (originalDelay as typeof calculateProgressiveDelayDeduction)(params);
    }) as typeof calculateProgressiveDelayDeduction;
    eosEngineModule.calculateSettlementAbsorption = ((params: Parameters<typeof calculateSettlementAbsorption>[0]) => {
      absorptionEngineCalls += 1;
      return (originalAbsorption as typeof calculateSettlementAbsorption)(params);
    }) as typeof calculateSettlementAbsorption;
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE hr_hr_settings (id bigint PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, hire_date date, end_of_service_date date, has_social_insurance boolean, insurance_salary numeric, has_income_tax boolean, pay_frequency text, user_id bigint, commission_type text, commission_value numeric, commission_target numeric, delay_policy text, approved_leave_days numeric);
      CREATE TABLE hr_attendance_records (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, work_date date, status text, check_in_at timestamptz, check_out_at timestamptz, prior_sessions_minutes integer NOT NULL DEFAULT 0);
      CREATE TABLE hr_attendance_exceptions (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, work_date date, exception_type text, approved_duration_minutes numeric, duration_minutes numeric);
      CREATE TABLE hr_leave_requests (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, start_date date, end_date date, leave_type_id bigint, total_days numeric, days_count numeric, leave_type text);
      CREATE TABLE hr_leave_types (id bigint PRIMARY KEY, tenant_id text, is_paid boolean, deduct_from_salary boolean, code text);
      CREATE TABLE hr_holidays (id bigint PRIMARY KEY, tenant_id text, holiday_date date, start_date date, end_date date);
      CREATE TABLE sales_invoices (id bigint PRIMARY KEY, tenant_id text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '', is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false, account_type text DEFAULT '');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date);
      CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, status text, closing_entry_id bigint);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
        entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
        status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
        posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
        reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
        dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
        tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
        partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE tenants (id text PRIMARY KEY);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE hr_end_of_service_settlements (id integer PRIMARY KEY, tenant_id text NOT NULL, account_id text, settlement_no text, employee_id integer, settlement_date date, gratuity_amount numeric(14,3) NOT NULL DEFAULT 0, leave_encashment_amount numeric(14,3) NOT NULL DEFAULT 0, pending_salary_amount numeric(14,3) NOT NULL DEFAULT 0, notice_period_amount numeric(14,3) NOT NULL DEFAULT 0, other_entitlements_amount numeric(14,3) NOT NULL DEFAULT 0, unpaid_loans_deduction numeric(14,3) NOT NULL DEFAULT 0, assets_deduction numeric(14,3) NOT NULL DEFAULT 0, other_deductions numeric(14,3) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', journal_entry_id integer, created_at timestamptz DEFAULT now());
    `);
    // Delay cases: one tenant per policy mode (policies are tenant-global).
    await sql.raw(`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t2', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t3', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t4', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO hr_hr_settings VALUES (1, 't1', 'payroll_policies', '{"hrDelayPolicyEnabled":true,"hrDelayPolicyFirstTimeDeduction":0.25,"hrDelayPolicySecondTimeDeduction":0.5,"hrDelayPolicyThirdTimeDeduction":1,"hrDelayPolicyFourthTimeDeduction":1}')`).execute(db);
    await sql.raw(`INSERT INTO hr_hr_settings VALUES (2, 't2', 'payroll_policies', '{"hrDelayPolicyEnabled":false}')`).execute(db);
    await sql.raw(`INSERT INTO hr_hr_settings VALUES (3, 't3', 'payroll_policies', '{"hrDelayPolicyEnabled":true}')`).execute(db);
    await sql.raw(`INSERT INTO hr_hr_settings VALUES (4, 't4', 'payroll_policies', '{"hrDelayPolicyEnabled":true}')`).execute(db);
    await sql.raw(`INSERT INTO hr_employees (id, tenant_id, display_name, status, compensation_type, hourly_rate, expected_daily_hours, hire_date, end_of_service_date, has_social_insurance, insurance_salary, has_income_tax, pay_frequency, user_id, commission_type, commission_value, commission_target, delay_policy, approved_leave_days) VALUES
      (1, 't1', 'Progressive Emp', 'active', 'monthly', 0, 8, '2026-01-01', NULL, false, 0, false, 'monthly', NULL, NULL, 0, NULL, NULL, 0),
      (2, 't2', 'Standard Emp', 'active', 'monthly', 0, 8, '2026-01-01', NULL, false, 0, false, 'monthly', NULL, NULL, 0, NULL, NULL, 0),
      (3, 't3', 'Strict Emp', 'active', 'monthly', 0, 8, '2026-01-01', NULL, false, 0, false, 'monthly', NULL, NULL, 0, NULL, 'strict', 0),
      (4, 't4', 'Disabled Emp', 'active', 'monthly', 0, 8, '2026-01-01', NULL, false, 0, false, 'monthly', NULL, NULL, 0, NULL, 'disabled', 0)`).execute(db);
    await sql.raw(`INSERT INTO hr_attendance_exceptions (id, tenant_id, employee_id, status, work_date, exception_type, approved_duration_minutes, duration_minutes) VALUES
      (1, 't1', 1, 'pending', '2026-02-03', 'late_check_in', NULL, 30),
      (2, 't1', 1, 'pending', '2026-02-10', 'late_check_in', NULL, 30),
      (3, 't2', 2, 'pending', '2026-02-03', 'late_check_in', NULL, 60),
      (4, 't2', 2, 'pending', '2026-02-10', 'early_check_out', NULL, 30),
      (5, 't3', 3, 'pending', '2026-02-03', 'late_check_in', NULL, 45),
      (6, 't3', 3, 'pending', '2026-02-10', 'late_check_in', NULL, 45),
      (7, 't4', 4, 'pending', '2026-02-03', 'late_check_in', NULL, 40),
      (8, 't4', 4, 'pending', '2026-02-10', 'late_check_in', NULL, 40),
      (9, 't4', 4, 'pending', '2026-02-17', 'late_check_in', NULL, 40)`).execute(db);

    const range = { from: '2026-02-01', to: '2026-02-28' };
    const review = (tenantId: string, employeeId: number) =>
      (hr as any).calculatePayrollOperationalReview(
        db, range, [employeeId],
        new Map([[employeeId, 9000]]), tenantId,
        new Map([[employeeId, 9000]]), undefined, 2,
      ) as Promise<Map<number, any>>;

    const progressive = await withTimeout(review('t1', 1), 25000, 'progressive review');
    assert.equal(progressive.get(1).suggestedAttendanceDeductionAmount, 241.07, 'progressive 2 incidents via engine');
    assert.equal(delayEngineCalls, 1, 'progressive review calls the delay engine once');
    const standard = await withTimeout(review('t2', 2), 25000, 'standard review');
    assert.equal(standard.get(2).suggestedAttendanceDeductionAmount, 60.27, 'standard 90 minutes via engine');
    assert.equal(delayEngineCalls, 2, 'standard review calls the delay engine once');
    const strict = await withTimeout(review('t3', 3), 25000, 'strict review');
    assert.equal(strict.get(3).suggestedAttendanceDeductionAmount, 321.43, 'strict 2 incidents stay inline');
    assert.equal(delayEngineCalls, 2, 'strict review never calls the delay engine');
    const disabled = await withTimeout(review('t4', 4), 25000, 'disabled review');
    assert.equal(disabled.get(4).suggestedAttendanceDeductionAmount, 0, 'disabled delay is zero');
    assert.equal(delayEngineCalls, 3, 'disabled review calls the delay engine once');

    // EOS absorption: over-absorbed stored row + normal row, via the posting service.
    await sql.raw(`INSERT INTO tenants VALUES ('t1')`).execute(db);
    await sql.raw(`INSERT INTO branches VALUES (10,'t1',NULL)`).execute(db);
    await sql.raw(`INSERT INTO stock_locations VALUES (20,'t1',10)`).execute(db);
    await sql.raw(`INSERT INTO users VALUES (1,'t1','Tester','tester',NULL)`).execute(db);
    await sql.raw(`INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate) VALUES ('t1', 'EGP', true, 1)`).execute(db);
    await sql.raw(`INSERT INTO accounting_settings VALUES
      (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL)`).execute(db);
    await sql.raw(`INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES
      (1110, 't1', '1110', ''), (1120, 't1', '1120', ''), (1160, 't1', '1160', ''),
      (2140, 't1', '2140', ''), (6200, 't1', '6200', ''), (7100, 't1', '7100', '')`).execute(db);
    await sql.raw(`INSERT INTO hr_end_of_service_settlements (id, tenant_id, settlement_no, employee_id, settlement_date, gratuity_amount, leave_encashment_amount, pending_salary_amount, notice_period_amount, other_entitlements_amount, unpaid_loans_deduction, assets_deduction, other_deductions, status) VALUES
      (1, 't1', 'EOS-1', 1, '2026-03-31', 6000, 1000, 3000, 0, 0, 9000, 3000, 2000, 'draft'),
      (2, 't1', 'EOS-2', 1, '2026-03-31', 6000, 1000, 3000, 0, 0, 2000, 500, 0, 'draft')`).execute(db);

    const posting = new AccountingPostingService(FOUNDATION_STUB as never);
    // Expected values from the saved original, so this read does not
    // inflate the absorption counter.
    const expectedOver = (originalAbsorption as typeof calculateSettlementAbsorption)({
      gratuityAmount: 6000, leaveEncashmentAmount: 1000, pendingSalaryAmount: 3000,
      noticePeriodAmount: 0, otherEntitlementsAmount: 0,
      unpaidLoansDeduction: 9000, assetsDeduction: 3000, otherDeductions: 2000, minorUnits: 2,
    });
    assert.equal(expectedOver.appliedLoans, 5000, 'engine caps loans at the remaining pool');
    assert.equal(expectedOver.netPayable, 0, 'engine net payable is zero when over-absorbed');
    assert.equal(absorptionEngineCalls, 0, 'no absorption call before posting');

    const resOver = await withTimeout(
      posting.postEndOfServiceSettlement(db as never, 1, null, AUTH),
      25000,
      'postEndOfServiceSettlement over-absorbed',
    );
    assert.equal(resOver.posted, true);
    assert.equal(absorptionEngineCalls, 1, 'over-absorbed posting calls the absorption engine once');
    const linesOver = await db.selectFrom('journal_entry_lines').selectAll().execute() as unknown as Array<{ journal_entry_id: number; account_id: number; debit: string; credit: string }>;
    const overEntryId = Number(resOver.journalEntryId);
    const byAccountOver = new Map<number, { debit: number; credit: number }>();
    let totalDebitOver = 0;
    let totalCreditOver = 0;
    for (const line of linesOver.filter((l) => Number(l.journal_entry_id) === overEntryId)) {
      const prev = byAccountOver.get(line.account_id) || { debit: 0, credit: 0 };
      byAccountOver.set(line.account_id, { debit: prev.debit + Number(line.debit), credit: prev.credit + Number(line.credit) });
      totalDebitOver += Number(line.debit);
      totalCreditOver += Number(line.credit);
    }
    assert.equal(totalDebitOver, totalCreditOver, 'over-absorbed journal balances');
    assert.equal(byAccountOver.get(6200)?.debit, expectedOver.totalEntitlements, 'Dr 6200 equals engine total entitlements');
    assert.equal(byAccountOver.get(1160)?.credit, expectedOver.appliedLoans, 'Cr 1160 equals engine applied loans');
    assert.equal(byAccountOver.get(7100)?.credit, expectedOver.appliedAssets + expectedOver.appliedOther, 'Cr 7100 equals engine applied assets + other');
    assert.equal(byAccountOver.has(2140), false, 'no 2140 leg when net payable is zero');

    const resNormal = await withTimeout(
      posting.postEndOfServiceSettlement(db as never, 2, null, AUTH),
      25000,
      'postEndOfServiceSettlement normal',
    );
    assert.equal(resNormal.posted, true);
    assert.equal(absorptionEngineCalls, 2, 'normal posting calls the absorption engine once');
    const linesNormal = await db.selectFrom('journal_entry_lines').selectAll().execute() as unknown as Array<{ journal_entry_id: number; account_id: number; debit: string; credit: string }>;
    const normalEntryId = Number(resNormal.journalEntryId);
    const byAccountNormal = new Map<number, { debit: number; credit: number }>();
    for (const line of linesNormal.filter((l) => Number(l.journal_entry_id) === normalEntryId)) {
      const prev = byAccountNormal.get(line.account_id) || { debit: 0, credit: 0 };
      byAccountNormal.set(line.account_id, { debit: prev.debit + Number(line.debit), credit: prev.credit + Number(line.credit) });
    }
    assert.equal(byAccountNormal.get(6200)?.debit, 10000, 'Dr 6200 total entitlements');
    assert.equal(byAccountNormal.get(1160)?.credit, 2000, 'Cr 1160 applied loans');
    assert.equal(byAccountNormal.get(7100)?.credit, 500, 'Cr 7100 applied assets');
    assert.equal(byAccountNormal.get(2140)?.credit, 7500, 'Cr 2140 net payable');
    console.log('payroll-eos-dedup.spec: ok (delay 241.07 / 60.27 / 321.43 / 0, engine calls 3, strict 0; EOS over-absorbed net 0, normal Cr 2140 7500, absorption calls 2)');
  } finally {
    if (originalDelay) payrollEngineModule.calculateProgressiveDelayDeduction = originalDelay;
    if (originalAbsorption) eosEngineModule.calculateSettlementAbsorption = originalAbsorption;
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
