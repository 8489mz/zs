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
import { weightedReturnCost } from '../../src/modules/accounting/engines/inventory-valuation.engine';
import { revalueStockReturn } from '../../src/modules/accounting/inventory-valuation';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Purchase-return WAC recompute (INV-PURCHASE-RETURN-WAC-RECOMPUTE).
 *
 * THE DEFECT, proved on a live-Postgres acceptance run: a purchase return
 * credited the ORIGINAL purchase cost (decided, INV-PURCHASE-RETURN-ORIGINAL-
 * COST) with neither a WAC recompute nor a 5190 variance, so the GL said
 * 245 while the physical pool (qty x cost_price) said 240 — a divergence
 * of 5. Mechanism: postPurchaseReturn computes priceVariance =
 * inventoryReturnCost - netReturnAmount; under original-cost credit both
 * are the original cost (10 - 10 = 0), so no 5190 leg posts — correctly —
 * but createPurchaseReturn never recomputed products.cost_price, so the
 * remaining pool kept the stale WAC.
 *
 * THE FIX, in the decided direction: keep the original-cost credit and
 * recompute the WAC in the SAME transaction. createPurchaseReturn calls
 * the canonical writer revalueStockReturn (inventory-valuation.ts) right
 * after applyStockDelta: the pool value falls by the line's GL inventory
 * credit at book digits and the remaining pool is re-blended with the
 * canonical engine function weightedReturnCost — the mirror of
 * weightedReceiptCost in the same engine file, same 6dp rounding, same
 * degenerate policy. No second formula was invented. postPurchaseReturn
 * is deliberately untouched: recovery re-posts journals for
 * already-created documents and must never reprice stock twice.
 *
 * DECISIONS, grounded in existing codebase patterns (flagged loudly):
 * (1) The recompute reuses the canonical WAC computation: the blend
 *     identity lives in inventory-valuation.engine.ts next to
 *     weightedReceiptCost, and the writer mirrors valueStockReceipt
 *     (same placement after applyStockDelta, same corrected-globalAfter
 *     quantity recovery per INV-WAC-QUANTITY-SOURCE, same product-row
 *     lock). Digits are the ones createPurchaseReturn already resolves
 *     on the transaction handle via tenantBaseCurrency (fail closed);
 *     the engine itself throws on invalid inputs.
 * (2) The subtracted value is the line's GL inventory credit at book
 *     digits (sold qty x original per-sold-unit cost) — exactly what
 *     postPurchaseReturn sums from return_items — so cost_price x
 *     afterQty reconciles with the 1140 leg to the minor unit.
 * (3) Degenerate pools keep beforeCost, mirroring the receipt blend:
 *     an emptied pool keeps the last booked cost, and a return whose
 *     value exceeds the pool value never stores a negative unit cost
 *     nor reprices the remainder UP to the returned cost.
 *
 * DELIBERATELY UNCHANGED: the original-cost credit itself and the 5190
 * variance (0 by construction — no variance leg); sale returns, goods
 * receipts, and the recovery re-post path. The acceptance expectation
 * change (240 -> 245) is a separate, gated follow-up owned elsewhere
 * and is NOT made here. This is not an end-to-end post on live
 * Postgres: journal_entry_lines DDL here is unbounded numeric, as in
 * the other book-digits specs.
 *
 * WHAT THIS PINS, driving the REAL ReturnsService + the REAL posting
 * boundary on PGlite (fresh database per case; audit + idempotency are
 * stubbed no-ops, the tenant foundation is stubbed as in the
 * commercial-posting spec):
 * - Case 1, the diagnosed example (EGP): 17 units at WAC 15, return 1
 *   unit from a line bought at net 10: stock 16, cost_price 15.3125
 *   (245/16), 1140 credited 10, no 5190 line, return_items.cost_price
 *   10, supplier balance reduced by 10.
 * - Case 2, emptied pool: 1 unit at 15, return it at 10: stock 0,
 *   cost_price stays 15, 1140 credited 10.
 * - Case 3, engine pins: the blend identity, the empty-pool and
 *   negative-result fallbacks, and fail-closed throws — importing the
 *   production engine function, no duplicated formula.
 * - Case 4, source pin: the recompute call lives in
 *   createPurchaseReturn only, via the canonical writer; the posting
 *   side keeps its original-cost variance computation unchanged.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
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
      track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE suppliers (id bigint, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text,
      amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, purchase_id bigint, paid_amount numeric DEFAULT 0);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric, paid_amount numeric DEFAULT 0,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted',
      prices_include_tax boolean DEFAULT false, tax_rate numeric DEFAULT 0);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint,
      qty numeric, unit_cost numeric, unit_multiplier numeric DEFAULT 1, line_total numeric,
      location_id bigint, batch_number text, grn_line_id bigint, grni_amount numeric);
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text,
      invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, note text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-02',
      tip_relief numeric(15, 3), courier_relief numeric(15, 3));
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
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 4100, 5100, 5190, 7290]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)',
      [code, 't1', String(code), code === 1150 || code === 2120]);
  }
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: code } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): ReturnsService {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined };
  const idempotencyStub = { commitOperation: async () => undefined };
  return new ReturnsService(db as any, new TransactionHelper(), auditStub as any, posting as any, idempotencyStub as any);
}

