import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

/*
New file: backend/test/critical/sale-return-cash-only.spec.ts
Pins INV-SALE-RETURN-CASH-ONLY: EVERY sale return refunds the FULL
amount in CASH from the drawer, never back to the card — regardless
of how the original purchase was paid. There is NO shop mechanism
to refund to Visa at all; the card money stays in the shop's bank
account, and recording a card leg would just move the error from
the drawer to the bank. The alternative to a cash refund is
EXCHANGE (store credit), never a card reversal. There is no
by-method toggle anywhere in the refund flow: the backend ignores
a requested refundMethod 'card' and the form offers cash only.

THE DEFECT (proven in the live trial, tenant muse2, 2026-11-15):
invoice Z-261115-16457 was 35.00 cash + 35.00 card (split payment).
Its full return ZR-261115-0614 was recorded as a 70.00 CASH refund,
but the books posted only 35.00 cash out — the old allocation rule
split the refund by original method (35 cash + 35 card reversal),
so the close showed a -35.00 "shortage" that was the SYSTEM's
error, not the cashier's; the declared 8,403.48 was the correct
drawer cash. The form was RIGHT (70.00 cash) and the books were
wrong. The fix: the refund allocation is a single cash leg for the
full refund (journal 1110 Cr 70, 1120 Cr 0, treasury -70).

WHAT THIS PINS, driving the REAL ReturnsService on PGlite (fresh
database per case; audit + idempotency stubbed, tenant foundation
stubbed as in the returns-payout-truth spec, whose schema this
reuses):
- Case 1: a full return of a 35 cash + 35 card sale (70 total, no
  tip/fee) carries refundMethod 'cash' and refundAllocations
  [{cash 70}] in the create response and on the stored document;
  treasury moves -70; the return journal credits 1110 by 70 and
  credits 1120 by nothing (no 1120 line at all).
- Case 2: a full return of a card-only sale (299.70, recorded 'by
  card' as ZR-261115-0616) also refunds in full in cash —
  [{cash 299.70}], no card leg anywhere — and the reads the dialog
  renders from (listReturns, getReturnById) carry the same cash
  allocation and refundMethod 'cash'.
- Case 3: the backend ignores a requested refundMethod 'card'
  (sent for the split sale) — the return still refunds the full
  70.00 in cash.
- Case 4: a return of an unpaid credit sale still reverses the
  receivable only ([{receivable 100}], journal 1130 Cr 100) —
  no cash is handed for goods never paid for; treasury moves 0.
*/

const ADMIN = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: [],
} as unknown as AuthContext;

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
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, doc_no text, supplier_id bigint);
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
    CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text,
      sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
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
    CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL,
      unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150),
      status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL,
      updated_at timestamptz DEFAULT NOW() NOT NULL);
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
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,account_id,code) VALUES ($1,$2,$3,$4)', [
      code,
      't1',
      'a1',
      String(code),
    ]);
  }
  return { pg, db };
}

function makeServices(db: Kysely<Database>): ReturnsService {
  const foundation = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined, logWithExecutor: async () => undefined };
  const idempotencyStub = { check: async () => null, commitOperation: async () => undefined };
  return new ReturnsService(
    db as any,
    new TransactionHelper(),
    auditStub as any,
    posting as any,
    idempotencyStub as any,
  );
}

async function seedBase(db: Kysely<Database>): Promise<void> {
  await sql`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`.execute(db);
  await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);
  const adminRecord = await createPasswordRecord('admin-pass');
  await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', ${adminRecord.hash}, ${adminRecord.salt}, true)`.execute(
    db,
  );
  await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true)`.execute(db);
  await sql`INSERT INTO cashier_shifts VALUES (1, 't1', 'a1', 'SHIFT-1', 1, 'open', 1, 1, 0, NOW())`.execute(db);
  await sql`INSERT INTO products VALUES (10, 't1', 'a1', 'Widget', '', '', '', 100, 0, 10, true, false, NOW())`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty, updated_at) VALUES ('t1', 'a1', 10, 1, 1, 100, 0, NOW())`.execute(
    db,
  );
  await sql`INSERT INTO customers VALUES (25, 't1', 'Cash customer', 0, 0, 0, 0, false, NOW())`.execute(db);
}

/* The live-trial shape: one unit at 70, paid 35 cash + 35 card,
   no tip / fee / service, so the full return refunds exactly 70. */
async function seedSplitSale(db: Kysely<Database>): Promise<number> {
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (1, 't1', 'a1', 'S-1', 25, 'posted', 70, 70, 0, 0, 0, 70, false, 'cash', 'cash', 1, 1, 0, 0, NULL, 0)`.execute(
    db,
  );
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
    VALUES (10, 't1', 'a1', 1, 10, 'Widget', 1, 70, 70, 70, 70, 0, 0, 0, 1)`.execute(db);
  await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', 1, 'cash', 35)`.execute(
    db,
  );
  await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', 1, 'card', 35)`.execute(
    db,
  );
  return 1;
}

/* The card-only trial shape (ZR-261115-0616): one unit at 299.70,
   paid wholly by card — its return must still be cash in full. */
async function seedCardSale(db: Kysely<Database>): Promise<number> {
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (1, 't1', 'a1', 'S-1', 25, 'posted', 299.70, 299.70, 0, 0, 0, 299.70, false, 'cash', 'card', 1, 1, 0, 0, NULL, 0)`.execute(
    db,
  );
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
    VALUES (10, 't1', 'a1', 1, 10, 'Widget', 1, 299.70, 299.70, 299.70, 299.70, 0, 0, 0, 1)`.execute(db);
  await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', 1, 'card', 299.70)`.execute(
    db,
  );
  return 1;
}

