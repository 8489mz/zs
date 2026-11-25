/*
 * Clock B4-P2 — ZATCA issueTime + allocation_date + postSupplierBill entryDate.
 *
 * THREE DEFECTS, one root cause each (re-review of the single-server-clock
 * audit, base 663294777):
 *
 * 1. ZATCA issueTime host-local labeled Z (RC-3 #5, carried P4 follow-up #3):
 *    zatca-phase2.service.ts built `issueTime` from
 *    `saleDate.toTimeString()` — the HOST's wall time — while `issueDate`
 *    is the TENANT day (P4, todayTenantDate). On a Cairo host with a UTC
 *    tenant the invoice carried 00:30 Cairo time against the UTC date;
 *    on a UTC host with a Kuwait tenant it carried 21:30 UTC against the
 *    Kuwait date (00:30 next day). Date and time described different
 *    instants. THE FIX: a shared `formatTenantTime24(timezone, date)`
 *    (tenant-timezone.util.ts, next to todayTenantDate) formats the same
 *    instant in the tenant zone with hourCycle h23, and the service
 *    resolves the tenant zone once and uses it for BOTH issueDate and
 *    issueTime. DECISION, recorded: emitting true UTC time was rejected —
 *    it would make issueTime disagree with the tenant-day issueDate (a
 *    00:30 Cairo sale would carry the previous UTC day's time against
 *    the Cairo date). The `Z` suffix on the QR timestamp is the
 *    pre-existing format convention at both call sites (and the UBL
 *    <cbc:IssueTime> is a bare HH:mm:ss) — unchanged; the defect was the
 *    host-local time, not the suffix.
 *
 * 2. allocation_date CURRENT_DATE (RC-9, live): payment-allocation
 *    .service.ts inserted `allocation_date: sql`CURRENT_DATE`` — the DB
 *    server's local date, not the tenant day. THE FIX: the writer
 *    supplies `todayTenantDate(await getTenantTimezone(trx, tenantId),
 *    new Date())`, and migration 0329 drops the CURRENT_DATE default
 *    (P9 pattern: guarded information_schema check; down does NOT
 *    restore the default — restoring it would reintroduce the hole).
 *    payment_allocations has exactly ONE writer in src, so dropping
 *    the default cannot break another insert path.
 *
 * 3. postSupplierBill entryDate (new latent, supplier-bill work):
 *    purchases-treasury-posting.service.ts built `entryDate` via
 *    `new Date(bill.bill_date)` — bill_date is a pg DATE, i.e. a
 *    host-local-midnight instant — and insertPostedJournal re-derives
 *    it via resolveBusinessDateKey in the TENANT zone, yielding the
 *    previous day whenever the tenant zone is WEST of the host zone
 *    (Cairo host + UTC tenant: bill 2026-11-14 -> journal 2026-11-13).
 *    THE FIX: pass the stored day string
 *    (`formatLocalCalendarDay` for a Date, passthrough for a day
 *    string) so resolveBusinessDateKey passes it through untouched.
 *    That needs `entryDate: Date | string` on insertPostedJournal /
 *    postDomainJournal (backward-compatible: every existing caller
 *    passes a Date). The created_at fallback stays `new Date(...)` —
 *    created_at is a timestamptz INSTANT, and the instant copy is
 *    correct for instants.
 *
 * WHAT THIS PINS, driving the REAL code (no duplicated formula):
 * - §C the real PaymentAllocationService.allocatePayment on PGlite
 *   with a runtime-picked tenant zone whose day differs from the DB
 *   (UTC) day at this hour (Kiritimati UTC+14 / Midway UTC-11 — one
 *   always differs): the written allocation_date equals the tenant
 *   day, not CURRENT_DATE. GENUINE RED on pristine.
 * - §B source pins: the ZATCA service uses formatTenantTime24 for
 *   issueTime and no longer calls toTimeString(); issueDate is
 *   unchanged in form.
 * - §A the real formatTenantTime24 on a frozen instant (in-parent,
 *   host-independent) + a TZ=Africa/Cairo child proving the OLD
 *   expression is host-local (23:30:00 on a Cairo host vs 00:30:00
 *   Kuwait tenant time) — the mechanism, labeled as such.
 * - §D source pins (postSupplierBill passes the day string; the
 *   journal entryDate type admits strings) + a TZ=Africa/Cairo
 *   child running the REAL resolveBusinessDateKey on PGlite: the
 *   old path (local-midnight Date, tenant UTC) yields 2026-11-13,
 *   the new path (day string) yields 2026-11-14.
 * - §E the REAL migration 0329 on PGlite: the default is gone,
 *   up() is idempotent, an insert without allocation_date now fails
 *   (NOT NULL, fail-closed) and an insert with it succeeds.
 *
 * SECTION ORDER (failure-priority, deliberate): §C runs first so the
 * pristine RED is the genuine writer assertion, not a missing-module
 * error (§A's helper and §E's migration module do not exist on
 * pristine; they are loaded via require() inside their sections so
 * the file still compiles on pristine under both runners).
 *
 * PGlite quirk, stated once: PGlite returns DATE columns as UTC
 * -midnight Dates, unlike node-postgres (host-local midnight) — so
 * a plain PGlite spec cannot RED zone-fragile paths on a UTC host.
 * That is why §A/§D use TZ=Africa/Cairo children and §C uses a
 * runtime-picked tenant zone.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { PaymentAllocationService } from '../../src/modules/accounting/services/payment-allocation.service';
import * as migration0329 from '../../src/database/migrations/2040000000329_payment_allocations_allocation_date';
import {
  todayTenantDate,
  formatLocalCalendarDay,
  formatTenantTime24,
} from '../../src/common/utils/tenant-timezone.util';

const SRC = path.resolve(__dirname, '../../src');
const BACKEND = path.resolve(__dirname, '../..');
const FROZEN = new Date('2026-04-08T21:30:00.000Z'); // 23:30 Cairo, 00:30 Kuwait (04-09), 21:30 UTC

function pickZone(): { zone: string; tenantDay: string; utcDay: string } {
  const now = new Date();
  const utcDay = todayTenantDate('UTC', now);
  const kiribatiDay = todayTenantDate('Pacific/Kiritimati', now);
  const midwayDay = todayTenantDate('Pacific/Midway', now);
  // Kiritimati (UTC+14) is a day ahead once UTC passes 10:00; Midway
  // (UTC-11) is a day behind before 11:00 UTC. One always differs.
  const zone = kiribatiDay !== utcDay ? 'Pacific/Kiritimati' : 'Pacific/Midway';
  const tenantDay = todayTenantDate(zone, now);
  assert.notEqual(tenantDay, utcDay, `picked zone ${zone} must differ from the DB (UTC) day at this hour`);
  return { zone, tenantDay, utcDay };
}

/** Run a temp .ts file with ts-node under TZ=Africa/Cairo; returns stdout. */
function runCairoChild(src: string): string {
  const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-b4p2-'));
  const file = path.join(dir, 'child.ts');
  try {
    fs.writeFileSync(file, src);
    return execFileSync('npx', ['ts-node', file], {
      cwd: BACKEND,
      env: { ...process.env, TZ: 'Africa/Cairo' },
      timeout: 180000,
      encoding: 'utf8',
    });
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    // ── §C. Real allocatePayment: allocation_date is the tenant day ───
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE customer_payments (id integer PRIMARY KEY, tenant_id text, customer_id integer, amount numeric);
      CREATE TABLE sales (id integer PRIMARY KEY, tenant_id text, customer_id integer, total numeric, paid_amount numeric, store_credit_used numeric, payment_type text, status text, updated_at timestamptz);
      CREATE TABLE return_documents (tenant_id text, return_type text, invoice_id integer, total numeric, refund_allocations text);
      CREATE TABLE payment_allocations (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id varchar(128) NOT NULL, account_id varchar(160) NOT NULL, partner_type varchar(50) NOT NULL, partner_id integer NOT NULL, payment_type varchar(50) NOT NULL, payment_id integer, invoice_type varchar(50) NOT NULL, invoice_id integer NOT NULL, allocated_amount numeric(14, 2) NOT NULL, allocation_date date NOT NULL DEFAULT CURRENT_DATE, notes text DEFAULT '', created_by integer, created_at timestamptz NOT NULL DEFAULT now());
    `);
    const { zone, tenantDay, utcDay } = pickZone();
    await sql.raw(`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`).execute(db);
    await sql.raw(`INSERT INTO settings VALUES ('t1', 'timezone', '${zone}')`).execute(db);
    await sql
      .raw(
        `INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true)`,
      )
      .execute(db);
    await sql
      .raw(`INSERT INTO customer_payments (id, tenant_id, customer_id, amount) VALUES (1, 't1', 11, 100)`)
      .execute(db);
    await sql
      .raw(
        `INSERT INTO sales (id, tenant_id, customer_id, total, paid_amount, store_credit_used, payment_type, status) VALUES (99, 't1', 11, 100, 0, 0, 'cash', 'posted')`,
      )
      .execute(db);
    const auth = {
      tenantId: 't1',
      accountId: 'a1',
      userId: 1,
      username: 'tester',
      role: 'admin',
      permissions: [],
    } as unknown as AuthContext;
    const svc = new PaymentAllocationService(db);
    const res = await svc.allocatePayment(
      {
        partnerType: 'customer',
        paymentType: 'customer_payment',
        partnerId: 11,
        paymentId: 1,
        allocations: [{ invoiceId: 99, amount: 10 }],
      },
      auth,
    );
    assert.equal(res.success, true, 'allocation posts');
    assert.equal(res.totalAllocated, 10, 'allocation total is 10');
    const row = await db.selectFrom('payment_allocations').select('allocation_date').executeTakeFirst();
    assert.ok(row, 'one allocation row written');
    const written =
      row!.allocation_date instanceof Date
        ? row!.allocation_date.toISOString().slice(0, 10) // PGlite returns DATE as UTC midnight: the slice is exact here
        : String(row!.allocation_date).slice(0, 10);
    assert.equal(
      written,
      tenantDay,
      `allocation_date is the tenant day (${zone} = ${tenantDay}), not the DB day (got ${written})`,
    );
    assert.notEqual(written, utcDay, `allocation_date must differ from DB CURRENT_DATE (${utcDay}) at this hour`);
    console.log(`✓ §C passed: allocation_date = ${written} (tenant ${zone}), DB day = ${utcDay}`);

    // ── §B. ZATCA wiring pins ───
    const zatcaText = fs.readFileSync(
      path.join(SRC, 'modules/tax-integration/services/zatca/zatca-phase2.service.ts'),
      'utf8',
    );
    assert.ok(
      zatcaText.includes('formatTenantTime24(businessTimezone, saleDate)'),
      'issueTime comes from formatTenantTime24 in the tenant zone',
    );
    assert.ok(!zatcaText.includes('toTimeString()'), 'issueTime no longer uses the host-local toTimeString()');
    assert.ok(
      zatcaText.includes('todayTenantDate(businessTimezone, saleDate)'),
      'issueDate still uses todayTenantDate in the tenant zone',
    );
    assert.ok(zatcaText.includes('formatTenantTime24'), 'formatTenantTime24 is imported from the tenant-timezone util');
    console.log('✓ §B passed: ZATCA issueTime is tenant-zone; no toTimeString() remains');

    // ── §A. formatTenantTime24 on a frozen instant ───
    assert.equal(typeof formatTenantTime24, 'function', 'formatTenantTime24 exists on the tenant-timezone util');
    const fmt = formatTenantTime24;
    assert.equal(fmt('UTC', FROZEN), '21:30:00', 'UTC time of the frozen instant');
    assert.equal(fmt('Africa/Cairo', FROZEN), '23:30:00', 'Cairo time of the frozen instant');
    assert.equal(fmt('Asia/Kuwait', FROZEN), '00:30:00', 'Kuwait time of the frozen instant (next day)');
    assert.equal(
      todayTenantDate('Asia/Kuwait', FROZEN),
      '2026-04-09',
      'Kuwait day agrees with its time (date+time are one instant)',
    );
    assert.equal(
      fmt('Africa/Cairo', new Date('2026-04-08T22:00:00.000Z')),
      '00:00:00',
      'midnight formats as 00:00:00, never 24:00:00 (hourCycle h23)',
    );
    // Mechanism, labeled: the OLD expression is host-local. Under a Cairo
    // host it yields 23:30:00 while the Kuwait tenant's time is 00:30:00.
    // (True on both trees — it proves WHY the fix was needed, not the fix.)
    let cairoOut: string;
    try {
      cairoOut =
        runCairoChild(`import { formatTenantTime24, todayTenantDate } from '../../../src/common/utils/tenant-timezone.util';
const frozen = new Date('2026-04-08T21:30:00.000Z');
console.log('TIME_CAIRO=' + formatTenantTime24('Africa/Cairo', frozen));
console.log('TIME_KUWAIT=' + formatTenantTime24('Asia/Kuwait', frozen));
console.log('DAY_KUWAIT=' + todayTenantDate('Asia/Kuwait', frozen));
console.log('OLD_HOST_TIME=' + new Date('2026-04-08T21:30:00.000Z').toTimeString().slice(0, 8));
`);
    } catch (e: any) {
      assert.fail(`Cairo child failed (expected on pristine — formatTenantTime24 missing): ${e.stderr || e.message}`);
    }
    assert.ok(
      cairoOut!.includes('TIME_CAIRO=23:30:00'),
      `Cairo child: helper agrees under a non-UTC host (got: ${cairoOut!.trim()})`,
    );
    assert.ok(
      cairoOut!.includes('TIME_KUWAIT=00:30:00'),
      `Cairo child: Kuwait time still 00:30:00 (got: ${cairoOut!.trim()})`,
    );
    assert.ok(
      cairoOut!.includes('DAY_KUWAIT=2026-04-09'),
      `Cairo child: Kuwait day still 2026-04-09 (got: ${cairoOut!.trim()})`,
    );
    assert.ok(
      cairoOut!.includes('OLD_HOST_TIME=23:30:00'),
      `Cairo child: the OLD toTimeString() yields host-local 23:30:00, not tenant 00:30:00 (got: ${cairoOut!.trim()})`,
    );
    console.log(
      '✓ §A passed: formatTenantTime24 agrees date+time in the tenant zone; old expression proven host-local',
    );

    // ── §D. postSupplierBill entryDate: pins + mechanism ───
    const postingText = fs.readFileSync(
      path.join(SRC, 'modules/accounting/services/purchases-treasury-posting.service.ts'),
      'utf8',
    );
    assert.ok(
      postingText.includes('formatLocalCalendarDay'),
      'postSupplierBill derives the bill day from local calendar parts',
    );
    assert.ok(
      !postingText.includes('new Date((bill as any).bill_date)'),
      'postSupplierBill no longer wraps the pg DATE in new Date()',
    );
    const coreText = fs.readFileSync(
      path.join(SRC, 'modules/accounting/services/journal-posting-core.service.ts'),
      'utf8',
    );
    const widened = (coreText.match(/entryDate: Date \| string/g) || []).length;
    assert.ok(
      widened >= 2,
      `insertPostedJournal/postDomainJournal admit a day string (found ${widened} widened signatures, want 2)`,
    );
    // Mechanism, labeled: the REAL resolveBusinessDateKey on PGlite in a
    // Cairo-TZ child. The old path (local-midnight Date, tenant UTC)
    // yields the previous day; the new path (day string) is exact.
    // (True on both trees — it proves WHY the fix was needed.)
    let mechOut: string;
    try {
      mechOut = runCairoChild(`import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../../src/database/database.types';
import { resolveBusinessDateKey } from '../../../src/modules/accounting/engines/accounting-date.engine';
import { formatLocalCalendarDay } from '../../../src/common/utils/tenant-timezone.util';
async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec("CREATE TABLE settings (tenant_id text, key text, value text);");
    await sql.raw("INSERT INTO settings VALUES ('t1', 'timezone', 'UTC')").execute(db);
    const localMidnight = new Date(2026, 10, 14); // host-local midnight, as node-postgres returns a pg DATE
    console.log('OLD=' + await resolveBusinessDateKey(db, 't1', localMidnight));
    console.log('NEW=' + await resolveBusinessDateKey(db, 't1', '2026-11-14'));
    console.log('LOCAL_PARTS=' + formatLocalCalendarDay(localMidnight));
  } finally { await db.destroy(); }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
