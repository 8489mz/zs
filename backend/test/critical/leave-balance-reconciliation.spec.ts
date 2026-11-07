/*
 * INV-LEAVE-BALANCE-NOT-DEDUCTING: an approved annual leave must move
 * the employee balance even when the approval was posted BEFORE the
 * forward deduction existed.
 *
 * THE BUG (live, test10k employee 001): an approved 2-day annual
 * leave leaves the profile at 21 remaining / 0 used, expected 19.
 * The stored `used_annual_leaves` counter only moves on approvals
 * posted after the Batch 7 fix, and the deploy-time backfill
 * (migration 2040000000194) only counted requests approved before it
 * ran — an approval in between was counted NOWHERE. The profile,
 * the employee list and the portal all read the stored counter raw,
 * and the approval guard capped against it too, so a stale counter
 * could also let a later approval exceed the entitlement.
 *
 * RULES PINNED HERE, driving the REAL HrService + EmployeePortalService
 * on PGlite:
 * 1. The reported case: an already-approved 2-day annual leave with
 *    the stored counter still 0 reads used 2 / remaining 19 in the
 *    profile, the employee list and the portal.
 * 2. Approving a 2-day annual leave still deducts 2 days (forward
 *    path), and cancelling it releases the days back.
 * 3. A non-deducting type (sick, flag off) never deducts — neither
 *    at approval nor through the reconcile.
 * 4. The approval guard caps against the RECONCILED used days: with
 *    2 days already used (reconciled), a 20-day request is refused.
 * 5. A flag-on non-annual type (training) counts in the reconcile.
 * 6. Annual identity is the same word in every branch: a typed type
 *    named `اعتيادية`, and a request text holding a type name
 *    (`إجازة سنوية`) when the type row join misses, both deduct —
 *    exactly like the legacy text-only `اعتيادية` already did.
 *
 * Prospective only: approvals already posted stay as stored; the
 * balance READ reconciles them, no posted journal or closed period
 * is rewritten (leave balances post no journals).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { EmployeePortalService } from '../../src/modules/hr/employee-portal.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { deductibleApprovedLeaveDays, shouldDeductLeaveFromBalance } from '../../src/modules/hr/engines/leave-balance.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = {
  userId: 1,
  sessionId: 'sess-spec',
  username: 'actor-1',
  role: 'admin',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

async function storedUsed(pg: PGlite, employeeId: number): Promise<number> {
  const res = await pg.query<{ used_annual_leaves: string }>(
    `SELECT used_annual_leaves::text FROM hr_employees WHERE id = ${employeeId}`,
  );
  return Number(res.rows[0]?.used_annual_leaves || 0);
}

async function requestId(pg: PGlite, employeeId: number): Promise<number> {
  const res = await pg.query<{ id: number }>(
    `SELECT id FROM hr_leave_requests WHERE employee_id = ${employeeId} ORDER BY id DESC LIMIT 1`,
  );
  return Number(res.rows[0].id);
}

async function profileUsed(pg: PGlite, hr: HrService, employeeId: number): Promise<{ used: number; remaining: number }> {
  const profile = (await hr.getEmployeeProfile(employeeId, AUTH)) as { employee: { annualLeaveBalance: number; usedAnnualLeaves: number } };
  return {
    used: profile.employee.usedAnnualLeaves,
    remaining: profile.employee.annualLeaveBalance - profile.employee.usedAnnualLeaves,
  };
}

/** Insert an already-approved request, as posted before the forward deduction existed. */
async function insertApprovedLeave(
  pg: PGlite,
  employeeId: number,
  leaveTypeId: number | null,
  leaveTypeText: string | null,
  days: number,
  start: string,
  end: string,
): Promise<void> {
  const typeId = leaveTypeId == null ? 'NULL' : String(leaveTypeId);
  const text = leaveTypeText == null ? 'NULL' : `'${leaveTypeText.replace(/'/g, "''")}'`;
  await pg.query(
    `INSERT INTO hr_leave_requests (tenant_id, account_id, employee_id, leave_type_id, leave_type, start_date, end_date, days_count, status, created_by, updated_by, created_at, updated_at)
     VALUES ('t1', 'a1', ${employeeId}, ${typeId}, ${text}, '${start}'::date, '${end}'::date, ${days}, 'approved', 1, 1, NOW(), NOW())`,
  );
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const hr = new HrService(db, new TransactionHelper(), { log: async () => {} } as never, {} as never, {} as never, undefined);
  const portal = new EmployeePortalService(db as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_no text, national_id text, pin_hash text, pin_salt text, user_id bigint, first_name text, last_name text, display_name text, status text, department_id bigint, job_title_id bigint, position_id bigint, branch_id bigint, location_id bigint, hire_date date, end_of_service_date date, notes text, compensation_type text, pay_frequency text, hourly_rate numeric, expected_daily_hours numeric, scheduled_check_in_time text, scheduled_check_out_time text, grace_minutes int, overtime_policy text, attendance_policy text, commission_type text, commission_value numeric, commission_target numeric, delay_policy text, has_social_insurance boolean, insurance_salary numeric, has_income_tax boolean, bank_name text, bank_account_number text, iban text, bank_swift_code text, annual_leave_balance numeric, used_annual_leaves numeric, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_job_titles (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_positions (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
      CREATE TABLE hr_employee_contacts (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, contact_type text, value text, label text, is_primary boolean, notes text, created_by bigint, updated_by bigint);
      CREATE TABLE hr_employee_documents (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, title text, document_type text, file_url text, expiry_date date, notes text, uploaded_by bigint);
      CREATE TABLE hr_leave_types (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, description text, is_paid boolean, is_active boolean, deducts_from_balance boolean, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_leave_requests (id bigserial PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, leave_type_id bigint, leave_type text, start_date date, end_date date, days_count numeric, status text, reason text, notes text, decision_notes text, decided_by bigint, decided_at timestamptz, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, account_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, updated_at timestamptz);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, account_id text, run_id bigint, employee_id bigint, contract_id bigint, base_salary numeric, allowance_amount numeric, deduction_amount numeric, loan_deduction_amount numeric, asset_recovery_deduction_amount numeric, employee_social_insurance numeric, employer_social_insurance numeric, income_tax numeric, penalty_deduction numeric, carried_forward_deduction numeric, gross_pay numeric, net_pay numeric, status text, notes text, paid_at timestamptz, paid_by bigint, payment_channel text, journal_entry_id bigint, updated_at timestamptz);
      CREATE TABLE hr_employment_contracts (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, contract_no text, contract_type text, status text, start_date text, end_date text, base_salary numeric, currency text);
      CREATE TABLE hr_compensation_packages (id bigserial PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, contract_id bigint, package_name text, allowance_amount numeric, deduction_amount numeric, effective_from text, effective_to text, notes text);
      CREATE TABLE hr_employee_loans (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, remaining_amount numeric, status text);
      CREATE TABLE hr_employee_assets (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, asset_type text, asset_name text, asset_code text, serial_no text, assigned_at text, status text);
      INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', 'EGP');
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (1, 't1', 'E1', 'Emp', 'One', 'Emp One', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (2, 't1', 'E2', 'Emp', 'Two', 'Emp Two', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (3, 't1', 'E3', 'Emp', 'Three', 'Emp Three', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (4, 't1', 'E4', 'Emp', 'Four', 'Emp Four', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (5, 't1', 'E5', 'Emp', 'Five', 'Emp Five', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (1, 't1', 'إجازة سنوية', 'annual', true, true, false);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (2, 't1', 'إجازة مرضية', 'sick', true, true, false);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (3, 't1', 'تدريب', 'training', true, true, true);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (4, 't1', 'إجازة اعتيادية', 'regular', true, true, false);
    `);

    // 6. The shared rule, pinned directly (annual identity is one word
    // in every branch).
    assert.equal(
      shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: 4, leaveTypeCode: 'regular', leaveTypeName: 'إجازة اعتيادية' }),
      true, 'a type named اعتيادية is annual even with the flag off',
    );
    assert.equal(
      shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: 9, leaveTypeCode: null, leaveTypeName: null, leaveTypeText: 'إجازة سنوية' }),
      true, 'a request text holding the annual type name deducts when the type row join misses',
    );
    assert.equal(
      shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: 2, leaveTypeCode: 'sick', leaveTypeName: 'إجازة مرضية', leaveTypeText: 'إجازة مرضية' }),
      false, 'a sick type with the flag off does not deduct',
    );
    assert.equal(
      deductibleApprovedLeaveDays([
        { daysCount: 2, leaveTypeId: 1, leaveTypeCode: 'annual', leaveTypeName: 'إجازة سنوية' },
        { daysCount: 3, leaveTypeId: 2, leaveTypeCode: 'sick', leaveTypeName: 'إجازة مرضية' },
        { daysCount: 1, leaveTypeId: 3, leaveTypeCode: 'training', leaveTypeName: 'تدريب', deductsFromBalance: true },
      ]),
      3, 'the reconcile sums deductible approved days only (2 annual + 1 flag-on training, sick excluded)',
    );

    // 1. The reported case: an approved 2-day annual leave whose
    // stored counter never moved (posted before the forward deduction).
    await insertApprovedLeave(pg, 1, 1, 'إجازة سنوية', 2, '2026-11-02', '2026-11-03');
    assert.equal(await storedUsed(pg, 1), 0, 'stored counter stays 0 for the pre-fix approval');
    const e1 = await profileUsed(pg, hr, 1);
    assert.equal(e1.used, 2, 'profile must read used 2 for the already-approved annual leave');
    assert.equal(e1.remaining, 19, 'profile remaining must be 19, not 21');
    const listed = (await hr.listEmployees({}, AUTH)) as { employees: { id: string; usedAnnualLeaves: number }[] };
    assert.equal(listed.employees.find((row) => row.id === '1')?.usedAnnualLeaves, 2, 'employee list must read the same used 2');
    const portalE1 = (await portal.getLeaves(1, 't1')) as { balances: { usedDays: number; remainingDays: number }[] };
    assert.equal(portalE1.balances[0]?.usedDays, 2, 'portal must read used 2');
    assert.equal(portalE1.balances[0]?.remainingDays, 19, 'portal remaining must be 19');

    // 2. Forward path: approving a 2-day annual leave deducts 2 days.
    await hr.createLeaveRequest({ employeeId: 2, leaveTypeId: 1, startDate: '2026-11-08', endDate: '2026-11-09' } as never, AUTH);
    assert.equal(await storedUsed(pg, 2), 0, 'creating the request must not move the balance');
    await hr.approveLeaveRequest(await requestId(pg, 2), {} as never, AUTH);
    assert.equal(await storedUsed(pg, 2), 2, 'approving the 2-day annual leave must move used 0 -> 2');
    const e2 = await profileUsed(pg, hr, 2);
    assert.equal(e2.remaining, 19, 'profile remaining must be 19 after approval');

    // 3. A non-deducting type never deducts.
    await hr.createLeaveRequest({ employeeId: 3, leaveTypeId: 2, startDate: '2026-11-08', endDate: '2026-11-10' } as never, AUTH);
    await hr.approveLeaveRequest(await requestId(pg, 3), {} as never, AUTH);
    assert.equal(await storedUsed(pg, 3), 0, 'approving a sick leave must not move the balance');
    const e3 = await profileUsed(pg, hr, 3);
    assert.equal(e3.used, 0, 'profile must still read used 0 after a sick approval');
    assert.equal(e3.remaining, 21, 'profile remaining must stay 21 after a sick approval');

    // 4. Legacy text-only `اعتيادية` approved before the fix counts.
    await insertApprovedLeave(pg, 4, null, 'اعتيادية', 2, '2026-11-02', '2026-11-03');
    const e4 = await profileUsed(pg, hr, 4);
    assert.equal(e4.used, 2, 'legacy text-only اعتيادية must read used 2');
    assert.equal(e4.remaining, 19, 'legacy text-only اعتيادية must read remaining 19');

    // 5. Typed type named `اعتيادية` approved before the fix counts.
    await insertApprovedLeave(pg, 5, 4, 'إجازة اعتيادية', 2, '2026-11-02', '2026-11-03');
    const e5 = await profileUsed(pg, hr, 5);
    assert.equal(e5.used, 2, 'typed اعتيادية type must read used 2');
    assert.equal(e5.remaining, 19, 'typed اعتيادية type must read remaining 19');

    // 8. A flag-on type approved before the fix counts; the sick days
    // on the same employee still do not leak into the sum.
    await insertApprovedLeave(pg, 3, 3, 'تدريب', 2, '2026-11-12', '2026-11-13');
    const e3b = await profileUsed(pg, hr, 3);
    assert.equal(e3b.used, 2, 'flag-on training must read used 2 (sick 3 days excluded)');
    assert.equal(e3b.remaining, 19, 'flag-on training must read remaining 19');

    // 4 (guard). E1 already used 2 reconciled days (remaining 19):
    // a 20-day annual request must be refused, not approved on the
    // stale stored counter (which still says 21 remaining).
    await hr.createLeaveRequest({ employeeId: 1, leaveTypeId: 1, startDate: '2026-11-10', endDate: '2026-11-29' } as never, AUTH);
    let guardError: unknown = null;
    try {
      await hr.approveLeaveRequest(await requestId(pg, 1), {} as never, AUTH);
    } catch (error) {
      guardError = error;
    }
    assert.equal((guardError as { code?: string } | null)?.code, 'HR_LEAVE_INSUFFICIENT_BALANCE', 'approving 20 days against 19 remaining must fail closed');
    assert.equal(await storedUsed(pg, 1), 0, 'a refused approval must not move the stored counter');

    // 2 (cancel). Cancelling the approved annual leave releases it.
    await hr.cancelLeaveRequest(await requestId(pg, 2), {} as never, AUTH);
    assert.equal(await storedUsed(pg, 2), 0, 'cancelling must release the deducted days');
    const e2b = await profileUsed(pg, hr, 2);
    assert.equal(e2b.remaining, 21, 'profile remaining must be 21 again after cancellation');

    console.log('Leave balance reconciliation tests passed.');
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
