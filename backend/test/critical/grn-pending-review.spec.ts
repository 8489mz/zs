import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { GoodsReceiptService } from '../../src/modules/purchases/services/goods-receipt.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * GRN pending-review receipt (INV-SPIRIT-GRN-PENDING-REVIEW).
 *
 * THE RIGIDITY: creating or posting a goods receipt against an
 * unapproved (draft) purchase order was rejected outright, so goods
 * physically on the dock could not enter stock until someone approved
 * the order, and any quantity over the ordered amount had no recorded
 * variance anywhere.
 *
 * THE FIX: a draft order may receive as a pending-review receipt. Stock,
 * WAC and the GRNI journal (Dr 1140 / Cr 2125) post exactly as before —
 * money stays strict — the receipt is flagged pending_review with a
 * reason, the order's received quantities advance while its status
 * stays 'draft' (receiving must not approve the order by side effect),
 * and supplier billing from the receipt is blocked until the order is
 * approved. A line received past the quantity still unreceived on its
 * order item records over_received_qty as a variance pending approval.
 * A cancelled order still blocks receipt creation and posting. The
 * received == accepted + rejected identity is a database CHECK
 * constraint on goods_receipt_lines and is unchanged.
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
    CREATE TABLE goods_receipt_notes (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      purchase_order_id bigint, supplier_id bigint, location_id bigint, received_at timestamptz,
      received_by bigint, supplier_delivery_note_ref text, status text DEFAULT 'draft', notes text,
      grni_journal_entry_id bigint, pending_review boolean NOT NULL DEFAULT FALSE, pending_review_reason text,
      created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz DEFAULT '2026-10-01');
    CREATE TABLE goods_receipt_lines (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, grn_id bigint,
      purchase_order_item_id bigint, product_id bigint, ordered_qty numeric, received_qty numeric,
      accepted_qty numeric, rejected_qty numeric, rejection_reason text, batch_number text,
      expiry_date date, manufacturing_date date, unit_cost numeric, quarantine_location_id bigint,
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
  await db.insertInto('stock_locations' as never).values({ id: 1, tenant_id: 't1', branch_id: null, name: 'Main' } as never).execute();
  await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier', balance: 0 } as never).execute();
  await db.insertInto('products' as never).values({
    id: 10, tenant_id: 't1', account_id: 'a1', name: 'Widget 10',
    stock_qty: 0, reserved_qty: 0, cost_price: 10, track_serials: false,
  } as never).execute();
}

async function seedPo(db: Kysely<Database>, status: string, quantity: number, received?: number): Promise<void> {
  await db.insertInto('purchase_orders' as never).values({
    id: 7, tenant_id: 't1', account_id: 'a1', order_number: 'PO-7', supplier_id: 9,
    supplier_name: 'Supplier', warehouse_id: 1, subtotal: quantity * 10, tax_amount: 0, discount_amount: 0,
    total_amount: quantity * 10, status, updated_at: new Date('2026-10-01'),
  } as never).execute();
  await db.insertInto('purchase_order_items' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', purchase_order_id: 7, product_id: 10,
    product_name: 'Widget 10', unit_name: 'piece', quantity, received_quantity: received ?? 0,
    unit_cost: 10, tax_rate: 0, discount: 0, total: quantity * 10,
  } as never).execute();
}

async function seedGrn(db: Kysely<Database>, grnId: number, accepted: number, rejected?: number): Promise<void> {
  await db.insertInto('goods_receipt_notes' as never).values({
    id: grnId, tenant_id: 't1', account_id: 'a1', doc_no: `GRN-${grnId}`, purchase_order_id: 7,
    supplier_id: 9, location_id: 1, received_at: new Date('2026-10-01T08:00:00.000Z'),
    received_by: 1, status: 'draft',
  } as never).execute();
  await db.insertInto('goods_receipt_lines' as never).values({
    id: grnId, tenant_id: 't1', account_id: 'a1', grn_id: grnId,
    purchase_order_item_id: 1, product_id: 10,
    ordered_qty: accepted + (rejected ?? 0), received_qty: accepted + (rejected ?? 0),
    accepted_qty: accepted, rejected_qty: rejected ?? 0, unit_cost: 10,
  } as never).execute();
}

async function readState(db: Kysely<Database>, grnId: number): Promise<any> {
  const product = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', 10).executeTakeFirstOrThrow();
  const po = await (db as any).selectFrom('purchase_orders').select(['status']).where('id', '=', 7).executeTakeFirstOrThrow();
  const poItem = await (db as any).selectFrom('purchase_order_items').select(['received_quantity']).where('id', '=', 1).executeTakeFirstOrThrow();
  const grn = await (db as any).selectFrom('goods_receipt_notes').select(['status', 'pending_review', 'pending_review_reason', 'grni_journal_entry_id']).where('id', '=', grnId).executeTakeFirstOrThrow();
  const line = await (db as any).selectFrom('goods_receipt_lines').select(['over_received_qty']).where('grn_id', '=', grnId).executeTakeFirstOrThrow();
  const journals = await (db as any).selectFrom('journal_entries').select('id').execute();
  const journalLines = await (db as any).selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit']).execute();
  return {
    stock: Number(product.stock_qty), poStatus: po.status,
    poReceived: Number(poItem.received_quantity),
    grnStatus: grn.status, pendingReview: grn.pending_review,
    pendingReason: grn.pending_review_reason, grniEntryId: grn.grni_journal_entry_id,
    overReceived: Number(line.over_received_qty),
    journalCount: journals.length, journalLines,
  };
}

