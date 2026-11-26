import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SettingsImportService } from '../../src/modules/settings/services/settings-import.service';
import { stockMovementTotal } from '../../src/modules/catalog/engines/stock-movement-total.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 A4 — opening balances through the ledger
 * (INV-PHASE1-A4-OPENING-BALANCES-LEDGER).
 *
 * THE GAP (grounding phase1-grounding-stock-movements.md §4.3/§4.4):
 * the three opening-balance sites write `product_location_stock`
 * DIRECTLY and then hand-stamp a `stock_movements` row, with NO ledger
 * balance call at all — fashion `saveFashionGroup`'s new-variant branch
 * (catalog-product-fashion.service.ts:853), catalog-write `createProduct`
 * (:662), settings-import `importProducts` (:282). They are the "no
 * ledger balance call at all" set. Every other site at least routes its
 * balance through applyStockDelta or a sibling ledger function.
 *
 * THE RULE: each site goes through A0's recordStockMovement(trx,
 * params) — the delta runs through applyStockDelta and exactly one row
 * is written from the returned scopeBefore/scopeAfter, all on the
 * caller's transaction — and the existing GL posting call stays
 * immediately after (`postOpeningStock` / bound
 * `postImportedOpeningStock`), unchanged. No other write site moves in
 * this package (A5–A9 migrate the rest); cost rounding is A10.
 *
 * THE DOUBLE-COUNT TRAP (why the products insert changes too): all
 * three sites insert the product with `products.stock_qty` PRESET to
 * the opening qty. A naive writer call on that row double-counts:
 * applyStockDelta reconciles the cached global against the location
 * sum, so ensureUnassignedBalance mints the preset into the unassigned
 * pool, the auto-drain moves it into the location, and the delta adds
 * the qty a second time — location 2x qty, global 2x qty, row before
 * qty / after 2x qty. So the insert seeds `stock_qty: 0` and the ledger
 * sets BOTH the location balance and the reconciled global; the preset
 * was itself a direct balance write bypassing the ledger. The spec pins
 * global == location == qty on every site (a restored preset fails
 * with global 16 for an 8-unit opening — proven by the RED-2
 * mutation). The import's null-location case now gains an
 * unassigned-pool balance where previously NO location balance existed
 * while products.stock_qty held the qty (row and balance agree now).
 *
 * WHAT THIS PINS, driving the REAL services on PGlite (fresh database
 * per case; the catalog blocks use a recording fake for
 * postDomainJournal + a no-op foundation fake so ensureOpeningStockAccounts
 * passes; the import blocks use the REAL AccountingPostingService, as in
 * import-opening-stock-gl.spec.ts):
 * - Fashion: a new variant (stock 8, cost 10, loc A) writes one
 *   opening_balance row (before 0 / after 8, total 80), a location
 *   balance of 8, a global of 8 (no double-count), and still posts the
 *   GL journal (Dr 1140 80 / Cr 3100 80).
 * - createProduct: a new product (stock 10, cost 50, loc A) writes one
 *   opening_balance row (before 0 / after 10, total 500), a location
 *   balance of 10, a global of 10, and still posts the GL journal
 *   (Dr 1140 500 / Cr 3100 500); getProduct returns stock 10.
 * - importProducts: an imported product (stock 10, cost 50, main
 *   warehouse) writes one opening_balance row (before 0 / after 10,
 *   total 500), a location balance of 10, a global of 10, and still
 *   posts the one balanced journal (Dr 1140 500 / Cr 3100 500); GL 1140
 *   == stock value 500.
 * - Rollback (one block per site): with accounts 1140/3100 missing, the
 *   GL gate throws OPENING_STOCK_ACCOUNT_MISSING AFTER the writer call,
 *   so the whole transaction rolls back — zero movement rows, zero
 *   location balances, no product row.
 * - Source pins: exactly 1 recordStockMovement(trx, …) call in each of
 *   the three files (fashion: 4 total — 3 A3 legs + this opening
 *   branch); zero direct `insertInto('product_location_stock')` and
 *   zero direct `insertInto('stock_movements')` in catalog-write and
 *   import-products (fashion keeps its single :554 zeroing-deduct row,
 *   A6–A9 scope); no `stockMovementTotal(` call left in catalog-write
 *   or import-products (fashion keeps its one zeroing call); no
 *   `stock_qty: stock` / `stock_qty: initialStockQty` preset left in
 *   any of the three files; the GL posting calls are still present.
 * This is not an end-to-end run on live Postgres.
 */

