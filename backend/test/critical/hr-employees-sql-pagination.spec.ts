/*
 * INV-HR-EMPLOYEES-SQL-PAGINATION: `listEmployees` must fetch only the
 * requested page from the database — never the whole employees table.
 *
 * THE BUG: listEmployees ran an UNBOUNDED SELECT over hr_employees +
 * 6 LEFT JOINs + 1 correlated subquery, mapped ALL rows in memory,
 * filtered `search` in memory, reconciled leave balances over ALL ids,
 * then sliced one page with the former in-memory slicer (defaultSize
 * 25, maxSize 5000) — so a client asking pageSize=5000 received 5,000
 * fully mapped rows in one response.
 *
 * RULES PINNED HERE, driving the REAL HrService (facade) on PGlite:
 * 1. The page-size cap is 200: pageSize=1000 and pageSize=5000 both
 *    return at most 200 rows, with pagination.pageSize === 200.
 * 2. Only the requested page is returned: page 1 holds ids 250..226,
 *    page 2 holds 225..201 (ORDER BY id DESC preserved).
 * 3. The default page is 25 rows (defaultSize 25 preserved).
 * 4. A page past the end clamps to the last page (page 99 -> 10).
 * 5. totalItems / activeCount in `summary` are exact over the FULL
 *    filtered set, not just the page.
 * 6. `search` filters in SQL with the same semantics as the old
 *    in-memory filter: employeeNo, displayName (display_name, or
 *    first + ' ' + last when blank), username, departmentName,
 *    jobTitleName — case-insensitive substring — plus phone ONLY
 *    when the caller may view employee files.
 * 7. The leave-balance reconcile still applies per listed row, now
 *    scoped to the page's ids (INV-LEAVE-BALANCE-NOT-DEDUCTING).
 *
 * Prospective only; PGlite only.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
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

// Same identity as AUTH but allowed to view employee files (phone,
// bank, national id) — so the phone branch of `search` must apply.
const AUTH_PRIV = {
  ...AUTH,
  permissions: ['hrEmployees'],
} as unknown as AuthContext;

type ListResult = {
  employees: { id: string; employeeNo: string; displayName: string; status: string; usedAnnualLeaves: number }[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: { totalItems: number; activeCount: number };
};

async function list(hr: HrService, query: Record<string, unknown>, auth: AuthContext): Promise<ListResult> {
  return (await hr.listEmployees(query, auth)) as unknown as ListResult;
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
  const hr = new HrService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    {} as never,
    undefined,
  );

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
      INSERT INTO hr_departments (id, tenant_id, name) VALUES (1, 't1', 'Sales'), (2, 't1', 'Warehouse');
      INSERT INTO hr_job_titles (id, tenant_id, name) VALUES (1, 't1', 'Manager'), (2, 't1', 'Clerk');
      INSERT INTO users (id, tenant_id, username) VALUES (1, 't1', 'ahmed.k'), (2, 't1', 'mona.s');
      INSERT INTO hr_employee_contacts (id, tenant_id, account_id, employee_id, contact_type, value, label, is_primary, notes, created_by, updated_by)
        VALUES (1, 't1', 'a1', 1, 'mobile', '01011111111', 'primary', true, '', 1, 1),
               (2, 't1', 'a1', 2, 'mobile', '01022222222', 'primary', true, '', 1, 1);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, department_id, job_title_id, user_id, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (1, 't1', 'E001', 'Ahmed', 'Khaled', 'Ahmed Khaled', '2020-01-01', 'active', 1, 1, 1, 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, department_id, job_title_id, user_id, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (2, 't1', 'E002', 'Mona', 'Saeed', 'Mona Saeed', '2020-01-01', 'active', 2, 2, 2, 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, department_id, job_title_id, user_id, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (3, 't1', 'E003', 'Omar', 'Hassan', '', '2020-01-01', 'inactive', 1, 2, NULL, 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (4, 't1', 'E004', 'Emp', 'Four', 'Emp Four', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (5, 't1', 'E005', 'Emp', 'Five', 'Emp Five', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (6, 't1', 'E006', 'Emp', 'Six', 'Emp Six', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (7, 't1', 'E007', 'Emp', 'Seven', 'Emp Seven', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (8, 't1', 'E008', 'Emp', 'Eight', 'Emp Eight', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (9, 't1', 'E009', 'Emp', 'Nine', 'Emp Nine', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        VALUES (10, 't1', 'E010', 'Emp', 'Ten', 'Emp Ten', '2020-01-01', 'active', 'monthly', 'monthly', 21, 0);
      INSERT INTO hr_employees (id, tenant_id, employee_no, first_name, last_name, display_name, hire_date, status, compensation_type, pay_frequency, annual_leave_balance, used_annual_leaves)
        SELECT gs, 't1', 'F' || lpad(gs::text, 3, '0'), 'Filler', 'Worker', NULL, '2020-01-01', 'active', 'monthly', 'monthly', 21, 0 FROM generate_series(11, 250) AS gs;
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (1, 't1', 'إجازة سنوية', 'annual', true, true, false);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (2, 't1', 'إجازة مرضية', 'sick', true, true, false);
      INSERT INTO hr_leave_types (id, tenant_id, name, code, is_paid, is_active, deducts_from_balance)
        VALUES (3, 't1', 'تدريب', 'training', true, true, true);
    `);

    // Approved annual leaves on the first row of page 1 (id 250) and
    // on the last page (id 1) — the reconcile must follow the page.
    await insertApprovedLeave(pg, 250, 1, 'إجازة سنوية', 2, '2026-11-02', '2026-11-03');
    await insertApprovedLeave(pg, 1, 1, 'إجازة سنوية', 2, '2026-11-02', '2026-11-03');

    // 1. The cap: pageSize=1000 must return at most 200 rows.
    const capped = await list(hr, { pageSize: 1000 }, AUTH);
    assert.equal(capped.employees.length, 200, 'pageSize=1000 must return at most 200 rows');
    assert.equal(capped.pagination.pageSize, 200, 'pageSize must clamp to 200');
    assert.equal(capped.pagination.totalItems, 250, 'totalItems must count the full filtered set');
    assert.equal(capped.pagination.totalPages, 2, 'totalPages must be ceil(250 / 200)');
    assert.equal(capped.summary.totalItems, 250, 'summary totalItems must count the full filtered set');
    assert.equal(capped.summary.activeCount, 249, 'summary activeCount must count the full filtered set');

    // 1b. The old 5000 cap is gone too.
    const capped5k = await list(hr, { pageSize: 5000 }, AUTH);
    assert.equal(capped5k.employees.length, 200, 'pageSize=5000 must return at most 200 rows');
    assert.equal(capped5k.pagination.pageSize, 200, 'pageSize must clamp to 200');

    // 2. Only the requested page is returned (ORDER BY id DESC).
    assert.equal(capped.employees[0].id, '250', 'page 1 must start at id 250');
    assert.equal(capped.employees[199].id, '51', 'page 1 of 200 must end at id 51');
    const page2 = await list(hr, { page: 2, pageSize: 200 }, AUTH);
    assert.equal(page2.employees.length, 50, 'page 2 of 200 must hold the remaining 50 rows');
    assert.equal(page2.employees[0].id, '50', 'page 2 must start at id 50');
    assert.equal(page2.employees[49].id, '1', 'page 2 must end at id 1');

    // 3. The default page is 25 rows (defaultSize 25 preserved).
    const def = await list(hr, {}, AUTH);
    assert.equal(def.employees.length, 25, 'default pageSize must be 25');
    assert.equal(def.pagination.page, 1, 'default page must be 1');
    assert.equal(def.pagination.pageSize, 25, 'default pageSize must be 25');
    assert.equal(def.pagination.totalItems, 250, 'default totalItems must be 250');
    assert.equal(def.pagination.totalPages, 10, 'default totalPages must be ceil(250 / 25)');
    assert.equal(def.employees[0].id, '250', 'default page 1 must start at id 250');

    // 4. A page past the end clamps to the last page.
    const clamped = await list(hr, { page: 99, pageSize: 25 }, AUTH);
    assert.equal(clamped.pagination.page, 10, 'page 99 must clamp to the last page 10');
    assert.equal(clamped.employees.length, 25, 'clamped last page must hold 25 rows');
    assert.equal(clamped.employees[0].id, '25', 'clamped last page must start at id 25');
    assert.equal(clamped.employees[24].id, '1', 'clamped last page must end at id 1');

    // 5. Search by employeeNo.
    const byNo = await list(hr, { search: 'E001' }, AUTH);
    assert.equal(byNo.pagination.totalItems, 1, 'search E001 must match exactly one employee');
    assert.equal(byNo.employees[0].id, '1', 'search E001 must return employee 1');

    // 6a. Search by displayName, case-insensitive.
    const byName = await list(hr, { search: 'AHMED' }, AUTH);
    assert.equal(byName.pagination.totalItems, 1, 'search AHMED must match exactly one employee');
    assert.equal(byName.employees[0].id, '1', 'search AHMED must return employee 1');

    // 6b. Search by the fallback display name (blank display_name).
    const byFallback = await list(hr, { search: 'omar hassan' }, AUTH);
    assert.equal(byFallback.pagination.totalItems, 1, 'search omar hassan must match the blank-display-name employee');
    assert.equal(byFallback.employees[0].id, '3', 'search omar hassan must return employee 3');

    // 6c. Search by departmentName.
    const byDept = await list(hr, { search: 'warehouse' }, AUTH);
    assert.equal(byDept.pagination.totalItems, 1, 'search warehouse must match exactly one employee');
    assert.equal(byDept.employees[0].id, '2', 'search warehouse must return employee 2');

    // 6d. Search by jobTitleName.
    const byTitle = await list(hr, { search: 'manager' }, AUTH);
    assert.equal(byTitle.pagination.totalItems, 1, 'search manager must match exactly one employee');
    assert.equal(byTitle.employees[0].id, '1', 'search manager must return employee 1');

    // 6e. Search by username.
    const byUser = await list(hr, { search: 'mona.s' }, AUTH);
    assert.equal(byUser.pagination.totalItems, 1, 'search mona.s must match exactly one employee');
    assert.equal(byUser.employees[0].id, '2', 'search mona.s must return employee 2');

    // 6f. Search by phone WITH the file-view permission.
    const byPhonePriv = await list(hr, { search: '01022222222' }, AUTH_PRIV);
    assert.equal(
      byPhonePriv.pagination.totalItems,
      1,
      'search by phone with permission must match exactly one employee',
    );
    assert.equal(byPhonePriv.employees[0].id, '2', 'search by phone with permission must return employee 2');

    // 6g. Search by phone WITHOUT the file-view permission must NOT
    // match — the phone is masked for this caller.
    const byPhone = await list(hr, { search: '01022222222' }, AUTH);
    assert.equal(byPhone.pagination.totalItems, 0, 'search by phone without permission must match nobody');
    assert.equal(byPhone.employees.length, 0, 'search by phone without permission must return no rows');

    // 5b. Summary counts stay exact over the full filtered set.
    const filler = await list(hr, { search: 'filler' }, AUTH);
    assert.equal(filler.pagination.totalItems, 240, 'search filler must match 240 employees');
    assert.equal(filler.summary.totalItems, 240, 'summary totalItems must be 240 for search filler');
    assert.equal(filler.summary.activeCount, 240, 'summary activeCount must be 240 for search filler');
    assert.equal(filler.employees.length, 25, 'search filler page 1 must hold 25 rows');

    // 7. The leave-balance reconcile follows the page (INV-LEAVE-BALANCE-NOT-DEDUCTING).
    assert.equal(
      capped.employees.find((row) => row.id === '250')?.usedAnnualLeaves,
      2,
      'page 1 must read used 2 for id 250',
    );
    const lastPage = await list(hr, { page: 10, pageSize: 25 }, AUTH);
    assert.equal(
      lastPage.employees.find((row) => row.id === '1')?.usedAnnualLeaves,
      2,
      'last page must read used 2 for id 1',
    );
    assert.equal(lastPage.summary.totalItems, 250, 'last page summary must still count the full set');
    assert.equal(lastPage.summary.activeCount, 249, 'last page activeCount must still count the full set');

    console.log('HR employees SQL pagination tests passed.');
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
