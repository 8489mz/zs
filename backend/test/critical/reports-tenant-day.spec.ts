/*
 * P1 (INV-SINGLE-SERVER-CLOCK-TENANT-TZ): reports run on the tenant day, not UTC.
 *
 * Defect: ReportsService resolved the business timezone from the env-only
 * module-global resolver (BUSINESS_TIMEZONE, schema default 'UTC') and never
 * read the tenant's settings.timezone. A tenant set to Asia/Kuwait still got
 * UTC report days; with the env unset, EVERY tenant's reports ran on UTC
 * while postings ran on Cairo.
 *
 * Proof (fixed instants, so they fail on unfixed code at any hour):
 * - the same sale instant (2026-04-08T21:30:00Z = 23:30 Cairo 04-08 =
 *   00:30 Kuwait 04-09) lands in the 2026-04-09 series bucket for the
 *   Kuwait tenant and in the 2026-04-08 bucket for the Cairo tenant,
 *   through the REAL ReportsService.reportSummary against PGlite.
 * - getTenantTimezone resolves per tenant from the real settings table
 *   (Kuwait / Cairo / no-setting fallback).
 * - the pure day helpers derive different days from the same instant
 *   under the two resolved zones.
 *
 * The RED control is the service-level bucket assertion: on unfixed code
 * the service uses the UTC resolver, so the Kuwait sale buckets to
 * 2026-04-08 and the assertion fails. The resolution/helper assertions
 * are green-before (they are the already-correct mechanism the service
 * now calls); the bug was the service never calling it.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { getTenantTimezone } from '../../src/common/utils/tenant-timezone.util';
import { dateKey, getBusinessDayBounds } from '../../src/modules/reports/helpers/reports-range.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const KUWAIT = 'tenant-kuwait';
const CAIRO = 'tenant-cairo';
const NONE = 'tenant-none';
const ACCOUNT = 'account-a';

// 2026-04-08T21:30:00Z: 23:30 in Cairo (still 04-08), 00:30 in Kuwait (already 04-09).
const BOUNDARY_INSTANT = '2026-04-08T21:30:00.000Z';

function authFor(tenantId: string): AuthContext {
  return {
    userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
    permissions: [], tenantId, accountId: ACCOUNT,
  } as unknown as AuthContext;
}

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, total numeric, tax_amount numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, delivery_rep_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, status text);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, status text);
    CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, account_id text, amount numeric, branch_id bigint, location_id bigint, created_by bigint, service_date timestamptz, is_active boolean DEFAULT true);
    CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, account_id text, amount numeric, branch_id bigint, location_id bigint, created_by bigint, expense_date timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, total_cost numeric, movement_type text, reason text, created_at timestamptz);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, account_id text, return_type text, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz);
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, sale_item_id bigint, product_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, amount numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, product_name text, qty numeric, line_total numeric, cost_price numeric, unit_multiplier numeric DEFAULT 1);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, cost_price numeric);
  `);
  return { pg, db };
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    const anyDb = db as any;
    // Settings values are JSON-encoded in production; the resolver parses both forms.
    await anyDb.insertInto('settings').values([
      { tenant_id: KUWAIT, key: 'timezone', value: '"Asia/Kuwait"' },
      { tenant_id: CAIRO, key: 'timezone', value: '"Africa/Cairo"' },
    ]).execute();
    // One posted sale per tenant at the same boundary instant.
    await anyDb.insertInto('sales').values([
      { id: 1, tenant_id: KUWAIT, account_id: ACCOUNT, total: 100, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: BOUNDARY_INSTANT, status: 'posted' },
      { id: 2, tenant_id: CAIRO, account_id: ACCOUNT, total: 100, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: BOUNDARY_INSTANT, status: 'posted' },
      { id: 3, tenant_id: NONE, account_id: ACCOUNT, total: 100, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-08T22:30:00.000Z', status: 'posted' },
    ]).execute();

    // 1. Resolution: the tenant setting is honoured per tenant.
    assert.equal(await getTenantTimezone(db, KUWAIT), 'Asia/Kuwait');
    assert.equal(await getTenantTimezone(db, CAIRO), 'Africa/Cairo');
    assert.equal(await getTenantTimezone(db, NONE), process.env.BUSINESS_TIMEZONE || 'Africa/Cairo');

    // 2. Pure day helpers: the same instant is a different report day per zone.
    const instant = new Date(BOUNDARY_INSTANT);
    assert.equal(dateKey(instant, 'Asia/Kuwait'), '2026-04-09');
    assert.equal(dateKey(instant, 'Africa/Cairo'), '2026-04-08');
    assert.equal(getBusinessDayBounds(instant, 'Asia/Kuwait').key, '2026-04-09');
    assert.equal(getBusinessDayBounds(instant, 'Africa/Cairo').key, '2026-04-08');

    // 3. The real reports path: reportSummary buckets the boundary sale on
    // the tenant day, not the UTC day.
    const service = new ReportsService(db);
    const query = { from: '2026-04-08T00:00:00.000Z', to: '2026-04-09T23:59:59.999Z' };
    const kuwait = await service.reportSummary(query as never, authFor(KUWAIT)) as any;
    const kuwaitPoints = (kuwait.salesPurchasesSeries?.points || []) as Array<{ date: string; sales: number }>;
    assert.equal(kuwaitPoints.find((p) => p.date === '2026-04-09')?.sales, 100);
    assert.equal(kuwaitPoints.find((p) => p.date === '2026-04-08')?.sales, 0);

    const cairo = await service.reportSummary(query as never, authFor(CAIRO)) as any;
    const cairoPoints = (cairo.salesPurchasesSeries?.points || []) as Array<{ date: string; sales: number }>;
    assert.equal(cairoPoints.find((p) => p.date === '2026-04-08')?.sales, 100);
    assert.equal(cairoPoints.find((p) => p.date === '2026-04-09')?.sales, 0);

    // 4. A tenant with no setting still gets the canonical fallback day
    // (env, else Cairo) — never UTC. The no-setting sale sits at
    // 2026-04-08T22:30:00Z (00:30 Cairo 04-09, 04-08 in UTC), so the
    // fallback bucket differs from the UTC bucket whenever the fallback
    // zone is not UTC itself. The expected bucket is computed from the
    // same fallback the resolver uses, so it holds whatever the env is.
    const fallbackTz = process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
    const fallbackInstant = new Date('2026-04-08T22:30:00.000Z');
    const none = await service.reportSummary(query as never, authFor(NONE)) as any;
    const nonePoints = (none.salesPurchasesSeries?.points || []) as Array<{ date: string; sales: number }>;
    const fallbackDay = dateKey(fallbackInstant, fallbackTz);
    assert.equal(nonePoints.find((p) => p.date === fallbackDay)?.sales, 100);
    if (fallbackTz !== 'UTC') {
      assert.notEqual(fallbackDay, dateKey(fallbackInstant, 'UTC'));
    }
  } finally {
    await db.destroy();
  }
  console.log('reports-tenant-day.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
