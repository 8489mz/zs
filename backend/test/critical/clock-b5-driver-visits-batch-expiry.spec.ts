/* clock-b5-driver-visits-batch-expiry.spec.ts — B5-P2 (clock, NEW-C + NEW-E):
 * the driver's today-itinerary visits and the tracked-stock batch
 * expiry both derive from the TENANT day (single-server-clock rule).
 *
 * NEW-C (van-routes.service.ts:getDriverTodayItinerary): the
 * today-visits query filtered `visited_at >= CURRENT_DATE` — the
 * DATABASE host's day. On a UTC DB host a Cairo tenant's visits in
 * the first two hours of the tenant day (00:00-02:00 Cairo = 22:00-
 * 00:00 UTC the previous day) were missing from "today", and a
 * west-of-UTC tenant's yesterday visits were wrongly included. The
 * fix bounds visited_at by the tenant day (AT TIME ZONE, the P7
 * pattern), reusing the tenant zone already resolved in the function.
 *
 * NEW-E (tracked-stock-increase.helper.ts:expiryIso): the Date branch
 * UTC-sliced the stored expiry day, so a batch expiring today was
 * treated as expired a day early and could not gain quantity on its
 * last valid day. The fix keys it from the local calendar parts.
 *
 * RED design (this spec MUST exit 1 on pristine):
 * - §0 runs the REAL expiryIso through a TZ=Africa/Cairo child
 *   (the business-date-display pattern): a local-midnight Date is
 *   what node-postgres delivers for a pg DATE. On pristine the
 *   export does not exist at all, so the child reports
 *   EXPIRY_FN=undefined and §0 fails there; on the fixed tree the
 *   child prints the stored day.
 * - §B/§C drive the REAL getDriverTodayItinerary on PGlite. The
 *   discordant case is picked at runtime (the P7 §B pattern): the
 *   Cairo miss case applies 00:00-22:00 UTC, the Midway
 *   over-inclusion case 11:00-24:00 UTC, so at least one case REDs
 *   whenever the spec runs. PGlite's session is pinned to UTC so
 *   CURRENT_DATE is the DB day on every host.
 *
 * Honest limits (read before re-opening these):
 * - NEW-E's Date branch is HARDENING, not a live-behavior change:
 *   pharmacy_batches.expiry_date is varchar(30) (migration
 *   2040000000008), so DB rows arrive as strings and take the
 *   string branch (unchanged); every writer passes a YYYY-MM-DD
 *   string. The Cairo child pins the helper's Date branch
 *   mechanism, not a live path.
 * - The live-Postgres rehearsal on a Cairo host is still owed.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { VanRoutesService } from '../../src/modules/delivery-reps/services/van-routes.service';

const BACKEND_ROOT = resolve(__dirname, '../..');

// DDL for driving getDriverTodayItinerary (the P7 §B harness,
// verbatim): settings + currency + customers + ledger + trips +
// sales + returns + reps + visits + orders.
const ITINERARY_DDL = `
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
  CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
  CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text);
  CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
  CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, customer_name text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
  CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, status text);
  CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
  CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, negative_reason text, postponed_to_date date, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
  CREATE TABLE sales_orders (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, rep_id bigint);
`;

async function driveItinerary(
  tenant: string,
  zone: string,
  visits: Array<{ customerId: number; visitedAt: string }>,
): Promise<any[]> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec("SET TIME ZONE 'UTC'");
    await pg.exec(ITINERARY_DDL);
    const anyDb = db as any;
    await anyDb.insertInto('settings').values({ tenant_id: tenant, key: 'currency', value: 'EGP' }).execute();
    await anyDb
      .insertInto('settings')
      .values({ tenant_id: tenant, key: 'timezone', value: `"${zone}"` })
      .execute();
    await anyDb
      .insertInto('currency_exchange_rates')
      .values({ tenant_id: tenant, currency_code: 'EGP', exchange_rate: 1, is_base: true })
      .execute();
    for (const v of visits) {
      await anyDb
        .insertInto('customers')
        .values({
          id: v.customerId,
          tenant_id: tenant,
          name: 'عميل ' + v.customerId,
          is_active: true,
          balance: 0,
          credit_limit: 0,
          metadata: JSON.stringify({ assigned_rep_ids: [1] }),
        })
        .execute();
      await anyDb
        .insertInto('van_field_visits')
        .values({
          tenant_id: tenant,
          rep_id: 1,
          customer_id: v.customerId,
          visit_type: 'positive',
          visited_at: v.visitedAt,
        })
        .execute();
    }
    const service = new VanRoutesService(db, {} as never);
    return (await service.getDriverTodayItinerary(tenant, 1)) as any[];
  } finally {
    await db.destroy();
  }
}

async function main(): Promise<void> {
  // ---- §0: Cairo-child mechanism + the NEW-E export ----
  // A local-midnight Date is what node-postgres delivers for a pg
  // DATE. Under TZ=Africa/Cairo the UTC slice renders the previous
  // day; the local parts render the stored day. The child runs the
  // REAL expiryIso (when the export exists).
  const childDir = fs.mkdtempSync(path.join(__dirname, '.tmp-b5p2-'));
  const childFile = path.join(childDir, 'batch-expiry-check.ts');
  try {
    fs.writeFileSync(
      childFile,
      `import * as helper from '../../../src/modules/inventory/helpers/tracked-stock-increase.helper';
import { formatLocalCalendarDay } from '../../../src/common/utils/tenant-timezone.util';
const lm = (y: number, m: number, d: number): Date => new Date(y, m - 1, d);
const out: string[] = [];
out.push('MECH_UTC_SLICE=' + lm(2026, 11, 14).toISOString().slice(0, 10));
out.push('MECH_LOCAL_PARTS=' + formatLocalCalendarDay(lm(2026, 11, 14)));
const expiryIso = (helper as any).expiryIso;
out.push('EXPIRY_FN=' + typeof expiryIso);
if (typeof expiryIso === 'function') {
  out.push('EXPIRY_DAY=' + expiryIso(lm(2026, 11, 14)));
  out.push('EXPIRY_STR=' + expiryIso('2026-11-14'));
  out.push('EXPIRY_MONTH=' + expiryIso('2026-11'));
  out.push('EXPIRY_EMPTY=' + expiryIso(''));
  out.push('EXPIRY_NULL=' + expiryIso(null));
}
console.log(out.join('\\n'));
`,
    );
    const childOut = execFileSync('npx', ['ts-node', childFile], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, TZ: 'Africa/Cairo' },
      timeout: 180000,
      encoding: 'utf8',
    });
    console.log(childOut.trim());
    const line = (key: string): string => {
      const found = childOut.split('\n').find((l) => l.startsWith(key + '='));
      assert.ok(found, `child must print ${key}`);
      return found.slice(key.length + 1);
    };
    // Mechanism: the UTC slice is the previous day under Cairo TZ.
    assert.equal(line('MECH_UTC_SLICE'), '2026-11-13');
    assert.equal(line('MECH_LOCAL_PARTS'), '2026-11-14');
    // THE RED for NEW-E (fails on pristine — the export does not
    // exist there): expiryIso must exist and key a pg DATE from its
    // local calendar parts.
    assert.equal(line('EXPIRY_FN'), 'function', 'expiryIso must be exported (clock B5-P2)');
    assert.equal(line('EXPIRY_DAY'), '2026-11-14', 'a batch expiring today must key to today, not yesterday');
    assert.equal(line('EXPIRY_STR'), '2026-11-14', 'the string branch is unchanged');
    assert.equal(line('EXPIRY_MONTH'), '2026-11', 'a YYYY-MM expiry passes through');
    assert.equal(line('EXPIRY_EMPTY'), '', 'a missing expiry stays empty');
    assert.equal(line('EXPIRY_NULL'), '', 'a null expiry stays empty');
    console.log('✓ §0 passed: Cairo child proves the batch expiry day keys (NEW-E)');
  } finally {
    try {
      fs.unlinkSync(childFile);
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(childDir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }

  // ---- §A: NEW-E in-process pins (dynamic import: the export does
  // not exist on pristine, so a static import would fail the whole
  // spec to load before §0 ever runs) ----
  const helperMod: any = await import('../../src/modules/inventory/helpers/tracked-stock-increase.helper');
  const expiryIso = helperMod.expiryIso as ((v: unknown) => string) | undefined;
  assert.ok(typeof expiryIso === 'function', 'expiryIso must exist (clock B5-P2)');
  assert.equal(expiryIso(new Date(2026, 10, 14)), '2026-11-14');
  assert.equal(expiryIso(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(expiryIso('2026-11-14'), '2026-11-14');
  assert.equal(expiryIso('2026-11'), '2026-11');
  assert.equal(expiryIso(''), '');
  assert.equal(expiryIso(null), '');
  assert.equal(expiryIso(new Date(Number.NaN)), '');
  console.log('✓ §A passed: expiryIso keys pg DATEs from local parts, strings pass through');

  // ---- §B/§C: NEW-C, driven through the REAL
  // getDriverTodayItinerary on PGlite ----
  // The DB day is pinned to UTC (SET TIME ZONE in driveItinerary).
  // A visit 90 minutes before UTC midnight belongs to the tenant
  // day that started the previous UTC evening for an east-of-UTC
  // tenant (Cairo) — the old CURRENT_DATE filter misses it. A visit
  // 60 minutes after UTC midnight belongs to the tenant's yesterday
  // for a west-of-UTC tenant (Midway) — the old filter wrongly
  // includes it. The applicable case is picked at runtime, so at
  // least one case REDs whenever the spec runs (Cairo 00:00-22:00
  // UTC, Midway 11:00-24:00 UTC).
  const now = new Date();
  const utcToday = todayTenantDate('UTC', now);
  const utcMidnight = Date.parse(utcToday + 'T00:00:00Z');
  const missV = new Date(utcMidnight - 90 * 60 * 1000);
  const missApplies = todayTenantDate('Africa/Cairo', missV) === todayTenantDate('Africa/Cairo', now);
  const overV = new Date(utcMidnight + 60 * 60 * 1000);
  const overApplies = todayTenantDate('Pacific/Midway', overV) !== todayTenantDate('Pacific/Midway', now);
  assert.ok(missApplies || overApplies, 'at least one discordant case must apply at any hour');
  let ranCases = 0;

  if (missApplies) {
    // Cairo tenant: the 22:30 UTC visit is 00:30 Cairo today.
    const itinerary = await driveItinerary('t-b5p2-miss', 'Africa/Cairo', [
      { customerId: 1, visitedAt: missV.toISOString() },
    ]);
    const row = (itinerary as any[]).find((c) => c.customerId === 1);
    assert.ok(row, 'the visited customer must be on the itinerary');
    assert.ok(row.todayVisit, 'a visit 00:30 into the tenant day must be today’s visit');
    assert.equal(row.visitStatus, 'positive', 'the early-morning visit counts as today');
    ranCases++;
    console.log('✓ §B passed: Cairo early-morning visit is today (NEW-C miss direction)');
  } else {
    console.log('§B skipped: the Cairo miss case does not apply at this hour (22:00-24:00 UTC)');
  }

  if (overApplies) {
    // Midway tenant: the 01:00 UTC visit is 14:00 Midway yesterday.
    const itinerary = await driveItinerary('t-b5p2-over', 'Pacific/Midway', [
      { customerId: 1, visitedAt: overV.toISOString() },
    ]);
    const row = (itinerary as any[]).find((c) => c.customerId === 1);
    assert.ok(row, 'the visited customer must be on the itinerary');
    assert.equal(row.todayVisit, null, 'a visit from the tenant’s yesterday must NOT be today’s visit');
    assert.equal(row.visitStatus, 'pending', 'yesterday’s visit does not mark today');
    ranCases++;
    console.log('✓ §C passed: Midway yesterday visit is excluded from today (NEW-C over-inclusion direction)');
  } else {
    console.log('§C skipped: the Midway over-inclusion case does not apply at this hour (00:00-11:00 UTC)');
  }
  assert.ok(ranCases >= 1, 'at least one NEW-C case must have run');

  // ---- §D: harness control — a UTC tenant's today is the DB day,
  // so a visit 30 minutes into the UTC day is today on both trees. ----
  {
    const controlV = new Date(utcMidnight + 30 * 60 * 1000);
    const itinerary = await driveItinerary('t-b5p2-control', 'UTC', [
      { customerId: 1, visitedAt: controlV.toISOString() },
    ]);
    const row = (itinerary as any[]).find((c) => c.customerId === 1);
    assert.ok(row, 'the control customer must be on the itinerary');
    assert.ok(row.todayVisit, 'the UTC control visit must be today’s visit');
    assert.equal(row.visitStatus, 'positive');
    console.log('✓ §D passed: UTC-tenant control visit is today (harness proves the service path)');
  }

  // ---- §E: source pins — the fix is wired where the defect was. ----
  {
    const routesSrc = fs.readFileSync(
      resolve(__dirname, '../../src/modules/delivery-reps/services/van-routes.service.ts'),
      'utf8',
    );
    assert.ok(
      routesSrc.includes('DATE(vfv.visited_at AT TIME ZONE ${tenantTimezone})'),
      'today-visits must filter by the tenant day (AT TIME ZONE)',
    );
    assert.ok(
      !routesSrc.includes('visited_at >= CURRENT_DATE'),
      'the DB-day filter must be gone from getDriverTodayItinerary',
    );
    const helperSrc = fs.readFileSync(
      resolve(__dirname, '../../src/modules/inventory/helpers/tracked-stock-increase.helper.ts'),
      'utf8',
    );
    assert.ok(helperSrc.includes('export function expiryIso'), 'expiryIso must be exported');
    assert.ok(helperSrc.includes('formatLocalCalendarDay(value)'), 'expiryIso must key Dates from local parts');
    assert.ok(!helperSrc.includes('toISOString().slice(0, 10)'), 'no UTC slice may remain in the helper');
    console.log('✓ §E passed: source pins for both fixes');
  }

  console.log('CLOCK-B5-P2 CHECKS PASSED');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
