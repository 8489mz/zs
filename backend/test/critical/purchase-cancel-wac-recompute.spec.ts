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
import { purchaseReceiptBaseUnitCost } from '../../src/modules/purchases/engines/purchase-receipt-cost.engine';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Purchase-cancel WAC recompute (INV-PURCHASE-CANCEL-WAC-RECOMPUTE).
 *
 * THE DEFECT, from the Slice 3 grounding (retail-slice3-purchases-
 * grounding.md, P1): cancelPurchase reversed the quantity, the journal
 * and the supplier balance but never recomputed products.cost_price,
 * so the remaining pool kept the cancelled receipt's blend and every
 * later sale's COGS was priced off stock that no longer existed.
 * Example: opening 10 @ 10.00 blended with 10 @ 11.00 (WAC 10.50)
 * and 10 @ 30.00 (WAC 17.00); cancelling the 11.00 receipt left 20
 * units worth 400.00, but cost_price stayed 17.00 instead of 20.00.
 *
 * THE FIX, in the decided direction: cancelPurchase calls the
 * canonical writer revalueStockReturn right after applyStockDelta,
 * in the same transaction, removing the ORIGINAL receipt value —
 * purchaseReceiptBaseUnitCost over the stored unit_cost (VAT-stripped,
 * per base unit), rounded once at book digits. That is the exact
 * inverse of the creation/receipt blend input, so the remaining pool
 * re-blends to the value the GL 1140 reversal leaves behind. No second
 * formula was invented: the writer and the blend identity are the ones
 * the purchase-return revaluation already uses.
 *
 * DECISIONS, grounded in existing codebase patterns (flagged loudly):
 * (1) Quantity rule — location governs admissibility, the global pool
 *     governs valuation. The location-scoped availability guard is
 *     UNCHANGED: cancel is all-or-nothing per line, so a partial sale
 *     or transfer from the receiving location still blocks the cancel
 *     (adjustment documents required) and the revaluation never runs
 *     on a partial pool. Valuation uses applyStockDelta's corrected
 *     globalAfter, exactly like the purchase-return revaluation
 *     (INV-WAC-QUANTITY-SOURCE). Case 3 pins the guard.
 * (2) Removed value basis — the creation blend input, not a per-line
 *     GL leg: cancel has no per-line GL credit (the journal reversal
 *     is an exact header mirror), so the value removed is
 *     roundMoney(removed base qty x purchaseReceiptBaseUnitCost, book
 *     digits). The return path removes qty x per-sold-unit cost
 *     through its own helper on the same stored fields; the two agree
 *     up to rounding dust when a unit multiplier applies.
 * (3) Fail closed — a missing, negative or non-finite stored unit_cost
 *     throws PURCHASE_CANCEL_COST_INVALID instead of silently keeping
 *     the stale WAC; corrupt multiplier/tax inputs throw from
 *     purchaseReceiptBaseUnitCost, as on the receipt paths.
 * (4) Degenerate pools keep beforeCost, mirroring the receipt blend:
 *     a cancelled receipt that empties the pool keeps the last booked
 *     cost, and a removal whose value exceeds the pool value never
 *     stores a negative unit cost.
 *
 * DELIBERATELY UNCHANGED: the journal reversal (exact mirror via
 * reversePurchaseJournal), the supplier-balance and treasury
 * reversals, the returns / landed-cost / paid guards, the draft and
 * GRN-bill early returns, and the edit path (updatePurchase still
 * blends nothing on reversal — unreachable in the status vocabulary
 * found in code, and not bundled here). This is not an end-to-end
 * post on live Postgres: journal_entry_lines DDL here is unbounded
 * numeric, as in the other book-digits specs, and the purchase +
 * journal are seeded to the shape postPurchase writes.
 *
 * WHAT THIS PINS, driving the REAL PurchasesWriteService on PGlite
 * (fresh database per case; audit + idempotency are stubbed no-ops,
 * the tenant foundation is stubbed as in the commercial-posting spec,
 * and the query service is stubbed for the response envelope only —
 * no pinned assertion reads it):
 * - Case 1, the diagnosed example (EGP): 30 units at WAC 17.00,
 *   cancel the 10-unit receipt bought at net 11.00: stock 20,
 *   cost_price 20.00, purchase cancelled, reversal journal mirrors
 *   the seeded 1140/2110 legs, supplier balance 110 -> 0 with a
 *   purchase_cancel ledger entry of -110, purchase_cancel movement
 *   of -10.
 * - Case 2, 3-decimal tenant with a tax-inclusive carton receipt
 *   (KWD): 20 units at WAC 12.500, cancel 5 cartons x 33.000 at 10%
 *   VAT, multiplier 2 (per-base cost 15.000): stock 10, cost_price
 *   10.000, reversal mirrors the 1140/1150/2110 legs.
 * - Case 3, the guard: 5 units left at the receiving location
 *   against a 10-unit receipt (25 more units sit elsewhere) — the
 *   cancel throws PURCHASE_CANCEL_STOCK_INVALID and stock, WAC,
 *   status and journals are untouched.
 * - Case 4, emptied pool: 10 units at 11.00, cancel the only
 *   receipt: stock 0, cost_price stays 11.00.
 * - Case 5, source pin: the recompute lives in cancelPurchase only,
 *   via the canonical writer; the edit path and the posting reversal
 *   never reprice stock; the invariant entry exists exactly once;
 *   and the removal-value basis is the receipt-cost engine itself.
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
      item_type text, track_serials boolean DEFAULT false, updated_at timestamptz);
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
    CREATE TABLE supplier_payment_schedules (id bigserial PRIMARY KEY, tenant_id text, purchase_id bigint,
      paid_amount numeric DEFAULT 0, status text DEFAULT 'active', updated_by bigint, updated_at timestamptz);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric, paid_amount numeric DEFAULT 0,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted',
      prices_include_tax boolean DEFAULT false, tax_rate numeric DEFAULT 0,
      landed_cost_applied_at timestamptz, landed_cost_total numeric DEFAULT 0,
      cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, updated_at timestamptz);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint,
      qty numeric, unit_cost numeric, unit_multiplier numeric DEFAULT 1, line_total numeric,
      location_id bigint, batch_number text, grn_line_id bigint, grni_amount numeric);
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

