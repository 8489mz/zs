/*
 * Loan-repayment undistributed tolerance follows tenant book digits (F6):
 * at 3dp a 0.001 remainder is ONE minor unit and must fail closed — never
 * strand silently while the loan is marked repaid. INV-LOAN-REPAY-BOOK-DIGITS-TOLERANCE.
 *
 * Harness: the proof's S5 service-level harness, verbatim (fresh PGlite
 * per case, raw DDL, real HrService, treasury/posting stubs — the
 * tolerance check runs before any journal posting). Every service call
 * is wrapped in a 25s timeout guard: a silent hang is a failure, never
 * a pass.
 *
 * Bars: KWD repay 100.000 vs installment 99.999 -> throws
 * HR_LOAN_REPAYMENT_INSTALLMENT_MISMATCH (409), loan + installment
 * unchanged, zero treasury calls, zero ledger rows (the transaction
 * rolls back). Controls: KWD 99.999 vs 99.999 succeeds (loan repaid,
 * installment paid, 1 treasury call); EGP 100.00 vs 99.99 throws
 * (2dp behaviour unchanged); EGP 99.99 vs 99.99 succeeds.
 * Run: npx ts-node test/critical/loan-repay-book-digits-tolerance.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;
const AUDIT_STUB = { log: async () => ({}) } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

async function newDb(): Promise<Kysely<any>> {
  const pg = new PGlite();
  return new Kysely({ dialect: new PGliteDialect(pg) });
}

async function execAll(db: Kysely<any>, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
}

const DDL = [
  `CREATE TABLE settings (tenant_id text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (tenant_id, key))`,
  `CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric)`,
  `CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text)`,
  `CREATE TABLE hr_payroll_loan_deduction_allocations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text, payroll_run_id integer, payroll_run_item_id integer, employee_id integer, loan_id integer, installment_id integer, amount numeric(14,3), ledger_id integer, created_by integer, created_at timestamptz DEFAULT now())`,
  `CREATE TABLE hr_employees (id integer PRIMARY KEY, tenant_id text NOT NULL, display_name text, status text)`,
  `CREATE TABLE hr_employee_loans (id integer PRIMARY KEY, tenant_id text NOT NULL, account_id text, employee_id integer NOT NULL, employee_name text, loan_no text, loan_type text, principal_amount numeric(14,3), paid_amount numeric(14,3) NOT NULL DEFAULT 0, remaining_amount numeric(14,3) NOT NULL DEFAULT 0, installment_count integer, installment_amount numeric(14,3), repayment_mode text, issue_date date, disbursed_at timestamptz, status text NOT NULL DEFAULT 'draft', notes text, created_by integer, updated_by integer, branch_id integer, location_id integer, approved_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`,
  `CREATE TABLE hr_employee_loan_installments (id integer PRIMARY KEY, tenant_id text NOT NULL, account_id text, loan_id integer NOT NULL, installment_no integer, due_date date, amount numeric(14,3) NOT NULL, paid_amount numeric(14,3) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending', paid_at timestamptz, updated_at timestamptz DEFAULT now())`,
  `CREATE TABLE hr_employee_ledger (id bigserial PRIMARY KEY, employee_id integer NOT NULL, entry_type text, amount numeric(14,3), balance_after numeric(14,3), note text, repayment_method text, reference_type text, reference_id integer, branch_id integer, location_id integer, created_by integer, tenant_id text, account_id text, created_at timestamptz DEFAULT now())`,
];

async function seed(db: Kysely<any>, currency: string, loanAmount: number, installmentAmount: number): Promise<void> {
  await execAll(db, [
    ...DDL,
    `INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', '${currency}')`,
    `INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate) VALUES ('t1', '${currency}', true, 1)`,
    `INSERT INTO hr_employees (id, tenant_id, display_name, status) VALUES (1, 't1', 'Ahmed', 'active')`,
    `INSERT INTO users (id, tenant_id, display_name, username) VALUES (1, 't1', 'Tester', 'tester')`,
    `INSERT INTO hr_employee_loans (id, tenant_id, account_id, employee_id, employee_name, loan_no, loan_type, principal_amount, paid_amount, remaining_amount, installment_count, installment_amount, repayment_mode, issue_date, disbursed_at, status) VALUES
      (1, 't1', 'a1', 1, 'Ahmed', 'L-1', 'loan', ${loanAmount}, 0, ${loanAmount}, 1, ${installmentAmount}, 'manual', '2026-02-01', '2026-02-01', 'partially_repaid')`,
    `INSERT INTO hr_employee_loan_installments (id, tenant_id, account_id, loan_id, installment_no, due_date, amount, paid_amount, status) VALUES
      (1, 't1', 'a1', 1, 1, '2026-03-01', ${installmentAmount}, 0, 'partial')`,
  ]);
}

interface CaseResult {
  error: unknown;
  loan: { remaining_amount: string; status: string };
  installment: { paid_amount: string; status: string };
  treasuryCalls: number;
  ledgerRows: number;
}

async function runCase(currency: string, loanAmount: number, installmentAmount: number, repayAmount: number): Promise<CaseResult> {
  const db = await newDb();
  try {
    await seed(db, currency, loanAmount, installmentAmount);
    const treasuryCalls: Array<Record<string, unknown>> = [];
    const postingStub = { postEmployeeLoanManualRepayment: async () => ({}) } as never;
    const treasuryStub = { recordLoanRepayment: async (_trx: unknown, payload: Record<string, unknown>) => { treasuryCalls.push(payload); } } as never;
    const service = new HrService(db, new TransactionHelper(), AUDIT_STUB, treasuryStub, postingStub, undefined);
    let error: unknown = null;
    try {
      await withTimeout(service.repayLoan(1, { amount: repayAmount, repaymentMethod: 'manual_cash', note: 'spec' } as never, AUTH), 25000, 'repayLoan');
    } catch (caught) { error = caught; }
    const loan = await db.selectFrom('hr_employee_loans').selectAll().executeTakeFirstOrThrow() as CaseResult['loan'];
    const installment = await db.selectFrom('hr_employee_loan_installments').selectAll().executeTakeFirstOrThrow() as CaseResult['installment'];
    const ledger = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM hr_employee_ledger`.execute(db);
    return { error, loan, installment, treasuryCalls: treasuryCalls.length, ledgerRows: Number(ledger.rows[0]?.n || 0) };
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  // KWD (3dp) bar: 0.001 undistributed must fail closed.
  const kwdThrow = await runCase('KWD', 100, 99.999, 100);
  assert.equal((kwdThrow.error as any)?.code, 'HR_LOAN_REPAYMENT_INSTALLMENT_MISMATCH', 'KWD 0.001 remainder throws mismatch');
  assert.equal((kwdThrow.error as any)?.statusCode, 409, 'KWD mismatch is 409');
  assert.equal(Number(kwdThrow.loan.remaining_amount), 100, 'KWD loan unchanged after throw');
  assert.equal(kwdThrow.loan.status, 'partially_repaid', 'KWD loan stays partially_repaid');
  assert.equal(Number(kwdThrow.installment.paid_amount), 0, 'KWD installment unchanged after throw');
  assert.equal(kwdThrow.treasuryCalls, 0, 'KWD zero treasury calls after throw');
  assert.equal(kwdThrow.ledgerRows, 0, 'KWD zero ledger rows after throw');

  // KWD control: exact settlement succeeds.
  const kwdOk = await runCase('KWD', 99.999, 99.999, 99.999);
  assert.equal(kwdOk.error, null, 'KWD exact repay succeeds');
  assert.equal(Number(kwdOk.loan.remaining_amount), 0, 'KWD loan fully repaid');
  assert.equal(kwdOk.loan.status, 'repaid', 'KWD loan status repaid');
  assert.equal(Number(kwdOk.installment.paid_amount), 99.999, 'KWD installment fully paid');
  assert.equal(kwdOk.installment.status, 'paid', 'KWD installment status paid');
  assert.equal(kwdOk.treasuryCalls, 1, 'KWD one treasury call');
  assert.equal(kwdOk.ledgerRows, 1, 'KWD one ledger row');

  // EGP (2dp) control: 0.01 remainder still throws (behaviour unchanged).
  const egpThrow = await runCase('EGP', 100, 99.99, 100);
  assert.equal((egpThrow.error as any)?.code, 'HR_LOAN_REPAYMENT_INSTALLMENT_MISMATCH', 'EGP 0.01 remainder throws mismatch');
  assert.equal(Number(egpThrow.loan.remaining_amount), 100, 'EGP loan unchanged after throw');

  // EGP control: exact settlement succeeds.
  const egpOk = await runCase('EGP', 99.99, 99.99, 99.99);
  assert.equal(egpOk.error, null, 'EGP exact repay succeeds');
  assert.equal(egpOk.loan.status, 'repaid', 'EGP loan status repaid');

  console.log('loan-repay-book-digits-tolerance.spec: ok (KWD throw / KWD exact / EGP throw / EGP exact)');
}

main();
