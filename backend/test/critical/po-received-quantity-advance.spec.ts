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
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { PurchasesQueryService } from '../../src/modules/purchases/services/purchases-query.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { computePoReceiptStatus } from '../../src/modules/purchases/engines/purchase-order-receipt.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Purchase-order received-quantity advance (INV-PO-RECEIVED-QUANTITY-ADVANCE).
 *
 * THE DEFECT, from the Slice 3 grounding (retail-slice3-purchases-
 * grounding.md, P5): zero `updateTable('purchase_order_items')` calls
 * existed anywhere in the backend, and no writer ever moved a purchase
 * order's status to `partially_received` / `received`. GRN posting and
 * `receivePurchaseGoods` checked the PO only. `received_quantity` stayed
 * 0 forever, so the reorder engine's `incoming_qty = SUM(quantity -
 * received_quantity)` permanently overstated incoming stock, and PO
 * lists/statuses never showed partial receipt. The GRN guard accepting
 * `partially_received` / `received` was dead code in practice.
 *
 * THE FIX: both receipt paths call the single helper
 * `advancePurchaseOrderReceipt` inside the SAME transaction as the
 * stock write, on the same handle, after the stock writes succeed — so
 * a failed receipt advances nothing. The helper locks the order and
 * its items, adds the received quantity to each item's
 * `received_quantity` at 3dp, and moves the order to
 * `partially_received` when any item is short of its ordered quantity
 * and to `received` only when every item is at or past it (0.001
 * tolerance). A `converted_to_bill` order keeps its status while its
 * items still advance, so the conversion marker that blocks a second
 * conversion survives.
 *
 * DECISIONS, grounded in existing codebase patterns (flagged loudly):
 * (1) Quantity basis — PO-item quantity units, never base stock units.
 *     The legacy receipt cap compares `received_qty` against the bill
 *     item `qty`, and the GRN accepted quantity is ordered units; the
 *     qty x unit_multiplier product is the ledger quantity, not the
 *     ordered quantity. Case 3 pins the unit basis with a multiplier
 *     of 2: receiving 5 cartons advances the PO item by 5, not 10.
 * (2) Receivable statuses — `confirmed`, `partially_received`,
 *     `received`, and `converted_to_bill` only, the same vocabulary
 *     the GRN guards already accept. Any other status fails closed in
 *     the helper, which also newly guards the legacy path (it never
 *     checked the PO status at all). Rejected GRN quantities never
 *     advance: only accepted stock counts as received.
 * (3) Non-receipt paths advance nothing. `createBillFromReceipts`
 *     invoices already-posted GRNs without adding stock, `convertToBill`
 *     creates a draft bill without posting stock, and `updatePurchase`
 *     is unreachable for every purchase status (posted is forbidden,
 *     draft / purchase_order is unsupported, grn_bill is immutable) —
 *     the source pin in Case 7 proves the advance lives only in the
 *     two receipt transactions.
 * (4) The draft-partial guard is unchanged: a draft bill cannot take a
 *     partial legacy receipt (`PURCHASE_PARTIAL_RECEIPT_REQUIRES_GRN`),
 *     so the partial legacy case seeds a posted bill — the only
 *     purchase status for which the code permits a partial legacy
 *     receipt — to prove the advance itself.
 *
 * DELIBERATELY UNCHANGED: the GRN journal (still the direct-insert
 * Slice 3 P2 shape), the reorder engine (Slice 4 P1, next package),
 * RFQ award, landed-cost subledger, and every receipt cap/guard.
 * Prospective only: historical purchase orders keep their stored
 * `received_quantity` of 0; no backfill, no journal rewrite. This is
 * not an end-to-end post on live Postgres: journal_entry_lines DDL
 * here is unbounded numeric, as in the other book-digits specs, and
 * the GRN/bill fixtures are seeded to the shape the services write.
 *
 * WHAT THIS PINS, driving the REAL GoodsReceiptService and the REAL
 * PurchasesWriteService on PGlite (fresh database per case; audit +
 * idempotency are stubbed no-ops, the tenant foundation is stubbed as
 * in the commercial-posting spec, and the query service is stubbed
 * for the response envelope only — no pinned assertion reads it):
 * - Case 1, GRN partial: 6 of 10 + 4 of 4 advances and sets
 *   `partially_received`.
 * - Case 2, GRN completing: a second receipt over a seeded partial
 *   sets `received`.
 * - Case 3, legacy full receipt on a draft PO bill (multiplier 2):
 *   PO units advance, status `received`, bill posts.
 * - Case 4, legacy partial on a posted bill: advances and sets
 *   `partially_received`.
 * - Case 5, legacy over-receipt: throws, PO unchanged.
 * - Case 6, GRN double-post: second post throws, advance applied once.
 * - Case 7, converted_to_bill keeps its status while items advance.
 * - Case 8, source pin + invariant pin + pure status computation pin.
 */

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
    CREATE TABLE goods_receipt_notes (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      purchase_order_id bigint, supplier_id bigint, location_id bigint, received_at timestamptz,
      received_by bigint, supplier_delivery_note_ref text, status text DEFAULT 'draft', notes text,
      grni_journal_entry_id bigint, created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE goods_receipt_lines (id bigint PRIMARY KEY, tenant_id text, account_id text, grn_id bigint,
      purchase_order_item_id bigint, product_id bigint, ordered_qty numeric, received_qty numeric,
      accepted_qty numeric, rejected_qty numeric, rejection_reason text, batch_number text,
      expiry_date date, manufacturing_date date, unit_cost numeric, quarantine_location_id bigint,
      coa_document_id bigint, notes text, created_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text,
      invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, note text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint,
      product_id bigint, product_name text, qty numeric, unit_total numeric, line_total numeric,
      allocated_tax numeric, cost_price numeric, sale_item_id bigint, purchase_item_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint,
      location_id bigint, branch_id bigint, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
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

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: code } as never).execute();
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'timezone', value: 'Africa/Cairo' } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): { write: PurchasesWriteService; grn: GoodsReceiptService } {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined };
  const idempotencyStub = {};
  const queryStub = {
    getPurchaseById: async () => ({ purchase: { id: 1, status: 'cancelled' } }),
    listPurchases: async () => ({ purchases: [] }),
  };
  const finance = new PurchasesFinanceService();
  const write = new PurchasesWriteService(
    db as any, new TransactionHelper(), auditStub as any,
    finance, queryStub as unknown as PurchasesQueryService, posting as any, idempotencyStub as any,
  );
  const grn = new GoodsReceiptService(db as any, posting as any, finance as any);
  return { write, grn };
}

type PoItemSeed = { id: number; productId: number; quantity: number; received?: number };

async function seedBase(db: Kysely<Database>): Promise<void> {
  await db.insertInto('stock_locations' as never).values({ id: 1, tenant_id: 't1', branch_id: null, name: 'Main' } as never).execute();
  await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier', balance: 0 } as never).execute();
  for (const productId of [10, 11]) {
    await db.insertInto('products' as never).values({
      id: productId, tenant_id: 't1', account_id: 'a1', name: `Widget ${productId}`,
      stock_qty: 0, reserved_qty: 0, cost_price: 10, track_serials: false,
    } as never).execute();
  }
}

async function seedPo(db: Kysely<Database>, status: string, items: PoItemSeed[]): Promise<void> {
  await db.insertInto('purchase_orders' as never).values({
    id: 7, tenant_id: 't1', account_id: 'a1', order_number: 'PO-7', supplier_id: 9,
    supplier_name: 'Supplier', warehouse_id: 1, subtotal: 140, tax_amount: 0, discount_amount: 0,
    total_amount: 140, status, updated_at: new Date('2026-10-01'),
  } as never).execute();
  for (const item of items) {
    await db.insertInto('purchase_order_items' as never).values({
      id: item.id, tenant_id: 't1', account_id: 'a1', purchase_order_id: 7, product_id: item.productId,
      product_name: `Widget ${item.productId}`, unit_name: 'piece', quantity: item.quantity,
      received_quantity: item.received ?? 0, unit_cost: 10, tax_rate: 0, discount: 0, total: item.quantity * 10,
    } as never).execute();
  }
}

async function seedGrn(
  db: Kysely<Database>,
  grnId: number,
  lines: Array<{ id: number; poItemId: number | null; productId: number; ordered: number; accepted: number; rejected?: number }>,
): Promise<void> {
  await db.insertInto('goods_receipt_notes' as never).values({
    id: grnId, tenant_id: 't1', account_id: 'a1', doc_no: `GRN-${grnId}`, purchase_order_id: 7,
    supplier_id: 9, location_id: 1, received_at: new Date('2026-10-01T08:00:00.000Z'),
    received_by: 1, status: 'draft',
  } as never).execute();
  for (const line of lines) {
    await db.insertInto('goods_receipt_lines' as never).values({
      id: line.id, tenant_id: 't1', account_id: 'a1', grn_id: grnId,
      purchase_order_item_id: line.poItemId, product_id: line.productId,
      ordered_qty: line.ordered, received_qty: line.accepted + (line.rejected ?? 0),
      accepted_qty: line.accepted, rejected_qty: line.rejected ?? 0, unit_cost: 10,
    } as never).execute();
  }
}

async function seedBill(
  db: Kysely<Database>,
  purchaseId: number,
  status: string,
  lines: Array<{ id: number; poItemId: number | null; productId: number; qty: number; received: number; multiplier?: number }>,
): Promise<void> {
  const total = lines.reduce((sum, line) => sum + line.qty * 10, 0);
  await db.insertInto('purchases' as never).values({
    id: purchaseId, tenant_id: 't1', account_id: 'a1', doc_no: `P${purchaseId}`, supplier_id: 9,
    payment_type: 'credit', subtotal: total, discount: 0, tax_amount: 0, tax_rate: 0,
    prices_include_tax: false, total, paid_amount: 0, branch_id: null, location_id: 1,
    status, lifecycle_status: status === 'draft' ? 'purchase_order' : 'posted',
    matched_status: 'pending', po_id: 7, created_by: 1,
  } as never).execute();
  for (const line of lines) {
    await db.insertInto('purchase_items' as never).values({
      id: line.id, tenant_id: 't1', account_id: 'a1', purchase_id: purchaseId, product_id: line.productId,
      product_name: `Widget ${line.productId}`, qty: line.qty, unit_cost: 10,
      unit_multiplier: line.multiplier ?? 1, line_total: line.qty * 10, unit_name: 'piece',
      location_id: 1, po_item_id: line.poItemId, received_qty: line.received,
    } as never).execute();
  }
}

async function readPo(db: Kysely<Database>): Promise<{ status: string; items: Array<{ id: number; quantity: number; received: number }> }> {
  const order = await (db as any).selectFrom('purchase_orders').select('status').where('id', '=', 7).executeTakeFirstOrThrow() as unknown as { status: string };
  const rows = await (db as any).selectFrom('purchase_order_items').select(['id', 'quantity', 'received_quantity'])
    .where('purchase_order_id', '=', 7).orderBy('id').execute() as unknown as Array<{ id: number; quantity: string; received_quantity: string }>;
  return {
    status: String(order.status),
    items: rows.map((row) => ({ id: Number(row.id), quantity: Number(row.quantity), received: Number(row.received_quantity) })),
  };
}

async function readProductStock(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', productId).executeTakeFirstOrThrow() as unknown as { stock_qty: string };
  return Number(row.stock_qty);
}

async function main(): Promise<void> {
  // Case 1: GRN partial receipt advances and sets partially_received.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 'confirmed', [
        { id: 1, productId: 10, quantity: 10 },
        { id: 2, productId: 11, quantity: 4 },
      ]);
      await seedGrn(db, 1, [
        { id: 1, poItemId: 1, productId: 10, ordered: 10, accepted: 6 },
        { id: 2, poItemId: 2, productId: 11, ordered: 4, accepted: 4 },
      ]);
      const { grn } = makeServices(db);
      const result = await grn.postGoodsReceipt(1, auth);
      assert.equal(result.status, 'posted');
      const po = await readPo(db);
      assert.equal(po.status, 'partially_received');
      assert.deepEqual(po.items.map((item) => item.received), [6, 4]);
      assert.equal(await readProductStock(db, 10), 6);
      assert.equal(await readProductStock(db, 11), 4);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: GRN completing receipt over a seeded partial sets received.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 'partially_received', [
        { id: 1, productId: 10, quantity: 10, received: 6 },
        { id: 2, productId: 11, quantity: 4, received: 4 },
      ]);
      await seedGrn(db, 2, [
        { id: 3, poItemId: 1, productId: 10, ordered: 10, accepted: 4 },
      ]);
      const { grn } = makeServices(db);
      await grn.postGoodsReceipt(2, auth);
      const po = await readPo(db);
      assert.equal(po.status, 'received');
      assert.deepEqual(po.items.map((item) => item.received), [10, 4]);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: legacy full receipt on a draft PO bill advances in PO units
  // (multiplier 2: 5 cartons advance 5, not 10 base units) and the
  // bill posts through the real posting path.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 'confirmed', [
        { id: 1, productId: 10, quantity: 5 },
      ]);
      await seedBill(db, 1, 'draft', [
        { id: 1, poItemId: 1, productId: 10, qty: 5, received: 0, multiplier: 2 },
      ]);
      const { write } = makeServices(db);
      const result = await write.receivePurchaseGoods(1, [{ itemId: 1, receivedQty: 5 }], auth);
      assert.equal(result.lifecycleStatus, 'posted');
      assert.equal(result.matchedStatus, 'matched');
      const po = await readPo(db);
      assert.equal(po.status, 'received');
      assert.deepEqual(po.items.map((item) => item.received), [5]);
      assert.equal(await readProductStock(db, 10), 10);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: legacy partial receipt on a posted bill advances and sets
  // partially_received (the draft-partial guard is unchanged: draft
  // bills cannot take partial legacy receipts).
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 'confirmed', [
        { id: 1, productId: 10, quantity: 10 },
        { id: 2, productId: 11, quantity: 4 },
      ]);
      await seedBill(db, 2, 'posted', [
        { id: 1, poItemId: 1, productId: 10, qty: 10, received: 0 },
        { id: 2, poItemId: 2, productId: 11, qty: 4, received: 0 },
      ]);
      const { write } = makeServices(db);
      const result = await write.receivePurchaseGoods(2, [{ itemId: 1, receivedQty: 4 }], auth);
      assert.equal(result.lifecycleStatus, 'grn_received');
      const po = await readPo(db);
      assert.equal(po.status, 'partially_received');
      assert.deepEqual(po.items.map((item) => item.received), [4, 0]);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: legacy over-receipt throws and advances nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 'confirmed', [
        { id: 1, productId: 10, quantity: 10 },
      ]);
      await seedBill(db, 3, 'draft', [
        { id: 1, poItemId: 1, productId: 10, qty: 10, received: 0 },
      ]);
      const { write } = makeServices(db);
      await assert.rejects(
        () => write.receivePurchaseGoods(3, [{ itemId: 1, receivedQty: 11 }], auth),
        (error: unknown) => (error as { code?: string }).code === 'PURCHASE_RECEIPT_QTY_INVALID',
      );
      const po = await readPo(db);
      assert.equal(po.status, 'confirmed');
      assert.deepEqual(po.items.map((item) => item.received), [0]);
      assert.equal(await readProductStock(db, 10), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: GRN double-post throws and the advance is applied once.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 'confirmed', [
        { id: 1, productId: 10, quantity: 10 },
      ]);
      await seedGrn(db, 4, [
        { id: 4, poItemId: 1, productId: 10, ordered: 10, accepted: 6 },
      ]);
      const { grn } = makeServices(db);
      await grn.postGoodsReceipt(4, auth);
      await assert.rejects(() => grn.postGoodsReceipt(4, auth));
      const po = await readPo(db);
      assert.equal(po.status, 'partially_received');
      assert.deepEqual(po.items.map((item) => item.received), [6]);
      assert.equal(await readProductStock(db, 10), 6);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: a converted_to_bill order keeps its status while its items
  // advance, so the conversion marker survives the receipt.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedBase(db);
      await seedPo(db, 'converted_to_bill', [
        { id: 1, productId: 10, quantity: 10 },
      ]);
      await seedGrn(db, 5, [
        { id: 5, poItemId: 1, productId: 10, ordered: 10, accepted: 10 },
      ]);
      const { grn } = makeServices(db);
      await grn.postGoodsReceipt(5, auth);
      const po = await readPo(db);
      assert.equal(po.status, 'converted_to_bill');
      assert.deepEqual(po.items.map((item) => item.received), [10]);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: source pin — the advance lives only in the two receipt
  // transactions; the GRN-bill, conversion, and edit paths never
  // advance; the invariant entry exists exactly once; and the pure
  // status computation settles the partial/full boundary.
  {
    assert.equal(computePoReceiptStatus([{ id: 1, quantity: 10, receivedQuantity: 6 }], 'confirmed'), 'partially_received');
    assert.equal(computePoReceiptStatus([{ id: 1, quantity: 10, receivedQuantity: 10 }], 'confirmed'), 'received');
    assert.equal(computePoReceiptStatus([{ id: 1, quantity: 10, receivedQuantity: 10 }], 'converted_to_bill'), null);
    assert.equal(computePoReceiptStatus([{ id: 1, quantity: 10, receivedQuantity: 0 }], 'confirmed'), null);
    const grnSource = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/goods-receipt.service.ts'), 'utf8');
    const postStart = grnSource.indexOf('async postGoodsReceipt(');
    assert.ok(postStart > 0, 'postGoodsReceipt exists');
    const postBody = grnSource.slice(postStart, grnSource.indexOf('\n  /**', postStart + 1));
    assert.ok(postBody.includes('await advancePurchaseOrderReceipt('), 'GRN posting must advance the PO in its transaction');
    const billStart = grnSource.indexOf('async createBillFromReceipts(');
    assert.ok(billStart > 0, 'createBillFromReceipts exists');
    const billBody = grnSource.slice(billStart, grnSource.indexOf('\n  async ', billStart + 1));
    assert.ok(!billBody.includes('advancePurchaseOrderReceipt'), 'the GRN bill must never advance: its stock was already received');
    const writeSource = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchases-write.service.ts'), 'utf8');
    const receiveStart = writeSource.indexOf('async receivePurchaseGoods(');
    assert.ok(receiveStart > 0, 'receivePurchaseGoods exists');
    const receiveBody = writeSource.slice(receiveStart, writeSource.indexOf('\n  async ', receiveStart + 1) === -1 ? undefined : writeSource.indexOf('\n  async ', receiveStart + 1));
    assert.ok(receiveBody.includes('await advancePurchaseOrderReceipt('), 'the legacy receipt must advance the PO in its transaction');
    const updateStart = writeSource.indexOf('async updatePurchase(');
    assert.ok(updateStart > 0, 'updatePurchase exists');
    const updateBody = writeSource.slice(updateStart, writeSource.indexOf('\n  async ', updateStart + 1));
    assert.ok(!updateBody.includes('advancePurchaseOrderReceipt'), 'the unreachable edit path must never advance');
    const ordersSource = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchase-orders.service.ts'), 'utf8');
    assert.ok(!ordersSource.includes('advancePurchaseOrderReceipt'), 'conversion must never advance: it posts no stock');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-PO-RECEIVED-QUANTITY-ADVANCE').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('po-received-quantity-advance: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
