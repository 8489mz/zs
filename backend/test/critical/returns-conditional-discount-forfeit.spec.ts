import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { computeConditionalDiscountForfeit } from '../../src/modules/returns/engines/conditional-header-discount-return.engine';

/*
New file: backend/test/critical/returns-conditional-discount-forfeit.spec.ts
Pins INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: a header (invoice)
discount may be conditional on the deal quantity or general — the
system cannot know which, so the return dialog shows BOTH refund
modes side by side and the merchant picks per return; the chosen
mode is stored on the return document (header_discount_mode).

THE CLIENT'S RULE (offline clothes shop, voice note 2026-11-11):
3 pieces at 300 = 900, header discount 100 because she took 3,
paid 800. She returns 1 piece: the "original price" mode refunds
the recorded net line (267), the "forfeit" mode reprices the kept
pieces at the original 300 and refunds 200. Returns 2 pieces: 533.33
in original mode, 500 in forfeit mode.

WHAT THIS PINS, driving the REAL engine and the REAL ReturnsService
on PGlite (fresh database per case; same schema harness as
returns-relief-preview-truth, plus the line_discount column and the
four forfeit columns on return_documents):
- Engine: return 2 / keep 1 computes 500 (remaining 300, cap 600);
  return 1 / keep 2 computes 200 (remaining 600, cap 300).
- Engine: goodwill 250 on a return-1 computes goodwill 50; 350
  rejects GOODWILL_REFUND_ABOVE_CAP; 150 rejects
  GOODWILL_REFUND_BELOW_COMPUTED; goodwill on a full return rejects
  CONDITIONAL_DISCOUNT_GOODWILL_REQUIRES_FORFEIT.
- Engine: no header discount means no forfeit (return 1 of 3x300
  computes 300); a sequential return after an old pro-rata refund
  of 266.67 still totals 500 for two returned pieces (233.33 now).
- Preview shows BOTH modes: with the flag it pays the forfeit
  amount (500 / 200) and still reports the original amount
  (533.33 / 266.67); without the flag it pays the original amount
  and still reports the forfeit amount — and creates nothing.
- Create in original mode (no flag): return 2 refunds 533.33,
  return 1 refunds 266.67, document mode 'original'; create in
  forfeit mode refunds 500 / 200, document mode 'forfeit'.
- Create return 2 in forfeit mode: document total 500,
  forfeited_header_discount 100, treasury -500, stock +2 at the
  frozen cost 150, journal Dr 4400 500 / Cr 1110 500 and Dr 1140
  300 / Cr 5100 300 — net revenue after the return is the kept
  piece's 300.
- Create return 1 in forfeit mode: refund 200.
- Goodwill in EITHER mode: admin raising the return-1 refund to
  250 in forfeit mode stores goodwill 50 and pays 250; raising it
  to 280 in original mode stores goodwill 13.33 and pays 280; 350
  above the cap and a missing reason both reject and post nothing;
  a cashier raising it without a manager PIN rejects
  MANAGER_AUTH_REQUIRED and posts nothing; with PIN 2468 it pays.
- Line-discount interaction (INV-POS-LINE-DISCOUNT): returning the
  line-discounted piece (300 - 30) refunds 170; returning the other
  piece keeps that line discount and refunds 200.
- Sequential service case: an old pro-rata return of 266.67
  followed by a flagged return of the second piece pays 233.33,
  totalling 500 for the two pieces.
- Exchange fail-closed: preparing an exchange with the forfeit
  flag rejects FORFEIT_EXCHANGE_NOT_SUPPORTED and posts nothing.
*/

