/*
 * New file: backend/test/critical/employee-match-deterministic-m3.spec.ts
 *
 * WHAT THIS PINS (INV-REP-EMPLOYEE-MATCH-DETERMINISTIC, M3: A4):
 * pushRepShortagesToPayroll resolved an unlinked rep to an HR
 * employee with one unordered OR query — `display_name ILIKE
 * %repName%` OR `national_id = …`, executeTakeFirst() with no
 * ORDER BY — and then PERMANENTLY wrote the winner into
 * delivery_representatives.employee_id. With several matching
 * employees the linked employee was whichever row the planner
 * returned first, a % or _ in the rep name matched spuriously as a
 * LIKE wildcard, and a name match could beat the national_id
 * match. A wrong employee could then have a rep's shortage
 * deducted from his pay.
 *
 * THE FIX (van-sales.service.ts, pushRepShortagesToPayroll):
 * (1) the match is two ordered steps — an exact national_id match
 *     is tried first and wins over any name match;
 * (2) the name match escapes LIKE wildcards (% _ and backslash)
 *     and carries an explicit ESCAPE '\';
 * (3) both steps order by id ascending, so the same input always
 *     links the same employee.
 *
 * WHAT IS DRIVEN (real PGlite, real service method, no mocks):
 * (a) deterministic order: two employees match one rep name, and
 *     two different reps with that name both link the lowest-id
 *     employee; the same holds when the employees are inserted in
 *     reverse order, so the winner does not depend on scan order;
 * (b) a rep name containing _ does not match spuriously: "A_B"
 *     links the literal "A_B" employee, not the lower-id "AXB";
 * (c) a rep name containing % does not match spuriously: "50%"
 *     links the literal "50% Off" employee, not the lower-id
 *     "50X Off";
 * (d) a national_id match wins over a display_name match when
 *     both exist: the rep's national_id employee is linked even
 *     though a lower-id employee matches the rep name;
 * (e) a national_id with no employee still falls back to the name
 *     match (no regression on the old fallback);
 * (f) source pins: the invariant is named, the old unescaped OR
 *     pattern is gone, and the escape is explicit.
 *
 * NOT DRIVEN: a live-Postgres run; true two-connection concurrency
 * (PGlite is single-connection); the frontend rep-linking screens
 * (untouched).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

const TENANT = 't1';
const ACCOUNT = 'a1';

// Local calendar parts, never UTC toISOString(): the target month is
// computed from the machine-local date.
const now = new Date();
const CUR = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const adminAuth: any = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, employee_id bigint, national_id text, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, display_name text, national_id text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, hire_date date, end_of_service_date date, has_social_insurance boolean, insurance_salary numeric, has_income_tax boolean, pay_frequency text, user_id bigint, commission_type text, commission_value numeric, commission_target numeric, delay_policy text, approved_leave_days numeric);
    CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, payroll_run_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE hr_employee_adjustments (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, run_id bigint, item_id bigint, status text, applied_in_run_id bigint, amount numeric, date date, adjustment_type text, amount_type text, accounting_category text, reason text, source_type text, source_id text, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, account_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, updated_at timestamptz);
    INSERT INTO settings VALUES ('t1','currency','EGP');
  `);
  return { pg, db };
}

function buildVanService(db: any): any {
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  return service;
}

async function seedEmployee(db: Kysely<Database>, id: number, displayName: string, nationalId: string | null = null): Promise<void> {
  await (db as any).insertInto('hr_employees').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, display_name: displayName, national_id: nationalId,
    status: 'active', compensation_type: 'monthly', hourly_rate: 0, expected_daily_hours: 8,
    hire_date: '2026-01-01', end_of_service_date: null, has_social_insurance: false,
    insurance_salary: 0, has_income_tax: false, pay_frequency: 'monthly', user_id: null,
    commission_type: null, commission_value: 0, commission_target: null, delay_policy: null,
    approved_leave_days: 0,
  }).execute();
}

async function seedRep(db: Kysely<Database>, repId: number, name: string, nationalId: string | null = null): Promise<void> {
  await (db as any).insertInto('delivery_representatives').values({
    id: repId, tenant_id: TENANT, account_id: ACCOUNT, name,
    phone: null, vehicle_plate: null, van_location_id: 10, employee_id: null, national_id: nationalId,
  }).execute();
}

async function seedSettlement(db: Kysely<Database>, id: number, repId: number, amount = 100): Promise<void> {
  await (db as any).insertInto('van_rep_financial_settlements').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, rep_id: repId, trip_id: 11,
    entry_type: 'cash_shortage', amount, status: 'pending', notes: 'shortage',
  }).execute();
}

async function push(db: Kysely<Database>, settlementIds: number[]): Promise<any> {
  const service = buildVanService(db);
  return service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds, targetMonth: CUR }, adminAuth);
}

async function repEmployeeId(db: Kysely<Database>, repId: number): Promise<number | null> {
  const row = await (db as any).selectFrom('delivery_representatives').select('employee_id').where('id', '=', repId).executeTakeFirst();
  return row?.employee_id === null || row?.employee_id === undefined ? null : Number(row.employee_id);
}

async function adjustmentEmployeeIds(db: Kysely<Database>): Promise<number[]> {
  const rows = await (db as any).selectFrom('hr_employee_adjustments').select('employee_id').orderBy('id', 'asc').execute();
  return rows.map((r: any) => Number(r.employee_id));
}

async function main(): Promise<void> {
  // (a) Deterministic order: two employees match one rep name, and
  // two different reps with that name both link the lowest-id
  // employee — so the shortage is deducted from the same employee
  // every time, not from whichever row the planner returns first.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 11, 'Ahmed Ali');
      await seedEmployee(db, 12, 'Ahmed Hassan');
      await seedRep(db, 4, 'Ahmed');
      await seedRep(db, 5, 'Ahmed');
      await seedSettlement(db, 401, 4);
      await seedSettlement(db, 402, 5);
      const pushed = await push(db, [401, 402]);
      assert.equal(pushed.results[0].success, true, 'the first push succeeds');
      assert.equal(pushed.results[1].success, true, 'the second push succeeds');
      assert.equal(await repEmployeeId(db, 4), 11, 'the first rep links the lowest-id matching employee');
      assert.equal(await repEmployeeId(db, 5), 11, 'the second rep with the same name links the same employee');
      assert.deepEqual(await adjustmentEmployeeIds(db), [11, 11], 'both deductions land on the same employee');
    } finally {
      await db.destroy();
    }
    console.log('  (a) deterministic order across two reps with one shared name passed');
  }

  // (a2) The winner does not depend on insertion / scan order: the
  // same employees inserted in reverse order still link the
  // lowest-id employee.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 12, 'Ahmed Hassan');
      await seedEmployee(db, 11, 'Ahmed Ali');
      await seedRep(db, 4, 'Ahmed');
      await seedSettlement(db, 401, 4);
      const pushed = await push(db, [401]);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      assert.equal(await repEmployeeId(db, 4), 11, 'the rep links the lowest-id matching employee even when it was inserted second');
      assert.deepEqual(await adjustmentEmployeeIds(db), [11], 'the deduction lands on the lowest-id matching employee');
    } finally {
      await db.destroy();
    }
    console.log('  (a2) deterministic order independent of insertion order passed');
  }

  // (b) A _ in the rep name is a literal underscore, not a wildcard:
  // "A_B" links the literal "A_B" employee, not the lower-id "AXB"
  // that an unescaped %A_B% pattern would also match.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 11, 'AXB');
      await seedEmployee(db, 12, 'A_B');
      await seedRep(db, 4, 'A_B');
      await seedSettlement(db, 401, 4);
      const pushed = await push(db, [401]);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      assert.equal(await repEmployeeId(db, 4), 12, 'the rep links the literal underscore employee, not the wildcard match');
      assert.deepEqual(await adjustmentEmployeeIds(db), [12], 'the deduction lands on the literal underscore employee');
    } finally {
      await db.destroy();
    }
    console.log('  (b) underscore in the rep name does not match spuriously passed');
  }

  // (c) A % in the rep name is a literal percent, not a wildcard:
  // "50%" links the literal "50% Off" employee, not the lower-id
  // "50X Off" that an unescaped %50%% pattern would also match.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 11, '50X Off');
      await seedEmployee(db, 12, '50% Off');
      await seedRep(db, 4, '50%');
      await seedSettlement(db, 401, 4);
      const pushed = await push(db, [401]);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      assert.equal(await repEmployeeId(db, 4), 12, 'the rep links the literal percent employee, not the wildcard match');
      assert.deepEqual(await adjustmentEmployeeIds(db), [12], 'the deduction lands on the literal percent employee');
    } finally {
      await db.destroy();
    }
    console.log('  (c) percent in the rep name does not match spuriously passed');
  }

  // (d) A national_id match wins over a display_name match when both
  // exist: the rep's national_id employee is linked even though a
  // lower-id employee matches the rep name.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 11, 'Ahmed Ali', null);
      await seedEmployee(db, 12, 'Khaled Omar', 'N123');
      await seedRep(db, 4, 'Ahmed', 'N123');
      await seedSettlement(db, 401, 4);
      const pushed = await push(db, [401]);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      assert.equal(await repEmployeeId(db, 4), 12, 'the rep links the national_id employee, not the lower-id name match');
      assert.deepEqual(await adjustmentEmployeeIds(db), [12], 'the deduction lands on the national_id employee');
    } finally {
      await db.destroy();
    }
    console.log('  (d) national_id match wins over display_name match passed');
  }

  // (e) A national_id with no employee still falls back to the name
  // match — the old fallback is preserved, not removed with the OR.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 11, 'Ahmed Ali', null);
      await seedRep(db, 4, 'Ahmed', 'N999');
      await seedSettlement(db, 401, 4);
      const pushed = await push(db, [401]);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      assert.equal(await repEmployeeId(db, 4), 11, 'the rep falls back to the name match when no employee has the national_id');
      assert.deepEqual(await adjustmentEmployeeIds(db), [11], 'the deduction lands on the name-matched employee');
    } finally {
      await db.destroy();
    }
    console.log('  (e) national_id miss falls back to the name match passed');
  }

  // (f) Source pins: the fix names the invariant, the old unescaped
  // OR pattern is gone, and the escape is explicit. (The
  // ARCHITECTURE_INVARIANTS.md entry itself is owned by the
  // coordinator and is not pinned here.)
  {
    const vanSource = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/services/van-rep-financial-ledger.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-REP-EMPLOYEE-MATCH-DETERMINISTIC'), 'van-sales names the invariant');
    assert.ok(!vanSource.includes("eb('display_name', 'ilike', `%${item.repName}%`)"), 'the old unescaped name pattern is gone');
    assert.ok(vanSource.includes('ESCAPE'), 'the name match carries an explicit ESCAPE clause');
    assert.ok(vanSource.includes("orderBy('id', 'asc')"), 'the match steps order deterministically by id');
    assert.ok(vanSource.includes("eb('national_id', '=', item.repNationalId)") || vanSource.includes("'national_id', '=', item.repNationalId"), 'the national_id step is an exact match tried first');
    console.log('  source pins passed');
  }

  console.log('Employee match deterministic M3 tests passed');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
