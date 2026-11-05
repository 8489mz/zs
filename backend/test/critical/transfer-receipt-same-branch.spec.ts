/*
New file: backend/test/critical/transfer-receipt-same-branch.spec.ts
Style follows backend/test/critical/transfer-receipt-pinned.spec.ts
(node:assert + PGlite, imports production code, no duplicated formulas).

WHAT THIS PINS: a same-branch transfer receipt (INV-TRANSFER-SAME-BRANCH-RECEIPT).

THE BUG (live, transfer ZTR-261105-2497, test10k, build 1.1.40): a transfer
created branch -> the SAME branch (to_branch_id = from_branch_id, no explicit
to_location_id) is stored with to_location_id NULL -- the create guard only
rejects an explicit same location, and NULL passes the
stock_transfers_location_diff CHECK (from_location_id <> to_location_id).
At receipt the destination resolves to the branch_stock location of that
branch, which IS the source location, and the header UPDATE stamps
to_location_id = from_location_id -- violating the CHECK (PG 23514). Every
named check passes first, so the failure surfaces as the generic
"invalid value in one of the fields" message and the whole transaction
rolls back: no stock moves, the transfer stays 'sent', 2 units sit in
transit forever.

THE RULE: the receipt must never stamp a to_location_id that equals the
source location. When the resolved destination IS the source location,
the header keeps its NULL to_location_id and the receipt still moves the
stock (transit -> branch stock) and closes the transfer. A normal
cross-location receipt still stamps the resolved destination location.

WHAT THIS PINS, driving the REAL createStockTransfer and
receiveStockTransfer on PGlite (the spec DDL carries the production
CHECK constraint, and the spec asserts it is present, so the case
cannot pass vacuously):
- a branch -> same-branch transfer is created with to_location_id NULL,
  status 'sent', branch stock 5, transit 2, global 7.
- a full 2/2 receipt succeeds: status 'received', branch stock 5 -> 7,
  transit 2 -> 0, global stays 7, the transfer_transit_out (2 -> 0)
  and transfer_receive (5 -> 7) movements are recorded, and
  to_location_id stays NULL.
- a normal cross-location receipt still stamps to_location_id (2).
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
import { InventoryTransferService } from '../../src/modules/inventory/services/inventory-transfer.service';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['canAdjustInventory'] } as unknown as AuthContext;

async function seedProduct(db: Kysely<Database>, id: number, qty: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(db);
}

async function makeSameBranchTransfer(service: InventoryTransferService, productId: number, qty: number): Promise<number> {
  const res = await service.createStockTransfer({ fromLocationId: 1, toBranchId: 1, items: [{ productId, qty }] } as never, AUTH) as any;
  return Number(res.transferId);
}

async function makeCrossLocationTransfer(service: InventoryTransferService, productId: number, qty: number): Promise<number> {
  const res = await service.createStockTransfer({ fromLocationId: 1, toLocationId: 2, items: [{ productId, qty }] } as never, AUTH) as any;
  return Number(res.transferId);
}

async function transferItemId(db: Kysely<Database>, transferId: number, productId: number): Promise<number> {
  const row = await sql<{ id: number }>`SELECT id FROM stock_transfer_items WHERE transfer_id = ${transferId} AND product_id = ${productId}`.execute(db);
  return Number(row.rows[0].id);
}

async function transferRow(db: Kysely<Database>, transferId: number): Promise<{ status: string; to_location_id: number | null; from_location_id: number }> {
  const row = await sql<{ status: string; to_location_id: number | null; from_location_id: number }>`SELECT status, to_location_id, from_location_id FROM stock_transfers WHERE id = ${transferId}`.execute(db);
  return row.rows[0];
}

async function locationQty(db: Kysely<Database>, productId: number, locationId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = ${locationId}`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function transitQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT b.qty FROM product_location_stock b JOIN stock_locations l ON l.id = b.location_id WHERE b.product_id = ${productId} AND l.location_type = 'in_transit'`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function globalQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = ${productId}`.execute(db);
  return Number(row.rows[0].stock_qty);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new InventoryTransferService(
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
      INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (1140,'t1','1140','asset'), (5200,'t1','5200','expense'), (5300,'t1','5300','expense'), (6900,'t1','6900','expense'), (7100,'t1','7100','revenue');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
      INSERT INTO branches VALUES (1, 't1', 'Main', 1), (2, 't1', 'Dest', 2);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock'), (2, 't1', 'a1', 2, 'Dest Store', 'DEST', true, 'branch_stock');
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_transfers (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, from_location_id bigint, to_location_id bigint, from_branch_id bigint, to_branch_id bigint, status text, note text, recipient_name text, created_by bigint, received_by bigint, received_at timestamptz, cancelled_by bigint, cancelled_at timestamptz, has_transit_variance boolean, transit_variance_journal_entry_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, CONSTRAINT stock_transfers_location_diff CHECK (from_location_id <> to_location_id));
      CREATE TABLE stock_transfer_items (id bigserial PRIMARY KEY, transfer_id bigint, tenant_id text, account_id text, product_id bigint, product_name text, qty numeric, dispatched_qty numeric, received_qty numeric, variance_qty numeric, variance_reason text, serial_tracking text, batch_tracking text);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, branch_id bigint, location_id bigint, cost_price numeric, purchase_id bigint, purchase_item_id bigint, sale_id bigint, sale_item_id bigint, warranty_end_date date, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
      SELECT setval(pg_get_serial_sequence('stock_locations', 'id'), 100);
      SELECT setval(pg_get_serial_sequence('stock_transfers', 'id'), 100);
    `);

    // The production CHECK constraint must be present, or the case below
    // would pass vacuously even with the bug still in the service.
    const constraint = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM pg_constraint WHERE conname = 'stock_transfers_location_diff'`.execute(db);
    assert.equal(Number(constraint.rows[0].n), 1);

    // Case 1: same-branch transfer (live ZTR-261105-2497 shape): 7 on hand,
    // 2 dispatched to the same branch. Creation stores to_location_id NULL.
    await seedProduct(db, 11, 7, 10);
    const t1 = await makeSameBranchTransfer(service, 11, 2);
    const created = await transferRow(db, t1);
    assert.equal(created.status, 'sent');
    assert.equal(created.to_location_id, null);
    assert.equal(created.from_location_id, 1);
    assert.equal(await locationQty(db, 11, 1), 5);
    assert.equal(await transitQty(db, 11), 2);
    assert.equal(await globalQty(db, 11), 7);

    // Full 2/2 receipt: before the fix this throws the 23514 check
    // violation (stock_transfers_location_diff) and nothing moves.
    const t1item = await transferItemId(db, t1, 11);
    await service.receiveStockTransfer(t1, AUTH, { items: [{ itemId: t1item, receivedQty: 2 }] } as never);
    const received = await transferRow(db, t1);
    assert.equal(received.status, 'received');
    assert.equal(received.to_location_id, null);
    assert.equal(await locationQty(db, 11, 1), 7);
    assert.equal(await transitQty(db, 11), 0);
    assert.equal(await globalQty(db, 11), 7);
    const outMov = await sql<{ before_qty: string; after_qty: string }>`SELECT before_qty, after_qty FROM stock_movements WHERE reference_id = ${t1} AND movement_type = 'transfer_transit_out'`.execute(db);
    assert.equal(outMov.rows.length, 1);
    assert.equal(Number(outMov.rows[0].before_qty), 2);
    assert.equal(Number(outMov.rows[0].after_qty), 0);
    const inMov = await sql<{ before_qty: string; after_qty: string }>`SELECT before_qty, after_qty FROM stock_movements WHERE reference_id = ${t1} AND movement_type = 'transfer_receive'`.execute(db);
    assert.equal(inMov.rows.length, 1);
    assert.equal(Number(inMov.rows[0].before_qty), 5);
    assert.equal(Number(inMov.rows[0].after_qty), 7);
    const item1 = await sql<{ received_qty: string; variance_qty: string }>`SELECT received_qty, variance_qty FROM stock_transfer_items WHERE id = ${t1item}`.execute(db);
    assert.equal(Number(item1.rows[0].received_qty), 2);
    assert.equal(Number(item1.rows[0].variance_qty), 0);

    // Case 2: a normal cross-location receipt still stamps the destination.
    await seedProduct(db, 12, 10, 10);
    const t2 = await makeCrossLocationTransfer(service, 12, 3);
    const t2item = await transferItemId(db, t2, 12);
    await service.receiveStockTransfer(t2, AUTH, { items: [{ itemId: t2item, receivedQty: 3 }] } as never);
    const received2 = await transferRow(db, t2);
    assert.equal(received2.status, 'received');
    assert.equal(received2.to_location_id, 2);
    assert.equal(await locationQty(db, 12, 2), 3);
    assert.equal(await transitQty(db, 12), 0);

    console.log('transfer receipt same-branch checks passed');
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
