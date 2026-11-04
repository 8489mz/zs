/*
 * Demurrage: automatic charge at the live rate + manual entry,
 * coexisting without double-charging (INV-MARITIME-DEMURRAGE-AUTO-PLUS-MANUAL).
 *
 * THE GAP: the periodic demurrage scan invented a rate of 50
 * when a container had none (overdueDays * (rate || 50)),
 * and it created NO charge row at all -- the exposure lived
 * only on the container, so close-time invoicing had nothing
 * to bill unless staff typed the DEM row by hand.
 *
 * THE RULE: the container rate is USD/day (the import module
 * treats the same column as ratePerDayUsd, and the column
 * carries no currency). A zero/unset rate invents nothing:
 * the exposure amount is 0 and no charge is created. For an
 * overdue container with a positive amount the scan creates
 * ONE auto DEM charge, converted to the tenant base currency
 * at book digits through the shared resolver -- failing
 * closed (no charge, exposure still updated) when no live
 * USD rate is registered. A DEM/DETENTION charge whose name
 * already carries the container number suppresses creation:
 * a manual row stands untouched, an invoiced auto row stays
 * frozen, and an uninvoiced auto row is re-derived to the
 * new converted amount as overdue days grow. Completed
 * jobs get no charge (their exposure is still updated).
 * Staff override: delete the uninvoiced auto row in the
 * charge grid and add a manual DEM row naming the
 * container -- the next scan leaves it alone.
 *
 * WHAT THIS PINS, driving the REAL scheduler (with the REAL
 * freight service, stubbed mail/WhatsApp) on PGlite -- KWD
 * base, USD live 56 as seeded data, deadlines relative to
 * today so the scan's day math is exact:
 * - first scan creates exactly one auto DEM charge for the
 *   overdue container (50 USD -> 2800 KWD) and updates the
 *   exposure; a direct re-sync with a larger amount UPDATES
 *   that same row instead of duplicating it;
 * - a zero-rate container gets exposure 0 and no charge;
 * - a completed job's container gets its exposure updated
 *   but no charge;
 * - a tenant with no registered USD rate gets its exposure
 *   updated but no charge (fail closed);
 * - a pre-existing manual DEM row naming the container
 *   suppresses auto-creation and is left untouched;
 * - a pre-existing INVOICED auto row stays frozen at its
 *   billed amount;
 * - source pins: no invented 50 anywhere in the scheduler,
 *   the scan calls the sync helper, the helper converts
 *   through the shared resolver.
 *
 * HONEST LIMIT: the 6-hour timer itself is not awaited
 * (the scan method is driven directly); WhatsApp warnings
 * are not driven (no overdue-warning container is seeded
 * with a customer phone). The import module's own
 * DEFAULT 50.00 on its separate table is untouched -- a
 * different module, a different decision scope.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { MaritimeAutomationSchedulerService } from '../../src/modules/maritime-freight/maritime-automation-scheduler.service';

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const freightService = new MaritimeFreightService(db, {} as never, {} as never, {} as never);
  const scheduler = new MaritimeAutomationSchedulerService(
    db,
    freightService,
    {} as never,
    { sendRawMessage: async () => undefined } as never,
  );

  async function container(id: number): Promise<any> {
    return (db as any).selectFrom('maritime_containers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }
  async function demCharges(jobId: string): Promise<any[]> {
    return (db as any).selectFrom('maritime_job_charges').selectAll()
      .where('job_id', '=', jobId).where('charge_code', '=', 'DEM').orderBy('id', 'asc').execute();
  }

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE maritime_jobs (id bigint PRIMARY KEY, tenant_id text, status text);
      CREATE TABLE maritime_containers (id bigint PRIMARY KEY, tenant_id text, job_id bigint, container_number text, return_deadline date, empty_returned_at timestamptz, is_overdue boolean, overdue_days integer, demurrage_amount numeric, demurrage_rate_per_day numeric, updated_at timestamptz);
      CREATE TABLE maritime_job_charges (id bigserial PRIMARY KEY, tenant_id text, job_id text, charge_code text, charge_name_ar text, charge_name_en text, currency text, cost_amount numeric, sell_amount numeric, profit_amount numeric, is_local_charge boolean, tax_rate_percent numeric, tax_amount numeric, is_invoiced boolean);
      INSERT INTO settings VALUES ('t1','currency','KWD'),('t2','currency','KWD');
      INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','KWD',1,true),('t1','USD',56,false),('t2','KWD',1,true);
      INSERT INTO maritime_jobs VALUES (1,'t1','active'),(2,'t1','completed'),(4,'t2','active');
      INSERT INTO maritime_containers VALUES
        (1,'t1',1,'MSKU1234567','${daysAgo(5)}',NULL,false,0,0,10,NOW()),
        (2,'t1',1,'TGHU7654321','${daysAgo(2)}',NULL,false,0,0,0,NOW()),
        (3,'t1',2,'MSKU9999999','${daysAgo(3)}',NULL,false,0,0,20,NOW()),
        (4,'t2',4,'MSKU5555555','${daysAgo(4)}',NULL,false,0,0,25,NOW()),
        (5,'t1',1,'MSKU1111111','${daysAgo(6)}',NULL,false,0,0,10,NOW()),
        (6,'t1',1,'MSKU2222222','${daysAgo(2)}',NULL,false,0,0,10,NOW());
      INSERT INTO maritime_job_charges (tenant_id, job_id, charge_code, charge_name_ar, charge_name_en, currency, cost_amount, sell_amount, profit_amount, is_local_charge, tax_rate_percent, tax_amount, is_invoiced) VALUES
        ('t1','1','DEM','غرامة تأخير — MSKU1111111','Demurrage — MSKU1111111','KWD',5000,5000,0,false,0,0,false),
        ('t1','1','DEM','غرامة تأخير تلقائية — MSKU2222222','Demurrage (auto) — MSKU2222222','KWD',999,999,0,false,0,0,true);
    `);

    await scheduler.runPeriodicDemurrageScan();
    await scheduler.runPeriodicDemurrageScan();

    // 1. Overdue container: exposure updated, exactly one auto
    // charge at the live rate, not duplicated by the 2nd scan.
    const c1 = await container(1);
    assert.equal(c1.is_overdue, true);
    assert.equal(Number(c1.overdue_days), 5);
    assert.equal(Number(c1.demurrage_amount), 50, '5 days x 10 USD, no invented rate');
    const auto1 = (await demCharges('1')).filter((r: any) => String(r.charge_name_en).includes('MSKU1234567'));
    assert.equal(auto1.length, 1, 'one auto row after two scans');
    assert.equal(Number(auto1[0].sell_amount), 2800, '50 USD x live 56, KWD book digits');
    assert.equal(Number(auto1[0].cost_amount), 2800);
    assert.equal(auto1[0].currency, 'KWD');
    assert.equal(auto1[0].is_invoiced, false);

    // 1b. Growing exposure re-derives the same uninvoiced row.
    assert.equal(await freightService.syncDemurrageChargeForContainer('t1', 1, 'MSKU1234567', 70), 'updated');
    const auto1b = (await demCharges('1')).filter((r: any) => String(r.charge_name_en).includes('MSKU1234567'));
    assert.equal(auto1b.length, 1, 'still one row after re-derivation');
    assert.equal(Number(auto1b[0].sell_amount), 3920, '70 USD x live 56');

    // 2. Zero rate: exposure 0, no charge, nothing invented.
    const c2 = await container(2);
    assert.equal(Number(c2.demurrage_amount), 0);
    assert.equal((await demCharges('1')).filter((r: any) => String(r.charge_name_en).includes('TGHU7654321')).length, 0);

    // 3. Completed job: exposure updated, no charge.
    const c3 = await container(3);
    assert.equal(Number(c3.overdue_days), 3);
    assert.equal(Number(c3.demurrage_amount), 60);
    assert.equal((await demCharges('2')).length, 0);

    // 4. No registered USD rate: exposure updated, no charge.
    const c4 = await container(4);
    assert.equal(Number(c4.demurrage_amount), 100);
    assert.equal((await demCharges('4')).length, 0);

    // 5. Manual row naming the container suppresses creation.
    const c5 = await container(5);
    assert.equal(Number(c5.demurrage_amount), 60);
    const manual = (await demCharges('1')).filter((r: any) => String(r.charge_name_en).includes('MSKU1111111'));
    assert.equal(manual.length, 1, 'manual row stands alone, no auto twin');
    assert.equal(Number(manual[0].sell_amount), 5000, 'manual amount untouched');

    // 6. Invoiced auto row stays frozen.
    const c6 = await container(6);
    assert.equal(Number(c6.demurrage_amount), 20);
    const frozen = (await demCharges('1')).filter((r: any) => String(r.charge_name_en).includes('MSKU2222222'));
    assert.equal(frozen.length, 1);
    assert.equal(Number(frozen[0].sell_amount), 999, 'invoiced history never rewritten');
    assert.equal(frozen[0].is_invoiced, true);

    // 7. Direct sync statuses: create, re-derive, skip paths.
    assert.equal(await freightService.syncDemurrageChargeForContainer('t1', 1, 'NEWCONT1', 10), 'created');
    assert.equal(await freightService.syncDemurrageChargeForContainer('t1', 1, 'NEWCONT1', 10), 'updated');
    assert.equal((await demCharges('1')).filter((r: any) => String(r.charge_name_en).includes('NEWCONT1')).length, 1);
    assert.equal(await freightService.syncDemurrageChargeForContainer('t1', 1, 'NOAMOUNT', 0), 'skipped');
    assert.equal(await freightService.syncDemurrageChargeForContainer('t1', 2, 'MSKU9999999', 60), 'skipped');

    // 8. Source pins.
    const schedulerSource = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-automation-scheduler.service.ts'), 'utf8');
    assert.ok(!schedulerSource.includes('|| 50'), 'no invented rate may remain in the scan');
    assert.ok(schedulerSource.includes('demurrage_rate_per_day || 0'), 'an unset rate is zero, never invented');
    assert.ok(schedulerSource.includes('syncDemurrageChargeForContainer'), 'the scan must call the sync helper');
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight.service.ts'), 'utf8');
    const syncStart = serviceSource.indexOf('async syncDemurrageChargeForContainer(');
    const updateStart = serviceSource.indexOf('async updateContainer(');
    const syncBody = serviceSource.slice(syncStart, updateStart);
    assert.ok(syncBody.includes('resolveFxRate(this.db'), 'the auto charge must convert through the shared resolver');
    assert.ok(syncBody.includes('Demurrage (auto)'), 'auto rows must be identifiable by name');

    console.log('maritime demurrage auto-plus-manual checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
