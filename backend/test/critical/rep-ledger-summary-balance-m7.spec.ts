/*
 * M7 (INV-REP-LEDGER-SUMMARY-BALANCE) — the rep financial ledger
 * summary must count every non-waived item, and show overages.
 *
 * THE DEFECT (A8): getRepFinancialLedger summed totalCommissions
 * over ALL commission/bonus items with no status filter, so a WAIVED
 * bonus still counted as commission due; and netBalance /
 * netRepBalance subtracted ONLY pending shortages, so a paid
 * (settled) shortage and a pushed-to-payroll shortage vanished from
 * the balance. The breakdown already computed settledShortages /
 * waivedShortages / pushedToPayroll per rep but never used them. The
 * overage entry types (cash_overage / stock_overage, born 'settled'
 * at settleTrip) were ignored by the totals entirely.
 *
 * THE FIX: netBalance = commissionsDue - shortagesOwed, where
 * commissionsDue is commission/bonus with status != 'waived' and
 * shortagesOwed is cash/stock shortage with status != 'waived'
 * (pending + settled + pushed_to_payroll); waived leaves both sides.
 * Overages are summed as totalOverages / per-rep overages (status !=
 * 'waived') and NEVER folded into the net — they are company gains
 * (Cr 7100), not rep money. Display-only: no journal, no status
 * flip, no migration.
 *
 * WHY EACH STATUS COUNTS (grounded from the writers, see the INV
 * comment in van-sales.service.ts): 'waived' is the only
 * extinguishing status (a waived stock shortage reverses its Dr 1160
 * custody debit; a waived bonus posts nothing). 'settled' shortage
 * means cash was actually collected (Dr 1110 / Cr 7200 or Cr 1160 +
 * treasury + drawer row) — the charge was real, and the settled
 * bucket is displayed alongside so collected cash stays visible.
 * 'pushed_to_payroll' means an hr adjustment was WRITTEN (status
 * 'pending') but the money leaves the rep's pay only when the
 * targeted payroll run is built — not actually deducted yet. LIMIT:
 * no status ever records "the payroll run applied it", so a pushed
 * shortage stays in the net even after the run deducts it; the
 * pushed bucket is the admin's view of that amount.
 *
 * WHAT IS DRIVEN: the REAL VanSalesAdminController.getRepFinancialLedger
 * (GET api/van-sales/admin/financial-ledger) with a real
 * req.authContext (a service-level spec cannot catch controller
 * wiring) and the REAL getRepFinancialLedger summary over rows
 * seeded directly in van_rep_financial_settlements — the summary is
 * a pure read, so seeding rows is the fixture, not the code under
 * test; no journals are posted by this endpoint.
 *
 * BASE-RED: at base, cases 1, 2, 3, 4 and 5 fail (case 4 fails only
 * on the absent totalOverages key — the base summary has no such
 * field; the other base totals are zero as expected); case 6 already
 * passes at base (a rep with only pending rows is unaffected).
 *
 * Run: npx ts-node test/critical/rep-ledger-summary-balance-m7.spec.ts
 * (from backend/). Same PGlite script harness as
 * rep-waiver-approval-rule-m5.spec.ts: one fresh in-memory database
 * per case, db.destroy() teardown only.
 *
 * NOT DRIVEN: the frontend tab (VanFinancialLedgerAdminTab renders
 * totalCommissions and netRepBalance, so the corrected numbers reach
 * the screen; the NEW totalOverages field is computed and pinned
 * here but the tab does not render it yet — a one-card frontend
 * follow-up, see the package report); a live-Postgres rehearsal.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales.controller';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

function authFor(userId: number, role: string, username: string): AuthContext {
  return {
    userId, sessionId: `spec-m7-${userId}`, username, role,
    permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
  } as unknown as AuthContext;
}
const adminAuth = authFor(1, 'admin', 'admin-one');

function controllerReqFor(auth: AuthContext): any {
  return { authContext: auth } as any;
}

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, employee_id bigint, vehicle_plate text);
    CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, employee_no text);
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, shift_name text, status text);
    CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, payroll_run_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin-one' }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 4, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One', phone: '01000000001', employee_id: null, vehicle_plate: 'ABC-123' }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 5, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep Two', phone: '01000000002', employee_id: null, vehicle_plate: 'DEF-456' }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 6, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep Three', phone: '01000000003', employee_id: null, vehicle_plate: 'GHI-789' }).execute();
  await anyDb.insertInto('van_sales_trips').values({ id: 11, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, shift_name: 'Morning', status: 'settled' }).execute();
}

async function seedItem(
  db: Kysely<Database>,
  id: number,
  repId: number,
  entryType: string,
  amount: number,
  status: string,
): Promise<void> {
  await (db as any).insertInto('van_rep_financial_settlements').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, rep_id: repId, trip_id: 11,
    entry_type: entryType, amount, status, notes: `m7 fixture ${entryType} ${status}`,
  }).execute();
}

/** The headline mixed fixture for rep 4: a waived bonus (must leave
 * commissions), a settled shortage and a pushed shortage (must stay
 * in the balance), a waived shortage (must leave it), and both
 * overage types (must be shown, never netted). */
