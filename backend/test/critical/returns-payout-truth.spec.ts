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
New file: backend/test/critical/returns-payout-truth.spec.ts
Pins R7-A (INV-REST-RETURN-PAYOUT-TRUTH): after a return, every
money movement must use the REMAINING amounts.

THE DEFECTS (all proven at base 9e3946e2, one root cause):
- F1: createSaleReturn's payout loop moved money per the stored
  allocations (sum = return total) while postSalesReturn journalled
  total + reliefs — treasury / store-credit / customer-ledger were
  short by exactly totalRelief per tipped/courier return, on the
  last tender's movement only. The large-cash-refund approval check
  also read the pre-relief cash leg.
- F2: delivery-reps callers computed settlement as total -
  originalFee and failed closed at postDeliveryRepSettlement — and
  fixing only the fee would still credit 1130 by the FULL original
  total while the prior return already credited 1130 for its
  receivable leg. The settlement is derived from the REMAINING
  RECEIVABLE (decision recorded in deliverySettlementBasis), not by
  blocking returns of unsettled COD orders.
- F3: exchange-collected relief posted no sales_return journal, so
  priorSalesReturnRelief never counted it and a later return could
  over-relieve. The relief is now recorded on the return row
  (migration 0311) and counted for unjournalled priors.

WHAT THIS PINS, driving the REAL ReturnsService / DeliveryRepsService
/ AccountingPostingService on PGlite (fresh database per case; audit +
idempotency stubbed, tenant foundation stubbed as in the
large-cash-refund-approval spec, whose schema this reuses):
- F1 cash: half return of a tipped freelance sale (total 500,
  relief 40) moves 540 through treasury AND the journal (not 500),
  and the drawer expected_cash moves by the same 540; the customer
  statement pair shows the actual refund (540), balance unchanged.
- F1 card-last: a cash 500 + card 580 sale returned for 540 tops
  up the CARD leg (40) — treasury moves only the 500 cash leg,
  the journal credits bank 40; no card treasury row is invented.
- F1 store-credit-last: a store-credit settlement of the same half
  return grants 540 of store credit (500 + 40 relief) — the
  customer balance moves by the full refund, treasury moves
  nothing, and the journal credits 2150 by 540.
- F1 approval: a cash leg of 490 crosses the 500 threshold ONLY
  with its 40 relief (530) — no credential rejects with
  MANAGER_AUTH_REQUIRED and posts nothing; the manager PIN
  approves it and 530 moves.
- F1 full return: the whole tip + fee relieve, 1080 moves, and
  2147/2115 land at zero (sale journal + return journal net).
- F1 second partial: two half returns move 65 + 65, relieve
  5+10 each, land 2147/2115 at zero; a third return of the same
  line is rejected (RETURN_QTY_EXCEEDED).
- F2 settleOrder: after a half return of a COD sale (receivable
  leg 65), the stale amount 122 rejects with
  DELIVERY_SETTLEMENT_INVALID, the corrected settle collects 67
  cash, credits 1130 by 77 (not 142), and lands both 1130 and
  2115 at zero; the customer ledger totals -142.
- F2 settleAllOrders: the stale batch total (322) throws
  AMOUNT_MISMATCH; the corrected total (267) settles both orders.
- F2 zero: a fully-returned COD sale (no service charge) settles
  with zero cash, no settlement journal, no treasury row — the
  order is marked settled and 1130 is already zero via the return.
- F2 store-credit edge: when the remaining fee (15) exceeds the
  remaining receivable (0), settleOrder fails closed with
  DELIVERY_SETTLEMENT_INVALID instead of silently dropping the fee.
- F2 service charge: a full goods return leaves the 12 service
  charge as the remaining receivable, and it still settles (12 cash).
- F3 real exchange: a prepared exchange grants store credit for
  the return total only (50, no relief top-up); the new sale's
  journal collects the relief lines (Dr 2147 5 / Dr 2115 10) and
  the return row records exchange_tip_relief 5 /
  exchange_courier_relief 10; the later plain return of the other
  half relieves only the remaining 5 + 10 (65 refund, treasury
  -65) — total relief never exceeds the originally credited 10 + 20.
