/*
New file: backend/test/critical/stock-count-count-basis.spec.ts
Pins the stock-count book-quantity basis (INV-STOCK-COUNT-ADJUSTMENT).

THE GAP: a count session froze its book quantity on the AVAILABLE
basis (previewAssignedLocationStockQty: location qty net of
reservations, capped by the global counter). A unit reserved for a
store order is physically on the shelf, so the session displayed a
book quantity one short of the physical stock and a phantom
surplus: counted 12 against book 11, variance +1, financial effect
+58.82 -- while the posting (setScopedStockQty, actual delta) moved
nothing and booked no journal, and the UI still toasted "approved,
posted and settled". The displayed basis and the posted basis
disagreed, and a pure reservation change after the count also made
the item "moved", deferring it for a recount it never needed. The
same defect hid a real shortage: counted 11 against book 11 is a
zero variance, so a genuinely missing unit posted nothing at all.

THE RULE (countedQty = physical on-hand, reservations included,
decided 2026-10-31, INV-STOCK-COUNT-ACTUAL-DELTA): the count basis
is the physical on-hand quantity at the counted location -- the raw
scoped qty capped by the raw global counter, reservations never
deducted. The freeze (create), the refresh (recount), the approval
staleness check and the moved-stock skip all judge on that one
basis, so the displayed book quantity, the frozen variance and the
posted delta can never disagree again. Reserving or releasing a
unit is not a stock movement: it neither demands approval nor
defers an item. A genuinely moved item is still skipped, and a
real surplus/shortage still posts a balanced journal at the actual
delta times cost.

WHAT THIS PINS, driving the REAL create/recount/post on PGlite:
- the reported case (12 on hand / 1 reserved / cost 58.82, counted
  12): the session freezes book 12, variance 0; posting creates no
  journal, leaves stock at 12 and records a zero movement.
- a real surplus (same fixture, counted 13): book 12, variance +1,
  movement +1 (12 -> 13), balanced journal Dr 1140 / Cr 7100 of
  58.82.
- a real shortage (same fixture, counted 11): book 12, variance -1,
  movement -1, balanced journal Dr 5200 / Cr 1140 of 58.82.
- a moved item is still skipped: counted 12, then physical stock
  moves to 13; posting defers the item, the session stays draft,
  and after a recount to 13 it posts and the session becomes posted.
- a reservation-only change does not defer: counted 12, then
  reserved 1 -> 2 with qty untouched; posting completes the item
  and the session, stock stays 12.
- no-reservation regression: 10 on hand, counted 10 -> book 10,
  variance 0, no journal.
- a pre-fix draft still completes: a session frozen on the old
  available basis (book 11 for 12 on hand / 1 reserved) posts
  instead of stalling -- the staleness check accepts either basis,
  because a stored row carries no basis marker and a real physical
  move changes both. A recount re-freezes it on the on-hand basis.
- source pin: the count service freezes and refreshes on the
  on-hand preview, and the ledger defines it.
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
const APPROVER_PASSWORD = 'approver-pass';

async function seedProduct(db: Kysely<Database>, id: number, globalQty: number, reserved: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${globalQty}, ${reserved}, ${cost}, true, false)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${globalQty}, ${reserved})`.execute(db);
}

async function createSession(service: InventoryCountService, productId: number, countedQty: number): Promise<number> {
  const created = await service.createStockCountSession(
    { locationId: 1, branchId: 1, items: [{ productId, countedQty, reason: 'count' }] } as never,
    AUTH,
  ) as Record<string, unknown>;
  return Number(created.sessionId);
}

async function seedSession(db: Kysely<Database>, sessionId: number, productId: number, expected: number, counted: number): Promise<number> {
  await sql`INSERT INTO stock_count_sessions (id, tenant_id, account_id, doc_no, branch_id, location_id, status, note, counted_by, created_at, updated_at) VALUES (${sessionId}, 't1', 'a1', ${`ZSC-${sessionId}`}, 1, 1, 'draft', '', 1, NOW(), NOW())`.execute(db);
  const item = await sql<{ id: number }>`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES ('t1', 'a1', ${sessionId}, ${productId}, ${`Product ${productId}`}, ${expected}, ${counted}, ${Number((counted - expected).toFixed(3))}, 'count', '', null, null) RETURNING id`.execute(db);
  return Number(item.rows[0].id);
}

async function itemRow(db: Kysely<Database>, sessionId: number): Promise<{ id: number; expected_qty: string; counted_qty: string; variance_qty: string; posted_at: string | null }> {
  const row = await sql<{ id: number; expected_qty: string; counted_qty: string; variance_qty: string; posted_at: string | null }>`SELECT id, expected_qty, counted_qty, variance_qty, posted_at FROM stock_count_items WHERE session_id = ${sessionId}`.execute(db);
  return row.rows[0];
}

async function journalLines(db: Kysely<Database>, sourceId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'stock_count_chunk' AND e.source_id = ${sourceId} AND e.tenant_id = 't1' ORDER BY a.code`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function journalCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = 't1'`.execute(db);
  return Number(row.rows[0].n);
}

async function sessionStatus(db: Kysely<Database>, id: number): Promise<string> {
  const row = await sql<{ status: string }>`SELECT status FROM stock_count_sessions WHERE id = ${id}`.execute(db);
  return row.rows[0].status;
}

async function locationQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  return Number(row.rows[0].qty);
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
      CREATE TABLE stock_count_sessions (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, branch_id bigint, location_id bigint, status text, note text, counted_by bigint, approved_by bigint, posted_at timestamptz, created_at timestamptz, updated_at timestamptz);
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

    // INV-STOCK-COUNT-DUAL-APPROVAL: variance posts need approval by a
    // different admin than the counter (user 1) and the poster (AUTH,
    // user 1) — a second admin user with its own password.
    const approverRecord = await createPasswordRecord(APPROVER_PASSWORD);
    await sql`INSERT INTO users VALUES (2, 't1', 'approver', 1, 'admin', ${approverRecord.hash}, ${approverRecord.salt}, true)`.execute(db);

    // Case 1: the reported bug -- 12 on hand, 1 reserved, counted 12.
    // Old code froze book 11, variance +1, phantom effect +58.82, and
    // posted nothing while the UI claimed success.
    await seedProduct(db, 1, 12, 1, 58.82);
    const session1 = await createSession(service, 1, 12);
    const row1 = await itemRow(db, session1);
    assert.equal(Number(row1.expected_qty), 12);
    assert.equal(Number(row1.variance_qty), 0);
    await service.postStockCountSession(session1, AUTH, APPROVER_PASSWORD);
    assert.equal(await journalCount(db), 0);
    assert.equal(await locationQty(db, 1), 12);
    const mov1 = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = ${session1}`.execute(db);
    assert.equal(Number(mov1.rows[0].n), 0);
    assert.equal(await sessionStatus(db, session1), 'posted');

    // Case 2: a real surplus posts a balanced journal at the actual delta.
    await seedProduct(db, 2, 12, 1, 58.82);
    const session2 = await createSession(service, 2, 13);
    const row2 = await itemRow(db, session2);
    assert.equal(Number(row2.expected_qty), 12);
    assert.equal(Number(row2.variance_qty), 1);
    await service.postStockCountSession(session2, AUTH, APPROVER_PASSWORD);
    const mov2 = await sql<{ qty: string; before_qty: string; after_qty: string }>`SELECT qty, before_qty, after_qty FROM stock_movements WHERE reference_id = ${session2}`.execute(db);
    assert.equal(Number(mov2.rows[0].qty), 1);
    assert.equal(Number(mov2.rows[0].before_qty), 12);
    assert.equal(Number(mov2.rows[0].after_qty), 13);
    assert.deepEqual(await journalLines(db, row2.id), [
      { code: '1140', debit: 58.82, credit: 0 },
      { code: '7100', debit: 0, credit: 58.82 },
    ]);

    // Case 3: a real shortage posts a balanced journal. Old code froze
    // book 11, saw variance 0, and silently posted nothing while one
    // unit was genuinely missing.
    await seedProduct(db, 3, 12, 1, 58.82);
    const session3 = await createSession(service, 3, 11);
    const row3 = await itemRow(db, session3);
    assert.equal(Number(row3.expected_qty), 12);
    assert.equal(Number(row3.variance_qty), -1);
    await service.postStockCountSession(session3, AUTH, APPROVER_PASSWORD);
    const mov3 = await sql<{ qty: string; before_qty: string; after_qty: string }>`SELECT qty, before_qty, after_qty FROM stock_movements WHERE reference_id = ${session3}`.execute(db);
    assert.equal(Number(mov3.rows[0].qty), -1);
    assert.equal(Number(mov3.rows[0].before_qty), 12);
    assert.equal(Number(mov3.rows[0].after_qty), 11);
    assert.deepEqual(await journalLines(db, row3.id), [
      { code: '1140', debit: 0, credit: 58.82 },
      { code: '5200', debit: 58.82, credit: 0 },
    ]);

    // Case 4: an item whose physical stock moved since the count is
    // still skipped, then posts after a standalone recount.
    await seedProduct(db, 4, 12, 0, 58.82);
    const session4 = await createSession(service, 4, 12);
    const row4 = await itemRow(db, session4);
    assert.equal(Number(row4.expected_qty), 12);
    await sql`UPDATE product_location_stock SET qty = 13 WHERE product_id = 4 AND location_id = 1`.execute(db);
    await sql`UPDATE products SET stock_qty = 13 WHERE id = 4`.execute(db);
    const deferred = await service.postStockCountSession(session4, AUTH, APPROVER_PASSWORD) as Record<string, unknown>;
    assert.deepEqual(deferred.skippedStockCountItemIds, [row4.id]);
    assert.equal((await itemRow(db, session4)).posted_at, null);
    assert.equal(await sessionStatus(db, session4), 'draft');
    await service.recountPendingStockCountItem(session4, row4.id, { reason: 'recounted after stock moved', countedQty: 13 } as never, AUTH);
    const row4b = await itemRow(db, session4);
    assert.equal(Number(row4b.expected_qty), 13);
    assert.equal(Number(row4b.variance_qty), 0);
    await service.postStockCountSession(session4, AUTH, APPROVER_PASSWORD);
    assert.notEqual((await itemRow(db, session4)).posted_at, null);
    assert.equal(await sessionStatus(db, session4), 'posted');

    // Case 5: a reservation-only change does not defer the item. Old
    // code saw the available basis move (12 - 2 = 10 vs frozen 11)
    // and skipped an item whose physical stock never moved.
    await seedProduct(db, 5, 12, 1, 58.82);
    const session5 = await createSession(service, 5, 12);
    const row5 = await itemRow(db, session5);
    assert.equal(Number(row5.expected_qty), 12);
    assert.equal(Number(row5.variance_qty), 0);
    await sql`UPDATE product_location_stock SET reserved_qty = 2 WHERE product_id = 5 AND location_id = 1`.execute(db);
    await sql`UPDATE products SET reserved_qty = 2 WHERE id = 5`.execute(db);
    const posted5 = await service.postStockCountSession(session5, AUTH, APPROVER_PASSWORD) as Record<string, unknown>;
    assert.deepEqual(posted5.skippedStockCountItemIds, []);
    assert.notEqual((await itemRow(db, session5)).posted_at, null);
    assert.equal(await sessionStatus(db, session5), 'posted');
    assert.equal(await locationQty(db, 5), 12);

    // Case 6: no-reservation regression -- identical to the old behaviour.
    await seedProduct(db, 6, 10, 0, 58.82);
    const session6 = await createSession(service, 6, 10);
    const row6 = await itemRow(db, session6);
    assert.equal(Number(row6.expected_qty), 10);
    assert.equal(Number(row6.variance_qty), 0);
    const journalsBefore = await journalCount(db);
    await service.postStockCountSession(session6, AUTH, APPROVER_PASSWORD);
    assert.equal(await journalCount(db), journalsBefore);
    assert.equal(await locationQty(db, 6), 10);

    // Case 7: a pre-fix draft -- frozen on the old available basis
    // (book 11 for 12 on hand / 1 reserved) -- still completes
    // instead of stalling on the staleness check. The frozen variance
    // stays the as-counted record (+1); the posting follows the
    // actual delta (0), so no journal is booked.
    await seedProduct(db, 7, 12, 1, 58.82);
    const item7 = await seedSession(db, 107, 7, 11, 12);
    await service.postStockCountSession(107, AUTH, APPROVER_PASSWORD);
    const row7 = await itemRow(db, 107);
    assert.equal(Number(row7.expected_qty), 11);
    assert.equal(Number(row7.variance_qty), 1);
    assert.notEqual(row7.posted_at, null);
    assert.equal(await sessionStatus(db, 107), 'posted');
    assert.equal(await locationQty(db, 7), 12);
    assert.deepEqual(await journalLines(db, item7), []);

    // Case 8: source pin -- the freeze (create) and the refresh
    // (recount) run on the on-hand preview, and the staleness checks
    // accept either basis for pre-fix rows.
    {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const serviceSrc = readFileSync(resolve(__dirname, '../../src/modules/inventory/services/inventory-count.service.ts'), 'utf8');
      assert.ok(serviceSrc.includes('previewAssignedLocationOnHandQty'), 'count service must use the on-hand count basis');
      assert.ok(serviceSrc.includes('carries no basis marker'), 'staleness checks must accept either basis for pre-fix rows');
      const ledgerSrc = readFileSync(resolve(__dirname, '../../src/common/utils/location-stock-ledger.ts'), 'utf8');
      assert.ok(ledgerSrc.includes('export async function previewAssignedLocationOnHandQty'), 'ledger must define the on-hand count basis');
    }

    console.log('stock count count basis checks passed');
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
