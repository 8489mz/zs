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
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { addDaysToDayKey } from '../../src/common/utils/client-date-bounds.util';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { CashierFraudRadarService } from '../../src/modules/sales/services/cashier-fraud-radar.service';

/*
 * Clock B6-P2 (re-review-3 NEW-G): `created_at >= CURRENT_DATE` on
 * TIMESTAMPTZ instants in four live read paths. CURRENT_DATE is the DB
 * host's UTC day, so a "today" bucket sliced on it starts at 02:00 Cairo
 * instead of midnight — rows created between midnight and 02:00 Cairo
 * fall into the wrong day, and the next tenant day's first hours leak in.
 *
 * THE FOUR SITES:
 * - sales-query.service.ts:62-63 — the sales-list query's
 *   agg_today_sales_count / agg_today_sales_total.
 * - daily-digest.service.ts:148,167,205 — the WhatsApp daily digest:
 *   sales totals, top-3 items, transfers "today". Its header itself used
 *   host-local toLocaleDateString with no timeZone option (:121-126) —
 *   neither the header nor the numbers was the tenant day. The §3
 *   purchase-deadline label (:272) derived from the host clock too
 *   (same method, same root cause — fixed with it).
 * - storefront.service.ts:4935 — getStorefrontAnalytics today_orders /
 *   today_revenue for online orders.
 * - cashier-fraud-radar.service.ts:100 — getTimeFilter('today') returns
 *   'CURRENT_DATE', used as created_at >= CURRENT_DATE at :123,:173,:187
 *   (getSummary) and :342,:378 (getEvents). The 7d/30d branches are
 *   rolling NOW() - INTERVAL windows, not calendar days — unchanged.
 *
 * THE FIX (one pattern, B5-P2's): resolve the tenant zone once per call
 * (getTenantTimezone + todayTenantDate) and compare
 * DATE(<col> AT TIME ZONE <tenantTz>) = <todayKey>.
 *
 * RED DESIGN (this VM is UTC; PGlite's session timezone is Etc/GMT0, so
 * CURRENT_DATE is the UTC day):
 * - §0 is the mechanism proof (Cairo child, B4-P1 pattern): the UTC slice
 *   of a host-local-midnight Date yields the previous day, while
 *   todayTenantDate yields the stored day. It passes on pristine AND
 *   fixed — it proves WHY the slices are wrong.
 * - §A/§B/§C/§D are the RED: source pins plus REAL drives. §D drives the
 *   real getTimeFilter fragment; §F drives the real fetchSaleBaseRows;
 *   §G drives the real getStorefrontAnalytics. On pristine each fails
 *   (pins absent, aggregates wrong); on fixed each passes.
 * - §E is the fragment contrast (mechanism proof, runs on both trees):
 *   OLD (CURRENT_DATE) vs NEW (tenant-day bound) return different row
 *   sets at every hour on three boundary rows (prev / tenant / next day,
 *   00:30 in the tenant zone), and NEW selects exactly the tenant-day row.
 *
 * HONEST LIMITS: the digest is NOT service-driven (generateAndSendDigest
 * needs the WhatsApp gateway plus settings/tenants/sales/sale_items/
 * stock_transfers/stock_transfer_items/products tables — out of
 * proportion to a read-query bound); §B pins its three buckets + header
 * + deadline label, and §E proves the fragment behaviour. A
 * live-Postgres rehearsal on a Cairo host is still owed for the
 * end-to-end paths, as for B4-P1/P2/B5-P1/B6-P1.
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
  const childDir = fs.mkdtempSync(path.join(__dirname, '.tmp-b6p2-'));
  const childTmp = path.join(childDir, 'cairo-check.ts');
  try {
    fs.writeFileSync(
      childTmp,
      `import { todayTenantDate } from '../../../src/common/utils/tenant-timezone.util';
async function main(): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone !== 'Africa/Cairo') { console.error('child zone is ' + zone + ', want Africa/Cairo'); process.exit(2); }
  const day = new Date(2026, 10, 14);
  if (day.toISOString().slice(0, 10) !== '2026-11-13') { console.error('expected the UTC slice to yield 2026-11-13 under Cairo TZ (the bug)'); process.exit(1); }
  if (todayTenantDate('Africa/Cairo', day) !== '2026-11-14') { console.error('todayTenantDate(Cairo) must yield 2026-11-14'); process.exit(1); }
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
      '✓ §0 passed: the UTC slice yields the previous day under Cairo TZ; the tenant-day helpers yield the stored day',
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

  // §A — sales-query: the "today" aggregates key on the tenant day.
  const salesQuery = read('modules/sales/services/sales-query.service.ts');
  const baseRows = fnSlice(salesQuery, 'private async fetchSaleBaseRows(', 6000);
  assert.ok(
    baseRows.includes('DATE(s.created_at AT TIME ZONE ${tenantTz}) = ${todayKey}'),
    'fetchSaleBaseRows must key the today aggregates on DATE(s.created_at AT TIME ZONE tenantTz) = todayKey',
  );
  assert.ok(
    !baseRows.includes('s.created_at >= CURRENT_DATE'),
    'fetchSaleBaseRows must no longer use s.created_at >= CURRENT_DATE',
  );
  assert.ok(baseRows.includes('getTenantTimezone(this.db'), 'fetchSaleBaseRows must resolve the tenant zone');
  console.log('✓ §A passed: sales-list today aggregates key on the tenant day');

  // §B — daily digest: the three "today" buckets, the header, and the
  // purchase-deadline label all key on the tenant day.
  const digest = read('modules/settings/services/daily-digest.service.ts');
  const digestMethod = fnSlice(digest, 'async generateAndSendDigest(', 14000);
  assert.ok(
    digestMethod.includes('DATE(created_at AT TIME ZONE ${tenantTz}) = ${todayKey}'),
    'digest sales totals must key on the tenant day',
  );
  assert.ok(
    digestMethod.includes('DATE(s.created_at AT TIME ZONE ${tenantTz}) = ${todayKey}'),
    'digest top items must key on the tenant day',
  );
  assert.ok(
    digestMethod.includes('DATE(t.created_at AT TIME ZONE ${tenantTz}) = ${todayKey}'),
    'digest transfers must key on the tenant day',
  );
  assert.ok(!digestMethod.includes('>= CURRENT_DATE'), 'digest must no longer use CURRENT_DATE');
  assert.ok(digestMethod.includes('timeZone: tenantTz'), 'digest header must render in the tenant zone');
  assert.ok(
    digestMethod.includes('addDaysToDayKey(todayKey'),
    'digest deadline label must derive from the tenant day key',
  );
  assert.ok(
    !digestMethod.includes('deadlineDate.setDate(deadlineDate.getDate()'),
    'digest deadline label must no longer derive from the host clock',
  );
  console.log('✓ §B passed: digest buckets, header and deadline label key on the tenant day');

  // §C — storefront analytics: today_orders / today_revenue key on the
  // tenant day. getStorefrontAnalytics lives in the T9 slice (storefront split 2026-11-16).
  const storefront = read('modules/storefront/services/storefront-engagement.service.ts');
  const analytics = fnSlice(storefront, 'async getStorefrontAnalytics(', 9000);
  assert.ok(
    analytics.includes('DATE(created_at AT TIME ZONE ${tenantTz}) = ${todayKey}'),
    'getStorefrontAnalytics must key today orders/revenue on DATE(created_at AT TIME ZONE tenantTz) = todayKey',
  );
  assert.ok(
    !analytics.includes('created_at >= CURRENT_DATE'),
    'getStorefrontAnalytics must no longer use CURRENT_DATE',
  );
  console.log('✓ §C passed: storefront today orders/revenue key on the tenant day');

  // ---- shared PGlite fixture for §D–§G (one db; the tenant day is
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
  const prevDay = addDaysToDayKey(tenantDay, -1);
  const nextDay = addDaysToDayKey(tenantDay, 1);
  assert.ok(prevDay && nextDay, 'tenant day - 1 / + 1 must be valid day keys');

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const authFor = (tenantId: string): AuthContext =>
    ({
      tenantId,
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      username: 'admin',
      permissions: [],
    }) as unknown as AuthContext;

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t-b6p2-disc');
      CREATE TABLE settings (tenant_id text, key text, value text);
      INSERT INTO settings VALUES ('t-b6p2-disc','timezone','"${discZone}"');
      CREATE TABLE probe_rows (id int PRIMARY KEY, created_at timestamptz);
      INSERT INTO probe_rows VALUES
        (0, ('${prevDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}'),
        (1, ('${tenantDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}'),
        (2, ('${nextDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}');
    `);

    // §D — fraud radar: drive the REAL getTimeFilter. On pristine it
    // returns the string 'CURRENT_DATE' (the RED); on fixed it returns
    // a SQL fragment that selects exactly the tenant-day rows — both
    // unqualified and aliased (sql.ref must split 'a.created_at').
    const radar = new CashierFraudRadarService(db as any);
    const radarSrc = read('modules/sales/services/cashier-fraud-radar.service.ts');
    const timeFilter = fnSlice(radarSrc, 'private getTimeFilter(', 1500);
    assert.ok(!timeFilter.includes("return 'CURRENT_DATE'"), "getTimeFilter must no longer return 'CURRENT_DATE'");
    assert.ok(
      timeFilter.includes("NOW() - INTERVAL '7 DAYS'"),
      'getTimeFilter 7d branch must stay a rolling NOW() - INTERVAL window',
    );
    assert.ok(
      timeFilter.includes("NOW() - INTERVAL '30 DAYS'"),
      'getTimeFilter 30d branch must stay a rolling NOW() - INTERVAL window',
    );
    const frag = (radar as any).getTimeFilter('today', discZone, tenantDay, 'created_at');
    assert.ok(
      typeof frag !== 'string',
      `getTimeFilter('today') must return a SQL fragment, not the string ${JSON.stringify(frag)} (NEW-G not fixed)`,
    );
    const fragRows = await sql<{ id: number }>`SELECT id FROM probe_rows WHERE ${frag} ORDER BY id`.execute(db);
    assert.deepEqual(
      fragRows.rows.map((r) => r.id),
      [1],
      `getTimeFilter('today') fragment must select exactly the tenant-day row, got ${JSON.stringify(fragRows.rows.map((r) => r.id))}`,
    );
    const fragAliased = (radar as any).getTimeFilter('today', discZone, tenantDay, 'p.created_at');
    const fragAliasedRows = await sql<{
      id: number;
    }>`SELECT p.id FROM probe_rows p WHERE ${fragAliased} ORDER BY p.id`.execute(db);
    assert.deepEqual(
      fragAliasedRows.rows.map((r) => r.id),
      [1],
      `aliased getTimeFilter('today') fragment must select exactly the tenant-day row, got ${JSON.stringify(fragAliasedRows.rows.map((r) => r.id))}`,
    );
    const frag7 = (radar as any).getTimeFilter('7days', discZone, tenantDay, 'created_at');
    assert.ok(typeof frag7 !== 'string', 'getTimeFilter(7days) must return a SQL fragment');
    console.log(
      '✓ §D passed: getTimeFilter returns a tenant-day fragment (unqualified + aliased); 7d/30d stay rolling windows',
    );

    // §E — fragment contrast (mechanism proof, runs on both trees):
    // OLD (CURRENT_DATE) vs NEW (tenant-day bound) on the three boundary
    // rows. NEW selects exactly the tenant-day row; OLD misses it
    // (Midway) or leaks the next day in (Kiritimati).
    const oldRows = await sql<{
      id: number;
    }>`SELECT id FROM probe_rows WHERE created_at >= CURRENT_DATE ORDER BY id`.execute(db);
    const newRows = await sql<{
      id: number;
    }>`SELECT id FROM probe_rows WHERE DATE(created_at AT TIME ZONE ${discZone}) = ${tenantDay} ORDER BY id`.execute(
      db,
    );
    const oldIds = oldRows.rows.map((r) => r.id);
    const newIds = newRows.rows.map((r) => r.id);
    assert.deepEqual(
      newIds,
      [1],
      `NEW (tenant day) must select exactly the tenant-day row, got ${JSON.stringify(newIds)}`,
    );
    const expectedOld = tenantDay > utcDay ? [1, 2] : [2];
    assert.deepEqual(
      oldIds,
      expectedOld,
      `OLD (CURRENT_DATE) must select ${JSON.stringify(expectedOld)} at UTC hour ${utcHour}, got ${JSON.stringify(oldIds)}`,
    );
    assert.notDeepEqual(oldIds, newIds, 'OLD and NEW today-bucket sets must differ');
    console.log('✓ §E passed: OLD (CURRENT_DATE) vs NEW (tenant day) fragment contrast');

    // §F — sales-query, service-driven: the REAL fetchSaleBaseRows.
    // Three sales at 00:30 in the tenant zone on the prev / tenant /
    // next day (totals 50 / 100 / 200). Fixed: count 1, total 100.
    // Pristine: Midway counts the next-day row (count 1, total 200);
    // Kiritimati counts both (count 2, total 300).
    await pg.exec(`
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint,
        customer_name text, customer_phone text, customer_address text, payment_type text,
        payment_channel text, subtotal numeric, discount numeric, tax_rate numeric, tax_amount numeric,
        prices_include_tax boolean, total numeric, paid_amount numeric, tendered_amount numeric,
        change_amount numeric, store_credit_used numeric, delivery_fee numeric, status text,
        note text, table_number text, order_type text, branch_id bigint, location_id bigint,
        created_by bigint, created_at timestamptz, collection_status text, delivery_status text,
        delivery_fee_mode text, delivery_rep_id bigint);
      INSERT INTO sales (id, tenant_id, doc_no, total, status, payment_type, payment_channel, created_at) VALUES
        (1, 't-b6p2-disc', 'S-1', 50, 'posted', 'cash', 'cash', ('${prevDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}'),
        (2, 't-b6p2-disc', 'S-2', 100, 'posted', 'cash', 'cash', ('${tenantDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}'),
        (3, 't-b6p2-disc', 'S-3', 200, 'posted', 'cash', 'cash', ('${nextDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}');
    `);
    const salesQuery = new (SalesQueryService as any)(db, {});
    const base = await (salesQuery as any).fetchSaleBaseRows(authFor('t-b6p2-disc'), {});
    assert.ok(base.rows.length === 3, `fetchSaleBaseRows must return all 3 sales rows, got ${base.rows.length}`);
    const firstRow = base.rows[0] as Record<string, unknown>;
    assert.equal(
      Number(firstRow.agg_today_sales_count),
      1,
      `agg_today_sales_count must be 1 (the tenant-day sale only), got ${firstRow.agg_today_sales_count}`,
    );
    assert.equal(
      Number(firstRow.agg_today_sales_total),
      100,
      `agg_today_sales_total must be 100 (the tenant-day sale only), got ${firstRow.agg_today_sales_total}`,
    );
    console.log('✓ §F passed: fetchSaleBaseRows today aggregates count the tenant-day sale only');

    // §G — storefront analytics, service-driven: the REAL
    // getStorefrontAnalytics. Three online orders at 00:30 in the tenant
    // zone on the prev / tenant / next day (totals 50 / 100 / 200).
    // Fixed: todayOrders 1, todayRevenue 100. Pristine: Midway reports
    // 1 / 200; Kiritimati reports 2 / 300.
    await pg.exec(`
      CREATE TABLE online_orders (id bigint PRIMARY KEY, tenant_id text, status text, total_amount numeric, created_at timestamptz, items_json text);
      CREATE TABLE storefront_abandoned_carts (id bigint PRIMARY KEY, tenant_id text, recovered boolean);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, stock_qty numeric, retail_price numeric, is_active boolean, item_type text);
      INSERT INTO online_orders (id, tenant_id, status, total_amount, created_at, items_json) VALUES
        (1, 't-b6p2-disc', 'confirmed', 50, ('${prevDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}', NULL),
        (2, 't-b6p2-disc', 'confirmed', 100, ('${tenantDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}', NULL),
        (3, 't-b6p2-disc', 'confirmed', 200, ('${nextDay}'::date + TIME '00:30') AT TIME ZONE '${discZone}', NULL);
    `);
    const storefrontSvc = new (StorefrontService as any)(db);
    const analytics = await (storefrontSvc as any).getStorefrontAnalytics(authFor('t-b6p2-disc'));
    assert.equal(
      Number(analytics.todayOrders),
      1,
      `todayOrders must be 1 (the tenant-day order only), got ${analytics.todayOrders}`,
    );
    assert.equal(
      Number(analytics.todayRevenue),
      100,
      `todayRevenue must be 100 (the tenant-day order only), got ${analytics.todayRevenue}`,
    );
    console.log('✓ §G passed: getStorefrontAnalytics today orders/revenue count the tenant-day order only');

    console.log('CLOCK-B6-P2 CHECKS PASSED');
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
