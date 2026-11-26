/*
 * Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the remaining inventory
 * sites converge on the row-writer — the single adjustment, the two
 * count sites, the QA quarantine release, and the opening-stock import.
 *
 * WHAT THIS PINS, driving the REAL services on PGlite:
 * 1. createInventoryAdjustment add/deduct: exactly one row through the
 *    writer with the full field set (type, signed qty, ledger scope
 *    before/after, unit cost, roundMoney total, reason, reference
 *    inventory_adjustment/product, branch/location, created_by,
 *    tenant/account), plus the matching journal and balances.
 * 2. The no-change adjustment still throws STOCK_ADJUSTMENT_NO_CHANGE
 *    with zero rows and untouched balances — the guard runs after the
 *    ledger call but before the row, so the run rolls back exactly.
 * 3. postStockCountSession GAIN (counted above the raw location qty):
 *    movement_type 'stock_count_gain', qty = the ACTUAL scoped delta
 *    (+10, not the +20 available-basis variance), full row fields,
 *    journal Dr 1140 / Cr 7100 of 10 x WAC. A LOSS case pins the full
 *    field set the same way (the old actual-delta spec pins only
 *    qty/before/after + journal).
 * 4. createDamagedStock (no pre-existing driver): the 'damaged' row
 *    with the write-model identity fields (reason, note, reference
 *    damaged_stock / damage record id), the damage record itself, the
 *    5300 / 1140 journal, and balances 10 -> 7.
 * 5. QA recordInspection release at a fractional landed cost
 *    (0.333 x 3): both relocation legs book total 1.00 at 2 book
 *    digits — the old .toFixed(6) spelling would store 0.999 (A5
 *    decision). Full leg fields, balances, and no second journal.
 * 6. importOpeningStock raise/lower: the full 'opening_stock' row
 *    field set (signed total on the lowering: -8 / -400.00, reason
 *    'inventory_adjustment', note 'تسوية مخزون', reference
 *    product/id), and the no-change import writes NO row (updated 0).
 *
 * COVERAGE MAP (what this spec does NOT re-drive): archive (the
 * pre-existing residual spec drives it), fashion zeroing and the
 * preorder NULL-total row (phase1-a9-services-writer.spec.ts),
 * maintenance / returns / trade-in / purchase-return (their
 * pre-existing driver specs assert the row fields through the writer
 * and are verified green in the regression loop).
 *
 * RED-FIRST: this spec FAILS on the pre-A9 code — the adjustment and
 * count sites wrote rows by hand (different before/after basis on
 * the count loss), the QA site used .toFixed(6), and the damaged
 * site had no driver at all.
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
import { InventoryAdjustmentService } from '../../src/modules/inventory/services/inventory-adjustment.service';
import { InventoryCountService } from '../../src/modules/inventory/services/inventory-count.service';
import { QualityAssuranceService } from '../../src/modules/inventory/services/quality-assurance.service';
import { SettingsImportService } from '../../src/modules/settings/services/settings-import.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: ['canAdjustInventory'],
} as unknown as AuthContext;
const AUTH_SETTINGS = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'super_admin',
  userId: 1,
  username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;
const APPROVER_PASSWORD = 'approver-pass';

type MovementRow = {
  id: number;
  product_id: number;
  movement_type: string;
  qty: string | null;
  before_qty: string | null;
  after_qty: string | null;
  unit_cost: string | null;
  total_cost: string | null;
  reason: string | null;
  note: string | null;
  reference_type: string | null;
  reference_id: number | null;
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  tenant_id: string;
  account_id: string;
};

async function readMovements(db: Kysely<Database>): Promise<MovementRow[]> {
  return (await (db as any).selectFrom('stock_movements').selectAll().orderBy('id', 'asc').execute()) as MovementRow[];
}

async function journalCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = 't1'`.execute(db);
  return Number(row.rows[0].n);
}

async function journalLinesForSource(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{
    code: string;
    debit: string;
    credit: string;
  }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = ${sourceType} AND e.source_id = ${sourceId} AND e.tenant_id = 't1' ORDER BY a.code`.execute(
    db,
  );
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

function assertRowFields(
  row: MovementRow,
  expected: {
    type: string;
    qty: number;
    before: number;
    after: number;
    unit: number;
    total: number | null;
    reason: string;
    note: string;
    refType: string;
    refId: number;
    branch: number | null;
    location: number | null;
  },
): void {
  assert.equal(row.movement_type, expected.type, `movement_type ${row.movement_type}`);
  assert.equal(Number(row.qty), expected.qty, 'qty');
  assert.equal(Number(row.before_qty), expected.before, 'before_qty');
  assert.equal(Number(row.after_qty), expected.after, 'after_qty');
  assert.equal(row.unit_cost !== null && Number(row.unit_cost), expected.unit, 'unit_cost');
  if (expected.total === null) {
    assert.equal(row.total_cost, null, 'total_cost must stay NULL');
  } else {
    assert.equal(row.total_cost !== null && Number(row.total_cost), expected.total, 'total_cost');
  }
  assert.equal(row.reason, expected.reason, 'reason');
  assert.equal(row.note, expected.note, 'note');
  assert.equal(row.reference_type, expected.refType, 'reference_type');
  assert.equal(Number(row.reference_id), expected.refId, 'reference_id');
  assert.equal(row.branch_id === null ? null : Number(row.branch_id), expected.branch, 'branch_id');
  assert.equal(row.location_id === null ? null : Number(row.location_id), expected.location, 'location_id');
  assert.equal(Number(row.created_by), 1, 'created_by');
  assert.equal(row.tenant_id, 't1', 'tenant_id');
  assert.equal(row.account_id, 'a1', 'account_id');
}

async function locQty(db: Kysely<Database>, productId: number, locationId: number): Promise<number> {
  const row = await sql<{
    qty: string;
  }>`SELECT qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = ${locationId}`.execute(
    db,
  );
  return Number(row.rows[0]?.qty ?? 0);
}

async function globalQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ stock_qty: string }>`SELECT stock_qty FROM products WHERE id = ${productId}`.execute(db);
  return Number(row.rows[0].stock_qty);
}

function makePosting(): AccountingPostingService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  return new AccountingPostingService(foundation);
}

// ---- Group A: inventory adjustment ---------------------------------------

async function makeAdjustmentDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
    INSERT INTO branches VALUES (1, 't1', 'Main', 1);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1','currency','EGP');
    INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'MAIN', true, NULL);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, branch_id bigint, location_id bigint, cost_price numeric, purchase_id bigint, purchase_item_id bigint, sale_id bigint, sale_item_id bigint, warranty_end_date date, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
    INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (1140,'t1','1140','asset'), (5200,'t1','5200','expense'), (5300,'t1','5300','expense'), (7100,'t1','7100','revenue');
    CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedAdjustmentProduct(
  db: Kysely<Database>,
  id: number,
  globalQty: number,
  globalReserved: number,
  locQtyValue: number,
  locReserved: number,
  cost: number,
): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${globalQty}, ${globalReserved}, ${cost}, true, false)`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${locQtyValue}, ${locReserved})`.execute(
    db,
  );
}

function makeAdjustmentService(db: Kysely<Database>): InventoryAdjustmentService {
  return new InventoryAdjustmentService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    { listStockMovements: async () => ({ stockMovements: [] }) } as never,
    new InventoryScopeService(db as never),
    { check: async () => null, commitOperation: async () => undefined } as unknown as IdempotencyService,
    makePosting(),
  );
}

async function adjust(
  service: InventoryAdjustmentService,
  productId: number,
  actionType: string,
  qty: number,
): Promise<Record<string, unknown>> {
  return service.createInventoryAdjustment(
    { productId, locationId: 1, branchId: 1, actionType, qty, reason: 'single basis check' } as never,
    AUTH,
  );
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

// ---- Group B: stock count (:638 gain/loss) + damaged stock (:817) ----

async function makeCountDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
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
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_transfers (id bigint PRIMARY KEY, tenant_id text, status text);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, branch_id bigint, location_id bigint, cost_price numeric, purchase_id bigint, purchase_item_id bigint, sale_id bigint, sale_item_id bigint, warranty_end_date date, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE damaged_stock_records (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reason text, note text, created_by bigint, unit_cost numeric, total_cost numeric, serial_tracking text, batch_tracking text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

function makeCountService(db: Kysely<Database>): InventoryCountService {
  return new InventoryCountService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    new InventoryScopeService(db as never),
    { check: async () => null } as unknown as IdempotencyService,
    makePosting(),
  );
}

async function seedCountProduct(
  db: Kysely<Database>,
  id: number,
  globalQty: number,
  reserved: number,
  cost: number,
): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${globalQty}, ${reserved}, ${cost}, true, false)`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${globalQty}, ${reserved})`.execute(
    db,
  );
}

async function seedCountSession(
  db: Kysely<Database>,
  sessionId: number,
  productId: number,
  expected: number,
  counted: number,
  reason: string,
): Promise<number> {
  await sql`INSERT INTO stock_count_sessions (id, tenant_id, account_id, doc_no, branch_id, location_id, status, note, counted_by, created_at, updated_at) VALUES (${sessionId}, 't1', 'a1', ${`ZSC-${sessionId}`}, 1, 1, 'draft', '', 1, NOW(), NOW())`.execute(
    db,
  );
  const item = await sql<{
    id: number;
  }>`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES ('t1', 'a1', ${sessionId}, ${productId}, ${`Product ${productId}`}, ${expected}, ${counted}, ${Number((counted - expected).toFixed(3))}, ${reason}, '', ${null}, null) RETURNING id`.execute(
    db,
  );
  return Number(item.rows[0].id);
}

// ---- Group C: QA quarantine release (:348/:360) ---------------------------

async function makeQaDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1','currency','EGP');
    INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
    INSERT INTO branches VALUES (5, 't1', 1);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, location_type text, is_active boolean DEFAULT true);
    INSERT INTO stock_locations VALUES (1, 't1', 5, 'Main', 'branch_stock', true), (2, 't1', 5, 'Quarantine', 'quarantine', true);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, track_serials boolean DEFAULT false);
    INSERT INTO products VALUES (10, 't1', 'a1', 'Widget 10', 3, 0, 0.333, false);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', 10, 5, 2, 3, 0), ('t1', 'a1', 10, 5, 1, 0, 0);
    CREATE TABLE goods_receipt_notes (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, purchase_order_id bigint, supplier_id bigint, location_id bigint, received_at timestamptz, received_by bigint, status text DEFAULT 'draft');
    INSERT INTO goods_receipt_notes (id, tenant_id, account_id, doc_no, location_id, status) VALUES (7, 't1', 'a1', 'GRN-7', 1, 'posted');
    CREATE TABLE goods_receipt_lines (id bigint PRIMARY KEY, tenant_id text, account_id text, grn_id bigint, purchase_order_item_id bigint, product_id bigint, ordered_qty numeric, received_qty numeric, accepted_qty numeric, rejected_qty numeric, unit_cost numeric, landed_unit_cost numeric, quarantine_location_id bigint);
    INSERT INTO goods_receipt_lines (id, tenant_id, account_id, grn_id, product_id, ordered_qty, received_qty, accepted_qty, rejected_qty, unit_cost, landed_unit_cost, quarantine_location_id) VALUES (1, 't1', 'a1', 7, 10, 3, 3, 3, 0, 0.333, 0.333, 2);
    CREATE TABLE quality_control_points (id text PRIMARY KEY, tenant_id text, name text, product_id bigint, test_type text, norm_measure_min numeric, norm_measure_max numeric);
    CREATE TABLE quality_inspections (id text PRIMARY KEY, tenant_id text, point_id text, reference_doc_type text, reference_doc_id text, product_id bigint, inspected_qty numeric, accepted_qty numeric, rejected_qty numeric, measured_value numeric, status text, inspector_id text, notes text, created_at timestamptz);
    CREATE TABLE quality_non_conformance_reports (id text PRIMARY KEY, tenant_id text, ncr_number text, inspection_id text, product_id bigint, defect_description text, severity text, disposition_action text, status text, assigned_to text, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

// ---- Group D: opening-stock import (:225) --------------------------------

async function makeSuppliersDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE settings (tenant_id text, key text, value text);
    INSERT INTO settings VALUES ('t1','currency','EGP');
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
    CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
    INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, normal_balance, is_active) VALUES (1140,'t1','a1','1140','asset','debit',true), (3100,'t1','a1','3100','equity','credit',true);
    CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    INSERT INTO accounting_settings VALUES (1,'t1','a1',NULL,NULL,NULL,NULL,1140,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint);
    INSERT INTO branches (id, tenant_id, account_id, name, is_active, default_stock_location_id) VALUES (1,'t1','a1','الفرع الرئيسي',true,1);
    CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, branch_id bigint, is_active boolean DEFAULT true, location_type text);
    INSERT INTO stock_locations (id, tenant_id, account_id, name, branch_id, is_active, location_type) VALUES (1,'t1','a1','المخزن الرئيسي',1,true,'branch_stock');
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text);
    CREATE TABLE product_categories (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true);
    CREATE TABLE suppliers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, notes text, is_active boolean DEFAULT true);
    CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, sku text, category_id bigint, supplier_id bigint, item_type text, item_kind text, style_code text, color text, size text, bin_location text, track_serials boolean DEFAULT false, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric, consumer_price numeric, min_selling_price numeric, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, min_stock_qty numeric DEFAULT 0, default_location_id bigint, notes text, metadata text, is_active boolean DEFAULT true, catalog_updated_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, tenant_id text, account_id text, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_units (id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text, name text, multiplier numeric, barcode text, is_base_unit boolean, is_sale_unit_default boolean, is_purchase_unit_default boolean);
  `);
  return { pg, db };
}

async function main(): Promise<void> {
  // Group A, case 1: add 3 on 12 raw / 2 reserved, cost 10 — one row
  // through the writer, journal Dr 1140 30 / Cr 7100 30, raw 12 -> 15.
  {
    const { db } = await makeAdjustmentDb();
    try {
      const service = makeAdjustmentService(db);
      await seedAdjustmentProduct(db, 1, 12, 2, 12, 2, 10);
      const journalsBefore = await journalCount(db);
      await adjust(service, 1, 'add', 3);
      const rows = await readMovements(db);
      assert.equal(rows.length, 1, 'exactly one movement row');
      assertRowFields(rows[0], {
        type: 'add',
        qty: 3,
        before: 12,
        after: 15,
        unit: 10,
        total: 30,
        reason: 'single basis check',
        note: '',
        refType: 'inventory_adjustment',
        refId: 1,
        branch: 1,
        location: 1,
      });
      assert.deepEqual(await journalLinesForSource(db, 'inventory_adjustment', rows[0].id), [
        { code: '1140', debit: 30, credit: 0 },
        { code: '7100', debit: 0, credit: 30 },
      ]);
      assert.equal(await journalCount(db), journalsBefore + 1);
      assert.equal(await locQty(db, 1, 1), 15);
      assert.equal(await globalQty(db, 1), 15);
      console.log('  A1 passed: adjustment add writes one writer row + gain journal');
    } finally {
      await db.destroy();
    }
  }

  // Group A, case 2: deduct 2 on 12 raw / 2 reserved, cost 10.
  {
    const { db } = await makeAdjustmentDb();
    try {
      const service = makeAdjustmentService(db);
      await seedAdjustmentProduct(db, 2, 12, 2, 12, 2, 10);
      await adjust(service, 2, 'deduct', 2);
      const rows = await readMovements(db);
      assert.equal(rows.length, 1, 'exactly one movement row');
      assertRowFields(rows[0], {
        type: 'deduct',
        qty: -2,
        before: 12,
        after: 10,
        unit: 10,
        total: 20,
        reason: 'single basis check',
        note: '',
        refType: 'inventory_adjustment',
        refId: 2,
        branch: 1,
        location: 1,
      });
      assert.deepEqual(await journalLinesForSource(db, 'inventory_adjustment', rows[0].id), [
        { code: '1140', debit: 0, credit: 20 },
        { code: '5200', debit: 20, credit: 0 },
      ]);
      assert.equal(await locQty(db, 2, 1), 10);
      assert.equal(await globalQty(db, 2), 10);
      console.log('  A2 passed: adjustment deduct writes one writer row + loss journal');
    } finally {
      await db.destroy();
    }
  }

  // Group A, case 3: no-change — target equals the available qty.
  {
    const { db } = await makeAdjustmentDb();
    try {
      const service = makeAdjustmentService(db);
      await seedAdjustmentProduct(db, 3, 10, 2, 10, 2, 10);
      const journalsBefore = await journalCount(db);
      await expectCode(adjust(service, 3, 'adjust', 8), 'STOCK_ADJUSTMENT_NO_CHANGE');
      assert.equal((await readMovements(db)).length, 0, 'no-change writes no row');
      assert.equal(await journalCount(db), journalsBefore, 'no-change posts no journal');
      assert.equal(await locQty(db, 3, 1), 10);
      assert.equal(await globalQty(db, 3), 10);
      console.log('  A3 passed: no-change adjustment rolls back with zero rows');
    } finally {
      await db.destroy();
    }
  }

  // Group B, case 1: GAIN — counted 110 above the raw 100. The fixture
  // is the reserved one (100 raw / 10 reserved, expected 90 on the
  // available basis) so the moved-stock skip does not defer it: the
  // available preview (90) still matches the frozen expected qty.
  // The row books the ACTUAL scoped delta +10, not the +20
  // available-basis variance; journal Dr 1140 / Cr 7100 of 100.
  {
    const { db } = await makeCountDb();
    try {
      const approverRecord = await createPasswordRecord(APPROVER_PASSWORD);
      await sql`INSERT INTO users VALUES (2, 't1', 'approver', 1, 'admin', ${approverRecord.hash}, ${approverRecord.salt}, true)`.execute(
        db,
      );
      const service = makeCountService(db);
      await seedCountProduct(db, 6, 100, 10, 10);
      const itemId = await seedCountSession(db, 106, 6, 90, 110, 'count');
      await service.postStockCountSession(106, AUTH, APPROVER_PASSWORD);
      const rows = await readMovements(db);
      assert.equal(rows.length, 1, 'exactly one movement row');
      assertRowFields(rows[0], {
        type: 'stock_count_gain',
        qty: 10,
        before: 100,
        after: 110,
        unit: 10,
        total: 100,
        reason: 'count',
        note: '',
        refType: 'stock_count_session',
        refId: 106,
        branch: 1,
        location: 1,
      });
      assert.deepEqual(await journalLinesForSource(db, 'stock_count_chunk', itemId), [
        { code: '1140', debit: 100, credit: 0 },
        { code: '7100', debit: 0, credit: 100 },
      ]);
      assert.equal(await locQty(db, 6, 1), 110);
      assert.equal(await globalQty(db, 6), 110);
      console.log('  B1 passed: count gain books the actual scoped delta, not the variance');
    } finally {
      await db.destroy();
    }
  }

  // Group B, case 2: LOSS with reservations — the reserved fixture
  // (100 raw / 10 reserved / counted 95) pins the FULL row field set.
  {
    const { db } = await makeCountDb();
    try {
      const approverRecord = await createPasswordRecord(APPROVER_PASSWORD);
      await sql`INSERT INTO users VALUES (2, 't1', 'approver', 1, 'admin', ${approverRecord.hash}, ${approverRecord.salt}, true)`.execute(
        db,
      );
      const service = makeCountService(db);
      await seedCountProduct(db, 1, 100, 10, 10);
      const itemId = await seedCountSession(db, 101, 1, 90, 95, 'count');
      await service.postStockCountSession(101, AUTH, APPROVER_PASSWORD);
      const rows = await readMovements(db);
      assert.equal(rows.length, 1, 'exactly one movement row');
      assertRowFields(rows[0], {
        type: 'stock_count_loss',
        qty: -5,
        before: 100,
        after: 95,
        unit: 10,
        total: 50,
        reason: 'count',
        note: '',
        refType: 'stock_count_session',
        refId: 101,
        branch: 1,
        location: 1,
      });
      assert.deepEqual(await journalLinesForSource(db, 'stock_count_chunk', itemId), [
        { code: '1140', debit: 0, credit: 50 },
        { code: '5200', debit: 50, credit: 0 },
      ]);
      assert.equal(await locQty(db, 1, 1), 95);
      console.log('  B2 passed: count loss pins the full row field set');
    } finally {
      await db.destroy();
    }
  }

  // Group B, case 3: damaged stock — the first driver for
  // createDamagedStock: damage record, 'damaged' row, 5300 journal.
  {
    const { db } = await makeCountDb();
    try {
      const service = makeCountService(db);
      await seedCountProduct(db, 7, 10, 0, 10);
      const result = (await service.createDamagedStock(
        { productId: 7, qty: 3, locationId: 1, reason: 'broken', note: 'damaged in transit' } as never,
        AUTH,
      )) as { ok: boolean };
      assert.equal(result.ok, true, 'damaged stock call succeeds');
      const damageId = Number(
        (
          await (db as any)
            .selectFrom('damaged_stock_records')
            .select('id')
            .orderBy('id', 'asc')
            .executeTakeFirstOrThrow()
        ).id,
      );
      assert.ok(damageId > 0, 'damage record id returned');
      const record = await (db as any)
        .selectFrom('damaged_stock_records')
        .selectAll()
        .where('id', '=', damageId)
        .executeTakeFirstOrThrow();
      assert.equal(Number(record.qty), 3, 'damage record qty');
      assert.equal(Number(record.unit_cost), 10, 'damage record unit cost');
      assert.equal(Number(record.total_cost), 30, 'damage record total');
      assert.equal(record.reason, 'broken', 'damage record reason');
      const rows = await readMovements(db);
      assert.equal(rows.length, 1, 'exactly one movement row');
      assertRowFields(rows[0], {
        type: 'damaged',
        qty: -3,
        before: 10,
        after: 7,
        unit: 10,
        total: 30,
        reason: 'broken',
        note: 'damaged in transit',
        refType: 'damaged_stock',
        refId: damageId,
        branch: 1,
        location: 1,
      });
      const lines = await (db as any)
        .selectFrom('journal_entry_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_entry_lines.journal_entry_id')
        .innerJoin('accounting_accounts', 'accounting_accounts.id', 'journal_entry_lines.account_id')
        .select([
          'accounting_accounts.code as code',
          'journal_entry_lines.debit as debit',
          'journal_entry_lines.credit as credit',
        ])
        .where('journal_entries.source_type', '=', 'damaged_stock')
        .where('journal_entries.source_id', '=', damageId)
        .execute();
      assert.deepEqual(
        lines.map((l: any) => [String(l.code), Number(l.debit), Number(l.credit)]).sort(),
        [
          ['1140', 0, 30],
          ['5300', 30, 0],
        ],
        'damaged stock posts Dr 5300 30 / Cr 1140 30',
      );
      assert.equal(await locQty(db, 7, 1), 7);
      assert.equal(await globalQty(db, 7), 7);
      console.log('  B3 passed: damaged stock writes its row, record and journal');
    } finally {
      await db.destroy();
    }
  }

  // Group C: QA release at a fractional landed cost (0.333 x 3) — both
  // legs book total 1.00 at 2 book digits, not 0.999.
  {
    const { db } = await makeQaDb();
    try {
      const qa = new QualityAssuranceService(db as any);
      // No journal tables in this DDL by design: the release posts no
      // journal, and the pre-existing grn-quarantine spec already pins
      // journalCount == 1 across the release.
      const inspection = await qa.recordInspection(AUTH, {
        referenceDocType: 'goods_receipt',
        referenceDocId: 'GRN-7',
        productId: 10,
        inspectedQty: 3,
        acceptedQty: 3,
        rejectedQty: 0,
        passed: true,
      } as any);
      assert.equal(inspection.status, 'passed', 'the inspection itself passes');
      assert.equal(await locQty(db, 10, 2), 0, 'quarantine is empty after release');
      assert.equal(await locQty(db, 10, 1), 3, 'the normal warehouse holds the released qty');
      assert.equal(await globalQty(db, 10), 3, 'global stock is unchanged by a location-only move');
      const rows = await readMovements(db);
      assert.equal(rows.length, 2, 'exactly two relocation rows');
      const send = rows.find((r) => r.movement_type === 'transfer_send');
      const receive = rows.find((r) => r.movement_type === 'transfer_receive');
      assert.ok(send, 'release out-leg recorded');
      assert.ok(receive, 'release in-leg recorded');
      assertRowFields(send!, {
        type: 'transfer_send',
        qty: -3,
        before: 3,
        after: 0,
        unit: 0.333,
        total: 1,
        reason: 'quarantine_release',
        note: 'إفراج حجر صحي من إذن الاستلام GRN-7 — سطر 1',
        refType: 'goods_receipt',
        refId: 7,
        branch: 5,
        location: 2,
      });
      assertRowFields(receive!, {
        type: 'transfer_receive',
        qty: 3,
        before: 0,
        after: 3,
        unit: 0.333,
        total: 1,
        reason: 'quarantine_release',
        note: 'إفراج حجر صحي من إذن الاستلام GRN-7 — سطر 1',
        refType: 'goods_receipt',
        refId: 7,
        branch: 5,
        location: 1,
      });
      console.log('  C passed: QA release legs book 1.00 each at fractional cost');
    } finally {
      await db.destroy();
    }
  }

  // Group D, case 1: raise the opening stock 10 -> 14 at cost 50 — the
  // full 'opening_stock' row field set, journal Dr 1140 200 / Cr 3100 200.
  {
    const { db } = await makeSuppliersDb();
    try {
      const service = new SettingsImportService(db as any, { log: async () => {} } as any, makePosting());
      const imported = await service.importProducts(
        [
          {
            name: 'صنف اختبار',
            barcode: '1001',
            costPrice: 50,
            retailPrice: 80,
            stockQty: 10,
            warehouseName: 'المخزن الرئيسي',
          },
        ],
        AUTH_SETTINGS,
      );
      assert.equal(imported.ok, true, 'import must succeed');
      assert.equal(imported.inserted, 1, 'one product inserted');
      const productId = Number(
        (await db.selectFrom('products').select('id').where('barcode', '=', '1001').executeTakeFirstOrThrow()).id,
      );
      const raised = await service.importOpeningStock(
        [{ productId, qty: 14, warehouseName: 'المخزن الرئيسي' }],
        AUTH_SETTINGS,
      );
      assert.equal(raised.updated, 1, 'opening stock raise applied');
      const rows = (await readMovements(db)).filter((r) => r.movement_type === 'opening_stock');
      assert.equal(rows.length, 1, 'exactly one opening-stock row for the raise');
      assertRowFields(rows[0], {
        type: 'opening_stock',
        qty: 4,
        before: 10,
        after: 14,
        unit: 50,
        total: 200,
        reason: 'inventory_adjustment',
        note: 'تسوية مخزون',
        refType: 'product',
        refId: productId,
        branch: 1,
        location: 1,
      });
      assert.equal(await globalQty(db, productId), 14);
      console.log('  D1 passed: opening-stock raise pins the full row field set');
    } finally {
      await db.destroy();
    }
  }

  // Group D, case 2: lower the opening stock 14 -> 6 — the SIGNED total
  // (-8 / -400.00) and the mirror journal, then a no-change import
  // writes NO row at all (updated 0).
  {
    const { db } = await makeSuppliersDb();
    try {
      const service = new SettingsImportService(db as any, { log: async () => {} } as any, makePosting());
      await service.importProducts(
        [
          {
            name: 'صنف اختبار',
            barcode: '1001',
            costPrice: 50,
            retailPrice: 80,
            stockQty: 10,
            warehouseName: 'المخزن الرئيسي',
          },
        ],
        AUTH_SETTINGS,
      );
      const productId = Number(
        (await db.selectFrom('products').select('id').where('barcode', '=', '1001').executeTakeFirstOrThrow()).id,
      );
      await service.importOpeningStock([{ productId, qty: 14, warehouseName: 'المخزن الرئيسي' }], AUTH_SETTINGS);
      const lowered = await service.importOpeningStock(
        [{ productId, qty: 6, warehouseName: 'المخزن الرئيسي' }],
        AUTH_SETTINGS,
      );
      assert.equal(lowered.updated, 1, 'opening stock lowering applied');
      const rows = (await readMovements(db)).filter((r) => r.movement_type === 'opening_stock');
      assert.equal(rows.length, 2, 'two opening-stock rows');
      assertRowFields(rows[1], {
        type: 'opening_stock',
        qty: -8,
        before: 14,
        after: 6,
        unit: 50,
        total: -400,
        reason: 'inventory_adjustment',
        note: 'تسوية مخزون',
        refType: 'product',
        refId: productId,
        branch: 1,
        location: 1,
      });
      assert.equal(await globalQty(db, productId), 6);
      const noChange = await service.importOpeningStock(
        [{ productId, qty: 6, warehouseName: 'المخزن الرئيسي' }],
        AUTH_SETTINGS,
      );
      assert.equal(noChange.updated, 0, 'no-change import updates nothing');
      assert.equal(
        (await readMovements(db)).filter((r) => r.movement_type === 'opening_stock').length,
        2,
        'no-change writes no row',
      );
      console.log('  D2 passed: opening-stock lowering keeps the signed total; no-change writes nothing');
    } finally {
      await db.destroy();
    }
  }

  console.log('phase1-a9-inventory-writer checks passed');
}

main()
  .then(() => console.log('phase1-a9-inventory-writer spec passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
