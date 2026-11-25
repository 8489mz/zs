/*
New file: backend/test/critical/wage-payout-payroll-journal.spec.ts
Pins the quick-cash-advance wage-payout branch to the payroll
payment journal (money-precision program / Phase 1 payroll P1-1;
INV-WAGE-PAYOUT-PAYROLL-JOURNAL).

THE GAP: createQuickCashAdvance ran BOTH branches through the
loan path — a loan row, one installment, and a Dr 1160 / Cr 1110
loan-disbursement journal — and the wage-payout branch additionally
marked the approved run item 'paid'. So the payroll-payment
journal (Dr 2140 / Cr 1110) was never posted for those wages:
2140 was never relieved, the item could never be paid again
through the normal path (its guard reads status 'approved'), the
books showed an advance receivable as if the employee owed the
wages back, and the loan's installment would later be deducted
from a future run. A partial payout marked the whole item paid,
with no amount check at all. The amount gate also rejected
3-decimal amounts outright (a hard-coded *100 check).

THE FIX (user decision 2026-10-30): a wage payout posts the
per-item payroll payment journal (Dr 2140 / Cr 1110) through the
existing postPayrollItemPayment primitive, creates NO loan row
and NO installments, marks the item paid WITH its journal link
(paid_at/paid_by/channel/shift/journal_entry_id, mirroring
payPayrollRunItem), and records the employee-ledger row against
the run item. The amount must equal the approved item's net pay
at book precision, and an approved item must exist — both fail
closed before any cash moves. The advance branch is unchanged.
The amount gate now runs at the tenant's book digits.

This spec drives the REAL createQuickCashAdvance against PGlite
(KWD tenant, 3 decimals), with the production posting service
and a stubbed foundation, and the withdrawal-balance eligibility
read overridden on the instance (it is a pre-transaction
authorization read, not the posting under test).

WHAT THIS PINS:
- Wage payout: zero loan rows, zero installments, one
  hr_payroll_item_payment journal at 5000.125 (2140/1110),
  item paid + journal linked, ledger row against the run item,
  drawer cash and treasury movement at book precision.
- Amount mismatch (4000 vs net 5000.125): fail-closed with
  HR_WAGE_PAYOUT_AMOUNT_MISMATCH and zero writes.
- No approved item: fail-closed with
  HR_WAGE_PAYOUT_NO_APPROVED_ITEM.
- Advance branch regression: loan + installment + 1160 journal
  still post exactly as before.
- 4-decimal amount on a 3-decimal tenant: rejected.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new HrService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    posting,
    undefined,
  );
  (service as unknown as Record<string, unknown>).getEmployeeWithdrawalBalance = async () => ({
    schedule: { isPayoutDue: true, nextPayoutDate: '2026-11-01' },
    maxDirectAdvance: 100000,
    netAvailableBalance: 100000,
  });

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
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
      CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE customers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0);
      CREATE TABLE customer_installment_plans (id bigint PRIMARY KEY, tenant_id text, plan_number text, customer_id bigint, financed_amount numeric, interest_amount numeric, branch_id bigint, created_by bigint, created_at timestamptz);
      CREATE TABLE customer_installments (id bigint PRIMARY KEY, tenant_id text, plan_id bigint, installment_number int, amount numeric, due_date date);
      CREATE TABLE accounting_installment_interest (id bigserial PRIMARY KEY, tenant_id text, plan_id bigint, installment_id bigint, recognition_date date, amount numeric, account_id text, journal_entry_id bigint, UNIQUE(tenant_id, installment_id));
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric);
      CREATE TABLE hr_employment_contracts (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, base_salary numeric, status text, start_date date, end_date date);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, status text, end_date date);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, run_id bigint, employee_id bigint, net_pay numeric, status text, paid_at timestamptz, paid_by bigint, payment_channel text, payment_reference text, shift_id bigint, journal_entry_id bigint, updated_at timestamptz);
      CREATE TABLE hr_employee_loans (id bigserial PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, loan_no text, loan_type text, principal_amount numeric, remaining_amount numeric, installment_count int, installment_amount numeric, repayment_mode text, issue_date date, disbursed_at timestamptz, status text, notes text, created_by bigint, updated_by bigint);
      CREATE TABLE hr_employee_loan_installments (id bigserial PRIMARY KEY, tenant_id text, account_id text, loan_id bigint, installment_no int, due_date date, amount numeric, status text);
      CREATE TABLE hr_employee_ledger (id bigserial PRIMARY KEY, employee_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, created_by bigint, tenant_id text, account_id text);
      CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, location_id bigint, opened_by bigint, expected_cash numeric, status text);
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      INSERT INTO tenants VALUES ('t1');
      INSERT INTO settings VALUES ('t1','currency','KWD');
      INSERT INTO currency_exchange_rates VALUES ('t1','KWD',true,1);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO branches VALUES (10,'t1',NULL);
      INSERT INTO stock_locations VALUES (20,'t1',10);
      INSERT INTO users VALUES (1,'t1','Cashier One','cashier1',NULL);
      INSERT INTO cashier_shifts VALUES (1,'t1',10,20,1,10000,'open');
      INSERT INTO hr_employees VALUES (1,'t1','Emp One','active','monthly',0,8);
      INSERT INTO hr_employees VALUES (2,'t1','Emp Two','active','monthly',0,8);
      INSERT INTO hr_employees VALUES (3,'t1','Emp Three','active','monthly',0,8);
      INSERT INTO hr_employment_contracts VALUES (1,'t1',2,10000,'active','2026-01-01',NULL);
      INSERT INTO hr_payroll_runs VALUES (7,'t1','approved','2026-10-31');
      INSERT INTO hr_payroll_runs VALUES (8,'t1','approved','2026-10-31');
      INSERT INTO hr_payroll_run_items VALUES (1,'t1',7,1,5000.125,'approved',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO hr_payroll_run_items VALUES (2,'t1',8,1,5000.125,'approved',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    `);
    for (const code of [1110, 1120, 1160, 2140]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        '',
      ]);
    }
    const count = async (table: string): Promise<number> => {
      const r = await pg.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${table}`);
      return Number(r.rows[0].c);
    };
    const journalLines = async (
      entryId: number,
    ): Promise<Array<{ account_id: number; debit: string; credit: string }>> => {
      const r = await pg.query<{ account_id: number; debit: string; credit: string }>(
        'SELECT account_id, debit::text, credit::text FROM journal_entry_lines WHERE journal_entry_id=$1 ORDER BY id',
        [entryId],
      );
      return r.rows;
    };

    // 1. Wage payout: payroll journal, no loan, no installments.
    const wage = await service.createQuickCashAdvance(
      { employeeId: 1, amount: 5000.125, notes: 'صرف أجر الفترة', actionType: 'wage_payout', shiftId: 1 },
      auth,
    );
    assert.equal(wage.success, true);
    assert.equal(wage.loanId, null);
    assert.equal(wage.payrollRunItemId, 2);
    assert.ok(Number(wage.journalEntryId) > 0);
    assert.equal(await count('hr_employee_loans'), 0);
    assert.equal(await count('hr_employee_loan_installments'), 0);
    const item = await pg.query<{ status: string; journal_entry_id: number }>(
      'SELECT status, journal_entry_id FROM hr_payroll_run_items WHERE id=2',
    );
    assert.equal(item.rows[0].status, 'paid');
    assert.equal(Number(item.rows[0].journal_entry_id), Number(wage.journalEntryId));
    const entries = await pg.query<{ source_type: string; source_id: number }>(
      'SELECT source_type, source_id FROM journal_entries',
    );
    assert.equal(entries.rows.length, 1);
    assert.equal(entries.rows[0].source_type, 'hr_payroll_item_payment');
    assert.equal(Number(entries.rows[0].source_id), 2);
    const lines = await journalLines(Number(wage.journalEntryId));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].account_id, 2140);
    assert.equal(Number(lines[0].debit), 5000.125);
    assert.equal(lines[1].account_id, 1110);
    assert.equal(Number(lines[1].credit), 5000.125);
    const ledger = await pg.query<{
      entry_type: string;
      reference_type: string;
      reference_id: number;
      balance_after: string;
    }>('SELECT entry_type, reference_type, reference_id, balance_after::text FROM hr_employee_ledger');
    assert.equal(ledger.rows.length, 1);
    assert.equal(ledger.rows[0].entry_type, 'wage_payout');
    assert.equal(ledger.rows[0].reference_type, 'hr_payroll_run_item');
    assert.equal(Number(ledger.rows[0].reference_id), 2);
    assert.equal(Number(ledger.rows[0].balance_after), 0);
    const shift = await pg.query<{ expected_cash: string }>(
      'SELECT expected_cash::text FROM cashier_shifts WHERE id=1',
    );
    assert.equal(Number(shift.rows[0].expected_cash), 4999.875);
    const treasury = await pg.query<{ amount: string }>('SELECT amount::text FROM treasury_transactions');
    assert.equal(treasury.rows.length, 1);
    assert.equal(Number(treasury.rows[0].amount), -5000.125);

    // 2. Partial amount: fail-closed, zero writes.
    await assert.rejects(
      () =>
        service.createQuickCashAdvance(
          { employeeId: 1, amount: 4000, notes: 'صرف جزئي', actionType: 'wage_payout', shiftId: 1 },
          auth,
        ),
      /HR_WAGE_PAYOUT_AMOUNT_MISMATCH/,
    );
    assert.equal(await count('journal_entries'), 1);
    assert.equal(await count('hr_employee_loans'), 0);
    const item2 = await pg.query<{ status: string }>('SELECT status FROM hr_payroll_run_items WHERE id=1');
    assert.equal(item2.rows[0].status, 'approved');

    // 3. No approved item: fail-closed.
    await assert.rejects(
      () =>
        service.createQuickCashAdvance(
          { employeeId: 3, amount: 100, notes: 'صرف بلا بند', actionType: 'wage_payout', shiftId: 1 },
          auth,
        ),
      /HR_WAGE_PAYOUT_NO_APPROVED_ITEM/,
    );
    assert.equal(await count('journal_entries'), 1);

    // 4. Advance branch regression: loan + installment + 1160 journal.
    const advance = await service.createQuickCashAdvance(
      { employeeId: 2, amount: 1000, notes: 'سلفة سريعة', actionType: 'advance', shiftId: 1 },
      auth,
    );
    assert.equal(advance.success, true);
    assert.ok(Number(advance.loanId) > 0);
    assert.equal(await count('hr_employee_loans'), 1);
    assert.equal(await count('hr_employee_loan_installments'), 1);
    const loanJournal = await pg.query<{ id: number }>(
      "SELECT id FROM journal_entries WHERE source_type='hr_employee_loan_disbursement'",
    );
    assert.equal(loanJournal.rows.length, 1);
    const loanLines = await journalLines(Number(loanJournal.rows[0].id));
    assert.equal(loanLines[0].account_id, 1160);
    assert.equal(Number(loanLines[0].debit), 1000);
    assert.equal(loanLines[1].account_id, 1110);
    assert.equal(Number(loanLines[1].credit), 1000);

    // 5. 4-decimal amount on a 3-decimal tenant: rejected at the gate.
    await assert.rejects(
      () =>
        service.createQuickCashAdvance(
          { employeeId: 2, amount: 5000.1255, notes: 'مبلغ بدقة زائدة', actionType: 'advance', shiftId: 1 },
          auth,
        ),
      /HR_AMOUNT_INVALID/,
    );

    console.log('Wage payout payroll journal tests passed.');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