async function seedRepFourMixed(db: Kysely<Database>): Promise<void> {
  await seedItem(db, 401, 4, 'commission', 500, 'pending');
  await seedItem(db, 402, 4, 'bonus', 100, 'pending');
  await seedItem(db, 403, 4, 'bonus', 200, 'waived');
  await seedItem(db, 404, 4, 'cash_shortage', 150, 'pending');
  await seedItem(db, 405, 4, 'stock_shortage', 80, 'settled');
  await seedItem(db, 406, 4, 'cash_shortage', 70, 'pushed_to_payroll');
  await seedItem(db, 407, 4, 'stock_shortage', 60, 'waived');
  await seedItem(db, 408, 4, 'cash_overage', 40, 'settled');
  await seedItem(db, 409, 4, 'stock_overage', 25, 'settled');
}

function buildServices(db: Kysely<Database>): { controller: VanSalesAdminController } {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const audit = new AuditService(db);
  const fraudRadarStub = { recordSuspicionEvent: async () => {} } as never;
  const van = new VanSalesService(db, audit, {} as never, posting, undefined, undefined, undefined, undefined, undefined, undefined, fraudRadarStub);
  const controller = new VanSalesAdminController(van, {} as never, {} as never, {} as never, {} as never);
  return { controller };
}

async function main(): Promise<void> {
  const failures: string[] = [];
  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`  FAIL ${name}: ${String((error as Error)?.message || error).split('\n')[0]}`);
    }
  }

  // 1. Headline: waived bonus leaves commissions (600, not 800);
  // settled + pushed shortages stay in the balance; waived shortage
  // leaves it; overages are shown (65) and never netted.
  // net = 600 - (150 + 80 + 70) = 300.
  await check('M7 headline: commissions 600, net 300, overages 65 (waived bonus out, settled+pushed shortages in)', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRepFourMixed(db);
      const { controller } = buildServices(db);
      const result: any = await controller.getRepFinancialLedger(controllerReqFor(adminAuth), undefined, undefined, undefined, undefined);
      assert.equal(result.items.length, 9, 'all nine fixture rows are listed');
      const s = result.summary;
      assert.equal(s.totalCommissions, 600, 'waived bonus 200 leaves commissions: 500 + 100');
      assert.equal(s.totalPendingShortages, 150);
      assert.equal(s.totalSettledShortages, 80, 'settled shortage stays visible in its bucket');
      assert.equal(s.totalWaivedShortages, 60);
      assert.equal(s.totalPushedToPayroll, 70, 'pushed shortage stays visible in its bucket');
      assert.equal(s.totalOverages, 65, 'cash overage 40 + stock overage 25 are shown');
      assert.equal(s.netRepBalance, 300, 'net = 600 - (150 + 80 + 70)');
      assert.equal(s.repsBreakdown.length, 1, 'one rep in the breakdown');
      const rep = s.repsBreakdown[0];
      assert.equal(rep.repId, 4);
      assert.equal(rep.commissions, 600);
      assert.equal(rep.pendingShortages, 150);
      assert.equal(rep.settledShortages, 80);
      assert.equal(rep.waivedShortages, 60);
      assert.equal(rep.pushedToPayroll, 70);
      assert.equal(rep.overages, 65);
      assert.equal(rep.netBalance, 300, 'per-rep net matches the totals formula');
      assert.equal(rep.itemsCount, 9);
    } finally {
      await db.destroy();
    }
  });

  // 2. Two reps: totals sum both reps, breakdowns stay per-rep.
  // Rep 5: commission 1000 pending, stock shortage 400 pending.
  // Totals: commissions 1600, pending 550, net = 1600 - (550 + 80 + 70) = 900.
  await check('M7 two reps: totals 1600 / net 900, per-rep nets 300 and 600', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRepFourMixed(db);
      await seedItem(db, 410, 5, 'commission', 1000, 'pending');
      await seedItem(db, 411, 5, 'stock_shortage', 400, 'pending');
      const { controller } = buildServices(db);
      const result: any = await controller.getRepFinancialLedger(controllerReqFor(adminAuth), undefined, undefined, undefined, undefined);
      const s = result.summary;
      assert.equal(s.totalCommissions, 1600);
      assert.equal(s.totalPendingShortages, 550);
      assert.equal(s.totalSettledShortages, 80);
      assert.equal(s.totalPushedToPayroll, 70);
      assert.equal(s.totalOverages, 65);
      assert.equal(s.netRepBalance, 900, 'net = 1600 - (550 + 80 + 70)');
      assert.equal(s.repsBreakdown.length, 2, 'two reps in the breakdown');
      const repFour = s.repsBreakdown.find((r: any) => r.repId === 4);
      const repFive = s.repsBreakdown.find((r: any) => r.repId === 5);
      assert.equal(repFour.netBalance, 300, 'rep 4 net is unaffected by rep 5');
      assert.equal(repFive.commissions, 1000);
      assert.equal(repFive.pendingShortages, 400);
      assert.equal(repFive.settledShortages, 0);
      assert.equal(repFive.overages, 0);
      assert.equal(repFive.netBalance, 600, 'rep 5 net = 1000 - 400');
    } finally {
      await db.destroy();
    }
  });

  // 3. Waived-only rep: a waived bonus and a waived shortage leave
  // commissions and net at exactly zero — forgiveness extinguishes.
  await check('M7 waived-only rep: commissions 0, net 0, waived shortage 30 in its bucket', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedItem(db, 412, 6, 'bonus', 50, 'waived');
      await seedItem(db, 413, 6, 'stock_shortage', 30, 'waived');
      const { controller } = buildServices(db);
      const result: any = await controller.getRepFinancialLedger(controllerReqFor(adminAuth), undefined, undefined, undefined, undefined);
      const s = result.summary;
      assert.equal(s.totalCommissions, 0, 'a waived bonus is not commission due');
      assert.equal(s.totalWaivedShortages, 30);
      assert.equal(s.totalPendingShortages, 0);
      assert.equal(s.totalOverages, 0);
      assert.equal(s.netRepBalance, 0);
      assert.equal(s.repsBreakdown.length, 1);
      assert.equal(s.repsBreakdown[0].commissions, 0);
      assert.equal(s.repsBreakdown[0].netBalance, 0);
    } finally {
      await db.destroy();
    }
  });

  // 4. Empty ledger: every total is zero and the breakdown is empty
  // (no phantom rep, no NaN).
  await check('M7 empty ledger: all totals 0, empty breakdown', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { controller } = buildServices(db);
      const result: any = await controller.getRepFinancialLedger(controllerReqFor(adminAuth), undefined, undefined, undefined, undefined);
      assert.equal(result.items.length, 0);
      const s = result.summary;
      assert.equal(s.totalCommissions, 0);
      assert.equal(s.totalPendingShortages, 0);
      assert.equal(s.totalSettledShortages, 0);
      assert.equal(s.totalWaivedShortages, 0);
      assert.equal(s.totalPushedToPayroll, 0);
      assert.equal(s.totalOverages, 0);
      assert.equal(s.netRepBalance, 0);
      assert.deepEqual(s.repsBreakdown, []);
    } finally {
      await db.destroy();
    }
  });

  // 5. Status filter scopes the statement: with status='settled' the
  // summary is computed over settled rows only — commissions 0,
  // settled shortage 80, overages 65, net = 0 - 80 = -80.
  await check("M7 status filter 'settled': commissions 0, net -80, overages 65", async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRepFourMixed(db);
      const { controller } = buildServices(db);
      const result: any = await controller.getRepFinancialLedger(controllerReqFor(adminAuth), undefined, 'settled', undefined, undefined);
      assert.equal(result.items.length, 3, 'settled shortage + two settled overages');
      const s = result.summary;
      assert.equal(s.totalCommissions, 0);
      assert.equal(s.totalPendingShortages, 0);
      assert.equal(s.totalSettledShortages, 80);
      assert.equal(s.totalPushedToPayroll, 0);
      assert.equal(s.totalOverages, 65);
      assert.equal(s.netRepBalance, -80, 'net = 0 - 80 over the filtered window');
      assert.equal(s.repsBreakdown.length, 1);
      assert.equal(s.repsBreakdown[0].netBalance, -80);
    } finally {
      await db.destroy();
    }
  });

  // 6. Rep filter scopes the statement: repId=5 returns only rep 5.
  await check('M7 rep filter: rep 5 only — commissions 1000, net 600', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRepFourMixed(db);
      await seedItem(db, 410, 5, 'commission', 1000, 'pending');
      await seedItem(db, 411, 5, 'stock_shortage', 400, 'pending');
      const { controller } = buildServices(db);
      const result: any = await controller.getRepFinancialLedger(controllerReqFor(adminAuth), '5', undefined, undefined, undefined);
      assert.equal(result.items.length, 2);
      const s = result.summary;
      assert.equal(s.totalCommissions, 1000);
      assert.equal(s.totalPendingShortages, 400);
      assert.equal(s.netRepBalance, 600);
      assert.equal(s.repsBreakdown.length, 1);
      assert.equal(s.repsBreakdown[0].repId, 5);
      assert.equal(s.repsBreakdown[0].netBalance, 600);
    } finally {
      await db.destroy();
    }
  });

  // 7. Source pins: the invariant id and the corrected formula are
  // in the service, and the controller forwards the real auth context.
  {
    const here = __dirname;
    const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-rep-financial-ledger.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-REP-LEDGER-SUMMARY-BALANCE'), 'the ledger-summary invariant is named');
    assert.ok(vanSource.includes('totalOverages'), 'overages are totalled');
    assert.ok(vanSource.includes("['cash_overage', 'stock_overage']"), 'both overage types are recognised');
    assert.ok(vanSource.includes('repEntry.settledShortages + repEntry.pushedToPayroll'), 'settled and pushed shortages enter the per-rep net');
    assert.ok(vanSource.includes('totalSettledShortages + totalPushedToPayroll'), 'settled and pushed shortages enter the totals net');
    const controllerSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'), 'utf8');
    assert.ok(controllerSource.includes('getRepFinancialLedger'), 'the controller exposes the ledger endpoint');
    assert.ok(controllerSource.includes('req.authContext!'), 'the controller forwards the real auth context');
    console.log('  PASS M7 source pins');
  }

  if (failures.length) throw new Error(`${failures.length} M7 case(s) failed: ${failures.join(', ')}`);
  console.log('M7 rep ledger-summary-balance tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
