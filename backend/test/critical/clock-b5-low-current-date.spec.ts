import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ArCollectionsService } from '../../src/modules/accounting/services/ar-collections.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { formatLocalCalendarDay, todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { addDaysToDayKey } from '../../src/common/utils/client-date-bounds.util';

/*
 * Clock B5-P3 (re-review-2 NEW-D + NEW-F): the low clock defects left
 * after Batch 4.
 *
 * THE DEFECTS:
 * - NEW-D maritime demurrage + rate-card expiry: `deadlineDayKey` and
 *   `validUntilDayKey` (maritime-freight.service.ts) UTC-slice a stored
 *   pg DATE (`return_deadline`, `valid_until`) while the other side of
 *   each comparison IS tenant-resolved (resolveBusinessDateKey) — so a
 *   container is charged demurrage a day early and a rate card is marked
 *   'expired' a day early on any host east of UTC.
 * - NEW-D extra (:3346, updateContainer): `new Date(deadlineDate)
 *   .toISOString().slice(0, 10)` — the re-review listed :3338/:3346 as
 *   verified NOT findings, but grounding shows :3346 IS the same defect
 *   in the fall-through path: `deadlineDate` is a string when the :3333
 *   branch runs (correct) or when dto.returnDeadline is set (correct),
 *   but it stays the pg DATE `container.return_deadline`
 *   (migration 0080:229, DATE; the row is selectAll() from pg, so a
 *   local-midnight Date) when dto.returnDeadline is undefined AND the
 *   branch does not run (no discharge recorded, or no dischargedAt /
 *   freeDays override with a stored deadline). Then overdueDays is +1
 *   and demurrage_amount is overstated by one day's rate. :3338 itself
 *   is correct (baseDate is UTC-midnight built from a tenant day string)
 *   and is NOT touched. This hunk is a documented deviation from the
 *   brief's do-not-touch for :3346, with the evidence above; the merge
 *   may drop it.
 * - NEW-F read-query CURRENT_DATE buckets/flags (the DB day, not the
 *   tenant day): ar-collections getOverview "promised today" bucket
 *   (:83); van-rep-financial-ledger pushRepShortagesToPayroll
 *   period-passed flag (:1002) — decides whether a shortage deduction
 *   rolls forward to the next payroll run; hr approveLoan active
 *   contract lookup (:2168-2169) — decides the loan ceiling
 *   (wage x 3); import getImportCommandCenterMetrics ACI expiry window
 *   (:6217). None of them posts money; each reads the wrong day for up
 *   to a day around the tenant midnight.
 *
 * RED DESIGN (this VM is UTC; PGlite returns DATE as UTC-midnight and
 * its session timezone is Etc/GMT0, so CURRENT_DATE is the UTC day):
 * - §0 is the mechanism proof (Cairo child, B4-P1 pattern): the UTC
 *   slice of a host-local-midnight Date yields the previous day, while
 *   formatLocalCalendarDay yields the stored day; the same child proves
 *   the :3346 overdue arithmetic (old 1 day, new 0). It passes on
 *   pristine AND fixed — it proves WHY the slices are wrong.
 * - §A/§B/§C are source pins (the maritime derivations are inline
 *   closures in their service methods, not exported helpers): the fixed
 *   call must be present and the UTC slice absent. They fail on
 *   pristine.
 * - §D1 is service-driven: getOverview on a tenant whose day is
 *   discordant with the UTC day (runtime-picked zone: Kiritimati when
 *   UTC hour >= 10, Midway otherwise — at any hour the tenant day
 *   differs from the UTC day). A promise dated the tenant day must
 *   count; a promise dated the UTC day must not. On pristine the
 *   CURRENT_DATE bucket counts the wrong one (100, not 250).
 * - §D2/§D3/§D4 pair a source pin (the RED) with a SQL-fragment
 *   contrast run against PGlite under the same discordant tenant day:
 *   the OLD expression (CURRENT_DATE) and the NEW expression (tenant
 *   day bound) return different row sets at every hour, and the NEW
 *   set equals the tenant-day expectation computed from the runtime
 *   days. The fragments replicate the production SQL; they run on both
 *   trees as mechanism proof.
 *
 * HONEST LIMITS: §A/§B/§C are source-pinned, not service-driven
 * (fixture cost disproportionate; the derivations ARE
 * formatLocalCalendarDay, already tested by B4-P1/B5-P1). §D2/§D3/§D4
 * drive the SQL fragments, not the full service methods (the methods
 * need payroll/loan/ACI fixtures out of proportion to a read-query
 * bound). A live-Postgres rehearsal on a Cairo host is still owed for
 * the end-to-end DATE paths, as for B4-P1/P2/B5-P1.
 */