function makeServices(db: Kysely<Database>): PurchasesWriteService {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined };
  const idempotencyStub = {};
  const queryStub = {
    getPurchaseById: async () => ({ purchase: { id: 1, status: 'cancelled' } }),
    listPurchases: async () => ({ purchases: [] }),
  };
  return new PurchasesWriteService(
    db as any, new TransactionHelper(), auditStub as any,
    new PurchasesFinanceService(), queryStub as any, posting as any, idempotencyStub as any,
  );
}

type CancelFixture = {
  stockQty: number;
  wac: number;
  locationBalances: Array<{ branchId: number | null; locationId: number | null; qty: number }>;
  purchase: { total: number; taxAmount: number; taxRate: number; pricesIncludeTax: boolean; locationId: number | null; supplierBalance: number };
  line: { qty: number; unitCost: number; unitMultiplier: number; locationId: number | null };
  journalLegs: Array<{ accountId: number; debit: number; credit: number }>;
};

async function seedCancelFixture(db: Kysely<Database>, opts: CancelFixture): Promise<void> {
  await db.insertInto('products' as never).values({
    id: 10, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: opts.stockQty,
    reserved_qty: 0, cost_price: opts.wac, track_serials: false,
  } as never).execute();
  for (const balance of opts.locationBalances) {
    await db.insertInto('product_location_stock' as never).values({
      tenant_id: 't1', account_id: 'a1', product_id: 10, branch_id: balance.branchId, location_id: balance.locationId,
      qty: balance.qty, reserved_qty: 0,
    } as never).execute();
  }
  await db.insertInto('suppliers' as never).values({ id: 9, tenant_id: 't1', balance: opts.purchase.supplierBalance } as never).execute();
  await db.insertInto('purchases' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', doc_no: 'P1', supplier_id: 9, payment_type: 'credit',
    subtotal: opts.purchase.total - opts.purchase.taxAmount, discount: 0, tax_amount: opts.purchase.taxAmount,
    total: opts.purchase.total, paid_amount: 0,
    branch_id: null, location_id: opts.purchase.locationId, status: 'posted',
    prices_include_tax: opts.purchase.pricesIncludeTax, tax_rate: opts.purchase.taxRate,
    landed_cost_applied_at: null, landed_cost_total: 0,
  } as never).execute();
  await db.insertInto('purchase_items' as never).values({
    id: 1, tenant_id: 't1', account_id: 'a1', purchase_id: 1, product_id: 10,
    qty: opts.line.qty, unit_cost: opts.line.unitCost, unit_multiplier: opts.line.unitMultiplier,
    line_total: opts.line.qty * opts.line.unitCost,
    location_id: opts.line.locationId, batch_number: null,
  } as never).execute();
  await db.insertInto('journal_entries' as never).values({
    tenant_id: 't1', account_id: 'a1', entry_no: 'JE-00000001', entry_date: '2026-10-01',
    description: 'purchase', source_type: 'purchase', source_id: 1, status: 'posted',
    branch_id: null, location_id: null, created_by: 1,
  } as never).execute();
  const entry = await (db as any).selectFrom('journal_entries').select('id').where('entry_no', '=', 'JE-00000001').executeTakeFirstOrThrow() as unknown as { id: number };
  for (const leg of opts.journalLegs) {
    await db.insertInto('journal_entry_lines' as never).values({
      journal_entry_id: Number(entry.id), tenant_id: 't1', account_id: leg.accountId,
      description: 'purchase', debit: leg.debit, credit: leg.credit,
      partner_type: 'supplier', partner_id: 9, branch_id: null, location_id: null,
    } as never).execute();
  }
}