async function seedReturnFixture(db: Kysely<Database>, opts: { stockQty: number; wac: number; lineQty: number }): Promise<void> {
  await db.insertInto('products' as never).values({
    id: 10, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: opts.stockQty,
    reserved_qty: 0, cost_price: opts.wac, track_serials: false,
  } as never).execute();
  await db.insertInto('product_location_stock' as never).values({
    tenant_id: 't1', account_id: 'a1', product_id: 10, branch_id: null, location_id: null,
    qty: opts.stockQty, reserved_qty: 0,
  } as never).execute();
  await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', balance: 1000 } as never).execute();
  await db.insertInto('purchases' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', doc_no: 'P1', supplier_id: 9, payment_type: 'credit',
    subtotal: 200, discount: 0, tax_amount: 0, total: 200, paid_amount: 0,
    branch_id: null, location_id: null, status: 'posted', prices_include_tax: false, tax_rate: 0,
  } as never).execute();
  await db.insertInto('purchase_items' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', purchase_id: 1, product_id: 10,
    qty: opts.lineQty, unit_cost: 10, unit_multiplier: 1, line_total: opts.lineQty * 10,
    location_id: null, batch_number: null,
  } as never).execute();
}

async function journalLines(db: Kysely<Database>, entryId: number): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', '=', entryId).orderBy('id').execute() as unknown as Array<{ account_id: number; debit: string; credit: string }>;
  return rows.map((row) => ({ accountId: Number(row.account_id), debit: Number(row.debit), credit: Number(row.credit) }));
}

