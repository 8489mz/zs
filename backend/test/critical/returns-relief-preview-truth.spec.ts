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

/*
New file: backend/test/critical/returns-relief-preview-truth.spec.ts
Pins T10-D (INV-REST-RETURN-RELIEF-TRUTH): the return dialog and the
return document must show the refund the backend actually pays.

THE DEFECT (F5, proven at base 55cb6eac): R6-E/R7-A fixed the journal
and the payout — createSaleReturn relieves the tip/courier fee and
moves total + relief — but the dialog computed its expected refund
from line totals only (ReturnsWorkspace.tsx:132), there was no relief
API, and return_documents.total stored only the goods total while
the 85-split lived only in refund_allocations JSON. Every
user-facing figure said 75 for a return the books paid 85 for.

WHAT THIS PINS, driving the REAL ReturnsService on PGlite (fresh
database per case; same schema harness as returns-payout-truth):
- Preview full return of a tipped sale (goods 75 + tip 10): the
  preview the dialog reads says goodsTotal 75, tipRelief 10,
  refundTotal 85 — and creates nothing (no document, no treasury
  row, no journal).
- Preview partial return (goods 100 + tip 10 + fee 20, return
  half): goodsTotal 50, tipRelief 5, courierRelief 10,
  refundTotal 65.
- Preview with tip_amount = 0 (tip entered as over-tender, not
  through the tip field): relief 0, refundTotal = goods total 75 —
  the dialog shows what the backend will actually pay, whatever
  the stored data says.
- Preview of a purchase return rejects RETURN_TYPE_INVALID:
  relief exists only on sales; the preview is sale-only.
- Create full tipped return: the stored document carries
  tip_relief 10 / courier_relief 0, the create response carries
  refundTotal 85, getReturnById returns refundTotal 85, and the
  treasury moves -85 — dialog-visible total = payout total.
- Create partial tipped return: the stored document carries
  tip_relief 5 / courier_relief 10, getReturnById returns
  refundTotal 65, and the register row (listReturns) carries the
  same 65 with its relief split.
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
      cost_price numeric DEFAULT 0, unit_multiplier numeric DEFAULT 1, serials text, modifiers text);
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
      forfeited_header_discount numeric(15, 3), goodwill_amount numeric(15, 3), goodwill_reason text, header_discount_mode text);
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

/* A sale of 2 units at 500 (goods 1000) + tip 50 + freelance fee 30
   + service 0 = total 1080, paid cash 1080, customer 25. */
async function seedTippedCashSale(db: Kysely<Database>, opts: { saleId?: number; subtotal?: number; tip?: number; fee?: number; service?: number; qty?: number; paidCash?: number; paidCard?: number } = {}): Promise<number> {
  const saleId = opts.saleId ?? 1;
  const subtotal = opts.subtotal ?? 1000;
  const tip = opts.tip ?? 50;
  const fee = opts.fee ?? 30;
  const service = opts.service ?? 0;
  const qty = opts.qty ?? 2;
  const total = subtotal + tip + fee + service;
  const paidCash = opts.paidCash ?? total;
  const paidCard = opts.paidCard ?? 0;
  const unitPrice = subtotal / qty;
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (${saleId}, 't1', 'a1', ${'S-' + saleId}, 25, 'posted', ${total}, ${paidCash + paidCard}, 0, 0, 0, ${subtotal}, false, 'cash', 'cash', 1, 1, ${tip}, ${fee}, 'freelance_courier', ${service})`.execute(db);
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
    VALUES (${saleId * 10}, 't1', 'a1', ${saleId}, 10, 'Widget', ${qty}, ${unitPrice}, ${subtotal}, ${unitPrice}, ${subtotal}, 0, 0, 0, 1)`.execute(db);
  if (paidCash > 0) await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', ${saleId}, 'cash', ${paidCash})`.execute(db);
  if (paidCard > 0) await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', ${saleId}, 'card', ${paidCard})`.execute(db);
  return saleId;
}

/* A COD delivery sale for rep 7: goods + tip + fee + service, paid 0. */
async function seedCodSale(db: Kysely<Database>, opts: { saleId: number; subtotal?: number; tip?: number; fee?: number; service?: number; qty?: number; storeCreditUsed?: number; mode?: string }): Promise<number> {
  const saleId = opts.saleId;
  const subtotal = opts.subtotal ?? 100;
  const tip = opts.tip ?? 10;
  const fee = opts.fee ?? 20;
  const service = opts.service ?? 0;
  const qty = opts.qty ?? 2;
  const total = subtotal + tip + fee + service;
  const unitPrice = subtotal / qty;
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge, delivery_status, delivery_rep_id, collection_status, order_type)
    VALUES (${saleId}, 't1', 'a1', ${'S-' + saleId}, 25, 'posted', ${total}, 0, ${opts.storeCreditUsed ?? 0}, 0, 0, ${subtotal}, false, 'credit', 'credit', 1, 1, ${tip}, ${fee}, ${opts.mode ?? 'freelance_courier'}, ${service}, NULL, 7, 'cod', 'delivery')`.execute(db);
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
    VALUES (${saleId * 10}, 't1', 'a1', ${saleId}, 10, 'Widget', ${qty}, ${unitPrice}, ${subtotal}, ${unitPrice}, ${subtotal}, 0, 0, 0, 1)`.execute(db);
  return saleId;
}

