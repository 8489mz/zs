/*
 * Phase 1 A9 (INV-PHASE1-A9-REMAINING-WRITER): the remaining service
 * sites converge on the row-writer — the fashion zeroing deduct and
 * the preorder conversion sale row.
 *
 * WHAT THIS PINS, driving the REAL services on PGlite:
 * 1. saveFashionGroup zeroing (:554): a removed variant whose stock
 *    cannot consolidate into a same-color target, saved with
 *    zeroRemovedStock, writes one 'deduct' row per location through
 *    the writer — qty, ledger scope before/after, unit cost,
 *    roundMoney total, reason 'fashion_matrix_adjustment', reference
 *    inventory_adjustment / removed id, the ledger's rawLocId (not
 *    the effectiveLocId guess), created_by — and the variant's
 *    balances go to zero. No pre-existing spec drove this path: the
 *    A3 spec covers consolidation (:461/:480/:700) and the stock
 *    edit (:738) only, and explicitly left the zeroing out.
 * 2. convertPreorderToSale (:751): the 'sale' row keeps total_cost
 *    NULL (omitTotalCost — the same NULL shape as the A7 sale rows)
 *    while carrying the carried scope before/after, the frozen lot
 *    unit cost, reason 'sale' (the writer defaults the missing
 *    reason to movementType), reference sale / sale id, branch and
 *    location — plus the balanced journal and the lot/product
 *    balances the guard spec already pins.
 *
 * COVERAGE MAP: archive (residual spec), adjustment / count / QA /
 * suppliers (phase1-a9-inventory-writer.spec.ts), maintenance /
 * returns / trade-in / purchase-return (their pre-existing driver
 * specs assert the row fields through the writer and are verified
 * green in the regression loop).
 *
 * RED-FIRST: the routing spec's static pins fail on the pre-A9 code;
 * the preorder NULL-total assertion fails on the old hand-written
 * row (it stored a computed total, not NULL) and the fashion
 * zeroing row had no driver at all.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../src/core/audit/audit.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

const auth = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'tester',
  permissions: ['canAdjustInventory', 'canEditPrice'],
} as unknown as AuthContext;

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

async function readRows(db: Kysely<Database>): Promise<MovementRow[]> {
  return (await (db as any).selectFrom('stock_movements').selectAll().orderBy('id').execute()) as MovementRow[];
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
    account: string;
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
  assert.equal(row.account_id, expected.account, 'account_id');
}

// ---- Fashion zeroing ------------------------------------------------------

async function makeFashionDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE products (
      id bigserial PRIMARY KEY, tenant_id text, account_id text,
      name text, name_en text, barcode text, sku text,
      catalog_updated_at timestamptz, item_type text, item_kind text,
      style_code text, color text, size text, bin_location text,
      track_serials boolean, category_id bigint, supplier_id bigint,
      cost_price numeric, retail_price numeric, wholesale_price numeric,
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
  `);
  return { pg, db };
}

function makeFashionService(db: Kysely<Database>): CatalogProductService {
  const fakeAudit = { log: async () => undefined };
  return new CatalogProductService(db, fakeAudit as unknown as AuditService, new InventoryScopeService(db));
}

async function seedFashionProduct(
  db: Kysely<Database>,
  row: {
    id: number;
    name: string;
    color: string;
    size: string;
    barcode: string;
    sku: string;
    cost: number;
    stock: number;
  },
): Promise<void> {
  const anyDb = db as unknown as Kysely<any>;
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
      style_code: '1001',
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

async function seedFashionLocationStock(
  db: Kysely<Database>,
  productId: number,
  locationId: number,
  qty: number,
): Promise<void> {
  const anyDb = db as unknown as Kysely<any>;
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

async function fashionBalances(
  db: Kysely<Database>,
  productId: number,
): Promise<{ globalQty: number; byLocation: Map<number, number> }> {
  const anyDb = db as unknown as Kysely<any>;
  const product = (await anyDb
    .selectFrom('products')
    .select('stock_qty')
    .where('id', '=', productId)
    .executeTakeFirst()) as {
    stock_qty: string;
  };
  const locs = (await anyDb
    .selectFrom('product_location_stock')
    .select(['location_id', 'qty'])
    .where('product_id', '=', productId)
    .execute()) as Array<{ location_id: number; qty: string }>;
  return {
    globalQty: Number(product.stock_qty),
    byLocation: new Map(locs.map((l) => [Number(l.location_id), Number(l.qty)])),
  };
}

// ---- Preorder conversion --------------------------------------------------

async function makePreorderDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, balance numeric);
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, customer_name text, customer_phone text, payment_type text, payment_channel text, subtotal numeric, discount numeric, tax_rate numeric, tax_amount numeric, total numeric, paid_amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, status text, note text, doc_no text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, cost_price numeric);
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, parent_id bigint, is_active boolean, description text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_cost_centers_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, allocated_capital numeric, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id text PRIMARY KEY DEFAULT ('alloc-' || md5(random()::text)), tenant_id text, sale_id bigint, sale_item_id bigint, lot_id text, project_id text, shipment_id text, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, reversal_of_allocation_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, agreed_unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 25, 22, 21, 26, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1120', 'عملاء', 'Receivables', 'asset', 'assets', true, false, false, false, true, false),
      (26, 't1', 't1', '4100', 'إيراد مبيعات', 'Sales revenue', 'revenue', 'income', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO customers VALUES (1, 't1', 'عميل الحجز', '01000000000', 0);
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO branches VALUES (1, 't1', 'Main Branch');
    INSERT INTO import_projects (id, tenant_id, project_no, title, allocated_capital, status, feasibility_data) VALUES ('proj-1', 't1', 'IMP-261109-0001', 'اختبار مشروع استيراد 001', 100, 'active', '{}');
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 'W-1', NULL, 0, 0, 0, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 0, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
  `);
  return db;
}

function makePreorderService(db: Kysely<Database>): any {
  const fakeFoundation: any = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function seedPreorderShipment(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('import_shipments' as never)
    .values({
      id: 'sh-1',
      tenant_id: 't1',
      container_number: 'C1',
      supplier_id: 1,
      status: 'Pending',
      exchange_rate_at_arrival: 50,
      cost_allocation_method: 'value',
      project_id: 'proj-1',
      shipping_cost_usd: 0,
      customs_cost_egp: 0,
      internal_transport_cost_egp: 0,
    } as never)
    .execute();
  await db
    .insertInto('import_shipment_items' as never)
    .values({
      id: 'sh-1-item',
      tenant_id: 't1',
      shipment_id: 'sh-1',
      product_id: 1,
      quantity: 10,
      factory_unit_price_usd: 50,
      shortage_handling_method: 'capitalize',
    } as never)
    .execute();
}

async function seedPreorder(db: Kysely<Database>, preorderNo: string, qty: number): Promise<string> {
  const row: any = await (db as any)
    .insertInto('import_container_preorders')
    .values({
      tenant_id: 't1',
      preorder_no: preorderNo,
      shipment_id: 'sh-1',
      customer_id: 1,
      product_id: 1,
      reserved_quantity: qty,
      unit_price_egp: 3000,
      total_price_egp: qty * 3000,
      deposit_amount_egp: 0,
      status: 'reserved',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(row.id);
}

async function postPreorderReceipt(db: Kysely<Database>, service: any): Promise<void> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', {
    status: 'Arrived',
    exchangeRateAtArrival: 50,
    receiptLocationId: 10,
  });
  const receipt: any = await (db as any)
    .selectFrom('import_inventory_receipts')
    .selectAll()
    .where('shipment_id', '=', 'sh-1')
    .executeTakeFirstOrThrow();
  assert.equal(receipt.state, 'posted');
}

async function main(): Promise<void> {
  // Case 1: fashion zeroing — the removed blue variant cannot consolidate
  // into any same-color target, so zeroRemovedStock zeroes it per
  // location through the writer: 4 -> 0 at A, 2 -> 0 at B.
  {
    const { db } = await makeFashionDb();
    try {
      await seedFashionProduct(db, {
        id: 1,
        name: 'قميص أحمر',
        color: 'red',
        size: 'S',
        barcode: 'T-RED-S',
        sku: 'SKU-RED-S',
        cost: 10,
        stock: 15,
      });
      await seedFashionProduct(db, {
        id: 2,
        name: 'قميص أزرق',
        color: 'blue',
        size: 'M',
        barcode: 'T-BLUE-M',
        sku: 'SKU-BLUE-M',
        cost: 10,
        stock: 6,
      });
      await seedFashionLocationStock(db, 1, 10, 10);
      await seedFashionLocationStock(db, 1, 20, 5);
      await seedFashionLocationStock(db, 2, 10, 4);
      await seedFashionLocationStock(db, 2, 20, 2);
      const catalog = makeFashionService(db);
      const result = (await catalog.saveFashionGroup(
        '1001',
        { rows: [fashionRow({ id: 1 })], zeroRemovedStock: true } as never,
        auth,
      )) as Record<string, unknown>;
      assert.equal(result.ok, true);
      assert.equal(result.archived, 1);
      const rows = await readRows(db);
      assert.equal(rows.length, 2, `expected 2 zeroing rows, got ${rows.length}`);
      const byLoc = new Map(rows.map((r) => [Number(r.location_id), r]));
      assertRowFields(byLoc.get(10)!, {
        type: 'deduct',
        qty: -4,
        before: 4,
        after: 0,
        unit: 10,
        total: 40,
        reason: 'fashion_matrix_adjustment',
        note: 'تسوية وتصفير رصيد المقاس الملغي (قميص أزرق) عند تعديل الموديل',
        refType: 'inventory_adjustment',
        refId: 2,
        branch: null,
        location: 10,
        account: 'a1',
      });
      assertRowFields(byLoc.get(20)!, {
        type: 'deduct',
        qty: -2,
        before: 2,
        after: 0,
        unit: 10,
        total: 20,
        reason: 'fashion_matrix_adjustment',
        note: 'تسوية وتصفير رصيد المقاس الملغي (قميص أزرق) عند تعديل الموديل',
        refType: 'inventory_adjustment',
        refId: 2,
        branch: null,
        location: 20,
        account: 'a1',
      });
      const removed = await fashionBalances(db, 2);
      assert.equal(removed.globalQty, 0);
      assert.equal(removed.byLocation.get(10), 0);
      assert.equal(removed.byLocation.get(20), 0);
      const kept = await fashionBalances(db, 1);
      assert.equal(kept.globalQty, 15, 'the kept variant is untouched');
      assert.equal(kept.byLocation.get(10), 10);
      assert.equal(kept.byLocation.get(20), 5);
      const anyDb = db as unknown as Kysely<any>;
      const removedRow = (await anyDb
        .selectFrom('products')
        .select('is_active')
        .where('id', '=', 2)
        .executeTakeFirst()) as {
        is_active: boolean;
      };
      assert.equal(removedRow.is_active, false);
      console.log('  1 passed: fashion zeroing writes one writer row per location');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: preorder conversion — the 'sale' row keeps total_cost NULL
  // (omitTotalCost, the A7 sale-row shape) with the carried scope
  // quantities, the frozen lot unit cost, and reason 'sale'.
  {
    const db = await makePreorderDb();
    try {
      const service = makePreorderService(db);
      await seedPreorderShipment(db);
      const preorderId = await seedPreorder(db, 'PO-1', 4);
      await postPreorderReceipt(db, service);
      const result = await service.convertPreorderToSale('t1', 1, preorderId, {});
      assert.equal(result.total, 12000);
      const preorder: any = await (db as any)
        .selectFrom('import_container_preorders')
        .selectAll()
        .where('id', '=', preorderId)
        .executeTakeFirstOrThrow();
      assert.equal(preorder.status, 'invoiced');
      assert.equal(Number(preorder.sale_invoice_id), result.saleId);
      const lot: any = await (db as any)
        .selectFrom('import_inventory_lots')
        .selectAll()
        .where('shipment_id', '=', 'sh-1')
        .executeTakeFirstOrThrow();
      assert.equal(Number(lot.remaining_quantity), 6);
      const product: any = await (db as any)
        .selectFrom('products')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 6);
      const rows = (await readRows(db)).filter((r) => r.reference_type === 'sale');
      assert.equal(rows.length, 1, `expected exactly one sale movement row, got ${rows.length}`);
      const row = rows[0];
      const sale: any = await (db as any)
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', result.saleId)
        .executeTakeFirstOrThrow();
      assertRowFields(row, {
        type: 'sale',
        qty: -4,
        before: 10,
        after: 6,
        unit: 2500,
        total: null,
        reason: 'sale',
        note: `صرف مخزني لتحويل حجز حاوية مسبق #${String(sale.doc_no)}`,
        refType: 'sale',
        refId: Number(result.saleId),
        branch: 1,
        location: 10,
        account: 't1',
      });
      const lines: any[] = await (db as any)
        .selectFrom('journal_entry_lines')
        .selectAll()
        .where(
          'journal_entry_id',
          '=',
          (
            await (db as any)
              .selectFrom('journal_entries')
              .select('id')
              .where('source_type', '=', 'sale')
              .where('source_id', '=', result.saleId)
              .executeTakeFirstOrThrow()
          ).id,
        )
        .execute();
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit, 'conversion journal must balance');
      assert.equal(debit, 22000, 'Revenue 12000 + COGS 10000');
      console.log('  2 passed: preorder conversion row keeps total NULL with reason sale');
    } finally {
      await db.destroy();
    }
  }

  console.log('phase1-a9-services-writer checks passed');
}

main()
  .then(() => console.log('phase1-a9-services-writer spec passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