const ADMIN = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;
const CASHIER = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 2, username: 'cashier', permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
    INSERT INTO branches VALUES (1, 't1', 'Main', 1);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, location_type text);
    INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'branch_stock');
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
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
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text,
      barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0,
      is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text,
      amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint,
      status text, total numeric, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0,
      discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, subtotal numeric DEFAULT 0,
      prices_include_tax boolean DEFAULT false, payment_type text, payment_channel text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      exchange_return_id bigint, tip_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0,
      delivery_fee_mode text, service_charge numeric DEFAULT 0, delivery_status text,
      delivery_rep_id bigint, collection_status text, order_type text,
      delivery_signature text, delivery_photo_url text, delivery_gps_lat numeric, delivery_gps_lng numeric,
      delivery_notes text, settled_at timestamptz, settled_by bigint, updated_at timestamptz, sale_origin text);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      status text, total numeric, paid_amount numeric DEFAULT 0, tax_amount numeric DEFAULT 0,
      prices_include_tax boolean DEFAULT false, branch_id bigint, location_id bigint);
    CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint,
      product_name text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric,
      net_line_total numeric, allocated_discount numeric DEFAULT 0, allocated_tax numeric DEFAULT 0,
      cost_price numeric DEFAULT 0, unit_multiplier numeric DEFAULT 1, serials text, modifiers text,
      line_discount numeric(15, 3) DEFAULT 0);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint,
      payment_channel text, amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_line_id bigint, product_id bigint, quantity numeric, allocation_order int, location_id bigint);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_id bigint, sale_item_id bigint, product_id bigint, batch_id bigint, qty numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_id bigint, sale_item_id bigint, product_id bigint, quantity numeric, allocation_type text,
      reversal_of_allocation_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text,
      remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text,
      invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, note text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-02',
      exchange_return_id bigint, exchange_sale_id bigint,
      exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3),
      tip_relief numeric(15, 3), courier_relief numeric(15, 3),
      forfeited_header_discount numeric(15, 3), goodwill_amount numeric(15, 3), goodwill_reason text,
      header_discount_mode text);
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint,
      product_id bigint, product_name text, qty numeric, unit_total numeric, line_total numeric,
      allocated_tax numeric, cost_price numeric, sale_item_id bigint, purchase_item_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric,
      reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, serial_number text,
      imei_2 text, status text, product_id bigint, purchase_id bigint, purchase_item_id bigint, sale_id bigint,
      sale_item_id bigint, location_id bigint, branch_id bigint, cost_price numeric, warranty_end_date date, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint,
      batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text,
      amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint,
      branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text,
      opened_by bigint, status text, branch_id bigint, location_id bigint, expected_cash numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, status text, updated_at timestamptz);
    INSERT INTO accounting_settings VALUES
      (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
  `);
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 4100, 4200, 4300, 4400, 5100, 2150]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,account_id,code) VALUES ($1,$2,$3,$4)',
      [code, 't1', 'a1', String(code)]);
  }
  return { pg, db };
}

function makeServices(db: Kysely<Database>): { returns: ReturnsService; posting: AccountingPostingService; reps: DeliveryRepsService } {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined, logWithExecutor: async () => undefined };
  const idempotencyStub = { check: async () => null, commitOperation: async () => undefined };
  const returns = new ReturnsService(db as any, new TransactionHelper(), auditStub as any, posting as any, idempotencyStub as any);
  const salesFinance = new SalesFinanceService(db as any);
  const reps = new DeliveryRepsService(db as any, auditStub as any, posting as any, salesFinance as any);
  return { returns, posting, reps };
}

async function seedBase(db: Kysely<Database>): Promise<void> {
  await sql`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`.execute(db);
  await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);
  const adminRecord = await createPasswordRecord('admin-pass');
  await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', ${adminRecord.hash}, ${adminRecord.salt}, true)`.execute(db);
  await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true)`.execute(db);
  await sql`INSERT INTO cashier_shifts VALUES (1, 't1', 'a1', 'SHIFT-1', 1, 'open', 1, 1, 0, NOW())`.execute(db);
  await sql`INSERT INTO cashier_shifts VALUES (2, 't1', 'a1', 'SHIFT-2', 2, 'open', 1, 1, 0, NOW())`.execute(db);
  await sql`INSERT INTO products VALUES (10, 't1', 'a1', 'Widget', '', '', '', 100, 0, 10, true, false, NOW())`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty, updated_at) VALUES ('t1', 'a1', 10, 1, 1, 100, 0, NOW())`.execute(db);
  await sql`INSERT INTO customers VALUES (25, 't1', 'Cash customer', 0, 0, 0, 0, false, NOW())`.execute(db);
  await sql`INSERT INTO delivery_representatives VALUES (7, 't1', 'a1', 'Courier', true)`.execute(db);
}

