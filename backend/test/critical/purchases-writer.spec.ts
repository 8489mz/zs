/*
New file: backend/test/critical/purchases-writer.spec.ts
Pins INV-PHASE1-A8-PURCHASES-MANUFACTURING-WRITER (purchases half):
the 3 purchases sites that CAN migrate now route through the single
writer (recordStockMovement) instead of hand-writing their rows.

MIGRATED (this package):
- purchase_cancel (:279) — no unit_cost/total_cost at all today, so the
  writer stores the A6/A7 0/0 shape. The WAC revalue (cancel-only) and
  the supplier/journal reversal are unchanged.
- purchase_edit_restore (:254) and purchase_edit_apply (:497) — likewise
  no cost today, so both rows become 0/0. NOTE the edit path never
  reprices stock (the recompute lives in cancelPurchase only): the
  restore only reverses the quantity, so the WAC after an edit blends
  from the PRE-edit cost, not from a revalued one.

MIGRATED in A10 (cost-rounding unification —
INV-PHASE1-A10-ROUNDING-UNIFICATION): the writer gained the
composite-total mode (totalUnitCost + freightShare), and the three
sites now route through it (phase1-a10-purchases-writer.spec.ts
drives the real services). §4 keeps the same concrete inputs and now
asserts the new modes REPRODUCE the stored totals. A totalCost
override param was NOT the answer (it would let the writer stamp a
total it did not compute); the composite mode computes the total from
(delta x totalUnit) at book digits plus the exact freight share.
- GRN :301 stored stockMovementTotal(accepted, lineUnitCost) + freight,
  a COMPOSITE total — now totalUnitCost: lineUnitCost,
  freightShare: allocatedFreight.
- create :708 stored roundMoney(net*qty) + freight — the same composite,
  now totalUnitCost: baseUnitCost, freightShare: allocatedFreight.
- receive-goods :247 stored roundMoney(effectiveUnitCost * qty) from the
  FULL repeating-decimal division — now totalUnitCost: effectiveUnitCost.
The existing critical specs that pin their totals
(grn-freight-allocation, grn-journal-central-posting,
purchase-landed-cost-at-receipt) stay green in the A10 loop.

WHAT THIS PINS, driving the REAL cancelPurchase / updatePurchase on
PGlite (facade construction copied from purchase-cancel-wac-recompute):
0. The routing itself: cancel + update hold ZERO direct
   insertInto('stock_movements') (1 + 2 writer calls), and the 3
   A10-migrated files now hold ZERO direct inserts (1 writer call each).
1. cancelPurchase: exactly 1 row, 0/0 costs, exact before/after;
   stock 30 -> 20, WAC 17 -> 20 (cancel-only revalue), supplier 110 -> 0.
2. updatePurchase: exactly 2 rows (restore -10 + apply +6), both 0/0;
   stock 30 -> 26, WAC 17 -> 15.846154 (restore keeps 17, apply blends
   (20*17 + 6*12)/26); purchase total 110 -> 72; supplier 110 -> 72.
3. Rollback: an edit whose apply leg fails (unknown product) leaves
   ZERO movement rows and untouched balances — the writer shares the
   edit's transaction.
4. The A10 proof: the same concrete inputs, now asserting the new
   modes REPRODUCE the stored totals (the plain-writer totals are kept
   as the contrast — the reason the deferral existed at all).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { PurchasesWriteService } from '../../src/modules/purchases/services/purchases-write.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { recordStockMovement } from '../../src/common/utils/stock-movement-writer';
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';
import { purchaseReceiptBaseUnitCost } from '../../src/modules/purchases/engines/purchase-receipt-cost.engine';
import { stockMovementTotal } from '../../src/modules/catalog/engines/stock-movement-total.engine';

const auth = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'tester',
  // The edit flow checks these two permissions by NAME (the shared
  // helper does not treat the admin role as holding them): cost edits
  // need canEditPrice, discount changes need canDiscount.
  permissions: ['canEditPrice', 'canDiscount'],
} as unknown as AuthContext;

const SRC = (rel: string): string => fs.readFileSync(path.resolve(__dirname, '../../src', rel), 'utf8');

function countDirectInserts(src: string): number {
  return (src.match(/insertInto\('stock_movements'\)/g) || []).length;
}

function countWriterCalls(src: string): number {
  return (src.match(/await recordStockMovement\(trx, \{/g) || []).length;
}

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, is_active boolean DEFAULT true);
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
      item_type text, item_kind text, style_code text, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0,
      default_location_id bigint, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE suppliers (id bigint, tenant_id text, name text, is_active boolean DEFAULT true, balance numeric DEFAULT 0, updated_at timestamptz);
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
      supplier_invoice_no text, duplicate_override_reason text, duplicate_overridden_by bigint, note text,
      required_date date, currency text, company_name text, contact_id bigint, shipping_address_id bigint,
      cost_center_id bigint, project_id bigint, import_project_id bigint, terms_template text,
      cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, updated_at timestamptz);
    CREATE TABLE purchase_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint,
      product_name text, unit_name text, category_id bigint,
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
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint,
      import_receipt_id bigint);
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
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)', [
      code,
      't1',
      String(code),
      code === 1150 || code === 2120,
    ]);
  }
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

function makeServices(db: Kysely<Database>): PurchasesWriteService {
  const foundation = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined };
  const idempotencyStub = {};
  const queryStub = {
    getPurchaseById: async () => ({ purchase: { id: 1, status: 'cancelled' } }),
    listPurchases: async () => ({ purchases: [] }),
  };
  return new PurchasesWriteService(
    db,
    new TransactionHelper(),
    auditStub as never,
    new PurchasesFinanceService(),
    queryStub as never,
    posting,
    idempotencyStub as never,
  );
}

async function seedCancelFixture(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('products' as never)
    .values({
      id: 10,
      tenant_id: 't1',
      account_id: 'a1',
      name: 'Widget',
      stock_qty: 30,
      reserved_qty: 0,
      cost_price: 17,
      track_serials: false,
    } as never)
    .execute();
  await db
    .insertInto('product_location_stock' as never)
    .values({
      tenant_id: 't1',
      account_id: 'a1',
      product_id: 10,
      branch_id: null,
      location_id: null,
      qty: 30,
      reserved_qty: 0,
    } as never)
    .execute();
  await db
    .insertInto('suppliers' as never)
    .values({ id: 9, tenant_id: 't1', name: 'Supplier 9', is_active: true, balance: 110 } as never)
    .execute();
  await db
    .insertInto('purchases' as never)
    .values({
      id: 1,
      tenant_id: 't1',
      account_id: 'a1',
      doc_no: 'PUR-1',
      supplier_id: 9,
      payment_type: 'credit',
      subtotal: 110,
      discount: 0,
      tax_amount: 0,
      total: 110,
      branch_id: null,
      location_id: null,
      status: 'posted',
      lifecycle_status: 'posted',
      tax_rate: 0,
      prices_include_tax: false,
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
      product_name: 'Widget',
      qty: 10,
      unit_cost: 11,
      unit_multiplier: 1,
      line_total: 110,
      location_id: null,
    } as never)
    .execute();
  await db
    .insertInto('journal_entries' as never)
    .values({
      entry_no: 'JE-00000001',
      entry_date: '2026-10-01',
      description: 'purchase',
      source_type: 'purchase',
      source_id: 1,
      status: 'posted',
      branch_id: null,
      location_id: null,
      created_by: 1,
    } as never)
    .execute();
  const entry = (await db
    .selectFrom('journal_entries')
    .select('id')
    .where('entry_no', '=', 'JE-00000001')
    .executeTakeFirstOrThrow()) as unknown as { id: number };
  for (const leg of [
    { accountId: 1140, debit: 110, credit: 0 },
    { accountId: 2110, debit: 0, credit: 110 },
  ]) {
    await db
      .insertInto('journal_entry_lines' as never)
      .values({
        journal_entry_id: Number(entry.id),
        tenant_id: 't1',
        account_id: leg.accountId,
        description: 'purchase',
        debit: leg.debit,
        credit: leg.credit,
        partner_type: 'supplier',
        partner_id: 9,
        branch_id: null,
        location_id: null,
      } as never)
      .execute();
  }
}

async function seedUpdateFixture(db: Kysely<Database>): Promise<void> {
  await db
    .insertInto('stock_locations' as never)
    .values({ id: 1, tenant_id: 't1', branch_id: null, is_active: true } as never)
    .execute();
  await db
    .insertInto('products' as never)
    .values({
      id: 10,
      tenant_id: 't1',
      account_id: 'a1',
      name: 'Widget',
      stock_qty: 30,
      reserved_qty: 0,
      cost_price: 17,
      is_active: true,
      track_serials: false,
    } as never)
    .execute();
  await db
    .insertInto('product_location_stock' as never)
    .values({
      tenant_id: 't1',
      account_id: 'a1',
      product_id: 10,
      branch_id: null,
      location_id: 1,
      qty: 30,
      reserved_qty: 0,
    } as never)
    .execute();
  await db
    .insertInto('suppliers' as never)
    .values({ id: 9, tenant_id: 't1', name: 'Supplier 9', is_active: true, balance: 110 } as never)
    .execute();
  // Guard-passing shape for the legacy edit flow: NOT posted/cancelled/
  // draft, lifecycle NOT purchase_order/grn_bill (a posted invoice is
  // immutable and a draft needs the metadata-only edit path).
  await db
    .insertInto('purchases' as never)
    .values({
      id: 2,
      tenant_id: 't1',
      account_id: 'a1',
      doc_no: 'PUR-2',
      supplier_id: 9,
      payment_type: 'credit',
      subtotal: 110,
      discount: 0,
      tax_amount: 0,
      total: 110,
      branch_id: null,
      location_id: 1,
      status: 'received',
      lifecycle_status: null,
      tax_rate: 0,
      prices_include_tax: false,
    } as never)
    .execute();
  await db
    .insertInto('purchase_items' as never)
    .values({
      id: 2,
      tenant_id: 't1',
      account_id: 'a1',
      purchase_id: 2,
      product_id: 10,
      product_name: 'Widget',
      unit_name: 'قطعة',
      qty: 10,
      unit_cost: 11,
      unit_multiplier: 1,
      line_total: 110,
      location_id: 1,
    } as never)
    .execute();
}

type PurchaseMovementRow = {
  productId: number;
  type: string;
  qty: number;
  before: number;
  after: number;
  unit: number | null;
  total: number | null;
  reason: string;
  note: string;
  referenceId: number;
  branch: number | null;
  location: number | null;
};

async function purchaseMovements(db: Kysely<Database>, purchaseId: number): Promise<PurchaseMovementRow[]> {
  const rows = (await db
    .selectFrom('stock_movements')
    .select([
      'product_id',
      'movement_type',
      'qty',
      'before_qty',
      'after_qty',
      'unit_cost',
      'total_cost',
      'reason',
      'note',
      'reference_id',
      'branch_id',
      'location_id',
    ])
    .where('reference_type', '=', 'purchase')
    .where('reference_id', '=', purchaseId)
    .orderBy('id')
    .execute()) as unknown as Array<{
    product_id: number;
    movement_type: string;
    qty: string;
    before_qty: string;
    after_qty: string;
    unit_cost: string | null;
    total_cost: string | null;
    reason: string;
    note: string;
    reference_id: number;
    branch_id: number | null;
    location_id: number | null;
  }>;
  return rows.map((r) => ({
    productId: Number(r.product_id),
    type: r.movement_type,
    qty: Number(r.qty),
    before: Number(r.before_qty),
    after: Number(r.after_qty),
    unit: r.unit_cost === null ? null : Number(r.unit_cost),
    total: r.total_cost === null ? null : Number(r.total_cost),
    reason: r.reason,
    note: r.note,
    referenceId: Number(r.reference_id),
    branch: r.branch_id === null ? null : Number(r.branch_id),
    location: r.location_id === null ? null : Number(r.location_id),
  }));
}

async function readProduct(db: Kysely<Database>): Promise<{ stockQty: number; costPrice: number }> {
  const row = (await db
    .selectFrom('products')
    .select(['stock_qty', 'cost_price'])
    .where('id', '=', 10)
    .executeTakeFirstOrThrow()) as unknown as { stock_qty: string; cost_price: string };
  return { stockQty: Number(row.stock_qty), costPrice: Number(row.cost_price) };
}

async function readSupplierBalance(db: Kysely<Database>): Promise<number> {
  const row = (await db
    .selectFrom('suppliers')
    .select(['balance'])
    .where('id', '=', 9)
    .executeTakeFirstOrThrow()) as unknown as { balance: string };
  return Number(row.balance);
}

async function readPurchaseTotal(db: Kysely<Database>, purchaseId: number): Promise<number> {
  const row = (await db
    .selectFrom('purchases')
    .select(['total'])
    .where('id', '=', purchaseId)
    .executeTakeFirstOrThrow()) as unknown as { total: string };
  return Number(row.total);
}

function assertZeroCost(row: PurchaseMovementRow, what: string): void {
  assert.ok(row.unit !== null && row.unit === 0, `${what} unit_cost must be 0, not NULL (writer 0/0 shape)`);
  assert.ok(row.total !== null && row.total === 0, `${what} total_cost must be 0, not NULL (writer 0/0 shape)`);
}

async function main(): Promise<void> {
  // §0 — the routing pin: cancel + update hold ZERO direct inserts
  // (1 + 2 writer calls), and the 3 A10-migrated files hold ZERO direct
  // inserts (1 writer call each).
  {
    const cancel = SRC('modules/purchases/services/purchases-write-cancel.service.ts');
    const update = SRC('modules/purchases/services/purchases-write-update.service.ts');
    assert.equal(countDirectInserts(cancel), 0, 'cancel must hold zero direct stock_movements inserts');
    assert.equal(countWriterCalls(cancel), 1, 'cancel must call recordStockMovement exactly once');
    assert.equal(countDirectInserts(update), 0, 'update must hold zero direct stock_movements inserts');
    assert.equal(countWriterCalls(update), 2, 'update must call recordStockMovement exactly twice (restore + apply)');
    assert.equal(
      countDirectInserts(SRC('modules/purchases/services/goods-receipt-post.service.ts')),
      0,
      'GRN migrated in A10 (composite mode)',
    );
    assert.equal(countWriterCalls(SRC('modules/purchases/services/goods-receipt-post.service.ts')), 1);
    assert.equal(
      countDirectInserts(SRC('modules/purchases/services/purchases-write-create.service.ts')),
      0,
      'create migrated in A10 (composite mode)',
    );
    assert.equal(countWriterCalls(SRC('modules/purchases/services/purchases-write-create.service.ts')), 1);
    assert.equal(
      countDirectInserts(SRC('modules/purchases/services/purchases-write-receive-goods.service.ts')),
      0,
      'receive-goods migrated in A10 (full-precision mode)',
    );
    assert.equal(countWriterCalls(SRC('modules/purchases/services/purchases-write-receive-goods.service.ts')), 1);
  }

  // §1 — cancel: 30 @ 17, cancel 10 @ 11.
  {
    const { db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedCancelFixture(db);
      const svc = makeServices(db);
      await svc.cancelPurchase(1, 'wrong receipt', auth);
      const rows = await purchaseMovements(db, 1);
      assert.equal(rows.length, 1, 'exactly 1 movement row');
      const row = rows[0];
      assert.equal(row.type, 'purchase_cancel');
      assert.equal(row.productId, 10);
      assert.equal(row.qty, -10);
      assert.equal(row.before, 30);
      assert.equal(row.after, 20);
      assertZeroCost(row, 'cancel row');
      assert.equal(row.reason, 'purchase_cancel');
      assert.ok(row.note.startsWith('Cancel'), 'cancel note carries the Cancel reference');
      assert.equal(row.branch, null);
      assert.equal(row.location, null);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 20, 'stock falls 30 -> 20');
      assert.equal(product.costPrice, 20, 'WAC revalues 17 -> 20 (cancel-only recompute)');
      assert.equal(await readSupplierBalance(db), 0, 'supplier balance falls 110 -> 0');
    } finally {
      await db.destroy();
    }
  }

  // §2 — update: old line 10 @ 11 replaced by 6 @ 12.
  // Restore reverses the quantity only (WAC stays 17); apply blends
  // (20*17 + 6*12)/26 = 15.846154 at 6dp.
  {
    const { db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedUpdateFixture(db);
      const svc = makeServices(db);
      await svc.updatePurchase(
        2,
        {
          editReason: 'fix price',
          supplierId: 9,
          paymentType: 'credit',
          items: [{ productId: 10, qty: 6, cost: 12, locationId: 1 }],
        } as never,
        auth,
      );
      const rows = await purchaseMovements(db, 2);
      assert.equal(rows.length, 2, 'exactly 2 movement rows: restore + apply');
      const [restore, apply] = rows;
      assert.equal(restore.type, 'purchase_edit_restore');
      assert.equal(restore.qty, -10);
      assert.equal(restore.before, 30);
      assert.equal(restore.after, 20);
      assertZeroCost(restore, 'restore row');
      assert.equal(restore.reason, 'purchase_edit_restore');
      assert.ok(restore.note.startsWith('Edit restore'), 'restore note carries the Edit restore reference');
      assert.equal(restore.location, 1);
      assert.equal(apply.type, 'purchase_edit_apply');
      assert.equal(apply.qty, 6);
      assert.equal(apply.before, 20);
      assert.equal(apply.after, 26);
      assertZeroCost(apply, 'apply row');
      assert.equal(apply.reason, 'purchase_edit_apply');
      assert.ok(apply.note.startsWith('Edit apply'), 'apply note carries the Edit apply reference');
      assert.equal(apply.location, 1);
      const product = await readProduct(db);
      assert.equal(product.stockQty, 26, 'stock ends 30 - 10 + 6 = 26');
      assert.equal(product.costPrice, 15.846154, 'WAC blends from the pre-edit 17: (20*17+72)/26');
      assert.equal(await readPurchaseTotal(db, 2), 72, 'purchase total becomes the new 6 @ 12 = 72');
      assert.equal(await readSupplierBalance(db), 72, 'supplier balance: 110 - 110 (restore) + 72 (apply)');
      const items = (await db
        .selectFrom('purchase_items')
        .select(['qty', 'unit_cost'])
        .where('purchase_id', '=', 2)
        .execute()) as unknown as Array<{ qty: string; unit_cost: string }>;
      assert.equal(items.length, 1, 'the old line is replaced by exactly the new line');
      assert.equal(Number(items[0].qty), 6);
      assert.equal(Number(items[0].unit_cost), 12);
    } finally {
      await db.destroy();
    }
  }

  // §3 — rollback: an edit whose apply leg fails (unknown product 999)
  // leaves ZERO movement rows and untouched balances — the writer shares
  // the edit's transaction, so the restore row rolls back too.
  {
    const { db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedUpdateFixture(db);
      const svc = makeServices(db);
      await assert.rejects(
        svc.updatePurchase(
          2,
          {
            editReason: 'fix price',
            supplierId: 9,
            paymentType: 'credit',
            items: [{ productId: 999, qty: 6, cost: 12, locationId: 1 }],
          } as never,
          auth,
        ),
        (err: unknown) => (err as { code?: string }).code === 'PRODUCT_NOT_FOUND',
        'an unknown apply product must fail the whole edit',
      );
      assert.equal((await purchaseMovements(db, 2)).length, 0, 'no movement row survives the rollback');
      const product = await readProduct(db);
      assert.equal(product.stockQty, 30, 'stock is untouched');
      assert.equal(product.costPrice, 17, 'WAC is untouched');
      assert.equal(await readPurchaseTotal(db, 2), 110, 'purchase total is untouched');
      assert.equal(await readSupplierBalance(db), 110, 'supplier balance is untouched');
    } finally {
      await db.destroy();
    }
  }

  // §4 — the A10 proof, with the REAL engines and the same concrete
  // inputs as the A8 deferral. The plain writer still diverges (the
  // contrast, kept); the new modes, driven through the REAL writer on
  // this spec's own harness, REPRODUCE the stored totals.
  {
    // GRN composite: stored = roundMoney(3 * 33.375) + freight 1 = 101.13;
    // the plain writer would see the landed unit 33.375 + 1/3 rounded to
    // 6dp and book roundMoney(3 * 33.708333) = 101.12 — a full minor unit
    // short.
    const grnStored = stockMovementTotal(3, 33.375, 2) + 1;
    const grnWriter = roundMoney(3 * Number((33.375 + 1 / 3).toFixed(6)), 2);
    assert.equal(Math.round(grnStored * 100), 10113, 'GRN stored total is 101.13');
    assert.equal(Math.round(grnWriter * 100), 10112, 'GRN plain-writer total would be 101.12');
    assert.notEqual(
      Math.round(grnStored * 100),
      Math.round(grnWriter * 100),
      'the composite GRN total diverges from the plain-writer total',
    );
    // Receive-goods repeating decimal: the effective unit cost is
    // 33.33 / 12 / 1.1 = 2.524999...; the stored total rounds the FULL
    // product (2.52) while the plain writer rounds the 6dp unit (2.53).
    const effective = purchaseReceiptBaseUnitCost(33.33, 12, 10, true);
    const receiveStored = roundMoney(effective * 1, 2);
    const receiveWriter = roundMoney(Number(effective.toFixed(6)) * 1, 2);
    assert.equal(Math.round(receiveStored * 100), 252, 'receive stored total is 2.52');
    assert.equal(Math.round(receiveWriter * 100), 253, 'receive plain-writer total would be 2.53');
    assert.notEqual(
      Math.round(receiveStored * 100),
      Math.round(receiveWriter * 100),
      'the repeating-decimal receive total diverges from the plain-writer total',
    );
    // The new modes, through the real writer: composite 101.13 and
    // full-precision 2.52 — the stored totals, not the plain ones.
    const { db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedCancelFixture(db);
      const grnResult = await db.transaction().execute(async (trx) => {
        return recordStockMovement(trx, {
          productId: 10,
          delta: 3,
          branchId: null,
          locationId: null,
          tenantId: 't1',
          accountId: 'a1',
          movementType: 'goods_receipt',
          unitCost: Number((33.375 + 1 / 3).toFixed(6)),
          totalUnitCost: 33.375,
          freightShare: 1,
          moneyDigits: 2,
          referenceType: 'goods_receipt',
          referenceId: 1,
          reason: 'goods_receipt',
          createdBy: 1,
        } as never);
      });
      assert.equal(Number(grnResult.totalCost), 101.13, 'composite mode reproduces the stored 101.13');
      const receiveResult = await db.transaction().execute(async (trx) => {
        return recordStockMovement(trx, {
          productId: 10,
          delta: 1,
          branchId: null,
          locationId: null,
          tenantId: 't1',
          accountId: 'a1',
          movementType: 'purchase_receipt',
          unitCost: Number(effective.toFixed(6)),
          totalUnitCost: effective,
          moneyDigits: 2,
          referenceType: 'purchase',
          referenceId: 1,
          reason: 'purchase_receipt',
          createdBy: 1,
        } as never);
      });
      assert.equal(Number(receiveResult.totalCost), 2.52, 'full-precision mode reproduces the stored 2.52');
    } finally {
      await db.destroy();
    }
  }

  // §5 — wiring: both critical lists carry 363 specs in identical
  // order, with the two A8 specs last.
  {
    const specs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 377);
    assert.equal(chain.length, 377);
    assert.deepEqual(chain, specs);
    assert.equal(specs[358], 'test/critical/sales-writer-create.spec.ts');
    assert.equal(specs[359], 'test/critical/sales-writer-cancel-edit.spec.ts');
    assert.equal(specs[360], 'test/critical/sales-writer-food-waste.spec.ts');
    assert.equal(specs[361], 'test/critical/manufacturing-writer.spec.ts');
    assert.equal(specs[362], 'test/critical/purchases-writer.spec.ts');
    assert.equal(specs[363], 'test/critical/phase1-a9-routing.spec.ts');
    assert.equal(specs[364], 'test/critical/phase1-a9-inventory-writer.spec.ts');
    assert.equal(specs[365], 'test/critical/phase1-a9-services-writer.spec.ts');
    assert.equal(specs[366], 'test/critical/phase1-a10-rounding.spec.ts');
    assert.equal(specs[367], 'test/critical/phase1-a10-purchases-writer.spec.ts');
    assert.equal(specs[368], 'test/critical/phase1-a10-import-writer.spec.ts');
    console.log('  evidence specs wired into both critical lists (373 = 373, identical order), passed');
  }
}

main()
  .then(() => {
    console.log('purchases-writer.spec: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('purchases-writer.spec: FAIL');
    console.error(err);
    process.exit(1);
  });
