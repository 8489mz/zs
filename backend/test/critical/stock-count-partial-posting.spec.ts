/*
New file: backend/test/critical/stock-count-partial-posting.spec.ts
Pins the spirit-of-law count posting rule (INV-SPIRIT-COUNT-POSTING).

THE GAP: posting a count session demanded an admin password for the
whole session, and ANY item whose stock had moved since the count
started aborted the entire session with STOCK_COUNT_STALE -- one
moved item blocked every unchanged item, and a zero-variance session
still needed a manager credential.

THE RULE: an item whose scoped stock moved since the count started
is skipped, never blocking the session: it stays unposted for a
standalone recount (which refreshes its expected quantity), while
every unchanged item posts and the session stays draft until the
skipped items are recounted and posted. Manager approval -- the
shared manager PIN or a manager password -- is required only when
the session posts a variance or a serial/batch trace; a
zero-variance session posts with no credential at all.

WHAT THIS PINS, driving the REAL postStockCountSession on PGlite:
- a session with one unchanged item and one moved item posts the
  unchanged item as a non-manager with NO credential; the moved item
  stays unposted, the session stays draft, and the response names
  the skipped item; after a recount the item posts and the session
  becomes posted.
- a variance session posted by a non-manager without a credential
  is rejected with ADMIN_PASSWORD_REQUIRED; the same session posts
  with the manager PIN, and an equivalent session posts with the
  admin password.
- a zero-variance session posts as a non-manager with no credential.
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

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['canAdjustInventory'] } as unknown as AuthContext;
const CASHIER = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 2, username: 'cashier', permissions: ['canAdjustInventory'] } as unknown as AuthContext;

async function seedProduct(db: Kysely<Database>, id: number, globalQty: number, reserved: number, cost: number, trackSerials = false): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${globalQty}, ${reserved}, ${cost}, true, ${trackSerials})`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${globalQty === 80 ? 100 : globalQty}, ${reserved})`.execute(db);
}

async function seedSession(db: Kysely<Database>, sessionId: number, productId: number, expected: number, counted: number, reason: string, serials: string[] | null): Promise<number> {
  await sql`INSERT INTO stock_count_sessions (id, tenant_id, account_id, doc_no, branch_id, location_id, status, note, counted_by, created_at, updated_at) VALUES (${sessionId}, 't1', 'a1', ${`ZSC-${sessionId}`}, 1, 1, 'draft', '', 1, NOW(), NOW())`.execute(db);
  const item = await sql<{ id: number }>`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES ('t1', 'a1', ${sessionId}, ${productId}, ${`Product ${productId}`}, ${expected}, ${counted}, ${Number((counted - expected).toFixed(3))}, ${reason}, '', ${serials ? JSON.stringify(serials) : null}, null) RETURNING id`.execute(db);
  return Number(item.rows[0].id);
}

async function journalLines(db: Kysely<Database>, sourceId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'stock_count_chunk' AND e.source_id = ${sourceId} AND e.tenant_id = 't1' ORDER BY a.code`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
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
      INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
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


    // Approval fixtures: admin password + shared manager PIN + cashier user.
    const adminRecord = await createPasswordRecord('admin-pass');
    await sql`UPDATE users SET password_hash = ${adminRecord.hash}, password_salt = ${adminRecord.salt} WHERE id = 1`.execute(db);
    await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true)`.execute(db);
    await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);

    async function sessionStatus(db: Kysely<Database>, id: number): Promise<string> {
      const row = await sql<{ status: string }>`SELECT status FROM stock_count_sessions WHERE id = ${id}`.execute(db);
      return row.rows[0].status;
    }
    async function itemPosted(db: Kysely<Database>, itemId: number): Promise<boolean> {
      const row = await sql<{ posted_at: string | null }>`SELECT posted_at FROM stock_count_items WHERE id = ${itemId}`.execute(db);
      return row.rows[0].posted_at != null;
    }

    // Case 1: one unchanged item + one moved item. The unchanged item
    // posts with no credential; the moved item is skipped, the session
    // stays draft, and the response names the skipped item.
    await seedProduct(db, 1, 100, 0, 10);
    await seedProduct(db, 2, 100, 0, 10);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 2 AND location_id = 1`.execute(db);
    const movedItem = await seedSession(db, 201, 2, 90, 90, 'count', null);
    const keptRow = await sql<{ id: number }>`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES ('t1', 'a1', 201, 1, 'Product 1', 100, 100, 0, 'count', '', null, null) RETURNING id`.execute(db);
    const keptItem = Number(keptRow.rows[0].id);
    await sql`UPDATE product_location_stock SET qty = 92 WHERE product_id = 2 AND location_id = 1`.execute(db);
    const partial = await service.postStockCountSession(201, CASHIER) as Record<string, unknown>;
    assert.deepEqual(partial.skippedStockCountItemIds, [movedItem]);
    assert.equal(await itemPosted(db, keptItem), true);
    assert.equal(await itemPosted(db, movedItem), false);
    assert.equal(await sessionStatus(db, 201), 'draft');
    const keptLoc = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 1 AND location_id = 1`.execute(db);
    assert.equal(Number(keptLoc.rows[0].qty), 100);

    // The skipped item is recounted standalone (fresh expected = 92)
    // and the repost completes the session with no credential.
    await service.recountPendingStockCountItem(201, movedItem, { reason: 'recounted after a sale moved stock', countedQty: 92 } as never, CASHIER);
    await service.postStockCountSession(201, CASHIER);
    assert.equal(await itemPosted(db, movedItem), true);
    assert.equal(await sessionStatus(db, 201), 'posted');

    // Case 2: a variance session needs manager approval from a
    // non-manager; the manager PIN works, and so does the admin password.
    await seedProduct(db, 3, 100, 0, 10);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 3 AND location_id = 1`.execute(db);
    await seedSession(db, 202, 3, 90, 85, 'shortage found', null);
    await assert.rejects(service.postStockCountSession(202, CASHIER), (error: any) => error.code === 'ADMIN_PASSWORD_REQUIRED');
    assert.equal(await sessionStatus(db, 202), 'draft');
    await service.postStockCountSession(202, CASHIER, '2468');
    assert.equal(await sessionStatus(db, 202), 'posted');
    await seedProduct(db, 4, 100, 0, 10);
    await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = 4 AND location_id = 1`.execute(db);
    await seedSession(db, 203, 4, 90, 85, 'shortage found', null);
    await service.postStockCountSession(203, CASHIER, 'admin-pass');
    assert.equal(await sessionStatus(db, 203), 'posted');
    const loc3 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 3 AND location_id = 1`.execute(db);
    assert.equal(Number(loc3.rows[0].qty), 85);

    // Case 3: a zero-variance session posts as a non-manager with no
    // credential at all.
    await seedProduct(db, 5, 100, 0, 10);
    await seedSession(db, 204, 5, 100, 100, 'count', null);
    await service.postStockCountSession(204, CASHIER);
    assert.equal(await sessionStatus(db, 204), 'posted');

    console.log('stock count partial posting checks passed');
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
