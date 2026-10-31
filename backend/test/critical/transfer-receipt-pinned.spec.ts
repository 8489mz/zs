/*
New file: backend/test/critical/transfer-receipt-pinned.spec.ts
Pins the transfer-receipt gate (INV-TRANSFER-RECEIPT-PINNED).

THE GAP: receiving a transfer defaulted every omitted item to
"fully received", and any shortfall the receiver typed in was
written off with no reason at all -- the receiver's bare quantity
assertion was the sole evidence for a Dr 5300 / Cr 1140 write-off,
and a lost shipment received with an empty payload was booked as
arrived. The shrinkage itself was then valued at the RECEIVE-time
cost_price, so a cost move between ship and receive revalued the
loss. The schema already had the columns to record all of this
(variance_reason on the item, transit_variance_journal_entry_id
on the header); nothing ever wrote them.

THE RULE: a receipt must name an explicit received quantity for
EVERY item (no default-full-receipt); any shortfall requires a
written variance reason of at least 8 characters, stored on each
shortfall item, with the first shrinkage journal id stored on the
header; shrinkage is valued at the cost FROZEN at dispatch (the
transfer_send movement's unit_cost), never re-read at receipt.

WHAT THIS PINS, driving the REAL createStockTransfer and
receiveStockTransfer on PGlite:
- receipt with no items, or an empty items array, is rejected
  with TRANSFER_RECEIPT_INVALID and the transfer stays 'sent'
  with transit stock intact.
- receipt omitting one item of two is rejected the same way.
- a shortfall with no reason, or a reason under 8 characters, is
  rejected with TRANSFER_VARIANCE_REASON_REQUIRED and nothing
  moves; retrying the same transfer with a valid reason succeeds.
- cost_price changed between ship (10) and receive (25): the
  shrinkage movement and journal stay at the dispatch cost
  (unit 10, total 20 for 2 units); the reason and the journal id
  are persisted; destination/global/transit quantities are exact.
- an explicit full receipt needs no reason, posts no shrinkage
  movement or journal, and leaves the variance columns empty.
- over-receipt and duplicate receipt rows are rejected with
  TRANSFER_RECEIPT_INVALID.
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
const REASON = 'Two units lost in transit';

async function seedProduct(db: Kysely<Database>, id: number, qty: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(db);
}

async function makeTransfer(service: InventoryTransferService, items: Array<{ productId: number; qty: number }>): Promise<number> {
  const res = await service.createStockTransfer({ fromLocationId: 1, toLocationId: 2, items } as never, AUTH) as any;
  return Number(res.transferId);
}

async function transferItemId(db: Kysely<Database>, transferId: number, productId: number): Promise<number> {
  const row = await sql<{ id: number }>`SELECT id FROM stock_transfer_items WHERE transfer_id = ${transferId} AND product_id = ${productId}`.execute(db);
  return Number(row.rows[0].id);
}

async function transferStatus(db: Kysely<Database>, transferId: number): Promise<string> {
  const row = await sql<{ status: string }>`SELECT status FROM stock_transfers WHERE id = ${transferId}`.execute(db);
  return row.rows[0].status;
}

async function transitQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT b.qty FROM product_location_stock b JOIN stock_locations l ON l.id = b.location_id WHERE b.product_id = ${productId} AND l.location_type = 'in_transit'`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
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
      CREATE TABLE stock_transfers (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, from_location_id bigint, to_location_id bigint, from_branch_id bigint, to_branch_id bigint, status text, note text, recipient_name text, created_by bigint, received_by bigint, received_at timestamptz, cancelled_by bigint, cancelled_at timestamptz, has_transit_variance boolean, transit_variance_journal_entry_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
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

    // Case 1: no items / empty items -> rejected, transfer stays sent, transit intact.
    await seedProduct(db, 1, 100, 10);
    const t1 = await makeTransfer(service, [{ productId: 1, qty: 10 }]);
    await assert.rejects(service.receiveStockTransfer(t1, AUTH), /TRANSFER_RECEIPT_INVALID/);
    await assert.rejects(service.receiveStockTransfer(t1, AUTH, { items: [] } as never), /TRANSFER_RECEIPT_INVALID/);
    assert.equal(await transferStatus(db, t1), 'sent');
    assert.equal(await transitQty(db, 1), 10);

    // Case 2: omitted item -> rejected, then a complete receipt succeeds.
    await seedProduct(db, 2, 100, 10);
    await seedProduct(db, 3, 100, 10);
    const t2 = await makeTransfer(service, [{ productId: 2, qty: 5 }, { productId: 3, qty: 5 }]);
    const t2item1 = await transferItemId(db, t2, 2);
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, { items: [{ itemId: t2item1, receivedQty: 5 }] } as never),
      /TRANSFER_RECEIPT_INVALID/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    const t2item2 = await transferItemId(db, t2, 3);
    await service.receiveStockTransfer(t2, AUTH, { items: [{ itemId: t2item1, receivedQty: 5 }, { itemId: t2item2, receivedQty: 5 }] } as never);
    assert.equal(await transferStatus(db, t2), 'received');

    // Case 3: shortfall without a reason -> rejected; short reason -> rejected;
    // retry with a valid reason succeeds with nothing half-moved.
    await seedProduct(db, 4, 100, 10);
    const t3 = await makeTransfer(service, [{ productId: 4, qty: 10 }]);
    const t3item = await transferItemId(db, t3, 4);
    await assert.rejects(
      service.receiveStockTransfer(t3, AUTH, { items: [{ itemId: t3item, receivedQty: 8 }] } as never),
      /TRANSFER_VARIANCE_REASON_REQUIRED/,
    );
    await assert.rejects(
      service.receiveStockTransfer(t3, AUTH, { items: [{ itemId: t3item, receivedQty: 8 }], varianceReason: 'lost' } as never),
      /TRANSFER_VARIANCE_REASON_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t3), 'sent');
    assert.equal(await transitQty(db, 4), 10);
    await service.receiveStockTransfer(t3, AUTH, { items: [{ itemId: t3item, receivedQty: 8 }], varianceReason: REASON } as never);
    assert.equal(await transferStatus(db, t3), 'received');

    // Case 4: cost moves between ship and receive -- shrinkage stays at dispatch cost.
    await seedProduct(db, 5, 100, 10);
    const t4 = await makeTransfer(service, [{ productId: 5, qty: 10 }]);
    const dispatchMov = await sql<{ unit_cost: string; total_cost: string }>`SELECT unit_cost, total_cost FROM stock_movements WHERE reference_id = ${t4} AND movement_type = 'transfer_send'`.execute(db);
    assert.equal(Number(dispatchMov.rows[0].unit_cost), 10);
    assert.equal(Number(dispatchMov.rows[0].total_cost), 100);
    await sql`UPDATE products SET cost_price = 25 WHERE id = 5`.execute(db);
    const t4item = await transferItemId(db, t4, 5);
    await service.receiveStockTransfer(t4, AUTH, { items: [{ itemId: t4item, receivedQty: 8 }], varianceReason: REASON } as never);
    const loss = await sql<{ id: number; unit_cost: string; total_cost: string }>`SELECT id, unit_cost, total_cost FROM stock_movements WHERE reference_id = ${t4} AND movement_type = 'transfer_transit_loss'`.execute(db);
    assert.equal(Number(loss.rows[0].unit_cost), 10);
    assert.equal(Number(loss.rows[0].total_cost), 20);
    const lines = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'inventory_adjustment' AND e.source_id = ${Number(loss.rows[0].id)} ORDER BY a.code`.execute(db);
    assert.deepEqual(lines.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) })), [
      { code: '1140', debit: 0, credit: 20 },
      { code: '5300', debit: 20, credit: 0 },
    ]);
    const item4 = await sql<{ variance_reason: string }>`SELECT variance_reason FROM stock_transfer_items WHERE id = ${t4item}`.execute(db);
    assert.equal(item4.rows[0].variance_reason, REASON);
    const header4 = await sql<{ has_transit_variance: boolean; transit_variance_journal_entry_id: number }>`SELECT has_transit_variance, transit_variance_journal_entry_id FROM stock_transfers WHERE id = ${t4}`.execute(db);
    assert.equal(header4.rows[0].has_transit_variance, true);
    const journalId = await sql<{ id: number }>`SELECT id FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = ${Number(loss.rows[0].id)}`.execute(db);
    assert.equal(Number(header4.rows[0].transit_variance_journal_entry_id), Number(journalId.rows[0].id));
    const dest4 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 5 AND location_id = 2`.execute(db);
    assert.equal(Number(dest4.rows[0].qty), 8);
    const glob4 = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = 5`.execute(db);
    // Company-wide total: 100 - 2 lost in transit = 98 (90 still at the
    // source, 8 at the destination, 0 in transit).
    assert.equal(Number(glob4.rows[0].stock_qty), 98);
    assert.equal(await transitQty(db, 5), 0);

    // Case 5: explicit full receipt needs no reason and posts no shrinkage.
    await seedProduct(db, 6, 100, 10);
    const t5 = await makeTransfer(service, [{ productId: 6, qty: 10 }]);
    const t5item = await transferItemId(db, t5, 6);
    await service.receiveStockTransfer(t5, AUTH, { items: [{ itemId: t5item, receivedQty: 10 }] } as never);
    const loss5 = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = ${t5} AND movement_type = 'transfer_transit_loss'`.execute(db);
    assert.equal(Number(loss5.rows[0].n), 0);
    const header5 = await sql<{ has_transit_variance: boolean; transit_variance_journal_entry_id: number | null }>`SELECT has_transit_variance, transit_variance_journal_entry_id FROM stock_transfers WHERE id = ${t5}`.execute(db);
    assert.equal(header5.rows[0].has_transit_variance, false);
    assert.equal(header5.rows[0].transit_variance_journal_entry_id, null);

    // Case 6: over-receipt and duplicate rows are rejected; a valid receipt then succeeds.
    await seedProduct(db, 7, 100, 10);
    const t6 = await makeTransfer(service, [{ productId: 7, qty: 10 }]);
    const t6item = await transferItemId(db, t6, 7);
    await assert.rejects(
      service.receiveStockTransfer(t6, AUTH, { items: [{ itemId: t6item, receivedQty: 11 }] } as never),
      /TRANSFER_RECEIPT_INVALID/,
    );
    await assert.rejects(
      service.receiveStockTransfer(t6, AUTH, { items: [{ itemId: t6item, receivedQty: 5 }, { itemId: t6item, receivedQty: 5 }] } as never),
      /TRANSFER_RECEIPT_INVALID/,
    );
    assert.equal(await transferStatus(db, t6), 'sent');
    await service.receiveStockTransfer(t6, AUTH, { items: [{ itemId: t6item, receivedQty: 10 }] } as never);
    assert.equal(await transferStatus(db, t6), 'received');

    console.log('transfer receipt pinned checks passed');
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
