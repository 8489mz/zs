/*
 * INV-RETURNS-SERVICES-USERS-SQL-PAGINATION: `listReturns`,
 * `listServices` and `listUsers` must fetch only the requested page
 * from the database — never load the whole tenant set and slice one
 * page out of it in memory.
 *
 * THE BUG: all three methods ran unbounded SELECTs, mapped the full
 * set in memory, then sliced one page with the former in-memory
 * slicer (defaultSize 20 / 10) — maxSize defaults to 100, so a client
 * asking pageSize=150 silently received 100 rows.
 *
 * RULES PINNED HERE, driving the REAL ReturnsReadsService,
 * ServicesService and UsersService on PGlite:
 * 1. The page-size cap is 200: pageSize=150 returns 150 rows (the old
 *    code returned 100), pageSize=1000 returns 200 rows. All three.
 * 2. Only the requested page is returned, the old ORDER BY preserved
 *    (returns: rd.id DESC, ri.id ASC; services: id DESC; users: id ASC).
 * 3. Defaults preserved: returns 20, services 20, users 10.
 * 4. A page past the end clamps to the last page (page 99 -> last).
 * 5. RETURNS — the page's docs are fetched with the same join as the
 *    old code and mapped with the SAME mapReturnRows (docNo fallback
 *    always 'ZR-' + id; returnType 'purchase' iff return_type =
 *    'purchase'; invoiceDocNo fallback 'PO-'+id / 'Z-'+id; partyName
 *    fallback 'عميل نقدي' / 'مورد'; refundTotal = roundMoney(total +
 *    tipRelief + courierRelief, 3); single-item doc shows that item's
 *    productName, else 'N أصناف'). The filter is NOT lowercased
 *    ('sales'/'purchase'/'today' exact); q is trim().toLowerCase()
 *    over docNo/productName/note/returnType/createdByName — the
 *    productName searched is the DERIVED one ('2 أصناف' for a
 *    multi-item doc, never the item names). The summary stays exact
 *    over the FULL filtered set (totalAmount = roundMoney(SUM of the
 *    per-doc refundTotals, moneyDigits); todayCount uses the
 *    tenant-timezone calendar date; latestDocNo is the first row's
 *    docNo, i.e. the highest filtered id).
 * 6. SERVICES — the filter is lowercased ('today' = the tenant-local
 *    day of service_date; 'high' = amount >= 100; 'notes' = notes
 *    trim().length > 0 — a spaces-only note does NOT count). The
 *    search is trim().toLowerCase() over name/notes/createdByName/
 *    branchName/locationName. The payment channel normalizes in SQL
 *    (trim() === 'card' ? 'card' : 'cash' — 'CARD' is cash, ' card '
 *    is card, NULL is cash). The summary stays exact over the FULL
 *    filtered set (totals are roundMoney(SQL SUMs, moneyDigits) with
 *    the JS rounding on the SQL sums; averageAmount keeps the division
 *    in JS; todayCount counts filtered rows that are today;
 *    highestAmount is MAX(amount), 0 when empty; latest is the first
 *    row of the FULL filtered set).
 * 7. USERS — the summary is over ALL tenant users (UNFILTERED):
 *    total/active/inactive/superAdmins/admins/cashiers/locked (failed
 *    >= 5 OR locked_until > now)/activePrivilegedUsers, and the
 *    activeCount feeds the plan limit. pagination.total is the
 *    FILTERED count. The role filter is EXACT (case-sensitive);
 *    includeInactive defaults true; the search is trim().toLowerCase()
 *    over username/name/phone. Sanitization for non-managers stays in
 *    JS on the page rows (permissions [], mustChangePassword false,
 *    failedLoginCount 0, lockedUntil/lastLoginAt null). The branch map
 *    is fetched only for the page ids.
 * 8. USERS — the five internal callers (create/update/bulk/delete/
 *    unlock) need the FULL list for the frontend refresh, so they page
 *    through listUsers (50-page safety bound) instead of silently
 *    shrinking to 200: unlocking one user out of 250 returns all 250.
 *
 * Prospective only; PGlite only.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ReturnsReadsService } from '../../src/modules/returns/returns-reads.service';
import { ServicesService } from '../../src/modules/services/services.service';
import { UsersService } from '../../src/modules/users/users.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../src/core/auth/utils/tenant-boundary';

const ADMIN = {
  userId: 1,
  sessionId: 'sess-spec',
  username: 'admin-1',
  role: 'admin',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;
const CASHIER = {
  userId: 2,
  sessionId: 'sess-spec',
  username: 'cashier-1',
  role: 'cashier',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

type Page = { page: number; pageSize: number; totalItems: number; totalPages: number };

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TABLE settings (id int PRIMARY KEY, tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id int PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE tenants (id text PRIMARY KEY, plan_id text, status text);
    CREATE TABLE tenant_subscriptions (id int PRIMARY KEY, tenant_id text, plan_id int, status text, created_at timestamptz);
    CREATE TABLE saas_plans (id int PRIMARY KEY, max_users int, code text, name text, feature_plan_id text, is_active boolean);
    CREATE TABLE users (id int PRIMARY KEY, tenant_id text, username text, display_name text, phone text, role text, permissions_json text, default_branch_id int, is_active boolean, must_change_password boolean, failed_login_count int, locked_until timestamptz, last_login_at timestamptz);
    CREATE TABLE user_branches (user_id int, branch_id int, tenant_id text);
    CREATE TABLE branches (id int PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_locations (id int PRIMARY KEY, tenant_id text, name text, branch_id int);
    CREATE TABLE return_documents (id int PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id int, note text, settlement_mode text, refund_method text, refund_allocations text, tip_relief numeric, courier_relief numeric, created_at timestamptz, created_by int, branch_id int, location_id int);
    CREATE TABLE return_items (id int PRIMARY KEY, tenant_id text, return_document_id int, product_id int, product_name text, qty numeric, line_total numeric);
    CREATE TABLE sales (id int PRIMARY KEY, tenant_id text, doc_no text, customer_id int, order_type text);
    CREATE TABLE customers (id int PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE purchases (id int PRIMARY KEY, tenant_id text, doc_no text, supplier_id int);
    CREATE TABLE suppliers (id int PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE services (id int PRIMARY KEY, tenant_id text, name text, amount numeric, notes text, service_date timestamptz, payment_channel text, branch_id int, location_id int, created_by int);
  `);

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  const nowIso = now.toISOString();
  const twoDaysAgoIso = twoDaysAgo.toISOString();
  const tomorrowIso = tomorrow.toISOString();

  await db
    .insertInto('settings')
    .values([
      { id: 1, tenant_id: 't1', key: 'timezone', value: 'Africa/Cairo' },
      { id: 2, tenant_id: 't1', key: 'currency', value: 'EGP' },
    ] as never)
    .execute();
  await db
    .insertInto('tenants')
    .values([{ id: 't1', plan_id: null, status: 'active' }] as never)
    .execute();
  await db
    .insertInto('branches')
    .values([
      { id: 1, tenant_id: 't1', name: 'Branch One' },
      { id: 2, tenant_id: 't1', name: 'Branch Two' },
    ] as never)
    .execute();
  await db
    .insertInto('stock_locations')
    .values([
      { id: 1, tenant_id: 't1', name: 'Loc One', branch_id: 1 },
      { id: 2, tenant_id: 't1', name: 'Loc Two', branch_id: 2 },
    ] as never)
    .execute();
  await db
    .insertInto('sales')
    .values([{ id: 1, tenant_id: 't1', doc_no: 'Z-100', customer_id: 1, order_type: '' }] as never)
    .execute();
  await db
    .insertInto('customers')
    .values([{ id: 1, tenant_id: 't1', name: 'Ahmed' }] as never)
    .execute();
  await db
    .insertInto('purchases')
    .values([{ id: 1, tenant_id: 't1', doc_no: 'PO-500', supplier_id: 1 }] as never)
    .execute();
  await db
    .insertInto('suppliers')
    .values([{ id: 1, tenant_id: 't1', name: 'Supplier X' }] as never)
    .execute();

  // ---- users: 250 (ids 1-6 named, 7-250 filler cashiers) ----
  const userRows: Array<Record<string, unknown>> = [
    {
      id: 1,
      tenant_id: 't1',
      username: 'admin-1',
      display_name: 'Admin One',
      phone: '01000000001',
      role: 'admin',
      permissions_json: '["*"]',
      default_branch_id: null,
      is_active: true,
      must_change_password: false,
      failed_login_count: 0,
      locked_until: null,
      last_login_at: null,
    },
    {
      id: 2,
      tenant_id: 't1',
      username: 'cashier-1',
      display_name: 'Cashier One',
      phone: '01000000002',
      role: 'cashier',
      permissions_json: '[]',
      default_branch_id: 1,
      is_active: true,
      must_change_password: false,
      failed_login_count: 0,
      locked_until: null,
      last_login_at: null,
    },
    {
      id: 3,
      tenant_id: 't1',
      username: 'cashier-2',
      display_name: 'Cashier Two',
      phone: '01000000003',
      role: 'cashier',
      permissions_json: '[]',
      default_branch_id: null,
      is_active: false,
      must_change_password: true,
      failed_login_count: 0,
      locked_until: null,
      last_login_at: null,
    },
    {
      id: 4,
      tenant_id: 't1',
      username: 'super-1',
      display_name: 'Super One',
      phone: '01000000004',
      role: 'super_admin',
      permissions_json: '["*"]',
      default_branch_id: null,
      is_active: true,
      must_change_password: false,
      failed_login_count: 6,
      locked_until: null,
      last_login_at: null,
    },
    {
      id: 5,
      tenant_id: 't1',
      username: 'admin-2',
      display_name: 'Admin Two',
      phone: '01000000005',
      role: 'admin',
      permissions_json: '[]',
      default_branch_id: null,
      is_active: true,
      must_change_password: false,
      failed_login_count: 0,
      locked_until: tomorrowIso,
      last_login_at: null,
    },
    {
      id: 6,
      tenant_id: 't1',
      username: 'cashier-3',
      display_name: 'Cashier Three',
      phone: '01000000006',
      role: 'cashier',
      permissions_json: '[]',
      default_branch_id: null,
      is_active: true,
      must_change_password: false,
      failed_login_count: 0,
      locked_until: twoDaysAgoIso,
      last_login_at: null,
    },
  ];
  for (let id = 7; id <= 250; id++) {
    userRows.push({
      id,
      tenant_id: 't1',
      username: `user-${id}`,
      display_name: `User ${id}`,
      phone: `0100000${String(id).padStart(3, '0')}`,
      role: 'cashier',
      permissions_json: '[]',
      default_branch_id: null,
      is_active: true,
      must_change_password: false,
      failed_login_count: 0,
      locked_until: null,
      last_login_at: null,
    });
  }
  await db
    .insertInto('users')
    .values(userRows as never)
    .execute();
  await db
    .insertInto('user_branches')
    .values([
      { user_id: 2, branch_id: 1, tenant_id: 't1' },
      { user_id: 2, branch_id: 2, tenant_id: 't1' },
    ] as never)
    .execute();

  // ---- returns: named docs 1-5 + filler 100-299 (200) = 205 docs ----
  type ReturnDoc = {
    id: number;
    docNo: string | null;
    type: string;
    invoiceId: number | null;
    note: string;
    tip: number;
    courier: number;
    createdBy: number;
    createdAt: string;
    items: Array<{ id: number; product: string; qty: number; total: number }>;
  };
  const namedDocs: ReturnDoc[] = [
    {
      id: 1,
      docNo: 'ZR-001',
      type: 'sale',
      invoiceId: 1,
      note: 'first return',
      tip: 1,
      courier: 0.5,
      createdBy: 1,
      createdAt: nowIso,
      items: [
        { id: 1, product: 'Widget A', qty: 2, total: 10 },
        { id: 2, product: 'Widget B', qty: 1, total: 5 },
      ],
    },
    {
      id: 2,
      docNo: 'ZR-002',
      type: 'sale',
      invoiceId: null,
      note: '',
      tip: 0,
      courier: 0,
      createdBy: 2,
      createdAt: twoDaysAgoIso,
      items: [{ id: 3, product: 'Gadget', qty: 1, total: 7.25 }],
    },
    {
      id: 3,
      docNo: null,
      type: 'purchase',
      invoiceId: 1,
      note: 'damaged goods',
      tip: 0,
      courier: 2,
      createdBy: 1,
      createdAt: nowIso,
      items: [{ id: 4, product: 'Part', qty: 3, total: 9 }],
    },
    {
      id: 4,
      docNo: 'ZR-004',
      type: 'purchase',
      invoiceId: null,
      note: '',
      tip: 0,
      courier: 0,
      createdBy: 2,
      createdAt: twoDaysAgoIso,
      items: [{ id: 5, product: 'Bolt', qty: 1, total: 3.5 }],
    },
    {
      id: 5,
      docNo: 'ZR-005',
      type: 'sale',
      invoiceId: 1,
      note: 'UPPER Note',
      tip: 0,
      courier: 0,
      createdBy: 1,
      createdAt: nowIso,
      items: [{ id: 6, product: 'Widget A', qty: 1, total: 4 }],
    },
  ];
  const docRows: Array<Record<string, unknown>> = [];
  const returnItemRows: Array<Record<string, unknown>> = [];
  let returnItemId = 1000;
  for (const d of namedDocs) {
    docRows.push({
      id: d.id,
      tenant_id: 't1',
      doc_no: d.docNo,
      return_type: d.type,
      invoice_id: d.invoiceId,
      note: d.note,
      settlement_mode: 'refund',
      refund_method: '',
      refund_allocations: null,
      tip_relief: d.tip,
      courier_relief: d.courier,
      created_at: d.createdAt,
      created_by: d.createdBy,
      branch_id: null,
      location_id: null,
    });
    for (const it of d.items) {
      returnItemRows.push({
        id: it.id,
        tenant_id: 't1',
        return_document_id: d.id,
        product_id: 1,
        product_name: it.product,
        qty: it.qty,
        line_total: it.total,
      });
    }
  }
  for (let id = 100; id <= 299; id++) {
    docRows.push({
      id,
      tenant_id: 't1',
      doc_no: `ZR-${id}`,
      return_type: 'sale',
      invoice_id: null,
      note: '',
      settlement_mode: 'refund',
      refund_method: '',
      refund_allocations: null,
      tip_relief: 0,
      courier_relief: 0,
      created_at: twoDaysAgoIso,
      created_by: 1,
      branch_id: null,
      location_id: null,
    });
    returnItemRows.push({
      id: returnItemId++,
      tenant_id: 't1',
      return_document_id: id,
      product_id: 1,
      product_name: 'Filler',
      qty: 1,
      line_total: 1,
    });
  }
  await db
    .insertInto('return_documents')
    .values(docRows as never)
    .execute();
  await db
    .insertInto('return_items')
    .values(returnItemRows as never)
    .execute();

  // ---- services: named 1-5 + filler 100-299 (200) = 205 ----
  type ServiceSeed = {
    id: number;
    name: string;
    amount: number;
    notes: string;
    date: string;
    channel: string | null;
    branch: number;
    loc: number;
    createdBy: number;
  };
  const namedServices: ServiceSeed[] = [
    {
      id: 1,
      name: 'Delivery',
      amount: 150,
      notes: 'fast delivery',
      date: nowIso,
      channel: 'card',
      branch: 1,
      loc: 1,
      createdBy: 1,
    },
    {
      id: 2,
      name: 'Installation',
      amount: 50,
      notes: '',
      date: twoDaysAgoIso,
      channel: 'cash',
      branch: 1,
      loc: 1,
      createdBy: 2,
    },
    {
      id: 3,
      name: 'Repair',
      amount: 99.99,
      notes: '  ',
      date: nowIso,
      channel: 'CARD',
      branch: 2,
      loc: 2,
      createdBy: 1,
    },
    {
      id: 4,
      name: 'Consulting',
      amount: 250.5,
      notes: 'advice',
      date: twoDaysAgoIso,
      channel: ' card ',
      branch: 1,
      loc: 1,
      createdBy: 2,
    },
    {
      id: 5,
      name: 'Cleaning',
      amount: 100,
      notes: 'deep clean',
      date: nowIso,
      channel: null,
      branch: 1,
      loc: 1,
      createdBy: 1,
    },
  ];
  const serviceRows: Array<Record<string, unknown>> = [];
  for (const s of namedServices) {
    serviceRows.push({
      id: s.id,
      tenant_id: 't1',
      name: s.name,
      amount: s.amount,
      notes: s.notes,
      service_date: s.date,
      payment_channel: s.channel,
      branch_id: s.branch,
      location_id: s.loc,
      created_by: s.createdBy,
    });
  }
  for (let id = 100; id <= 299; id++) {
    serviceRows.push({
      id,
      tenant_id: 't1',
      name: `Service-${id}`,
      amount: 10,
      notes: '',
      service_date: twoDaysAgoIso,
      payment_channel: 'cash',
      branch_id: 1,
      location_id: 1,
      created_by: 1,
    });
  }
  await db
    .insertInto('services')
    .values(serviceRows as never)
    .execute();

  const returnsService = new ReturnsReadsService({
    db,
    tenantPredicate: (auth: AuthContext, alias?: string) => {
      const tenantId = requireTenantScope(auth).tenantId;
      return alias
        ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}`
        : sql<boolean>`tenant_id = ${tenantId}`;
    },
    scope: (auth: AuthContext) => requireTenantScope(auth),
  });
  const servicesService = new ServicesService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    {} as never,
  );
  const usersService = new UsersService(db, new TransactionHelper(), { log: async () => {} } as never);

  // ---------- returns (admin) ----------
  const rDefault = (await returnsService.listReturns({ page: 1 }, ADMIN)) as {
    returns: Array<{ id: string; docNo: string }>;
    pagination: Page;
    summary: {
      totalItems: number;
      totalAmount: number;
      salesReturns: number;
      purchaseReturns: number;
      todayCount: number;
      latestDocNo: string;
    };
  };
  assert.equal(rDefault.returns.length, 20, 'returns default page is 20 rows');
  assert.deepEqual(rDefault.pagination, { page: 1, pageSize: 20, totalItems: 205, totalPages: 11 });
  assert.equal(rDefault.returns[0].id, '299', 'returns ordered rd.id DESC');
  assert.deepEqual(rDefault.summary, {
    totalItems: 205,
    totalAmount: 242.25,
    salesReturns: 203,
    purchaseReturns: 2,
    todayCount: 3,
    latestDocNo: 'ZR-299',
  });

  const rCap150 = (await returnsService.listReturns({ page: 1, pageSize: 150 }, ADMIN)) as { returns: unknown[] };
  assert.equal(rCap150.returns.length, 150, 'returns pageSize=150 returns 150 rows (old code: 100)');
  const rCap1000 = (await returnsService.listReturns({ page: 1, pageSize: 1000 }, ADMIN)) as {
    returns: unknown[];
    pagination: Page;
  };
  assert.equal(rCap1000.returns.length, 200, 'returns pageSize=1000 caps at 200');
  assert.equal(rCap1000.pagination.pageSize, 200);

  const rPage2 = (await returnsService.listReturns({ page: 2 }, ADMIN)) as {
    returns: Array<{ id: string }>;
    summary: { totalAmount: number };
  };
  assert.equal(rPage2.returns[0].id, '279');
  assert.equal(rPage2.summary.totalAmount, 242.25, 'returns summary stays exact over the full set on page 2');
  const rClamp = (await returnsService.listReturns({ page: 99 }, ADMIN)) as {
    returns: Array<{ id: string }>;
    pagination: Page;
  };
  assert.equal(rClamp.pagination.page, 11, 'returns page 99 clamps to last page 11');
  assert.deepEqual(
    rClamp.returns.map((r) => r.id),
    ['5', '4', '3', '2', '1'],
  );

  // NULL tip/courier relief (the common real-world row) must still total
  // the line amount — SQL NULL arithmetic would otherwise zero the doc.
  await db
    .insertInto('return_documents')
    .values([
      {
        id: 300,
        tenant_id: 't1',
        doc_no: null,
        return_type: 'sale',
        invoice_id: null,
        note: '',
        settlement_mode: 'refund',
        refund_method: '',
        refund_allocations: null,
        tip_relief: null,
        courier_relief: null,
        created_at: nowIso,
        created_by: 1,
        branch_id: null,
        location_id: null,
      },
    ] as never)
    .execute();
  await db
    .insertInto('return_items')
    .values([
      {
        id: 2000,
        tenant_id: 't1',
        return_document_id: 300,
        product_id: 1,
        product_name: 'NullRelief',
        qty: 1,
        line_total: 7.5,
      },
    ] as never)
    .execute();
  const rNullRelief = (await returnsService.listReturns({ page: 1 }, ADMIN)) as {
    returns: Array<{ id: string }>;
    summary: {
      totalItems: number;
      totalAmount: number;
      salesReturns: number;
      purchaseReturns: number;
      todayCount: number;
      latestDocNo: string;
    };
  };
  assert.equal(rNullRelief.returns[0].id, '300');
  assert.deepEqual(rNullRelief.summary, {
    totalItems: 206,
    totalAmount: 249.75,
    salesReturns: 204,
    purchaseReturns: 2,
    todayCount: 4,
    latestDocNo: 'ZR-300',
  });

  const rFilterSales = (await returnsService.listReturns({ filter: 'sales' }, ADMIN)) as { pagination: Page };
  assert.equal(rFilterSales.pagination.totalItems, 204);
  const rFilterPurchase = (await returnsService.listReturns({ filter: 'purchase' }, ADMIN)) as {
    pagination: Page;
    summary: { totalAmount: number };
  };
  assert.equal(rFilterPurchase.pagination.totalItems, 2);
  assert.equal(rFilterPurchase.summary.totalAmount, 14.5);
  const rFilterToday = (await returnsService.listReturns({ filter: 'today' }, ADMIN)) as { pagination: Page };
  assert.equal(rFilterToday.pagination.totalItems, 4);

  const rSearchWidget = (await returnsService.listReturns({ search: 'widget' }, ADMIN)) as {
    returns: Array<{ id: string }>;
  };
  assert.deepEqual(
    rSearchWidget.returns.map((r) => r.id),
    ['5'],
    'returns search uses the DERIVED productName (multi-item doc is "2 أصناف")',
  );
  const rSearchFallback = (await returnsService.listReturns({ search: 'ZR-3' }, ADMIN)) as {
    returns: Array<{ id: string }>;
  };
  assert.deepEqual(
    rSearchFallback.returns.map((r) => r.id),
    ['300', '3'],
    'returns search matches the ZR- fallback docNo',
  );
  const rSearchUpper = (await returnsService.listReturns({ search: 'upper' }, ADMIN)) as {
    returns: Array<{ id: string }>;
  };
  assert.deepEqual(
    rSearchUpper.returns.map((r) => r.id),
    ['5'],
  );
  const rSearchType = (await returnsService.listReturns({ search: 'sale' }, ADMIN)) as { pagination: Page };
  assert.equal(rSearchType.pagination.totalItems, 204, 'returns search matches the returnType field');
  const rEmployee = (await returnsService.listReturns({ employee: 'cashier-1' }, ADMIN)) as { pagination: Page };
  assert.equal(rEmployee.pagination.totalItems, 2, 'returns employee filter matches createdByName');

  // ---------- services (admin) ----------
  const sDefault = (await servicesService.listServices({ page: 1 }, ADMIN)) as {
    services: Array<{ id: string; name: string }>;
    pagination: Page;
    summary: {
      totalItems: number;
      totalAmount: number;
      cashAmount: number;
      cardAmount: number;
      todayCount: number;
      averageAmount: number;
      highestAmount: number;
      latestServiceName: string;
      latestCreatedByName: string;
    };
  };
  assert.equal(sDefault.services.length, 20, 'services default page is 20 rows');
  assert.deepEqual(sDefault.pagination, { page: 1, pageSize: 20, totalItems: 205, totalPages: 11 });
  assert.equal(sDefault.services[0].id, '299', 'services ordered id DESC');
  assert.deepEqual(sDefault.summary, {
    totalItems: 205,
    totalAmount: 2650.49,
    cashAmount: 2249.99,
    cardAmount: 400.5,
    todayCount: 3,
    averageAmount: 12.93,
    highestAmount: 250.5,
    latestServiceName: 'Service-299',
    latestCreatedByName: 'admin-1',
  });

  const sCap150 = (await servicesService.listServices({ page: 1, pageSize: 150 }, ADMIN)) as { services: unknown[] };
  assert.equal(sCap150.services.length, 150, 'services pageSize=150 returns 150 rows (old code: 100)');
  const sCap1000 = (await servicesService.listServices({ page: 1, pageSize: 1000 }, ADMIN)) as {
    services: unknown[];
    pagination: Page;
  };
  assert.equal(sCap1000.services.length, 200, 'services pageSize=1000 caps at 200');
  assert.equal(sCap1000.pagination.pageSize, 200);

  const sPage2 = (await servicesService.listServices({ page: 2 }, ADMIN)) as {
    summary: { totalAmount: number; cashAmount: number };
  };
  assert.equal(sPage2.summary.totalAmount, 2650.49, 'services summary stays exact over the full set on page 2');
  assert.equal(sPage2.summary.cashAmount, 2249.99);
  const sClamp = (await servicesService.listServices({ page: 99 }, ADMIN)) as {
    services: Array<{ id: string }>;
    pagination: Page;
  };
  assert.equal(sClamp.pagination.page, 11, 'services page 99 clamps to last page 11');
  assert.deepEqual(
    sClamp.services.map((r) => r.id),
    ['5', '4', '3', '2', '1'],
  );

  const sFilterToday = (await servicesService.listServices({ filter: 'today' }, ADMIN)) as { pagination: Page };
  assert.equal(sFilterToday.pagination.totalItems, 3);
  const sFilterHigh = (await servicesService.listServices({ filter: 'high' }, ADMIN)) as { pagination: Page };
  assert.equal(sFilterHigh.pagination.totalItems, 3, 'services high filter is amount >= 100 (99.99 excluded)');
  const sFilterNotes = (await servicesService.listServices({ filter: 'notes' }, ADMIN)) as { pagination: Page };
  assert.equal(sFilterNotes.pagination.totalItems, 3, 'services notes filter ignores a spaces-only note');

  const sSearchDelivery = (await servicesService.listServices({ search: 'delivery' }, ADMIN)) as {
    services: Array<{ id: string }>;
  };
  assert.deepEqual(
    sSearchDelivery.services.map((r) => r.id),
    ['1'],
  );
  const sSearchCreator = (await servicesService.listServices({ search: 'cashier-1' }, ADMIN)) as {
    services: Array<{ id: string }>;
  };
  assert.deepEqual(
    sSearchCreator.services.map((r) => r.id),
    ['4', '2'],
  );
  const sSearchBranch = (await servicesService.listServices({ search: 'branch two' }, ADMIN)) as {
    services: Array<{ id: string }>;
  };
  assert.deepEqual(
    sSearchBranch.services.map((r) => r.id),
    ['3'],
  );

  // ---------- users (admin) ----------
  const uDefault = (await usersService.listUsers({ page: 1 }, ADMIN)) as {
    users: Array<{ id: string; branchIds: string[] }>;
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
    summary: {
      total: number;
      totalItems: number;
      active: number;
      inactive: number;
      superAdmins: number;
      admins: number;
      cashiers: number;
      locked: number;
      activePrivilegedUsers: number;
    };
    planLimit: { activeUsersCount: number };
  };
  assert.equal(uDefault.users.length, 10, 'users default page is 10 rows');
  assert.deepEqual(uDefault.pagination, { page: 1, pageSize: 10, total: 250, totalPages: 25 });
  assert.equal(uDefault.users[0].id, '1', 'users ordered id ASC');
  assert.deepEqual(uDefault.summary, {
    total: 250,
    totalItems: 250,
    active: 249,
    inactive: 1,
    superAdmins: 1,
    admins: 2,
    cashiers: 247,
    locked: 2,
    activePrivilegedUsers: 3,
  });
  assert.equal(uDefault.planLimit.activeUsersCount, 249);
  assert.deepEqual(uDefault.users[1].branchIds, ['1', '2'], 'users branch map is fetched for the page ids');

  const uCap150 = (await usersService.listUsers({ page: 1, pageSize: 150 }, ADMIN)) as { users: unknown[] };
  assert.equal(uCap150.users.length, 150, 'users pageSize=150 returns 150 rows (old code: 100)');
  const uCap1000 = (await usersService.listUsers({ page: 1, pageSize: 1000 }, ADMIN)) as {
    users: unknown[];
    pagination: { pageSize: number };
  };
  assert.equal(uCap1000.users.length, 200, 'users pageSize=1000 caps at 200');
  assert.equal(uCap1000.pagination.pageSize, 200);

  const uClamp = (await usersService.listUsers({ page: 99 }, ADMIN)) as {
    users: Array<{ id: string }>;
    pagination: { page: number };
  };
  assert.equal(uClamp.pagination.page, 25, 'users page 99 clamps to last page 25');
  assert.deepEqual(
    uClamp.users.map((r) => r.id),
    ['241', '242', '243', '244', '245', '246', '247', '248', '249', '250'],
  );

  const uInactive = (await usersService.listUsers({ includeInactive: 'false' }, ADMIN)) as {
    pagination: { total: number };
  };
  assert.equal(uInactive.pagination.total, 249);
  const uInactiveBool = (await usersService.listUsers({ includeInactive: false }, ADMIN)) as {
    pagination: { total: number };
  };
  assert.equal(
    uInactiveBool.pagination.total,
    250,
    'boolean false falls back to include-all (normalizeUserListQuery quirk)',
  );
  const uRole = (await usersService.listUsers({ role: 'cashier' }, ADMIN)) as { pagination: { total: number } };
  assert.equal(uRole.pagination.total, 247);
  const uRoleCase = (await usersService.listUsers({ role: 'Cashier' }, ADMIN)) as { pagination: { total: number } };
  assert.equal(uRoleCase.pagination.total, 0, 'users role filter is case-sensitive');

  const uSearchOne = (await usersService.listUsers({ search: 'cashier-1' }, ADMIN)) as { users: Array<{ id: string }> };
  assert.deepEqual(
    uSearchOne.users.map((r) => r.id),
    ['2'],
  );
  const uSearchMany = (await usersService.listUsers({ search: 'cashier' }, ADMIN)) as { pagination: { total: number } };
  assert.equal(uSearchMany.pagination.total, 3);
  const uSearchPhone = (await usersService.listUsers({ search: '01000000002' }, ADMIN)) as {
    users: Array<{ id: string }>;
  };
  assert.deepEqual(
    uSearchPhone.users.map((r) => r.id),
    ['2'],
  );

  const uSanitized = (await usersService.listUsers({ page: 1 }, CASHIER)) as {
    users: Array<{
      permissions: string[];
      mustChangePassword: boolean;
      failedLoginCount: number;
      lockedUntil: string | null;
      lastLoginAt: string | null;
    }>;
    summary: { total: number };
  };
  assert.deepEqual(uSanitized.users[0].permissions, [], 'non-manager sees no permissions');
  assert.equal(uSanitized.users[0].mustChangePassword, false);
  assert.equal(uSanitized.users[0].failedLoginCount, 0);
  assert.equal(uSanitized.users[0].lockedUntil, null);
  assert.equal(uSanitized.users[0].lastLoginAt, null);
  assert.equal(uSanitized.summary.total, 250, 'summary stays over ALL users even when sanitized');

  // The internal refresh callers page through instead of shrinking to 200.
  const unlocked = (await usersService.unlockUser(4, ADMIN)) as {
    users: Array<{ id: string; failedLoginCount: number }>;
  };
  assert.equal(unlocked.users.length, 250, 'unlock refresh returns ALL 250 users (old code: 200)');
  assert.equal(unlocked.users.find((u) => u.id === '4')?.failedLoginCount, 0);

  await db.destroy();
  console.log('PASS returns-services-users-sql-pagination');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
