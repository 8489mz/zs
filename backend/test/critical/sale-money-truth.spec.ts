/*
New file: backend/test/critical/sale-money-truth.spec.ts
Pins R4-A (INV-REST-SALE-MONEY-TRUTH): the server computes and posts
sale money truthfully.

WHAT THIS PINS:
- The pure service-charge engine: only a POS dine-in sale is
  recomputed (takeaway -> 0, disabled -> 0, non-POS -> null, i.e.
  leave as sent); dine-in recomputes (subtotal - discount) x
  percent at book digits, percent default 12, fail-closed on a
  garbled percent with TABLE_BILL_RATE_INVALID.
- The pure order-money helper: the dashboard form's arithmetic is
  the contract (gross subtotal, discount folds line discounts in,
  total = max(0, subtotal - discount) + tax); create-shape
  validation rejects a doctored line/subtotal/total, convert-shape
  rejects a doctored stored total.
- The real postSale over PGlite: an exclusive freelance sale posts
  Cr 4100 = subtotal, Cr 4200 = service charge, Cr 2115 = delivery
  fee, Cr 2147 = tip (at base all 142 sat in Cr 4100 and 2115/2147
  lines did not exist); a store-fleet delivery fee joins 4200 as
  revenue instead of 2115; a tax-inclusive sale with a discount
  strips the tax pro-rata and still balances exactly; postSaleEdit
  inherits the split; a freelance settlement relieves 2115, not
  6400. 2115/2147 auto-create on first post (4200 is seeded, as
  the COA migration seeds it in production).
- The real createSale through the mock DB (Tax F1 shape): a
  takeaway payload carrying serviceCharge 99 posts 0, a dine-in
  payload with an invented charge is recomputed to 12, an honest
  dine-in charge survives unchanged, a disabled tenant posts 0,
  a garbled percent throws before any write, and a non-POS
  dine-in payload keeps the charge it sent.

WHAT R6-E (INV-REST-SALE-MONEY-TRUTH-2) PINS, driving the real
postSalesReturn over PGlite (Part F):
- A partial return relieves 2147/2115 pro-rata by returned net
  goods over the sale's net goods base (half the goods -> half
  the tip and half the courier fee); a full return relieves both
  fully; a return of a sale with no tip/fee posts no 2147/2115
  lines; a store-fleet return touches neither 2115 nor 4200.
- The relief is part of the REFUND: the refund credit side grows
  by the reliefs (stored allocations summing to the return total
  are topped up in-memory on the last tender; a set already
  summing to total + reliefs is used as-is, never double-topped).
- A second partial return of the same sale does not over-relieve:
  the cumulative cap (original credited minus prior return
  relief) bounds it. Tax-inclusive sales use the same ex-tax
  goods leg postSale stripped (service share removed, discount
  netted) — never the exclusive formula.
- Return then settle does not double-relieve: settling the
  REDUCED amount (remaining receivable - remaining fee) posts the
  reduced fee and lands 2115 at zero, credits 1130 by the
  remaining receivable (not the original total), and a stale
  full-fee amount fails closed with DELIVERY_SETTLEMENT_INVALID
  instead of debiting the full fee a second time.

CLOSED BY R7-A (INV-REST-RETURN-PAYOUT-TRUTH): the F1/F2 limits
above are now pinned in backend/test/critical/returns-payout-truth.spec.ts —
returns.service allocates total + reliefs (shared
computeSalesReturnRelief), so the treasury / store-credit /
customer-ledger writers move the full refund; the delivery-reps
callers settle the remaining receivable minus the remaining fee;
and F9 below now asserts the settlement credits 1130 by the
remaining receivable (77), not the original total (142).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { resolveSaleServiceCharge } from '../../src/modules/sales/engines/sale-service-charge.engine';
import { recomputeSalesOrderMoney, assertSalesOrderMoney } from '../../src/modules/sales/helpers/sales-order-money.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'onRef', 'on']) {
    builder[key] = (...args: any[]) => {
      if ((key === 'leftJoin' || key === 'innerJoin') && typeof args[1] === 'function') args[1](builder);
      return builder;
    };
  }
  Object.assign(builder, terminal);
  return builder;
}

function buildCreateSaleService(settingsRows: any[], captured: Array<{ table: string; row: any }>) {
  const trx: any = {
    executeQuery: async () => ({ rows: [] }),
    getExecutor: () => ({
      compileQuery: (node: any) => ({ sql: '', parameters: [], query: node }),
      transformQuery: (query: any) => query,
      executeQuery: async () => ({ rows: [] }),
    }),
    selectFrom: (table: string) => {
      if (table === 'accounting_settings') {
        return chainable({ executeTakeFirst: async () => ({ lock_date_all: null, lock_date_non_adviser: null, lock_date_tax: null }) });
      }
      if (table === 'accounting_fiscal_periods') {
        return chainable({ executeTakeFirst: async () => null });
      }
      if (table === 'settings') {
        return chainable({
          executeTakeFirst: async () => ({ value: '"EGP"' }),
          execute: async () => settingsRows,
        });
      }
      if (table === 'currency_exchange_rates') {
        return chainable({ execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
      }
      if (table === 'customers') {
        return chainable({
          executeTakeFirst: async () => ({
            id: 21, name: 'Customer', balance: 0, credit_limit: 0,
            store_credit_balance: 0, loyalty_points: 0,
            is_credit_blocked: false, credit_block_reason: null,
          }),
        });
      }
      if (table === 'products as p') {
        return chainable({
          execute: async () => [{
            id: 1, name: 'Widget', name_en: null, stock_qty: 100, reserved_qty: 0,
            retail_price: 100, wholesale_price: 90, cost_price: 60,
            min_selling_price: 0, item_type: 'product', bom_id: null,
          }],
        });
      }
      if (table === 'product_offers') {
        return chainable({ execute: async () => [] });
      }
      if (table === 'product_pos_modifiers') {
        // R5-A: the R4-C modifier-contract gate queries the product's
        // linked modifier groups even when the line carries no
        // modifiers. The fixture product has none, so this is empty.
        return chainable({ execute: async () => [] });
      }
      if (table === 'restaurant_86_items') {
        // R6-E: R5-B's 86 gate (migration 0310) queries this table
        // at line validation, before totals; the fixture product is
        // not 86'd, so this is empty. Without it every Part D case
        // dies in the mock instead of reaching the sales insert —
        // the spec was already red at base 4388c207 for exactly
        // this gap (proven by a stashed base run).
        return chainable({ execute: async () => [] });
      }
      if (table === 'branches') {
        return chainable({
          executeTakeFirst: async () => ({
            id: 1, name: 'Main', default_stock_location_id: 10,
            sales_stock_mode: null, allow_external_sales_stock: false,
          }),
        });
      }
      if (table === 'stock_locations') {
        return chainable({
          executeTakeFirst: async () => ({
            id: 10, name: 'Main', is_active: true, location_type: 'branch_stock', branch_id: 1,
          }),
          execute: async () => [],
        });
      }
      if (table === 'product_location_stock') {
        return chainable({ execute: async () => [{ product_id: 1, location_id: 10, branch_id: 1, qty: 100, reserved_qty: 0 }] });
      }
      throw new Error(`unexpected (query|write) ${table}: the service-charge gate must run before it`);
    },
    insertInto: (table: string) => ({
      values: (row: any) => {
        captured.push({ table, row });
        if (table === 'sales') throw new Error('SALE_INSERT_REACHED');
        return chainable({
          returningAll: () => chainable({ executeTakeFirstOrThrow: async () => ({ id: 999 }), execute: async () => [] }),
          execute: async () => [],
          executeTakeFirstOrThrow: async () => ({ id: 999 }),
        });
      },
    }),
    updateTable: () => { throw new Error('unexpected write: the service-charge gate must run before it'); },
    deleteFrom: () => { throw new Error('unexpected write: the service-charge gate must run before it'); },
  };
  const service = Object.create(SalesWriteService.prototype);
  service.db = {};
  service.tx = { runInTransaction: async (_db: any, cb: any) => cb(trx) };
  service.lockSaleStockRows = async () => {};
  // R5-A: the base mock predates the R4-C modifier-contract gate
  // (createSale calls this.planFeatureService.hasFeature before any
  // totals work); without it every Part D case dies with a TypeError
  // instead of reaching the sales insert. The fixture items carry no
  // modifiers, so the contract is out of scope here — disabled keeps
  // the gate a no-op and the Part D/E flow identical to R4-A.
  service.planFeatureService = { hasFeature: async () => false };
  service.authz = { hasOpenCashierShift: async () => true, hasOpenCashierShiftForSale: async () => true };
  return service;
}

function createSalePayload(tenantId: string, opts: { orderType?: string; source?: string; serviceCharge?: number; expectedTotal?: number }): { payload: any; auth: any } {
  const payload: any = {
    customerId: 21,
    branchId: 1,
    paymentType: 'cash',
    items: [{ productId: 1, qty: 1, unitPrice: 100 }],
    pricesIncludeTax: false,
    taxRate: 0,
    source: opts.source ?? 'pos',
    orderType: opts.orderType ?? 'takeaway',
    // R5-A: the base mock predates the dine-in table gate
    // (pos-submit-gates DINE_IN_TABLE_REQUIRED); a dine-in fixture
    // without a table now dies before the totals work.
    ...(opts.orderType === 'dine_in' ? { tableNumber: 'T1' } : {}),
    serviceCharge: opts.serviceCharge ?? 0,
    payments: [{ paymentChannel: 'cash', amount: 500 }],
  };
  if (opts.expectedTotal !== undefined) payload.expectedTotal = opts.expectedTotal;
  const auth: any = { userId: 1, tenantId, accountId: 'a1', role: 'admin', permissions: [], sessionId: 'x', username: 't' };
  return { payload, auth };
}

function serviceChargeSettings(enabled: unknown, percent: unknown) {
  return [
    { key: 'currency', value: '"EGP"' },
    { key: 'taxRate', value: '15' },
    { key: 'restaurantServiceChargeEnabled', value: JSON.stringify(enabled) },
    { key: 'restaurantServiceChargePercent', value: JSON.stringify(percent) },
  ];
}

async function main() {
  // Part A: the pure service-charge engine.
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'dashboard', enabled: true, percent: 12, netBase: 100, digits: 2 }), null);
  assert.equal(resolveSaleServiceCharge({ orderType: 'takeaway', source: 'pos', enabled: true, percent: 12, netBase: 100, digits: 2 }), 0);
  assert.equal(resolveSaleServiceCharge({ orderType: 'delivery', source: 'pos', enabled: true, percent: 12, netBase: 100, digits: 2 }), 0);
  assert.equal(resolveSaleServiceCharge({ orderType: null, source: 'pos', enabled: true, percent: 12, netBase: 100, digits: 2 }), 0);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: 12, netBase: 100, digits: 2 }), 12);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: 10, netBase: 88, digits: 2 }), 8.8);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: false, percent: 12, netBase: 100, digits: 2 }), 0);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: 'false', percent: 12, netBase: 100, digits: 2 }), 0);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: 'true', percent: 12, netBase: 100, digits: 2 }), 12);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: undefined, netBase: 100, digits: 2 }), 12);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: '12', netBase: 100, digits: 2 }), 12);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: 12, netBase: -50, digits: 2 }), 0);
  assert.equal(resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: 12.5, netBase: 100, digits: 3 }), 12.5);
  assert.throws(
    () => resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: 'abc', netBase: 100, digits: 2 }),
    /TABLE_BILL_RATE_INVALID/,
  );
  assert.throws(
    () => resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: 150, netBase: 100, digits: 2 }),
    /TABLE_BILL_RATE_INVALID/,
  );
  assert.throws(
    () => resolveSaleServiceCharge({ orderType: 'dine_in', source: 'pos', enabled: true, percent: -5, netBase: 100, digits: 2 }),
    /TABLE_BILL_RATE_INVALID/,
  );

  // Part B: the pure order-money helper.
  const orderLines = [
    { quantity: 2, unitPrice: 50, discount: 5, total: 95 },
    { quantity: 1, unitPrice: 30, discount: 5, total: 25 },
  ];
  const recomputed = recomputeSalesOrderMoney(orderLines, 10, 16.8);
  assert.deepEqual(recomputed.lineTotals, [95, 25]);
  assert.equal(recomputed.subtotal, 130);
  assert.equal(recomputed.total, 136.8);
  // The whole client DTO reconciles.
  assertSalesOrderMoney(recomputed, { lineTotals: [95, 25], subtotal: 130, total: 136.8 });
  // A doctored per-line total fails.
  assert.throws(
    () => assertSalesOrderMoney(recomputed, { lineTotals: [94, 25], subtotal: 130, total: 136.8 }),
    (err: any) => err.code === 'SALES_ORDER_LINE_MISMATCH',
  );
  // A net subtotal (sum of line totals) is not the gross subtotal.
  assert.throws(
    () => assertSalesOrderMoney(recomputed, { lineTotals: [95, 25], subtotal: 120, total: 136.8 }),
    (err: any) => err.code === 'SALES_ORDER_TOTAL_MISMATCH',
  );
  // A doctored stored total fails — the convert-shape assertion.
  assert.throws(
    () => assertSalesOrderMoney(recomputed, { total: 999 }),
    (err: any) => err.code === 'SALES_ORDER_TOTAL_MISMATCH',
  );
  // A line discount above its gross is nonsense, not a zero line.
  assert.throws(
    () => recomputeSalesOrderMoney([{ quantity: 1, unitPrice: 100, discount: 150, total: 0 }], 150, 0),
    (err: any) => err.code === 'SALES_ORDER_LINE_MISMATCH',
  );
  // Negative header discount / tax fail closed.
  assert.throws(
    () => recomputeSalesOrderMoney(orderLines, -1, 0),
    (err: any) => err.code === 'SALES_ORDER_TOTAL_MISMATCH',
  );
  assert.throws(
    () => recomputeSalesOrderMoney(orderLines, 10, -1),
    (err: any) => err.code === 'SALES_ORDER_TOTAL_MISMATCH',
  );

  // Part C: the real postSale / postSaleEdit / settlement over PGlite.
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const inTx = <T>(fn: (trx: any) => Promise<T>): Promise<T> => db.transaction().execute(fn);
  try {
    await pg.exec(`
      CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT '', account_group text DEFAULT '',
        normal_balance text DEFAULT '', is_active boolean DEFAULT true, is_system boolean DEFAULT false,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false,
        is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false,
        is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false,
        created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(),
        CONSTRAINT uq_acct_tenant_code UNIQUE (tenant_id, code));
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint,
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
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
      CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE products (id bigint PRIMARY KEY,tenant_id text,account_id text,name text,
        stock_qty numeric DEFAULT 0,reserved_qty numeric DEFAULT 0,cost_price numeric DEFAULT 0,updated_at timestamptz,
        item_type text);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY,tenant_id text,account_id text,product_id bigint,
        branch_id bigint,location_id bigint,qty numeric DEFAULT 0,reserved_qty numeric DEFAULT 0,updated_at timestamptz);
      CREATE TABLE customers (id bigint,tenant_id text,balance numeric DEFAULT 0);
      CREATE TABLE suppliers (id bigint,tenant_id text,balance numeric DEFAULT 0,updated_at timestamptz);
      INSERT INTO customers VALUES (25,'t1',0);
      INSERT INTO suppliers VALUES (9,'t1',0,NULL);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint,
        subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, total numeric,
        paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, exchange_return_id bigint,
        branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
        delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0,
        tip_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, sale_origin text,
        payment_type text DEFAULT 'cash', collection_status text, status text DEFAULT 'posted');
      CREATE TABLE sale_payments (tenant_id text, sale_id bigint, payment_channel text, amount numeric);
      CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, qty numeric, cost_price numeric, unit_multiplier numeric, modifiers jsonb);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-01', exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3));
      CREATE TABLE return_items (id bigint PRIMARY KEY, return_document_id bigint, tenant_id text, product_id bigint, sale_item_id bigint, qty numeric, unit_total numeric, line_total numeric, cost_price numeric, allocated_tax numeric);
      CREATE TABLE accounting_cheques (id bigint PRIMARY KEY, tenant_id text, type text, status text, journal_entry_id bigint);
      INSERT INTO accounting_settings VALUES
        (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    `);
    // 4200 is seeded (the COA migration seeds it in production);
    // 2115/2147 are deliberately NOT seeded: they must auto-create
    // on first post via resolveSystemAccountByCode.
    for (const code of [1110, 1120, 1130, 1140, 2120, 4100, 4200, 4300, 4400, 5100, 2150]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,account_id,code) VALUES ($1,$2,$3,$4)',
        [code, 't1', 'a1', String(code)]);
    }
    const amount = async (id: number, code: number, side: 'debit' | 'credit') => {
      const rows = await pg.query<{ amount: string }>(`SELECT coalesce(sum(${side}),0) AS amount FROM journal_entry_lines WHERE journal_entry_id=$1 AND account_id=$2`, [id, code]);
      return Number(rows.rows[0].amount);
    };
    const accountIdByCode = async (code: string) => {
      const row = await db.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', 't1').where('code', '=', code).executeTakeFirst();
      return row ? Number((row as any).id) : 0;
    };

    // C1: exclusive freelance sale — the split, and the sum of the
    // new credits equals the old single revenueCredit (142).
    await pg.exec(`
      INSERT INTO sales(id,tenant_id,doc_no,subtotal,discount,tax_amount,total,paid_amount,delivery_fee,delivery_fee_mode,service_charge,tip_amount)
        VALUES (10,'t1','S10',100,0,0,142,142,20,'freelance_courier',12,10);
      INSERT INTO sale_payments VALUES ('t1',10,'cash',142);
      INSERT INTO sale_items VALUES (10,'t1',10,10,1,30);
    `);
    const sale10 = await inTx(trx => posting.postSale(trx, 10, auth));
    assert.equal(sale10.posted, true);
    assert.equal(await amount(sale10.journalEntryId, 1110, 'debit'), 142);
    assert.equal(await amount(sale10.journalEntryId, 4100, 'credit'), 100);
    assert.equal(await amount(sale10.journalEntryId, 4200, 'credit'), 12);
    const courierId = await accountIdByCode('2115');
    assert.ok(courierId > 0, '2115 Courier Fees Payable must auto-create on first post');
    const tipsId = await accountIdByCode('2147');
    assert.ok(tipsId > 0, '2147 Tips Payable must auto-create on first post');
    assert.equal(await amount(sale10.journalEntryId, courierId, 'credit'), 20);
    assert.equal(await amount(sale10.journalEntryId, tipsId, 'credit'), 10);
    assert.equal(
      (await amount(sale10.journalEntryId, 4100, 'credit'))
      + (await amount(sale10.journalEntryId, 4200, 'credit'))
      + (await amount(sale10.journalEntryId, courierId, 'credit'))
      + (await amount(sale10.journalEntryId, tipsId, 'credit')),
      142,
      'the split credits must sum exactly to the old single revenueCredit',
    );
    assert.equal(await amount(sale10.journalEntryId, 5100, 'debit'), 30);
    const courierRow = await db.selectFrom('accounting_accounts').select(['account_type', 'account_group', 'normal_balance']).where('tenant_id', '=', 't1').where('code', '=', '2115').executeTakeFirstOrThrow();
    assert.equal(String((courierRow as any).account_type), 'liability');
    assert.equal(String((courierRow as any).normal_balance), 'credit');
    const tipsRow = await db.selectFrom('accounting_accounts').select(['account_type', 'account_group', 'normal_balance']).where('tenant_id', '=', 't1').where('code', '=', '2147').executeTakeFirstOrThrow();
    assert.equal(String((tipsRow as any).account_type), 'liability');
    assert.equal(String((tipsRow as any).account_group), 'current_liabilities');
    assert.equal(String((tipsRow as any).normal_balance), 'credit');

    // C2: exclusive store-fleet sale — the delivery fee joins 4200
    // as revenue; no 2115 leg exists.
    await pg.exec(`
      INSERT INTO sales(id,tenant_id,doc_no,subtotal,discount,tax_amount,total,paid_amount,delivery_fee,delivery_fee_mode,service_charge,tip_amount)
        VALUES (11,'t1','S11',100,0,0,132,132,20,'store_fleet',12,0);
      INSERT INTO sale_payments VALUES ('t1',11,'cash',132);
      INSERT INTO sale_items VALUES (11,'t1',11,10,1,30);
    `);
    const sale11 = await inTx(trx => posting.postSale(trx, 11, auth));
    assert.equal(await amount(sale11.journalEntryId, 4100, 'credit'), 100);
    assert.equal(await amount(sale11.journalEntryId, 4200, 'credit'), 32);
    assert.equal(await amount(sale11.journalEntryId, courierId, 'credit'), 0);
    assert.equal(await amount(sale11.journalEntryId, tipsId, 'credit'), 0);

    // C3: tax-inclusive sale WITH a discount — the tax embedded in
    // the goods + service base is stripped pro-rata (residual to
    // 4100) and the journal still balances exactly. The discount
    // is NOT netted into the base: it is carried by the separate
    // Dr 4300 leg, so netting it would double-count it.
    await pg.exec(`
      INSERT INTO sales(id,tenant_id,doc_no,subtotal,discount,tax_amount,total,paid_amount,service_charge,tip_amount,prices_include_tax)
        VALUES (12,'t1','S12',100,10,13.30,102,102,12,0,true);
      INSERT INTO sale_payments VALUES ('t1',12,'cash',102);
      INSERT INTO sale_items VALUES (12,'t1',12,10,1,30);
    `);
    const sale12 = await inTx(trx => posting.postSale(trx, 12, auth));
    assert.equal(await amount(sale12.journalEntryId, 1110, 'debit'), 102);
    assert.equal(await amount(sale12.journalEntryId, 4300, 'debit'), 10);
    assert.equal(await amount(sale12.journalEntryId, 4100, 'credit'), 88.12);
    assert.equal(await amount(sale12.journalEntryId, 4200, 'credit'), 10.58);
    assert.equal(await amount(sale12.journalEntryId, 2120, 'credit'), 13.3);

    // C4: postSaleEdit inherits the split (same legs, new amounts).
    await pg.exec(`
      INSERT INTO sales(id,tenant_id,doc_no,subtotal,discount,tax_amount,total,paid_amount,delivery_fee,delivery_fee_mode,service_charge,tip_amount)
        VALUES (13,'t1','S13',100,0,0,142,142,20,'freelance_courier',12,10);
      INSERT INTO sale_payments VALUES ('t1',13,'cash',142);
      INSERT INTO sale_items VALUES (13,'t1',13,10,1,30);
    `);
    const sale13 = await inTx(trx => posting.postSale(trx, 13, auth));
    assert.equal(sale13.posted, true);
    await pg.exec(`
      UPDATE sales SET subtotal=200, tax_amount=0, total=284, paid_amount=284, delivery_fee=40, service_charge=24, tip_amount=20 WHERE id=13;
      UPDATE sale_payments SET amount=284 WHERE sale_id=13;
      UPDATE sale_items SET qty=2 WHERE sale_id=13;
    `);
    const edit13 = await inTx(trx => posting.postSaleEdit(trx, 13, auth));
    assert.equal(edit13.posted, true);
    const orig13 = await db.selectFrom('journal_entries').select(['id', 'reversed_by_entry_id']).where('id', '=', Number(sale13.journalEntryId)).executeTakeFirstOrThrow();
    assert.ok(orig13.reversed_by_entry_id != null, 'original journal must be marked reversed');
    assert.equal(await amount(edit13.journalEntryId, 1110, 'debit'), 284);
    assert.equal(await amount(edit13.journalEntryId, 4100, 'credit'), 200);
    assert.equal(await amount(edit13.journalEntryId, 4200, 'credit'), 24);
    assert.equal(await amount(edit13.journalEntryId, courierId, 'credit'), 40);
    assert.equal(await amount(edit13.journalEntryId, tipsId, 'credit'), 20);

    // C5: a freelance settlement relieves the payable (Dr 2115),
    // not the 6400 expense — the fee must not hit P&L twice.
    await pg.exec(`
      INSERT INTO sales(id,tenant_id,doc_no,customer_id,subtotal,discount,tax_amount,total,paid_amount,delivery_fee,delivery_fee_mode,service_charge,tip_amount)
        VALUES (14,'t1','S14',25,100,0,0,120,0,20,'freelance_courier',0,0);
    `);
    const settlement = await inTx(trx => posting.postDeliveryRepSettlement(trx, 14, 100, null, null, auth));
    assert.equal(settlement.posted, true);
    assert.equal(await amount(settlement.journalEntryId!, courierId, 'debit'), 20);
    assert.equal(await amount(settlement.journalEntryId!, 1110, 'debit'), 100);
    assert.equal(await amount(settlement.journalEntryId!, 1130, 'credit'), 120);

    // Part F (R6-E): postSalesReturn relieves 2147/2115.
    // Cost is 0 on every line here on purpose: the COGS mirror
    // is pinned by its own spec, and a zero saved cost keeps the
    // reversal at 0 so these cases prove the relief legs alone.
    const journalBySource = async (sourceType: string, sourceId: number) => {
      const entries = await (db as any).selectFrom('journal_entries').select('id')
        .where('source_type', '=', sourceType).where('source_id', '=', sourceId).execute() as Array<{ id: number }>;
      assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
      const rows = await pg.query<{ code: string; debit: string; credit: string }>(
        `SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1`,
        [Number(entries[0].id)]);
      const byCode = new Map<string, { debit: number; credit: number }>();
      for (const row of rows.rows) byCode.set(row.code, { debit: Number(row.debit), credit: Number(row.credit) });
      return byCode;
    };
    const seedReturnSale = async (saleId: number, opts: { subtotal: number; discount?: number; tax?: number; total: number; tip?: number; fee?: number; mode?: string | null; service?: number; inclusive?: boolean; paid?: number; customer?: number | null }) => {
      await pg.exec(`
        INSERT INTO sales(id,tenant_id,doc_no,customer_id,subtotal,discount,tax_amount,total,paid_amount,delivery_fee,delivery_fee_mode,service_charge,tip_amount,prices_include_tax)
          VALUES (${saleId},'t1','S${saleId}',${opts.customer ?? 'NULL'},${opts.subtotal},${opts.discount ?? 0},${opts.tax ?? 0},${opts.total},${opts.paid ?? opts.total},${opts.fee ?? 0},${opts.mode ? `'${opts.mode}'` : 'NULL'},${opts.service ?? 0},${opts.tip ?? 0},${opts.inclusive ? 'true' : 'false'});
        INSERT INTO sale_items VALUES (${saleId * 10},'t1',${saleId},10,2,0,1,'[]');
      `);
    };
    const seedReturn = async (returnId: number, saleId: number, total: number, allocatedTax: number, allocations?: string) => {
      await pg.exec(`
        INSERT INTO return_documents(id,tenant_id,doc_no,return_type,invoice_id,settlement_mode,refund_method,refund_allocations,total)
          VALUES (${returnId},'t1','ZR${returnId}','sale',${saleId},'','cash',${allocations ? `'${allocations}'::jsonb` : 'NULL'},${total});
        INSERT INTO return_items(id,return_document_id,tenant_id,product_id,sale_item_id,qty,cost_price,allocated_tax)
          VALUES (${returnId * 10},${returnId},'t1',10,${saleId * 10},1,0,${allocatedTax});
      `);
    };
    const tippedFreelance = { subtotal: 100, total: 142, tip: 10, fee: 20, mode: 'freelance_courier', service: 12 };

    // F1: partial return of a tipped freelance sale relieves both
    // pro-rata — half the goods (50/100) -> half the tip (5) and
    // half the courier fee (10); the refund is 50 + 15 = 65.
    await seedReturnSale(20, tippedFreelance);
    await seedReturn(1, 20, 50, 0);
    const ret1 = await inTx(trx => posting.postSalesReturn(trx, 1, auth));
    assert.equal(ret1.posted, true);
    const f1 = await journalBySource('sales_return', 1);
    assert.equal(f1.get('4400')?.debit, 50);
    assert.equal(f1.get('2147')?.debit, 5);
    assert.equal(f1.get('2115')?.debit, 10);
    assert.equal(f1.get('1110')?.credit, 65);

    // F2: partial return of a freelance sale with no tip relieves
    // only 2115 (10); no 2147 line exists.
    await seedReturnSale(21, { subtotal: 100, total: 132, fee: 20, mode: 'freelance_courier', service: 12 });
    await seedReturn(2, 21, 50, 0);
    await inTx(trx => posting.postSalesReturn(trx, 2, auth));
    const f2 = await journalBySource('sales_return', 2);
    assert.equal(f2.get('2115')?.debit, 10);
    assert.equal(f2.get('2147'), undefined);
    assert.equal(f2.get('1110')?.credit, 60);

    // F3: full return relieves both fully (10 + 20); refund 130.
    await seedReturnSale(22, tippedFreelance);
    await seedReturn(3, 22, 100, 0);
    await inTx(trx => posting.postSalesReturn(trx, 3, auth));
    const f3 = await journalBySource('sales_return', 3);
    assert.equal(f3.get('4400')?.debit, 100);
    assert.equal(f3.get('2147')?.debit, 10);
    assert.equal(f3.get('2115')?.debit, 20);
    assert.equal(f3.get('1110')?.credit, 130);

    // F4: store-fleet return relieves the tip only (5) — the fee
    // went to Cr 4200 revenue, so no 2115 leg exists, and a return
    // does not relieve 4200 either (no 4200 line in the journal).
    await seedReturnSale(23, { subtotal: 100, total: 132, tip: 10, fee: 20, mode: 'store_fleet', service: 12 });
    await seedReturn(4, 23, 50, 0);
    await inTx(trx => posting.postSalesReturn(trx, 4, auth));
    const f4 = await journalBySource('sales_return', 4);
    assert.equal(f4.get('2147')?.debit, 5);
    assert.equal(f4.get('2115'), undefined);
    assert.equal(f4.get('4200'), undefined);
    assert.equal(f4.get('1110')?.credit, 55);

    // F5: cumulative cap — two 60% returns of the same sale. The
    // first relieves 6 + 12 (refund 78); the second is capped at
    // the remainder (4 + 8, refund 72), not a second 6 + 12: two
    // 60% returns must not relieve 120%.
    await seedReturnSale(24, tippedFreelance);
    await seedReturn(5, 24, 60, 0);
    await inTx(trx => posting.postSalesReturn(trx, 5, auth));
    const f5a = await journalBySource('sales_return', 5);
    assert.equal(f5a.get('2147')?.debit, 6);
    assert.equal(f5a.get('2115')?.debit, 12);
    assert.equal(f5a.get('1110')?.credit, 78);
    await seedReturn(6, 24, 60, 0);
    await inTx(trx => posting.postSalesReturn(trx, 6, auth));
    const f5b = await journalBySource('sales_return', 6);
    assert.equal(f5b.get('2147')?.debit, 4);
    assert.equal(f5b.get('2115')?.debit, 8);
    assert.equal(f5b.get('1110')?.credit, 72);

    // F6: a return of a sale with no tip/fee posts no 2147/2115
    // lines at all; the refund is exactly the return total.
    await seedReturnSale(25, { subtotal: 100, total: 100 });
    await seedReturn(7, 25, 40, 0);
    await inTx(trx => posting.postSalesReturn(trx, 7, auth));
    const f6 = await journalBySource('sales_return', 7);
    assert.equal(f6.get('2147'), undefined);
    assert.equal(f6.get('2115'), undefined);
    assert.equal(f6.get('4400')?.debit, 40);
    assert.equal(f6.get('1110')?.credit, 40);

    // F7: tax-inclusive sale — the relief ratio uses the ex-tax
    // goods leg postSale stripped (subtotal 100 + service 12 -
    // tax 13.30 = 98.70, service share ~10.58, discount 10 ->
    // base ~78.12), NOT the exclusive subtotal - discount (90).
    // Half the goods back: net return 39.06 (45 - 5.94 tax) ->
    // ratio 0.5 -> tip relief 5, refund 50. (The exclusive
    // formula would have relieved only 39.06/90 of the tip.)
    await seedReturnSale(26, { subtotal: 100, discount: 10, tax: 13.30, total: 102, tip: 10, service: 12, inclusive: true });
    await seedReturn(8, 26, 45, 5.94);
    await inTx(trx => posting.postSalesReturn(trx, 8, auth));
    const f7 = await journalBySource('sales_return', 8);
    assert.equal(f7.get('4400')?.debit, 39.06);
    assert.equal(f7.get('2120')?.debit, 5.94);
    assert.equal(f7.get('2147')?.debit, 5);
    assert.equal(f7.get('2115'), undefined);
    assert.equal(f7.get('1110')?.credit, 50);

    // F8: stored allocations summing to the return total (50) are
    // topped up in-memory on the last tender — the cash credit is
    // 65, not 50. F8b: a stored set already summing to total +
    // reliefs (65) is used as-is, never double-topped (still 65).
    await seedReturnSale(27, tippedFreelance);
    await seedReturn(9, 27, 50, 0, '[{"tender":"cash","amount":50}]');
    await inTx(trx => posting.postSalesReturn(trx, 9, auth));
    const f8 = await journalBySource('sales_return', 9);
    assert.equal(f8.get('1110')?.credit, 65);
    await seedReturnSale(28, tippedFreelance);
    await seedReturn(10, 28, 50, 0, '[{"tender":"cash","amount":65}]');
    await inTx(trx => posting.postSalesReturn(trx, 10, auth));
    const f8b = await journalBySource('sales_return', 10);
    assert.equal(f8b.get('1110')?.credit, 65);

    // F9 (R7-A F2): return then settle does not double-relieve AND
    // does not over-credit 1130. The COD sale (paid 0, customer
    // 25) is returned for half the goods; the return's receivable
    // leg (65) already credited 1130, so the remaining receivable
    // is 77 and the remaining fee is 10. Settling the REDUCED
    // amount (77 - 10 = 67) posts the reduced fee (10), collects
    // 67 cash, credits 1130 by 77 (not the original 142), and
    // lands both 2115 and 1130 at zero. Both stale amounts fail
    // closed: 122 (total - original fee) and 132 (total -
    // remaining fee) throw DELIVERY_SETTLEMENT_INVALID.
    await seedReturnSale(29, { ...tippedFreelance, paid: 0, customer: 25 });
    await seedReturn(11, 29, 50, 0, '[{"tender":"receivable","amount":65}]');
    await inTx(trx => posting.postSalesReturn(trx, 11, auth));
    const settle29 = await inTx(trx => posting.postDeliveryRepSettlement(trx, 29, 67, null, null, auth));
    assert.equal(settle29.posted, true);
    const f9 = await journalBySource('delivery_rep_settlement', 29);
    assert.equal(f9.get('2115')?.debit, 10);
    assert.equal(f9.get('1110')?.debit, 67);
    assert.equal(f9.get('1130')?.credit, 77);
    await seedReturnSale(30, { ...tippedFreelance, paid: 0, customer: 25 });
    await seedReturn(12, 30, 50, 0, '[{"tender":"receivable","amount":65}]');
    await inTx(trx => posting.postSalesReturn(trx, 12, auth));
    await assert.rejects(
      inTx(trx => posting.postDeliveryRepSettlement(trx, 30, 122, null, null, auth)),
      (err: any) => err.code === 'DELIVERY_SETTLEMENT_INVALID',
    );
    await assert.rejects(
      inTx(trx => posting.postDeliveryRepSettlement(trx, 30, 132, null, null, auth)),
      (err: any) => err.code === 'DELIVERY_SETTLEMENT_INVALID',
    );

    // Every saved journal balances exactly.
    const unbalanced = await pg.query(`SELECT journal_entry_id FROM journal_entry_lines GROUP BY journal_entry_id HAVING sum(debit) <> sum(credit)`);
    assert.deepEqual(unbalanced.rows, [], 'every saved journal balances exactly');
  } finally { await db.destroy(); }

  // Part D: the real createSale through the mock DB.
  {
    // D1: takeaway carrying serviceCharge 99 posts 0.
    const captured1: Array<{ table: string; row: any }> = [];
    const service1 = buildCreateSaleService(serviceChargeSettings(true, 12), captured1);
    const { payload: payload1, auth: auth1 } = createSalePayload('t-sc-takeaway', { orderType: 'takeaway', serviceCharge: 99 });
    await assert.rejects(async () => service1.createSale(payload1, auth1), /SALE_INSERT_REACHED/);
    const saleRow1 = captured1.find((entry) => entry.table === 'sales')?.row;
    assert.ok(saleRow1, 'takeaway sale must reach the sales insert');
    assert.equal(Number(saleRow1.service_charge), 0);
    assert.equal(Number(saleRow1.total), 100);

    // D2: dine-in with an invented charge is recomputed to 12.
    const captured2: Array<{ table: string; row: any }> = [];
    const service2 = buildCreateSaleService(serviceChargeSettings(true, 12), captured2);
    const { payload: payload2, auth: auth2 } = createSalePayload('t-sc-dinein', { orderType: 'dine_in', serviceCharge: 99 });
    await assert.rejects(async () => service2.createSale(payload2, auth2), /SALE_INSERT_REACHED/);
    const saleRow2 = captured2.find((entry) => entry.table === 'sales')?.row;
    assert.ok(saleRow2, 'dine-in sale must reach the sales insert');
    assert.equal(Number(saleRow2.service_charge), 12);
    assert.equal(Number(saleRow2.total), 112);

    // D3: an honest dine-in charge recomputes to the same number.
    const captured3: Array<{ table: string; row: any }> = [];
    const service3 = buildCreateSaleService(serviceChargeSettings(true, 12), captured3);
    const { payload: payload3, auth: auth3 } = createSalePayload('t-sc-honest', { orderType: 'dine_in', serviceCharge: 12 });
    await assert.rejects(async () => service3.createSale(payload3, auth3), /SALE_INSERT_REACHED/);
    const saleRow3 = captured3.find((entry) => entry.table === 'sales')?.row;
    assert.ok(saleRow3);
    assert.equal(Number(saleRow3.service_charge), 12);
    assert.equal(Number(saleRow3.total), 112);

    // D4: a non-POS dine-in payload keeps the charge it sent.
    const captured4: Array<{ table: string; row: any }> = [];
    const service4 = buildCreateSaleService(serviceChargeSettings(true, 12), captured4);
    const { payload: payload4, auth: auth4 } = createSalePayload('t-sc-dash', { orderType: 'dine_in', source: 'dashboard', serviceCharge: 99 });
    await assert.rejects(async () => service4.createSale(payload4, auth4), /SALE_INSERT_REACHED/);
    const saleRow4 = captured4.find((entry) => entry.table === 'sales')?.row;
    assert.ok(saleRow4);
    assert.equal(Number(saleRow4.service_charge), 99);
    assert.equal(Number(saleRow4.total), 199);

    // D5: a disabled tenant posts 0.
    const captured5: Array<{ table: string; row: any }> = [];
    const service5 = buildCreateSaleService(serviceChargeSettings(false, 12), captured5);
    const { payload: payload5, auth: auth5 } = createSalePayload('t-sc-disabled', { orderType: 'dine_in', serviceCharge: 99 });
    await assert.rejects(async () => service5.createSale(payload5, auth5), /SALE_INSERT_REACHED/);
    const saleRow5 = captured5.find((entry) => entry.table === 'sales')?.row;
    assert.ok(saleRow5);
    assert.equal(Number(saleRow5.service_charge), 0);
    assert.equal(Number(saleRow5.total), 100);

    // D6: a garbled percent fails closed before any write.
    const captured6: Array<{ table: string; row: any }> = [];
    const service6 = buildCreateSaleService(serviceChargeSettings(true, 'abc'), captured6);
    const { payload: payload6, auth: auth6 } = createSalePayload('t-sc-garbled', { orderType: 'dine_in', serviceCharge: 99 });
    await assert.rejects(async () => service6.createSale(payload6, auth6), /TABLE_BILL_RATE_INVALID/);
    assert.equal(captured6.length, 0, 'a garbled percent must throw before any write');

    // Part E (R5-A, INV-REST-TOTALS-TRUTH-2, R-I53): the client sends
    // the total it displayed as expectedTotal; the server cross-checks
    // it against its own recomputed total and rejects a drift bigger
    // than one minor unit with 422 SALE_TOTAL_MISMATCH — never posts
    // a different total silently. The takeaway fixture below posts a
    // server total of exactly 100 (1 x 100, no tax, no charge).
    // E1: a doctored expectedTotal is rejected before any write.
    const captured7: Array<{ table: string; row: any }> = [];
    const service7 = buildCreateSaleService(serviceChargeSettings(true, 12), captured7);
    const { payload: payload7, auth: auth7 } = createSalePayload('t-et-doctored', { orderType: 'takeaway', expectedTotal: 101 });
    await assert.rejects(
      async () => service7.createSale(payload7, auth7),
      (err: any) => err.code === 'SALE_TOTAL_MISMATCH',
    );
    assert.equal(captured7.length, 0, 'a mismatched expectedTotal must throw before any write');
    // E2: the honest expectedTotal posts exactly the recomputed total.
    const captured8: Array<{ table: string; row: any }> = [];
    const service8 = buildCreateSaleService(serviceChargeSettings(true, 12), captured8);
    const { payload: payload8, auth: auth8 } = createSalePayload('t-et-honest', { orderType: 'takeaway', expectedTotal: 100 });
    await assert.rejects(async () => service8.createSale(payload8, auth8), /SALE_INSERT_REACHED/);
    const saleRow8 = captured8.find((entry) => entry.table === 'sales')?.row;
    assert.ok(saleRow8, 'an honest expectedTotal must reach the sales insert');
    assert.equal(Number(saleRow8.total), 100);
    // E3: callers that never send expectedTotal (dashboard, order
    // conversions, offline sync) skip the check entirely.
    const captured9: Array<{ table: string; row: any }> = [];
    const service9 = buildCreateSaleService(serviceChargeSettings(true, 12), captured9);
    const { payload: payload9, auth: auth9 } = createSalePayload('t-et-absent', { orderType: 'takeaway' });
    await assert.rejects(async () => service9.createSale(payload9, auth9), /SALE_INSERT_REACHED/);
    assert.ok(captured9.find((entry) => entry.table === 'sales'), 'an absent expectedTotal must not block the sale');
  }

  console.log('Sale money truth tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
