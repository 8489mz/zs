/*
New file: backend/test/critical/stock-count-with-reservations.spec.ts
Pins the stock-count trace basis for tracked items with reservations
(INV-STOCK-COUNT-TRACE-GROSS-BASIS).

THE GAP: reconcileStockCountTrace compared the GROSS registered
serial/batch ledger (every in_stock serial / every lot quantity at
the location) against the AVAILABLE-basis expected_qty snapshot
(location qty net of reservations). Any reservation on a tracked
product differed by exactly the reserved amount, so posting threw
COUNT_SERIAL_LEDGER_MISMATCH / COUNT_BATCH_LEDGER_MISMATCH 409
and the whole chunk rolled back. Recount recomputed the same
available basis and could not fix it; only releasing reservations
cleared it. This hit phone/mobile shops and pharmacies hardest.

THE RULE (countedQty = physical on-hand, reservations included,
decided 2026-10-31, INV-STOCK-COUNT-ACTUAL-DELTA): the trace
reconciles the registered ledger against the GROSS scoped quantity
at the counted location -- the same physical basis the counted
quantity and the stock write use. Reserved quantities stay
reserved: the write path (setScopedStockQty) still refuses a
counted quantity below the reserved quantity, and the trace never
touches reserved_qty. A genuine ledger-vs-book divergence still
fails closed with the same 409 codes.

WHAT THIS PINS, driving the REAL postStockCountSession on PGlite:
- serial-tracked + reserved (5 gross / 2 reserved / counted 4):
  posts; the uncounted serial is scrapped, reserved_qty stays 2,
  movement -1, journal Dr 5200 / Cr 1140 of 1 x WAC.
- batch-tracked + reserved (5 gross / 2 reserved / counted 4):
  posts; lot quantities rewritten to the counted split, reserved
  untouched, journal Dr 5200 / Cr 1140 of 1 x WAC.
- genuine serial ledger mismatch (4 gross / 0 reserved / 5
  serials registered): still COUNT_SERIAL_LEDGER_MISMATCH 409,
  nothing posted.
- genuine batch ledger mismatch (4 gross / 0 reserved / lots
  totalling 5): still COUNT_BATCH_LEDGER_MISMATCH 409, nothing
  posted.
- counted below reserved (5 gross / 2 reserved / counted 1):
  still fails closed (INSUFFICIENT_STOCK) with the whole chunk
  rolled back -- serials, quantities and reservations unchanged.
- no-reservation tracked regression: identical to the old
  behaviour.
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

async function seedProduct(db: Kysely<Database>, id: number, globalQty: number, reserved: number, cost: number, trackSerials = false): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${globalQty}, ${reserved}, ${cost}, true, ${trackSerials})`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${globalQty}, ${reserved})`.execute(db);
}

async function seedSerials(db: Kysely<Database>, productId: number, serials: string[]): Promise<void> {
  for (const serial of serials) {
    await sql`INSERT INTO product_serials (tenant_id, account_id, product_id, serial_number, status, branch_id, location_id, cost_price) VALUES ('t1', 'a1', ${productId}, ${serial}, 'in_stock', 1, 1, 10)`.execute(db);
  }
}

async function seedBatch(db: Kysely<Database>, productId: number, batchNumber: string, qty: number): Promise<number> {
  const row = await sql<{ id: number }>`INSERT INTO pharmacy_batches (tenant_id, account_id, product_id, drug_id, batch_number, expiry_date, quantity, unit_cost, location_id, supplier_name, status, notes) VALUES ('t1', 'a1', ${productId}, NULL, ${batchNumber}, '2030-01-01', ${qty}, 10, 1, NULL, 'active', '') RETURNING id`.execute(db);
  return Number(row.rows[0].id);
}

async function seedSession(
  db: Kysely<Database>, sessionId: number, productId: number, expected: number, counted: number,
  reason: string, serials: string[] | null, batchCounts: Array<{ batchId: number; countedQty: number }> | null,
): Promise<number> {
  await sql`INSERT INTO stock_count_sessions (id, tenant_id, account_id, doc_no, branch_id, location_id, status, note, counted_by, created_at, updated_at) VALUES (${sessionId}, 't1', 'a1', ${`ZSC-${sessionId}`}, 1, 1, 'draft', '', 1, NOW(), NOW())`.execute(db);
  const item = await sql<{ id: number }>`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES ('t1', 'a1', ${sessionId}, ${productId}, ${`Product ${productId}`}, ${expected}, ${counted}, ${Number((counted - expected).toFixed(3))}, ${reason}, '', ${serials ? JSON.stringify(serials) : null}, ${batchCounts ? JSON.stringify(batchCounts) : null}) RETURNING id`.execute(db);
  return Number(item.rows[0].id);
}

async function journalLines(db: Kysely<Database>, sourceId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'stock_count_chunk' AND e.source_id = ${sourceId} AND e.tenant_id = 't1' ORDER BY a.code`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
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

    // INV-STOCK-COUNT-DUAL-APPROVAL: variance posts need approval by a
    // different admin than the counter (user 1) and the poster (AUTH,
    // user 1) — a second admin user with its own password.
    const approverRecord = await createPasswordRecord(APPROVER_PASSWORD);
    await sql`INSERT INTO users VALUES (2, 't1', 'approver', 1, 'admin', ${approverRecord.hash}, ${approverRecord.salt}, true)`.execute(db);

    // Case 1: serial-tracked + reserved -- the defect. Old code threw
    // COUNT_SERIAL_LEDGER_MISMATCH (5 serials vs available 3).
    await seedProduct(db, 1, 5, 2, 10, true);
    await seedSerials(db, 1, ['SN1', 'SN2', 'SN3', 'SN4', 'SN5']);
    const item1 = await seedSession(db, 101, 1, 3, 4, 'count', ['SN1', 'SN2', 'SN3', 'SN4'], null);
    await service.postStockCountSession(101, AUTH, APPROVER_PASSWORD);
    const loc1 = await sql<{ qty: string; reserved_qty: string }>`SELECT qty, reserved_qty FROM product_location_stock WHERE product_id = 1 AND location_id = 1`.execute(db);
    assert.equal(Number(loc1.rows[0].qty), 4);
    assert.equal(Number(loc1.rows[0].reserved_qty), 2);
    const prod1 = await sql<{ stock_qty: string; reserved_qty: string }>`SELECT stock_qty, reserved_qty FROM products WHERE id = 1`.execute(db);
    assert.equal(Number(prod1.rows[0].stock_qty), 4);
    assert.equal(Number(prod1.rows[0].reserved_qty), 2);
    const mov1 = await sql<{ qty: string; before_qty: string; after_qty: string }>`SELECT qty, before_qty, after_qty FROM stock_movements WHERE reference_id = 101`.execute(db);
    assert.equal(Number(mov1.rows[0].qty), -1);
    assert.equal(Number(mov1.rows[0].before_qty), 5);
    assert.equal(Number(mov1.rows[0].after_qty), 4);
    const scrapped1 = await sql<{ serial_number: string }>`SELECT serial_number FROM product_serials WHERE product_id = 1 AND status = 'scrapped'`.execute(db);
    assert.deepEqual(scrapped1.rows.map((r) => r.serial_number), ['SN5']);
    assert.deepEqual(await journalLines(db, item1), [
      { code: '1140', debit: 0, credit: 10 },
      { code: '5200', debit: 10, credit: 0 },
    ]);

    // Case 2: batch-tracked + reserved -- same defect on the batch leg.
    await seedProduct(db, 2, 5, 2, 10);
    const lotA = await seedBatch(db, 2, 'LOT-A', 3);
    const lotB = await seedBatch(db, 2, 'LOT-B', 2);
    const item2 = await seedSession(db, 102, 2, 3, 4, 'count', null, [
      { batchId: lotA, countedQty: 3 },
      { batchId: lotB, countedQty: 1 },
    ]);
    await service.postStockCountSession(102, AUTH, APPROVER_PASSWORD);
    const lots2 = await sql<{ batch_number: string; quantity: string; status: string }>`SELECT batch_number, quantity, status FROM pharmacy_batches WHERE product_id = 2 ORDER BY batch_number`.execute(db);
    assert.deepEqual(lots2.rows.map((r) => ({ n: r.batch_number, q: Number(r.quantity), s: r.status })), [
      { n: 'LOT-A', q: 3, s: 'active' },
      { n: 'LOT-B', q: 1, s: 'active' },
    ]);
    const loc2 = await sql<{ qty: string; reserved_qty: string }>`SELECT qty, reserved_qty FROM product_location_stock WHERE product_id = 2 AND location_id = 1`.execute(db);
    assert.equal(Number(loc2.rows[0].qty), 4);
    assert.equal(Number(loc2.rows[0].reserved_qty), 2);
    assert.deepEqual(await journalLines(db, item2), [
      { code: '1140', debit: 0, credit: 10 },
      { code: '5200', debit: 10, credit: 0 },
    ]);

    // Case 3: genuine serial ledger mismatch still fails closed.
    await seedProduct(db, 3, 4, 0, 10, true);
    await seedSerials(db, 3, ['SN1', 'SN2', 'SN3', 'SN4', 'SN5']);
    await seedSession(db, 103, 3, 4, 4, 'count', ['SN1', 'SN2', 'SN3', 'SN4'], null);
    await expectCode(service.postStockCountSession(103, AUTH, APPROVER_PASSWORD), 'COUNT_SERIAL_LEDGER_MISMATCH');
    const loc3 = await sql<{ qty: string }>`SELECT qty FROM product_location_stock WHERE product_id = 3 AND location_id = 1`.execute(db);
    assert.equal(Number(loc3.rows[0].qty), 4);
    const mov3 = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = 103`.execute(db);
    assert.equal(Number(mov3.rows[0].n), 0);

    // Case 4: genuine batch ledger mismatch still fails closed.
    await seedProduct(db, 4, 4, 0, 10);
    await seedBatch(db, 4, 'LOT-A', 3);
    const lotB4 = await seedBatch(db, 4, 'LOT-B', 2);
    await seedSession(db, 104, 4, 4, 4, 'count', null, [
      { batchId: lotB4, countedQty: 4 },
    ]);
    await expectCode(service.postStockCountSession(104, AUTH, APPROVER_PASSWORD), 'COUNT_BATCH_LEDGER_MISMATCH');
    const lots4 = await sql<{ quantity: string }>`SELECT quantity FROM pharmacy_batches WHERE product_id = 4 ORDER BY batch_number`.execute(db);
    assert.deepEqual(lots4.rows.map((r) => Number(r.quantity)), [3, 2]);

    // Case 5: counted below reserved stays fail-closed; the whole chunk
    // rolls back, so the trace's serial scrapping does not persist.
    await seedProduct(db, 5, 5, 2, 10, true);
    await seedSerials(db, 5, ['SN1', 'SN2', 'SN3', 'SN4', 'SN5']);
    await seedSession(db, 105, 5, 3, 1, 'count', ['SN1'], null);
    await expectCode(service.postStockCountSession(105, AUTH, APPROVER_PASSWORD), 'INSUFFICIENT_STOCK');
    const loc5 = await sql<{ qty: string; reserved_qty: string }>`SELECT qty, reserved_qty FROM product_location_stock WHERE product_id = 5 AND location_id = 1`.execute(db);
    assert.equal(Number(loc5.rows[0].qty), 5);
    assert.equal(Number(loc5.rows[0].reserved_qty), 2);
    const serials5 = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM product_serials WHERE product_id = 5 AND status = 'in_stock'`.execute(db);
    assert.equal(Number(serials5.rows[0].n), 5);
    const session5 = await sql<{ status: string }>`SELECT status FROM stock_count_sessions WHERE id = 105`.execute(db);
    assert.equal(session5.rows[0].status, 'draft');

    // Case 6: no-reservation tracked regression -- identical to the old behaviour.
    await seedProduct(db, 6, 3, 0, 10, true);
    await seedSerials(db, 6, ['SN1', 'SN2', 'SN3']);
    const item6 = await seedSession(db, 106, 6, 3, 2, 'count', ['SN1', 'SN2'], null);
    await service.postStockCountSession(106, AUTH, APPROVER_PASSWORD);
    const scrapped6 = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM product_serials WHERE product_id = 6 AND status = 'scrapped'`.execute(db);
    assert.equal(Number(scrapped6.rows[0].n), 1);
    assert.deepEqual(await journalLines(db, item6), [
      { code: '1140', debit: 0, credit: 10 },
      { code: '5200', debit: 10, credit: 0 },
    ]);

    // Case 7: invariant pin (presence x1, per GAP-5 hygiene -- never a
    // last-line pin) and the source pin: the trace helper must no longer
    // compare the gross ledger against the available-basis snapshot.
    {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
      assert.equal(invariants.split('INV-STOCK-COUNT-TRACE-GROSS-BASIS').length - 1, 1, 'the invariant entry must exist exactly once');
      const helper = readFileSync(resolve(__dirname, '../../src/modules/inventory/helpers/stock-count-trace.helper.ts'), 'utf8');
      assert.ok(!helper.includes('current.length !== input.expectedQty'), 'serial ledger must not be compared against the available-basis snapshot');
      assert.ok(!helper.includes('registeredQty - input.expectedQty'), 'batch ledger must not be compared against the available-basis snapshot');
    }

    console.log('stock count with reservations checks passed');
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