/* An unpaid credit sale: one unit at 100, nothing paid, the whole
   100 still owed — its return reverses the receivable, no cash. */
async function seedCreditSale(db: Kysely<Database>): Promise<number> {
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (1, 't1', 'a1', 'S-1', 25, 'posted', 100, 0, 0, 0, 0, 100, false, 'credit', 'credit', 1, 1, 0, 0, NULL, 0)`.execute(
    db,
  );
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
    VALUES (10, 't1', 'a1', 1, 10, 'Widget', 1, 100, 100, 100, 100, 0, 0, 0, 1)`.execute(db);
  return 1;
}

async function returnDoc(db: Kysely<Database>, id: number): Promise<any> {
  return db.selectFrom('return_documents').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

function parseAllocations(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function treasurySum(db: Kysely<Database>, txnType: string): Promise<number> {
  const row = await sql<{
    s: string;
  }>`SELECT COALESCE(SUM(amount), 0) AS s FROM treasury_transactions WHERE txn_type = ${txnType}`.execute(db);
  return Number(row.rows[0].s);
}

async function journalBySource(
  pg: PGlite,
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<Map<string, { debit: number; credit: number }>> {
  const entries = (await (db as any)
    .selectFrom('journal_entries')
    .select('id')
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .execute()) as Array<{ id: number }>;
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
  const rows = await pg.query<{ code: string; debit: string; credit: string }>(
    `SELECT a.code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1`,
    [Number(entries[0].id)],
  );
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const row of rows.rows) byCode.set(row.code, { debit: Number(row.debit), credit: Number(row.credit) });
  return byCode;
}

async function createFullReturn(
  returns: ReturnsService,
  saleId: number,
  unitPrice: number,
  refundMethod: 'cash' | 'card',
): Promise<Record<string, unknown>> {
  const result = (await returns.createReturn(
    {
      type: 'sale',
      invoiceId: saleId,
      note: 'spec return',
      items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
      settlementMode: 'refund',
      refundMethod,
    } as never,
    ADMIN,
  )) as unknown as Record<string, unknown>;
  assert.equal(result.ok, true);
  assert.equal(result.refundTotal, unitPrice);
  return result;
}

async function main(): Promise<void> {
  // Case 1 — split-paid sale (35 cash + 35 card), full return:
  // ONE cash leg for the full 70; the journal credits cash 1110
  // by 70 and bank 1120 by nothing; treasury moves -70.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedSplitSale(db);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 70, 'cash');
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 70 }]);
      const doc = await returnDoc(db, Number(result.id));
      assert.equal(doc.refund_method, 'cash');
      assert.deepEqual(parseAllocations(doc.refund_allocations), [{ tender: 'cash', amount: 70 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -70);
      const journal = await journalBySource(pg, db, 'sales_return', Number(result.id));
      assert.equal(journal.get('4400')?.debit, 70);
      assert.equal(journal.get('1110')?.credit, 70);
      assert.equal(journal.get('1120'), undefined, 'no bank leg: the card money stays in the shop bank account');
    } finally {
      await db.destroy();
    }
  }

  // Case 2 — card-only sale (299.70), full return: cash in full
  // too, no card leg anywhere; the reads the dialog renders from
  // carry the same cash allocation and refundMethod 'cash'.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCardSale(db);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 299.7, 'cash');
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 299.7 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -299.7);
      const journal = await journalBySource(pg, db, 'sales_return', Number(result.id));
      assert.equal(journal.get('4400')?.debit, 299.7);
      assert.equal(journal.get('1110')?.credit, 299.7);
      assert.equal(journal.get('1120'), undefined, 'no bank leg on a card-only return either');
      const listed = (await returns.listReturns({}, ADMIN)) as unknown as { returns: Array<Record<string, unknown>> };
      const row = listed.returns.find((entry) => String(entry.id) === String(result.id));
      assert.ok(row, 'created return must appear in listReturns');
      assert.equal(row.refundMethod, 'cash');
      assert.deepEqual(parseAllocations((row as Record<string, unknown>).refundAllocations), [
        { tender: 'cash', amount: 299.7 },
      ]);
      const detail = (await returns.getReturnById(Number(result.id), ADMIN)) as unknown as {
        returnDocument: Record<string, unknown>;
      };
      assert.equal(detail.returnDocument.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(detail.returnDocument.refundAllocations), [{ tender: 'cash', amount: 299.7 }]);
      assert.equal(detail.returnDocument.refundTotal, 299.7);
    } finally {
      await db.destroy();
    }
  }

  // Case 3 — the backend ignores a requested refundMethod 'card':
  // the split sale still refunds the full 70.00 in cash.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedSplitSale(db);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 70, 'card');
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 70 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -70);
      const journal = await journalBySource(pg, db, 'sales_return', Number(result.id));
      assert.equal(journal.get('1110')?.credit, 70);
      assert.equal(journal.get('1120'), undefined);
    } finally {
      await db.destroy();
    }
  }

  // Case 4 — unpaid credit sale: the return reverses the
  // receivable only ([{receivable 100}], journal 1130 Cr 100) —
  // no cash is handed for goods never paid for; treasury moves 0.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCreditSale(db);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 100, 'cash');
      assert.equal(result.refundMethod, 'receivable');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'receivable', amount: 100 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
      const journal = await journalBySource(pg, db, 'sales_return', Number(result.id));
      assert.equal(journal.get('4400')?.debit, 100);
      assert.equal(journal.get('1130')?.credit, 100);
      assert.equal(journal.get('1110'), undefined, 'no cash leg on an unpaid return');
      assert.equal(journal.get('1120'), undefined);
    } finally {
      await db.destroy();
    }
  }

  console.log('Sale-return cash-only tests passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