async function readProduct(db: Kysely<Database>): Promise<{ stockQty: number; costPrice: number }> {
  const row = await (db as any).selectFrom('products').select(['stock_qty', 'cost_price']).where('id', '=', 10).executeTakeFirstOrThrow() as unknown as { stock_qty: string; cost_price: string };
  return { stockQty: Number(row.stock_qty), costPrice: Number(row.cost_price) };
}

async function journalLines(db: Kysely<Database>, sourceType: string): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const entry = await (db as any).selectFrom('journal_entries').select(['id']).where('source_type', '=', sourceType).executeTakeFirst() as unknown as { id: number } | undefined;
  if (!entry) return [];
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', '=', Number(entry.id)).orderBy('id').execute() as unknown as Array<{ account_id: number; debit: string; credit: string }>;
  return rows.map((row) => ({ accountId: Number(row.account_id), debit: Number(row.debit), credit: Number(row.credit) }));
}

async function main(): Promise<void> {
  // Case 1: the diagnosed example (EGP) — 30 @ 17.00, cancel 10 @ 11.00.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedCancelFixture(db, {
        stockQty: 30, wac: 17,
        locationBalances: [{ branchId: null, locationId: null, qty: 30 }],
        purchase: { total: 110, taxAmount: 0, taxRate: 0, pricesIncludeTax: false, locationId: null, supplierBalance: 110 },
        line: { qty: 10, unitCost: 11, unitMultiplier: 1, locationId: null },
        journalLegs: [
          { accountId: 1140, debit: 110, credit: 0 },
          { accountId: 2110, debit: 0, credit: 110 },
        ],
      });
      const svc = makeServices(db);
      await svc.cancelPurchase(1, 'wrong receipt', auth);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 20);
      assert.equal(product.costPrice, 20);
      const purchase = await (db as any).selectFrom('purchases').select('status').where('id', '=', 1).executeTakeFirstOrThrow() as unknown as { status: string };
      assert.equal(purchase.status, 'cancelled');
      assert.deepEqual(await journalLines(db, 'purchase_reversal'), [
        { accountId: 1140, debit: 0, credit: 110 },
        { accountId: 2110, debit: 110, credit: 0 },
      ]);
      const supplier = await (db as any).selectFrom('suppliers').select('balance').where('id', '=', 9).executeTakeFirstOrThrow() as unknown as { balance: string };
      assert.equal(Number(supplier.balance), 0);
      const ledger = await (db as any).selectFrom('supplier_ledger').select(['entry_type', 'amount']).executeTakeFirstOrThrow() as unknown as { entry_type: string; amount: string };
      assert.equal(ledger.entry_type, 'purchase_cancel');
      assert.equal(Number(ledger.amount), -110);
      const movement = await (db as any).selectFrom('stock_movements').select(['movement_type', 'qty']).where('movement_type', '=', 'purchase_cancel').executeTakeFirstOrThrow() as unknown as { movement_type: string; qty: string };
      assert.equal(Number(movement.qty), -10);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: 3-decimal tenant, tax-inclusive carton receipt (KWD) —
  // 20 @ 12.500, cancel 5 cartons x 33.000 at 10% VAT, multiplier 2.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedCancelFixture(db, {
        stockQty: 20, wac: 12.5,
        locationBalances: [{ branchId: null, locationId: null, qty: 20 }],
        purchase: { total: 165, taxAmount: 15, taxRate: 10, pricesIncludeTax: true, locationId: null, supplierBalance: 165 },
        line: { qty: 5, unitCost: 33, unitMultiplier: 2, locationId: null },
        journalLegs: [
          { accountId: 1140, debit: 150, credit: 0 },
          { accountId: 1150, debit: 15, credit: 0 },
          { accountId: 2110, debit: 0, credit: 165 },
        ],
      });
      const svc = makeServices(db);
      await svc.cancelPurchase(1, 'wrong receipt', auth);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 10);
      assert.equal(product.costPrice, 10);
      assert.deepEqual(await journalLines(db, 'purchase_reversal'), [
        { accountId: 1140, debit: 0, credit: 150 },
        { accountId: 1150, debit: 0, credit: 15 },
        { accountId: 2110, debit: 165, credit: 0 },
      ]);
      const supplier = await (db as any).selectFrom('suppliers').select('balance').where('id', '=', 9).executeTakeFirstOrThrow() as unknown as { balance: string };
      assert.equal(Number(supplier.balance), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: the location guard — only 5 units left at the receiving
  // location against a 10-unit receipt (25 more sit elsewhere).
  // The cancel must fail closed and touch nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedCancelFixture(db, {
        stockQty: 30, wac: 17,
        locationBalances: [
          { branchId: null, locationId: 7, qty: 5 },
          { branchId: null, locationId: 8, qty: 25 },
        ],
        purchase: { total: 110, taxAmount: 0, taxRate: 0, pricesIncludeTax: false, locationId: 7, supplierBalance: 110 },
        line: { qty: 10, unitCost: 11, unitMultiplier: 1, locationId: 7 },
        journalLegs: [
          { accountId: 1140, debit: 110, credit: 0 },
          { accountId: 2110, debit: 0, credit: 110 },
        ],
      });
      const svc = makeServices(db);
      await assert.rejects(() => svc.cancelPurchase(1, 'wrong receipt', auth), /PURCHASE_CANCEL_STOCK_INVALID/);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 30);
      assert.equal(product.costPrice, 17);
      const purchase = await (db as any).selectFrom('purchases').select('status').where('id', '=', 1).executeTakeFirstOrThrow() as unknown as { status: string };
      assert.equal(purchase.status, 'posted');
      assert.deepEqual(await journalLines(db, 'purchase_reversal'), []);
      const movements = await (db as any).selectFrom('stock_movements').select('id').where('movement_type', '=', 'purchase_cancel').execute() as unknown as Array<unknown>;
      assert.equal(movements.length, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: the cancelled receipt empties the pool — the last booked
  // cost is kept, mirroring the receipt blend's degenerate policy.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedCancelFixture(db, {
        stockQty: 10, wac: 11,
        locationBalances: [{ branchId: null, locationId: null, qty: 10 }],
        purchase: { total: 110, taxAmount: 0, taxRate: 0, pricesIncludeTax: false, locationId: null, supplierBalance: 110 },
        line: { qty: 10, unitCost: 11, unitMultiplier: 1, locationId: null },
        journalLegs: [
          { accountId: 1140, debit: 110, credit: 0 },
          { accountId: 2110, debit: 0, credit: 110 },
        ],
      });
      const svc = makeServices(db);
      await svc.cancelPurchase(1, 'wrong receipt', auth);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 0);
      assert.equal(product.costPrice, 11);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: source pin — the recompute lives in cancelPurchase only,
  // via the canonical writer; the edit path and the posting reversal
  // never reprice stock; the invariant entry exists exactly once;
  // and the removal-value basis is the receipt-cost engine itself.
  {
    assert.equal(purchaseReceiptBaseUnitCost(11, 1, 0, false), 11);
    // The engine returns the unrounded division; the WAC writer rounds
    // to 6dp, so the basis pin compares at that precision.
    assert.equal(Number(purchaseReceiptBaseUnitCost(33, 2, 10, true).toFixed(6)), 15);
    assert.equal(purchaseReceiptBaseUnitCost(33, 2, 10, false), 16.5);
    const serviceSource = readFileSync(resolve(__dirname, '../../src/modules/purchases/services/purchases-write.service.ts'), 'utf8');
    const cancelStart = serviceSource.indexOf('async cancelPurchase(');
    assert.ok(cancelStart > 0, 'cancelPurchase exists');
    const cancelBody = serviceSource.slice(cancelStart, serviceSource.indexOf('\n  async ', cancelStart + 1));
    assert.ok(cancelBody.includes('await revalueStockReturn(trx, scope.tenantId, Number(item.product_id), stockChange.globalAfter, removeQty'),
      'cancel must re-blend WAC from the corrected globalAfter in the same transaction');
    assert.ok(cancelBody.includes('purchaseReceiptBaseUnitCost('), 'cancel must derive the removed value from the receipt-cost engine');
    assert.ok(cancelBody.includes('PURCHASE_CANCEL_COST_INVALID'), 'cancel must fail closed on a corrupt stored cost');
    const updateStart = serviceSource.indexOf('async updatePurchase(');
    assert.ok(updateStart > 0, 'updatePurchase exists');
    const updateBody = serviceSource.slice(updateStart, serviceSource.indexOf('\n  async ', updateStart + 1));
    assert.ok(!updateBody.includes('revalueStockReturn'), 'the edit path stays untouched (unreachable reversal)');
    const postingSource = readFileSync(resolve(__dirname, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    const reverseStart = postingSource.indexOf('async reversePurchaseJournal(');
    assert.ok(reverseStart > 0, 'reversePurchaseJournal exists');
    const reverseBody = postingSource.slice(reverseStart, postingSource.indexOf('\n  async ', reverseStart + 1));
    assert.ok(!reverseBody.includes('revalueStockReturn'), 'the posting reversal must never reprice stock');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-PURCHASE-CANCEL-WAC-RECOMPUTE').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('purchase-cancel-wac-recompute: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