async function returnDoc(db: Kysely<Database>, id: number): Promise<any> {
  return db.selectFrom('return_documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function treasurySum(db: Kysely<Database>, txnType: string): Promise<number> {
  const row = await sql<{ s: string }>`SELECT COALESCE(SUM(amount), 0) AS s FROM treasury_transactions WHERE txn_type = ${txnType}`.execute(db);
  return Number(row.rows[0].s);
}

async function shiftCash(db: Kysely<Database>, shiftId: number): Promise<number> {
  const row = await db.selectFrom('cashier_shifts').select('expected_cash').where('id', '=', shiftId).executeTakeFirstOrThrow();
  return Number((row as any).expected_cash || 0);
}

async function customerBalance(db: Kysely<Database>): Promise<{ balance: number; storeCredit: number }> {
  const row = await db.selectFrom('customers').select(['balance', 'store_credit_balance']).where('id', '=', 25).executeTakeFirstOrThrow();
  return { balance: Number((row as any).balance || 0), storeCredit: Number((row as any).store_credit_balance || 0) };
}

async function ledgerEntries(db: Kysely<Database>): Promise<Array<{ type: string; amount: number; balanceAfter: number }>> {
  const rows = await db.selectFrom('customer_ledger').select(['entry_type', 'amount', 'balance_after']).where('customer_id', '=', 25).orderBy('id', 'asc').execute();
  return rows.map((row: any) => ({ type: String(row.entry_type), amount: Number(row.amount), balanceAfter: Number(row.balance_after) }));
}

async function journalBySource(pg: PGlite, db: Kysely<Database>, sourceType: string, sourceId: number): Promise<Map<string, { debit: number; credit: number }>> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_type', '=', sourceType).where('source_id', '=', sourceId).execute() as Array<{ id: number }>;
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
  const rows = await pg.query<{ code: string; debit: string; credit: string }>(
    `SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1`,
    [Number(entries[0].id)]);
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const row of rows.rows) byCode.set(row.code, { debit: Number(row.debit), credit: Number(row.credit) });
  return byCode;
}

async function journalCount(pg: PGlite, db: Kysely<Database>, sourceType: string, sourceId: number): Promise<number> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_type', '=', sourceType).where('source_id', '=', sourceId).execute() as Array<{ id: number }>;
  return entries.length;
}

async function accountNet(pg: PGlite, code: string): Promise<number> {
  const rows = await pg.query<{ net: string }>(
    `SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS net FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE a.code = $1`,
    [code]);
  return Number(rows.rows[0].net);
}

async function createReturn(returns: ReturnsService, saleId: number, qty: number, auth: AuthContext, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; id: number }> {
  const result = await returns.createReturn({
    type: 'sale', invoiceId: saleId, note: 'spec return',
    items: [{ productId: 10, productName: 'Widget', qty, saleItemId: saleId * 10 }],
    settlementMode: 'refund', refundMethod: 'cash',
    ...extra,
  } as never, auth) as unknown as { ok: boolean; id: number };
  assert.equal(result.ok, true);
  return result;
}

