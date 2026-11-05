/*
 * WPS review export for paid runs (D5 + D8): the review CSV exports paid
 * runs too (the items filter must match the run-status gate), exporting
 * bank details requires payroll-manage permission, every export is logged
 * (who, when, which run — via the audit log), and certified SIF content
 * stays disabled (empty) for every run. INV-WPS-PAID-RUN-EXPORT.
 *
 * Bar: fully paid run exports 2 employees / 3,000 with sifContent '';
 * approved control still 2 / 3,000; view-only caller gets
 * HR_PAYROLL_EXPORT_FORBIDDEN; the audit log records both exports.
 * Run: npx ts-node test/critical/wps-paid-run-export.spec.ts (from backend/).
 */

import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { HrService } from '../../src/modules/hr/hr.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';

const MANAGE_AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: ['hrPayrollManage'] } as never;
const VIEW_AUTH = { tenantId: 't1', accountId: 'a1', userId: 2, username: 'viewer', role: 'admin', permissions: ['hrPayrollView'] } as never;
const FOUNDATION_STUB = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db: Kysely<any> = new Kysely({ dialect: new PGliteDialect(pg) });
  try {
    const statements = [
      `CREATE TABLE settings (tenant_id text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (tenant_id, key))`,
      `CREATE TABLE hr_employees (id integer PRIMARY KEY, tenant_id text NOT NULL, employee_no text, national_id text, display_name text, bank_name text, bank_account_number text, iban text, bank_swift_code text)`,
      `CREATE TABLE hr_payroll_runs (id integer PRIMARY KEY, tenant_id text NOT NULL, status text NOT NULL, period_month text, name text, start_date date, end_date date)`,
      `CREATE TABLE hr_payroll_run_items (id integer PRIMARY KEY, tenant_id text NOT NULL, run_id integer NOT NULL, employee_id integer NOT NULL, status text NOT NULL, net_pay numeric(14,3) NOT NULL, base_salary numeric(14,3), allowance_amount numeric(14,3), deduction_amount numeric(14,3), loan_deduction_amount numeric(14,3), asset_recovery_deduction_amount numeric(14,3))`,
      `CREATE TABLE journal_entries (id integer PRIMARY KEY, tenant_id text NOT NULL, source_type text, source_id integer, status text NOT NULL, reversed_by_entry_id integer)`,
      `INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', 'KWD')`,
      `INSERT INTO hr_employees (id, tenant_id, employee_no, national_id, display_name, bank_name, bank_account_number, iban, bank_swift_code) VALUES
        (1, 't1', 'E1', '123456789012', 'Ahmed', 'NBK', '100200300', 'KW81CBKU0000000000000100200300', 'CBKUKWKW'),
        (2, 't1', 'E2', '123456789013', 'Sara', 'KFH', '400500600', 'KW81KFH0000000000000400500600', 'KFHOKWKW')`,
      `INSERT INTO journal_entries (id, tenant_id, source_type, source_id, status, reversed_by_entry_id) VALUES (10, 't1', 'hr_payroll_accrual', 1, 'posted', NULL), (11, 't1', 'hr_payroll_accrual', 2, 'posted', NULL)`,
      `INSERT INTO hr_payroll_runs (id, tenant_id, status, period_month, name, start_date, end_date) VALUES
        (1, 't1', 'paid', '2026-03', 'March 2026', '2026-03-01', '2026-03-31'),
        (2, 't1', 'approved', '2026-03', 'March 2026', '2026-03-01', '2026-03-31')`,
      `INSERT INTO hr_payroll_run_items (id, tenant_id, run_id, employee_id, status, net_pay, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount) VALUES
        (1, 't1', 1, 1, 'paid', 1000, 1000, 0, 0, 0, 0),
        (2, 't1', 1, 2, 'paid', 2000, 2000, 0, 0, 0, 0),
        (3, 't1', 2, 1, 'approved', 1000, 1000, 0, 0, 0, 0),
        (4, 't1', 2, 2, 'approved', 2000, 2000, 0, 0, 0, 0)`,
    ];
    for (const statement of statements) {
      await sql.raw(statement).execute(db);
    }
    const auditCalls: Array<{ action: string; details: string; username: string }> = [];
    const auditStub = {
      log: async (action: string, details: string, auth: { username: string }) => {
        auditCalls.push({ action, details, username: auth.username });
        return {};
      },
    } as never;
    const posting = new AccountingPostingService(FOUNDATION_STUB as never);
    const service = new HrService(db, new TransactionHelper(), auditStub, {} as never, posting, undefined);

    // Paid run exports the review CSV (D5): 2 employees / 3,000, SIF empty.
    const paid = await withTimeout(service.generatePayrollWps(1, {} as never, MANAGE_AUTH), 25000, 'generatePayrollWps(paid run)') as Record<string, any>;
    assert.equal(paid.summary.totalEmployees, 2, 'paid run exports 2 employees');
    assert.equal(paid.summary.totalNetPay, 3000, 'paid run total net 3000');
    assert.equal(paid.sifContent, '', 'certified SIF stays disabled');
    assert.match(String(paid.csvContent), /Ahmed/, 'paid CSV names Ahmed');
    assert.match(String(paid.csvContent), /Sara/, 'paid CSV names Sara');

    // Approved control unchanged.
    const approved = await withTimeout(service.generatePayrollWps(2, {} as never, MANAGE_AUTH), 25000, 'generatePayrollWps(approved run)') as Record<string, any>;
    assert.equal(approved.summary.totalEmployees, 2, 'approved control 2 employees');
    assert.equal(approved.summary.totalNetPay, 3000, 'approved control total 3000');

    // D8: every export is logged — who, which run.
    assert.equal(auditCalls.length, 2, 'both exports logged');
    assert.match(auditCalls[0].details, /Payroll run #1/, 'paid export log names run 1');
    assert.match(auditCalls[0].details, /tester/, 'paid export log names the user');
    assert.match(auditCalls[1].details, /Payroll run #2/, 'approved export log names run 2');

    // View-only caller is refused (D5 permission half).
    let forbidden: unknown = null;
    try {
      await withTimeout(service.generatePayrollWps(1, {} as never, VIEW_AUTH), 25000, 'generatePayrollWps(view-only)');
    } catch (error) { forbidden = error; }
    assert.ok(forbidden, 'view-only export throws');
    assert.equal((forbidden as any)?.code, 'HR_PAYROLL_EXPORT_FORBIDDEN', 'view-only code');
    assert.equal((forbidden as any)?.statusCode, 403, 'view-only status 403');
    assert.equal(auditCalls.length, 2, 'refused export is not logged as an export');

    console.log('wps-paid-run-export.spec: ok (paid 2/3000, SIF empty, manage-only, 2 audit logs)');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
