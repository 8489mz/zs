/*
New file: backend/test/critical/final-issue-paired-movement.spec.ts
Pins F19 (trial problem 33, CRITICAL, 2026-11-21, test10k): a "صرف نهائي"
(final issue) must never lose stock.

THE GAP: permit ZTR-261121-2620 (12 pcs item 10 + 12 pcs item ب, 240.00 EGP)
was created "successfully" and marked "received", but it deducted from the
main warehouse (item 10 10810 -> 10798, item ب 144 -> 132) and NEVER
credited the van (van warehouse 0 items / 0.00; trip #8 0.00). The movements
log showed ONLY two OUT movements, NO IN movement. The old rep loads posted
PAIRED movements (van_load_out + van_load_in); "صرف نهائي" was one-sided:
24 units / 240.00 EGP were unaccounted for in any warehouse, and the
permit's delete control was disabled, so it could not be reversed from
the UI.

THE RULE (F19):
- a final_issue to a van_stock destination is REFUSED with the named
  error FINAL_ISSUE_TO_VAN_NOT_ALLOWED and posts NOTHING: vans load via
  the requisition/dispatch path, never via final issue.
- a final_issue to any other stock-holding location (a warehouse) is a
  MOVE, not a consumption: it posts PAIRED OUT + IN movements with equal
  qty and cost (source -qty, destination +qty), the company-wide total
  is unchanged, and NO expense journal is posted -- the goods still
  exist, in another warehouse.
- a final_issue with a branch destination and no location (the
  consumption sink) keeps the old behaviour: OUT only plus the Dr 6900 /
  Cr 1140 expense journal, and the company-wide total falls.
- a received final_issue can be REVERSED prospectively via
  reverseFinalIssue: the source is credited back at the frozen cost, a
  correcting journal flips the original expense journal's lines
  (Dr 1140 / Cr 6900) and links it via reversal_of_entry_id, the
  original journal rows are NEVER edited or deleted, the transfer is
  marked cancelled, and a second reversal is refused.

WHAT THIS PINS, driving the REAL createStockTransfer and
reverseFinalIssue on PGlite:
- (a) final_issue to a van_stock location is refused with
  FINAL_ISSUE_TO_VAN_NOT_ALLOWED; source qty unchanged, no movements,
  no journal.
- (b) final_issue to a warehouse posts paired transfer_send (-12) +
  transfer_receive (+12) at the same unit cost (10) and total (120);
  source 100 -> 88, destination 0 -> 12, global stays 100, no journal.
- (c) reversal of a received consumption final_issue credits the source
  back (88 -> 100, global 88 -> 100), posts a transfer_final_issue_
  reversal movement (+12 at cost 10), posts a correcting journal
  (Dr 1140 120 / Cr 6900 120) linked to the original via
  reversal_of_entry_id, stamps reversed_by_entry_id on the original,
  leaves the original lines untouched, marks the transfer cancelled,
  and refuses a second reversal with FINAL_ISSUE_ALREADY_REVERSED; a
  sent (non-final) transfer cannot be reversed at all.
- (d) final_issue to a branch destination still posts its expense
  journal (Dr 6900 120 / Cr 1140 120) and the global total falls
  100 -> 88, with no IN movement.
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

async function locationQty(db: Kysely<Database>, productId: number, locationId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = ${locationId}`.execute(db);
  return row.rows.length ? Number(row.rows[0].qty) : 0;
}

async function globalQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = ${productId}`.execute(db);
  return Number(row.rows[0].stock_qty);
}

async function transferStatus(db: Kysely<Database>, transferId: number): Promise<string> {
  const row = await sql<{ status: string }>`SELECT status FROM stock_transfers WHERE id = ${transferId}`.execute(db);
  return row.rows[0].status;
}

async function movements(db: Kysely<Database>, transferId: number, productId: number): Promise<Array<{ movement_type: string; qty: string; unit_cost: string | null; total_cost: string | null }>> {
  const rows = await sql<{ movement_type: string; qty: string; unit_cost: string | null; total_cost: string | null }>`SELECT movement_type, qty, unit_cost, total_cost FROM stock_movements WHERE reference_type = 'transfer' AND reference_id = ${transferId} AND product_id = ${productId} ORDER BY id ASC`.execute(db);
  return rows.rows;
}

async function journalCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries`.execute(db);
  return Number(row.rows[0].n);
}

async function journalLinesForMovement(db: Kysely<Database>, movementId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'inventory_adjustment' AND e.source_id = ${movementId} ORDER BY a.code`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function journalForMovement(db: Kysely<Database>, movementId: number): Promise<{ id: number; reversal_of_entry_id: number | null; reversed_by_entry_id: number | null }> {
  const row = await sql<{ id: number; reversal_of_entry_id: number | null; reversed_by_entry_id: number | null }>`SELECT id, reversal_of_entry_id, reversed_by_entry_id FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = ${movementId}`.execute(db);
  return { id: Number(row.rows[0].id), reversal_of_entry_id: row.rows[0].reversal_of_entry_id ? Number(row.rows[0].reversal_of_entry_id) : null, reversed_by_entry_id: row.rows[0].reversed_by_entry_id ? Number(row.rows[0].reversed_by_entry_id) : null };
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
      INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock'), (2, 't1', 'a1', 2, 'Dest Warehouse', 'DEST-WH', true, 'internal_warehouse'), (3, 't1', 'a1', NULL, 'Van 1', 'VAN1', true, 'van_stock');
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

    await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true)`.execute(db);

    // Case (a): final_issue to a van_stock destination is refused with the
    // named error and posts NOTHING.
    await seedProduct(db, 1, 100, 10);
    await assert.rejects(
      service.createStockTransfer({ fromLocationId: 1, toLocationId: 3, issueMode: 'final_issue', items: [{ productId: 1, qty: 12 }] } as never, AUTH),
      /FINAL_ISSUE_TO_VAN_NOT_ALLOWED/,
    );
    assert.equal(await locationQty(db, 1, 1), 100);
    assert.equal(await locationQty(db, 1, 3), 0);
    assert.equal(await globalQty(db, 1), 100);
    const movA = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = 1`.execute(db);
    assert.equal(Number(movA.rows[0].n), 0);
    assert.equal(await journalCount(db), 0);

    // Case (b): final_issue to a warehouse posts PAIRED OUT + IN with equal
    // qty and cost; the company-wide total is unchanged and no journal
    // is posted -- the goods still exist, in another warehouse.
    await seedProduct(db, 2, 100, 10);
    const resB = await service.createStockTransfer({ fromLocationId: 1, toLocationId: 2, issueMode: 'final_issue', items: [{ productId: 2, qty: 12 }] } as never, AUTH) as any;
    const tB = Number(resB.transferId);
    assert.equal(await transferStatus(db, tB), 'received');
    assert.equal(await locationQty(db, 2, 1), 88);
    assert.equal(await locationQty(db, 2, 2), 12);
    assert.equal(await globalQty(db, 2), 100);
    const movB = await movements(db, tB, 2);
    assert.equal(movB.length, 2);
    assert.equal(movB[0].movement_type, 'transfer_send');
    assert.equal(Number(movB[0].qty), -12);
    assert.equal(Number(movB[0].unit_cost), 10);
    assert.equal(Number(movB[0].total_cost), 120);
    assert.equal(movB[1].movement_type, 'transfer_receive');
    assert.equal(Number(movB[1].qty), 12);
    assert.equal(Number(movB[1].unit_cost), 10);
    assert.equal(Number(movB[1].total_cost), 120);
    assert.equal(await journalCount(db), 0);

    // Case (d): final_issue to a branch destination (the consumption
    // sink) keeps the old behaviour: OUT only, expense journal, and the
    // company-wide total falls.
    await seedProduct(db, 3, 100, 10);
    const resD = await service.createStockTransfer({ fromLocationId: 1, toBranchId: 1, issueMode: 'final_issue', items: [{ productId: 3, qty: 12 }] } as never, AUTH) as any;
    const tD = Number(resD.transferId);
    assert.equal(await transferStatus(db, tD), 'received');
    assert.equal(await locationQty(db, 3, 1), 88);
    assert.equal(await globalQty(db, 3), 88);
    const movD = await movements(db, tD, 3);
    assert.equal(movD.length, 1);
    assert.equal(movD[0].movement_type, 'transfer_final_issue');
    assert.equal(Number(movD[0].qty), -12);
    assert.equal(Number(movD[0].unit_cost), 10);
    assert.equal(Number(movD[0].total_cost), 120);
    const outD = await sql<{ id: number }>`SELECT id FROM stock_movements WHERE reference_type = 'transfer' AND reference_id = ${tD} AND movement_type = 'transfer_final_issue'`.execute(db);
    const outMovementId = Number(outD.rows[0].id);
    assert.deepEqual(await journalLinesForMovement(db, outMovementId), [
      { code: '1140', debit: 0, credit: 120 },
      { code: '6900', debit: 120, credit: 0 },
    ]);
    const originalJournal = await journalForMovement(db, outMovementId);

    // Case (c): reversing that received final_issue credits the source
    // back, posts a correcting journal that flips the original lines,
    // never touches the original rows, marks the transfer cancelled,
    // and refuses a second reversal. A sent transfer cannot be
    // reversed at all.
    await seedProduct(db, 4, 100, 10);
    const resSent = await service.createStockTransfer({ fromLocationId: 1, toLocationId: 2, items: [{ productId: 4, qty: 5 }] } as never, AUTH) as any;
    const tSent = Number(resSent.transferId);
    assert.equal(await transferStatus(db, tSent), 'sent');
    await assert.rejects(
      (service as any).reverseFinalIssue(tSent, AUTH),
      /FINAL_ISSUE_REVERSAL_STATUS_INVALID/,
    );
    await (service as any).reverseFinalIssue(tD, AUTH);
    assert.equal(await locationQty(db, 3, 1), 100);
    assert.equal(await globalQty(db, 3), 100);
    const movR = await movements(db, tD, 3);
    assert.equal(movR.length, 2);
    assert.equal(movR[1].movement_type, 'transfer_final_issue_reversal');
    assert.equal(Number(movR[1].qty), 12);
    assert.equal(Number(movR[1].unit_cost), 10);
    assert.equal(Number(movR[1].total_cost), 120);
    const revD = await sql<{ id: number }>`SELECT id FROM stock_movements WHERE reference_type = 'transfer' AND reference_id = ${tD} AND movement_type = 'transfer_final_issue_reversal'`.execute(db);
    const reversalMovementId = Number(revD.rows[0].id);
    assert.deepEqual(await journalLinesForMovement(db, reversalMovementId), [
      { code: '1140', debit: 120, credit: 0 },
      { code: '6900', debit: 0, credit: 120 },
    ]);
    const correctingJournal = await journalForMovement(db, reversalMovementId);
    assert.equal(correctingJournal.reversal_of_entry_id, originalJournal.id);
    const originalAfter = await journalForMovement(db, outMovementId);
    assert.equal(originalAfter.reversed_by_entry_id, correctingJournal.id);
    assert.deepEqual(await journalLinesForMovement(db, outMovementId), [
      { code: '1140', debit: 0, credit: 120 },
      { code: '6900', debit: 120, credit: 0 },
    ]);
    assert.equal(await transferStatus(db, tD), 'cancelled');
    await assert.rejects(
      (service as any).reverseFinalIssue(tD, AUTH),
      /FINAL_ISSUE_ALREADY_REVERSED/,
    );

    console.log('final issue paired movement checks passed');
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