async function main(): Promise<void> {
  // Case 1 — preview full return, trial shape: goods 75 + tip 10.
  // The dialog reads 85, not the lines-only 75 — and the preview
  // itself posts nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 75, tip: 10, fee: 0, qty: 1 });
      const { returns } = makeServices(db);
      const preview = await (returns as any).previewReturnRelief({
        type: 'sale', invoiceId: 1,
        items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
      } as never, ADMIN) as unknown as { goodsTotal: number; tipRelief: number; courierRelief: number; totalRelief: number; refundTotal: number };
      assert.equal(preview.goodsTotal, 75);
      assert.equal(preview.tipRelief, 10);
      assert.equal(preview.courierRelief, 0);
      assert.equal(preview.totalRelief, 10);
      assert.equal(preview.refundTotal, 85);
      const count = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM return_documents`.execute(db);
      assert.equal(Number(count.rows[0].n), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 2 — preview partial return: half the goods relieves half
  // the tip and half the courier fee (50 + 5 + 10 = 65).
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 100, tip: 10, fee: 20, qty: 2 });
      const { returns } = makeServices(db);
      const preview = await (returns as any).previewReturnRelief({
        type: 'sale', invoiceId: 1,
        items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
      } as never, ADMIN) as unknown as { goodsTotal: number; tipRelief: number; courierRelief: number; totalRelief: number; refundTotal: number };
      assert.equal(preview.goodsTotal, 50);
      assert.equal(preview.tipRelief, 5);
      assert.equal(preview.courierRelief, 10);
      assert.equal(preview.totalRelief, 15);
      assert.equal(preview.refundTotal, 65);
    } finally {
      await db.destroy();
    }
  }

  // Case 3 — tip stored as 0 (entered as over-tender, not through
  // the tip field): no relief exists, so the dialog must show 75 —
  // what the backend will actually pay — not an invented 85.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 75, tip: 0, fee: 0, qty: 1 });
      const { returns } = makeServices(db);
      const preview = await (returns as any).previewReturnRelief({
        type: 'sale', invoiceId: 1,
        items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
      } as never, ADMIN) as unknown as { goodsTotal: number; tipRelief: number; courierRelief: number; totalRelief: number; refundTotal: number };
      assert.equal(preview.goodsTotal, 75);
      assert.equal(preview.tipRelief, 0);
      assert.equal(preview.courierRelief, 0);
      assert.equal(preview.totalRelief, 0);
      assert.equal(preview.refundTotal, 75);
    } finally {
      await db.destroy();
    }
  }

  // Case 4 — preview is sale-only: relief exists only on sales,
  // so a purchase preview fails closed instead of inventing a
  // goods-only figure through the relief path.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 75, tip: 10, fee: 0, qty: 1 });
      const { returns } = makeServices(db);
      await assert.rejects(
        (returns as any).previewReturnRelief({
          type: 'purchase', invoiceId: 1,
          items: [{ productId: 10, productName: 'Widget', qty: 1, purchaseItemId: 10 }],
        } as never, ADMIN),
        (error: any) => error.code === 'RETURN_TYPE_INVALID',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 5 — create full tipped return: the stored document carries
  // the relief, the create response carries the refund total, the
  // single-document read returns refundTotal 85, and the treasury
  // moves -85 — dialog-visible total = payout total.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 75, tip: 10, fee: 0, qty: 1 });
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN) as unknown as { ok: boolean; id: number; refundTotal: number; tipRelief: number; courierRelief: number };
      assert.equal(result.refundTotal, 85);
      assert.equal(result.tipRelief, 10);
      assert.equal(result.courierRelief, 0);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.tip_relief), 10);
      assert.equal(Number(doc.courier_relief), 0);
      assert.equal(Number(doc.total), 75);
      const detail = await returns.getReturnById(result.id, ADMIN) as unknown as { returnDocument: { total: number; tipRelief: number; courierRelief: number; refundTotal: number } };
      assert.equal(detail.returnDocument.total, 75);
      assert.equal(detail.returnDocument.tipRelief, 10);
      assert.equal(detail.returnDocument.courierRelief, 0);
      assert.equal(detail.returnDocument.refundTotal, 85);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -85);
    } finally {
      await db.destroy();
    }
  }

  // Case 6 — create partial tipped return: the stored document
  // carries tip_relief 5 / courier_relief 10, the single-document
  // read returns refundTotal 65, and the register row carries the
  // same 65 with its relief split.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 100, tip: 10, fee: 20, qty: 2 });
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN) as unknown as { ok: boolean; id: number; refundTotal: number };
      assert.equal(result.refundTotal, 65);
      const doc = await returnDoc(db, result.id);
      assert.equal(Number(doc.tip_relief), 5);
      assert.equal(Number(doc.courier_relief), 10);
      assert.equal(Number(doc.total), 50);
      const detail = await returns.getReturnById(result.id, ADMIN) as unknown as { returnDocument: { total: number; tipRelief: number; courierRelief: number; refundTotal: number } };
      assert.equal(detail.returnDocument.refundTotal, 65);
      const listed = await returns.listReturns({}, ADMIN) as unknown as { returns: Array<{ id: string; total: number; tipRelief: number; courierRelief: number; refundTotal: number }> };
      assert.equal(listed.returns.length, 1);
      assert.equal(listed.returns[0].total, 50);
      assert.equal(listed.returns[0].tipRelief, 5);
      assert.equal(listed.returns[0].courierRelief, 10);
      assert.equal(listed.returns[0].refundTotal, 65);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -65);
    } finally {
      await db.destroy();
    }
  }

  console.log('Return relief preview truth tests passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
