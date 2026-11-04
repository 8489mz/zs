import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { InventoryAdjustmentService } from '../../src/modules/inventory/services/inventory-adjustment.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Documented tracked-stock increase (INV-SPIRIT-TRACKED-INCREASE).
 *
 * THE RIGIDITY: any increase (or zero-delta change) of a tracked
 * product was rejected outright and the merchant was sent to run a
 * full tracked count, even when the exact serials or batches being
 * added were known.
 *
 * THE FIX: an increase that names the specific serials and/or batches
 * is recorded as a documented adjustment — the trace rows are written
 * in the same transaction as the stock write, with the same
 * uniqueness and duplicate guards the count path enforces. An
 * undocumented increase is still rejected, an already-registered
 * serial is still rejected, and an expired or non-active batch can
 * never gain quantity. Decreases still go through the dispatch path,
 * and the in-transit direct-write ban is unchanged.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text);
    INSERT INTO branches VALUES (1, 't1');
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1','currency','EGP'), ('t1','timezone','Africa/Cairo');
    INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, is_active boolean DEFAULT true, location_type text);
    INSERT INTO stock_locations VALUES (1,'t1',1,'Main',true,NULL), (2,'t1',1,'Transit',true,'in_transit');
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text,
      stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0,
      track_serials boolean DEFAULT false, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint,
      location_id bigint, branch_id bigint, cost_price numeric, sale_id bigint, sale_item_id bigint,
      warranty_end_date date, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint,
      batch_number text, expiry_date date, quantity numeric DEFAULT 0, unit_cost numeric, location_id bigint,
      supplier_name text, status text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_system boolean DEFAULT false, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, normal_balance text DEFAULT '');
    INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES
      (1140,'t1','1140','asset'), (2125,'t1','2125','liability'), (4100,'t1','4100','revenue'),
      (5100,'t1','5100','expense'), (5190,'t1','5190','expense'), (5200,'t1','5200','expense'),
      (5300,'t1','5300','expense'), (7100,'t1','7100','revenue');
    CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
      bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
      inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
      cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
      purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
      lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
      status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
      posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
      reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
      dedup_key text, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
      tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
      partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, action text, details text,
      event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text,
      remaining_quantity numeric DEFAULT 0, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
  `);
  return { pg, db };
}

function makeService(db: Kysely<Database>): InventoryAdjustmentService {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new InventoryAdjustmentService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    { listStockMovements: async () => ({ stockMovements: [] }) } as never,
    new InventoryScopeService(db as never),
    { check: async () => null, commitOperation: async () => undefined } as never,
    posting,
  );
}

async function seedProduct(db: Kysely<Database>, id: number, stock: number, cost: number, trackSerials: boolean, drug: boolean): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${stock}, 0, ${cost}, true, ${trackSerials})`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${stock}, 0)`.execute(db);
  if (drug) await sql`INSERT INTO pharmacy_drugs (id, tenant_id, product_id) VALUES (${id}, 't1', ${id})`.execute(db);
}

async function readStock(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', productId).executeTakeFirstOrThrow();
  return Number(row.stock_qty);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try { await promise; } catch (error) { caught = error; }
  assert.ok(caught, `expected rejection with ${code}`);
  assert.equal((caught as { code?: string }).code, code);
}

async function main(): Promise<void> {
  // Case 1: documented serial increase posts stock + serial rows + journal.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 10, 0, 10, true, false);
      const service = makeService(db);
      await service.createInventoryAdjustment({
        productId: 10, locationId: 1, branchId: 1, actionType: 'add', qty: 2,
        reason: 'found units', serials: ['SN-1', 'SN-2'],
      } as any, auth);
      assert.equal(await readStock(db, 10), 2);
      const serials = await (db as any).selectFrom('product_serials').select(['serial_number', 'status', 'location_id']).execute();
      assert.deepEqual(serials.map((s: any) => s.serial_number).sort(), ['SN-1', 'SN-2']);
      assert.ok(serials.every((s: any) => s.status === 'in_stock' && Number(s.location_id) === 1));
      const movements = await (db as any).selectFrom('stock_movements').select(['qty', 'total_cost']).execute();
      assert.equal(movements.length, 1);
      assert.equal(Number(movements[0].qty), 2);
      const journals = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM journal_entries`.execute(db);
      assert.ok(Number(journals.rows[0].n) >= 1, 'a journal entry is posted for the increase');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: undocumented serial increase is still rejected, nothing moves.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 10, 0, 10, true, false);
      const service = makeService(db);
      await expectCode(service.createInventoryAdjustment({
        productId: 10, locationId: 1, branchId: 1, actionType: 'add', qty: 2, reason: 'found units',
      } as any, auth), 'ADJUSTMENT_TRACKED_INCREASE_UNDOCUMENTED');
      assert.equal(await readStock(db, 10), 0);
      assert.equal((await (db as any).selectFrom('product_serials').select('id').execute()).length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: an already-registered serial is rejected (uniqueness guard stays).
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 10, 1, 10, true, false);
      await sql`INSERT INTO product_serials (tenant_id, account_id, product_id, serial_number, status, branch_id, location_id, cost_price) VALUES ('t1', 'a1', 10, 'SN-1', 'in_stock', 1, 1, 10)`.execute(db);
      const service = makeService(db);
      await expectCode(service.createInventoryAdjustment({
        productId: 10, locationId: 1, branchId: 1, actionType: 'add', qty: 1,
        reason: 'found units', serials: ['sn-1'],
      } as any, auth), 'ADJUSTMENT_SERIAL_DUPLICATE');
      assert.equal(await readStock(db, 10), 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: batch increase against an existing batch adds to it.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 11, 5, 10, false, true);
      const batch = await sql<{ id: number }>`INSERT INTO pharmacy_batches (tenant_id, account_id, product_id, drug_id, batch_number, expiry_date, quantity, unit_cost, location_id, status) VALUES ('t1', 'a1', 11, 11, 'B-1', '2030-01-01', 5, 10, 1, 'active') RETURNING id`.execute(db);
      const batchId = Number(batch.rows[0].id);
      const service = makeService(db);
      await service.createInventoryAdjustment({
        productId: 11, locationId: 1, branchId: 1, actionType: 'add', qty: 3,
        reason: 'extra delivery', batchAllocations: [{ batchId, qty: 3 }],
      } as any, auth);
      assert.equal(await readStock(db, 11), 8);
      const row = await (db as any).selectFrom('pharmacy_batches').select('quantity').where('id', '=', batchId).executeTakeFirstOrThrow();
      assert.equal(Number(row.quantity), 8);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: a brand-new batch is named and created by the increase.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 11, 0, 10, false, true);
      const service = makeService(db);
      await service.createInventoryAdjustment({
        productId: 11, locationId: 1, branchId: 1, actionType: 'add', qty: 4,
        reason: 'new delivery', batchAllocations: [{ batchNumber: 'B-NEW', expiryDate: '2030-06-01', qty: 4 }],
      } as any, auth);
      assert.equal(await readStock(db, 11), 4);
      const rows = await (db as any).selectFrom('pharmacy_batches').select(['batch_number', 'quantity', 'status']).execute();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].batch_number, 'B-NEW');
      assert.equal(Number(rows[0].quantity), 4);
      assert.equal(rows[0].status, 'active');
    } finally {
      await db.destroy();
    }
  }

  // Case 6: an expired batch can never gain quantity.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 11, 5, 10, false, true);
      const batch = await sql<{ id: number }>`INSERT INTO pharmacy_batches (tenant_id, account_id, product_id, drug_id, batch_number, expiry_date, quantity, unit_cost, location_id, status) VALUES ('t1', 'a1', 11, 11, 'B-OLD', '2020-01-01', 5, 10, 1, 'active') RETURNING id`.execute(db);
      const batchId = Number(batch.rows[0].id);
      const service = makeService(db);
      await expectCode(service.createInventoryAdjustment({
        productId: 11, locationId: 1, branchId: 1, actionType: 'add', qty: 2,
        reason: 'extra delivery', batchAllocations: [{ batchId, qty: 2 }],
      } as any, auth), 'ADJUSTMENT_BATCH_NOT_AVAILABLE');
      assert.equal(await readStock(db, 11), 5);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: the in-transit direct-write ban is unchanged.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 10, 0, 10, true, false);
      const service = makeService(db);
      await expectCode(service.createInventoryAdjustment({
        productId: 10, locationId: 2, branchId: 1, actionType: 'add', qty: 1,
        reason: 'transit write', serials: ['SN-9'],
      } as any, auth), 'IN_TRANSIT_LOCATION_RESTRICTED');
      assert.equal(await readStock(db, 10), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: a decrease still dispatches the named serial (regression).
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 10, 2, 10, true, false);
      await sql`INSERT INTO product_serials (tenant_id, account_id, product_id, serial_number, status, branch_id, location_id, cost_price) VALUES ('t1', 'a1', 10, 'SN-1', 'in_stock', 1, 1, 10), ('t1', 'a1', 10, 'SN-2', 'in_stock', 1, 1, 10)`.execute(db);
      const service = makeService(db);
      await service.createInventoryAdjustment({
        productId: 10, locationId: 1, branchId: 1, actionType: 'deduct', qty: 1,
        reason: 'damaged', serials: ['SN-1'],
      } as any, auth);
      assert.equal(await readStock(db, 10), 1);
      const row = await (db as any).selectFrom('product_serials').select('status').where('serial_number', '=', 'SN-1').executeTakeFirstOrThrow();
      assert.equal(row.status, 'scrapped');
    } finally {
      await db.destroy();
    }
  }

  console.log('tracked-stock increase checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
