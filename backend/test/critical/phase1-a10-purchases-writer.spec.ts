import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { GoodsReceiptService } from '../../src/modules/purchases/services/goods-receipt.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 A10 — purchases sites through the writer (INV-PHASE1-A10-ROUNDING-UNIFICATION).
 *
 * The three A8-deferred purchases sites now go through recordStockMovement
 * on the unified rounding (the writer-level proof is
 * phase1-a10-rounding.spec.ts; this spec drives the REAL services on
 * PGlite and pins each site's stored total identical to the pre-migration
 * spelling to the piastre):
 * - GRN post (composite): 3 x 33.375 + freight 1 books 101.13 with unit
 *   33.708333, and the stored total equals the posted GRNI leg (the A8
 *   §4 concrete case, now through the real service).
 * - create (composite + tax-inclusive reassociation): 1 carton of 12 @
 *   33.33 tax-inclusive 10% + freight 1 books 31.30 with unit 2.608333
 *   and qty 12 — roundMoney(12 x 2.524999...) equals roundMoney(30.3 x 1)
 *   (BF1, 2M lines).
 * - receive-goods (full-precision): 33.33 / 12 / 1.1 x 12 books 30.30
 *   with unit 2.525 — the same total the old spelling stored. (No
 *   divergence is visible at this quantity: the 6dp error needs
 *   container quantities to cross a boundary — BF2b — and the
 *   divergence class is pinned at writer level in the routing spec,
 *   §2, with the exact A8 numbers at qty 1: 2.52 vs 2.53.)
 * - Rollback: a drug line without batch/expiry throws AFTER the writer
 *   call, so the row must roll back with it — 0 rows, stock unchanged.
 *
 * Harness: the purchase-landed-cost-at-receipt DDL (the superset for
 * create/receive) plus the GRN tables (purchase_orders,
 * purchase_order_items, goods_receipt_notes, goods_receipt_lines) and
 * import_receipt_id in stock_movements (the writer always inserts it).
 * Audit + idempotency are stubbed no-ops; the tenant foundation is
 * stubbed as in the commercial-posting spec; the query service is
 * stubbed for the response envelope only.
 */

