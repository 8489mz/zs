/*
 * INV-LEAVE-BALANCE-DEDUCTION: approving a leave deducts it from the
 * employee's stored annual-leave balance, so the employee profile and
 * end-of-service read the SAME balance.
 *
 * THE BUG: approval deducted only when the leave type's
 * `deducts_from_balance` flag was true, but no UI form ever exposed
 * that flag, so every type created through the settings form stored
 * false and no approval ever moved `used_annual_leaves`. The profile
 * kept showing 21 remaining / 0 used for an employee with an approved
 * 2-day leave, while end-of-service recomputed the used days from the
 * approved requests and showed 19. Two screens, one balance.
 *
 * RULES PINNED HERE, driving the REAL HrService + EndOfServiceService
 * on PGlite:
 * 1. The reported case: an annual type whose stored flag is false
 *    (as the old form stored it) still deducts on approval — 2 days
 *    approved moves used 0 -> 2, the profile reads used 2 and
 *    remaining 21 - 2 = 19, and the end-of-service preview reports
 *    the same 19 remaining days.
 * 2. A non-annual type with the flag off (sick) does NOT deduct.
 * 3. A non-annual type with the flag on (training) DOES deduct.
 * 4. Cancelling an approved deducted leave releases the days back.
 * 5. listLeaveTypes exposes the flag, so the settings form can show
 *    and change it.
 * 6. The shared rule itself: annual by code/name deducts whatever
 *    the flag says; the flag alone deducts for any type; a legacy
 *    text-only 'paid' request deducts; a legacy text-only 'sick'
 *    request does not.
 *
 * Prospective only: approvals already posted stay as stored.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { EndOfServiceService } from '../../src/modules/hr/services/end-of-service.service';
import { shouldDeductLeaveFromBalance } from '../../src/modules/hr/engines/leave-balance.engine';
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

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const hr = new HrService(db, new TransactionHelper(), { log: async () => {} } as never, {} as never, {} as never, undefined);
  const eos = new EndOfServiceService(db as never, {} as never, {} as never);

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
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (1, 't1', 'إجازة سنوية', 'annual', true, true, false);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (2, 't1', 'إجازة مرضية', 'sick', true, true, false);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (3, 't1', 'تدريب', 'training', true, true, true);
      INSERT INTO hr_employment_contracts (tenant_id, employee_id, contract_no, contract_type, status, start_date, end_date, base_salary, currency)
        VALUES ('t1', 1, 'C1', 'unlimited', 'active', '2020-01-01', NULL, 3000, 'EGP');
    `);

    // 6. The shared rule, pinned directly.
    assert.equal(shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: 1, leaveTypeCode: 'annual', leaveTypeName: 'إجازة سنوية' }), true, 'annual type deducts even with the stored flag false');
    assert.equal(shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: 2, leaveTypeCode: 'sick', leaveTypeName: 'إجازة مرضية' }), false, 'sick type with the flag off does not deduct');
    assert.equal(shouldDeductLeaveFromBalance({ deductsFromBalance: true, leaveTypeId: 3, leaveTypeCode: 'training', leaveTypeName: 'تدريب' }), true, 'explicit flag deducts for any type');
    assert.equal(shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: null, leaveTypeText: 'paid' }), true, 'legacy text-only paid request deducts');
    assert.equal(shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: null, leaveTypeText: 'sick' }), false, 'legacy text-only sick request does not deduct');
    assert.equal(shouldDeductLeaveFromBalance({ deductsFromBalance: false, leaveTypeId: 9, leaveTypeCode: 'other', leaveTypeName: 'إجازة سنوية استثنائية' }), true, 'a name containing سنوية is annual');

    // 5. listLeaveTypes exposes the flag the form shows.
    const types = (await hr.listLeaveTypes({}, AUTH)) as { rows: { id: string; deductsFromBalance: boolean }[] };
    assert.equal(types.rows.find((r) => r.id === '1')?.deductsFromBalance, false);
    assert.equal(types.rows.find((r) => r.id === '3')?.deductsFromBalance, true);

    // 1. The reported case: annual type, flag false as the old form stored it.
    await hr.createLeaveRequest({ employeeId: 1, leaveTypeId: 1, startDate: '2026-11-08', endDate: '2026-11-09' } as never, AUTH);
    assert.equal(await storedUsed(pg, 1), 0, 'creating the request must not move the balance');
    await hr.approveLeaveRequest(await requestId(pg, 1), {} as never, AUTH);
    assert.equal(await storedUsed(pg, 1), 2, 'approving the 2-day annual leave must move used 0 -> 2');
    const profile = (await hr.getEmployeeProfile(1, AUTH)) as { employee: { annualLeaveBalance: number; usedAnnualLeaves: number } };
    assert.equal(profile.employee.annualLeaveBalance, 21);
    assert.equal(profile.employee.usedAnnualLeaves, 2);
    assert.equal(profile.employee.annualLeaveBalance - profile.employee.usedAnnualLeaves, 19, 'profile remaining must be 19');
    const preview = (await eos.calculateSettlementPreview(
      { employeeId: 1, terminationDate: '2026-11-10', terminationReason: 'resignation', lawType: 'saudi', pendingSalaryAmount: 0 },
      AUTH,
    )) as { leaveEncashment: { remainingLeaveDays: number } };
    assert.equal(preview.leaveEncashment.remainingLeaveDays, 19, 'end-of-service must read the same 19 remaining days as the profile');

    // 2. Sick type, flag off: no deduction.
    await hr.createLeaveRequest({ employeeId: 2, leaveTypeId: 2, startDate: '2026-11-08', endDate: '2026-11-10' } as never, AUTH);
    await hr.approveLeaveRequest(await requestId(pg, 2), {} as never, AUTH);
    assert.equal(await storedUsed(pg, 2), 0, 'approving a sick leave must not move the balance');

    // 3. Training type, flag on: deducts.
    await hr.createLeaveRequest({ employeeId: 3, leaveTypeId: 3, startDate: '2026-11-08', endDate: '2026-11-09' } as never, AUTH);
    await hr.approveLeaveRequest(await requestId(pg, 3), {} as never, AUTH);
    assert.equal(await storedUsed(pg, 3), 2, 'approving a flag-on type must move used 0 -> 2');

    // 4. Cancelling the approved annual leave releases the days.
    await hr.cancelLeaveRequest(await requestId(pg, 1), {} as never, AUTH);
    assert.equal(await storedUsed(pg, 1), 0, 'cancelling must release the deducted days');
    const profileAfterCancel = (await hr.getEmployeeProfile(1, AUTH)) as { employee: { annualLeaveBalance: number; usedAnnualLeaves: number } };
    assert.equal(profileAfterCancel.employee.annualLeaveBalance - profileAfterCancel.employee.usedAnnualLeaves, 21, 'profile remaining must be 21 again after cancellation');

    console.log('Leave balance deduction tests passed.');
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