async function main(): Promise<void> {
  // Case 1: the diagnosed example — 17 units at WAC 15, return 1 at original cost 10.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedReturnFixture(db, { stockQty: 17, wac: 15, lineQty: 20 });
      const svc = makeServices(db);
      const result = await svc.createReturn({
        type: 'purchase', invoiceId: 1,
        items: [{ productId: 10, productName: 'Widget', qty: 1, purchaseItemId: 1 }],
      } as never, auth) as unknown as { ok: boolean; createdIds: number[] };
      assert.equal(result.ok, true);
      const product = await (db as any).selectFrom('products').select(['stock_qty', 'cost_price']).where('id', '=', 10).executeTakeFirstOrThrow() as unknown as { stock_qty: string; cost_price: string };
      assert.equal(Number(product.stock_qty), 16);
      assert.equal(Number(product.cost_price), 15.3125);
      const item = await (db as any).selectFrom('return_items').select(['qty', 'cost_price']).executeTakeFirstOrThrow() as unknown as { qty: string; cost_price: string };
      assert.equal(Number(item.qty), 1);
      assert.equal(Number(item.cost_price), 10);
      const movement = await (db as any).selectFrom('stock_movements').select(['qty', 'unit_cost']).executeTakeFirstOrThrow() as unknown as { qty: string; unit_cost: string };
      assert.equal(Number(movement.qty), -1);
      assert.equal(Number(movement.unit_cost), 10);
      const entry = await (db as any).selectFrom('journal_entries').select(['id']).where('source_type', '=', 'purchase_return').executeTakeFirstOrThrow() as unknown as { id: number };
      const lines = await journalLines(db, Number(entry.id));
      assert.deepEqual(lines, [
        { accountId: 2110, debit: 10, credit: 0 },
        { accountId: 1140, debit: 0, credit: 10 },
      ]);
      const supplier = await (db as any).selectFrom('suppliers').select('balance').where('id', '=', 9).executeTakeFirstOrThrow() as unknown as { balance: string };
      assert.equal(Number(supplier.balance), 990);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the return empties the pool — the last booked cost is kept.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedReturnFixture(db, { stockQty: 1, wac: 15, lineQty: 5 });
      const svc = makeServices(db);
      await svc.createReturn({
        type: 'purchase', invoiceId: 1,
        items: [{ productId: 10, productName: 'Widget', qty: 1, purchaseItemId: 1 }],
      } as never, auth);
      const product = await (db as any).selectFrom('products').select(['stock_qty', 'cost_price']).where('id', '=', 10).executeTakeFirstOrThrow() as unknown as { stock_qty: string; cost_price: string };
      assert.equal(Number(product.stock_qty), 0);
      assert.equal(Number(product.cost_price), 15);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: engine pins — the canonical blend, importing production code.
  {
    assert.equal(weightedReturnCost(17, 15, 1, 10), 15.3125);
    assert.equal(weightedReturnCost(10, 15.5, 2, 20.5), 16.8125);
    assert.equal(weightedReturnCost(1, 15, 1, 10), 15);
    assert.equal(weightedReturnCost(5, 5, 3, 30), 5);
    assert.equal(weightedReturnCost(0, 15, 1, 10), 10);
    assert.throws(() => weightedReturnCost(10, -1, 1, 10), /Invalid inventory return valuation inputs/);
    assert.throws(() => weightedReturnCost(10, 15, 0, 0), /Invalid inventory return valuation inputs/);
    assert.throws(() => weightedReturnCost(10, 15, 1, -5), /Invalid inventory return valuation inputs/);
    assert.throws(() => weightedReturnCost(10, 15, NaN, 10), /Invalid inventory return valuation inputs/);
    // The writer itself, on a bare products table, via the corrected globalAfter.
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, cost_price numeric);
        INSERT INTO products VALUES (1, 't1', 15);`);
      await revalueStockReturn(db as any, 't1', 1, 16, 1, 10);
      const row = await (db as any).selectFrom('products').select('cost_price').where('id', '=', 1).executeTakeFirstOrThrow() as unknown as { cost_price: string };
      assert.equal(Number(row.cost_price), 15.3125);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: source pin — the recompute lives in creation only, via the
  // canonical writer; the posting side keeps its original-cost variance.
  {
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/returns/returns.service.ts'), 'utf8');
    const createStart = serviceSource.indexOf('private async createPurchaseReturn(');
    assert.ok(createStart > 0, 'createPurchaseReturn exists');
    const createBody = serviceSource.slice(createStart);
    assert.ok(createBody.includes('revalueStockReturn(trx, scope.tenantId, requestItem.productId, stockChange.globalAfter, preparedLine.stockDelta'),
      'creation must re-blend WAC from the corrected globalAfter in the same transaction');
    assert.ok(createBody.includes('originalPurchaseReturnUnitCost('), 'creation must keep the original-cost derivation');
    const postingSource = readFileSync(resolve(__dirname, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    const postStart = postingSource.indexOf('async postPurchaseReturn(');
    assert.ok(postStart > 0, 'postPurchaseReturn exists');
    const postBody = postingSource.slice(postStart, postingSource.indexOf('\n  async ', postStart + 1));
    assert.ok(!postBody.includes('revalueStockReturn'), 'posting must never reprice stock (recovery re-posts)');
    assert.ok(postBody.includes('const priceVariance = toBookMoney(inventoryReturnCost - netReturnAmount)'),
      'posting must keep the original-cost variance computation');
    const engineSource = readFileSync(resolve(__dirname, '../../src/modules/accounting/engines/inventory-valuation.engine.ts'), 'utf8');
    assert.ok(engineSource.includes('export function weightedReturnCost('), 'the blend must live in the canonical engine');
    const writerSource = readFileSync(resolve(__dirname, '../../src/modules/accounting/inventory-valuation.ts'), 'utf8');
    assert.ok(writerSource.includes('export async function revalueStockReturn('), 'the writer must live beside valueStockReceipt');
  }

  console.log('purchase-return-wac-recompute: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