type LooseDb = Record<string, Record<string, unknown>>;

const auth = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'tester',
  permissions: ['canAdjustInventory', 'canEditPrice'],
} as unknown as AuthContext;

const importAuth = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'super_admin',
  userId: 1,
  username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;

async function makeCatalogDb(
  seedAccounts: boolean,
): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE products (
      id bigserial PRIMARY KEY, tenant_id text, account_id text,
      name text, name_en text, barcode text, sku text,
      catalog_updated_at timestamptz, item_type text, item_kind text,
      style_code text, color text, size text, bin_location text,
      track_serials boolean, category_id bigint, supplier_id bigint,
      cost_price numeric, retail_price numeric, wholesale_price numeric, half_wholesale_price numeric,
      credit_price numeric, consumer_price numeric, min_selling_price numeric,
      stock_qty numeric, reserved_qty numeric, min_stock_qty numeric, default_location_id bigint,
      notes text, metadata jsonb, is_active boolean,
      calories numeric, allergens jsonb, is_spicy boolean,
      is_vegetarian boolean, is_gluten_free boolean,
      created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE product_units (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text,
      name text, multiplier numeric, barcode text,
      is_base_unit boolean, is_sale_unit_default boolean, is_purchase_unit_default boolean
    );
    CREATE TABLE product_offers (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text,
      offer_type text, value numeric, start_date text, end_date text, is_active boolean
    );
    CREATE TABLE product_customer_prices (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text,
      customer_id bigint, price numeric
    );
    CREATE TABLE manufacturing_boms (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text, is_active boolean
    );
    CREATE TABLE stock_locations (
      id bigserial PRIMARY KEY, tenant_id text, account_id text,
      name text, is_active boolean, location_type text, branch_id bigint
    );
    CREATE TABLE product_location_stock (
      id bigserial PRIMARY KEY, product_id bigint, location_id bigint, branch_id bigint,
      tenant_id text, account_id text, qty numeric, reserved_qty numeric, updated_at timestamptz
    );
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, serial_tracking jsonb, batch_tracking jsonb, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE import_shipment_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    CREATE TABLE purchase_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    INSERT INTO stock_locations (id, tenant_id, account_id, name, is_active, location_type) VALUES
      (10, 't1', 'a1', 'A', true, NULL),
      (20, 't1', 'a1', 'B', true, NULL);
    ${seedAccounts ? `INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, normal_balance, is_active) VALUES (1140,'t1','a1','1140','asset','debit',true), (3100,'t1','a1','3100','equity','credit',true);` : ''}
  `);
  return { pg, db };
}

function makeCatalogServices(db: Kysely<Database>, glCalls: Array<Record<string, unknown>>): CatalogProductService {
  const fakeAudit = { log: async () => undefined };
  const fakePosting = {
    postDomainJournal: async (_trx: unknown, input: Record<string, unknown>) => {
      glCalls.push(input);
    },
  };
  const fakeFoundation = { ensureForAuth: async () => undefined };
  return new CatalogProductService(
    db,
    fakeAudit as unknown as AuditService,
    new InventoryScopeService(db),
    fakePosting as unknown as AccountingPostingService,
    fakeFoundation as unknown as AccountingTenantFoundationService,
  );
}

async function makeImportDb(seedAccounts: boolean): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
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
    ${seedAccounts ? `INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, normal_balance, is_active) VALUES (1140,'t1','a1','1140','asset','debit',true), (3100,'t1','a1','3100','equity','credit',true);` : ''}
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

function makeImportServices(db: Kysely<Database>): SettingsImportService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const fakeAudit = { log: async () => undefined };
  return new SettingsImportService(db, fakeAudit as unknown as AuditService, posting);
}

async function fixProductSequence(db: Kysely<Database>): Promise<void> {
  // Explicit-id seeds do not advance the bigserial sequence, so the first
  // real insert would collide with id 1 (23505 products_pkey).
  await sql`SELECT setval(pg_get_serial_sequence('products', 'id'), COALESCE((SELECT MAX(id) FROM products), 1))`.execute(
    db,
  );
}

async function seedProduct(
  db: Kysely<Database>,
  row: {
    id: number;
    name: string;
    color: string;
    size: string;
    barcode: string;
    sku: string;
    style: string;
    cost: number;
    stock: number;
  },
): Promise<void> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  await anyDb
    .insertInto('products')
    .values({
      id: row.id,
      tenant_id: 't1',
      account_id: 'a1',
      name: row.name,
      name_en: null,
      barcode: row.barcode,
      sku: row.sku,
      item_type: 'product',
      item_kind: 'fashion',
      style_code: row.style,
      color: row.color,
      size: row.size,
      cost_price: row.cost,
      retail_price: row.cost + 5,
      wholesale_price: row.cost + 2,
      credit_price: null,
      consumer_price: null,
      min_selling_price: null,
      stock_qty: row.stock,
      reserved_qty: 0,
      min_stock_qty: 0,
      default_location_id: 10,
      notes: '',
      metadata: '{}',
      is_active: true,
      calories: null,
      allergens: '[]',
      is_spicy: false,
      is_vegetarian: false,
      is_gluten_free: false,
    })
    .execute();
  await anyDb
    .insertInto('product_units')
    .values({
      product_id: row.id,
      tenant_id: 't1',
      account_id: 'a1',
      name: 'قطعة',
      multiplier: 1,
      barcode: row.barcode,
      is_base_unit: true,
      is_sale_unit_default: true,
      is_purchase_unit_default: true,
    })
    .execute();
}

async function seedLocationStock(
  db: Kysely<Database>,
  productId: number,
  locationId: number,
  qty: number,
): Promise<void> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  await anyDb
    .insertInto('product_location_stock')
    .values({
      product_id: productId,
      location_id: locationId,
      branch_id: null,
      tenant_id: 't1',
      account_id: 'a1',
      qty,
      reserved_qty: 0,
    })
    .execute();
}

function fashionRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'قميص أحمر',
    barcode: 'T-RED-S',
    sku: 'SKU-RED-S',
    itemType: 'product',
    itemKind: 'fashion',
    styleCode: '1001',
    color: 'red',
    size: 'S',
    costPrice: 10,
    retailPrice: 15,
    wholesalePrice: 12,
    units: [
      { name: 'قطعة', multiplier: 1, barcode: 'T-RED-S', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true },
    ],
    offers: [],
    customerPrices: [],
    fashionVariants: [],
    ...overrides,
  };
}

function createPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'صنف جديد',
    barcode: 'NEW-1',
    sku: 'SKU-NEW-1',
    itemType: 'product',
    itemKind: 'standard',
    costPrice: 50,
    retailPrice: 80,
    wholesalePrice: 60,
    stock: 10,
    warehouseId: 10,
    units: [
      { name: 'قطعة', multiplier: 1, barcode: 'NEW-1', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true },
    ],
    offers: [],
    customerPrices: [],
    fashionVariants: [],
    ...overrides,
  };
}

type MovementRow = {
  product_id: number;
  movement_type: string;
  qty: string;
  before_qty: string;
  after_qty: string;
  unit_cost: string;
  total_cost: string;
  reason: string;
  note: string;
  reference_type: string;
  reference_id: number;
  branch_id: number | null;
  location_id: number | null;
};

async function readRows(db: Kysely<Database>): Promise<MovementRow[]> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  return (await anyDb.selectFrom('stock_movements').selectAll().orderBy('id').execute()) as MovementRow[];
}

async function readBalances(
  db: Kysely<Database>,
  productId: number,
): Promise<{ globalQty: number; byLocation: Map<number | null, number>; sum: number }> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  const product = (await anyDb
    .selectFrom('products')
    .select('stock_qty')
    .where('id', '=', productId)
    .executeTakeFirst()) as { stock_qty: string } | undefined;
  const locs = (await anyDb
    .selectFrom('product_location_stock')
    .select(['location_id', 'qty'])
    .where('product_id', '=', productId)
    .execute()) as Array<{ location_id: number | null; qty: string }>;
  const byLocation = new Map(locs.map((l) => [l.location_id == null ? null : Number(l.location_id), Number(l.qty)]));
  return {
    globalQty: product ? Number(product.stock_qty) : NaN,
    byLocation,
    sum: locs.reduce((acc, l) => acc + Number(l.qty), 0),
  };
}

async function countTable(db: Kysely<Database>, table: string): Promise<number> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  const row = (await anyDb
    .selectFrom(table)
    .select(sql<number>`count(*)`.as('n'))
    .executeTakeFirst()) as { n: string } | undefined;
  return Number(row?.n ?? 0);
}

async function main(): Promise<void> {
  // Block 1: fashion opening balance — a new variant (stock 8, cost 10,
  // loc A) writes one opening_balance row through the writer, and the
  // location balance and the global are 8, not 16. Pre-fix the row is
  // hand-stamped from a direct product_location_stock insert (the source
  // pins in block 7 fail); a naive writer call on the old preset fails
  // here with global 16 (RED-2 mutation).
  {
    const { db } = await makeCatalogDb(true);
    try {
      await seedProduct(db, {
        id: 1,
        name: 'قميص أحمر',
        color: 'red',
        size: 'S',
        barcode: 'T-RED-S',
        sku: 'SKU-RED-S',
        style: '1001',
        cost: 10,
        stock: 15,
      });
      await seedLocationStock(db, 1, 10, 10);
      await seedLocationStock(db, 1, 20, 5);
      await fixProductSequence(db);
      const glCalls: Array<Record<string, unknown>> = [];
      const catalog = makeCatalogServices(db, glCalls);
      const result = (await catalog.saveFashionGroup(
        '1001',
        {
          rows: [
            fashionRow({ id: 1, stock: 15, expectedStock: 15 }),
            fashionRow({
              name: 'قميص أحمر - M',
              barcode: 'T-RED-M',
              sku: 'SKU-RED-M',
              color: 'red',
              size: 'M',
              stock: 8,
              warehouseId: 10,
              units: [
                {
                  name: 'قطعة',
                  multiplier: 1,
                  barcode: 'T-RED-M',
                  isBaseUnit: true,
                  isSaleUnit: true,
                  isPurchaseUnit: true,
                },
              ],
            }),
          ],
        } as never,
        auth,
      )) as Record<string, unknown>;
      assert.equal(result.ok, true);
      assert.equal(result.updated, 1);
      assert.equal(result.created, 1);

      const anyDb = db as unknown as Kysely<LooseDb>;
      const created = (await anyDb
        .selectFrom('products')
        .select('id')
        .where('barcode', '=', 'T-RED-M')
        .executeTakeFirst()) as { id: number };
      assert.ok(created, 'the new variant must exist');
      const newId = Number(created.id);

      const rows = await readRows(db);
      assert.equal(rows.length, 1, `expected 1 opening-balance row, got ${rows.length}`);
      const row = rows[0];
      assert.equal(row.product_id, newId);
      assert.equal(row.movement_type, 'opening_balance');
      assert.equal(row.reason, 'opening_balance');
      assert.equal(row.note, 'رصيد افتتاحي لمقاس جديد');
      assert.equal(Number(row.qty), 8);
      assert.equal(Number(row.before_qty), 0, 'before_qty must be the ledger scopeBefore (0), not a preset');
      assert.equal(Number(row.after_qty), 8, 'after_qty must be the ledger scopeAfter (8)');
      assert.equal(Number(row.unit_cost), 10);
      assert.equal(Number(row.total_cost), stockMovementTotal(8, 10, 2));
      assert.equal(row.reference_type, 'product');
      assert.equal(row.reference_id, newId);
      assert.equal(row.location_id, 10);
      assert.equal(row.branch_id, null);

      const balances = await readBalances(db, newId);
      assert.equal(balances.globalQty, 8, 'global must be 8 — a double-counted ledger write gives 16');
      assert.equal(balances.byLocation.get(10), 8, 'location A balance must be 8');
      assert.equal(balances.sum, 8, 'sum of location balances must equal the global (no phantom pool qty)');

      assert.equal(glCalls.length, 1, 'the opening-stock GL posting must still run');
      const journal = glCalls[0];
      assert.equal(journal.sourceType, 'catalog_opening_stock');
      assert.equal(journal.sourceId, newId);
      const lines = journal.lines as Array<{ accountId: number; debit: number; credit: number }>;
      assert.deepEqual(
        lines.map((l) => [l.accountId, l.debit, l.credit]).sort(),
        [
          [1140, 80, 0],
          [3100, 0, 80],
        ],
        'GL still posts Dr 1140 80 / Cr 3100 80',
      );
      console.log('  1. fashion opening balance through the ledger, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 2: createProduct opening balance — a new product (stock 10,
  // cost 50, loc A) writes one opening_balance row through the writer,
  // location 10, global 10, GL still posted, getProduct returns stock 10.
  {
    const { db } = await makeCatalogDb(true);
    try {
      const glCalls: Array<Record<string, unknown>> = [];
      const catalog = makeCatalogServices(db, glCalls);
      const result = (await catalog.createProduct(createPayload() as never, auth)) as Record<string, unknown>;
      assert.equal(result.ok, true);
      const productId = Number(result.id);
      assert.ok(productId > 0, 'create must return the new product id');

      const rows = await readRows(db);
      assert.equal(rows.length, 1, `expected 1 opening-balance row, got ${rows.length}`);
      const row = rows[0];
      assert.equal(row.product_id, productId);
      assert.equal(row.movement_type, 'opening_balance');
      assert.equal(row.reason, 'opening_balance');
      assert.equal(row.note, 'رصيد افتتاحي عند إنشاء الصنف');
      assert.equal(Number(row.qty), 10);
      assert.equal(Number(row.before_qty), 0);
      assert.equal(Number(row.after_qty), 10);
      assert.equal(Number(row.unit_cost), 50);
      assert.equal(Number(row.total_cost), stockMovementTotal(10, 50, 2));
      assert.equal(row.reference_type, 'product');
      assert.equal(row.reference_id, productId);
      assert.equal(row.location_id, 10);
      assert.equal(row.branch_id, null);

      const balances = await readBalances(db, productId);
      assert.equal(balances.globalQty, 10, 'global must be 10 — a double-counted ledger write gives 20');
      assert.equal(balances.byLocation.get(10), 10, 'location A balance must be 10');
      assert.equal(balances.sum, 10);

      assert.equal(glCalls.length, 1, 'the opening-stock GL posting must still run');
      const lines = (glCalls[0].lines as Array<{ accountId: number; debit: number; credit: number }>)
        .map((l) => [l.accountId, l.debit, l.credit])
        .sort();
      assert.deepEqual(
        lines,
        [
          [1140, 500, 0],
          [3100, 0, 500],
        ],
        'GL still posts Dr 1140 500 / Cr 3100 500',
      );

      const product = result.product as Record<string, unknown>;
      assert.equal(Number(product.stock), 10, 'getProduct must return stock 10 after the commit');
      console.log('  2. createProduct opening balance through the ledger, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 3: importProducts opening balance — an imported product (stock
  // 10, cost 50, main warehouse) writes one opening_balance row through
  // the writer, location 10, global 10, and still posts the one balanced
  // journal (Dr 1140 500 / Cr 3100 500); GL 1140 == stock value 500.
  {
    const { db } = await makeImportDb(true);
    try {
      const service = makeImportServices(db);
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
        importAuth,
      );
      assert.equal(imported.ok, true, 'import must succeed');
      assert.equal(imported.inserted, 1, 'one product inserted');

      const rows = await readRows(db);
      assert.equal(rows.length, 1, `expected 1 opening-balance row, got ${rows.length}`);
      const row = rows[0];
      assert.equal(row.movement_type, 'opening_balance');
      assert.equal(row.reason, 'opening_balance');
      assert.equal(row.note, 'رصيد افتتاحي عند استيراد الصنف');
      assert.equal(Number(row.qty), 10);
      assert.equal(Number(row.before_qty), 0);
      assert.equal(Number(row.after_qty), 10);
      assert.equal(Number(row.unit_cost), 50);
      assert.equal(Number(row.total_cost), stockMovementTotal(10, 50, 2));
      assert.equal(row.reference_type, 'product');
      assert.equal(row.reference_id, row.product_id);
      assert.equal(row.location_id, 1);
      assert.equal(row.branch_id, 1);

      const balances = await readBalances(db, Number(row.product_id));
      assert.equal(balances.globalQty, 10, 'global must be 10 — a double-counted ledger write gives 20');
      assert.equal(balances.byLocation.get(1), 10, 'main warehouse balance must be 10');
      assert.equal(balances.sum, 10);

      const anyDb = db as unknown as Kysely<LooseDb>;
      const journals = (await anyDb.selectFrom('journal_entries').selectAll().execute()) as Array<{
        id: number;
        source_type: string;
        source_id: number;
      }>;
      assert.equal(journals.length, 1, 'one opening-stock journal must be posted');
      assert.equal(journals[0].source_type, 'catalog_opening_stock');
      const lines = (await anyDb
        .selectFrom('journal_entry_lines')
        .innerJoin('accounting_accounts', 'accounting_accounts.id', 'journal_entry_lines.account_id')
        .select([
          'accounting_accounts.code as code',
          'journal_entry_lines.debit as debit',
          'journal_entry_lines.credit as credit',
        ])
        .where('journal_entry_id', '=', journals[0].id)
        .execute()) as Array<{ code: string; debit: string; credit: string }>;
      assert.deepEqual(
        lines.map((l) => [l.code, Number(l.debit), Number(l.credit)]).sort(),
        [
          ['1140', 500, 0],
          ['3100', 0, 500],
        ],
        'imported opening stock still debits 1140 500.00 and credits 3100 500.00',
      );
      const stockValueRow = (await anyDb.selectFrom('products').select('stock_qty').execute()) as Array<{
        stock_qty: string;
      }>;
      const stockValue = stockValueRow.reduce((acc, r) => acc + Number(r.stock_qty) * 50, 0);
      assert.equal(stockValue, 500, 'stock value is 500.00');
      console.log('  3. importProducts opening balance through the ledger, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 4: rollback — fashion. With accounts 1140/3100 missing, the GL
  // gate throws OPENING_STOCK_ACCOUNT_MISSING AFTER the writer call, so
  // the save must roll the balance AND the row back together: no new
  // variant, no movement row, no location balance; the kept variant is
  // untouched.
  {
    const { db } = await makeCatalogDb(false);
    try {
      await seedProduct(db, {
        id: 1,
        name: 'قميص أحمر',
        color: 'red',
        size: 'S',
        barcode: 'T-RED-S',
        sku: 'SKU-RED-S',
        style: '1001',
        cost: 10,
        stock: 15,
      });
      await seedLocationStock(db, 1, 10, 10);
      await seedLocationStock(db, 1, 20, 5);
      await fixProductSequence(db);
      const glCalls: Array<Record<string, unknown>> = [];
      const catalog = makeCatalogServices(db, glCalls);
      await assert.rejects(
        catalog.saveFashionGroup(
          '1001',
          {
            rows: [
              fashionRow({ id: 1, stock: 15, expectedStock: 15 }),
              fashionRow({
                name: 'قميص أحمر - M',
                barcode: 'T-RED-M',
                sku: 'SKU-RED-M',
                color: 'red',
                size: 'M',
                stock: 8,
                warehouseId: 10,
                units: [
                  {
                    name: 'قطعة',
                    multiplier: 1,
                    barcode: 'T-RED-M',
                    isBaseUnit: true,
                    isSaleUnit: true,
                    isPurchaseUnit: true,
                  },
                ],
              }),
            ],
          } as never,
          auth,
        ),
        /OPENING_STOCK_ACCOUNT_MISSING/,
      );
      assert.equal(await countTable(db, 'stock_movements'), 0, 'a rolled-back save must leave zero movement rows');
      assert.equal(await countTable(db, 'product_location_stock'), 2, 'only the two seeded balances remain');
      const anyDb = db as unknown as Kysely<LooseDb>;
      const created = await anyDb
        .selectFrom('products')
        .select('id')
        .where('barcode', '=', 'T-RED-M')
        .executeTakeFirst();
      assert.equal(created, undefined, 'the new variant must not exist after rollback');
      const kept = await readBalances(db, 1);
      assert.equal(kept.globalQty, 15);
      assert.equal(kept.byLocation.get(10), 10);
      assert.equal(kept.byLocation.get(20), 5);
      console.log('  4. fashion rollback leaves no row and no balance, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 5: rollback — createProduct. Same GL gate, same proof: no
  // product, no movement row, no location balance.
  {
    const { db } = await makeCatalogDb(false);
    try {
      const glCalls: Array<Record<string, unknown>> = [];
      const catalog = makeCatalogServices(db, glCalls);
      await assert.rejects(catalog.createProduct(createPayload() as never, auth), /OPENING_STOCK_ACCOUNT_MISSING/);
      assert.equal(await countTable(db, 'stock_movements'), 0, 'a rolled-back create must leave zero movement rows');
      assert.equal(
        await countTable(db, 'product_location_stock'),
        0,
        'a rolled-back create must leave zero location balances',
      );
      assert.equal(await countTable(db, 'products'), 0, 'a rolled-back create must leave no product row');
      console.log('  5. createProduct rollback leaves no row and no balance, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 6: rollback — importProducts. Same GL gate, same proof: no
  // product, no movement row, no location balance, no journal.
  {
    const { db } = await makeImportDb(false);
    try {
      const service = makeImportServices(db);
      await assert.rejects(
        service.importProducts(
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
          importAuth,
        ),
        /OPENING_STOCK_ACCOUNT_MISSING/,
      );
      assert.equal(await countTable(db, 'stock_movements'), 0, 'a rolled-back import must leave zero movement rows');
      assert.equal(
        await countTable(db, 'product_location_stock'),
        0,
        'a rolled-back import must leave zero location balances',
      );
      assert.equal(await countTable(db, 'products'), 0, 'a rolled-back import must leave no product row');
      assert.equal(await countTable(db, 'journal_entries'), 0, 'a rolled-back import must leave no journal');
      console.log('  6. importProducts rollback leaves no row and no balance, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 7: source pins — the three opening branches go through the
  // writer and nothing else; the GL posting calls stay.
  {
    const fashion = readFileSync(
      resolve(__dirname, '../../src/modules/catalog/services/catalog-product-fashion.service.ts'),
      'utf8',
    );
    const write = readFileSync(
      resolve(__dirname, '../../src/modules/catalog/services/catalog-product-write.service.ts'),
      'utf8',
    );
    const importProducts = readFileSync(
      resolve(__dirname, '../../src/modules/settings/services/settings-import/settings-import-products.ts'),
      'utf8',
    );
    const writerCalls = (source: string): number => (source.match(/recordStockMovement\(trx/g) ?? []).length;
    assert.equal(
      writerCalls(fashion),
      5,
      `expected 5 recordStockMovement calls in the fashion file, found ${writerCalls(fashion)}`,
    );
    assert.equal(
      writerCalls(write),
      1,
      `expected 1 recordStockMovement call in catalog-write, found ${writerCalls(write)}`,
    );
    assert.equal(
      writerCalls(importProducts),
      1,
      `expected 1 recordStockMovement call in settings-import-products, found ${writerCalls(importProducts)}`,
    );
    const directPls = (source: string): number =>
      (source.match(/insertInto\('product_location_stock'\)/g) ?? []).length;
    assert.equal(directPls(fashion), 0, 'the fashion file must not insert product_location_stock directly anymore');
    assert.equal(directPls(write), 0, 'catalog-write must not insert product_location_stock directly anymore');
    assert.equal(
      directPls(importProducts),
      0,
      'settings-import-products must not insert product_location_stock directly anymore',
    );
    const directRows = (source: string): number => (source.match(/insertInto\('stock_movements'\)/g) ?? []).length;
    assert.equal(
      directRows(fashion),
      0,
      'the fashion file must not hand-write a stock_movements row anymore (A9 converged the :554 zeroing-deduct row onto the writer)',
    );
    assert.equal(directRows(write), 0, 'catalog-write must not hand-write a stock_movements row anymore');
    assert.equal(
      directRows(importProducts),
      0,
      'settings-import-products must not hand-write a stock_movements row anymore',
    );
    const totals = (source: string): number => (source.match(/stockMovementTotal\(/g) ?? []).length;
    assert.equal(
      totals(fashion),
      0,
      'the fashion file must not compute the opening total directly anymore (A9 converged the zeroing-deduct total into the writer)',
    );
    assert.equal(totals(write), 0, 'catalog-write must not compute the opening total directly anymore');
    assert.equal(
      totals(importProducts),
      0,
      'settings-import-products must not compute the opening total directly anymore',
    );
    assert.ok(!fashion.includes('stock_qty: stock'), 'the fashion insert must not preset the global stock_qty');
    assert.ok(
      !write.includes('stock_qty: initialStockQty'),
      'the createProduct insert must not preset the global stock_qty',
    );
    assert.ok(
      !importProducts.includes('stock_qty: initialStockQty'),
      'the import insert must not preset the global stock_qty',
    );
    assert.ok(
      fashion.includes('postOpeningStock(trx, productId, stock, value.costPrice, resolvedWarehouseId, actor)'),
      'the fashion branch must still post the opening-stock journal',
    );
    assert.ok(
      write.includes('postOpeningStock(trx, productId, initialStockQty, draft.costPrice, resolvedLocationId, actor)'),
      'createProduct must still post the opening-stock journal',
    );
    assert.ok(
      importProducts.includes('postImportedOpeningStock(trx, {'),
      'importProducts must still post the opening-stock journal',
    );
    assert.ok(
      importProducts.includes('common/utils/stock-movement-writer'),
      'settings-import-products must import the ledger-module row-writer',
    );
    console.log('  7. source pins: passed');

    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 383);
    assert.equal(chain.length, 383);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/opening-balances-ledger.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5c-accounts-purchases.spec.ts');
    console.log('  8. evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('opening-balances-ledger: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
