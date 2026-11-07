/*
New file: backend/test/critical/grn-journal-central-posting.spec.ts

WHAT THIS PINS (INV-GRN-JOURNAL-CENTRAL-POSTING): posting a goods
receipt must write its GRNI journal (Dr 1140 / Cr 2125) only through
the central posting boundary, on the same transaction, at the
tenant's book digits. The old direct inserts carried no branch_id,
no location_id, no posted_by and no posted_at, numbered the entry
JRN-YYMMDD-####, and stored the stock movement total at four
decimals — so branch/location reporting missed every GRN journal and
a 2dp tenant stored 100.125 while the journal leg rounded to 100.13.
The boundary stamps posted_by/posted_at, numbers the entry JE-<id>,
validates branch/location/partner references, asserts the period is
open, and the movement total uses the single book-digits
computation, so the stored total can never diverge from the posted
leg by rounding. Double-posting stays guarded by the GRN row lock +
posted-status check.

WHAT IS DRIVEN: the real postGoodsReceipt (real tenant-currency
resolution at book digits, real WAC writer, real central-boundary
journal, real stock movement rows) on PGlite, in EGP (2dp) with a
unit cost that exposes the old 4dp divergence (3 x 33.375).

DELEGATED DECISIONS, FLAGGED FOR REVERSAL: (1) the entry number
changes from JRN-YYMMDD-#### to the boundary's JE-<id> numbering —
the same numbering every other central-boundary journal already
carries; (2) 'goods_receipt' stays out of the boundary's dedup-key
source list, so double-post protection remains the GRN row lock +
status guard, unchanged from the old code; (3) a supplier-less
receipt posts the GRNI credit line untagged (partner 'none'), the
postPurchase convention, instead of failing partner validation on
supplier id 0.

NOT DRIVEN: two-terminal concurrency (PGlite is single-connection —
the FOR UPDATE lock plus the posted-status guard that serializes
concurrent posters is code-reviewed, not driven concurrently); a
live Postgres run; the frontend receipt screen (untouched); GRN
cancel/reversal (no endpoint exists — a separate decision).
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
  await db.insertInto('products' as never).values({
    id: 10, tenant_id: 't1', account_id: 'a1', name: 'Widget 10',
    stock_qty: 0, reserved_qty: 0, cost_price: 10, track_serials: false,
  } as never).execute();
}

async function seedPo(db: Kysely<Database>, quantity: number): Promise<void> {
  await db.insertInto('purchase_orders' as never).values({
    id: 7, tenant_id: 't1', account_id: 'a1', order_number: 'PO-7', supplier_id: 9,
    supplier_name: 'Supplier', warehouse_id: 1, subtotal: quantity * 10, tax_amount: 0, discount_amount: 0,
    total_amount: quantity * 10, status: 'confirmed', updated_at: new Date('2026-10-01'),
  } as never).execute();
  await db.insertInto('purchase_order_items' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', purchase_order_id: 7, product_id: 10,
    product_name: 'Widget 10', unit_name: 'piece', quantity, received_quantity: 0,
    unit_cost: 10, tax_rate: 0, discount: 0, total: quantity * 10,
  } as never).execute();
}

async function seedGrn(db: Kysely<Database>, grnId: number, accepted: number, rejected: number, unitCost: number): Promise<void> {
  await db.insertInto('goods_receipt_notes' as never).values({
    id: grnId, tenant_id: 't1', account_id: 'a1', doc_no: `GRN-${grnId}`, purchase_order_id: 7,
    supplier_id: 9, location_id: 1, received_at: new Date('2026-10-01T08:00:00.000Z'),
    received_by: 1, status: 'draft',
  } as never).execute();
  await db.insertInto('goods_receipt_lines' as never).values({
    id: grnId, tenant_id: 't1', account_id: 'a1', grn_id: grnId,
    purchase_order_item_id: 1, product_id: 10,
    ordered_qty: accepted + rejected, received_qty: accepted + rejected,
    accepted_qty: accepted, rejected_qty: rejected, unit_cost: unitCost,
  } as never).execute();
}

async function readJournal(db: Kysely<Database>): Promise<any> {
  const header = await (db as any).selectFrom('journal_entries').selectAll().executeTakeFirstOrThrow();
  const lines = await (db as any).selectFrom('journal_entry_lines').selectAll().orderBy('id', 'asc').execute();
  return { header, lines };
}

async function main(): Promise<void> {
  // Case 1: the GRNI journal carries branch, location, poster and JE numbering.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 10);
      await seedGrn(db, 1, 3, 0, 33.375);
      const grn = makeGrnService(db);
      const result = await grn.postGoodsReceipt(1, auth);
      assert.equal(result.status, 'posted');
      assert.ok(result.grniJournalEntryId, 'GRNI journal posted');
      assert.equal(result.totalGrniAmount, 100.13, 'journal amount rounds at book digits');
      const { header, lines } = await readJournal(db);
      assert.equal(Number(header.id), Number(result.grniJournalEntryId));
      assert.match(String(header.entry_no), /^JE-\d{8}$/, 'central-boundary numbering, not JRN-YYMMDD-####');
      assert.equal(header.source_type, 'goods_receipt');
      assert.equal(Number(header.source_id), 1);
      assert.equal(header.status, 'posted');
      assert.equal(Number(header.branch_id), 5, 'header carries the receipt location branch');
      assert.equal(Number(header.location_id), 1, 'header carries the receipt location');
      assert.equal(Number(header.created_by), 1);
      assert.equal(Number(header.posted_by), 1, 'boundary stamps the poster');
      assert.ok(header.posted_at, 'boundary stamps posted_at');
      assert.equal(lines.length, 2);
      const invLine = lines.find((l: any) => Number(l.account_id) === 1140);
      const grniLine = lines.find((l: any) => Number(l.account_id) === 2125);
      assert.equal(Number(invLine.debit), 100.13);
      assert.equal(Number(invLine.credit), 0);
      assert.equal(invLine.partner_type, 'none');
      assert.equal(invLine.partner_id, null);
      assert.equal(Number(grniLine.debit), 0);
      assert.equal(Number(grniLine.credit), 100.13);
      assert.equal(grniLine.partner_type, 'supplier');
      assert.equal(Number(grniLine.partner_id), 9);
      for (const line of lines) {
        assert.equal(Number(line.branch_id), 5, 'every line carries the branch');
        assert.equal(Number(line.location_id), 1, 'every line carries the location');
      }
      const product = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', 10).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 3, 'goods enter stock');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the stored movement total equals the posted leg at book digits.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 10);
      await seedGrn(db, 1, 3, 0, 33.375);
      const grn = makeGrnService(db);
      await grn.postGoodsReceipt(1, auth);
      const movement = await (db as any).selectFrom('stock_movements').select(['qty', 'unit_cost', 'total_cost', 'branch_id', 'location_id']).executeTakeFirstOrThrow();
      assert.equal(Number(movement.qty), 3);
      assert.equal(Number(movement.unit_cost), 33.375, 'unit cost stays raw');
      assert.equal(Number(movement.total_cost), 100.13, 'movement total at book digits, not toFixed(4) 100.125');
      const { lines } = await readJournal(db);
      const invLine = lines.find((l: any) => Number(l.account_id) === 1140);
      assert.equal(Number(movement.total_cost), Number(invLine.debit), 'stored total and posted leg never diverge');
      assert.equal(Number(movement.branch_id), 5);
      assert.equal(Number(movement.location_id), 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a second posting is still blocked and posts nothing twice.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 10);
      await seedGrn(db, 1, 3, 0, 10);
      const grn = makeGrnService(db);
      await grn.postGoodsReceipt(1, auth);
      await assert.rejects(() => grn.postGoodsReceipt(1, auth), /مسبقاً/, 'double posting is rejected');
      const journals = await (db as any).selectFrom('journal_entries').select('id').execute();
      assert.equal(journals.length, 1, 'exactly one journal after the rejected repost');
      const product = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', 10).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 3, 'stock is not doubled');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: a receipt with nothing accepted posts no journal at all.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db);
      await seedBase(db);
      await seedPo(db, 10);
      await seedGrn(db, 1, 0, 5, 10);
      const grn = makeGrnService(db);
      const result = await grn.postGoodsReceipt(1, auth);
      assert.equal(result.status, 'posted');
      assert.equal(result.grniJournalEntryId, null, 'no journal when nothing was accepted');
      const journals = await (db as any).selectFrom('journal_entries').select('id').execute();
      assert.equal(journals.length, 0);
      const product = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', 10).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 0, 'no stock enters');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: source + invariant pins (presence only — no last-line pin).
  {
    const here = __dirname;
    const serviceSource = readFileSync(resolve(here, '../../src/modules/purchases/services/goods-receipt.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('postDomainJournal'), 'postGoodsReceipt posts through the central boundary');
    assert.ok(serviceSource.includes('stockMovementTotal'), 'movement total uses the single book-digits computation');
    assert.ok(!serviceSource.includes('JRN-TMP-GRN'), 'no direct temporary-number journal insert remains');
    assert.ok(serviceSource.includes('INV-GRN-JOURNAL-CENTRAL-POSTING'), 'postGoodsReceipt names the invariant');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-GRN-JOURNAL-CENTRAL-POSTING').length - 1, 1, 'the invariant entry must exist exactly once');
    console.log('  source + invariant pins passed');
  }

  console.log('grn journal central-posting checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
