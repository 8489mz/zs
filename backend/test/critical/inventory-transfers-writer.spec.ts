/*
New file: backend/test/critical/inventory-transfers-writer.spec.ts
Pins Phase 1 A6 (INV-PHASE1-A6-TRANSFERS-WRITER): the 15 inventory-transfer
sites (inventory-transfer.service.ts:298/:328/:336/:515/:521/:563/:656/:661/
:726/:855/:860/:932/:942/:1035/:1040) now write their movement rows through
A0/A5's recordStockMovement instead of hand-writing insertInto rows next to
an applyStockDelta call. The migration is mechanical by construction: the
writer runs the SAME delta (same scope, same skipGlobalUpdate /
disableAutoDrain flags) and stamps before/after from the SAME ledger return,
so every row keeps its movement_type, reference, reason, note, branch,
location and cost — and the totals it computes equal the old expressions
(roundMoney(|delta| * unitCost) == roundMoney(qty * unitCost) for the
positive qtys; roundMoney(shortfall * unitCost) for the shrinkage leg;
roundMoney(qty * unitCost) == roundMoney(out.total_cost) for the reversal,
by idempotence of the book rounder at fixed digits).

THE ONE data-shape change (pinned explicitly in block 1): the 10 rows that
carried NO cost today (unit_cost/total_cost NULL) now store the writer's
canonical 0/0. Aggregates are unaffected (SUM ignores NULL and sums 0 the
same); the only reader of a transfer row's unit_cost is the shrinkage leg,
which reads transfer_send rows only — cost-carrying, unchanged.

WHAT THIS PINS, driving the REAL InventoryTransferService on PGlite:
- create sent: send row (frozen cost_price, total) + transit-in row
  (unit_cost 0, total_cost 0); balances exact; global untouched.
- final issue to a warehouse: paired send + receive legs, equal qty and
  cost, global unchanged, NO journal (goods still exist).
- final issue to a branch sink: transfer_final_issue row + the expense
  journal (Dr 6900 / Cr 1140) posted against the movement id the writer
  returns — the journal call is the proof the movementId flows through.
- full receipt: transit-out + receive rows, no shrinkage row.
- shortfall receipt: shrinkage valued at the FROZEN dispatch cost (unit 10,
  total 20 after cost_price moved to 25) + its journal (Dr 5300 / Cr 1140).
- cancel: transit-cancel + cancel rows, balances fully restored.
- reverse final issue: reversal row equals the original frozen total +
  the flipped journal linked by reversal_of_entry_id; second reversal
  refused; a sent transfer cannot be reversed.
- transferCategory / internalTransferProducts / internalTransferCategory:
  send + receive rows through the writer, balances moved exactly.
- unassigned link (fromLocationId -1): exactly ONE stock_assign row
  (reference location_assign, reference_id = the destination location),
  no send row — the unassigned deduct stays a row-less delta by design.
- rollback: a create whose second item is short rejects and leaves NO
  rows and NO transfer header (the whole transaction rolls back).
- source pins: zero direct insertInto('stock_movements') lines left in the
  service, 15 recordStockMovement call sites; wiring 358.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
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
import { InventoryTransferService } from '../../src/modules/inventory/services/inventory-transfer.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: ['canAdjustInventory'],
} as unknown as AuthContext;
const REASON = 'Two units lost in transit';
const APPROVER_PASSWORD = 'approver-password';

type MovementRow = {
  id: number;
  movement_type: string;
  qty: string;
  before_qty: string;
  after_qty: string;
  reason: string;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  unit_cost: string | null;
  total_cost: string | null;
  created_by: number | null;
  import_receipt_id: number | null;
};

async function seedProduct(
  db: Kysely<Database>,
  id: number,
  qty: number,
  cost: number,
  categoryId: number | null = null,
): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials, category_id) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false, ${categoryId})`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(
    db,
  );
}

async function seedUnassigned(db: Kysely<Database>, id: number, qty: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials, category_id) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false, null)`.execute(
    db,
  );
}

async function makeTransfer(
  service: InventoryTransferService,
  items: Array<{ productId: number; qty: number }>,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const res = await service.createStockTransfer({ fromLocationId: 1, toLocationId: 2, items, ...extra } as never, AUTH);
  return Number(res.transferId);
}

async function transferItemId(db: Kysely<Database>, transferId: number, productId: number): Promise<number> {
  const row = await sql<{
    id: number;
  }>`SELECT id FROM stock_transfer_items WHERE transfer_id = ${transferId} AND product_id = ${productId}`.execute(db);
  return Number(row.rows[0].id);
}

async function transferStatus(db: Kysely<Database>, transferId: number): Promise<string> {
  const row = await sql<{ status: string }>`SELECT status FROM stock_transfers WHERE id = ${transferId}`.execute(db);
  return row.rows[0].status;
}

async function transferCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM stock_transfers`.execute(db);
  return Number(row.rows[0].n);
}

async function locationQty(db: Kysely<Database>, productId: number, locationId: number): Promise<number> {
  const row = await sql<{
    qty: string | null;
  }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = ${locationId}`.execute(
    db,
  );
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function transitQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{
    qty: string;
  }>`SELECT b.qty FROM product_location_stock b JOIN stock_locations l ON l.id = b.location_id WHERE b.product_id = ${productId} AND l.location_type = 'in_transit'`.execute(
    db,
  );
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function transitLocationId(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ id: number }>`SELECT id FROM stock_locations WHERE location_type = 'in_transit'`.execute(db);
  return Number(row.rows[0].id);
}

async function globalQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = ${productId}`.execute(db);
  return Number(row.rows[0].stock_qty);
}

async function movementsFor(db: Kysely<Database>, transferId: number, productId: number): Promise<MovementRow[]> {
  const rows =
    await sql<MovementRow>`SELECT id, movement_type, qty, before_qty, after_qty, reason, note, reference_type, reference_id, branch_id, location_id, unit_cost, total_cost, created_by, import_receipt_id FROM stock_movements WHERE reference_type = 'transfer' AND reference_id = ${transferId} AND product_id = ${productId} ORDER BY id ASC`.execute(
      db,
    );
  return rows.rows;
}

async function productMovements(db: Kysely<Database>, productId: number): Promise<MovementRow[]> {
  const rows =
    await sql<MovementRow>`SELECT id, movement_type, qty, before_qty, after_qty, reason, note, reference_type, reference_id, branch_id, location_id, unit_cost, total_cost, created_by, import_receipt_id FROM stock_movements WHERE product_id = ${productId} ORDER BY id ASC`.execute(
      db,
    );
  return rows.rows;
}

async function journalLinesForMovement(
  db: Kysely<Database>,
  movementId: number,
): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{
    code: string;
    debit: string;
    credit: string;
  }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'inventory_adjustment' AND e.source_id = ${movementId} ORDER BY a.code`.execute(
    db,
  );
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function journalForMovement(
  db: Kysely<Database>,
  movementId: number,
): Promise<{ id: number; reversal_of_entry_id: number | null; reversed_by_entry_id: number | null }> {
  const row = await sql<{
    id: number;
    reversal_of_entry_id: number | null;
    reversed_by_entry_id: number | null;
  }>`SELECT id, reversal_of_entry_id, reversed_by_entry_id FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = ${movementId}`.execute(
    db,
  );
  return {
    id: Number(row.rows[0].id),
    reversal_of_entry_id: row.rows[0].reversal_of_entry_id ? Number(row.rows[0].reversal_of_entry_id) : null,
    reversed_by_entry_id: row.rows[0].reversed_by_entry_id ? Number(row.rows[0].reversed_by_entry_id) : null,
  };
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
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
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, category_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_transfers (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, from_location_id bigint, to_location_id bigint, from_branch_id bigint, to_branch_id bigint, status text, note text, recipient_name text, created_by bigint, received_by bigint, received_at timestamptz, cancelled_by bigint, cancelled_at timestamptz, has_transit_variance boolean, transit_variance_journal_entry_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE stock_transfer_items (id bigserial PRIMARY KEY, transfer_id bigint, tenant_id text, account_id text, product_id bigint, product_name text, qty numeric, dispatched_qty numeric, received_qty numeric, variance_qty numeric, variance_reason text, serial_tracking text, batch_tracking text);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, branch_id bigint, location_id bigint, cost_price numeric, purchase_id bigint, purchase_item_id bigint, sale_id bigint, sale_item_id bigint, warranty_end_date date, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
      CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
      CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
      SELECT setval(pg_get_serial_sequence('stock_locations', 'id'), 100);
      SELECT setval(pg_get_serial_sequence('stock_transfers', 'id'), 100);
    `);

    // Receiver (user 1, the AUTH user) and a different approver (user 2);
    // the approver's bcrypt password is the approval secret for shortfall
    // receipts (INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL).
    const approverRecord = await createPasswordRecord(APPROVER_PASSWORD);
    await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true)`.execute(db);
    await sql`INSERT INTO users VALUES (2, 't1', 'approver', 1, 'admin', ${approverRecord.hash}, ${approverRecord.salt}, true)`.execute(
      db,
    );

    // 1. Create sent: send row (frozen cost) + transit-in row (canonical
    // 0/0 cost — the writer never leaves a cost NULL); balances exact.
    await seedProduct(db, 1, 100, 10);
    const t1 = await makeTransfer(service, [{ productId: 1, qty: 10 }]);
    assert.equal(await transferStatus(db, t1), 'sent');
    const mov1 = await movementsFor(db, t1, 1);
    assert.equal(mov1.length, 2);
    assert.equal(mov1[0].movement_type, 'transfer_send');
    assert.equal(Number(mov1[0].qty), -10);
    assert.equal(Number(mov1[0].before_qty), 100);
    assert.equal(Number(mov1[0].after_qty), 90);
    assert.equal(mov1[0].reason, 'transfer_send');
    assert.equal(mov1[0].note, `Sent transfer TR-${t1}`);
    assert.equal(mov1[0].reference_type, 'transfer');
    assert.equal(mov1[0].reference_id, t1);
    assert.equal(mov1[0].branch_id, 1);
    assert.equal(mov1[0].location_id, 1);
    assert.equal(Number(mov1[0].unit_cost), 10);
    assert.equal(Number(mov1[0].total_cost), 100);
    assert.equal(mov1[0].created_by, 1);
    assert.equal(mov1[0].import_receipt_id, null);
    assert.equal(mov1[1].movement_type, 'transfer_transit_in');
    assert.equal(Number(mov1[1].qty), 10);
    assert.equal(Number(mov1[1].before_qty), 0);
    assert.equal(Number(mov1[1].after_qty), 10);
    assert.equal(mov1[1].reason, 'transfer_send');
    assert.equal(mov1[1].note, `In-transit for TR-${t1}`);
    assert.equal(mov1[1].branch_id, null);
    assert.equal(mov1[1].location_id, await transitLocationId(db));
    // The writer stores the canonical 0/0 for a costless row; the old
    // hand-written row left unit_cost/total_cost NULL (notEqual, not
    // Number() — Number(null) is 0 and would hide the difference).
    assert.notEqual(mov1[1].unit_cost, null);
    assert.equal(Number(mov1[1].unit_cost), 0);
    assert.notEqual(mov1[1].total_cost, null);
    assert.equal(Number(mov1[1].total_cost), 0);
    assert.equal(await locationQty(db, 1, 1), 90);
    assert.equal(await transitQty(db, 1), 10);
    assert.equal(await globalQty(db, 1), 100);
    console.log('  block 1 (create sent) passed');

    // 2. Final issue to a warehouse: paired send + receive legs, equal qty
    // and cost, global unchanged, NO journal (goods still exist).
    await seedProduct(db, 2, 100, 10);
    const t2 = await makeTransfer(service, [{ productId: 2, qty: 12 }], { issueMode: 'final_issue' });
    assert.equal(await transferStatus(db, t2), 'received');
    const mov2 = await movementsFor(db, t2, 2);
    assert.equal(mov2.length, 2);
    assert.equal(mov2[0].movement_type, 'transfer_send');
    assert.equal(Number(mov2[0].qty), -12);
    assert.equal(Number(mov2[0].before_qty), 100);
    assert.equal(Number(mov2[0].after_qty), 88);
    assert.equal(mov2[0].reason, 'transfer_send');
    assert.equal(Number(mov2[0].unit_cost), 10);
    assert.equal(Number(mov2[0].total_cost), 120);
    assert.equal(mov2[1].movement_type, 'transfer_receive');
    assert.equal(Number(mov2[1].qty), 12);
    assert.equal(Number(mov2[1].before_qty), 0);
    assert.equal(Number(mov2[1].after_qty), 12);
    assert.equal(mov2[1].reason, 'final_issue');
    assert.equal(Number(mov2[1].unit_cost), 10);
    assert.equal(Number(mov2[1].total_cost), 120);
    assert.equal(mov2[1].branch_id, 2);
    assert.equal(mov2[1].location_id, 2);
    assert.equal(await locationQty(db, 2, 1), 88);
    assert.equal(await locationQty(db, 2, 2), 12);
    assert.equal(await globalQty(db, 2), 100);
    const journals2 = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries`.execute(db);
    assert.equal(Number(journals2.rows[0].n), 0);
    console.log('  block 2 (final issue to warehouse) passed');

    // 3. Final issue to a branch sink: transfer_final_issue row + the
    // expense journal posted against the movement id the writer returns.
    await seedProduct(db, 3, 100, 10);
    const t3 = await makeTransfer(service, [{ productId: 3, qty: 12 }], {
      issueMode: 'final_issue',
      toLocationId: null,
      toBranchId: 1,
    });
    assert.equal(await transferStatus(db, t3), 'received');
    const mov3 = await movementsFor(db, t3, 3);
    assert.equal(mov3.length, 1);
    assert.equal(mov3[0].movement_type, 'transfer_final_issue');
    assert.equal(Number(mov3[0].qty), -12);
    assert.equal(Number(mov3[0].before_qty), 100);
    assert.equal(Number(mov3[0].after_qty), 88);
    assert.equal(mov3[0].reason, 'final_issue');
    assert.equal(Number(mov3[0].unit_cost), 10);
    assert.equal(Number(mov3[0].total_cost), 120);
    assert.deepEqual(await journalLinesForMovement(db, mov3[0].id), [
      { code: '1140', debit: 0, credit: 120 },
      { code: '6900', debit: 120, credit: 0 },
    ]);
    assert.equal(await locationQty(db, 3, 1), 88);
    assert.equal(await globalQty(db, 3), 88);
    console.log('  block 3 (final issue to sink + journal) passed');

    // 4. Full receipt: transit-out + receive rows, no shrinkage row.
    await seedProduct(db, 4, 100, 10);
    const t4 = await makeTransfer(service, [{ productId: 4, qty: 10 }]);
    const t4item = await transferItemId(db, t4, 4);
    await service.receiveStockTransfer(t4, AUTH, { items: [{ itemId: t4item, receivedQty: 10 }] } as never);
    assert.equal(await transferStatus(db, t4), 'received');
    const mov4 = await movementsFor(db, t4, 4);
    assert.equal(mov4.length, 4);
    assert.equal(mov4[2].movement_type, 'transfer_transit_out');
    assert.equal(Number(mov4[2].qty), -10);
    assert.equal(mov4[2].reason, 'transfer_receive');
    assert.notEqual(mov4[2].unit_cost, null);
    assert.equal(Number(mov4[2].unit_cost), 0);
    assert.notEqual(mov4[2].total_cost, null);
    assert.equal(Number(mov4[2].total_cost), 0);
    assert.equal(mov4[3].movement_type, 'transfer_receive');
    assert.equal(Number(mov4[3].qty), 10);
    assert.equal(Number(mov4[3].before_qty), 0);
    assert.equal(Number(mov4[3].after_qty), 10);
    assert.equal(mov4[3].reason, 'transfer_receive');
    assert.equal(mov4[3].branch_id, 2);
    assert.equal(mov4[3].location_id, 2);
    assert.notEqual(mov4[3].unit_cost, null);
    assert.equal(Number(mov4[3].unit_cost), 0);
    assert.notEqual(mov4[3].total_cost, null);
    assert.equal(Number(mov4[3].total_cost), 0);
    assert.equal(await locationQty(db, 4, 1), 90);
    assert.equal(await transitQty(db, 4), 0);
    assert.equal(await locationQty(db, 4, 2), 10);
    assert.equal(await globalQty(db, 4), 100);
    console.log('  block 4 (full receipt) passed');

    // 5. Shortfall receipt: shrinkage valued at the FROZEN dispatch cost
    // (unit 10, total 20) even after cost_price moved to 25, + journal.
    await seedProduct(db, 5, 100, 10);
    const t5 = await makeTransfer(service, [{ productId: 5, qty: 10 }]);
    await sql`UPDATE products SET cost_price = 25 WHERE id = 5`.execute(db);
    const t5item = await transferItemId(db, t5, 5);
    await service.receiveStockTransfer(t5, AUTH, {
      items: [{ itemId: t5item, receivedQty: 8 }],
      varianceReason: REASON,
      approvalSecret: APPROVER_PASSWORD,
    } as never);
    assert.equal(await transferStatus(db, t5), 'received');
    const mov5 = await movementsFor(db, t5, 5);
    assert.equal(mov5.length, 5);
    const loss5 = mov5.find((m) => m.movement_type === 'transfer_transit_loss')!;
    assert.equal(Number(loss5.qty), -2);
    assert.equal(Number(loss5.before_qty), 2);
    assert.equal(Number(loss5.after_qty), 0);
    assert.equal(loss5.reason, 'transit_shrinkage');
    assert.equal(Number(loss5.unit_cost), 10);
    assert.equal(Number(loss5.total_cost), 20);
    assert.deepEqual(await journalLinesForMovement(db, loss5.id), [
      { code: '1140', debit: 0, credit: 20 },
      { code: '5300', debit: 20, credit: 0 },
    ]);
    assert.equal(await locationQty(db, 5, 1), 90);
    assert.equal(await transitQty(db, 5), 0);
    assert.equal(await locationQty(db, 5, 2), 8);
    assert.equal(await globalQty(db, 5), 98);
    console.log('  block 5 (shortfall at frozen cost) passed');

    // 6. Cancel: transit-cancel + cancel rows, balances fully restored.
    await seedProduct(db, 6, 100, 10);
    const t6 = await makeTransfer(service, [{ productId: 6, qty: 10 }]);
    await service.cancelStockTransfer(t6, AUTH);
    assert.equal(await transferStatus(db, t6), 'cancelled');
    const mov6 = await movementsFor(db, t6, 6);
    assert.equal(mov6.length, 4);
    assert.equal(mov6[2].movement_type, 'transfer_transit_cancel');
    assert.equal(Number(mov6[2].qty), -10);
    assert.equal(Number(mov6[2].before_qty), 10);
    assert.equal(Number(mov6[2].after_qty), 0);
    assert.equal(mov6[2].reason, 'transfer_cancel');
    assert.equal(mov6[3].movement_type, 'transfer_cancel');
    assert.equal(Number(mov6[3].qty), 10);
    assert.equal(Number(mov6[3].before_qty), 90);
    assert.equal(Number(mov6[3].after_qty), 100);
    assert.equal(mov6[3].reason, 'transfer_cancel');
    assert.equal(mov6[3].branch_id, 1);
    assert.equal(mov6[3].location_id, 1);
    assert.equal(await locationQty(db, 6, 1), 100);
    assert.equal(await transitQty(db, 6), 0);
    assert.equal(await globalQty(db, 6), 100);
    console.log('  block 6 (cancel) passed');

    // 7. Reverse a received final issue: reversal row equals the original
    // frozen total, the flipped journal links back, second reversal refused.
    await seedProduct(db, 7, 100, 10);
    const t7 = await makeTransfer(service, [{ productId: 7, qty: 12 }], {
      issueMode: 'final_issue',
      toLocationId: null,
      toBranchId: 1,
    });
    const mov7out = (await movementsFor(db, t7, 7))[0];
    const originalJournal = await journalForMovement(db, mov7out.id);
    await service.reverseFinalIssue(t7, AUTH);
    assert.equal(await transferStatus(db, t7), 'cancelled');
    const mov7 = await movementsFor(db, t7, 7);
    assert.equal(mov7.length, 2);
    assert.equal(mov7[1].movement_type, 'transfer_final_issue_reversal');
    assert.equal(Number(mov7[1].qty), 12);
    assert.equal(Number(mov7[1].before_qty), 88);
    assert.equal(Number(mov7[1].after_qty), 100);
    assert.equal(mov7[1].reason, 'final_issue_reversal');
    assert.equal(Number(mov7[1].unit_cost), 10);
    assert.equal(Number(mov7[1].total_cost), 120);
    assert.equal(Number(mov7[1].total_cost), Number(mov7out.total_cost));
    assert.deepEqual(await journalLinesForMovement(db, mov7[1].id), [
      { code: '1140', debit: 120, credit: 0 },
      { code: '6900', debit: 0, credit: 120 },
    ]);
    const correctingJournal = await journalForMovement(db, mov7[1].id);
    assert.equal(correctingJournal.reversal_of_entry_id, originalJournal.id);
    assert.equal(await locationQty(db, 7, 1), 100);
    assert.equal(await globalQty(db, 7), 100);
    await assert.rejects(service.reverseFinalIssue(t7, AUTH), /FINAL_ISSUE_ALREADY_REVERSED/);
    console.log('  block 7 (reverse final issue) passed');

    // 8. transferCategory: the whole category stock moves, send + receive
    // rows through the writer, balances exact.
    await seedProduct(db, 8, 40, 10, 77);
    await service.transferCategory({ categoryId: 77, fromLocationId: 1, toLocationId: 2 }, AUTH);
    const mov8 = await productMovements(db, 8);
    assert.equal(mov8.length, 2);
    assert.equal(mov8[0].movement_type, 'transfer_send');
    assert.equal(Number(mov8[0].qty), -40);
    assert.equal(Number(mov8[0].before_qty), 40);
    assert.equal(Number(mov8[0].after_qty), 0);
    assert.equal(mov8[0].reason, 'transfer_send');
    assert.equal(mov8[1].movement_type, 'transfer_receive');
    assert.equal(Number(mov8[1].qty), 40);
    assert.equal(Number(mov8[1].before_qty), 0);
    assert.equal(Number(mov8[1].after_qty), 40);
    assert.equal(mov8[1].reason, 'transfer_receive');
    assert.equal(await locationQty(db, 8, 1), 0);
    assert.equal(await locationQty(db, 8, 2), 40);
    assert.equal(await globalQty(db, 8), 40);
    console.log('  block 8 (transferCategory) passed');

    // 9. internalTransferProducts: send + receive rows, balances moved.
    await seedProduct(db, 9, 100, 10);
    await service.internalTransferProducts(
      { items: [{ productId: 9, qty: 15 }], fromLocationId: 1, toLocationId: 2 },
      AUTH,
    );
    const mov9 = await productMovements(db, 9);
    assert.equal(mov9.length, 2);
    assert.equal(mov9[0].movement_type, 'transfer_send');
    assert.equal(Number(mov9[0].qty), -15);
    assert.equal(mov9[0].reason, 'internal_transfer');
    assert.equal(mov9[1].movement_type, 'transfer_receive');
    assert.equal(Number(mov9[1].qty), 15);
    assert.equal(Number(mov9[1].before_qty), 0);
    assert.equal(Number(mov9[1].after_qty), 15);
    assert.equal(mov9[1].reason, 'internal_transfer');
    assert.equal(await locationQty(db, 9, 1), 85);
    assert.equal(await locationQty(db, 9, 2), 15);
    assert.equal(await globalQty(db, 9), 100);
    console.log('  block 9 (internalTransferProducts) passed');

    // 10. Unassigned link (fromLocationId -1): exactly ONE stock_assign row
    // (reference location_assign, reference_id = the destination location);
    // the unassigned deduct stays a row-less delta by design.
    await seedUnassigned(db, 10, 100, 10);
    await service.internalTransferProducts(
      { items: [{ productId: 10, qty: 10 }], fromLocationId: -1, toLocationId: 2 },
      AUTH,
    );
    const mov10 = await productMovements(db, 10);
    assert.equal(mov10.length, 1);
    assert.equal(mov10[0].movement_type, 'stock_assign');
    assert.equal(Number(mov10[0].qty), 10);
    assert.equal(Number(mov10[0].before_qty), 0);
    assert.equal(Number(mov10[0].after_qty), 10);
    assert.equal(mov10[0].reason, 'unassigned_stock_link');
    assert.equal(mov10[0].reference_type, 'location_assign');
    assert.equal(mov10[0].reference_id, 2);
    assert.equal(mov10[0].branch_id, 2);
    assert.equal(mov10[0].location_id, 2);
    assert.equal(await locationQty(db, 10, 2), 10);
    assert.equal(await globalQty(db, 10), 100);
    console.log('  block 10 (unassigned link) passed');

    // 11. internalTransferCategory: send + receive rows, balances moved.
    await seedProduct(db, 11, 25, 10, 78);
    await service.internalTransferCategory({ categoryId: 78, fromLocationId: 1, toLocationId: 2 }, AUTH);
    const mov11 = await productMovements(db, 11);
    assert.equal(mov11.length, 2);
    assert.equal(mov11[0].movement_type, 'transfer_send');
    assert.equal(Number(mov11[0].qty), -25);
    assert.equal(mov11[0].reason, 'internal_transfer');
    assert.equal(mov11[1].movement_type, 'transfer_receive');
    assert.equal(Number(mov11[1].qty), 25);
    assert.equal(mov11[1].reason, 'internal_transfer');
    assert.equal(await locationQty(db, 11, 1), 0);
    assert.equal(await locationQty(db, 11, 2), 25);
    assert.equal(await globalQty(db, 11), 25);
    console.log('  block 11 (internalTransferCategory) passed');

    // 12. Rollback: a create whose second item is short rejects and leaves
    // NO rows and NO transfer header — the whole transaction rolls back.
    await seedProduct(db, 12, 100, 10);
    await seedProduct(db, 13, 5, 10);
    const transfersBefore = await transferCount(db);
    await assert.rejects(
      service.createStockTransfer(
        {
          fromLocationId: 1,
          toLocationId: 2,
          items: [
            { productId: 12, qty: 10 },
            { productId: 13, qty: 10 },
          ],
        } as never,
        AUTH,
      ),
      /INSUFFICIENT_LOCATION_STOCK/,
    );
    assert.equal(await transferCount(db), transfersBefore);
    const mov12 = await productMovements(db, 12);
    const mov13 = await productMovements(db, 13);
    assert.equal(mov12.length, 0);
    assert.equal(mov13.length, 0);
    assert.equal(await locationQty(db, 12, 1), 100);
    assert.equal(await locationQty(db, 13, 1), 5);
    assert.equal(await globalQty(db, 12), 100);
    assert.equal(await globalQty(db, 13), 5);
    console.log('  block 12 (rollback) passed');

    // 13. Source pins: no direct stock_movements insert left in the
    // transfer service; exactly 15 writer call sites (one per migrated
    // row); wiring 358 in both critical lists, identical order.
    const serviceSrc = fs.readFileSync(
      resolve(__dirname, '../../src/modules/inventory/services/inventory-transfer.service.ts'),
      'utf8',
    );
    const directInserts = serviceSrc.split('\n').filter((line) => line.includes("insertInto('stock_movements')"));
    assert.equal(directInserts.length, 0, `direct inserts left: ${directInserts.join(' | ')}`);
    const writerCalls = serviceSrc.split('\n').filter((line) => /await recordStockMovement\(/.test(line));
    assert.equal(writerCalls.length, 15, `writer call sites: ${writerCalls.length}, expected 15`);
    assert.ok(
      serviceSrc.includes("import { recordStockMovement } from '../../../common/utils/stock-movement-writer'"),
      'service imports the writer',
    );
    assert.ok(!serviceSrc.includes('roundMoney'), 'no per-site total computation left');
    {
      const specs = JSON.parse(fs.readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 409);
      assert.equal(chain.length, 409);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/inventory-transfers-writer.spec.ts'));
      assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s3-money-precision-hr-import.spec.ts');
      console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
    }
    console.log('  block 13 (source pins + wiring) passed');

    console.log('inventory transfers writer checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
