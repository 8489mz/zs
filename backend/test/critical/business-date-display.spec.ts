/*
 * R3c (U5): business-date UTC-slice fix, display/reports/HR slice.
 *
 * Phase 0 section 1.8 inventoried the toISOString().slice(0, 10) sites;
 * re-grounding at base 30a84e93 found the same defect also spelled
 * .split('T')[0] (mostly contracting defaults), plus a .slice(0, 7) month
 * default (employee-portal getAttendance) and the pharmacy FEFO month
 * gate. Every site in the 18 owned files was classified before it was
 * touched:
 *
 * FIXED (instant cut -- the UTC day is the wrong business day around
 * local midnight, tenant Africa/Cairo is UTC+2/+3):
 * - employee-portal.service.ts: getDashboard "today" and getAttendance
 *   default month (now tenant-local via getTenantTimezone/todayTenantDate).
 * - mobile-attendance.service.ts: punch-status "today".
 * - end-of-service.service.ts: settlement_date default.
 * - pharmacy.service.ts: isPastPharmacyExpiry now takes the tenant day
 *   (resolved once in upsertBatch), and the FEFO excludeExpired month
 *   gate now uses the tenant-local month. The header comment that called
 *   the gate "both UTC" by design was part of the defect.
 * - restaurant-advanced-fnb.service.ts: tip-pool shift_date and prep
 *   sheet prepDate defaults.
 * - contracting.service.ts: createScheduleTask start, the week-bucket
 *   calendar math (now pure UTC), createDocument/addDocumentRevision/
 *   updateDocumentRevisionStatus issued/review dates, createMeetingMinute
 *   meeting_date, getProjectEvmMetrics planned-value "today", the
 *   subcontractor ledger row dates (created_at instants), guarantee
 *   days-remaining "today" (both methods), retention release due dates
 *   (tenant day + 365 calendar days, not a UTC-sliced instant + 365d),
 *   and every dto-date default that was a UTC slice/split (invoice,
 *   RFI, requisition, supplier return, labour attendance, petty cash,
 *   mobilisation/indirect expenses, equipment transfer, supplier price
 *   memory, snag rectified date, subcontractor payment dates).
 * - hr.service.ts: getPayrollRun month-end (local Date -> Date.UTC;
 *   on a Cairo host the old code returned Nov 29 for a November run)
 *   and the bank-details export createDate (now the tenant-local day).
 * - returns-listing.helper.ts: returnDateKey takes an optional tenant
 *   zone (todayTenantDate when given, legacy UTC slice otherwise);
 *   filterReturnRows/summarizeReturnRows thread it through.
 * - cash-drawer.helper.ts: cashDrawerDateKey takes an optional tenant
 *   zone; filterCashDrawerRows takes an optional tenant day + zone.
 * - sales-query.helper.ts: summarizeSales takes an optional tenant day.
 *
 * LEFT AS-IS (stored-DATE slice -- slicing a DATE column's UTC rendering
 * is exact, or a validation/calendar round-trip on a YYYY-MM-DD string):
 * - payroll-loan-allocation.engine.ts, hr-statutory-policy.engine.ts,
 *   hourly-attendance-pay.engine.ts, employee-portal :822,
 *   end-of-service :125, hr.service.ts monthRange (:154) and the
 *   :116 validation, contracting mapScheduleTaskRow (:2282-2283) and
 *   the start+durationDays math (:2387-2389), pharmacyExpiryText and
 *   the create-expiry Date branch, storefront-offers normalizeDateOnly,
 *   catalog-product.service.ts :214, van-common.util.ts holiday iteration.
 * - reports.controller.ts:183 daily-rollup default: the controller has
 *   no db handle and no timezone in AuthContext, and the rollup service
 *   itself builds UTC day bounds -- that service owns the fix
 *   (follow-up package, not this one).
 * - fmcg-promotions.engine.ts: pure engine, no tenant context; the
 *   caller (VanPromotionsService.evaluateCart) must pass the
 *   tenant-local day as referenceDate (follow-up). The string-reference
 *   behaviour is pinned below; the no-argument default is a documented
 *   limitation, not asserted.
 *
 * The fix routes every instant through the canonical gateway
 * resolveBusinessDateKey (tenant timezone from settings, default
 * Africa/Cairo) or, where the file already resolves a zone, its
 * formatter todayTenantDate with a once-resolved zone. No new helper
 * was invented. The optional helper params keep the legacy UTC slice
 * as the default so existing callers are unaffected until they are
 * wired to pass the tenant day/zone (returns.service.ts is an R3b
 * file, cash-drawer.service.ts a D3 file, sales-query.service.ts a
 * D5 file -- caller wiring is a follow-up in each).
 *
 * Deterministic proofs (fixed instants, so they fail on unfixed code at
 * any hour -- never a "today" comparison): the gateway boundary, the
 * helper zone behaviour, the DATE round-trips, the fmcg string
 * reference, the FEFO month, the payroll month-end expression under a
 * Cairo-TZ child process, and the contracting histogram under a
 * Cairo-TZ child ts-node process. The meeting-minute and EVM drives are
 * window-limited by construction (they can only distinguish
 * fixed/unfixed inside 00:00-02:59 Cairo, when the UTC day and the
 * Cairo day differ); they pin the wiring. The wiring pin at the end
 * asserts the defect spelling is gone from every owned file except
 * the four documented exceptions.
 *
 * Not driven end to end here (heavy fixtures: employees/PINs,
 * settlements, tip members, pharmacy service deps): getDashboard,
 * employeeLogin, createSettlement, upsertBatch, the tip pool / prep
 * sheet, and the contracting dto-date defaults. They are proven by
 * (a) the shared gateway boundary in (1), (b) the wiring pin (the UTC
 * slice is gone from each of those methods), and (c) the three
 * representative end-to-end drives (meeting minute, EVM, histogram).
 *
 * Run: npx ts-node test/critical/business-date-display.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { resolveBusinessDateKey } from '../../src/modules/accounting/engines/accounting-date.engine';
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { filterReturnRows, summarizeReturnRows } from '../../src/modules/returns/helpers/returns-listing.helper';
import { filterCashDrawerRows } from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';
import { summarizeSales } from '../../src/modules/sales/helpers/sales-query.helper';
import { normalizeDateOnly } from '../../src/modules/storefront/engines/storefront-offers.engine';
import { daysInCalendarMonth } from '../../src/modules/hr/engines/hourly-attendance-pay.engine';
import { evaluateFmcgCartPromotions } from '../../src/modules/delivery-reps/fmcg-promotions.engine';
import { ContractingService } from '../../src/modules/contracting/contracting.service';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;
const SRC = path.resolve(__dirname, '../../src');

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const contracting = new ContractingService(db, {} as never);
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE contracting_meeting_minutes (id bigint generated always as identity primary key, tenant_id text, project_id text, minute_number text, meeting_type text, meeting_date text, location text, attendees text, agenda text, summary text, prepared_by text, status text, created_by bigint, created_at timestamptz default now(), updated_at timestamptz);
      CREATE TABLE contracting_schedule_tasks (id bigint generated always as identity primary key, tenant_id text, project_id text, start_date date, end_date date, planned_manpower_count numeric, planned_equipment_count numeric, resource_trade text);
    `);
    await sql.raw(`INSERT INTO settings VALUES ('t1', 'timezone', 'Africa/Cairo')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t2', 'timezone', 'Asia/Dubai')`).execute(db);

    // 1. Gateway boundary: 00:30 Cairo on 2026-11-08 is 22:30 UTC on
    // 2026-11-07. The UTC slice keys the previous day; the gateway keys
    // the tenant-local day. Same instant in Dubai (+04) is 02:30 on the 8th.
    const cairoInstant = new Date('2026-11-07T22:30:00.000Z');
    assert.equal(await resolveBusinessDateKey(db, 't1', cairoInstant), '2026-11-08', 'Cairo 00:30 instant keys 2026-11-08');
    assert.equal(await resolveBusinessDateKey(db, 't2', cairoInstant), '2026-11-08', 'Dubai 02:30 instant keys 2026-11-08');
    assert.equal(await resolveBusinessDateKey(db, 't1', '2026-11-08'), '2026-11-08', 'calendar-day string passes through untouched');
    assert.equal(await resolveBusinessDateKey(db, 't1', new Date('2026-11-08T22:30:00.000Z')), '2026-11-09', 'Cairo 00:30 on the 9th keys 2026-11-09, not the UTC 8th');
    assert.equal(todayTenantDate('Africa/Cairo', cairoInstant), '2026-11-08', 'todayTenantDate agrees with the gateway');
    // FEFO month: 00:30 Cairo on 2026-11-01 is 22:30 UTC on 2026-10-31;
    // the UTC month is October, the tenant month is November.
    assert.equal((await resolveBusinessDateKey(db, 't1', new Date('2026-10-31T22:30:00.000Z'))).slice(0, 7), '2026-11', 'tenant-local month at the Nov 1 boundary is 2026-11');

    // 2. Returns helper: a return recorded at 00:30 Cairo belongs to
    // the Cairo business day, not the UTC day -- once the tenant zone
    // is passed. Legacy behaviour (no zone) is unchanged.
    const returnRows = [
      { id: 'r1', rowId: 'r1', docNo: 'RT-1', returnType: 'sale', type: 'sale', invoiceId: '1', productId: 'p1', productName: 'Item', qty: 1, total: 100, note: '', settlementMode: '', refundMethod: '', createdAt: cairoInstant, date: cairoInstant },
      { id: 'r2', rowId: 'r2', docNo: 'RT-2', returnType: 'sale', type: 'sale', invoiceId: '1', productId: 'p1', productName: 'Item', qty: 1, total: 50, note: '', settlementMode: '', refundMethod: '', createdAt: new Date('2026-11-07T10:00:00.000Z'), date: new Date('2026-11-07T10:00:00.000Z') },
    ] as never;
    assert.equal(filterReturnRows(returnRows, { filter: 'today' }, '2026-11-08', 'Africa/Cairo').length, 1, 'zoned today filter matches the Cairo-day return');
    assert.equal(filterReturnRows(returnRows, { filter: 'today' }, '2026-11-07', 'Africa/Cairo').length, 1, 'zoned today filter does not pull the Cairo-day return into the UTC day');
    assert.equal(filterReturnRows(returnRows, { filter: 'today' }, '2026-11-07').length, 2, 'legacy (no zone) today filter keeps the UTC day');
    assert.equal(summarizeReturnRows(returnRows, '2026-11-08', 2, 'Africa/Cairo').todayCount, 1, 'zoned todayCount counts the Cairo-day return');
    assert.equal(summarizeReturnRows(returnRows, '2026-11-07', 2).todayCount, 2, 'legacy todayCount keeps the UTC day');

    // 3. Cash-drawer helper: a shift opened at 00:30 Cairo belongs to
    // the Cairo business day once the tenant day/zone is passed.
    const drawerRows = [
      { status: 'open', variance: 0, openedAt: cairoInstant, createdAt: cairoInstant, docNo: 'SH-1' },
      { status: 'open', variance: 0, openedAt: new Date('2026-11-07T10:00:00.000Z'), createdAt: new Date('2026-11-07T10:00:00.000Z'), docNo: 'SH-2' },
    ] as never;
    assert.equal(filterCashDrawerRows(drawerRows, { filter: 'today' }, '2026-11-08', 'Africa/Cairo').length, 1, 'zoned today filter matches the Cairo-day shift');
    assert.equal(filterCashDrawerRows(drawerRows, { filter: 'today' }, '2026-11-07', 'Africa/Cairo').length, 1, 'zoned today filter does not pull the Cairo-day shift into the UTC day');
    assert.equal(filterCashDrawerRows(drawerRows, { filter: 'today' }, '2026-11-07').length, 2, 'explicit day without zone keeps the UTC slice');

    // 4. Sales summary: an explicit tenant day drives todaySalesCount/Total.
    const saleRows = [
      { date: '2026-11-08', total: 100, createdBy: 'A', customerId: 'c1', customerName: 'C1', paymentType: 'cash', status: 'posted' },
      { date: '2026-11-07', total: 50, createdBy: 'A', customerId: 'c1', customerName: 'C1', paymentType: 'cash', status: 'posted' },
    ] as never;
    const summary = summarizeSales(saleRows, 2, '2026-11-08');
    assert.equal(summary.todaySalesCount, 1, 'tenant-day todaySalesCount counts the tenant-day sale');
    assert.equal(summary.todaySalesTotal, 100, 'tenant-day todaySalesTotal totals the tenant-day sale');

    // 5. Stored-DATE round-trips stay exact (the LEAVE verdicts, pinned).
    assert.equal(normalizeDateOnly(new Date('2026-11-08T00:00:00.000Z')), '2026-11-08', 'stored DATE slices to itself');
    assert.equal(normalizeDateOnly('2026-11-08'), '2026-11-08', 'stored DATE string passes through');
    assert.equal(daysInCalendarMonth('2026-11-01'), 30, 'November has 30 days');
    assert.equal(daysInCalendarMonth('2026-02-01'), 28, 'February 2026 has 28 days');

    // 6. FMCG engine: an explicit referenceDate string drives the
    // promotion window (the caller must pass the tenant-local day).
    const promo = {
      id: 1, name: 'Mix 10%', code: 'MIX10', promoType: 'mix_and_match', applyType: 'discount_percent',
      buyConditions: [{ productId: 1, minQty: 1 }], reward: { discountPercent: 10 },
      startDate: '2026-11-01', endDate: '2026-11-30', isActive: true,
    };
    const cart = [{ productId: 1, qty: 2, unitPrice: 100 }];
    const inWindow = evaluateFmcgCartPromotions({ cartItems: cart, activePromotions: [promo as never], referenceDate: '2026-11-08' });
    assert.equal(inWindow.appliedPromotions.length, 1, 'promotion applies inside its window on the reference date');
    assert.equal(inWindow.totalPromotionalDiscount, 20, 'discount is 10% of the 200 subtotal');
    const outWindow = evaluateFmcgCartPromotions({ cartItems: cart, activePromotions: [promo as never], referenceDate: '2026-12-01' });
    assert.equal(outWindow.appliedPromotions.length, 0, 'promotion does not apply outside its window');

    // 7. Meeting minute end to end (window-limited: distinguishes
    // fixed/unfixed only while the UTC day and the Cairo day differ,
    // 00:00-02:59 Cairo; the deterministic proofs are (1)-(6), (8)-(9)).
    const expectedDay = await resolveBusinessDateKey(db, 't1', new Date());
    const minute = await withTimeout(
      contracting.createMeetingMinute(AUTH, 'p1', { meetingType: 'site_progress', location: 'Site', attendees: [], agenda: 'a', summary: 's' } as never),
      25000,
      'createMeetingMinute',
    );
    const stored = await sql<{ meeting_date: string }>`SELECT meeting_date FROM contracting_meeting_minutes WHERE id = ${Number((minute as any).id)}`.execute(db);
    assert.equal(stored.rows[0].meeting_date, expectedDay, 'meeting_date defaults to the tenant-local day');
    const explicit = await withTimeout(
      contracting.createMeetingMinute(AUTH, 'p1', { meetingType: 'site_progress', meetingDate: '2026-11-05', location: 'Site', attendees: [], agenda: 'a', summary: 's' } as never),
      25000,
      'createMeetingMinute explicit date',
    );
    const storedExplicit = await sql<{ meeting_date: string }>`SELECT meeting_date FROM contracting_meeting_minutes WHERE id = ${Number((explicit as any).id)}`.execute(db);
    assert.equal(storedExplicit.rows[0].meeting_date, '2026-11-05', 'explicit meetingDate passes through untouched');

    // 7b. EVM planned value end to end (window-limited like (7): it
    // distinguishes fixed/unfixed only while the UTC day and the Cairo
    // day differ). Three tasks start yesterday / today / tomorrow in
    // the tenant-local calendar; two are scheduled, so PV is 2/3 of
    // the 1000 budget. Under the old UTC "today" the task starting
    // today (Cairo) was excluded in the window and PV fell to 1/3.
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE IF NOT EXISTS contracting_projects (id bigint PRIMARY KEY, tenant_id text, code text, name text, client_id bigint, client_name text, status text, contract_value numeric, revised_contract_value numeric, down_payment_amount numeric, down_payment_recovered numeric, retention_percent numeric, retention_total_held numeric, retention_released numeric, start_date text, expected_end_date text, actual_end_date text, site_location_id bigint, cost_center_id bigint, project_manager text, location_address text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS contracting_invoices (id bigint PRIMARY KEY, tenant_id text, project_id bigint, ipc_type text, status text, current_amount numeric, stored_materials_amount numeric);
      CREATE TABLE IF NOT EXISTS contracting_change_orders (id bigint PRIMARY KEY, tenant_id text, project_id bigint, status text, cost_impact numeric);
      CREATE TABLE IF NOT EXISTS contracting_subcontracts (id bigint PRIMARY KEY, tenant_id text, project_id bigint, status text, total_amount numeric);
      CREATE TABLE IF NOT EXISTS contracting_cost_snapshots (id bigint PRIMARY KEY, tenant_id text, project_id bigint, total_budget_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS contracting_material_requisitions (id bigint PRIMARY KEY, tenant_id text, project_id bigint, total_cost numeric);
      CREATE TABLE IF NOT EXISTS contracting_labor_attendance_records (id bigint PRIMARY KEY, tenant_id text, project_id bigint, total_payable numeric);
      CREATE TABLE IF NOT EXISTS contracting_site_mobilization_expenses (id bigint PRIMARY KEY, tenant_id text, project_id bigint, amount numeric);
      CREATE TABLE IF NOT EXISTS contracting_petty_cash (id bigint PRIMARY KEY, tenant_id text, project_id bigint, status text, spent_amount numeric);
    `);
    await sql.raw(`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1)`).execute(db);
    await sql.raw(`INSERT INTO contracting_projects (id, tenant_id, code, name, status, contract_value, revised_contract_value, down_payment_amount, down_payment_recovered, retention_percent, retention_total_held, retention_released) VALUES (1, 't1', 'PRJ-1', 'Tower A', 'active', 1000, 1000, 0, 0, 5, 0, 0)`).execute(db);
    await sql.raw(`INSERT INTO contracting_invoices VALUES (1, 't1', 1, 'client', 'approved', 100.125, 0)`).execute(db);
    await sql.raw(`INSERT INTO contracting_material_requisitions VALUES (1, 't1', 1, 33.374)`).execute(db);
    const dayKey = (base: string, delta: number): string => {
      const d = new Date(`${base}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + delta);
      return d.toISOString().slice(0, 10);
    };
    await sql.raw(`INSERT INTO contracting_schedule_tasks (tenant_id, project_id, start_date, end_date, planned_manpower_count, planned_equipment_count, resource_trade) VALUES ('t1', '1', '${dayKey(expectedDay, -1)}', '${dayKey(expectedDay, -1)}', 0, 0, 'test'), ('t1', '1', '${expectedDay}', '${expectedDay}', 0, 0, 'test'), ('t1', '1', '${dayKey(expectedDay, 1)}', '${dayKey(expectedDay, 1)}', 0, 0, 'test')`).execute(db);
    const evm = await withTimeout(contracting.getProjectEvmMetrics(AUTH, '1'), 25000, 'getProjectEvmMetrics') as any;
    assert.equal(evm.earnedValue, 100.13, 'EVM earned value is the billed total at book digits');
    assert.equal(evm.actualCost, 33.37, 'EVM actual cost comes from the cost breakdown');
    assert.ok(Math.abs(evm.plannedValue - 666.67) < 0.01, `EVM planned value counts the task starting on the tenant-local today (got ${evm.plannedValue})`);

    // 8. Histogram week buckets under a Cairo-TZ child process: a task
    // starting 2026-11-08 (a stored DATE) must open the week on
    // 2026-11-08, not 2026-11-07. Deterministic: on a Cairo host the
    // old local-midnight snap (00:00 Cairo = 22:00Z the day before)
    // sliced the previous day. The child runs the REAL service method.
    const histTmp = path.resolve(__dirname, '.tmp-r3c-histogram-check.ts');
    try {
      fs.writeFileSync(histTmp, `import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ContractingService } from '../../src/modules/contracting/contracting.service';
async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec("CREATE TABLE settings (tenant_id text, key text, value text); CREATE TABLE contracting_schedule_tasks (id bigint generated always as identity primary key, tenant_id text, project_id text, start_date date, end_date date, planned_manpower_count numeric, planned_equipment_count numeric, resource_trade text);");
    await sql.raw("INSERT INTO settings VALUES ('t1', 'timezone', 'Africa/Cairo')").execute(db);
    await sql.raw("INSERT INTO contracting_schedule_tasks (tenant_id, project_id, start_date, end_date, planned_manpower_count, planned_equipment_count, resource_trade) VALUES ('t1', 'p1', '2026-11-08', '2026-11-08', 5, 2, 'test')").execute(db);
    const svc = new ContractingService(db, {} as never);
    const auth = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;
    const res = await svc.getResourceLoadingHistogram(auth, 'p1');
    console.log('WEEK_START=' + (res.weeks[0]?.weekStart ?? 'NONE'));
    console.log('WEEK_END=' + (res.weeks[0]?.weekEnd ?? 'NONE'));
  } finally { await db.destroy(); }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
`);
      const histOut = execFileSync('npx', ['ts-node', histTmp], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, TZ: 'Africa/Cairo' },
        timeout: 180000,
        encoding: 'utf8',
      });
      assert.ok(histOut.includes('WEEK_START=2026-11-08'), `histogram week opens on the task's DATE under Cairo TZ (got: ${histOut.trim()})`);
      assert.ok(histOut.includes('WEEK_END=2026-11-14'), `histogram week ends 6 days later (got: ${histOut.trim()})`);
    } finally {
      try { fs.unlinkSync(histTmp); } catch { /* already gone */ }
    }

    // 9. Payroll month-end under a Cairo-TZ child process: the local
    // constructor returns Nov 29 for a November run on a Cairo host;
    // Date.UTC returns Nov 30. Plus the source assertions that the
    // fixed expression is what hr.service.ts actually contains.
    const monthOut = execFileSync('node', ['-e', "console.log(new Date(2026, 11, 0).toISOString().slice(0, 10)); console.log(new Date(Date.UTC(2026, 11, 0)).toISOString().slice(0, 10));"], {
      env: { ...process.env, TZ: 'Africa/Cairo' },
      encoding: 'utf8',
    }).trim().split('\n');
    assert.equal(monthOut[0], '2026-11-29', 'old local-Date month-end is Nov 29 under Cairo TZ (the bug)');
    assert.equal(monthOut[1], '2026-11-30', 'Date.UTC month-end is Nov 30 under Cairo TZ (the fix)');
    const hrText = fs.readFileSync(path.join(SRC, 'modules/hr/hr.service.ts'), 'utf8');
    assert.ok(hrText.includes('Date.UTC(Number(periodMonth.split'), 'payroll month-end uses Date.UTC');
    assert.ok(!hrText.includes('new Date(Number(periodMonth.split'), 'payroll month-end no longer uses the local Date constructor');
    const contractingText = fs.readFileSync(path.join(SRC, 'modules/contracting/contracting.service.ts'), 'utf8');
    assert.ok(contractingText.includes('weekStart.setUTCHours(0, 0, 0, 0)'), 'histogram snaps with setUTCHours');
    assert.ok(!contractingText.includes('weekStart.setHours(0, 0, 0, 0)'), 'histogram no longer snaps with local setHours');

    // 10. Wiring pin: no live-instant UTC date slice remains in the
    // owned files except the four documented exceptions (a rollup
    // default the rollup service owns, an fmcg default the caller
    // owns, and two legacy-default branches kept for existing callers).
    const countDefect = (text: string): number => (text.match(/new Date\(\)\.toISOString\(\)\.(slice\(0, 10\)|split\('T'\)\[0\])/g) || []).length;
    const pinZero = [
      'modules/returns/helpers/returns-listing.helper.ts',
      'modules/hr/payroll-loan-allocation.engine.ts',
      'modules/hr/engines/hr-statutory-policy.engine.ts',
      'modules/hr/employee-portal.service.ts',
      'modules/hr/mobile-attendance.service.ts',
      'modules/hr/services/end-of-service.service.ts',
      'modules/hr/engines/hourly-attendance-pay.engine.ts',
      'modules/pharmacy/pharmacy.service.ts',
      'modules/storefront/engines/storefront-offers.engine.ts',
      'modules/catalog/services/catalog-product.service.ts',
      'modules/sales/services/restaurant-advanced-fnb.service.ts',
      'modules/delivery-reps/services/van-common.util.ts',
      'modules/contracting/contracting.service.ts',
      'modules/hr/hr.service.ts',
    ];
    for (const rel of pinZero) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
      assert.equal(countDefect(text), 0, `${rel} keeps no live-instant UTC date slice`);
    }
    const pinOne: Array<{ file: string; marker: string }> = [
      { file: 'modules/reports/reports.controller.ts', marker: 'targetDate' },
      { file: 'modules/delivery-reps/fmcg-promotions.engine.ts', marker: 'referenceDate' },
      { file: 'modules/sales/helpers/sales-query.helper.ts', marker: 'todayKey ??' },
      { file: 'modules/cash-drawer/helpers/cash-drawer.helper.ts', marker: 'todayKey ??' },
    ];
    for (const { file, marker } of pinOne) {
      const text = fs.readFileSync(path.join(SRC, file), 'utf8');
      assert.equal(countDefect(text), 1, `${file} keeps exactly one documented legacy slice`);
      assert.ok(text.includes(marker), `${file} legacy slice is the documented ${marker} case`);
    }

    console.log('business-date-display.spec: ok (gateway Cairo/Dubai, returns/cash-drawer zoned filters, sales tenant day, DATE round-trips, fmcg window, meeting minute tenant-local, EVM planned value)');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