/* The client's sale: 3 pieces x 300 = 900, header discount 100 for
   taking 3, paid 800 cash. Frozen cost 150 per piece. */
async function seedHeaderDiscountSale(db: Kysely<Database>, saleId = 1): Promise<number> {
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (${saleId}, 't1', 'a1', ${'S-' + saleId}, 25, 'posted', 800, 800, 0, 100, 0, 900, false, 'cash', 'cash', 1, 1, 0, 0, 'freelance_courier', 0)`.execute(db);
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier, line_discount)
    VALUES (${saleId * 10}, 't1', 'a1', ${saleId}, 10, 'Widget', 3, 300, 900, 266.67, 800, 100, 0, 150, 1, 0)`.execute(db);
  await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', ${saleId}, 'cash', 800)`.execute(db);
  return saleId;
}

/* Two pieces at 300, one with a 30 line discount, header discount
   100 over the 570 subtotal (total 470, paid cash). Allocated
   header shares: 47.37 on the discounted line, 52.63 on the other. */
async function seedLineDiscountSale(db: Kysely<Database>, saleId = 2): Promise<number> {
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (${saleId}, 't1', 'a1', ${'S-' + saleId}, 25, 'posted', 470, 470, 0, 100, 0, 570, false, 'cash', 'cash', 1, 1, 0, 0, 'freelance_courier', 0)`.execute(db);
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier, line_discount)
    VALUES (20, 't1', 'a1', ${saleId}, 10, 'Widget', 1, 300, 270, 222.63, 222.63, 47.37, 0, 150, 1, 30)`.execute(db);
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier, line_discount)
    VALUES (21, 't1', 'a1', ${saleId}, 10, 'Widget', 1, 300, 300, 247.37, 247.37, 52.63, 0, 150, 1, 0)`.execute(db);
  await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', ${saleId}, 'cash', 470)`.execute(db);
  return saleId;
}