const auth = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'tester',
  permissions: [],
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, is_active boolean DEFAULT true, location_type text, name text);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
      name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
      allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '',
      is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false);
    CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
      bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
      inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
      cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
      purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
      lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
      period_number int, start_date date, end_date date);
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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text,
      stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0,
      track_serials boolean DEFAULT false, updated_at timestamptz, item_type text, item_kind text,
      style_code text, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, default_location_id bigint,
      is_active boolean DEFAULT true);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE suppliers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text,
      amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, purchase_id bigint,
      paid_amount numeric DEFAULT 0, status text DEFAULT 'active', updated_by bigint, updated_at timestamptz);
    CREATE TABLE purchases (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      supplier_invoice_no text, payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric, paid_amount numeric DEFAULT 0,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted',
      prices_include_tax boolean DEFAULT false, tax_rate numeric DEFAULT 0,
      landed_cost_total numeric DEFAULT 0, landed_cost_allocation_method text, landed_cost_notes text, landed_cost_applied_at timestamptz,
      note text, duplicate_override_reason text, duplicate_overridden_by bigint, cancel_reason text,
      required_date timestamptz, currency text, company_name text, contact_id bigint, shipping_address_id bigint,
      cost_center_id bigint, project_id bigint, import_project_id text, terms_template text, matched_status text,
      cancelled_by bigint, cancelled_at timestamptz, updated_at timestamptz);
    CREATE TABLE purchase_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint,
      product_name text, qty numeric, unit_cost numeric, unit_multiplier numeric DEFAULT 1, line_total numeric,
      unit_name text, location_id bigint, category_id bigint, received_qty numeric, serials text, batch_number text,
      grn_line_id bigint, grni_amount numeric, allocated_landed_cost numeric, landed_unit_cost numeric, po_item_id bigint);
    CREATE TABLE purchase_orders (id bigint PRIMARY KEY, tenant_id text, account_id text, order_number text,
      supplier_id bigint, supplier_name text, supplier_phone text, warehouse_id bigint, warehouse_name text,
      subtotal numeric DEFAULT 0, tax_amount numeric DEFAULT 0, discount_amount numeric DEFAULT 0, total_amount numeric DEFAULT 0,
      status text DEFAULT 'draft', expected_delivery_date date, converted_purchase_id bigint, notes text,
      created_by bigint, created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE purchase_order_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_order_id bigint,
      product_id bigint, product_name text, unit_name text, quantity numeric, received_quantity numeric DEFAULT 0,
      unit_cost numeric DEFAULT 0, tax_rate numeric DEFAULT 0, discount numeric DEFAULT 0, total numeric DEFAULT 0,
      notes text, created_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE goods_receipt_notes (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      purchase_order_id bigint, supplier_id bigint, location_id bigint, received_at timestamptz,
      received_by bigint, supplier_delivery_note_ref text, status text DEFAULT 'draft', notes text,
      freight_amount numeric DEFAULT 0,
      grni_journal_entry_id bigint, pending_review boolean NOT NULL DEFAULT FALSE, pending_review_reason text,
      created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE goods_receipt_lines (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, grn_id bigint,
      purchase_order_item_id bigint, product_id bigint, ordered_qty numeric, received_qty numeric,
      accepted_qty numeric, rejected_qty numeric, rejection_reason text, batch_number text,
      expiry_date date, manufacturing_date date, unit_cost numeric, allocated_landed_cost numeric DEFAULT 0,
      landed_unit_cost numeric, quarantine_location_id bigint,
      coa_document_id bigint, over_received_qty numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE purchase_landed_costs (id bigserial PRIMARY KEY, tenant_id text, purchase_id bigint, cost_type text,
      description text, amount numeric, vendor_id bigint, allocation_method text);
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text,
      invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, note text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint,
      product_id bigint, product_name text, qty numeric, unit_total numeric, line_total numeric,
      allocated_tax numeric, cost_price numeric, sale_item_id bigint, purchase_item_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
      reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint,
      location_id bigint, branch_id bigint, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, product_id bigint,
      location_id bigint, quantity numeric DEFAULT 0, batch_number text);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text,
      amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint,
      branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      opened_by bigint, status text, branch_id bigint, expected_cash numeric DEFAULT 0, updated_at timestamptz);
    INSERT INTO accounting_settings VALUES
      (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
  `);
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 2125, 4100, 5100, 5190, 6950, 7290]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)', [
      code,
      't1',
      String(code),
      code === 1150 || code === 2120,
    ]);
  }
  await pg.query(
    `INSERT INTO stock_locations(id,tenant_id,branch_id,is_active,location_type) VALUES (7,'t1',NULL,true,NULL)`,
  );
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db
    .insertInto('settings' as never)
    .values({ tenant_id: 't1', key: 'currency', value: code } as never)
    .execute();
  await db
    .insertInto('currency_exchange_rates' as never)
    .values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never)
    .execute();
}

function makeWriteService(db: Kysely<Database>): PurchasesWriteService {
  const foundation = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined };
  const idempotencyStub = {};
  const queryStub = {
    getPurchaseById: async () => ({ purchase: { id: 1, status: 'posted' } }),
    listPurchases: async () => ({ purchases: [] }),
  };
  return new PurchasesWriteService(
    db as any,
    new TransactionHelper(),
    auditStub as any,
    new PurchasesFinanceService(),
    queryStub as any,
    posting as any,
    idempotencyStub as any,
  );
}

function makeGrnService(db: Kysely<Database>): GoodsReceiptService {
  const foundation = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const finance = new PurchasesFinanceService();
  return new GoodsReceiptService(db as any, posting as any, finance as any);
}

async function seedProduct(db: Kysely<Database>, id: number, stockQty: number, costPrice: number): Promise<void> {
  await db
    .insertInto('products' as never)
    .values({
      id,
      tenant_id: 't1',
      account_id: 'a1',
      name: `Product ${id}`,
      stock_qty: stockQty,
      reserved_qty: 0,
      cost_price: costPrice,
      track_serials: false,
    } as never)
    .execute();
}

async function seedBase(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('branches' as never)
    .values({ id: 5, tenant_id: 't1', default_stock_location_id: 1 } as never)
    .execute();
  await db
    .insertInto('stock_locations' as never)
    .values({ id: 1, tenant_id: 't1', branch_id: 5, name: 'Main' } as never)
    .execute();
  await db
    .insertInto('suppliers' as never)
    .values({ id: 9, tenant_id: 't1', name: 'Supplier', balance: 0 } as never)
    .execute();
  await seedProduct(db, 10, 0, 10);
}

async function seedPo(db: Kysely<Database>, quantity: number): Promise<void> {
  await db
    .insertInto('purchase_orders' as never)
    .values({
      id: 7,
      tenant_id: 't1',
      account_id: 'a1',
      order_number: 'PO-7',
      supplier_id: 9,
      supplier_name: 'Supplier',
      warehouse_id: 1,
      subtotal: quantity * 10,
      tax_amount: 0,
      discount_amount: 0,
      total_amount: quantity * 10,
      status: 'confirmed',
      updated_at: new Date('2026-10-01'),
    } as never)
    .execute();
  await db
    .insertInto('purchase_order_items' as never)
    .values({
      id: 1,
      tenant_id: 't1',
      account_id: 'a1',
      purchase_order_id: 7,
      product_id: 10,
      product_name: 'Widget 10',
      unit_name: 'piece',
      quantity,
      received_quantity: 0,
      unit_cost: 10,
      tax_rate: 0,
      discount: 0,
      total: quantity * 10,
    } as never)
    .execute();
}

async function seedGrn(
  db: Kysely<Database>,
  grnId: number,
  accepted: number,
  rejected: number,
  unitCost: number,
  freight = 0,
): Promise<void> {
  await db
    .insertInto('goods_receipt_notes' as never)
    .values({
      id: grnId,
      tenant_id: 't1',
      account_id: 'a1',
      doc_no: `GRN-${grnId}`,
      purchase_order_id: 7,
      supplier_id: 9,
      location_id: 1,
      received_at: new Date('2026-10-01T08:00:00.000Z'),
      received_by: 1,
      status: 'draft',
      freight_amount: freight,
    } as never)
    .execute();
  await db
    .insertInto('goods_receipt_lines' as never)
    .values({
      id: grnId,
      tenant_id: 't1',
      account_id: 'a1',
      grn_id: grnId,
      purchase_order_item_id: 1,
      product_id: 10,
      ordered_qty: accepted + rejected,
      received_qty: accepted + rejected,
      accepted_qty: accepted,
      rejected_qty: rejected,
      unit_cost: unitCost,
    } as never)
    .execute();
}

async function readMovement(
  db: Kysely<Database>,
  referenceType: string,
  referenceId: number,
): Promise<Record<string, string>> {
  return (await (db as any)
    .selectFrom('stock_movements')
    .select(['movement_type', 'qty', 'unit_cost', 'total_cost'])
    .where('reference_type', '=', referenceType)
    .where('reference_id', '=', referenceId)
    .executeTakeFirstOrThrow()) as unknown as Record<string, string>;
}

async function readStock(db: Kysely<Database>, id: number): Promise<number> {
  const row = (await (db as any)
    .selectFrom('products')
    .select('stock_qty')
    .where('id', '=', id)
    .executeTakeFirstOrThrow()) as unknown as { stock_qty: string };
  return Number(row.stock_qty);
}

function basePayload(overrides: Record<string, unknown> = {}): any {
  return {
    supplierId: 9,
    paymentType: 'credit',
    discount: 0,
    taxRate: 0,
    pricesIncludeTax: false,
    locationId: 7,
    items: [{ productId: 10, qty: 1, cost: 100 }],
    ...overrides,
  };
}

async function main(): Promise<void> {
  // Case 1: GRN with freight — the A8 §4 composite through the real
  // service: 3 x 33.375 + freight 1 books 101.13 (not 101.12), the
  // stored total equals the posted GRNI leg, and the journal is 101.13.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 10);
      await seedGrn(db, 1, 3, 0, 33.375, 1);
      const grn = makeGrnService(db);
      const result = await grn.postGoodsReceipt(1, auth);
      assert.equal(result.status, 'posted');
      assert.equal(result.totalGrniAmount, 101.13, 'journal amount is the composite total');
      const movement = await readMovement(db, 'goods_receipt', 1);
      assert.equal(movement.movement_type, 'goods_receipt');
      assert.equal(Number(movement.qty), 3);
      assert.equal(Number(movement.unit_cost), 33.708333, 'stored unit is the landed 6dp unit');
      assert.equal(Number(movement.total_cost), 101.13, 'stored total is the composite 101.13');
      const entry = (await (db as any)
        .selectFrom('journal_entries')
        .select('id')
        .where('source_type', '=', 'goods_receipt')
        .where('source_id', '=', 1)
        .executeTakeFirstOrThrow()) as unknown as { id: number };
      const invLine = (await (db as any)
        .selectFrom('journal_entry_lines')
        .select(['debit', 'credit'])
        .where('journal_entry_id', '=', Number(entry.id))
        .where('account_id', '=', 1140)
        .executeTakeFirstOrThrow()) as unknown as { debit: string; credit: string };
      assert.equal(Number(invLine.debit), 101.13, 'posted leg equals the stored total');
      assert.equal(await readStock(db, 10), 3, 'goods enter stock');
    } finally {
      await pg.close();
    }
  }

  // Case 2: create with tax-inclusive prices, a carton multiplier and
  // freight — 1 carton of 12 @ 33.33 incl. 10% tax + freight 1 books
  // 31.30 with unit 2.608333 and qty 12 (reassociation: 12 x
  // 2.524999... rounds to the same 30.30 as 30.3 x 1).
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedProduct(db, 10, 0, 10);
      await db
        .insertInto('suppliers' as never)
        .values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never)
        .execute();
      const svc = makeWriteService(db);
      const result = (await svc.createPurchase(
        basePayload({
          pricesIncludeTax: true,
          taxRate: 10,
          items: [{ productId: 10, qty: 1, cost: 33.33, unitMultiplier: 12 }],
          landedCosts: {
            allocationMethod: 'value',
            costs: [{ costType: 'freight', description: 'Freight', amount: 1 }],
          },
        }),
        auth,
      )) as unknown as { purchaseId: number };
      const purchaseId = Number(result.purchaseId);
      assert.ok(purchaseId > 0, 'a purchase id is returned');
      const movement = await readMovement(db, 'purchase', purchaseId);
      assert.equal(movement.movement_type, 'purchase');
      assert.equal(Number(movement.qty), 12, 'qty is the base-unit increase');
      assert.equal(Number(movement.unit_cost), 2.608333, 'stored unit is the landed 6dp unit');
      assert.equal(Number(movement.total_cost), 31.3, 'stored total is the composite 31.30');
      const item = (await (db as any)
        .selectFrom('purchase_items')
        .select(['allocated_landed_cost', 'landed_unit_cost'])
        .where('purchase_id', '=', purchaseId)
        .executeTakeFirstOrThrow()) as unknown as Record<string, string>;
      assert.equal(Number(item.allocated_landed_cost), 1, 'the full freight share lands on the one line');
      // The item row's landed unit is per PURCHASE unit (net 30.3 + 1/1),
      // while the movement row's unit is per BASE unit (2.608333) — two
      // different units by design, both pre-existing spellings.
      assert.equal(Number(item.landed_unit_cost), 31.3);
      assert.equal(await readStock(db, 10), 12, 'stock rises by the base-unit increase');
    } finally {
      await pg.close();
    }
  }

  // Case 3: receive-goods with the repeating-decimal effective unit —
  // 33.33 / 12 / 1.1 x 12 books 30.30 with unit 2.525 (the old total,
  // through the writer's full-precision unit).
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedProduct(db, 10, 0, 10);
      await db
        .insertInto('suppliers' as never)
        .values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never)
        .execute();
      await db
        .insertInto('purchases' as never)
        .values({
          id: 1,
          tenant_id: 't1',
          account_id: 'a1',
          supplier_id: 9,
          payment_type: 'credit',
          subtotal: 33.33,
          tax_amount: 3.03,
          total: 33.33,
          branch_id: null,
          location_id: 7,
          status: 'posted',
          prices_include_tax: true,
          tax_rate: 10,
        } as never)
        .execute();
      await db
        .insertInto('purchase_items' as never)
        .values({
          id: 1,
          tenant_id: 't1',
          account_id: 'a1',
          purchase_id: 1,
          product_id: 10,
          product_name: 'Widget 10',
          qty: 1,
          unit_cost: 33.33,
          unit_multiplier: 12,
          line_total: 33.33,
          unit_name: 'piece',
          location_id: 7,
          received_qty: 0,
        } as never)
        .execute();
      const svc = makeWriteService(db);
      const result = await svc.receivePurchaseGoods(1, [{ itemId: 1, receivedQty: 1 }], auth);
      assert.equal(result.purchaseId, 1);
      const movement = await readMovement(db, 'purchase', 1);
      assert.equal(movement.movement_type, 'purchase_receipt');
      assert.equal(Number(movement.qty), 12, 'qty is the base-unit increase');
      assert.equal(Number(movement.unit_cost), 2.525, 'stored unit is the 6dp effective unit');
      assert.equal(Number(movement.total_cost), 30.3, 'stored total is the old 30.30');
      assert.equal(await readStock(db, 10), 12, 'stock rises by the base-unit increase');
    } finally {
      await pg.close();
    }
  }

  // Case 4: rollback — a drug line without batch/expiry throws AFTER
  // the writer call, so the row must roll back with it: 0 rows, stock
  // unchanged.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 10);
      await seedGrn(db, 1, 3, 0, 33.375);
      await db
        .insertInto('pharmacy_drugs' as never)
        .values({ id: 1, tenant_id: 't1', product_id: 10 } as never)
        .execute();
      const grn = makeGrnService(db);
      await assert.rejects(grn.postGoodsReceipt(1, auth), /تشغيلة|صلاحية/);
      const rows = (await (db as any).selectFrom('stock_movements').selectAll().execute()) as unknown as Array<unknown>;
      assert.equal(rows.length, 0, 'no movement row survives the rollback');
      assert.equal(await readStock(db, 10), 0, 'stock is unchanged');
    } finally {
      await pg.close();
    }
  }
}

main()
  .then(() => {
    console.log('phase1-a10-purchases-writer.spec: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('phase1-a10-purchases-writer.spec: FAIL');
    console.error(err);
    process.exit(1);
  });
