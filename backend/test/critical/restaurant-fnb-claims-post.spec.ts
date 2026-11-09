/*
 * R-I5 + R-I6 (INV-REST-FNB-CLAIMS-POST): an F&B screen used to claim money
 * moved, or was recorded, and nothing was posted.
 *
 * A manager comp only checked amount > 0, then inserted a row: the saleId
 * was never verified, no manager PIN was checked (the modal collected one
 * and never sent it), any authenticated user could call it, and NO journal,
 * sale adjustment or expense was posted — yet the response said "تم اعتماد
 * وقيد ضيافة الإدارة". A tip pool took cash/card totals from the client and
 * never reconciled them with the actual tip_amount sums, had no duplicate
 * guard and no status check, and "confirm" flipped rows to is_paid with no
 * journal, no cash payout and no payroll link while claiming "اعتماد وصرف".
 *
 * The fix, driven here against the real service over PGlite (one fresh
 * database per case, db.destroy() teardown):
 * - comp: manager caller (admin role, or pos_manager / manage_restaurant
 *   permission — the POS isManager definition) AND a verified manager
 *   approval via authorizeManagerSecret, or it fails; a named sale must
 *   exist for this tenant AND already be posted, and the amount may not
 *   exceed what the customer still owes after earlier posted comps; the
 *   comp then posts a real journal (Dr sales discount 4300 / Cr customer
 *   receivable 1130, the same legs postSale uses) and the response
 *   carries the journal id. A comp with no sale is the current-cart
 *   authorization: it records the approval and posts NO journal — the
 *   discount posts with the sale, so posting one here as well would count
 *   it twice — and the response says so.
 * - tip pool: the client total must reconcile with the tips actually
 *   collected on that tenant-local business day (posted, non-credit sales;
 *   drafts, cancelled and credit sales excluded), every employee must be
 *   a real active hr_employee of the tenant, a second pool for the same
 *   branch + shift date is refused, and confirm is an approval, not a
 *   payout: it refuses an already-distributed pool and leaves the rows
 *   unpaid until a real payout moves the money.
 *
 * PIN NOTE: the spec seeds the legacy PLAINTEXT manager PIN in settings,
 * stored exactly as the production save path stores it — JSON.stringify'ed,
 * i.e. '"1234"'. At base authorizeManagerSecret compares it in plaintext;
 * after R3-D merges, the same stored value verifies once and is hashed in
 * place (INV-REST-MANAGER-PIN-HASHED) — the PIN cases below pass under both.
 * (A value stored as plain 1234 without the JSON quotes is silently
 * ignored by getManagerPin — JSON.parse('1234') yields a number, not a
 * string — but the save path always JSON-encodes, so production never
 * stores it that way; flagged as a follow-up for R3-D.)
 *
 * R6-D (INV-REST-TIP-STAFF-REAL): the picker half — getTipPoolStaff is
 * the restaurant-scoped staff list the modal reads (the HR endpoint
 * needs hrEmployees/hrAttendance, which the manager caller who opens the
 * modal does not necessarily hold, so it cannot be the source). Cases
 * (25)-(27) pin it: only active employees of this tenant are listed,
 * and an inactive or other-tenant employee in the pool is refused with
 * UNKNOWN_EMPLOYEE before any insert. The ghost-id case (19) already
 * pinned the forged-id refusal; the server half was already enforced
 * (R3-E) — R6-D adds the picker and pins the status/tenant edges.
 *
 * RED PROOF: on the unfixed tree the comp cases fail (a bad saleId, a
 * missing PIN and a cashier caller all succeed and no journal exists) and
 * the tip cases fail (invented totals, a second pool and a double confirm
 * all succeed) — see the base-run note at the end of the report.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  RestaurantAdvancedFnbService,
  type TenantScope,
} from '../../src/modules/sales/services/restaurant-advanced-fnb.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't1';
const ACCOUNT = 't1:main';
const SHIFT = '2026-11-09';
const PIN = '1234';

const DDL = `
  CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
    name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
    allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '',
    is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false);
  CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
    bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
    inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
    cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
    purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
    lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
  CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
    period_number int, start_date date, end_date date);
  CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
    entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
    status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
    posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
    reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
    dedup_key text, cash_flow_category text);
  CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
    tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
    partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
  CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
  CREATE TABLE tenants (id text PRIMARY KEY, slug text, activity_type text, plan_id text, extra_features jsonb,
    business_name text, owner_phone text, owner_name text, owner_email text, country_code text, status text,
    created_at timestamptz DEFAULT NOW());
  CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
  CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
  CREATE TABLE users (id bigserial PRIMARY KEY, username text, role text, password_hash text, password_salt text,
    is_active boolean DEFAULT true, tenant_id text, account_id text);
  CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
  CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
  CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
    amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
  CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
  CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0);
  CREATE TABLE suppliers (id bigint, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
  CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint,
    subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, total numeric,
    paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, exchange_return_id bigint,
    branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
    delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0,
    tip_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, sale_origin text,
    payment_type text DEFAULT 'cash', collection_status text, status text DEFAULT 'posted');
  CREATE TABLE restaurant_manager_comps (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint,
    sale_id bigint, table_number text, comp_type text, manager_name text, amount numeric,
    items_summary text, notes text, created_at timestamptz DEFAULT NOW());
  CREATE TABLE restaurant_tip_pools (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint,
    shift_date text, shift_name text, total_cash_tips numeric, total_card_tips numeric, total_tips numeric,
    distribution_method text, status text, notes text, distributed_by bigint,
    distributed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  CREATE TABLE restaurant_tip_pool_distributions (id bigserial PRIMARY KEY, tenant_id text, pool_id bigint,
    employee_id bigint, employee_name text, role_name text, hours_worked numeric, point_weight numeric,
    allocated_amount numeric, is_paid boolean DEFAULT false, paid_at timestamptz,
    created_at timestamptz DEFAULT NOW());
  CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_no text,
    first_name text, last_name text, display_name text, status text,
    branch_id bigint, expected_daily_hours numeric);
`;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(DDL);
  return { pg, db };
}

async function resetDb(pg: PGlite): Promise<void> {
  // One PGlite instance is shared by all cases: 24 fresh instances in one
  // process OOM-killed the VM (exit 137 after case 22). TRUNCATE between
  // cases gives the same isolation at a fraction of the memory.
  await pg.exec(`TRUNCATE accounting_accounts, accounting_settings,
    accounting_fiscal_periods, journal_entries, journal_entry_lines,
    cost_centers, settings, currency_exchange_rates, tenants, branches,
    stock_locations, users, user_branches, customer_ledger, supplier_ledger,
    accounting_posting_failures, customers, suppliers, sales,
    restaurant_manager_comps, restaurant_tip_pools,
    restaurant_tip_pool_distributions, hr_employees RESTART IDENTITY`);
}

async function seedBase(db: Kysely<Database>, opts: { settingsDiscountId?: number | null } = {}): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({
    id: TENANT, slug: 'test-shop', activity_type: 'restaurant', plan_id: 'plan_basic',
    extra_features: '[]', business_name: 'متجر الاختبار', owner_phone: null,
    owner_name: null, owner_email: null, country_code: 'EG', status: 'active',
  }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({
    tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, default_stock_location_id: null }).execute();
  await anyDb.insertInto('branches').values({ id: 2, tenant_id: TENANT, default_stock_location_id: null }).execute();
  for (const code of [1110, 1120, 1130, 1140, 4100, 4300, 5100, 2120, 7290]) {
    await anyDb.insertInto('accounting_accounts').values({
      id: code, tenant_id: TENANT, code: String(code), is_active: true, is_tax: false,
    }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, supplier_payable_account_id: 2110,
    inventory_account_id: 1140, sales_revenue_account_id: 4100,
    sales_discount_account_id: opts.settingsDiscountId === undefined ? 4300 : opts.settingsDiscountId,
    cogs_account_id: 5100, sales_tax_account_id: 2120, purchase_tax_account_id: null,
    purchase_account_id: null, expenses_account_id: null, manufacturing_overhead_account_id: null,
    lock_date_all: null, lock_date_non_adviser: null, lock_date_tax: null,
  }).execute();
  await anyDb.insertInto('customers').values({ id: 7, tenant_id: TENANT, balance: 0 }).execute();
  for (const row of [
    { id: 1, branch_id: 1, expected_daily_hours: 8, status: 'active', tenant_id: TENANT },
    { id: 2, branch_id: 1, expected_daily_hours: 6, status: 'active', tenant_id: TENANT },
    { id: 3, branch_id: 2, expected_daily_hours: null, status: 'active', tenant_id: TENANT },
    { id: 4, branch_id: 1, expected_daily_hours: 8, status: 'inactive', tenant_id: TENANT },
    { id: 5, branch_id: 1, expected_daily_hours: 8, status: 'active', tenant_id: 't2' },
  ]) {
    await anyDb.insertInto('hr_employees').values({
      id: row.id, tenant_id: row.tenant_id, account_id: ACCOUNT, employee_no: `E${row.id}`,
      first_name: `Emp${row.id}`, last_name: 'Test', display_name: `Employee ${row.id}`,
      status: row.status, branch_id: row.branch_id, expected_daily_hours: row.expected_daily_hours,
    }).execute();
  }
}

function buildService(db: Kysely<Database>): RestaurantAdvancedFnbService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new RestaurantAdvancedFnbService(db, posting);
}

const managerScope: TenantScope = { tenantId: TENANT, accountId: ACCOUNT, role: 'admin', permissions: [], userId: 1 };
const cashierScope: TenantScope = { tenantId: TENANT, accountId: ACCOUNT, role: 'cashier', permissions: ['sales'], userId: 2 };
const permCashierScope: TenantScope = { tenantId: TENANT, accountId: ACCOUNT, role: 'cashier', permissions: ['pos_manager'], userId: 3 };

async function expectAppError(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(error?.code, code, `expected AppError ${code}, got ${error?.code}: ${error?.message}`);
    assert.equal(error?.statusCode, statusCode, `expected status ${statusCode}, got ${error?.statusCode}`);
    return;
  }
  assert.fail(`expected AppError ${code} but the call succeeded`);
}

async function countRows(pg: PGlite, table: string, where = ''): Promise<number> {
  const rows = await pg.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM ${table} ${where}`);
  return Number(rows.rows[0].n);
}

async function journalLines(pg: PGlite, entryId: number): Promise<Array<{ account_id: string; debit: string; credit: string; partner_type: string; partner_id: string | null }>> {
  const rows = await pg.query<{ account_id: string; debit: string; credit: string; partner_type: string; partner_id: string | null }>(
    `SELECT account_id, debit, credit, partner_type, partner_id FROM journal_entry_lines WHERE journal_entry_id = $1 ORDER BY id`,
    [entryId],
  );
  return rows.rows;
}

function compDto(overrides: Record<string, unknown> = {}): any {
  return {
    compType: 'vip_guest',
    managerName: 'Invented Name',
    managerPin: PIN,
    amount: 25,
    ...overrides,
  };
}

function tipDto(overrides: Record<string, unknown> = {}): any {
  return {
    shiftDate: SHIFT,
    shiftName: 'وردية اليوم',
    totalCashTips: 100,
    totalCardTips: 50,
    distributionMethod: 'roles',
    staff: [
      { employeeId: 1, employeeName: 'Employee 1', roleName: 'waiter', hoursWorked: 8, pointWeight: 1.2 },
      { employeeId: 2, employeeName: 'Employee 2', roleName: 'waiter', hoursWorked: 8, pointWeight: 1.2 },
    ],
    ...overrides,
  };
}

async function seedSale(
  db: Kysely<Database>,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await (db as any).insertInto('sales').values({
    id: 1, tenant_id: TENANT, doc_no: 'S-1', customer_id: 7, subtotal: 100, discount: 0,
    tax_amount: 0, total: 100, paid_amount: 0, store_credit_used: 0, exchange_return_id: null,
    branch_id: null, location_id: null, created_by: 1, created_at: '2026-11-09T10:00:00Z',
    delivery_fee: 0, delivery_fee_mode: null, service_charge: 0, tip_amount: 0,
    prices_include_tax: false, sale_origin: null, payment_type: 'cash',
    collection_status: null, status: 'posted',
    ...overrides,
  }).execute();
}

async function seedPostedSaleJournal(db: Kysely<Database>, saleId = 1): Promise<void> {
  await (db as any).insertInto('journal_entries').values({
    tenant_id: TENANT, account_id: ACCOUNT, entry_no: 'JE-0001', entry_date: new Date(),
    description: 'posted sale', source_type: 'sale', source_id: saleId, status: 'posted',
    branch_id: null, location_id: null, created_by: 1, posted_by: 1, posted_at: new Date(),
  }).execute();
}

async function seedTipSales(db: Kysely<Database>): Promise<void> {
  // Business day 2026-11-09 in Africa/Cairo. 22:30 UTC on the 8th is 00:30
  // Cairo on the 9th (counts); 22:30 UTC on the 9th is 00:30 Cairo on the
  // 10th (does not count).
  const rows: Array<Record<string, unknown>> = [
    { id: 11, tip_amount: 100, created_at: '2026-11-08T22:30:00Z', status: 'posted', payment_type: 'cash' },
    { id: 12, tip_amount: 50, created_at: '2026-11-09T10:00:00Z', status: 'posted', payment_type: 'card' },
    { id: 13, tip_amount: 999, created_at: '2026-11-09T22:30:00Z', status: 'posted', payment_type: 'cash' },
    { id: 14, tip_amount: 500, created_at: '2026-11-09T10:00:00Z', status: 'cancelled', payment_type: 'cash' },
    { id: 15, tip_amount: 300, created_at: '2026-11-09T10:00:00Z', status: 'posted', payment_type: 'credit' },
    { id: 16, tip_amount: 200, created_at: '2026-11-09T10:00:00Z', status: 'draft', payment_type: 'cash' },
  ];
  for (const row of rows) {
    await seedSale(db, { ...row, doc_no: `S-${row.id}`, customer_id: null, total: 100, subtotal: 100 });
  }
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
  // (1) Comp on a real posted sale posts a balanced journal.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db);
      await seedPostedSaleJournal(db);
      const service = buildService(db);
      const res: any = await service.recordManagerComp(managerScope, compDto({ saleId: 1 }));
      assert.equal(res.success, true);
      assert.ok(Number(res.journalEntryId) > 0, 'the response must carry the journal id');
      assert.equal(res.comp.manager_name, 'اعتماد المدير', 'the recorded manager is the verified approver, not the client free text');
      assert.equal(Number(res.comp.amount), 25);
      const lines = await journalLines(pg, Number(res.journalEntryId));
      assert.equal(lines.length, 2, 'exactly two journal lines');
      assert.equal(Number(lines[0].account_id), 4300);
      assert.equal(Number(lines[0].debit), 25);
      assert.equal(Number(lines[0].credit), 0);
      assert.equal(Number(lines[1].account_id), 1130);
      assert.equal(Number(lines[1].debit), 0);
      assert.equal(Number(lines[1].credit), 25);
      assert.equal(lines[1].partner_type, 'customer');
      assert.equal(Number(lines[1].partner_id), 7);
      assert.equal(await countRows(pg, 'journal_entries', `WHERE source_type = 'manager_comp'`), 1);
      console.log('  (1) comp on a posted sale posts a balanced journal passed');
    }
  }

  // (2) Comp with a nonexistent saleId fails; nothing is recorded.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      await expectAppError(service.recordManagerComp(managerScope, compDto({ saleId: 999 })), 'SALE_NOT_FOUND', 404);
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 0);
      assert.equal(await countRows(pg, 'journal_entries'), 0);
      console.log('  (2) comp with a bad saleId fails passed');
    }
  }

  // (3) Comp with another tenant's sale fails the same way (no tenancy leak).
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db, { id: 5, tenant_id: 't2', doc_no: 'S-T2' });
      const service = buildService(db);
      await expectAppError(service.recordManagerComp(managerScope, compDto({ saleId: 5 })), 'SALE_NOT_FOUND', 404);
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 0);
      console.log('  (3) comp with another tenant sale fails passed');
    }
  }

  // (4) Comp with no PIN fails; nothing is recorded.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db);
      await seedPostedSaleJournal(db);
      const service = buildService(db);
      await expectAppError(
        service.recordManagerComp(managerScope, compDto({ saleId: 1, managerPin: undefined })),
        'MANAGER_AUTH_REQUIRED',
        400,
      );
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 0);
      assert.equal(await countRows(pg, 'journal_entries', `WHERE source_type = 'manager_comp'`), 0);
      console.log('  (4) comp with no PIN fails passed');
    }
  }

  // (5) Comp with a wrong PIN fails; nothing is recorded.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db);
      await seedPostedSaleJournal(db);
      const service = buildService(db);
      await expectAppError(
        service.recordManagerComp(managerScope, compDto({ saleId: 1, managerPin: '9999' })),
        'MANAGER_AUTH_INVALID',
        400,
      );
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 0);
      console.log('  (5) comp with a wrong PIN fails passed');
    }
  }

  // (6) A cashier caller fails even with the correct PIN — the PIN proves
  // a manager approved, it does not make the caller a manager.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db);
      await seedPostedSaleJournal(db);
      const service = buildService(db);
      await expectAppError(
        service.recordManagerComp(cashierScope, compDto({ saleId: 1 })),
        'MANAGER_PERMISSION_REQUIRED',
        403,
      );
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 0);
      console.log('  (6) cashier caller with the right PIN still fails passed');
    }
  }

  // (7) A cashier holding the pos_manager permission may record a comp
  // (the permission half of the manager definition).
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      const res: any = await service.recordManagerComp(permCashierScope, compDto());
      assert.equal(res.success, true);
      assert.equal(res.journalEntryId, null, 'a cart authorization posts no journal');
      console.log('  (7) cashier with pos_manager permission succeeds passed');
    }
  }

  // (8) Comp on a draft (unposted) sale fails — there is no receivable to credit.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db, { status: 'draft' });
      const service = buildService(db);
      await expectAppError(
        service.recordManagerComp(managerScope, compDto({ saleId: 1 })),
        'SALE_NOT_POSTED',
        422,
      );
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 0);
      console.log('  (8) comp on a draft sale fails passed');
    }
  }

  // (9) Comp exceeding what the customer still owes fails.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db, { total: 100, paid_amount: 100 });
      await seedPostedSaleJournal(db);
      const service = buildService(db);
      await expectAppError(
        service.recordManagerComp(managerScope, compDto({ saleId: 1, amount: 10 })),
        'COMP_EXCEEDS_RECEIVABLE',
        422,
      );
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 0);
      console.log('  (9) comp exceeding the remaining receivable fails passed');
    }
  }

  // (10) Partial comps respect the remaining receivable after earlier comps.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db, { total: 100, paid_amount: 60 });
      await seedPostedSaleJournal(db);
      const service = buildService(db);
      await expectAppError(
        service.recordManagerComp(managerScope, compDto({ saleId: 1, amount: 50 })),
        'COMP_EXCEEDS_RECEIVABLE',
        422,
      );
      const res: any = await service.recordManagerComp(managerScope, compDto({ saleId: 1, amount: 40 }));
      assert.ok(Number(res.journalEntryId) > 0);
      const lines = await journalLines(pg, Number(res.journalEntryId));
      assert.equal(Number(lines[0].debit), 40);
      assert.equal(Number(lines[1].credit), 40);
      await expectAppError(
        service.recordManagerComp(managerScope, compDto({ saleId: 1, amount: 5 })),
        'COMP_EXCEEDS_RECEIVABLE',
        422,
      );
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 1, 'only the successful comp is recorded');
      console.log('  (10) partial comps respect the remaining receivable passed');
    }
  }

  // (11) Cart authorization (no sale): approved and recorded, NO journal,
  // and the response says the discount posts with the sale.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      const res: any = await service.recordManagerComp(managerScope, compDto());
      assert.equal(res.success, true);
      assert.equal(res.journalEntryId, null);
      assert.match(String(res.message), /عند إتمام البيع/, 'the message must say the discount posts with the sale');
      assert.equal(await countRows(pg, 'journal_entries'), 0, 'no journal may exist for a cart authorization');
      assert.equal(await countRows(pg, 'restaurant_manager_comps'), 1);
      console.log('  (11) cart authorization records no journal passed');
    }
  }

  // (12) Account-mode approval: an active admin's login password approves,
  // and the recorded manager is that admin's username.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db);
      await seedPostedSaleJournal(db);
      const record = await createPasswordRecord('admin-pass');
      await (db as any).insertInto('users').values({
        username: 'boss', role: 'admin', password_hash: record.hash, password_salt: record.salt,
        is_active: true, tenant_id: TENANT, account_id: ACCOUNT,
      }).execute();
      const service = buildService(db);
      const res: any = await service.recordManagerComp(
        managerScope,
        compDto({ saleId: 1, managerPin: 'admin-pass' }),
      );
      assert.equal(res.success, true);
      assert.equal(res.comp.manager_name, 'boss');
      assert.ok(Number(res.journalEntryId) > 0);
      console.log('  (12) account-mode approval records the admin username passed');
    }
  }

  // (13) With no configured discount account in settings, the 4300 code fallback posts.
  {
    await resetDb(pg);
    {
      await seedBase(db, { settingsDiscountId: null });
      await seedSale(db);
      await seedPostedSaleJournal(db);
      const service = buildService(db);
      const res: any = await service.recordManagerComp(managerScope, compDto({ saleId: 1 }));
      assert.ok(Number(res.journalEntryId) > 0);
      const lines = await journalLines(pg, Number(res.journalEntryId));
      assert.equal(Number(lines[0].account_id), 4300);
      assert.equal(Number(lines[1].account_id), 1130);
      console.log('  (13) discount account falls back to code 4300 passed');
    }
  }

  // (14) Zero amount fails.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      await expectAppError(
        service.recordManagerComp(managerScope, compDto({ amount: 0 })),
        'INVALID_COMP_AMOUNT',
        400,
      );
      console.log('  (14) zero comp amount fails passed');
    }
  }

  // (15) Reconciled pool: only posted, non-credit tips on the tenant-local
  // business day count (00:30 Cairo on the 9th counts; 00:30 Cairo on the
  // 10th, cancelled, credit and draft sales do not).
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      const res: any = await service.calculateAndSaveTipPool(managerScope, tipDto());
      assert.equal(res.pool.status, 'draft');
      assert.equal(Number(res.totalTips), 150);
      assert.equal(Number(res.actualTips), 150);
      const sum = res.distributions.reduce((s: number, d: any) => s + Number(d.allocatedAmount || 0), 0);
      assert.equal(sum, 150, 'the allocations must sum to the reconciled total');
      console.log('  (15) reconciled pool distributes the actual tips passed');
    }
  }

  // (16) Invented totals fail and no pool row is created.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      let message = '';
      try {
        await service.calculateAndSaveTipPool(managerScope, tipDto({ totalCashTips: 400, totalCardTips: 300 }));
        assert.fail('invented totals must fail');
      } catch (error: any) {
        assert.equal(error?.code, 'TIP_TOTAL_MISMATCH');
        assert.equal(error?.statusCode, 422);
        message = String(error?.message || '');
      }
      assert.match(message, /150/, 'the error must report the actual collected total');
      assert.equal(await countRows(pg, 'restaurant_tip_pools'), 0);
      assert.equal(await countRows(pg, 'restaurant_tip_pool_distributions'), 0);
      console.log('  (16) invented tip totals fail passed');
    }
  }

  // (17) A second pool for the same branch + shift date is refused.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      await service.calculateAndSaveTipPool(managerScope, tipDto());
      await expectAppError(
        service.calculateAndSaveTipPool(managerScope, tipDto()),
        'TIP_POOL_EXISTS',
        409,
      );
      assert.equal(await countRows(pg, 'restaurant_tip_pools'), 1);
      console.log('  (17) duplicate pool for the same shift fails passed');
    }
  }

  // (18) Confirm approves without claiming payment; a second confirm fails.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      const created: any = await service.calculateAndSaveTipPool(managerScope, tipDto());
      const res: any = await service.confirmTipDistribution(managerScope, Number(created.pool.id));
      assert.equal(res.success, true);
      assert.equal(res.payoutPending, true);
      assert.match(String(res.message), /معلّق/, 'confirm must say the payout is pending, never that money was paid');
      const poolRows = await pg.query<{ status: string }>(
        `SELECT status FROM restaurant_tip_pools WHERE id = $1`,
        [Number(created.pool.id)],
      );
      assert.equal(poolRows.rows[0].status, 'distributed');
      assert.equal(
        await countRows(pg, 'restaurant_tip_pool_distributions', `WHERE pool_id = ${Number(created.pool.id)} AND is_paid = true`),
        0,
        'no distribution row may claim paid without a payout',
      );
      assert.equal(
        await countRows(pg, 'restaurant_tip_pool_distributions', `WHERE pool_id = ${Number(created.pool.id)} AND paid_at IS NOT NULL`),
        0,
      );
      await expectAppError(
        service.confirmTipDistribution(managerScope, Number(created.pool.id)),
        'POOL_ALREADY_DISTRIBUTED',
        409,
      );
      console.log('  (18) double confirm fails and confirm never claims payment passed');
    }
  }

  // (19) A pool for a nonexistent employee fails.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      await expectAppError(
        service.calculateAndSaveTipPool(managerScope, tipDto({
          staff: [{ employeeId: 999, employeeName: 'Ghost', roleName: 'waiter', hoursWorked: 8, pointWeight: 1 }],
        })),
        'UNKNOWN_EMPLOYEE',
        422,
      );
      assert.equal(await countRows(pg, 'restaurant_tip_pools'), 0);
      console.log('  (19) pool for a fake employee fails passed');
    }
  }

  // (20) The same employee twice in one pool fails.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      await expectAppError(
        service.calculateAndSaveTipPool(managerScope, tipDto({
          staff: [
            { employeeId: 1, employeeName: 'Employee 1', roleName: 'waiter', hoursWorked: 8, pointWeight: 1 },
            { employeeId: 1, employeeName: 'Employee 1', roleName: 'waiter', hoursWorked: 8, pointWeight: 1 },
          ],
        })),
        'DUPLICATE_EMPLOYEE',
        400,
      );
      console.log('  (20) duplicate employee in one pool fails passed');
    }
  }

  // (21) A cashier caller cannot create a pool.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      await expectAppError(
        service.calculateAndSaveTipPool(cashierScope, tipDto()),
        'MANAGER_PERMISSION_REQUIRED',
        403,
      );
      assert.equal(await countRows(pg, 'restaurant_tip_pools'), 0);
      console.log('  (21) cashier caller cannot create a pool passed');
    }
  }

  // (22) A cashier caller cannot confirm a pool.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedTipSales(db);
      const service = buildService(db);
      const created: any = await service.calculateAndSaveTipPool(managerScope, tipDto());
      await expectAppError(
        service.confirmTipDistribution(cashierScope, Number(created.pool.id)),
        'MANAGER_PERMISSION_REQUIRED',
        403,
      );
      const poolRows = await pg.query<{ status: string }>(
        `SELECT status FROM restaurant_tip_pools WHERE id = $1`,
        [Number(created.pool.id)],
      );
      assert.equal(poolRows.rows[0].status, 'draft', 'the failed confirm must leave the pool a draft');
      console.log('  (22) cashier caller cannot confirm a pool passed');
    }
  }

  // (23) A branch-scoped pool counts only that branch's sales.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      await seedSale(db, { id: 21, doc_no: 'S-21', tip_amount: 100, branch_id: 1, created_at: '2026-11-09T10:00:00Z' });
      await seedSale(db, { id: 22, doc_no: 'S-22', tip_amount: 50, branch_id: 2, created_at: '2026-11-09T10:00:00Z' });
      await seedSale(db, { id: 23, doc_no: 'S-23', tip_amount: 25, branch_id: null, created_at: '2026-11-09T10:00:00Z' });
      const service = buildService(db);
      const branchScope: TenantScope = { ...managerScope, branchId: 1 };
      const res: any = await service.calculateAndSaveTipPool(branchScope, tipDto({ totalCashTips: 100, totalCardTips: 0 }));
      assert.equal(Number(res.actualTips), 100);
      assert.equal(Number(res.totalTips), 100);
      console.log('  (23) branch-scoped pool counts only its branch passed');
    }
  }

  // (24) With no sales at all, any claimed total fails against an actual 0.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      await expectAppError(
        service.calculateAndSaveTipPool(managerScope, tipDto()),
        'TIP_TOTAL_MISMATCH',
        422,
      );
      assert.equal(await countRows(pg, 'restaurant_tip_pools'), 0);
      console.log('  (24) pool with no collected tips fails passed');
    }
  }

  // (25) INV-REST-TIP-STAFF-REAL: the picker list holds only ACTIVE
  // employees of THIS tenant — the inactive row (4) and the other
  // tenant's row (5) never reach the modal — with the display name,
  // branch and expected daily hours the picker needs.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      const staff: any = await service.getTipPoolStaff(managerScope);
      assert.deepEqual(staff.map((s: any) => s.id), ['1', '2', '3']);
      assert.equal(staff[0].displayName, 'Employee 1');
      assert.equal(staff[0].branchId, '1');
      assert.equal(staff[0].expectedDailyHours, 8);
      assert.equal(staff[1].expectedDailyHours, 6);
      assert.equal(staff[2].branchId, '2');
      assert.equal(staff[2].expectedDailyHours, null);
      console.log('  (25) tip staff list holds only active employees of this tenant passed');
    }
  }

  // (26) INV-REST-TIP-STAFF-REAL: an INACTIVE employee in the pool is
  // refused — only status 'active' counts — before any insert.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      await expectAppError(
        service.calculateAndSaveTipPool(managerScope, tipDto({
          staff: [{ employeeId: 4, employeeName: 'Employee 4', roleName: 'waiter', hoursWorked: 8, pointWeight: 1 }],
        })),
        'UNKNOWN_EMPLOYEE',
        422,
      );
      assert.equal(await countRows(pg, 'restaurant_tip_pools'), 0);
      assert.equal(await countRows(pg, 'restaurant_tip_pool_distributions'), 0);
      console.log('  (26) pool with an inactive employee fails passed');
    }
  }

  // (27) INV-REST-TIP-STAFF-REAL: another tenant's employee id is
  // refused the same way — the validation is tenant-scoped.
  {
    await resetDb(pg);
    {
      await seedBase(db);
      const service = buildService(db);
      await expectAppError(
        service.calculateAndSaveTipPool(managerScope, tipDto({
          staff: [{ employeeId: 5, employeeName: 'Employee 5', roleName: 'waiter', hoursWorked: 8, pointWeight: 1 }],
        })),
        'UNKNOWN_EMPLOYEE',
        422,
      );
      assert.equal(await countRows(pg, 'restaurant_tip_pools'), 0);
      assert.equal(await countRows(pg, 'restaurant_tip_pool_distributions'), 0);
      console.log('  (27) pool with another tenant employee fails passed');
    }
  }

  console.log('restaurant-fnb-claims-post.spec: all checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
