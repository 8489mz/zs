/*
New file: backend/test/critical/transfer-receipt-shortage-approval.spec.ts
Pins the transfer-receipt shortfall gate (INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL).

THE GAP: a receipt that named less than was dispatched -- or named
nothing for an item, which defaults to 0 received -- posted the
shortfall immediately as Dr 5300 / Cr 1140 at the frozen dispatch
cost, with no written reason and no second person involved. One UI
slip turned real stock into a loss posting, approved by nobody.

THE RULE: a receipt with ANY shortfall over 0.0001 needs BOTH a
written variance reason of at least 8 characters AND approval by a
different user than the receiver, verified through the one shared
authorizeManagerSecret. The approval credential must resolve to an
admin user id different from the receiver: the shared manager PIN
identifies no approver, so it cannot satisfy segregation of duties.
If either is missing or invalid, the WHOLE receipt is rejected
fail-closed with nothing half-moved. Full receipts are unchanged:
no reason or approval needed. Approved shortfalls keep the frozen
dispatch-cost valuation and the Dr 5300 / Cr 1140 journal shape.

WHAT THIS PINS, driving the REAL createStockTransfer and
receiveStockTransfer on PGlite:
- an omitted item defaults to 0 received and, with no reason or
  approval, the receipt is rejected: the transfer stays 'sent',
  transit stock is intact, and no shrinkage movement or journal
  exists.
- a shortfall with a reason but no approval is rejected.
- a shortfall with a reason and a wrong approval secret is
  rejected with MANAGER_AUTH_INVALID.
- a shortfall with a reason approved by the receiver's own
  password is rejected (self-approval).
- a shortfall with a reason shorter than 8 characters, even with
  a valid different approver, is rejected.
- a shortfall with a reason of at least 8 characters approved by
  a DIFFERENT admin user is accepted: the shrinkage journal is
  Dr 5300 / Cr 1140 at the frozen dispatch cost (cost_price moved
  10 -> 25 between ship and receive, loss stays 20 for 2 units),
  the reason and journal id are persisted, and destination /
  global / transit quantities are exact.
- an explicit full receipt needs no reason or approval and posts
  no shrinkage.
- the shared manager PIN alone does not satisfy approval: a
  shortfall approved only with the PIN is rejected, because the
  PIN identifies no approver.
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
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { hashManagerPin } from '../../src/common/utils/manager-approval';

const RECEIVER_PASSWORD = 'receiver-password';
const APPROVER_PASSWORD = 'approver-password';
const MANAGER_PIN = '2468';
const REASON = 'Two units lost in transit';
const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['canAdjustInventory'] } as unknown as AuthContext;

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

async function lossCount(db: Kysely<Database>, transferId: number): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = ${transferId} AND movement_type = 'transfer_transit_loss'`.execute(db);
  return Number(row.rows[0].n);
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

    // Receiver (user 1, the AUTH user) and a different approver (user 2),
    // both admins with bcrypt passwords, so authorizeManagerSecret can
    // resolve the approver to a user id different from the receiver.
    const receiverRecord = await createPasswordRecord(RECEIVER_PASSWORD);
    const approverRecord = await createPasswordRecord(APPROVER_PASSWORD);
    await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', ${receiverRecord.hash}, ${receiverRecord.salt}, true)`.execute(db);
    await sql`INSERT INTO users VALUES (2, 't1', 'approver', 1, 'admin', ${approverRecord.hash}, ${approverRecord.salt}, true)`.execute(db);

    // Case 1: an omitted item defaults to 0 received; with no reason or
    // approval the whole receipt is rejected, nothing half-moved.
    await seedProduct(db, 1, 100, 10);
    await seedProduct(db, 2, 100, 10);
    const t1 = await makeTransfer(service, [{ productId: 1, qty: 5 }, { productId: 2, qty: 5 }]);
    const t1item1 = await transferItemId(db, t1, 1);
    await assert.rejects(
      service.receiveStockTransfer(t1, AUTH, { items: [{ itemId: t1item1, receivedQty: 5 }] } as never),
      /TRANSFER_SHORTAGE_REASON_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t1), 'sent');
    assert.equal(await transitQty(db, 1), 5);
    assert.equal(await transitQty(db, 2), 5);
    assert.equal(await lossCount(db, t1), 0);
    const journals1 = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries`.execute(db);
    assert.equal(Number(journals1.rows[0].n), 0);

    // Case 2: shortfall + reason but no approval -> rejected.
    await seedProduct(db, 3, 100, 10);
    const t2 = await makeTransfer(service, [{ productId: 3, qty: 10 }]);
    const t2item = await transferItemId(db, t2, 3);
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, { items: [{ itemId: t2item, receivedQty: 8 }], varianceReason: REASON } as never),
      /TRANSFER_SHORTAGE_APPROVAL_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await transitQty(db, 3), 10);
    assert.equal(await lossCount(db, t2), 0);

    // Case 3: shortfall + reason + wrong approval secret -> rejected.
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, { items: [{ itemId: t2item, receivedQty: 8 }], varianceReason: REASON, approvalSecret: 'wrong-secret' } as never),
      /MANAGER_AUTH_INVALID/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Case 4: shortfall + reason approved by the receiver's own
    // password -> rejected (no self-approval).
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, { items: [{ itemId: t2item, receivedQty: 8 }], varianceReason: REASON, approvalSecret: RECEIVER_PASSWORD } as never),
      /TRANSFER_SHORTAGE_SELF_APPROVAL/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Case 5: shortfall + reason shorter than 8 characters, even with
    // a valid different approver -> rejected.
    await assert.rejects(
      service.receiveStockTransfer(t2, AUTH, { items: [{ itemId: t2item, receivedQty: 8 }], varianceReason: 'lost', approvalSecret: APPROVER_PASSWORD } as never),
      /TRANSFER_SHORTAGE_REASON_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t2), 'sent');
    assert.equal(await lossCount(db, t2), 0);

    // Case 6: shortfall + reason + DIFFERENT approver -> accepted, and
    // the loss stays at the frozen dispatch cost (10, not the moved 25).
    await seedProduct(db, 4, 100, 10);
    const t3 = await makeTransfer(service, [{ productId: 4, qty: 10 }]);
    await sql`UPDATE products SET cost_price = 25 WHERE id = 4`.execute(db);
    const t3item = await transferItemId(db, t3, 4);
    await service.receiveStockTransfer(t3, AUTH, { items: [{ itemId: t3item, receivedQty: 8 }], varianceReason: REASON, approvalSecret: APPROVER_PASSWORD } as never);
    assert.equal(await transferStatus(db, t3), 'received');
    const loss = await sql<{ id: number; unit_cost: string; total_cost: string }>`SELECT id, unit_cost, total_cost FROM stock_movements WHERE reference_id = ${t3} AND movement_type = 'transfer_transit_loss'`.execute(db);
    assert.equal(Number(loss.rows[0].unit_cost), 10);
    assert.equal(Number(loss.rows[0].total_cost), 20);
    const lines = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'inventory_adjustment' AND e.source_id = ${Number(loss.rows[0].id)} ORDER BY a.code`.execute(db);
    assert.deepEqual(lines.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) })), [
      { code: '1140', debit: 0, credit: 20 },
      { code: '5300', debit: 20, credit: 0 },
    ]);
    const item3 = await sql<{ variance_reason: string }>`SELECT variance_reason FROM stock_transfer_items WHERE id = ${t3item}`.execute(db);
    assert.equal(item3.rows[0].variance_reason, REASON);
    const header3 = await sql<{ has_transit_variance: boolean; transit_variance_journal_entry_id: number }>`SELECT has_transit_variance, transit_variance_journal_entry_id FROM stock_transfers WHERE id = ${t3}`.execute(db);
    assert.equal(header3.rows[0].has_transit_variance, true);
    const journalId = await sql<{ id: number }>`SELECT id FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = ${Number(loss.rows[0].id)}`.execute(db);
    assert.equal(Number(header3.rows[0].transit_variance_journal_entry_id), Number(journalId.rows[0].id));
    const dest3 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 4 AND location_id = 2`.execute(db);
    assert.equal(Number(dest3.rows[0].qty), 8);
    const glob3 = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = 4`.execute(db);
    assert.equal(Number(glob3.rows[0].stock_qty), 98);
    assert.equal(await transitQty(db, 4), 0);

    // Case 7: explicit full receipt needs no reason or approval and
    // posts no shrinkage.
    await seedProduct(db, 5, 100, 10);
    const t4 = await makeTransfer(service, [{ productId: 5, qty: 10 }]);
    const t4item = await transferItemId(db, t4, 5);
    await service.receiveStockTransfer(t4, AUTH, { items: [{ itemId: t4item, receivedQty: 10 }] } as never);
    assert.equal(await transferStatus(db, t4), 'received');
    assert.equal(await lossCount(db, t4), 0);

    // Case 8: the shared manager PIN identifies no approver, so it
    // cannot satisfy segregation of duties.
    const pinHash = await hashManagerPin(MANAGER_PIN);
    await sql`INSERT INTO settings VALUES ('t1', 'managerPin', ${JSON.stringify(pinHash)})`.execute(db);
    await seedProduct(db, 6, 100, 10);
    const t5 = await makeTransfer(service, [{ productId: 6, qty: 10 }]);
    const t5item = await transferItemId(db, t5, 6);
    await assert.rejects(
      service.receiveStockTransfer(t5, AUTH, { items: [{ itemId: t5item, receivedQty: 8 }], varianceReason: REASON, approvalSecret: MANAGER_PIN } as never),
      /TRANSFER_SHORTAGE_APPROVAL_REQUIRED/,
    );
    assert.equal(await transferStatus(db, t5), 'sent');
    assert.equal(await lossCount(db, t5), 0);

    console.log('transfer receipt shortage approval checks passed (8 cases)');
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
