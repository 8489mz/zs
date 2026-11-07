/*
 * Purchase landed cost at receipt (INV-LANDED-COST-ALLOCATION).
 *
 * THE DEFECT, proven live on test10k (build 1.1.40): a purchase
 * invoice carried no freight into item cost. Invoice ZP-261105-001288
 * was item 100.00 + freight 20.00 = 120.00, but inventory rose only
 * 100.00 and the WAC moved 56.08 -> 58.82 instead of 60.07. The
 * invoice DTO had no freight field at all: createPurchase blended the
 * WAC from item cost only, and postPurchase debited inventory at the
 * header net (total - tax) = item cost only. The only allocation was
 * the separate post-posting landed-costs step, a second manual action
 * after the invoice had already posted at the wrong cost.
 *
 * THE FIX, in the decided direction (freight IS allocated to item
 * cost): the invoice may now carry landedCosts, allocated at posting
 * time by the same canonical allocator the post-posting step uses
 * (value proportion by default). The receipt blends the landed unit
 * cost into the WAC, the stock movement carries the landed cost, and
 * the invoice total — hence the inventory debit and the supplier
 * payable — includes the freight. Third-party freight (a vendor other
 * than the invoice supplier) still belongs to the post-posting step,
 * which credits each vendor separately; the invoice total is payable
 * to this supplier alone, so naming another vendor fails closed.
 *
 * THE WORKED EXAMPLE, closed exactly: prior stock 15 @ 56.08
 * (pool 841.20), receipt 1 unit @ 100.00 + freight 20.00.
 * Without freight the blend is (841.20 + 100) / 16 = 58.825, shown
 * as 58.82 at 2dp. With freight it is (841.20 + 120) / 16 = 60.075,
 * shown as 60.07 at 2dp — the tester's expected figure.
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService.createPurchase
 * on PGlite (fresh database per case; audit + idempotency are stubbed
 * no-ops, the tenant foundation is stubbed as in the commercial-posting
 * spec, and the query service is stubbed for the response envelope
 * only — no pinned assertion reads it):
 * - Case 1, the tester example (EGP): 15 @ 56.08 + 1 @ 100 + freight
 *   20 -> stock 16, WAC 60.075 (60.07 at 2dp), invoice total 120,
 *   journal Dr 1140 120 / Cr 2110 120, supplier balance 120, the
 *   item carries allocated 20 / landed unit cost 120, and the
 *   purchase_landed_costs row is stored.
 * - Case 2, no freight: the same receipt without landedCosts posts
 *   exactly as before — stock 16, WAC 58.825 (58.82 at 2dp), total
 *   100, journal 100 / 100, no landed rows, no allocated cost.
 * - Case 3, multi-item value split: lines 200 + 100 with freight 30
 *   split 20 / 10 by value; WACs 60 and 110; journal 330 / 330.
 * - Case 4, fail-closed guards: third-party freight vendor,
 *   freight on a purchase order, freight with service lines only,
 *   and a sub-minor freight amount are all rejected with named
 *   errors and leave no purchase, no stock and no WAC change.
 * - Case 5, source pin: the at-receipt allocation lives in
 *   createPurchase only, through the canonical allocator and the
 *   canonical WAC writer; the post-posting step is untouched.
 *
 * DELIBERATELY UNCHANGED: the post-posting landed-costs service
 * (still the place for third-party freight and for costs that arrive
 * after posting, with its sold/held split per INV-LANDED-COST rules),
 * the cancel guard (an invoice with applied landed costs still cannot
 * be cancelled), the edit path (posted invoices still cannot be
 * edited), serials and pharmacy batches (they keep the net item cost,
 * exactly as the post-posting step leaves them), and the purchase
 * composer UI (it does not send landedCosts yet — the API accepts it;
 * wiring the field is a frontend follow-up). This is not an
 * end-to-end post on live Postgres: journal_entry_lines DDL here is
 * unbounded numeric, as in the other book-digits specs.
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
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
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
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, is_active boolean DEFAULT true, location_type text);
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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text,
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
      grn_line_id bigint, grni_amount numeric, allocated_landed_cost numeric, landed_unit_cost numeric);
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
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint,
      location_id bigint, branch_id bigint, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
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
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 4100, 5100, 5190, 6950, 7290]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)',
      [code, 't1', String(code), code === 1150 || code === 2120]);
  }
  await pg.query(`INSERT INTO stock_locations(id,tenant_id,branch_id,is_active,location_type) VALUES (7,'t1',NULL,true,NULL)`);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: code } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): PurchasesWriteService {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined };
  const idempotencyStub = {};
  const queryStub = {
    getPurchaseById: async () => ({ purchase: { id: 1, status: 'posted' } }),
    listPurchases: async () => ({ purchases: [] }),
  };
  return new PurchasesWriteService(
    db as any, new TransactionHelper(), auditStub as any,
    new PurchasesFinanceService(), queryStub as any, posting as any, idempotencyStub as any,
  );
}

async function seedProduct(db: Kysely<Database>, id: number, stockQty: number, costPrice: number, itemType = 'standard'): Promise<void> {
  await db.insertInto('products' as never).values({
    id, tenant_id: 't1', account_id: 'a1', name: `Product ${id}`, stock_qty: stockQty,
    reserved_qty: 0, cost_price: costPrice, track_serials: false, item_type: itemType,
  } as never).execute();
  if (stockQty > 0) {
    await db.insertInto('product_location_stock' as never).values({
      tenant_id: 't1', account_id: 'a1', product_id: id, branch_id: null, location_id: 7,
      qty: stockQty, reserved_qty: 0,
    } as never).execute();
  }
}

async function readProduct(db: Kysely<Database>, id: number): Promise<{ stockQty: number; costPrice: number }> {
  const row = await (db as any).selectFrom('products').select(['stock_qty', 'cost_price']).where('id', '=', id).executeTakeFirstOrThrow() as unknown as { stock_qty: string; cost_price: string };
  return { stockQty: Number(row.stock_qty), costPrice: Number(row.cost_price) };
}

async function journalLegs(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const entry = await (db as any).selectFrom('journal_entries').select(['id']).where('source_type', '=', sourceType).where('source_id', '=', sourceId).executeTakeFirst() as unknown as { id: number } | undefined;
  if (!entry) return [];
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', '=', Number(entry.id)).orderBy('id').execute() as unknown as Array<{ account_id: number; debit: string; credit: string }>;
  return rows.map((row) => ({ accountId: Number(row.account_id), debit: Number(row.debit), credit: Number(row.credit) }));
}

async function readPurchase(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('purchases').selectAll().where('id', '=', id).executeTakeFirstOrThrow() as unknown as any;
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
  // Case 1: the tester example — 15 @ 56.08 + 1 @ 100 + freight 20.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedProduct(db, 10, 15, 56.08);
      await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never).execute();
      const svc = makeServices(db);
      const result = await svc.createPurchase(basePayload({
        landedCosts: { allocationMethod: 'value', costs: [{ costType: 'freight', description: 'Freight', amount: 20 }] },
      }), auth) as unknown as { purchaseId: number };
      const purchaseId = Number(result.purchaseId);
      assert.ok(purchaseId > 0, 'a purchase id is returned');
      const product = await readProduct(db, 10);
      assert.equal(product.stockQty, 16);
      // (15 x 56.08 + 120) / 16 = 60.075, shown as 60.07 at 2dp.
      assert.equal(product.costPrice, 60.075);
      const purchase = await readPurchase(db, purchaseId);
      assert.equal(Number(purchase.total), 120);
      assert.equal(Number(purchase.landed_cost_total), 20);
      assert.equal(purchase.landed_cost_allocation_method, 'value');
      assert.ok(purchase.landed_cost_applied_at, 'the landed-cost stamp is set');
      const item = await (db as any).selectFrom('purchase_items')
        .select(['allocated_landed_cost', 'landed_unit_cost', 'unit_cost', 'line_total'])
        .where('purchase_id', '=', purchaseId).executeTakeFirstOrThrow() as unknown as Record<string, string>;
      assert.equal(Number(item.allocated_landed_cost), 20);
      assert.equal(Number(item.landed_unit_cost), 120);
      assert.equal(Number(item.unit_cost), 100);
      assert.equal(Number(item.line_total), 100);
      const movement = await (db as any).selectFrom('stock_movements')
        .select(['movement_type', 'qty', 'unit_cost', 'total_cost'])
        .where('reference_type', '=', 'purchase').where('reference_id', '=', purchaseId)
        .executeTakeFirstOrThrow() as unknown as Record<string, string>;
      assert.equal(movement.movement_type, 'purchase');
      assert.equal(Number(movement.qty), 1);
      assert.equal(Number(movement.unit_cost), 120);
      assert.equal(Number(movement.total_cost), 120);
      const legs = await journalLegs(db, 'purchase', purchaseId);
      assert.deepEqual(legs, [
        { accountId: 1140, debit: 120, credit: 0 },
        { accountId: 2110, debit: 0, credit: 120 },
      ]);
      const supplier = await (db as any).selectFrom('suppliers').select('balance').where('id', '=', 9).executeTakeFirstOrThrow() as unknown as { balance: string };
      assert.equal(Number(supplier.balance), 120);
      const ledger = await (db as any).selectFrom('supplier_ledger').select(['entry_type', 'amount']).executeTakeFirstOrThrow() as unknown as { entry_type: string; amount: string };
      assert.equal(ledger.entry_type, 'purchase_credit');
      assert.equal(Number(ledger.amount), 120);
      const landedRows = await (db as any).selectFrom('purchase_landed_costs').select(['cost_type', 'amount', 'allocation_method']).execute() as unknown as Array<Record<string, string>>;
      assert.deepEqual(landedRows.map((row) => ({ costType: row.cost_type, amount: Number(row.amount), allocationMethod: row.allocation_method })), [
        { costType: 'freight', amount: 20, allocationMethod: 'value' },
      ]);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: no freight — the receipt posts exactly as before.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedProduct(db, 10, 15, 56.08);
      await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never).execute();
      const svc = makeServices(db);
      const result = await svc.createPurchase(basePayload(), auth) as unknown as { purchaseId: number };
      const purchaseId = Number(result.purchaseId);
      const product = await readProduct(db, 10);
      assert.equal(product.stockQty, 16);
      // (15 x 56.08 + 100) / 16 = 58.825, shown as 58.82 at 2dp.
      assert.equal(product.costPrice, 58.825);
      const purchase = await readPurchase(db, purchaseId);
      assert.equal(Number(purchase.total), 100);
      assert.equal(Number(purchase.landed_cost_total || 0), 0);
      assert.deepEqual(await journalLegs(db, 'purchase', purchaseId), [
        { accountId: 1140, debit: 100, credit: 0 },
        { accountId: 2110, debit: 0, credit: 100 },
      ]);
      const item = await (db as any).selectFrom('purchase_items')
        .select(['allocated_landed_cost', 'landed_unit_cost'])
        .where('purchase_id', '=', purchaseId).executeTakeFirstOrThrow() as unknown as Record<string, string | null>;
      assert.equal(item.allocated_landed_cost, null);
      assert.equal(item.landed_unit_cost, null);
      const landedRows = await (db as any).selectFrom('purchase_landed_costs').select('id').execute() as unknown as Array<unknown>;
      assert.equal(landedRows.length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: multi-item freight splits by value — lines 200 + 100, freight 30 -> 20 / 10.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedProduct(db, 10, 10, 50);
      await seedProduct(db, 11, 0, 0);
      await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never).execute();
      const svc = makeServices(db);
      const result = await svc.createPurchase(basePayload({
        items: [
          { productId: 10, qty: 2, cost: 100 },
          { productId: 11, qty: 1, cost: 100 },
        ],
        landedCosts: { allocationMethod: 'value', costs: [{ costType: 'freight', description: 'Freight', amount: 30 }] },
      }), auth) as unknown as { purchaseId: number };
      const purchaseId = Number(result.purchaseId);
      const productA = await readProduct(db, 10);
      const productB = await readProduct(db, 11);
      assert.equal(productA.stockQty, 12);
      // (10 x 50 + 2 x 110) / 12 = 60.
      assert.equal(productA.costPrice, 60);
      assert.equal(productB.stockQty, 1);
      assert.equal(productB.costPrice, 110);
      const purchase = await readPurchase(db, purchaseId);
      assert.equal(Number(purchase.total), 330);
      assert.equal(Number(purchase.landed_cost_total), 30);
      const items = await (db as any).selectFrom('purchase_items')
        .select(['product_id', 'allocated_landed_cost', 'landed_unit_cost'])
        .where('purchase_id', '=', purchaseId).orderBy('product_id').execute() as unknown as Array<Record<string, string>>;
      assert.deepEqual(items.map((row) => ({
        productId: Number(row.product_id),
        allocated: Number(row.allocated_landed_cost),
        landedUnitCost: Number(row.landed_unit_cost),
      })), [
        { productId: 10, allocated: 20, landedUnitCost: 110 },
        { productId: 11, allocated: 10, landedUnitCost: 110 },
      ]);
      assert.deepEqual(await journalLegs(db, 'purchase', purchaseId), [
        { accountId: 1140, debit: 330, credit: 0 },
        { accountId: 2110, debit: 0, credit: 330 },
      ]);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: fail-closed guards — nothing is created, nothing moves.
  {
    // 4a: freight naming another vendor is rejected.
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedProduct(db, 10, 15, 56.08);
      await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never).execute();
      await db.insertInto('suppliers' as never).values({ id: 8, tenant_id: 't1', name: 'Carrier', balance: 0 } as never).execute();
      const svc = makeServices(db);
      await assert.rejects(() => svc.createPurchase(basePayload({
        landedCosts: { costs: [{ costType: 'freight', description: 'Freight', amount: 20, vendorId: 8 }] },
      }), auth), /PURCHASE_LANDED_COST_VENDOR_MISMATCH/);
      const purchases = await (db as any).selectFrom('purchases').select('id').execute() as unknown as Array<unknown>;
      assert.equal(purchases.length, 0);
      const product = await readProduct(db, 10);
      assert.equal(product.stockQty, 15);
      assert.equal(product.costPrice, 56.08);
    } finally {
      await db.destroy();
    }
    // 4b: freight on a purchase order is rejected.
    {
      const { pg: pg2, db: db2 } = await makeDb();
      try {
        await seedCurrency(db2, 'EGP');
        await seedProduct(db2, 10, 15, 56.08);
        await db2.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never).execute();
        const svc = makeServices(db2);
        await assert.rejects(() => svc.createPurchase(basePayload({
          lifecycleStatus: 'purchase_order',
          landedCosts: { costs: [{ costType: 'freight', description: 'Freight', amount: 20 }] },
        }), auth), /PURCHASE_LANDED_COST_UNSUPPORTED_DOCUMENT/);
        const purchases = await (db2 as any).selectFrom('purchases').select('id').execute() as unknown as Array<unknown>;
        assert.equal(purchases.length, 0);
      } finally {
        await db2.destroy();
      }
    }
    // 4c: freight with service lines only is rejected.
    {
      const { pg: pg3, db: db3 } = await makeDb();
      try {
        await seedCurrency(db3, 'EGP');
        await seedProduct(db3, 12, 0, 0, 'service');
        await db3.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never).execute();
        const svc = makeServices(db3);
        await assert.rejects(() => svc.createPurchase(basePayload({
          items: [{ productId: 12, qty: 1, cost: 100 }],
          landedCosts: { costs: [{ costType: 'freight', description: 'Freight', amount: 20 }] },
        }), auth), /PURCHASE_LANDED_COST_NO_STOCKED_ITEMS/);
        const purchases = await (db3 as any).selectFrom('purchases').select('id').execute() as unknown as Array<unknown>;
        assert.equal(purchases.length, 0);
      } finally {
        await db3.destroy();
      }
    }
    // 4d: a sub-minor freight amount is rejected.
    {
      const { pg: pg4, db: db4 } = await makeDb();
      try {
        await seedCurrency(db4, 'EGP');
        await seedProduct(db4, 10, 15, 56.08);
        await db4.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', name: 'Supplier 9', balance: 0 } as never).execute();
        const svc = makeServices(db4);
        await assert.rejects(() => svc.createPurchase(basePayload({
          landedCosts: { costs: [{ costType: 'freight', description: 'Freight', amount: 0.005 }] },
        }), auth), /PURCHASE_LANDED_COST_PRECISION/);
        const purchases = await (db4 as any).selectFrom('purchases').select('id').execute() as unknown as Array<unknown>;
        assert.equal(purchases.length, 0);
      } finally {
        await db4.destroy();
      }
    }
  }

  // Case 5: source pin — the at-receipt allocation lives in
  // createPurchase only, through the canonical allocator and the
  // canonical WAC writer; the post-posting step is untouched.
  {
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchases-write.service.ts'), 'utf8');
    const createStart = serviceSource.indexOf('async createPurchase(');
    assert.ok(createStart > 0, 'createPurchase exists');
    const createBody = serviceSource.slice(createStart, serviceSource.indexOf('\n  async updatePurchase(', createStart));
    assert.ok(createBody.includes('validateAtReceiptLandedCosts('), 'create must validate at-receipt freight');
    assert.ok(createBody.includes('allocateAtReceiptLandedCosts('), 'create must allocate at-receipt freight over the stocked lines');
    assert.ok(createBody.includes('landedBaseUnitCost'), 'the receipt blend must use the landed base unit cost');
    assert.ok(createBody.includes('valueStockReceipt(trx, scope.tenantId, item.productId, stockChange.globalAfter, increasedQty, increasedQty * landedBaseUnitCost)'),
      'the WAC blend must receive the landed receipt value');
    assert.ok(createBody.includes("insertInto('purchase_landed_costs')"), 'create must store the freight breakdown');
    assert.ok(createBody.includes('landed_cost_applied_at'), 'create must stamp the header like the post-posting step');
    const validateStart = serviceSource.indexOf('private validateAtReceiptLandedCosts(');
    assert.ok(validateStart > 0, 'the at-receipt validator exists');
    const validateBody = serviceSource.slice(validateStart, serviceSource.indexOf('\n  private allocateAtReceiptLandedCosts(', validateStart));
    assert.ok(validateBody.includes('PURCHASE_LANDED_COST_VENDOR_MISMATCH'), 'a third-party freight vendor must fail closed');
    assert.ok(validateBody.includes('PURCHASE_LANDED_COST_UNSUPPORTED_DOCUMENT'), 'freight on a purchase order must fail closed');
    assert.ok(validateBody.includes('PURCHASE_LANDED_COST_PRECISION'), 'a sub-minor freight amount must fail closed');
    const manualSource = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchase-landed-costs.service.ts'), 'utf8');
    assert.ok(manualSource.includes('async applyPurchaseLandedCosts('), 'the post-posting step still exists');
    assert.ok(manualSource.includes('calculateStockFlowShares'), 'the post-posting sold/held split is untouched');
    const dtoSource = readFileSync(resolve(__dirname, '../../src/modules/purchases/dto/upsert-purchase.dto.ts'), 'utf8');
    assert.ok(dtoSource.includes('landedCosts?: PurchaseLandedCostsInputDto'), 'the invoice DTO carries landedCosts');
  }

  console.log('purchase-landed-cost-at-receipt: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