async function main(): Promise<void> {
  // Case 1: receipt against a draft (unapproved) order posts as pending-review.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 'draft', 10);
      const grn = makeGrnService(db);
      const created = await grn.createGoodsReceipt({
        supplierId: 9, locationId: 1, purchaseOrderId: 7,
        lines: [{ productId: 10, purchaseOrderItemId: 1, orderedQty: 10, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, unitCost: 10 }],
      } as any, auth);
      assert.equal(created.status, 'draft', 'draft receipt creation succeeds against a draft order');
      const result = await grn.postGoodsReceipt(Number(created.id), auth);
      assert.equal(result.status, 'posted');
      assert.equal(result.pendingReview, true, 'draft-order receipt is flagged pending review');
      assert.match(String(result.pendingReviewReason || ''), /غير معتمد/);
      const state = await readState(db, Number(created.id));
      assert.equal(state.stock, 10, 'goods enter stock');
      assert.equal(state.poStatus, 'draft', 'receiving does not approve the order');
      assert.equal(state.poReceived, 10, 'received quantity still advances');
      assert.equal(state.pendingReview, true);
      assert.equal(state.overReceived, 0);
      assert.ok(state.grniEntryId, 'GRNI journal posted');
      assert.equal(state.journalCount, 1, 'exactly one GRNI journal entry');
      const invLine = state.journalLines.find((l: any) => Number(l.account_id) === 1140);
      const grniLine = state.journalLines.find((l: any) => Number(l.account_id) === 2125);
      assert.equal(Number(invLine.debit), 100);
      assert.equal(Number(grniLine.credit), 100);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: over-receipt on a confirmed order records the variance.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 'confirmed', 10);
      await seedGrn(db, 1, 14);
      const grn = makeGrnService(db);
      const result = await grn.postGoodsReceipt(1, auth);
      assert.equal(result.status, 'posted');
      assert.equal(result.pendingReview, true, 'over-receipt is flagged pending review');
      const state = await readState(db, 1);
      assert.equal(state.stock, 14, 'all received goods enter stock');
      assert.equal(state.overReceived, 4, 'excess over the ordered quantity is recorded');
      assert.equal(state.poStatus, 'received');
      assert.equal(state.poReceived, 14);
      assert.equal(state.journalCount, 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: supplier billing stays blocked while the order is unapproved.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 'draft', 10);
      await seedGrn(db, 1, 10);
      const grn = makeGrnService(db);
      await grn.postGoodsReceipt(1, auth);
      await assert.rejects(
        () => grn.createBillFromReceipts({
          purchaseOrderId: 7, supplierId: 9, supplierInvoiceNo: 'INV-1',
          lines: [{ grnLineId: 1, qty: 10, unitCost: 10 }],
        } as any, auth),
        /غير معتمد/,
        'billing a pending-review receipt is rejected while the order is draft',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 4: a cancelled order still blocks receipt creation and posting.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 'cancelled', 10);
      const grn = makeGrnService(db);
      await assert.rejects(
        () => grn.createGoodsReceipt({
          supplierId: 9, locationId: 1, purchaseOrderId: 7,
          lines: [{ productId: 10, purchaseOrderItemId: 1, orderedQty: 10, receivedQty: 10, acceptedQty: 10, rejectedQty: 0, unitCost: 10 }],
        } as any, auth),
        /ملغي/,
        'creation against a cancelled order is rejected',
      );
      await seedGrn(db, 1, 10);
      await assert.rejects(
        () => grn.postGoodsReceipt(1, auth),
        /ملغي|غير معتمد/,
        'posting against a cancelled order is rejected',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 5: a normal receipt on a confirmed order is unchanged — no flag, no variance.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 'confirmed', 10);
      await seedGrn(db, 1, 6);
      const grn = makeGrnService(db);
      const result = await grn.postGoodsReceipt(1, auth);
      assert.equal(result.pendingReview, false);
      assert.equal(result.pendingReviewReason, null);
      const state = await readState(db, 1);
      assert.equal(state.stock, 6);
      assert.equal(state.poStatus, 'partially_received');
      assert.equal(state.overReceived, 0);
      assert.equal(state.pendingReview, false);
    } finally {
      await db.destroy();
    }
  }

  console.log('grn pending-review checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