const SRC = path.resolve(__dirname, '../../src');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function fnSlice(src: string, signature: string, len = 4000): string {
  const i = src.indexOf(signature);
  assert.ok(i >= 0, `method ${signature} must exist`);
  return src.slice(i, i + len);
}

async function main(): Promise<void> {
  // §0 — Cairo child: the mechanism proof. Runs FIRST so the pristine
  // failure is diagnosed by the behavioural sections, not by this pin.
  const childDir = fs.mkdtempSync(path.join(__dirname, '.tmp-b5p3-'));
  const childTmp = path.join(childDir, 'cairo-check.ts');
  try {
    fs.writeFileSync(
      childTmp,
      `import { formatLocalCalendarDay, todayTenantDate } from '../../../src/common/utils/tenant-timezone.util';
async function main(): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone !== 'Africa/Cairo') { console.error('child zone is ' + zone + ', want Africa/Cairo'); process.exit(2); }
  const day = new Date(2026, 10, 14);
  if (day.toISOString().slice(0, 10) !== '2026-11-13') { console.error('expected the UTC slice to yield 2026-11-13 under Cairo TZ (the bug)'); process.exit(1); }
  if (formatLocalCalendarDay(day) !== '2026-11-14') { console.error('formatLocalCalendarDay must yield 2026-11-14 under Cairo TZ'); process.exit(1); }
  if (todayTenantDate('Africa/Cairo', day) !== '2026-11-14') { console.error('todayTenantDate(Cairo) must yield 2026-11-14'); process.exit(1); }
  // :3346 overdue arithmetic: a stored deadline of 2026-11-14 with the
  // tenant endDay 2026-11-14 is 0 days overdue; the UTC slice makes the
  // deadline 2026-11-13, so the same day counts as 1 day overdue.
  const endDay = '2026-11-14';
  const oldDeadlineDay = day.toISOString().slice(0, 10);
  const newDeadlineDay = formatLocalCalendarDay(day);
  const oldOverdue = Math.max(0, Math.round((Date.parse(endDay) - Date.parse(oldDeadlineDay)) / 86400000));
  const newOverdue = Math.max(0, Math.round((Date.parse(endDay) - Date.parse(newDeadlineDay)) / 86400000));
  if (oldOverdue !== 1 || newOverdue !== 0) { console.error('overdue must be old=1 new=0, got old=' + oldOverdue + ' new=' + newOverdue); process.exit(1); }
  console.log('CAIRO-CHILD-OK');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
`,
    );
    const out = execFileSync('npx', ['ts-node', childTmp], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, TZ: 'Africa/Cairo' },
      timeout: 180000,
      encoding: 'utf8',
    });
    assert.ok(out.includes('CAIRO-CHILD-OK'), `Cairo child must pass (got: ${out.trim()})`);
    console.log(
      '✓ §0 passed: the UTC slice yields the previous day under Cairo TZ; the tenant-day helpers yield the stored day; old overdue 1 vs new 0',
    );
  } finally {
    try {
      fs.unlinkSync(childTmp);
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(childDir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }

  // §A — NEW-D demurrage: deadlineDayKey keys the stored DATE from
  // host-local calendar parts, not the UTC slice.
  // Maritime split: assertJobCanClose lives in the jobs-core slice, PUBLIC
  // there (the facade delegate keeps the private signature).
  const jobsCore = read('modules/maritime-freight/maritime-freight-jobs-core.service.ts');
  const closure = fnSlice(jobsCore, 'async assertJobCanClose(', 6000);
  assert.ok(
    closure.includes('formatLocalCalendarDay(value)'),
    'deadlineDayKey must use formatLocalCalendarDay for the Date branch',
  );
  assert.ok(
    !closure.includes('value.toISOString().slice(0, 10)'),
    'deadlineDayKey must no longer UTC-slice the stored DATE',
  );
  console.log('✓ §A passed: demurrage deadline keys on the stored calendar day');

  // §B — NEW-D rate cards: validUntilDayKey keys the stored DATE from
  // host-local calendar parts, not the UTC slice.
  // Maritime split: listRateCards lives in the rate-cards slice.
  const rateCardsSource = read('modules/maritime-freight/maritime-freight-rate-cards.service.ts');
  const rateCards = fnSlice(rateCardsSource, 'async listRateCards(', 6000);
  assert.ok(
    rateCards.includes('formatLocalCalendarDay(value)'),
    'validUntilDayKey must use formatLocalCalendarDay for the Date branch',
  );
  assert.ok(
    !rateCards.includes('value.toISOString().slice(0, 10)'),
    'validUntilDayKey must no longer UTC-slice the stored DATE',
  );
  console.log('✓ §B passed: rate-card expiry keys on the stored calendar day');

  // §C — NEW-D extra (:3346): the updateContainer deadline derivation
  // must not UTC-slice a value that can be the pg DATE.
  // Maritime split: updateContainer lives in the jobs-containers slice.
  const containers = read('modules/maritime-freight/maritime-freight-jobs-containers.service.ts');
  const updateContainer = fnSlice(containers, 'async updateContainer(', 8000);
  assert.ok(
    updateContainer.includes('formatLocalCalendarDay(deadlineDate as unknown as Date)'),
    'updateContainer must key deadlineDate from host-local calendar parts',
  );
  assert.ok(
    !updateContainer.includes('new Date(deadlineDate).toISOString().slice(0, 10)'),
    'updateContainer must no longer UTC-slice deadlineDate',
  );
  // :3338 stays: baseDate is UTC-midnight built from a tenant day string.
  assert.ok(
    updateContainer.includes('deadlineDate = baseDate.toISOString().slice(0, 10)'),
    ':3338 UTC-calendar math on the UTC-midnight baseDate must stay',
  );
  console.log('✓ §C passed: updateContainer deadline keys on the stored calendar day (:3338 untouched)');

  // ---- shared PGlite fixture for §D (one db; the tenant day is
  // discordant with the UTC day at every hour: Kiritimati is UTC+14,
  // so its day is the UTC day + 1 from 10:00 UTC; Midway is UTC-11,
  // so its day is the UTC day - 1 before 10:00 UTC) ----
  const utcHour = new Date().getUTCHours();
  const discZone = utcHour >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Midway';
  const utcDay = new Date().toISOString().slice(0, 10);
  const tenantDay = todayTenantDate(discZone);
  assert.notEqual(
    tenantDay,
    utcDay,
    `discordant zone ${discZone} must differ from the UTC day ${utcDay} at UTC hour ${utcHour}`,
  );

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const arCollections = new ArCollectionsService(db);
  const authFor = (tenantId: string): AuthContext =>
    ({
      tenantId,
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      username: 'admin',
      permissions: ['accounting'],
    }) as unknown as AuthContext;

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t-b5p3-disc');
      CREATE TABLE settings (tenant_id text, key text, value text);
      INSERT INTO settings VALUES
        ('t-b5p3-disc','timezone','"${discZone}"'),
        ('t-b5p3-disc','currency','EGP');
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO currency_exchange_rates VALUES ('t-b5p3-disc', 'EGP', true, 1);
      CREATE TABLE ar_collection_cases (id bigserial PRIMARY KEY, tenant_id text, status text,
        total_overdue numeric DEFAULT 0, oldest_overdue_days int DEFAULT 0,
        promised_payment_date date, promised_amount numeric DEFAULT 0);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, is_credit_blocked boolean DEFAULT false);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, period_month text,
        start_date date, end_date date);
      CREATE TABLE hr_employment_contracts (id bigint PRIMARY KEY, tenant_id text, employee_id bigint,
        base_salary numeric, status text, start_date date, end_date date);
      CREATE TABLE import_aci_compliance (id bigint PRIMARY KEY, tenant_id text, status text,
        acid_expiry_date date);
    `);

    // §D1 — ar-collections getOverview, service-driven: a promise dated
    // the tenant day counts in "promised today"; one dated the UTC day
    // must not.
    await db
      .insertInto('ar_collection_cases' as any)
      .values([
        {
          tenant_id: 't-b5p3-disc',
          status: 'promised_to_pay',
          total_overdue: 250,
          oldest_overdue_days: 1,
          promised_payment_date: tenantDay,
          promised_amount: 250,
        },
        {
          tenant_id: 't-b5p3-disc',
          status: 'promised_to_pay',
          total_overdue: 100,
          oldest_overdue_days: 1,
          promised_payment_date: utcDay,
          promised_amount: 100,
        },
      ] as any)
      .execute();
    const overview = await arCollections.getOverview(authFor('t-b5p3-disc'));
    assert.equal(
      overview.promisedAmountToday,
      250,
      `promised today must be the tenant-day promise only (250), got ${overview.promisedAmountToday}`,
    );
    console.log('✓ §D1 passed: "promised today" counts the tenant-day promise, not the DB-day one');

    // §D2 — van ledger periodPassed fragment contrast + source pin.
    // Runs: end_date = tenant day (r1) and end_date = UTC day (r2).
    await db
      .insertInto('hr_payroll_runs' as any)
      .values([
        { id: 1, tenant_id: 't-b5p3-disc', period_month: '2026-11', start_date: tenantDay, end_date: tenantDay },
        { id: 2, tenant_id: 't-b5p3-disc', period_month: '2026-11', start_date: utcDay, end_date: utcDay },
      ] as any)
      .execute();
    const oldPassed = await sql<{ id: number }>`SELECT id FROM hr_payroll_runs WHERE end_date < CURRENT_DATE`.execute(
      db,
    );
    const newPassed = await sql<{ id: number }>`SELECT id FROM hr_payroll_runs WHERE end_date < ${tenantDay}`.execute(
      db,
    );
    const oldIds = oldPassed.rows.map((r) => r.id).sort();
    const newIds = newPassed.rows.map((r) => r.id).sort();
    assert.notDeepEqual(
      oldIds,
      newIds,
      `OLD (CURRENT_DATE) and NEW (tenant day) period-passed sets must differ (old=${JSON.stringify(oldIds)} new=${JSON.stringify(newIds)})`,
    );
    const expectedNew = tenantDay > utcDay ? [2] : [];
    assert.deepEqual(
      newIds,
      expectedNew,
      `NEW set must be the tenant-day expectation ${JSON.stringify(expectedNew)}, got ${JSON.stringify(newIds)}`,
    );
    // File #59 split: pushRepShortagesToPayroll moved to the S5 slice.
    const ledger = read(
      'modules/delivery-reps/services/van-rep-financial-ledger/push-rep-shortages-to-payroll.slice.ts',
    );
    const pushShortages = fnSlice(ledger, 'async pushRepShortagesToPayroll(', 8000);
    assert.ok(
      pushShortages.includes('end_date < ${todayKey}'),
      'periodPassed must compare end_date against the tenant-day bound',
    );
    assert.ok(!pushShortages.includes('end_date < CURRENT_DATE'), 'periodPassed must no longer use CURRENT_DATE');
    console.log(
      '✓ §D2 passed: period-passed flag keys on the tenant day (fragment sets differ, NEW matches expectation)',
    );

    // §D3 — hr approveLoan contract lookup fragment contrast + pin.
    // One contract active exactly on the tenant day: active under the
    // tenant day, inactive under the UTC day (discordant by design).
    await db
      .insertInto('hr_employment_contracts' as any)
      .values([
        {
          id: 1,
          tenant_id: 't-b5p3-disc',
          employee_id: 7,
          base_salary: 10000,
          status: 'active',
          start_date: tenantDay,
          end_date: tenantDay,
        },
      ] as any)
      .execute();
    const oldActive = await sql<{
      id: number;
    }>`SELECT id FROM hr_employment_contracts WHERE status = 'active' AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE)`.execute(
      db,
    );
    const newActive = await sql<{
      id: number;
    }>`SELECT id FROM hr_employment_contracts WHERE status = 'active' AND start_date <= ${tenantDay} AND (end_date IS NULL OR end_date >= ${tenantDay})`.execute(
      db,
    );
    assert.equal(oldActive.rows.length, 0, 'OLD (CURRENT_DATE) must miss the tenant-day contract');
    assert.equal(newActive.rows.length, 1, 'NEW (tenant day) must find the tenant-day contract');
    const hr = read('modules/hr/services/hr-loans.service.ts');
    const approveLoan = fnSlice(hr, 'async approveLoan(', 8000);
    assert.ok(
      approveLoan.includes('start_date <= ${todayKey}'),
      'contract lookup must bound start_date by the tenant day',
    );
    assert.ok(approveLoan.includes('end_date >= ${todayKey}'), 'contract lookup must bound end_date by the tenant day');
    assert.ok(
      !approveLoan.includes('start_date <= CURRENT_DATE'),
      'approveLoan start_date must no longer use CURRENT_DATE',
    );
    assert.ok(
      !approveLoan.includes('end_date >= CURRENT_DATE'),
      'approveLoan end_date must no longer use CURRENT_DATE',
    );
    console.log('✓ §D3 passed: loan-ceiling contract lookup keys on the tenant day');

    // §D4 — import ACI expiry window fragment contrast + pin.
    // Expiries at tenant day + 14 (e1) and + 15 (e2): the two windows
    // must select different sets at every hour, and NEW selects {e1}.
    const bound14 = addDaysToDayKey(tenantDay, 14);
    const bound15 = addDaysToDayKey(tenantDay, 15);
    assert.ok(bound14 && bound15, 'tenant day + 14/+15 must be valid day keys');
    await db
      .insertInto('import_aci_compliance' as any)
      .values([
        { id: 1, tenant_id: 't-b5p3-disc', status: 'pending', acid_expiry_date: bound14 },
        { id: 2, tenant_id: 't-b5p3-disc', status: 'pending', acid_expiry_date: bound15 },
      ] as any)
      .execute();
    const oldAci = await sql<{
      id: number;
    }>`SELECT id FROM import_aci_compliance WHERE acid_expiry_date <= CURRENT_DATE + INTERVAL '14 days'`.execute(db);
    const newAci = await sql<{
      id: number;
    }>`SELECT id FROM import_aci_compliance WHERE acid_expiry_date <= ${bound14}`.execute(db);
    const oldAciIds = oldAci.rows.map((r) => r.id).sort();
    const newAciIds = newAci.rows.map((r) => r.id).sort();
    assert.notDeepEqual(
      oldAciIds,
      newAciIds,
      `OLD (CURRENT_DATE + 14d) and NEW (tenant day + 14d) ACI windows must differ (old=${JSON.stringify(oldAciIds)} new=${JSON.stringify(newAciIds)})`,
    );
    assert.deepEqual(
      newAciIds,
      [1],
      `NEW window must select exactly the tenant-day+14 expiry, got ${JSON.stringify(newAciIds)}`,
    );
    const importSales = read('modules/import-sales/services/import-profit-report.service.ts');
    const metrics = fnSlice(importSales, 'async getImportCommandCenterMetrics(', 8000);
    assert.ok(
      !metrics.includes("CURRENT_DATE + INTERVAL '14 days'"),
      'ACI window must no longer use CURRENT_DATE + 14 days',
    );
    assert.ok(
      metrics.includes('acidBound') || metrics.includes('addDaysToDayKey'),
      'ACI window must derive its bound from the tenant day',
    );
    console.log('✓ §D4 passed: ACI expiry window keys on the tenant day + 14');

    console.log('CLOCK-B5-P3 CHECKS PASSED');
  } finally {
    await pg.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
