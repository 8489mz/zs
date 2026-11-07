/*
 * GRN freight allocation (INV-SHIPPING-ALLOCATION).
 *
 * THE DEFECT, proven live on test10k: shipping 20.00 on invoice
 * ZP-261105-001288 never reached item cost and the WAC stayed 58.82.
 * Batch 10 P1 fixed only the direct purchase-invoice receipt path
 * (createPurchase landedCosts). The second receipt path — a purchase
 * order received through a goods receipt note — had no freight
 * anywhere: the GRN form carries no freight field, postGoodsReceipt
 * blends the WAC from the bare unit cost only, and the GRNI journal
 * accrues the bare cost only. A merchant buying through the PO flow
 * (the flow the audit exercised) can never get shipping into item
 * cost at receipt.
 *
 * THE FIX, in the decided direction (freight IS allocated to item
 * cost): the receipt may now carry freight, allocated at posting time
 * by the same canonical allocator the direct invoice uses (value
 * proportion by default). The receipt blends the landed unit cost
 * into the WAC, the stock movement carries the landed cost, the GRNI
 * journal accrues the landed total (Dr 1140 / Cr 2125), and the
 * per-line allocation is stored on the GRN lines so the later GRN
 * bill settles the full landed accrual instead of stranding the
 * freight in 2125. The invoice ZP-261105-001288 itself predates the
 * Batch 10 fix (created 2026-11-05, fix pushed 2026-11-07) and stays
 * at 58.82 by the prospective-only rule; this fix covers every NEW
 * receipt.
 *
 * THE WORKED EXAMPLE, closed exactly: prior stock 15 @ 56.08
 * (pool 841.20), GRN receipt 1 unit @ 100.00 + freight 20.00.
 * Without freight the blend is (841.20 + 100) / 16 = 58.825, shown
 * as 58.82 at 2dp. With freight it is (841.20 + 120) / 16 = 60.075,
 * shown as 60.07 at 2dp — the tester's expected figure.
 *
 * WHAT THIS PINS, driving the REAL GoodsReceiptService
 * (createGoodsReceipt + postGoodsReceipt) on PGlite (fresh database
 * per case; the tenant foundation is stubbed as in the GRN journal
 * spec, no audit/idempotency stubs needed — this service does not
 * call them):
 * - Case 1, the tester example (EGP): 15 @ 56.08 + GRN 1 @ 100 +
 *   freight 20 -> stock 16, WAC 60.075 (60.07 at 2dp), GRNI journal
 *   Dr 1140 120 / Cr 2125 120, stock movement unit 120 / total 120,
 *   the GRN line carries allocated 20 / landed unit 120, and the
 *   receipt reads back freight 20.
 * - Case 2, no freight: the same receipt without freight posts
 *   exactly as before — stock 16, WAC 58.825 (58.82 at 2dp), journal
 *   100 / 100, movement total 100, no allocated cost.
 * - Case 3, multi-line value split: lines 200 + 100 with freight 30
 *   split 20 / 10 by value; WAC 65.066667; journal 330 / 330;
 *   movement totals 220 / 110.
 * - Case 4, fail-closed guards: a sub-minor freight amount is
 *   rejected at creation, and freight with nothing accepted is
 *   rejected at posting — both leave no GRN posting, no stock and
 *   no WAC change.
 * - Case 5, settlement: the GRN-bill accrual reconciles to the
 *   landed total (120, not the bare 100), so the bill clears the
 *   full GRNI journal including the freight; the bare path still
 *   reconciles to 100.
 * - Case 6, source pins: the service allocates through the canonical
 *   allocator and names the invariant, and the receipt modal sends
 *   the freight it collects.
 *
 * DELIBERATELY UNCHANGED: the bare unit_cost on GRN lines (the
 * three-way match still compares invoiced prices against bare
 * costs, so freight never shows up as a price variance); the
 * pharmacy batch unit cost (kept net, exactly as the direct
 * invoice leaves it); the post-posting landed-costs step (still the
 * place for costs that arrive after posting); the GRN-bill endpoint
 * itself (it now settles landed accruals, but no new bill UI is
 * added — the endpoint has no UI caller). This is not an end-to-end
 * post on live Postgres: journal_entry_lines DDL here is unbounded
 * numeric, as in the other book-digits specs.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { GoodsReceiptService } from '../../src/modules/purchases/services/goods-receipt.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { allocateGrnAccrual, allocateGrniBillPortion } from '../../src/modules/purchases/engines/grni-settlement.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'tester', permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
      name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
      allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '', account_type text DEFAULT '',
      normal_balance text DEFAULT '', is_system boolean DEFAULT false,
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
      track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE suppliers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, purchase_id bigint,
      paid_amount numeric DEFAULT 0, status text DEFAULT 'active', updated_by bigint, updated_at timestamptz);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, tax_rate numeric DEFAULT 0,
      prices_include_tax boolean DEFAULT false, total numeric, paid_amount numeric DEFAULT 0,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      grn_id bigint, po_id bigint, lifecycle_status text, matched_status text, three_way_match_status text,
      status text DEFAULT 'posted', supplier_invoice_no text,
      landed_cost_applied_at timestamptz, landed_cost_total numeric DEFAULT 0,
      cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, updated_at timestamptz);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint,
      product_name text, qty numeric, unit_cost numeric, unit_multiplier numeric DEFAULT 1, line_total numeric,
      unit_name text, category_id bigint, location_id bigint, batch_number text, serials text,
      grn_line_id bigint, grni_amount numeric, po_item_id bigint, received_qty numeric DEFAULT 0);
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
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint,
      location_id bigint, branch_id bigint, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint,
      batch_number text, expiry_date date, quantity numeric DEFAULT 0, unit_cost numeric, location_id bigint,
      supplier_name text, status text, notes text, created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text,
      amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint,
      branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      opened_by bigint, status text, branch_id bigint, expected_cash numeric DEFAULT 0, updated_at timestamptz);
    INSERT INTO accounting_settings VALUES
      (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
  `);
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 2125, 4100, 5100, 5190, 7290]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)',
      [code, 't1', String(code), code === 1150 || code === 2120]);
  }
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: 'EGP' } as never).execute();
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'timezone', value: 'Africa/Cairo' } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true } as never).execute();
}

function makeGrnService(db: Kysely<Database>): GoodsReceiptService {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const finance = new PurchasesFinanceService();
  return new GoodsReceiptService(db as any, posting as any, finance as any);
}

async function seedBase(db: Kysely<Database>): Promise<void> {
  await db.insertInto('branches' as never).values({ id: 5, tenant_id: 't1', default_stock_location_id: 1 } as never).execute();
  await db.insertInto('stock_locations' as never).values({ id: 1, tenant_id: 't1', branch_id: 5, name: 'Main' } as never).execute();
  await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier', balance: 0 } as never).execute();
  // The tester example: prior stock 15 @ 56.08 (pool 841.20).
  await db.insertInto('products' as never).values({
    id: 10, tenant_id: 't1', account_id: 'a1', name: 'Widget 10',
    stock_qty: 15, reserved_qty: 0, cost_price: 56.08, track_serials: false,
  } as never).execute();
  await db.insertInto('product_location_stock' as never).values({
    tenant_id: 't1', account_id: 'a1', product_id: 10, branch_id: 5, location_id: 1, qty: 15, reserved_qty: 0,
  } as never).execute();
}

async function seedPo(db: Kysely<Database>): Promise<void> {
  await db.insertInto('purchase_orders' as never).values({
    id: 7, tenant_id: 't1', account_id: 'a1', order_number: 'PO-7', supplier_id: 9,
    supplier_name: 'Supplier', warehouse_id: 1, subtotal: 300, tax_amount: 0, discount_amount: 0,
    total_amount: 300, status: 'confirmed', updated_at: new Date('2026-10-01'),
  } as never).execute();
  await db.insertInto('purchase_order_items' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', purchase_order_id: 7, product_id: 10,
    product_name: 'Widget 10', unit_name: 'piece', quantity: 10, received_quantity: 0,
    unit_cost: 100, tax_rate: 0, discount: 0, total: 1000,
  } as never).execute();
  await db.insertInto('purchase_order_items' as never).values({
    id: 2, tenant_id: 't1', account_id: 'a1', purchase_order_id: 7, product_id: 10,
    product_name: 'Widget 10', unit_name: 'piece', quantity: 10, received_quantity: 0,
    unit_cost: 100, tax_rate: 0, discount: 0, total: 1000,
  } as never).execute();
}

type GrnLineInput = { poItemId: number; qty: number; accepted: number; rejected: number; unitCost: number };

async function createGrn(db: Kysely<Database>, freight: number | undefined, lines: GrnLineInput[]): Promise<number> {
  const grn = makeGrnService(db);
  const created = await grn.createGoodsReceipt({
    purchaseOrderId: 7,
    supplierId: 9,
    locationId: 1,
    ...(freight != null ? { freight } : {}),
    lines: lines.map((l) => ({
      purchaseOrderItemId: l.poItemId,
      productId: 10,
      orderedQty: l.qty,
      receivedQty: l.qty,
      acceptedQty: l.accepted,
      rejectedQty: l.rejected,
      unitCost: l.unitCost,
    })),
  } as any, auth);
  return Number(created.id);
}

async function readJournal(db: Kysely<Database>): Promise<any> {
  const header = await (db as any).selectFrom('journal_entries').selectAll().executeTakeFirst();
  const lines = header
    ? await (db as any).selectFrom('journal_entry_lines').selectAll().orderBy('id', 'asc').execute()
    : [];
  return { header, lines };
}

async function readProduct(db: Kysely<Database>): Promise<{ stockQty: number; costPrice: number }> {
  const row = await (db as any).selectFrom('products').select(['stock_qty', 'cost_price']).where('id', '=', 10).executeTakeFirstOrThrow();
  return { stockQty: Number(row.stock_qty), costPrice: Number(row.cost_price) };
}

async function readGrnLines(db: Kysely<Database>, grnId: number): Promise<any[]> {
  return (db as any).selectFrom('goods_receipt_lines').selectAll().where('grn_id', '=', grnId).orderBy('id', 'asc').execute();
}

async function main(): Promise<void> {
  // Case 1: the tester example — GRN 1 @ 100 + freight 20 -> WAC 60.075, journal 120 / 120.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      const grnId = await createGrn(db, 20, [{ poItemId: 1, qty: 1, accepted: 1, rejected: 0, unitCost: 100 }]);
      const created = await grn.getGoodsReceipt(grnId, auth);
      assert.equal(Number(created.freightAmount), 20, 'freight is stored on the receipt');
      const result = await grn.postGoodsReceipt(grnId, auth);
      assert.equal(result.status, 'posted');
      assert.equal(Number(result.freightAmount), 20);
      assert.equal(Number(result.totalGrniAmount), 120, 'GRNI accrues the landed total');
      const { header, lines } = await readJournal(db);
      assert.ok(header, 'GRNI journal posted');
      assert.equal(lines.length, 2);
      const invLine = lines.find((l: any) => Number(l.account_id) === 1140);
      const grniLine = lines.find((l: any) => Number(l.account_id) === 2125);
      assert.equal(Number(invLine.debit), 120);
      assert.equal(Number(invLine.credit), 0);
      assert.equal(Number(grniLine.debit), 0);
      assert.equal(Number(grniLine.credit), 120);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 16, 'goods enter stock');
      assert.equal(product.costPrice, 60.075, 'WAC blends the landed cost: (841.20 + 120) / 16');
      const movement = await (db as any).selectFrom('stock_movements').select(['qty', 'unit_cost', 'total_cost']).executeTakeFirstOrThrow();
      assert.equal(Number(movement.qty), 1);
      assert.equal(Number(movement.unit_cost), 120, 'movement carries the landed unit cost');
      assert.equal(Number(movement.total_cost), 120, 'movement total equals the posted leg');
      assert.equal(Number(movement.total_cost), Number(invLine.debit), 'stored total and posted leg never diverge');
      const grnLines = await readGrnLines(db, grnId);
      assert.equal(grnLines.length, 1);
      assert.equal(Number(grnLines[0].allocated_landed_cost), 20, 'the line carries its freight share');
      assert.equal(Number(grnLines[0].landed_unit_cost), 120, 'the line carries its landed unit cost');
      assert.equal(Number(grnLines[0].unit_cost), 100, 'the bare unit cost is untouched');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: no freight — the receipt posts exactly as before.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      const grnId = await createGrn(db, undefined, [{ poItemId: 1, qty: 1, accepted: 1, rejected: 0, unitCost: 100 }]);
      const result = await grn.postGoodsReceipt(grnId, auth);
      assert.equal(result.status, 'posted');
      assert.equal(Number(result.totalGrniAmount), 100);
      const { lines } = await readJournal(db);
      const invLine = lines.find((l: any) => Number(l.account_id) === 1140);
      assert.equal(Number(invLine.debit), 100);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 16);
      assert.equal(product.costPrice, 58.825, 'WAC blends the bare cost: (841.20 + 100) / 16');
      const movement = await (db as any).selectFrom('stock_movements').select(['unit_cost', 'total_cost']).executeTakeFirstOrThrow();
      assert.equal(Number(movement.unit_cost), 100);
      assert.equal(Number(movement.total_cost), 100);
      const grnLines = await readGrnLines(db, grnId);
      assert.equal(Number(grnLines[0].allocated_landed_cost), 0, 'no freight, no allocation');
      assert.equal(grnLines[0].landed_unit_cost, null, 'no freight, no landed unit cost');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: multi-line value split — lines 200 + 100 with freight 30 split 20 / 10.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      const grnId = await createGrn(db, 30, [
        { poItemId: 1, qty: 2, accepted: 2, rejected: 0, unitCost: 100 },
        { poItemId: 2, qty: 1, accepted: 1, rejected: 0, unitCost: 100 },
      ]);
      const result = await grn.postGoodsReceipt(grnId, auth);
      assert.equal(Number(result.totalGrniAmount), 330, 'GRNI accrues items 300 + freight 30');
      const { lines } = await readJournal(db);
      const invLine = lines.find((l: any) => Number(l.account_id) === 1140);
      assert.equal(Number(invLine.debit), 330);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 18, '15 + 3 received');
      // The blend runs per line in product order (the same sequential
      // blend the direct invoice performs): line 1 takes the WAC to
      // 62.423529, line 2 to 65.066666 — one micro-unit below the
      // single-blend 65.066667, invisible at book digits (65.07).
      assert.equal(product.costPrice, 65.066666, 'WAC blends the landed cost line by line');
      assert.equal(Number(product.costPrice.toFixed(2)), 65.07, 'the merchant-visible WAC is 65.07');
      const movements = await (db as any).selectFrom('stock_movements').select(['unit_cost', 'total_cost']).orderBy('id', 'asc').execute();
      assert.equal(movements.length, 2);
      assert.equal(Number(movements[0].unit_cost), 110, 'line 1 landed unit: 100 + 20 / 2');
      assert.equal(Number(movements[0].total_cost), 220);
      assert.equal(Number(movements[1].unit_cost), 110, 'line 2 landed unit: 100 + 10 / 1');
      assert.equal(Number(movements[1].total_cost), 110);
      const grnLines = await readGrnLines(db, grnId);
      assert.equal(Number(grnLines[0].allocated_landed_cost), 20);
      assert.equal(Number(grnLines[1].allocated_landed_cost), 10);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: fail-closed guards — sub-minor freight, and freight with nothing accepted.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db);
      const grn = makeGrnService(db);
      await assert.rejects(
        () => createGrn(db, 20.005, [{ poItemId: 1, qty: 1, accepted: 1, rejected: 0, unitCost: 100 }]),
        /دقة عملة الأساس/,
        'a sub-minor freight amount is rejected at creation',
      );
      const grnId = await createGrn(db, 20, [{ poItemId: 1, qty: 1, accepted: 0, rejected: 1, unitCost: 100 }]);
      await assert.rejects(
        () => grn.postGoodsReceipt(grnId, auth),
        /الشحن يحتاج صنفاً مقبولاً/,
        'freight with nothing accepted is rejected at posting',
      );
      const { header } = await readJournal(db);
      assert.equal(header, undefined, 'no journal after the rejected posting');
      const product = await readProduct(db);
      assert.equal(product.stockQty, 15, 'no stock enters');
      assert.equal(product.costPrice, 56.08, 'the WAC is unchanged');
      const movements = await (db as any).selectFrom('stock_movements').select('id').execute();
      assert.equal(movements.length, 0, 'no stock movement is written');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: settlement — the GRN-bill accrual reconciles to the landed total, not the bare one.
  {
    const landed = [...allocateGrnAccrual([
      { id: 1, acceptedQty: 1, unitCost: 100, landedLineTotal: 120 },
    ], 2).entries()];
    assert.deepEqual(landed, [[1, 12000]], 'the landed accrual clears the full journal total');
    const portion = allocateGrniBillPortion({
      lineAccrualMinor: 12000, acceptedQty: 1, previouslyBilledQty: 0, previouslyClearedMinor: 0, newQty: 1,
    });
    assert.equal(portion, 12000, 'billing the full receipt clears the whole landed accrual');
    const bare = [...allocateGrnAccrual([
      { id: 1, acceptedQty: 1, unitCost: 100 },
    ], 2).entries()];
    assert.deepEqual(bare, [[1, 10000]], 'the bare path is unchanged when no freight is carried');
  }

  // Case 6: source pins — the canonical allocator and the modal wiring.
  {
    const here = __dirname;
    const serviceSource = readFileSync(resolve(here, '../../src/modules/purchases/services/goods-receipt.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('allocateLandedCosts'), 'postGoodsReceipt allocates through the canonical allocator');
    assert.ok(serviceSource.includes('INV-SHIPPING-ALLOCATION'), 'postGoodsReceipt names the invariant');
    const modalSource = readFileSync(resolve(here, '../../../frontend/src/features/purchases/components/GoodsReceiptModal.tsx'), 'utf8');
    assert.ok(modalSource.includes('freight: freightAmount'), 'the receipt modal sends the freight it collects');
    const apiSource = readFileSync(resolve(here, '../../../frontend/src/features/purchases/api/goods-receipts.api.ts'), 'utf8');
    assert.ok(apiSource.includes('freight?: number'), 'the receipt payload type carries freight');
    console.log('  source pins passed');
  }

  console.log('grn freight allocation checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
