/*
New file: backend/test/critical/stock-count-self-approval.spec.ts
Pins self-approval on stock-count variance approval
(INV-STOCK-COUNT-SELF-APPROVAL, superseding the different-person
bans of INV-STOCK-COUNT-DUAL-APPROVAL).

THE GAP: dual control required a DIFFERENT admin's password, but
the second manager may be a shop owner who does not use computers,
so waiting for one blocks the business — and a tenant with exactly
one active admin had no second approver at all. The post-session
dialog hid the password field for admins entirely, so an admin was
never even offered a place to type a credential (the frontend half
is pinned by InventoryPostSessionDialog.spec.tsx).

THE RULE: any admin/super_admin may approve a count variance with
their own password — the approver may be the counter, the poster,
or both. A variance post still requires an identified manager
credential (missing → ADMIN_PASSWORD_REQUIRED); the shared manager
PIN still cannot approve (it identifies nobody); a wrong password
still fails. The audit trail survives: approved_by always records
the password holder's id. A zero-variance session still posts with
no credential.

WHAT THIS PINS, driving the REAL postStockCountSession on PGlite:
- (a) the sole admin of a single-admin tenant counting AND posting
  a variance session approves with their own password; the session
  posts and approved_by equals their own id.
- (b) the sole admin posting a count made by a cashier approves
  with their own password (poster == approver).
- (c) the shared manager PIN still fails
  (STOCK_COUNT_APPROVER_NOT_IDENTIFIED); a wrong password still
  fails (ADMIN_PASSWORD_INVALID).
- (d) multi-admin tenant: an admin posting their own count with
  their own password approves (counter == poster == approver).
- (e) multi-admin tenant: a different admin's password still
  approves, and approved_by records that approver.
- (f) a zero-variance session posts with no credential and
  approved_by stays null.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// t2: single-admin tenant (sole admin id 10, cashier id 11).
const SOLE_ADMIN = { tenantId: 't2', accountId: 'a2', role: 'admin', userId: 10, username: 'soleadmin', permissions: ['canAdjustInventory'] } as unknown as AuthContext;
const T2_CASHIER = { tenantId: 't2', accountId: 'a2', role: 'cashier', userId: 11, username: 'cashier2', permissions: ['canAdjustInventory'] } as unknown as AuthContext;
// t1: multi-admin tenant (admin1 id 1, admin2 id 3, cashier id 2) —
// the control that the escape does not leak into dual control.
const ADMIN1 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin1', permissions: ['canAdjustInventory'] } as unknown as AuthContext;

async function seedProduct(db: Kysely<Database>, tenantId: string, accountId: string, branchId: number, locationId: number, id: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, ${tenantId}, ${accountId}, ${`Product ${id}`}, 100, 0, 10, true, false)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES (${tenantId}, ${accountId}, ${id}, ${branchId}, ${locationId}, 100, 0)`.execute(db);
}

async function seedSession(db: Kysely<Database>, tenantId: string, accountId: string, branchId: number, locationId: number, sessionId: number, productId: number, expected: number, counted: number, countedBy: number): Promise<void> {
  await sql`INSERT INTO stock_count_sessions (id, tenant_id, account_id, doc_no, branch_id, location_id, status, note, counted_by, created_at, updated_at) VALUES (${sessionId}, ${tenantId}, ${accountId}, ${`ZSC-${sessionId}`}, ${branchId}, ${locationId}, 'draft', '', ${countedBy}, NOW(), NOW())`.execute(db);
  await sql`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES (${tenantId}, ${accountId}, ${sessionId}, ${productId}, ${`Product ${productId}`}, ${expected}, ${counted}, ${Number((counted - expected).toFixed(3))}, 'shortage found', '', null, null)`.execute(db);
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
      INSERT INTO tenants VALUES ('t1'), ('t2');
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      INSERT INTO settings VALUES ('t1','currency','EGP'), ('t2','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1), ('t2','EGP',true,1);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
      INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (1140,'t1','1140','asset'), (5200,'t1','5200','expense'), (5300,'t1','5300','expense'), (7100,'t1','7100','revenue');
      INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (1141,'t2','1140','asset'), (5201,'t2','5200','expense'), (5301,'t2','5300','expense'), (7101,'t2','7100','revenue');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO accounting_settings VALUES (2,'t2',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
      INSERT INTO branches VALUES (1, 't1', 'Main', 1), (2, 't2', 'Main', 2);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'MAIN', true, 'branch_stock'), (2, 't2', 2, 'Main Store', 'MAIN', true, 'branch_stock');
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      INSERT INTO users VALUES (1, 't1', 'admin1', 1, 'admin', '', '', true);
      INSERT INTO users VALUES (3, 't1', 'admin2', 1, 'admin', '', '', true);
      INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true);
      INSERT INTO users VALUES (10, 't2', 'soleadmin', 2, 'admin', '', '', true);
      INSERT INTO users VALUES (11, 't2', 'cashier2', 2, 'cashier', '', '', true);
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

    // Approval fixtures: the sole admin's password, the two t1 admin
    // passwords, and the shared manager PIN (same value both tenants).
    const soleRecord = await createPasswordRecord('sole-pass');
    await sql`UPDATE users SET password_hash = ${soleRecord.hash}, password_salt = ${soleRecord.salt} WHERE id = 10`.execute(db);
    const admin1Record = await createPasswordRecord('admin1-pass');
    await sql`UPDATE users SET password_hash = ${admin1Record.hash}, password_salt = ${admin1Record.salt} WHERE id = 1`.execute(db);
    const admin2Record = await createPasswordRecord('admin2-pass');
    await sql`UPDATE users SET password_hash = ${admin2Record.hash}, password_salt = ${admin2Record.salt} WHERE id = 3`.execute(db);
    await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"'), ('t2', 'managerPin', '"2468"')`.execute(db);

    async function sessionState(db: Kysely<Database>, id: number): Promise<{ status: string; approvedBy: number | null }> {
      const row = await sql<{ status: string; approved_by: number | null }>`SELECT status, approved_by FROM stock_count_sessions WHERE id = ${id}`.execute(db);
      return { status: row.rows[0].status, approvedBy: row.rows[0].approved_by == null ? null : Number(row.rows[0].approved_by) };
    }

    // Case (a): single-admin tenant — the sole admin counted AND posts
    // a variance session; their own password approves (self-approved).
    await seedProduct(db, 't2', 'a2', 2, 2, 101);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 101 AND location_id = 2`.execute(db);
    await seedSession(db, 't2', 'a2', 2, 2, 401, 101, 90, 85, 10);
    await service.postStockCountSession(401, SOLE_ADMIN, 'sole-pass');
    const selfApproved = await sessionState(db, 401);
    assert.equal(selfApproved.status, 'posted');
    assert.equal(selfApproved.approvedBy, 10);
    const loc101 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 101 AND location_id = 2`.execute(db);
    assert.equal(Number(loc101.rows[0].qty), 85);

    // Case (b): single-admin tenant — a cashier counted, the sole
    // admin posts; the sole admin's own password approves (poster ==
    // approver is allowed only under the escape).
    await seedProduct(db, 't2', 'a2', 2, 2, 102);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 102 AND location_id = 2`.execute(db);
    await seedSession(db, 't2', 'a2', 2, 2, 402, 102, 90, 85, 11);
    await service.postStockCountSession(402, SOLE_ADMIN, 'sole-pass');
    const posterApproved = await sessionState(db, 402);
    assert.equal(posterApproved.status, 'posted');
    assert.equal(posterApproved.approvedBy, 10);

    // Case (c): single-admin tenant — the shared manager PIN still
    // cannot identify an approver, and a wrong password still fails.
    await seedProduct(db, 't2', 'a2', 2, 2, 103);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 103 AND location_id = 2`.execute(db);
    await seedSession(db, 't2', 'a2', 2, 2, 403, 103, 90, 85, 11);
    await expectCode(service.postStockCountSession(403, SOLE_ADMIN, '2468'), 'STOCK_COUNT_APPROVER_NOT_IDENTIFIED');
    assert.equal((await sessionState(db, 403)).status, 'draft');
    await expectCode(service.postStockCountSession(403, SOLE_ADMIN, 'wrong-pass'), 'ADMIN_PASSWORD_INVALID');
    assert.equal((await sessionState(db, 403)).status, 'draft');

    // Case (d): multi-admin tenant — an admin posting their own
    // count with their own password approves (counter == poster ==
    // approver); the different-person bans are gone.
    await seedProduct(db, 't1', 'a1', 1, 1, 104);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 104 AND location_id = 1`.execute(db);
    await seedSession(db, 't1', 'a1', 1, 1, 404, 104, 90, 85, 1);
    await service.postStockCountSession(404, ADMIN1, 'admin1-pass');
    const selfApprovedMulti = await sessionState(db, 404);
    assert.equal(selfApprovedMulti.status, 'posted');
    assert.equal(selfApprovedMulti.approvedBy, 1);
    const loc104 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 104 AND location_id = 1`.execute(db);
    assert.equal(Number(loc104.rows[0].qty), 85);

    // Case (e): multi-admin tenant — a different admin's password
    // still approves, and approved_by records that approver.
    await seedProduct(db, 't1', 'a1', 1, 1, 106);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 106 AND location_id = 1`.execute(db);
    await seedSession(db, 't1', 'a1', 1, 1, 406, 106, 90, 85, 1);
    await service.postStockCountSession(406, ADMIN1, 'admin2-pass');
    const otherApproved = await sessionState(db, 406);
    assert.equal(otherApproved.status, 'posted');
    assert.equal(otherApproved.approvedBy, 3);

    // Case (f): single-admin tenant — a zero-variance session posts
    // with no credential at all and records no approver.
    await seedProduct(db, 't2', 'a2', 2, 2, 105);
    await seedSession(db, 't2', 'a2', 2, 2, 405, 105, 100, 100, 11);
    await service.postStockCountSession(405, SOLE_ADMIN);
    const zeroVariance = await sessionState(db, 405);
    assert.equal(zeroVariance.status, 'posted');
    assert.equal(zeroVariance.approvedBy, null);

    // Source + invariant pins.
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/inventory/services/inventory-count.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('INV-STOCK-COUNT-SELF-APPROVAL'), 'service documents self-approval');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('- INV-STOCK-COUNT-SELF-APPROVAL ').length - 1, 1, 'invariant entry exists exactly once');

    console.log('stock count self approval checks passed (6 cases)');
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
