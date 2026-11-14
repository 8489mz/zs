/*
New file: backend/test/critical/stock-count-dual-approval.spec.ts
Pins approval on stock-count variance posting
(INV-STOCK-COUNT-DUAL-APPROVAL, as revised by
INV-STOCK-COUNT-SELF-APPROVAL, 2026-11-14).

THE GAP (2026-11-12): assertCountVarianceApproval returned early
for admin / super_admin, so an admin posting their own count never
needed any approval at all; and the posting code then wrote
approved_by: auth.userId, so counter = poster = approver for any
variance size. A single person could count, post, and approve their
own variance with no credential at all.

THE RULE NOW: there is no admin bypass -- every variance approval
requires a credential, and the credential must identify an approver
user via the password path (the shared manager PIN identifies no
approver and is rejected). Self-approval is ALLOWED: the approver
may be the counter, the poster, or both
(INV-STOCK-COUNT-SELF-APPROVAL supersedes the different-person bans
STOCK_COUNT_APPROVER_SAME_AS_COUNTER /
STOCK_COUNT_APPROVER_SAME_AS_POSTER — the second manager may be a
shop owner who does not use computers). approved_by records the
approver's id (the password holder); a zero-variance session needs
no approval and records no approver (null).

WHAT THIS PINS, driving the REAL postStockCountSession on PGlite:
- an admin posting their own count with a variance and no credential
  is rejected (ADMIN_PASSWORD_REQUIRED); their own password approves
  and records them as approver.
- approver == counter approves (the counter's own password posts).
- approver == poster approves (the poster's own password posts).
- the shared manager PIN cannot approve
  (STOCK_COUNT_APPROVER_NOT_IDENTIFIED); a wrong password is rejected
  (ADMIN_PASSWORD_INVALID).
- a different manager approves: the session posts and approved_by
  equals the approver's id (3), not the poster's (2).
- a zero-variance session posts with no credential and approved_by
  stays null.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { InventoryCountService } from '../../src/modules/inventory/services/inventory-count.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const ADMIN1 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin1', permissions: ['canAdjustInventory'] } as unknown as AuthContext;
const CASHIER = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 2, username: 'cashier', permissions: ['canAdjustInventory'] } as unknown as AuthContext;
const ADMIN2 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 3, username: 'admin2', permissions: ['canAdjustInventory'] } as unknown as AuthContext;

async function seedProduct(db: Kysely<Database>, id: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, 100, 0, 10, true, false)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, 100, 0)`.execute(db);
}

async function seedSession(db: Kysely<Database>, sessionId: number, productId: number, expected: number, counted: number, countedBy: number): Promise<void> {
  await sql`INSERT INTO stock_count_sessions (id, tenant_id, account_id, doc_no, branch_id, location_id, status, note, counted_by, created_at, updated_at) VALUES (${sessionId}, 't1', 'a1', ${`ZSC-${sessionId}`}, 1, 1, 'draft', '', ${countedBy}, NOW(), NOW())`.execute(db);
  await sql`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES ('t1', 'a1', ${sessionId}, ${productId}, ${`Product ${productId}`}, ${expected}, ${counted}, ${Number((counted - expected).toFixed(3))}, 'shortage found', '', null, null)`.execute(db);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try { await promise; } catch (error) { caught = error; }
  assert.ok(caught, `expected rejection with ${code}`);
  assert.equal((caught as { code?: string }).code, code);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new InventoryCountService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    new InventoryScopeService(db as never),
    { check: async () => null } as unknown as IdempotencyService,
    posting,
  );

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
      INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (1140,'t1','1140','asset'), (5200,'t1','5200','expense'), (5300,'t1','5300','expense'), (7100,'t1','7100','revenue');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
      INSERT INTO branches VALUES (1, 't1', 'Main', 1);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      INSERT INTO users VALUES (1, 't1', 'admin1', 1, 'admin', '', '', true);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_count_sessions (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, branch_id bigint, location_id bigint, status text, note text, counted_by bigint, approved_by bigint, posted_at timestamptz, created_at timestamptz, updated_at timestamptz);
      CREATE TABLE stock_count_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, session_id bigint, product_id bigint, product_name text, expected_qty numeric, counted_qty numeric, variance_qty numeric, reason text, note text, counted_serials text, batch_counts text, posted_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE stock_transfers (id bigint PRIMARY KEY, tenant_id text, status text);
      CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, branch_id bigint, location_id bigint, cost_price numeric, purchase_id bigint, purchase_item_id bigint, sale_id bigint, sale_item_id bigint, warranty_end_date date, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
      CREATE TABLE damaged_stock_records (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reason text, note text, created_by bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
    `);

    // Approval fixtures: two distinct admin passwords + the shared
    // manager PIN. The cashier (id 2) holds no password.
    const admin1Record = await createPasswordRecord('admin1-pass');
    await sql`UPDATE users SET password_hash = ${admin1Record.hash}, password_salt = ${admin1Record.salt} WHERE id = 1`.execute(db);
    const admin2Record = await createPasswordRecord('admin2-pass');
    await sql`INSERT INTO users VALUES (3, 't1', 'admin2', 1, 'admin', ${admin2Record.hash}, ${admin2Record.salt}, true)`.execute(db);
    await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true)`.execute(db);
    await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);

    async function sessionState(db: Kysely<Database>, id: number): Promise<{ status: string; approvedBy: number | null }> {
      const row = await sql<{ status: string; approved_by: number | null }>`SELECT status, approved_by FROM stock_count_sessions WHERE id = ${id}`.execute(db);
      return { status: row.rows[0].status, approvedBy: row.rows[0].approved_by == null ? null : Number(row.rows[0].approved_by) };
    }

    // Case 1: an admin posting their own count (counter = poster = 1)
    // with a variance and no credential is rejected (the bypass is
    // gone); their own password approves and records them as the
    // approver (self-approval allowed, INV-STOCK-COUNT-SELF-APPROVAL).
    await seedProduct(db, 1);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 1 AND location_id = 1`.execute(db);
    await seedSession(db, 301, 1, 90, 85, 1);
    await expectCode(service.postStockCountSession(301, ADMIN1), 'ADMIN_PASSWORD_REQUIRED');
    assert.equal((await sessionState(db, 301)).status, 'draft');
    await service.postStockCountSession(301, ADMIN1, 'admin1-pass');
    const selfApproved = await sessionState(db, 301);
    assert.equal(selfApproved.status, 'posted');
    assert.equal(selfApproved.approvedBy, 1);
    const loc1 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 1 AND location_id = 1`.execute(db);
    assert.equal(Number(loc1.rows[0].qty), 85);

    // Case 2: approver == counter. Cashier posts a count made by
    // admin1; admin1's own password approves it.
    await seedProduct(db, 2);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 2 AND location_id = 1`.execute(db);
    await seedSession(db, 302, 2, 90, 85, 1);
    await service.postStockCountSession(302, CASHIER, 'admin1-pass');
    const counterApproved = await sessionState(db, 302);
    assert.equal(counterApproved.status, 'posted');
    assert.equal(counterApproved.approvedBy, 1);

    // Case 3: approver == poster. Admin1 posts a count made by the
    // cashier; admin1's own password approves their own posting.
    await seedProduct(db, 3);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 3 AND location_id = 1`.execute(db);
    await seedSession(db, 303, 3, 90, 85, 2);
    await service.postStockCountSession(303, ADMIN1, 'admin1-pass');
    const posterApproved = await sessionState(db, 303);
    assert.equal(posterApproved.status, 'posted');
    assert.equal(posterApproved.approvedBy, 1);

    // Case 4: the shared manager PIN cannot identify its holder, so
    // it can never satisfy dual control -- even for a session whose
    // counter and poster are both different people.
    await seedProduct(db, 4);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 4 AND location_id = 1`.execute(db);
    await seedSession(db, 304, 4, 90, 85, 1);
    await expectCode(service.postStockCountSession(304, CASHIER, '2468'), 'STOCK_COUNT_APPROVER_NOT_IDENTIFIED');
    assert.equal((await sessionState(db, 304)).status, 'draft');

    // Case 5: a wrong password is still rejected as before.
    await expectCode(service.postStockCountSession(304, CASHIER, 'wrong-pass'), 'ADMIN_PASSWORD_INVALID');
    assert.equal((await sessionState(db, 304)).status, 'draft');

    // Case 6: a different manager approves. Admin2 (id 3) is neither
    // the counter (admin1, id 1) nor the poster (cashier, id 2): the
    // session posts and approved_by is the approver's id, not the
    // poster's.
    await service.postStockCountSession(304, CASHIER, 'admin2-pass');
    const approved = await sessionState(db, 304);
    assert.equal(approved.status, 'posted');
    assert.equal(approved.approvedBy, 3);
    const loc4 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 4 AND location_id = 1`.execute(db);
    assert.equal(Number(loc4.rows[0].qty), 85);

    // Case 7: a zero-variance session posts with no credential at all
    // and records no approver -- the poster is not written as one.
    await seedProduct(db, 5);
    await seedSession(db, 305, 5, 100, 100, 2);
    await service.postStockCountSession(305, CASHIER);
    const zeroVariance = await sessionState(db, 305);
    assert.equal(zeroVariance.status, 'posted');
    assert.equal(zeroVariance.approvedBy, null);

    console.log('stock count dual approval checks passed (7 cases)');
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