async function returnDoc(db: Kysely<Database>, id: number): Promise<any> {
  return db.selectFrom('return_documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function returnDocCount(db: Kysely<Database>): Promise<number> {
  const count = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM return_documents`.execute(db);
  return Number(count.rows[0].n);
}

async function treasurySum(db: Kysely<Database>, txnType: string): Promise<number> {
  const row = await sql<{ s: string }>`SELECT COALESCE(SUM(amount), 0) AS s FROM treasury_transactions WHERE txn_type = ${txnType}`.execute(db);
  return Number(row.rows[0].s);
}

async function locationStockQty(db: Kysely<Database>, productId: number): Promise<number> {
  // The restock also provisions an unassigned (location NULL) balance
  // row at 0 — scope the read to the sale's branch/location row.
  const row = await db.selectFrom('product_location_stock').select('qty')
    .where('product_id', '=', productId).where('branch_id', '=', 1).where('location_id', '=', 1)
    .executeTakeFirstOrThrow();
  return Number((row as any).qty || 0);
}

async function latestStockMovementCost(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await sql<{ c: string }>`SELECT unit_cost AS c FROM stock_movements WHERE product_id = ${productId} ORDER BY id DESC LIMIT 1`.execute(db);
  return Number(row.rows[0]?.c || 0);
}

async function accountNet(pg: PGlite, code: string): Promise<number> {
  const rows = await pg.query<{ net: string }>(
    `SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS net FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE a.code = $1`,
    [code]);
  return Number(rows.rows[0].net);
}

async function createReturn(returns: ReturnsService, saleId: number, qty: number, auth: AuthContext, extra: Record<string, unknown> = {}, saleItemId?: number): Promise<{ ok: boolean; id: number }> {
  const result = await returns.createReturn({
    type: 'sale', invoiceId: saleId, note: 'spec return',
    items: [{ productId: 10, productName: 'Widget', qty, saleItemId: saleItemId ?? saleId * 10 }],
    settlementMode: 'refund', refundMethod: 'cash',
    ...extra,
  } as never, auth) as unknown as { ok: boolean; id: number };
  assert.equal(result.ok, true);
  return result;
}

async function previewReturn(returns: ReturnsService, saleId: number, qty: number, extra: Record<string, unknown> = {}, saleItemId?: number): Promise<any> {
  return (returns as any).previewReturnRelief({
    type: 'sale', invoiceId: saleId,
    items: [{ productId: 10, productName: 'Widget', qty, saleItemId: saleItemId ?? saleId * 10 }],
    ...extra,
  } as never, ADMIN) as unknown as any;
}

function engineInput(overrides: Record<string, unknown> = {}): Parameters<typeof computeConditionalDiscountForfeit>[0] {
  return {
    lines: [{ saleItemId: 10, soldQty: 3, unitPrice: 300, lineTotal: 900, lineDiscount: 0, allocatedDiscount: 100, allocatedTax: 0 }],
    returns: [{ saleItemId: 10, qty: 2 }],
    priorReturnedQtyByLine: new Map<number, number>(),
    headerDiscount: 100,
    invoiceTotal: 800,
    priorGoodsRefunded: 0,
    pricesIncludeTax: false,
    digits: 2,
    ...overrides,
  };
}

async function main(): Promise<void> {
  // Engine E1 — return 2 of 3: kept piece at the original 300,
  // refund 500. Not 600 (gross piece price) and not 533.33 (267).
  {
    const result = computeConditionalDiscountForfeit(engineInput());
    assert.equal(result.applies, true);
    assert.equal(result.computedGoodsRefund, 500);
    assert.equal(result.remainingNetAtOriginal, 300);
    assert.equal(result.forfeitedHeaderDiscount, 100);
    assert.equal(result.goodwillCap, 600);
    assert.equal(result.goodwillAmount, 0);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].lineTotal, 500);
  }

  // Engine E2 — return 1 of 3: kept two at the original 300 each,
  // refund 200. Not 300 and not 266.67.
  {
    const result = computeConditionalDiscountForfeit(engineInput({ returns: [{ saleItemId: 10, qty: 1 }] }));
    assert.equal(result.applies, true);
    assert.equal(result.computedGoodsRefund, 200);
    assert.equal(result.remainingNetAtOriginal, 600);
    assert.equal(result.forfeitedHeaderDiscount, 100);
    assert.equal(result.goodwillCap, 300);
    assert.equal(result.lines[0].lineTotal, 200);
  }

  // Engine E3 — goodwill 250 on a return-1: computed 200 + 50
  // goodwill, lines sum exactly to the requested 250.
  {
    const result = computeConditionalDiscountForfeit(engineInput({
      returns: [{ saleItemId: 10, qty: 1 }], requestedGoodsRefund: 250,
    }));
    assert.equal(result.applies, true);
    assert.equal(result.computedGoodsRefund, 200);
    assert.equal(result.goodwillAmount, 50);
    assert.equal(result.lines.reduce((sum, line) => sum + line.lineTotal, 0), 250);
  }

  // Engine E4 — goodwill above the returned pieces' gross price
  // (cap 300) fails closed.
  {
    assert.throws(
      () => computeConditionalDiscountForfeit(engineInput({
        returns: [{ saleItemId: 10, qty: 1 }], requestedGoodsRefund: 350,
      })),
      (error: any) => error.code === 'GOODWILL_REFUND_ABOVE_CAP',
    );
  }

  // Engine E5 — a requested refund below the computed refund fails
  // closed instead of silently underpaying the customer.
  {
    assert.throws(
      () => computeConditionalDiscountForfeit(engineInput({
        returns: [{ saleItemId: 10, qty: 1 }], requestedGoodsRefund: 150,
      })),
      (error: any) => error.code === 'GOODWILL_REFUND_BELOW_COMPUTED',
    );
  }

  // Engine E6 — a full return forfeits nothing (there is no kept
  // piece to reprice) and refunds everything; goodwill on it is
  // refused because there is no forfeit to attach it to.
  {
    const result = computeConditionalDiscountForfeit(engineInput({ returns: [{ saleItemId: 10, qty: 3 }] }));
    assert.equal(result.applies, false);
    assert.equal(result.computedGoodsRefund, 800);
    assert.equal(result.forfeitedHeaderDiscount, 0);
    assert.throws(
      () => computeConditionalDiscountForfeit(engineInput({
        returns: [{ saleItemId: 10, qty: 3 }], requestedGoodsRefund: 800,
      })),
      (error: any) => error.code === 'CONDITIONAL_DISCOUNT_GOODWILL_REQUIRES_FORFEIT',
    );
  }

  // Engine E7 — no header discount, no forfeit: return 1 of 3x300
  // computes the plain 300.
  {
    const result = computeConditionalDiscountForfeit(engineInput({
      headerDiscount: 0, invoiceTotal: 900,
      lines: [{ saleItemId: 10, soldQty: 3, unitPrice: 300, lineTotal: 900, lineDiscount: 0, allocatedDiscount: 0, allocatedTax: 0 }],
      returns: [{ saleItemId: 10, qty: 1 }],
    }));
    assert.equal(result.applies, false);
    assert.equal(result.computedGoodsRefund, 300);
    assert.equal(result.remainingNetAtOriginal, 600);
  }

  // Engine E8 — sequential returns stay exact on the invoice-level
  // anchor: an earlier return priced under the old pro-rata rule
  // (266.67) plus this return of the second piece totals 500.
  {
    const result = computeConditionalDiscountForfeit(engineInput({
      returns: [{ saleItemId: 10, qty: 1 }],
      priorReturnedQtyByLine: new Map<number, number>([[10, 1]]),
      priorGoodsRefunded: 266.67,
    }));
    assert.equal(result.applies, true);
    assert.equal(result.computedGoodsRefund, 233.33);
    assert.equal(result.remainingNetAtOriginal, 300);
  }

  // Service S1 — preview return 2 in forfeit mode: the dialog pays
  // 500 and still shows the original-mode 533.33 next to it; the
  // preview creates nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const preview = await previewReturn(returns, 1, 2, { forfeitHeaderDiscount: true });
      assert.equal(preview.goodsTotal, 500);
      assert.equal(preview.originalGoodsTotal, 533.33);
      assert.equal(preview.refundTotal, 500);
      assert.equal(preview.forfeit.applies, true);
      assert.equal(preview.forfeit.computedGoodsRefund, 500);
      assert.equal(preview.forfeit.remainingNetAtOriginal, 300);
      assert.equal(preview.forfeit.forfeitedHeaderDiscount, 100);
      assert.equal(preview.forfeit.goodwillCap, 600);
      assert.equal(preview.forfeit.goodwillAmount, 0);
      assert.equal(await returnDocCount(db), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Service S1b — preview return 1 in forfeit mode: pays 200,
  // original mode alongside is 266.67.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const preview = await previewReturn(returns, 1, 1, { forfeitHeaderDiscount: true });
      assert.equal(preview.goodsTotal, 200);
      assert.equal(preview.originalGoodsTotal, 266.67);
      assert.equal(preview.refundTotal, 200);
      assert.equal(preview.forfeit.computedGoodsRefund, 200);
      assert.equal(preview.forfeit.goodwillCap, 300);
    } finally {
      await db.destroy();
    }
  }

  // Service S2 — preview WITHOUT the flag pays the original-mode
  // 533.33 and still shows the forfeit 500 alongside it: both
  // amounts are always visible, the flag only selects which one pays.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const preview = await previewReturn(returns, 1, 2);
      assert.equal(preview.goodsTotal, 533.33);
      assert.equal(preview.originalGoodsTotal, 533.33);
      assert.equal(preview.refundTotal, 533.33);
      assert.equal(preview.forfeit.applies, true);
      assert.equal(preview.forfeit.computedGoodsRefund, 500);
      assert.equal(preview.forfeit.goodwillCap, 600);
    } finally {
      await db.destroy();
    }
  }

  // Service S3 — create return 2 in forfeit mode: document 500,
  // forfeited 100, mode 'forfeit', drawer -500, stock +2 at the
  // frozen cost 150, journal Dr 4400 500 / Cr 1110 500 and Dr 1140
  // 300 / Cr 5100 300.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 2, ADMIN, { forfeitHeaderDiscount: true }) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 500);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 500);
      assert.equal(Number(doc.forfeited_header_discount), 100);
      assert.equal(Number(doc.goodwill_amount || 0), 0);
      assert.equal(String(doc.header_discount_mode), 'forfeit');
      assert.ok(String(doc.note || '').includes('إلغاء خصم فاتورة مشروط'));
      assert.equal(await treasurySum(db, 'sale_return_refund'), -500);
      assert.equal(await locationStockQty(db, 10), 102);
      assert.equal(await latestStockMovementCost(db, 10), 150);
      assert.equal(await accountNet(pg, '4400'), 500);
      assert.equal(await accountNet(pg, '1110'), -500);
      assert.equal(await accountNet(pg, '1140'), 300);
      assert.equal(await accountNet(pg, '5100'), -300);
      const detail = await returns.getReturnById(result.id, ADMIN) as unknown as { returnDocument: { total: number; forfeitedHeaderDiscount: number; goodwillAmount: number; headerDiscountMode: string; refundTotal: number } };
      assert.equal(detail.returnDocument.total, 500);
      assert.equal(detail.returnDocument.forfeitedHeaderDiscount, 100);
      assert.equal(detail.returnDocument.goodwillAmount, 0);
      assert.equal(detail.returnDocument.headerDiscountMode, 'forfeit');
      assert.equal(detail.returnDocument.refundTotal, 500);
    } finally {
      await db.destroy();
    }
  }

  // Service S3b — create return 2 in original mode (no flag): the
  // recorded net line pays 533.33 and the document says so.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 2, ADMIN) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 533.33);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 533.33);
      assert.equal(Number(doc.forfeited_header_discount || 0), 0);
      assert.equal(String(doc.header_discount_mode), 'original');
      assert.equal(await treasurySum(db, 'sale_return_refund'), -533.33);
      assert.equal(await locationStockQty(db, 10), 102);
    } finally {
      await db.destroy();
    }
  }

  // Service S4 — create return 1 in forfeit mode: refund 200,
  // document mode 'forfeit'.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN, { forfeitHeaderDiscount: true }) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 200);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 200);
      assert.equal(Number(doc.forfeited_header_discount), 100);
      assert.equal(String(doc.header_discount_mode), 'forfeit');
      assert.equal(await treasurySum(db, 'sale_return_refund'), -200);
      assert.equal(await locationStockQty(db, 10), 101);
    } finally {
      await db.destroy();
    }
  }

  // Service S4b — create return 1 in original mode: refund 266.67,
  // document mode 'original'.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 266.67);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 266.67);
      assert.equal(Number(doc.forfeited_header_discount || 0), 0);
      assert.equal(String(doc.header_discount_mode), 'original');
      assert.equal(await treasurySum(db, 'sale_return_refund'), -266.67);
    } finally {
      await db.destroy();
    }
  }

  // Service S5 — goodwill, admin, forfeit mode: return 1 raised to
  // 250 stores goodwill 50 with its reason, mode 'forfeit', pays 250.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN, {
        forfeitHeaderDiscount: true, goodwillRefundAmount: 250, goodwillRefundReason: 'عميلة قديمة',
      }) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 250);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 250);
      assert.equal(Number(doc.forfeited_header_discount), 100);
      assert.equal(Number(doc.goodwill_amount), 50);
      assert.equal(String(doc.goodwill_reason), 'عميلة قديمة');
      assert.equal(String(doc.header_discount_mode), 'forfeit');
      assert.ok(String(doc.note || '').includes('عميلة قديمة'));
      assert.equal(await treasurySum(db, 'sale_return_refund'), -250);
    } finally {
      await db.destroy();
    }
  }

  // Service S5b — goodwill, admin, ORIGINAL mode: return 1 raised
  // to 280 (computed 266.67, cap 300) stores goodwill 13.33,
  // mode 'original', pays 280.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN, {
        goodwillRefundAmount: 280, goodwillRefundReason: 'عميلة قديمة',
      }) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 280);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 280);
      assert.equal(Number(doc.forfeited_header_discount || 0), 0);
      assert.equal(Number(doc.goodwill_amount), 13.33);
      assert.equal(String(doc.goodwill_reason), 'عميلة قديمة');
      assert.equal(String(doc.header_discount_mode), 'original');
      assert.ok(String(doc.note || '').includes('عميلة قديمة'));
      assert.equal(await treasurySum(db, 'sale_return_refund'), -280);
    } finally {
      await db.destroy();
    }
  }

  // Service S5c — goodwill in original mode above the cap (350 >
  // 300) rejects and posts nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      await assert.rejects(
        createReturn(returns, 1, 1, ADMIN, {
          goodwillRefundAmount: 350, goodwillRefundReason: 'too generous',
        }),
        (error: any) => error.code === 'GOODWILL_REFUND_ABOVE_CAP',
      );
      assert.equal(await returnDocCount(db), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      assert.equal(await locationStockQty(db, 10), 100);
    } finally {
      await db.destroy();
    }
  }

  // Service S5d — goodwill in original mode below the computed
  // amount (250 < 266.67) rejects and posts nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      await assert.rejects(
        createReturn(returns, 1, 1, ADMIN, {
          goodwillRefundAmount: 250, goodwillRefundReason: 'too little',
        }),
        (error: any) => error.code === 'GOODWILL_REFUND_BELOW_COMPUTED',
      );
      assert.equal(await returnDocCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Service S6 — goodwill above the cap rejects and posts nothing:
  // no document, no treasury move, no restock.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      await assert.rejects(
        createReturn(returns, 1, 1, ADMIN, {
          forfeitHeaderDiscount: true, goodwillRefundAmount: 350, goodwillRefundReason: 'too generous',
        }),
        (error: any) => error.code === 'GOODWILL_REFUND_ABOVE_CAP',
      );
      assert.equal(await returnDocCount(db), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      assert.equal(await locationStockQty(db, 10), 100);
    } finally {
      await db.destroy();
    }
  }

  // Service S7 — goodwill without a reason rejects and posts nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      await assert.rejects(
        createReturn(returns, 1, 1, ADMIN, { forfeitHeaderDiscount: true, goodwillRefundAmount: 250 }),
        (error: any) => error.code === 'GOODWILL_REASON_REQUIRED',
      );
      assert.equal(await returnDocCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Service S8 — a cashier raising the refund without a manager
  // PIN is blocked and posts nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      await assert.rejects(
        createReturn(returns, 1, 1, CASHIER, {
          forfeitHeaderDiscount: true, goodwillRefundAmount: 250, goodwillRefundReason: 'عميلة قديمة',
        }),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      assert.equal(await returnDocCount(db), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      assert.equal(await locationStockQty(db, 10), 100);
    } finally {
      await db.destroy();
    }
  }

  // Service S9 — the same cashier return with the manager PIN 2468
  // pays the 250.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, CASHIER, {
        forfeitHeaderDiscount: true, goodwillRefundAmount: 250, goodwillRefundReason: 'عميلة قديمة', managerPin: '2468',
      }) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 250);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 250);
      assert.equal(Number(doc.goodwill_amount), 50);
      assert.equal(String(doc.header_discount_mode), 'forfeit');
      assert.equal(await treasurySum(db, 'sale_return_refund'), -250);
    } finally {
      await db.destroy();
    }
  }

  // Service S9b — the same goodwill gate in ORIGINAL mode: a
  // cashier raising the return-1 refund to 280 without a manager
  // PIN is blocked and posts nothing; with PIN 2468 it pays 280.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      await assert.rejects(
        createReturn(returns, 1, 1, CASHIER, {
          goodwillRefundAmount: 280, goodwillRefundReason: 'عميلة قديمة',
        }),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      assert.equal(await returnDocCount(db), 0);
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, CASHIER, {
        goodwillRefundAmount: 280, goodwillRefundReason: 'عميلة قديمة', managerPin: '2468',
      }) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 280);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 280);
      assert.equal(Number(doc.goodwill_amount), 13.33);
      assert.equal(String(doc.header_discount_mode), 'original');
      assert.equal(await treasurySum(db, 'sale_return_refund'), -280);
    } finally {
      await db.destroy();
    }
  }

  // Service S10 — line-discount interaction: returning the
  // line-discounted piece (300 - 30) refunds 170; returning the
  // other piece keeps that line discount and refunds 200.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedLineDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 2, 1, ADMIN, { forfeitHeaderDiscount: true }, 20) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 170);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 170);
      assert.equal(Number(doc.forfeited_header_discount), 100);
      assert.equal(String(doc.header_discount_mode), 'forfeit');
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedLineDiscountSale(db);
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 2, 1, ADMIN, { forfeitHeaderDiscount: true }, 21) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 200);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.total), 200);
      assert.equal(Number(doc.forfeited_header_discount), 100);
      assert.equal(String(doc.header_discount_mode), 'forfeit');
    } finally {
      await db.destroy();
    }
  }

  // Service S11 — sequential: an old pro-rata return of 266.67
  // followed by a flagged return of the second piece pays 233.33,
  // totalling 500 for the two pieces.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      const first = await createReturn(returns, 1, 1, ADMIN) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(first.refundTotal, 266.67);
      const firstDoc = await returnDoc(db, first.id);
      assert.equal(String(firstDoc.header_discount_mode), 'original');
      const second = await createReturn(returns, 1, 1, ADMIN, { forfeitHeaderDiscount: true }) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(second.refundTotal, 233.33);
      const secondDoc = await returnDoc(db, second.id);
      assert.equal(String(secondDoc.header_discount_mode), 'forfeit');
      assert.equal(await returnDocCount(db), 2);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -500);
    } finally {
      await db.destroy();
    }
  }

  // Service S12 — exchange fail-closed: preparing an exchange with
  // the forfeit flag rejects and posts nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedHeaderDiscountSale(db);
      const { returns } = makeServices(db);
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          await returns.prepareExchangeReturn(trx, {
            type: 'sale', invoiceId: 1, note: 'spec exchange',
            items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
            settlementMode: 'refund', refundMethod: 'cash',
            managerPin: '2468', forfeitHeaderDiscount: true,
          } as never, ADMIN);
        }),
        (error: any) => error.code === 'FORFEIT_EXCHANGE_NOT_SUPPORTED',
      );
      assert.equal(await returnDocCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  console.log('Return conditional discount forfeit tests passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