`);
    } catch (e: any) {
      assert.fail(`Cairo mechanism child failed: ${e.stderr || e.message}`);
    }
    assert.ok(
      mechOut!.includes('OLD=2026-11-13'),
      `Cairo child: old path yields the previous day (got: ${mechOut!.trim()})`,
    );
    assert.ok(mechOut!.includes('NEW=2026-11-14'), `Cairo child: day-string path is exact (got: ${mechOut!.trim()})`);
    assert.ok(
      mechOut!.includes('LOCAL_PARTS=2026-11-14'),
      `Cairo child: local parts recover the stored day (got: ${mechOut!.trim()})`,
    );
    console.log('✓ §D passed: postSupplierBill passes the day string; old path proven one day early');

    // ── §E. The REAL migration 0329 on PGlite ───
    assert.equal(typeof migration0329.migration?.up, 'function', 'migration 0329 exports an up()');
    const defBefore = await sql<{
      column_default: string | null;
    }>`SELECT column_default FROM information_schema.columns WHERE table_name = 'payment_allocations' AND column_name = 'allocation_date'`.execute(
      db,
    );
    assert.notEqual(
      defBefore.rows[0]?.column_default,
      null,
      'fixture carries the 0063 CURRENT_DATE default before the migration',
    );
    await migration0329.migration!.up(db);
    const defAfter = await sql<{
      column_default: string | null;
    }>`SELECT column_default FROM information_schema.columns WHERE table_name = 'payment_allocations' AND column_name = 'allocation_date'`.execute(
      db,
    );
    assert.equal(defAfter.rows[0]?.column_default, null, 'migration 0329 dropped the CURRENT_DATE default');
    await migration0329.migration!.up(db); // idempotent re-run
    const defAgain = await sql<{
      column_default: string | null;
    }>`SELECT column_default FROM information_schema.columns WHERE table_name = 'payment_allocations' AND column_name = 'allocation_date'`.execute(
      db,
    );
    assert.equal(defAgain.rows[0]?.column_default, null, 'migration 0329 re-run is a no-op');
    let threw = false;
    try {
      await sql
        .raw(
          `INSERT INTO payment_allocations (tenant_id, account_id, partner_type, partner_id, payment_type, invoice_type, invoice_id, allocated_amount) VALUES ('t1', 'a1', 'customer', 11, 'customer_payment', 'sale', 99, 5)`,
        )
        .execute(db);
    } catch {
      threw = true;
    }
    assert.equal(
      threw,
      true,
      'an insert without allocation_date now fails (NOT NULL, fail-closed) instead of silently stamping the DB day',
    );
    await sql
      .raw(
        `INSERT INTO payment_allocations (tenant_id, account_id, partner_type, partner_id, payment_type, invoice_type, invoice_id, allocated_amount, allocation_date) VALUES ('t1', 'a1', 'customer', 11, 'customer_payment', 'sale', 99, 5, '2026-11-14')`,
      )
      .execute(db);
    console.log('✓ §E passed: migration 0329 dropped the default (idempotent); writer-supplied dates still insert');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => {
    console.log('CLOCK-B4-P2 CHECKS PASSED');
    process.exit(0);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