- F3 synthetic discriminator (F5 pattern): an exchange-collected
  60% return (relief 6 + 12) caps a second synthetic 60% return
  at 4 + 8 (refund 72), not a second 6 + 12 — the cap counts the
  exchange-collected relief.
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
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
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
      exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3));
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
  await sql`INSERT INTO customers VALUES (25, 't1', 0, 0, 0, 0, false, NOW())`.execute(db);
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
  const inTx = (db: Kysely<Database>) => <T>(fn: (trx: any) => Promise<T>): Promise<T> => db.transaction().execute(fn);

  // Case 1 — F1 cash: half return moves 540 (500 + 40 relief) through
  // treasury, drawer and journal alike — not 500.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, {});
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN);
      const doc = await returnDoc(db, result.id);
      const allocations = typeof doc.refund_allocations === 'string' ? JSON.parse(doc.refund_allocations) : doc.refund_allocations;
      assert.deepEqual(allocations, [{ tender: 'cash', amount: 540 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -540);
      assert.equal(await shiftCash(db, 1), -540);
      const journal = await journalBySource(pg, db, 'sales_return', result.id);
      assert.equal(journal.get('4400')?.debit, 500);
      assert.equal(journal.get('2147')?.debit, 25);
      assert.equal(journal.get('2115')?.debit, 15);
      assert.equal(journal.get('1110')?.credit, 540);
      assert.deepEqual(await ledgerEntries(db), [
        { type: 'sale_return', amount: -540, balanceAfter: -540 },
        { type: 'sale_return_refund', amount: 540, balanceAfter: 0 },
      ]);
      assert.equal((await customerBalance(db)).balance, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 2 — F1 card-last: the relief tops up the CARD leg. Treasury
  // moves only the 500 cash leg; the journal credits bank 40; no
  // card treasury row is invented.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { paidCash: 500, paidCard: 580 });
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN);
      const doc = await returnDoc(db, result.id);
      const allocations = typeof doc.refund_allocations === 'string' ? JSON.parse(doc.refund_allocations) : doc.refund_allocations;
      assert.deepEqual(allocations, [{ tender: 'cash', amount: 500 }, { tender: 'card', amount: 40 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -500);
      const journal = await journalBySource(pg, db, 'sales_return', result.id);
      assert.equal(journal.get('1110')?.credit, 500);
      assert.equal(journal.get('1120')?.credit, 40);
      assert.equal(journal.get('2147')?.debit, 25);
      assert.equal(journal.get('2115')?.debit, 15);
      assert.deepEqual(await ledgerEntries(db), [
        { type: 'sale_return', amount: -540, balanceAfter: -540 },
        { type: 'sale_return_refund', amount: 540, balanceAfter: 0 },
      ]);
      assert.equal((await customerBalance(db)).storeCredit, 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 2b — F1 store-credit-last: the same half return settled
  // to store credit grants 540 (500 + 40 relief) — the customer
  // balance moves by the full refund, treasury moves nothing, and
  // the journal credits 2150 by 540.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, {});
      const { returns } = makeServices(db);
      const result = await createReturn(returns, 1, 1, ADMIN, { settlementMode: 'store_credit' });
      const doc = await returnDoc(db, result.id);
      const allocations = typeof doc.refund_allocations === 'string' ? JSON.parse(doc.refund_allocations) : doc.refund_allocations;
      assert.deepEqual(allocations, [{ tender: 'store_credit', amount: 540 }]);
      assert.equal((await customerBalance(db)).storeCredit, 540);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      const journal = await journalBySource(pg, db, 'sales_return', result.id);
      assert.equal(journal.get('4400')?.debit, 500);
      assert.equal(journal.get('2147')?.debit, 25);
      assert.equal(journal.get('2115')?.debit, 15);
      assert.equal(journal.get('2150')?.credit, 540);
      assert.deepEqual(await ledgerEntries(db), [
        { type: 'sale_return', amount: -540, balanceAfter: -540 },
        { type: 'sale_return_refund', amount: 540, balanceAfter: 0 },
      ]);
    } finally {
      await db.destroy();
    }
  }

  // Case 3 — F1 approval: cash leg 490 crosses the 500 threshold
  // ONLY with its 40 relief (530). No credential rejects and posts
  // nothing; the manager PIN approves it and 530 moves.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 980, tip: 50, fee: 30, qty: 2 });
      const { returns } = makeServices(db);
      await assert.rejects(
        createReturn(returns, 1, 1, CASHIER),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      const count = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM return_documents`.execute(db);
      assert.equal(Number(count.rows[0].n), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      const result = await createReturn(returns, 1, 1, CASHIER, { managerPin: '2468' });
      assert.equal(await treasurySum(db, 'sale_return_refund'), -530);
      assert.equal(await shiftCash(db, 2), -530);
      const journal = await journalBySource(pg, db, 'sales_return', result.id);
      assert.equal(journal.get('1110')?.credit, 530);
      assert.equal(journal.get('2147')?.debit, 25);
      assert.equal(journal.get('2115')?.debit, 15);
    } finally {
      await db.destroy();
    }
  }

  // Case 4 — F1 full return: the whole tip (50) + fee (30) relieve,
  // 1080 moves, and 2147/2115 land at zero.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, {});
      const { returns, posting } = makeServices(db);
      await inTx(db)((trx) => posting.postSale(trx, 1, ADMIN));
      const result = await createReturn(returns, 1, 2, ADMIN);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -1080);
      assert.equal(await shiftCash(db, 1), -1080);
      const journal = await journalBySource(pg, db, 'sales_return', result.id);
      assert.equal(journal.get('4400')?.debit, 1000);
      assert.equal(journal.get('2147')?.debit, 50);
      assert.equal(journal.get('2115')?.debit, 30);
      assert.equal(journal.get('1110')?.credit, 1080);
      assert.equal(await accountNet(pg, '2147'), 0);
      assert.equal(await accountNet(pg, '2115'), 0);
      assert.deepEqual(await ledgerEntries(db), [
        { type: 'sale_return', amount: -1080, balanceAfter: -1080 },
        { type: 'sale_return_refund', amount: 1080, balanceAfter: 0 },
      ]);
    } finally {
      await db.destroy();
    }
  }

  // Case 5 — F1 second partial: two half returns move 65 + 65,
  // relieve 5 + 10 each, land 2147/2115 at zero; a third return of
  // the same line is rejected.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { subtotal: 100, tip: 10, fee: 20, service: 12, qty: 2 });
      const { returns, posting } = makeServices(db);
      await inTx(db)((trx) => posting.postSale(trx, 1, ADMIN));
      const first = await createReturn(returns, 1, 1, ADMIN);
      const second = await createReturn(returns, 1, 1, ADMIN);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -130);
      for (const docId of [first.id, second.id]) {
        const journal = await journalBySource(pg, db, 'sales_return', docId);
        assert.equal(journal.get('4400')?.debit, 50);
        assert.equal(journal.get('2147')?.debit, 5);
        assert.equal(journal.get('2115')?.debit, 10);
        assert.equal(journal.get('1110')?.credit, 65);
      }
      assert.equal(await accountNet(pg, '2147'), 0);
      assert.equal(await accountNet(pg, '2115'), 0);
      await assert.rejects(
        createReturn(returns, 1, 1, ADMIN),
        (error: any) => error.code === 'RETURN_QTY_EXCEEDED',
      );
    } finally {
      await db.destroy();
    }
  }

  // Case 6 — F2 settleOrder: after a half return of a COD sale the
  // stale amount 122 rejects; the corrected settle collects 67,
  // credits 1130 by 77 (not 142), and lands 1130 and 2115 at zero.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCodSale(db, { saleId: 1, service: 12 });
      const { returns, posting, reps } = makeServices(db);
      await inTx(db)((trx) => posting.postSale(trx, 1, ADMIN));
      const ret = await createReturn(returns, 1, 1, ADMIN);
      const doc = await returnDoc(db, ret.id);
      const allocations = typeof doc.refund_allocations === 'string' ? JSON.parse(doc.refund_allocations) : doc.refund_allocations;
      assert.deepEqual(allocations, [{ tender: 'receivable', amount: 65 }]);
      const retJournal = await journalBySource(pg, db, 'sales_return', ret.id);
      assert.equal(retJournal.get('1130')?.credit, 65);
      assert.deepEqual(await ledgerEntries(db), [
        { type: 'sale_return', amount: -65, balanceAfter: -65 },
      ]);
      await assert.rejects(
        inTx(db)((trx) => posting.postDeliveryRepSettlement(trx, 1, 122, null, null, ADMIN)),
        (error: any) => error.code === 'DELIVERY_SETTLEMENT_INVALID',
      );
      const settled = await reps.settleOrder(1, ADMIN) as unknown as { ok: boolean };
      assert.equal(settled.ok, true);
      assert.equal(await treasurySum(db, 'cash_in'), 67);
      assert.deepEqual((await ledgerEntries(db)).map((entry) => entry.amount), [-65, -77]);
      const settleJournal = await journalBySource(pg, db, 'delivery_rep_settlement', 1);
      assert.equal(settleJournal.get('2115')?.debit, 10);
      assert.equal(settleJournal.get('1110')?.debit, 67);
      assert.equal(settleJournal.get('1130')?.credit, 77);
      assert.equal(await accountNet(pg, '1130'), 0);
      assert.equal(await accountNet(pg, '2115'), 0);
      assert.equal(await accountNet(pg, '2147'), -5);
      const sale = await db.selectFrom('sales').select('delivery_status').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal((sale as any).delivery_status, 'settled');
    } finally {
      await db.destroy();
    }
  }

  // Case 7 — F2 settleAllOrders: the stale batch total (322) throws
  // AMOUNT_MISMATCH; the corrected total (267) settles both orders.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCodSale(db, { saleId: 1, service: 12 });
      await seedCodSale(db, { saleId: 2, subtotal: 200, tip: 0, fee: 30, service: 0, qty: 1 });
      const { returns, posting, reps } = makeServices(db);
      await inTx(db)((trx) => posting.postSale(trx, 1, ADMIN));
      await inTx(db)((trx) => posting.postSale(trx, 2, ADMIN));
      await createReturn(returns, 1, 1, ADMIN);
      await assert.rejects(
        reps.settleAllOrders(7, 322, ADMIN),
        (error: any) => error.code === 'AMOUNT_MISMATCH',
      );
      const settled = await reps.settleAllOrders(7, 267, ADMIN) as unknown as { ok: boolean; settledCount: number; totalAmount: number };
      assert.equal(settled.ok, true);
      assert.equal(settled.settledCount, 2);
      assert.equal(settled.totalAmount, 267);
      assert.equal(await treasurySum(db, 'cash_in'), 267);
      const settle1 = await journalBySource(pg, db, 'delivery_rep_settlement', 1);
      assert.equal(settle1.get('1110')?.debit, 67);
      assert.equal(settle1.get('1130')?.credit, 77);
      const settle2 = await journalBySource(pg, db, 'delivery_rep_settlement', 2);
      assert.equal(settle2.get('2115')?.debit, 30);
      assert.equal(settle2.get('1110')?.debit, 200);
      assert.equal(settle2.get('1130')?.credit, 230);
      assert.equal(await accountNet(pg, '1130'), 0);
      assert.equal(await accountNet(pg, '2115'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 8a — F2 zero: a fully-returned COD sale settles with zero
  // cash, no settlement journal, no treasury row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCodSale(db, { saleId: 1, subtotal: 100, tip: 10, fee: 20, service: 0, qty: 2 });
      const { returns, posting, reps } = makeServices(db);
      await inTx(db)((trx) => posting.postSale(trx, 1, ADMIN));
      await createReturn(returns, 1, 2, ADMIN);
      const settled = await reps.settleOrder(1, ADMIN) as unknown as { ok: boolean };
      assert.equal(settled.ok, true);
      assert.equal(await treasurySum(db, 'cash_in'), 0);
      assert.equal(await journalCount(pg, db, 'delivery_rep_settlement', 1), 0);
      assert.equal(await accountNet(pg, '1130'), 0);
      const sale = await db.selectFrom('sales').select('delivery_status').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal((sale as any).delivery_status, 'settled');
    } finally {
      await db.destroy();
    }
  }

  // Case 8b — F2 store-credit edge: remaining fee (15) exceeds the
  // remaining receivable (0), so settleOrder fails closed instead
  // of silently dropping the fee.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCodSale(db, { saleId: 1, subtotal: 100, tip: 0, fee: 30, service: 0, qty: 2, storeCreditUsed: 100 });
      const { returns, posting, reps } = makeServices(db);
      await inTx(db)((trx) => posting.postSale(trx, 1, ADMIN));
      const ret = await createReturn(returns, 1, 1, ADMIN);
      const doc = await returnDoc(db, ret.id);
      const allocations = typeof doc.refund_allocations === 'string' ? JSON.parse(doc.refund_allocations) : doc.refund_allocations;
      assert.deepEqual(allocations, [{ tender: 'receivable', amount: 30 }, { tender: 'store_credit', amount: 35 }]);
      await assert.rejects(
        reps.settleOrder(1, ADMIN),
        (error: any) => error.code === 'DELIVERY_SETTLEMENT_INVALID',
      );
      const sale = await db.selectFrom('sales').select('delivery_status').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal((sale as any).delivery_status, null);
    } finally {
      await db.destroy();
    }
  }

  // Case 8c — F2 service charge: a full goods return leaves the 12
  // service charge as the remaining receivable, and it still settles.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCodSale(db, { saleId: 1, subtotal: 100, tip: 10, fee: 20, service: 12, qty: 2 });
      const { returns, posting, reps } = makeServices(db);
      await inTx(db)((trx) => posting.postSale(trx, 1, ADMIN));
      await createReturn(returns, 1, 2, ADMIN);
      const settled = await reps.settleOrder(1, ADMIN) as unknown as { ok: boolean };
      assert.equal(settled.ok, true);
      assert.equal(await treasurySum(db, 'cash_in'), 12);
      const settleJournal = await journalBySource(pg, db, 'delivery_rep_settlement', 1);
      assert.equal(settleJournal.get('1110')?.debit, 12);
      assert.equal(settleJournal.get('1130')?.credit, 12);
      assert.equal(settleJournal.get('2115'), undefined);
      assert.equal(await accountNet(pg, '1130'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 9 — F3 real exchange: the prepared return grants store
  // credit for the return total only (50); the new sale's journal
  // collects the relief (Dr 2147 5 / Dr 2115 10) and the return row
  // records it; the later plain return of the other half relieves
  // only the remaining 5 + 10.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedTippedCashSale(db, { saleId: 1, subtotal: 100, tip: 10, fee: 20, service: 12, qty: 2 });
      const { returns, posting } = makeServices(db);
      const context = await db.transaction().execute((trx) => returns.prepareExchangeReturn(trx, {
        type: 'sale', invoiceId: 1, note: 'exchange',
        items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
        settlementMode: 'refund', refundMethod: 'cash', managerPin: '2468',
      } as never, ADMIN));
      assert.equal(context.total, 50);
      assert.equal((await customerBalance(db)).storeCredit, 50);
      const prepared = await returnDoc(db, context.returnId);
      const preparedAllocations = typeof prepared.refund_allocations === 'string' ? JSON.parse(prepared.refund_allocations) : prepared.refund_allocations;
      assert.deepEqual(preparedAllocations, [{ tender: 'store_credit', amount: 50 }]);
      assert.equal(prepared.exchange_tip_relief, null);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, exchange_return_id)
        VALUES (2, 't1', 'a1', 'S-2', NULL, 'posted', 50, 50, 0, 0, 0, 50, false, 'cash', 'cash', 1, 1, ${context.returnId})`.execute(db);
      await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
        VALUES (20, 't1', 'a1', 2, 10, 'Widget', 1, 50, 50, 50, 50, 0, 0, 0, 1)`.execute(db);
      await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', 2, 'cash', 50)`.execute(db);
      const newSale = await inTx(db)((trx) => posting.postSale(trx, 2, ADMIN));
      assert.equal(newSale.posted, true);
      const recorded = await returnDoc(db, context.returnId);
      assert.equal(Number(recorded.exchange_tip_relief), 5);
      assert.equal(Number(recorded.exchange_courier_relief), 10);
      const newJournal = await journalBySource(pg, db, 'sale', 2);
      assert.equal(newJournal.get('2147')?.debit, 5);
      assert.equal(newJournal.get('2115')?.debit, 10);
      assert.equal(newJournal.get('4400')?.debit, 50);
      assert.equal(newJournal.get('2150')?.credit, 65);
      const settlement = await db.transaction().execute((trx) => returns.settleExchangeReturn(trx, context, 50, 'store_credit', ADMIN));
      assert.equal(settlement.appliedCredit, 50);
      assert.equal(settlement.refundAmount, 0);
      assert.equal((await customerBalance(db)).storeCredit, 50);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      const second = await createReturn(returns, 1, 1, ADMIN);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -65);
      const secondJournal = await journalBySource(pg, db, 'sales_return', second.id);
      assert.equal(secondJournal.get('2147')?.debit, 5);
      assert.equal(secondJournal.get('2115')?.debit, 10);
      assert.equal(secondJournal.get('1110')?.credit, 65);
      // Total relieved across both returns equals the original
      // credit (tip 10, fee 20) — never more.
      assert.equal(await accountNet(pg, '2147'), 10);
      assert.equal(await accountNet(pg, '2115'), 20);
    } finally {
      await db.destroy();
    }
  }

  // Case 10 — F3 synthetic discriminator (F5 pattern): an
  // exchange-collected 60% return (relief 6 + 12) caps a second
  // synthetic 60% return at 4 + 8 (refund 72), not a second 6 + 12.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      const { posting } = makeServices(db);
      await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
        VALUES (30, 't1', 'a1', 'S-30', NULL, 'posted', 142, 142, 0, 0, 0, 100, false, 'cash', 'cash', 1, 1, 10, 20, 'freelance_courier', 12)`.execute(db);
      await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
        VALUES (300, 't1', 'a1', 30, 10, 'Widget', 2, 50, 100, 50, 100, 0, 0, 0, 1)`.execute(db);
      const seedReturnDoc = async (returnId: number, total: number): Promise<void> => {
        await sql`INSERT INTO return_documents (id, tenant_id, account_id, doc_no, return_type, invoice_id, settlement_mode, refund_method, refund_allocations, total, branch_id, location_id, created_by)
          VALUES (${returnId}, 't1', 'a1', ${'ZR' + returnId}, 'sale', 30, '', 'cash', NULL, ${total}, 1, 1, 1)`.execute(db);
        await sql`INSERT INTO return_items (id, return_document_id, tenant_id, product_id, product_name, qty, unit_total, line_total, allocated_tax, cost_price, sale_item_id)
          VALUES (${returnId * 10}, ${returnId}, 't1', 10, 'Widget', 1, ${total}, ${total}, 0, 0, 300)`.execute(db);
      };
      await seedReturnDoc(20, 60);
      const collected: Array<{ accountId: number; debit: number; credit: number }> = [];
      const exchanged = await inTx(db)((trx) => posting.postSalesReturn(trx, 20, ADMIN, (lines) => { collected.push(...lines); }));
      assert.equal(exchanged.posted, false);
      assert.equal(exchanged.journalEntryId, null);
      assert.equal(await journalCount(pg, db, 'sales_return', 20), 0);
      const recorded = await returnDoc(db, 20);
      assert.equal(Number(recorded.exchange_tip_relief), 6);
      assert.equal(Number(recorded.exchange_courier_relief), 12);
      await seedReturnDoc(21, 60);
      const plain = await inTx(db)((trx) => posting.postSalesReturn(trx, 21, ADMIN));
      assert.equal(plain.posted, true);
      const plainJournal = await journalBySource(pg, db, 'sales_return', 21);
      assert.equal(plainJournal.get('2147')?.debit, 4);
      assert.equal(plainJournal.get('2115')?.debit, 8);
      assert.equal(plainJournal.get('1110')?.credit, 72);
    } finally {
      await db.destroy();
    }
  }

  console.log('Return payout truth tests passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
