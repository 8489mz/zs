/*
New file: backend/test/critical/payroll-accrual-book-precision.spec.ts
PGlite spec (no duplicated formulas): drives the production payroll
accrual allocator and the production postPayrollAccrual posting method
on a KWD tenant (3 book digits) and asserts exact 3dp journal amounts.

WHAT THIS PINS: the payroll accrual allocator was the one engine the
HR book-precision package missed (INV-HR-PAYROLL-BOOK-PRECISION claimed
posting runs "entirely at book precision, never a hard-coded 2", but
allocatePayrollAccrual still converted every total to integer cents and
postPayrollAccrual built its journal with bare addLine calls at the 2dp
default). Two failure modes on a 3-decimal tenant, both reproduced
here: (1) book-exact totals whose cents roundings do not reconcile are
rejected outright (gross 10.008 = 5.002 + 2.002 + 1.002 + 2.002 becomes
1001 cents against 1000), so a valid KWD accrual cannot post at all;
(2) when the cents check happens to pass, the salary-expense debit is
posted 0.005 high (gross 10.125, net 9.000, deductions 1.125 -> expense
10.130) and every other line is re-rounded to cents by addLine, while
the credits stay book-exact only by accident of the plug tolerance.

The fix threads the tenant's required minorUnits through the allocator
(integer minor-unit arithmetic, the payroll-loan-allocation idiom) and
builds the journal with addBookLine. This spec pins both legs: the
pure-engine cases pin the allocator, and the PGlite cases drive the
real posting method and assert exact 3dp lines with no 7290 plug.
2-decimal behaviour is pinned by the existing
hr-payroll-accrual-allocation.spec.ts (updated to pass minorUnits 2
explicitly) and is unchanged.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { allocatePayrollAccrual } from '../../src/modules/hr/engines/payroll-accrual-allocation.engine';

function testAllocatorAtBookPrecision(): void {
  // Case 1 (spurious block): book-exact totals that do not reconcile in cents.
  const blocked = allocatePayrollAccrual(
    {
      grossPay: 10.008,
      netPay: 5.002,
      loanDeductions: 2.002,
      assetRecoveryDeductions: 1.002,
      operationalDeductions: 2.002,
      employeeInsurance: 1.001,
      employerInsurance: 0.5,
      incomeTax: 1.001,
    },
    3,
  );
  assert.equal(blocked.salaryExpense, 10.008);
  assert.equal(blocked.wageReduction, 0);
  assert.equal(blocked.totalDebit, 10.508);
  assert.equal(blocked.totalCredit, 10.508);

  // Case 2 (silent misstatement): the cents check passes but the expense is 0.005 high.
  const misstated = allocatePayrollAccrual(
    {
      grossPay: 10.125,
      netPay: 9.0,
      loanDeductions: 0,
      assetRecoveryDeductions: 0,
      operationalDeductions: 1.125,
      employeeInsurance: 0,
      employerInsurance: 0,
      incomeTax: 1.125,
    },
    3,
  );
  assert.equal(misstated.salaryExpense, 10.125);
  assert.equal(misstated.totalDebit, 10.125);
  assert.equal(misstated.totalCredit, 10.125);

  // Finer-than-book inputs fail closed instead of rounding silently.
  assert.throws(() =>
    allocatePayrollAccrual(
      {
        grossPay: 10.0085,
        netPay: 5.002,
        loanDeductions: 2.002,
        assetRecoveryDeductions: 1.002,
        operationalDeductions: 2.002,
        employeeInsurance: 1.001,
        employerInsurance: 0.5,
        incomeTax: 1.001,
      },
      3,
    ),
  );
  assert.throws(() =>
    allocatePayrollAccrual(
      {
        grossPay: -10.008,
        netPay: 5.002,
        loanDeductions: 2.002,
        assetRecoveryDeductions: 1.002,
        operationalDeductions: 2.002,
        employeeInsurance: 1.001,
        employerInsurance: 0.5,
        incomeTax: 1.001,
      },
      3,
    ),
  );

  // A 3dp total under a 2dp book also fails closed rather than rounding.
  assert.throws(() =>
    allocatePayrollAccrual(
      {
        grossPay: 10.008,
        netPay: 5.002,
        loanDeductions: 2.002,
        assetRecoveryDeductions: 1.002,
        operationalDeductions: 2.002,
        employeeInsurance: 1.001,
        employerInsurance: 0.5,
        incomeTax: 1.001,
      },
      2,
    ),
  );

  console.log('Payroll accrual allocator book-precision tests passed');
}

async function main() {
  testAllocatorAtBookPrecision();

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const inTx = <T>(fn: (trx: any) => Promise<T>): Promise<T> => db.transaction().execute(fn);
  try {
    await pg.exec(`
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
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates VALUES ('t1','KWD',true,1);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, end_date date);
      INSERT INTO hr_payroll_runs VALUES (7,'t1','2026-10-31'), (8,'t1','2026-10-31');
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, run_id bigint, employee_id bigint,
        gross_pay numeric, net_pay numeric, deduction_amount numeric, loan_deduction_amount numeric,
        asset_recovery_deduction_amount numeric, employee_social_insurance numeric,
        employer_social_insurance numeric, income_tax numeric, status text);
      INSERT INTO hr_payroll_run_items VALUES
        (1,'t1',7,3,10.008,5.002,2.002,2.002,1.002,1.001,0.5,1.001,'reviewed'),
        (2,'t1',8,3,10.125,9.0,1.125,0,0,0,0,1.125,'reviewed');
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    `);
    for (const code of [1110, 1120, 1160, 2140, 2145, 2146, 6200, 6210, 7100, 7290]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        '',
      ]);
    }
    const amount = async (id: number, code: number, side: 'debit' | 'credit') => {
      const rows = await pg.query<{ amount: string }>(
        `SELECT coalesce(sum(${side}),0) AS amount FROM journal_entry_lines WHERE journal_entry_id=$1 AND account_id=$2`,
        [id, code],
      );
      return Number(rows.rows[0].amount);
    };

    // 1. Spurious-block case: a valid KWD accrual posts at exact 3dp amounts.
    const accrual = await inTx((trx) => posting.postPayrollAccrual(trx, 7, auth));
    assert.equal(accrual.posted, true);
    assert.equal(await amount(accrual.journalEntryId!, 6200, 'debit'), 10.008);
    assert.equal(await amount(accrual.journalEntryId!, 6210, 'debit'), 0.5);
    assert.equal(await amount(accrual.journalEntryId!, 2140, 'credit'), 5.002);
    assert.equal(await amount(accrual.journalEntryId!, 2145, 'credit'), 1.501);
    assert.equal(await amount(accrual.journalEntryId!, 2146, 'credit'), 1.001);
    assert.equal(await amount(accrual.journalEntryId!, 1160, 'credit'), 2.002);
    assert.equal(await amount(accrual.journalEntryId!, 7100, 'credit'), 1.002);
    assert.equal(await amount(accrual.journalEntryId!, 7290, 'debit'), 0);
    assert.equal(await amount(accrual.journalEntryId!, 7290, 'credit'), 0);

    // The existing-journal guard still returns the same entry without re-posting.
    const replay = await inTx((trx) => posting.postPayrollAccrual(trx, 7, auth));
    assert.equal(replay.posted, false);
    assert.equal(replay.journalEntryId, accrual.journalEntryId);

    // 2. Silent-misstatement case: expense and credits stay exactly 3dp (old: 10.13 / 9.00 / 1.13).
    const accrual2 = await inTx((trx) => posting.postPayrollAccrual(trx, 8, auth));
    assert.equal(accrual2.posted, true);
    assert.equal(await amount(accrual2.journalEntryId!, 6200, 'debit'), 10.125);
    assert.equal(await amount(accrual2.journalEntryId!, 2140, 'credit'), 9);
    assert.equal(await amount(accrual2.journalEntryId!, 2146, 'credit'), 1.125);
    assert.equal(await amount(accrual2.journalEntryId!, 7290, 'debit'), 0);
    assert.equal(await amount(accrual2.journalEntryId!, 7290, 'credit'), 0);

    console.log('Payroll accrual book precision tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
