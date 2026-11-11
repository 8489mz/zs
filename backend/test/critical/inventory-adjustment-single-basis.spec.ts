/*
New file: backend/test/critical/inventory-adjustment-single-basis.spec.ts
Pins the single quantity basis for inventory adjustments
(INV-ADJUST-SINGLE-QTY-BASIS).

THE GAP: createInventoryAdjustment read its before-quantity on the
AVAILABLE basis (previewAssignedLocationStockQty: location qty net
of reservations) but the `adjust` branch wrote with
setScopedStockQty(nextQty: requestedQty), which sets the RAW
location qty. With 10 on hand / 2 reserved (8 available) the
dialog showed 8, the merchant saved 8 meaning "no change", and the
service set raw 10 -> 8 and booked a phantom -2 loss (Dr 5200 /
Cr 1140). The same mix also struck whenever unassigned stock
existed, because the old before-read ignored the unassigned pool
while the write drained it into the location first. The stock-count
module already fixed this class the other way round
(INV-STOCK-COUNT-ADJUSTMENT, on-hand basis for a physical count);
an adjustment target is the AVAILABLE figure the merchant sees,
so the adjustment basis is AVAILABLE, not on-hand.

THE RULE (INV-ADJUST-SINGLE-QTY-BASIS): the requested target, the
before-quantity, the delta, the movement and the journal are all on
the AVAILABLE basis -- location qty minus reserved plus unassigned
available, capped by the global available. The write moves by the
available delta (requested - before) through applyStockDelta, which
moves raw and available by the same amount because reservations are
untouched. The movement row and the API response keep the ledger's
raw scoped before/after (the movement chain and the frontend cache
patch both read them as on-hand); their DIFFERENCE is the available
delta, so movement and journal agree with the requested target
while reservations stay untouched. A target equal to the available
quantity is a no-change adjustment (STOCK_ADJUSTMENT_NO_CHANGE, no
movement, no journal), never a phantom loss or gain.

WHAT THIS PINS, driving the REAL createInventoryAdjustment on PGlite:
- the pinned example (12 raw / 2 reserved / 10 available, cost 10,
  adjust target 8): delta -2, movement -2 (raw 12 -> 10), one
  journal Dr 5200 20 / Cr 1140 20, available after 8, reservations
  still 2. The old code booked -4 / 40 here (raw 12 -> 8).
- the reserved-only edge (10 raw / 2 reserved / 8 available,
  target 8): no-change rejection, no movement, no journal, stock
  untouched. Same edge on the 12-raw fixture (target 10).
- adjust up on the available basis (12 raw / 2 reserved, target
  11): delta +1, movement +1 (raw 12 -> 13), journal Dr 1140 10 /
  Cr 7100 10, available after 11.
- no-reservation regression (10 raw / 0 reserved, target 8):
  identical to the old behaviour, delta -2, journal 20.
- adjust available to zero keeps the reserved units (10 raw /
  2 reserved, target 0): delta -8, raw 10 -> 2, journal 80,
  available after 0. The old code threw here (raw 0 < reserved 2).
- add/deduct are unchanged deltas (12 raw / 2 reserved): add 3 ->
  raw 15, journal gain 30; deduct 2 -> raw 10, journal loss 20.
- unassigned stock counts in the basis (location 5 + unassigned 5,
  reserved 0, target 7): delta -3, location 7, unassigned drained
  to 0, global 7, journal loss 30.
- dialog-prefill basis: the ledger read the new inventory
  availability endpoint serves (getLocationAvailability) returns
  availableAtLocation 8 for the 10-raw / 2-reserved fixture, and
  agrees with the preview the service targets.
- source pin: the service targets the available preview and writes
  the adjust branch through applyStockDelta; setScopedStockQty and
  the location-only preview are gone from the adjustment service.
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
import { getLocationAvailability, previewConsumableStockQty } from '../../src/common/utils/location-stock-ledger';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['canAdjustInventory'] } as unknown as AuthContext;

async function seedProduct(db: Kysely<Database>, id: number, globalQty: number, globalReserved: number, locQty: number, locReserved: number, cost: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${globalQty}, ${globalReserved}, ${cost}, true, false)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${locQty}, ${locReserved})`.execute(db);
}

async function seedUnassigned(db: Kysely<Database>, id: number, qty: number, reserved: number): Promise<void> {
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, NULL, NULL, ${qty}, ${reserved})`.execute(db);
}

async function locationRow(db: Kysely<Database>, productId: number): Promise<{ qty: number; reserved_qty: number }> {
  const row = await sql<{ qty: string; reserved_qty: string }>`SELECT qty, reserved_qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  return { qty: Number(row.rows[0].qty), reserved_qty: Number(row.rows[0].reserved_qty) };
}

async function globalRow(db: Kysely<Database>, productId: number): Promise<{ stock_qty: number; reserved_qty: number }> {
  const row = await sql<{ stock_qty: string; reserved_qty: string }>`SELECT stock_qty, reserved_qty FROM products WHERE id = ${productId}`.execute(db);
  return { stock_qty: Number(row.rows[0].stock_qty), reserved_qty: Number(row.rows[0].reserved_qty) };
}

async function availableAt(db: Kysely<Database>, productId: number): Promise<number> {
  const availability = await getLocationAvailability(db as never, { tenantId: 't1', accountId: 'a1', productId, locationId: 1, branchId: 1 });
  return availability.availableAtLocation;
}

async function movementFor(db: Kysely<Database>, productId: number): Promise<{ id: number; qty: number; before_qty: number; after_qty: number } | null> {
  const rows = await sql<{ id: string; qty: string; before_qty: string; after_qty: string }>`SELECT id, qty, before_qty, after_qty FROM stock_movements WHERE reference_type = 'inventory_adjustment' AND reference_id = ${productId} ORDER BY id ASC`.execute(db);
  if (!rows.rows.length) return null;
  const row = rows.rows[rows.rows.length - 1];
  return { id: Number(row.id), qty: Number(row.qty), before_qty: Number(row.before_qty), after_qty: Number(row.after_qty) };
}

async function movementCount(db: Kysely<Database>, productId: number): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_type = 'inventory_adjustment' AND reference_id = ${productId}`.execute(db);
  return Number(rows.rows[0].n);
}

async function journalLinesFor(db: Kysely<Database>, movementId: number): Promise<Array<{ code: string; debit: number; credit: number }>> {
  const rows = await sql<{ code: string; debit: string; credit: string }>`SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounting_accounts a ON a.id = l.account_id WHERE e.source_type = 'inventory_adjustment' AND e.source_id = ${movementId} AND e.tenant_id = 't1' ORDER BY a.code`.execute(db);
  return rows.rows.map((r) => ({ code: r.code, debit: Number(r.debit), credit: Number(r.credit) }));
}

async function journalCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM journal_entries WHERE tenant_id = 't1'`.execute(db);
  return Number(row.rows[0].n);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try { await promise; } catch (error) { caught = error; }
  assert.ok(caught, `expected rejection with ${code}`);
  assert.equal((caught as { code?: string }).code, code);
}

function adjust(service: InventoryAdjustmentService, productId: number, actionType: string, qty: number): Promise<Record<string, unknown>> {
  return service.createInventoryAdjustment({ productId, locationId: 1, branchId: 1, actionType, qty, reason: 'single basis check' } as never, AUTH);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const service = new InventoryAdjustmentService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    { listStockMovements: async () => ({ stockMovements: [] }) } as never,
    new InventoryScopeService(db as never),
    { check: async () => null, commitOperation: async () => undefined } as unknown as IdempotencyService,
    posting,
  );

  try {
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
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
    `);

    // Case 1: the pinned example -- 12 raw / 2 reserved / 10 available,
    // cost 10, adjust target 8 on the available basis. The old code
    // set raw 12 -> 8 and booked -4 / 40; the fix books exactly -2.
    await seedProduct(db, 1, 12, 2, 12, 2, 10);
    assert.equal(await availableAt(db, 1), 10);
    const result1 = await adjust(service, 1, 'adjust', 8) as { adjustment: { beforeQty: number; afterQty: number } };
    // Response scope values stay raw on-hand (12 -> 10); their
    // difference is the available delta (-2).
    assert.equal(result1.adjustment.beforeQty, 12);
    assert.equal(result1.adjustment.afterQty, 10);
    const mov1 = await movementFor(db, 1);
    assert.ok(mov1);
    assert.equal(mov1.qty, -2);
    assert.equal(mov1.before_qty, 12);
    assert.equal(mov1.after_qty, 10);
    assert.deepEqual(await journalLinesFor(db, mov1.id), [
      { code: '1140', debit: 0, credit: 20 },
      { code: '5200', debit: 20, credit: 0 },
    ]);
    assert.deepEqual(await locationRow(db, 1), { qty: 10, reserved_qty: 2 });
    assert.deepEqual(await globalRow(db, 1), { stock_qty: 10, reserved_qty: 2 });
    assert.equal(await availableAt(db, 1), 8);

    // Case 2: the reserved-only edge -- 10 raw / 2 reserved /
    // 8 available, target 8 is no change, not a phantom loss.
    await seedProduct(db, 2, 10, 2, 10, 2, 10);
    assert.equal(await availableAt(db, 2), 8);
    const journalsBefore2 = await journalCount(db);
    await expectCode(adjust(service, 2, 'adjust', 8), 'STOCK_ADJUSTMENT_NO_CHANGE');
    assert.equal(await movementCount(db, 2), 0);
    assert.equal(await journalCount(db), journalsBefore2);
    assert.deepEqual(await locationRow(db, 2), { qty: 10, reserved_qty: 2 });
    assert.deepEqual(await globalRow(db, 2), { stock_qty: 10, reserved_qty: 2 });
    assert.equal(await availableAt(db, 2), 8);

    // Case 2b: same edge on the 12-raw fixture -- target 10 equals
    // the available quantity, so again no change and no journal.
    await seedProduct(db, 3, 12, 2, 12, 2, 10);
    const journalsBefore3 = await journalCount(db);
    await expectCode(adjust(service, 3, 'adjust', 10), 'STOCK_ADJUSTMENT_NO_CHANGE');
    assert.equal(await movementCount(db, 3), 0);
    assert.equal(await journalCount(db), journalsBefore3);
    assert.deepEqual(await locationRow(db, 3), { qty: 12, reserved_qty: 2 });

    // Case 3: adjust UP on the available basis -- 12 raw / 2 reserved,
    // target 11 is a real +1 surplus, not a +3 raw jump.
    await seedProduct(db, 4, 12, 2, 12, 2, 10);
    await adjust(service, 4, 'adjust', 11);
    const mov4 = await movementFor(db, 4);
    assert.ok(mov4);
    assert.equal(mov4.qty, 1);
    assert.equal(mov4.before_qty, 12);
    assert.equal(mov4.after_qty, 13);
    assert.deepEqual(await journalLinesFor(db, mov4.id), [
      { code: '1140', debit: 10, credit: 0 },
      { code: '7100', debit: 0, credit: 10 },
    ]);
    assert.deepEqual(await locationRow(db, 4), { qty: 13, reserved_qty: 2 });
    assert.equal(await availableAt(db, 4), 11);

    // Case 4: no-reservation regression -- identical to the old
    // behaviour when nothing is reserved.
    await seedProduct(db, 5, 10, 0, 10, 0, 10);
    await adjust(service, 5, 'adjust', 8);
    const mov5 = await movementFor(db, 5);
    assert.ok(mov5);
    assert.equal(mov5.qty, -2);
    assert.deepEqual(await journalLinesFor(db, mov5.id), [
      { code: '1140', debit: 0, credit: 20 },
      { code: '5200', debit: 20, credit: 0 },
    ]);
    assert.deepEqual(await locationRow(db, 5), { qty: 8, reserved_qty: 0 });

    // Case 5: adjust available to zero keeps the reserved units on
    // hand -- raw 10 -> 2, not raw 0. The old code threw here because
    // setScopedStockQty refused a raw target below the reservation.
    await seedProduct(db, 6, 10, 2, 10, 2, 10);
    await adjust(service, 6, 'adjust', 0);
    const mov6 = await movementFor(db, 6);
    assert.ok(mov6);
    assert.equal(mov6.qty, -8);
    assert.equal(mov6.after_qty, 2);
    assert.deepEqual(await journalLinesFor(db, mov6.id), [
      { code: '1140', debit: 0, credit: 80 },
      { code: '5200', debit: 80, credit: 0 },
    ]);
    assert.deepEqual(await locationRow(db, 6), { qty: 2, reserved_qty: 2 });
    assert.equal(await availableAt(db, 6), 0);

    // Case 6: add/deduct stay plain deltas on the same basis --
    // 12 raw / 2 reserved, add 3 then deduct 2 on separate products.
    await seedProduct(db, 7, 12, 2, 12, 2, 10);
    await adjust(service, 7, 'add', 3);
    const mov7 = await movementFor(db, 7);
    assert.ok(mov7);
    assert.equal(mov7.qty, 3);
    assert.deepEqual(await journalLinesFor(db, mov7.id), [
      { code: '1140', debit: 30, credit: 0 },
      { code: '7100', debit: 0, credit: 30 },
    ]);
    assert.deepEqual(await locationRow(db, 7), { qty: 15, reserved_qty: 2 });
    assert.equal(await availableAt(db, 7), 13);
    await seedProduct(db, 8, 12, 2, 12, 2, 10);
    await adjust(service, 8, 'deduct', 2);
    const mov8 = await movementFor(db, 8);
    assert.ok(mov8);
    assert.equal(mov8.qty, -2);
    assert.deepEqual(await journalLinesFor(db, mov8.id), [
      { code: '1140', debit: 0, credit: 20 },
      { code: '5200', debit: 20, credit: 0 },
    ]);
    assert.deepEqual(await locationRow(db, 8), { qty: 10, reserved_qty: 2 });
    assert.equal(await availableAt(db, 8), 8);

    // Case 7: unassigned stock counts in the basis -- location 5 +
    // unassigned 5, reserved 0, target 7. The old before-read saw 5
    // (location only) while the write drained the unassigned pool,
    // so saving 7 would have moved raw by +2 instead of -3.
    await seedProduct(db, 9, 10, 0, 5, 0, 10);
    await seedUnassigned(db, 9, 5, 0);
    assert.equal(await availableAt(db, 9), 10);
    const preview9 = await previewConsumableStockQty(db as never, { tenantId: 't1', accountId: 'a1', productId: 9, branchId: 1, locationId: 1 });
    assert.equal(preview9, 10);
    await adjust(service, 9, 'adjust', 7);
    const mov9 = await movementFor(db, 9);
    assert.ok(mov9);
    assert.equal(mov9.qty, -3);
    assert.deepEqual(await journalLinesFor(db, mov9.id), [
      { code: '1140', debit: 0, credit: 30 },
      { code: '5200', debit: 30, credit: 0 },
    ]);
    assert.deepEqual(await locationRow(db, 9), { qty: 7, reserved_qty: 0 });
    assert.deepEqual(await globalRow(db, 9), { stock_qty: 7, reserved_qty: 0 });
    assert.equal(await availableAt(db, 9), 7);

    // Case 8: source pin -- the service targets the available preview
    // and writes `adjust` through applyStockDelta; the raw setter and
    // the location-only preview are gone from the adjustment service.
    // The dialog-prefill read agrees with the service preview on the
    // same fixture (10 raw / 2 reserved -> available 8).
    {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const serviceSrc = readFileSync(resolve(__dirname, '../../src/modules/inventory/services/inventory-adjustment.service.ts'), 'utf8');
      assert.ok(serviceSrc.includes('previewConsumableStockQty'), 'adjustment service must read before-qty on the available basis');
      assert.ok(!serviceSrc.includes('setScopedStockQty'), 'adjustment service must not set the raw scoped qty from the available target');
      assert.ok(!serviceSrc.includes('previewAssignedLocationStockQty'), 'adjustment service must not read before-qty on the location-only basis');
      assert.ok(serviceSrc.includes('getLocationAvailability'), 'adjustment service must serve the dialog-prefill availability read');
      await seedProduct(db, 10, 10, 2, 10, 2, 10);
      const availability = await getLocationAvailability(db as never, { tenantId: 't1', accountId: 'a1', productId: 10, locationId: 1, branchId: 1 });
      assert.equal(availability.availableAtLocation, 8);
      assert.equal(availability.locationQty, 10);
      assert.equal(availability.locationReservedQty, 2);
      const preview10 = await previewConsumableStockQty(db as never, { tenantId: 't1', accountId: 'a1', productId: 10, branchId: 1, locationId: 1 });
      assert.equal(preview10, 8);
      assert.equal(preview10, availability.availableAtLocation);
    }

    console.log('inventory adjustment single basis checks passed');
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
