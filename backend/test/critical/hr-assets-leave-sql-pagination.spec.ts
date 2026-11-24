/*
 * INV-HR-ASSETS-LEAVE-SQL-PAGINATION: `listEmployeeAssets`,
 * `listMasterData`, `listHolidays`, `listLeaveTypes` and
 * `listLeaveRequests` must fetch only the requested page from the
 * database — never load the whole tenant set and slice one page out of
 * it in memory.
 *
 * THE BUG: all five methods ran one unbounded SELECT, mapped the full
 * set in memory, filtered employee/status/date/search in memory,
 * reduced the summary counts in memory, then sliced one page with the
 * former in-memory slicer (defaultSize 25 | 50) — maxSize defaults to
 * 100, so a client asking pageSize=150 silently received 100 rows.
 *
 * RULES PINNED HERE, driving the REAL HrService (facade) on PGlite:
 * 1. The page-size cap is 200: pageSize=150 returns 150 rows (the old
 *    code returned 100), pageSize=1000 returns 200 rows. All five methods.
 * 2. Only the requested page is returned, the old ORDER BY preserved
 *    (assets: created_at DESC, id DESC; master data: id DESC; holidays:
 *    start_date DESC with a NEW id DESC tiebreaker — the old single-query
 *    order for same-date rows was unspecified, so paged queries need the
 *    determinism; leave types: is_active DESC, name ASC, id ASC;
 *    requests: created_at DESC, id DESC).
 * 3. The default page is preserved per method (assets 25, requests 25,
 *    master data 50, holidays 50, leave types 50).
 * 4. A page past the end clamps to the last page (page 99 -> last).
 * 5. Summaries stay exact over the FULL filtered set, never page-scoped:
 *    assets status counts (assigned/returned/lost/damaged; 'cancelled'
 *    counts only in totalItems), leave-requests status counts
 *    (pending/approved/rejected/cancelled), leave-types activeCount
 *    (is_active IS DISTINCT FROM FALSE — a NULL counts as active, as the
 *    JS `!== false` does), master-data/holidays totalItems.
 * 6. Filters move to SQL with exact JS semantics: status matches the RAW
 *    trimmed stored value against the LOWERCASED query (pinned with an
 *    uppercase query); search is a case-insensitive substring
 *    (strpos) over the same fields; request date filters are
 *    end_date >= from / start_date <= to (both columns are NOT NULL in
 *    production, so no empty-string edge exists).
 * 7. listMasterData's internal callers keep working: upsertMasterData
 *    still finds its just-inserted row on page 1 (highest id first) and
 *    deactivateMasterData still returns the refreshed list — pinned by
 *    driving both through the facade.
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
  userId: 1, sessionId: 'sess-spec', username: 'actor-1', role: 'admin',
  permissions: [], tenantId: 't1', accountId: 'a1',
} as unknown as AuthContext;

type Page = { page: number; pageSize: number; totalItems: number; totalPages: number };
type AssetRow = {
  id: string; employeeId: string; employeeNo: string; employeeName: string;
  departmentName: string; jobTitleName: string; assetType: string; assetName: string;
  assetCode: string; serialNo: string; assignedAt: string; returnedAt: string;
  status: string; notes: string; returnNotes: string; createdAt: string;
};
type AssetsResult = {
  assets: AssetRow[]; pagination: Page;
  summary: { totalItems: number; assignedCount: number; returnedCount: number; lostCount: number; damagedCount: number };
};
type MasterRow = {
  id: string; name: string; code: string; description: string;
  departmentId: string; departmentName: string; jobTitleId: string; jobTitleName: string;
  branchId: string; branchName: string; locationId: string; locationName: string;
  isActive: boolean;
};
type MasterResult = { rows: MasterRow[]; pagination: Page; summary: { totalItems: number } };
type HolidayRow = { id: string; name: string; startDate: string; endDate: string };
type HolidaysResult = { rows: HolidayRow[]; pagination: Page; summary: { totalItems: number } };
type LeaveTypeRow = {
  id: string; name: string; code: string; description: string;
  isPaid: boolean; deductsFromBalance: boolean; isActive: boolean;
};
type LeaveTypesResult = {
  rows: LeaveTypeRow[]; pagination: Page;
  summary: { totalItems: number; activeCount: number };
};
type LeaveRequestRow = {
  id: string; employeeId: string; employeeNo: string; employeeName: string;
  departmentName: string; jobTitleName: string; leaveTypeId: string;
  leaveTypeName: string; leaveType: string; startDate: string; endDate: string;
  daysCount: number; status: string; reason: string; notes: string;
  decisionNotes: string; decidedBy: string; decidedAt: string; createdAt: string;
};
type LeaveRequestsResult = {
  requests: LeaveRequestRow[]; pagination: Page;
  summary: { totalItems: number; pendingCount: number; approvedCount: number; rejectedCount: number; cancelledCount: number };
};

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const hr = new HrService(db, new TransactionHelper(), { log: async () => {} } as never, {} as never, {} as never, undefined);

  try {
    await pg.exec(`SET TIME ZONE 'UTC'`);
    await pg.exec(`
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, employee_no text, display_name text, department_id bigint, job_title_id bigint, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, delay_policy text, attendance_policy text, grace_minutes int, status text, scheduled_check_in_time text, scheduled_check_out_time text, overtime_policy text);
      CREATE TABLE hr_departments (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, name text, code text, description text, is_active boolean, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_job_titles (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, name text, code text, description text, is_active boolean, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_positions (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, name text, code text, description text, department_id bigint, job_title_id bigint, branch_id bigint, location_id bigint, is_active boolean, reference_id bigint, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_employee_assets (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, asset_type text, asset_name text, asset_code text, serial_no text, assigned_at date, returned_at date, status text, notes text, return_notes text, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_holidays (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, name text, start_date date, end_date date, created_by bigint, updated_by bigint);
      CREATE TABLE hr_leave_types (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, name text, code text, description text, is_paid boolean, is_active boolean, deducts_from_balance boolean, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_leave_requests (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, leave_type_id bigint, leave_type text, start_date date, end_date date, days_count numeric, status text, reason text, notes text, decision_notes text, decided_by bigint, decided_at timestamptz, created_by bigint, updated_by bigint, created_at timestamptz, updated_at timestamptz);
      INSERT INTO hr_employees (id, tenant_id, employee_no, display_name, department_id, job_title_id, compensation_type, hourly_rate, expected_daily_hours, delay_policy, attendance_policy, grace_minutes, status, scheduled_check_in_time, scheduled_check_out_time, overtime_policy) VALUES
        (1, 't1', 'E001', 'Ahmed Ali', 1, NULL, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (2, 't1', 'E002', 'Sara Ahmed', 2, 1, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only');
      INSERT INTO hr_departments (id, tenant_id, account_id, name, code, description, is_active, created_by, updated_by) VALUES
        (1, 't1', 'a1', 'Sales', 'SAL', '', true, 1, 1),
        (2, 't1', 'a1', 'Warehouse', 'WH', '', true, 1, 1),
        (3, 't1', 'a1', 'Finance', 'FIN', '', false, 1, 1);
      INSERT INTO hr_departments (id, tenant_id, account_id, name, code, description, is_active, created_by, updated_by)
        SELECT gs, 't1', 'a1', 'Filler Dept ' || gs, 'FD-' || gs, '', true, 1, 1 FROM generate_series(100, 219) AS gs;
      SELECT setval('hr_departments_id_seq', 219);
      INSERT INTO hr_job_titles (id, tenant_id, account_id, name, code, description, is_active, created_by, updated_by) VALUES
        (1, 't1', 'a1', 'Cashier', 'CSH', '', true, 1, 1),
        (2, 't1', 'a1', 'Manager', 'MGR', '', true, 1, 1);
      INSERT INTO hr_positions (id, tenant_id, account_id, name, code, description, department_id, job_title_id, branch_id, location_id, is_active, reference_id, created_by, updated_by) VALUES
        (1, 't1', 'a1', 'Sales Manager', 'SMGR', '', 1, 2, 1, 1, true, NULL, 1, 1),
        (2, 't1', 'a1', 'Cashier', 'CSH', '', 1, 1, NULL, NULL, true, NULL, 1, 1);
      INSERT INTO branches (id, tenant_id, name) VALUES (1, 't1', 'Main Branch');
      INSERT INTO stock_locations (id, tenant_id, name) VALUES (1, 't1', 'Warehouse A');
      INSERT INTO hr_employee_assets (id, tenant_id, account_id, employee_id, asset_type, asset_name, asset_code, serial_no, assigned_at, returned_at, status, notes, return_notes, created_by, updated_by, created_at, updated_at) VALUES
        (1, 't1', 'a1', 1, 'Laptop', 'Dell XPS', 'AST-001', 'SN-100', '2026-11-20', NULL, 'assigned', '', '', 1, 1, '2026-11-20 10:00:00+00', '2026-11-20 10:00:00+00'),
        (2, 't1', 'a1', 1, 'Phone', 'iPhone 15', 'AST-002', 'SN-200', '2026-11-19', '2026-11-21', 'returned', '', '', 1, 1, '2026-11-19 10:00:00+00', '2026-11-19 10:00:00+00'),
        (3, 't1', 'a1', 2, 'Laptop', 'MacBook Pro', 'AST-003', 'SN-300', '2026-11-18', NULL, 'lost', '', '', 1, 1, '2026-11-18 10:00:00+00', '2026-11-18 10:00:00+00'),
        (4, 't1', 'a1', 2, 'Monitor', 'LG 27', 'AST-004', 'SN-400', '2026-11-17', NULL, 'damaged', '', '', 1, 1, '2026-11-17 10:00:00+00', '2026-11-17 10:00:00+00'),
        (5, 't1', 'a1', 1, 'Tablet', 'iPad', 'AST-005', 'SN-500', '2026-11-16', NULL, 'cancelled', '', '', 1, 1, '2026-11-16 10:00:00+00', '2026-11-16 10:00:00+00'),
        (6, 't1', 'a1', 1, 'Laptop', 'ThinkPad', 'AST-006', 'SN-600', '2026-11-15', NULL, 'assigned', '', '', 1, 1, '2026-11-15 10:00:00+00', '2026-11-15 10:00:00+00');
      INSERT INTO hr_employee_assets (id, tenant_id, account_id, employee_id, asset_type, asset_name, asset_code, serial_no, assigned_at, returned_at, status, notes, return_notes, created_by, updated_by, created_at, updated_at)
        SELECT gs, 't1', 'a1', 1, 'Cable', 'Filler Cable ' || gs, 'FILL-' || gs, 'F-' || gs, '2026-11-01', NULL, 'assigned', '', '', 1, 1, '2026-11-01 08:00:00+00', '2026-11-01 08:00:00+00' FROM generate_series(100, 339) AS gs;
    `);

    // ---- listEmployeeAssets: 246 rows (6 named + 240 fillers) ----
    // Order: created_at DESC, id DESC.
    const asDef = (await hr.listEmployeeAssets({}, AUTH)) as unknown as AssetsResult;
    assert.equal(asDef.assets.length, 25, 'assets default page must be 25 rows');
    assert.equal(asDef.pagination.page, 1, 'assets default page must be 1');
    assert.equal(asDef.pagination.totalItems, 246, 'assets totalItems must be 246');
    assert.equal(asDef.pagination.totalPages, 10, 'assets totalPages must be ceil(246 / 25)');
    assert.equal(asDef.assets[0].id, '1', 'assets page 1 must start at id 1 (latest created_at)');
    assert.equal(asDef.assets[0].assetName, 'Dell XPS', 'assets row 1 must be Dell XPS');
    assert.equal(asDef.assets[5].id, '6', 'assets row 6 must be id 6');
    assert.equal(asDef.assets[6].id, '339', 'assets filler run must start at id 339');
    assert.equal(asDef.assets[24].id, '321', 'assets default page must end at id 321');
    assert.equal(asDef.summary.totalItems, 246, 'assets summary totalItems must be 246');
    assert.equal(asDef.summary.assignedCount, 242, 'assets assignedCount must be 242 (2 named + 240 fillers)');
    assert.equal(asDef.summary.returnedCount, 1, 'assets returnedCount must be 1');
    assert.equal(asDef.summary.lostCount, 1, 'assets lostCount must be 1');
    assert.equal(asDef.summary.damagedCount, 1, 'assets damagedCount must be 1');

    // 1. The old 100 cap is gone: pageSize=150 must return 150 rows.
    const as150 = (await hr.listEmployeeAssets({ pageSize: 150 }, AUTH)) as unknown as AssetsResult;
    assert.equal(as150.assets.length, 150, 'assets pageSize=150 must return 150 rows');
    assert.equal(as150.pagination.pageSize, 150, 'assets pageSize must stay 150');
    assert.equal(as150.pagination.totalItems, 246, 'assets capped totalItems must count the full set');
    assert.equal(as150.pagination.totalPages, 2, 'assets totalPages must be ceil(246 / 150)');
    assert.equal(as150.assets[149].id, '196', 'assets page 1 of 150 must end at id 196');

    // 2. The 200 cap: pageSize=1000 returns 200 rows; page 2 holds the rest.
    const asCapped = (await hr.listEmployeeAssets({ pageSize: 1000 }, AUTH)) as unknown as AssetsResult;
    assert.equal(asCapped.assets.length, 200, 'assets pageSize=1000 must return at most 200 rows');
    assert.equal(asCapped.pagination.pageSize, 200, 'assets pageSize must clamp to 200');
    const asPage2 = (await hr.listEmployeeAssets({ page: 2, pageSize: 200 }, AUTH)) as unknown as AssetsResult;
    assert.equal(asPage2.assets.length, 46, 'assets page 2 of 200 must hold the remaining 46 rows');
    assert.equal(asPage2.assets[0].id, '145', 'assets page 2 must start at id 145');
    assert.equal(asPage2.assets[45].id, '100', 'assets page 2 must end at id 100');
    assert.equal(asPage2.summary.assignedCount, 242, 'page-2 assignedCount must still be the FULL-set 242');

    // 3. A page past the end clamps to the last page.
    const asClamped = (await hr.listEmployeeAssets({ page: 99, pageSize: 25 }, AUTH)) as unknown as AssetsResult;
    assert.equal(asClamped.pagination.page, 10, 'assets page 99 must clamp to the last page 10');
    assert.equal(asClamped.assets.length, 21, 'assets clamped last page must hold 21 rows');
    assert.equal(asClamped.assets[0].id, '120', 'assets clamped last page must start at id 120');

    // 4. Status filter matches the RAW stored status against the LOWERCASED query.
    const asAssigned = (await hr.listEmployeeAssets({ status: 'assigned' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asAssigned.pagination.totalItems, 242, 'status assigned must hold 242 rows');
    const asUpper = (await hr.listEmployeeAssets({ status: 'ASSIGNED' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asUpper.pagination.totalItems, 242, 'status ASSIGNED (upper) must match the same 242 rows');
    const asReturned = (await hr.listEmployeeAssets({ status: 'returned' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asReturned.pagination.totalItems, 1, 'status returned must hold 1 row');
    assert.equal(asReturned.assets[0].id, '2', 'returned row must be id 2');
    const asCancelled = (await hr.listEmployeeAssets({ status: 'cancelled' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asCancelled.pagination.totalItems, 1, 'status cancelled must hold 1 row (counts in totalItems only)');

    // 5. Employee + search filters.
    const asEmp2 = (await hr.listEmployeeAssets({ employeeId: 2 }, AUTH)) as unknown as AssetsResult;
    assert.equal(asEmp2.pagination.totalItems, 2, 'employeeId 2 must hold 2 rows');
    assert.deepEqual(asEmp2.assets.map((r) => r.id), ['3', '4'], 'employeeId 2 rows must be ids 3, 4');
    const asLaptop = (await hr.listEmployeeAssets({ search: 'laptop' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asLaptop.pagination.totalItems, 3, 'search laptop must find 3 rows');
    const asSerial = (await hr.listEmployeeAssets({ search: 'sn-300' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asSerial.pagination.totalItems, 1, 'search sn-300 must find 1 row');
    assert.equal(asSerial.assets[0].id, '3', 'search sn-300 must find id 3');
    const asSara = (await hr.listEmployeeAssets({ search: 'sara' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asSara.pagination.totalItems, 2, 'search sara must find 2 rows');
    const asWarehouse = (await hr.listEmployeeAssets({ search: 'warehouse' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asWarehouse.pagination.totalItems, 2, 'search warehouse must find 2 rows');
    const asCashier = (await hr.listEmployeeAssets({ search: 'cashier' }, AUTH)) as unknown as AssetsResult;
    assert.equal(asCashier.pagination.totalItems, 2, 'search cashier must find 2 rows');

    // ---- listMasterData: departments (123), job-titles (2), positions (2) ----
    const mdDef = (await hr.listMasterData('departments', {}, AUTH)) as unknown as MasterResult;
    assert.equal(mdDef.rows.length, 50, 'departments default page must be 50 rows');
    assert.equal(mdDef.pagination.totalItems, 123, 'departments totalItems must be 123');
    assert.equal(mdDef.pagination.totalPages, 3, 'departments totalPages must be ceil(123 / 50)');
    assert.equal(mdDef.rows[0].id, '219', 'departments page 1 must start at id 219 (id DESC)');
    assert.equal(mdDef.rows[49].id, '170', 'departments default page must end at id 170');
    const md150 = (await hr.listMasterData('departments', { pageSize: 150 }, AUTH)) as unknown as MasterResult;
    assert.equal(md150.rows.length, 123, 'departments pageSize=150 must return all 123 rows');
    assert.equal(md150.pagination.pageSize, 150, 'departments pageSize must stay 150');
    const md1000 = (await hr.listMasterData('departments', { pageSize: 1000 }, AUTH)) as unknown as MasterResult;
    assert.equal(md1000.rows.length, 123, 'departments pageSize=1000 must return all 123 rows');
    assert.equal(md1000.pagination.pageSize, 200, 'departments pageSize must clamp to 200');
    const mdSales = (await hr.listMasterData('departments', { search: 'sales' }, AUTH)) as unknown as MasterResult;
    assert.equal(mdSales.pagination.totalItems, 1, 'search sales must find 1 department');
    assert.equal(mdSales.rows[0].id, '1', 'search sales must find id 1');
    assert.equal(mdSales.rows[0].isActive, true, 'Sales must be active');
    const mdFinance = (await hr.listMasterData('departments', { search: 'finance' }, AUTH)) as unknown as MasterResult;
    assert.equal(mdFinance.rows[0].isActive, false, 'Finance must be inactive');
    const mdFiller = (await hr.listMasterData('departments', { search: 'filler' }, AUTH)) as unknown as MasterResult;
    assert.equal(mdFiller.pagination.totalItems, 120, 'search filler must find 120 departments');

    const mdTitles = (await hr.listMasterData('job-titles', {}, AUTH)) as unknown as MasterResult;
    assert.equal(mdTitles.pagination.totalItems, 2, 'job-titles totalItems must be 2');
    assert.equal(mdTitles.rows[0].id, '2', 'job-titles page 1 must start at id 2 (id DESC)');
    assert.equal(mdTitles.rows[1].name, 'Cashier', 'job-titles second row must be Cashier');
    const mdCashier = (await hr.listMasterData('job-titles', { search: 'cashier' }, AUTH)) as unknown as MasterResult;
    assert.equal(mdCashier.pagination.totalItems, 1, 'search cashier must find 1 job title');

    const mdPos = (await hr.listMasterData('positions', {}, AUTH)) as unknown as MasterResult;
    assert.equal(mdPos.pagination.totalItems, 2, 'positions totalItems must be 2');
    assert.equal(mdPos.rows[0].id, '2', 'positions page 1 must start at id 2 (id DESC)');
    assert.equal(mdPos.rows[1].name, 'Sales Manager', 'positions second row must be Sales Manager');
    assert.equal(mdPos.rows[1].departmentName, 'Sales', 'Sales Manager departmentName must be Sales');
    assert.equal(mdPos.rows[1].jobTitleName, 'Manager', 'Sales Manager jobTitleName must be Manager');
    assert.equal(mdPos.rows[1].branchName, 'Main Branch', 'Sales Manager branchName must be Main Branch');
    assert.equal(mdPos.rows[1].locationName, 'Warehouse A', 'Sales Manager locationName must be Warehouse A');
    assert.equal(mdPos.rows[0].branchName, '', 'Cashier branchName must be empty (NULL join)');
    assert.equal(mdPos.rows[0].locationName, '', 'Cashier locationName must be empty (NULL join)');
    const mdPosMgr = (await hr.listMasterData('positions', { search: 'manager' }, AUTH)) as unknown as MasterResult;
    assert.equal(mdPosMgr.pagination.totalItems, 1, 'search manager must find 1 position');
    const mdPosCashier = (await hr.listMasterData('positions', { search: 'cashier' }, AUTH)) as unknown as MasterResult;
    assert.equal(mdPosCashier.pagination.totalItems, 1, 'search cashier must find 1 position');

    // 6. Internal callers keep working through the facade.
    const upserted = (await hr.upsertMasterData('departments', null, { name: 'New Dept', code: 'NEW', description: 'brand new', isActive: true }, AUTH)) as unknown as { ok: boolean; id: string; item: MasterRow; rows: MasterRow[] };
    assert.equal(upserted.ok, true, 'upsertMasterData must return ok');
    assert.equal(upserted.id, '220', 'upserted department id must be 220 (sequence follows the seeded max)');
    assert.equal(upserted.item.name, 'New Dept', 'upsertMasterData must find its just-inserted row on page 1');
    assert.equal(upserted.rows[0].id, '220', 'upserted list page 1 must start at the new row');
    const deactivated = (await hr.deactivateMasterData('departments', 1, AUTH)) as unknown as { ok: boolean };
    assert.equal(deactivated.ok, true, 'deactivateMasterData must return ok');
    const mdSalesAfter = (await hr.listMasterData('departments', { search: 'sales' }, AUTH)) as unknown as MasterResult;
    assert.equal(mdSalesAfter.rows[0].isActive, false, 'Sales must be inactive after deactivateMasterData');

    // ---- listHolidays: 115 rows (5 named + 110 fillers) ----
    await pg.exec(`
      INSERT INTO hr_holidays (id, tenant_id, account_id, name, start_date, end_date, created_by, updated_by) VALUES
        (1, 't1', 'a1', 'Eid Al-Fitr', '2026-03-20', '2026-03-22', 1, 1),
        (2, 't1', 'a1', 'Eid Al-Adha', '2026-05-27', '2026-05-30', 1, 1),
        (3, 't1', 'a1', 'National Day A', '2026-07-01', '2026-07-01', 1, 1),
        (4, 't1', 'a1', 'National Day B', '2026-07-01', '2026-07-01', 1, 1),
        (5, 't1', 'a1', 'Christmas', '2026-12-25', '2026-12-25', 1, 1);
      INSERT INTO hr_holidays (id, tenant_id, account_id, name, start_date, end_date, created_by, updated_by)
        SELECT gs, 't1', 'a1', 'Filler Holiday ' || gs, '2026-01-01', '2026-01-01', 1, 1 FROM generate_series(100, 209) AS gs;
      INSERT INTO hr_leave_types (id, tenant_id, account_id, name, code, description, is_paid, is_active, deducts_from_balance, created_by, updated_by, created_at, updated_at) VALUES
        (1, 't1', 'a1', 'Annual', 'annual', '', true, true, true, 1, 1, '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00'),
        (2, 't1', 'a1', 'Sick', 'sick', '', true, true, false, 1, 1, '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00'),
        (3, 't1', 'a1', 'Unpaid', 'unpaid', '', false, false, false, 1, 1, '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00'),
        (4, 't1', 'a1', 'Emergency', 'emergency', '', true, true, true, 1, 1, '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00');
      INSERT INTO hr_leave_types (id, tenant_id, account_id, name, code, description, is_paid, is_active, deducts_from_balance, created_by, updated_by, created_at, updated_at)
        SELECT gs, 't1', 'a1', 'Filler Type ' || gs, 'fill-' || gs, '', true, true, false, 1, 1, '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00' FROM generate_series(100, 209) AS gs;
      INSERT INTO hr_leave_requests (id, tenant_id, account_id, employee_id, leave_type_id, leave_type, start_date, end_date, days_count, status, reason, notes, decision_notes, decided_by, decided_at, created_by, updated_by, created_at, updated_at) VALUES
        (1, 't1', 'a1', 1, 1, 'annual', '2026-11-10', '2026-11-12', 3, 'pending', '', '', '', NULL, NULL, 1, 1, '2026-11-20 10:00:00+00', '2026-11-20 10:00:00+00'),
        (2, 't1', 'a1', 1, 1, 'annual', '2026-11-15', '2026-11-16', 2, 'approved', '', '', '', NULL, NULL, 1, 1, '2026-11-19 10:00:00+00', '2026-11-19 10:00:00+00'),
        (3, 't1', 'a1', 2, 2, 'sick', '2026-11-05', '2026-11-06', 2, 'rejected', '', '', '', NULL, NULL, 1, 1, '2026-11-18 10:00:00+00', '2026-11-18 10:00:00+00'),
        (4, 't1', 'a1', 2, 1, 'annual', '2026-12-01', '2026-12-03', 3, 'cancelled', '', '', '', NULL, NULL, 1, 1, '2026-11-17 10:00:00+00', '2026-11-17 10:00:00+00'),
        (5, 't1', 'a1', 1, 2, 'sick', '2026-10-01', '2026-10-02', 2, 'pending', '', '', '', NULL, NULL, 1, 1, '2026-11-16 10:00:00+00', '2026-11-16 10:00:00+00');
      INSERT INTO hr_leave_requests (id, tenant_id, account_id, employee_id, leave_type_id, leave_type, start_date, end_date, days_count, status, reason, notes, decision_notes, decided_by, decided_at, created_by, updated_by, created_at, updated_at)
        SELECT gs, 't1', 'a1', 1, 1, 'annual', '2026-01-05', '2026-01-06', 2, 'pending', '', '', '', NULL, NULL, 1, 1, '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00' FROM generate_series(100, 339) AS gs;
    `);

    // Order: start_date DESC, id DESC — the tiebreaker pins the two
    // same-date National Day rows (higher id first).
    const hoDef = (await hr.listHolidays({}, AUTH)) as unknown as HolidaysResult;
    assert.equal(hoDef.rows.length, 50, 'holidays default page must be 50 rows');
    assert.equal(hoDef.pagination.totalItems, 115, 'holidays totalItems must be 115');
    assert.equal(hoDef.pagination.totalPages, 3, 'holidays totalPages must be ceil(115 / 50)');
    assert.equal(hoDef.rows[0].name, 'Christmas', 'holidays page 1 must start at Christmas (latest start_date)');
    assert.equal(hoDef.rows[0].startDate, '2026-12-25', 'Christmas startDate must render as ISO date');
    assert.equal(hoDef.rows[1].name, 'National Day B', 'same-date tiebreaker must put the higher id first');
    assert.equal(hoDef.rows[2].name, 'National Day A', 'same-date tiebreaker must put the lower id second');
    assert.equal(hoDef.rows[3].name, 'Eid Al-Adha', 'holidays row 4 must be Eid Al-Adha');
    assert.equal(hoDef.rows[4].name, 'Eid Al-Fitr', 'holidays row 5 must be Eid Al-Fitr');
    assert.equal(hoDef.rows[5].id, '209', 'holidays filler run must start at id 209');
    assert.equal(hoDef.rows[49].id, '165', 'holidays default page must end at id 165');
    const ho150 = (await hr.listHolidays({ pageSize: 150 }, AUTH)) as unknown as HolidaysResult;
    assert.equal(ho150.rows.length, 115, 'holidays pageSize=150 must return all 115 rows');
    assert.equal(ho150.pagination.pageSize, 150, 'holidays pageSize must stay 150');
    const hoEid = (await hr.listHolidays({ search: 'eid' }, AUTH)) as unknown as HolidaysResult;
    assert.equal(hoEid.pagination.totalItems, 2, 'search eid must find 2 holidays');
    const hoNational = (await hr.listHolidays({ search: 'national' }, AUTH)) as unknown as HolidaysResult;
    assert.equal(hoNational.pagination.totalItems, 2, 'search national must find 2 holidays');
    const hoFiller = (await hr.listHolidays({ search: 'filler' }, AUTH)) as unknown as HolidaysResult;
    assert.equal(hoFiller.pagination.totalItems, 110, 'search filler must find 110 holidays');

    // ---- listLeaveTypes: 114 rows (4 named + 110 fillers) ----
    // Order: is_active DESC, name ASC, id ASC.
    const ltDef = (await hr.listLeaveTypes({}, AUTH)) as unknown as LeaveTypesResult;
    assert.equal(ltDef.rows.length, 50, 'leave types default page must be 50 rows');
    assert.equal(ltDef.pagination.totalItems, 114, 'leave types totalItems must be 114');
    assert.equal(ltDef.pagination.totalPages, 3, 'leave types totalPages must be ceil(114 / 50)');
    assert.equal(ltDef.rows[0].name, 'Annual', 'leave types page 1 must start at Annual');
    assert.equal(ltDef.rows[1].name, 'Emergency', 'leave types row 2 must be Emergency');
    assert.equal(ltDef.rows[2].name, 'Filler Type 100', 'leave types row 3 must be Filler Type 100');
    assert.equal(ltDef.rows[49].name, 'Filler Type 147', 'leave types default page must end at Filler Type 147');
    assert.equal(ltDef.summary.totalItems, 114, 'leave types summary totalItems must be 114');
    assert.equal(ltDef.summary.activeCount, 113, 'leave types activeCount must be 113 (all but Unpaid)');
    const lt150 = (await hr.listLeaveTypes({ pageSize: 150 }, AUTH)) as unknown as LeaveTypesResult;
    assert.equal(lt150.rows.length, 114, 'leave types pageSize=150 must return all 114 rows');
    assert.equal(lt150.rows[113].name, 'Unpaid', 'leave types last row must be Unpaid (inactive sorts last)');
    const ltSick = (await hr.listLeaveTypes({ search: 'sick' }, AUTH)) as unknown as LeaveTypesResult;
    assert.equal(ltSick.pagination.totalItems, 1, 'search sick must find 1 leave type');
    assert.equal(ltSick.rows[0].isPaid, true, 'Sick isPaid must be true');
    assert.equal(ltSick.rows[0].deductsFromBalance, false, 'Sick deductsFromBalance must be false');
    const ltAnnual = (await hr.listLeaveTypes({ search: 'annual' }, AUTH)) as unknown as LeaveTypesResult;
    assert.equal(ltAnnual.rows[0].isPaid, true, 'Annual isPaid must be true');
    assert.equal(ltAnnual.rows[0].deductsFromBalance, true, 'Annual deductsFromBalance must be true');
    const ltUnpaid = (await hr.listLeaveTypes({ search: 'unpaid' }, AUTH)) as unknown as LeaveTypesResult;
    assert.equal(ltUnpaid.rows[0].isPaid, false, 'Unpaid isPaid must be false');
    assert.equal(ltUnpaid.rows[0].isActive, false, 'Unpaid isActive must be false');
    const ltFiller = (await hr.listLeaveTypes({ search: 'filler' }, AUTH)) as unknown as LeaveTypesResult;
    assert.equal(ltFiller.pagination.totalItems, 110, 'search filler must find 110 leave types');

    // ---- listLeaveRequests: 245 rows (5 named + 240 fillers) ----
    // Order: created_at DESC, id DESC.
    const lrDef = (await hr.listLeaveRequests({}, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrDef.requests.length, 25, 'leave requests default page must be 25 rows');
    assert.equal(lrDef.pagination.page, 1, 'leave requests default page must be 1');
    assert.equal(lrDef.pagination.totalItems, 245, 'leave requests totalItems must be 245');
    assert.equal(lrDef.pagination.totalPages, 10, 'leave requests totalPages must be ceil(245 / 25)');
    assert.equal(lrDef.requests[0].id, '1', 'leave requests page 1 must start at id 1 (latest created_at)');
    assert.equal(lrDef.requests[4].id, '5', 'leave requests row 5 must be id 5');
    assert.equal(lrDef.requests[5].id, '339', 'leave requests filler run must start at id 339');
    assert.equal(lrDef.requests[24].id, '320', 'leave requests default page must end at id 320');
    assert.equal(lrDef.summary.totalItems, 245, 'leave requests summary totalItems must be 245');
    assert.equal(lrDef.summary.pendingCount, 242, 'leave requests pendingCount must be 242 (2 named + 240 fillers)');
    assert.equal(lrDef.summary.approvedCount, 1, 'leave requests approvedCount must be 1');
    assert.equal(lrDef.summary.rejectedCount, 1, 'leave requests rejectedCount must be 1');
    assert.equal(lrDef.summary.cancelledCount, 1, 'leave requests cancelledCount must be 1');

    const lr150 = (await hr.listLeaveRequests({ pageSize: 150 }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lr150.requests.length, 150, 'leave requests pageSize=150 must return 150 rows');
    assert.equal(lr150.pagination.pageSize, 150, 'leave requests pageSize must stay 150');
    assert.equal(lr150.pagination.totalItems, 245, 'leave requests capped totalItems must count the full set');
    assert.equal(lr150.pagination.totalPages, 2, 'leave requests totalPages must be ceil(245 / 150)');
    assert.equal(lr150.requests[149].id, '195', 'leave requests page 1 of 150 must end at id 195');
    const lrCapped = (await hr.listLeaveRequests({ pageSize: 1000 }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrCapped.requests.length, 200, 'leave requests pageSize=1000 must return at most 200 rows');
    assert.equal(lrCapped.pagination.pageSize, 200, 'leave requests pageSize must clamp to 200');
    const lrPage2 = (await hr.listLeaveRequests({ page: 2, pageSize: 200 }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrPage2.requests.length, 45, 'leave requests page 2 of 200 must hold the remaining 45 rows');
    assert.equal(lrPage2.requests[0].id, '144', 'leave requests page 2 must start at id 144');
    assert.equal(lrPage2.requests[44].id, '100', 'leave requests page 2 must end at id 100');
    assert.equal(lrPage2.summary.pendingCount, 242, 'page-2 pendingCount must still be the FULL-set 242');
    const lrClamped = (await hr.listLeaveRequests({ page: 99, pageSize: 25 }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrClamped.pagination.page, 10, 'leave requests page 99 must clamp to the last page 10');
    assert.equal(lrClamped.requests.length, 20, 'leave requests clamped last page must hold 20 rows');
    assert.equal(lrClamped.requests[0].id, '119', 'leave requests clamped last page must start at id 119');

    const lrEmp2 = (await hr.listLeaveRequests({ employeeId: 2 }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrEmp2.pagination.totalItems, 2, 'employeeId 2 must hold 2 requests');
    assert.deepEqual(lrEmp2.requests.map((r) => r.id), ['3', '4'], 'employeeId 2 requests must be ids 3, 4');
    const lrApproved = (await hr.listLeaveRequests({ status: 'approved' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrApproved.pagination.totalItems, 1, 'status approved must hold 1 request');
    assert.equal(lrApproved.requests[0].id, '2', 'approved request must be id 2');
    const lrPendingUpper = (await hr.listLeaveRequests({ status: 'PENDING' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrPendingUpper.pagination.totalItems, 242, 'status PENDING (upper) must match the same 242 rows');
    const lrFrom = (await hr.listLeaveRequests({ from: '2026-11-01' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrFrom.pagination.totalItems, 4, 'from 2026-11-01 must hold 4 requests (end_date >= from)');
    const lrTo = (await hr.listLeaveRequests({ to: '2026-11-30' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrTo.pagination.totalItems, 244, 'to 2026-11-30 must hold 244 requests (start_date <= to)');
    const lrRange = (await hr.listLeaveRequests({ from: '2026-11-01', to: '2026-11-30' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrRange.pagination.totalItems, 3, 'Nov range must hold 3 requests');
    assert.deepEqual(lrRange.requests.map((r) => r.id), ['1', '2', '3'], 'Nov range requests must be ids 1, 2, 3');
    const lrSara = (await hr.listLeaveRequests({ search: 'sara' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrSara.pagination.totalItems, 2, 'search sara must find 2 requests');
    const lrSick = (await hr.listLeaveRequests({ search: 'sick' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrSick.pagination.totalItems, 2, 'search sick must find 2 requests');
    const lrAnnual = (await hr.listLeaveRequests({ search: 'annual' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrAnnual.pagination.totalItems, 243, 'search annual must find 243 requests');
    const lrWarehouse = (await hr.listLeaveRequests({ search: 'warehouse' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrWarehouse.pagination.totalItems, 2, 'search warehouse must find 2 requests');
    const lrCashier = (await hr.listLeaveRequests({ search: 'cashier' }, AUTH)) as unknown as LeaveRequestsResult;
    assert.equal(lrCashier.pagination.totalItems, 2, 'search cashier must find 2 requests');

    console.log('HR assets + leave SQL pagination tests passed.');
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
