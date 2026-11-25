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
New file: backend/test/critical/cash-return-approval-threshold.spec.ts
Pins INV-CASH-RETURN-APPROVAL-DUPLICATE-REPRINT (approval half):
the large-cash-refund threshold gate applies ALSO to a cashier
holding `canDirectReturn`. Before the fix, `createReturn` built
its approval request only when `!isPrivileged`, and `isPrivileged`
included the permission — so a privileged cashier refunded
UNLIMITED cash with no manager approval at all (live trial:
cashier cash2 returned ZR-261115-0614, 70.00 EGP, with no
supervisor approval — and a 600.00 return would have sailed
through the same way). The fix builds the approval request for
everyone except the admin/super_admin roles, so the threshold
check inside createSaleReturn fires for privileged cashiers too.

WHAT THIS PINS, driving the REAL ReturnsService on PGlite (fresh
database per case; audit + idempotency stubbed, tenant foundation
stubbed as in the sale-return-cash-only spec, whose schema this
reuses). The threshold is the default 500 (no
posLargeCashRefundThreshold setting seeded); the manager PIN is
'2468', as seeded; the privileged cashier holds canDirectReturn
and an open shift of their own:
- Case 1: privileged cashier, SMALL cash return (70 < 500)
  proceeds WITHOUT approval — the generous cashier default for
  small returns is preserved (INV-SPIRIT-LARGE-CASH-REFUND).
- Case 2: privileged cashier, LARGE cash return (600 >= 500),
  NO PIN — refused MANAGER_AUTH_REQUIRED, nothing posted.
- Case 3: privileged cashier, LARGE cash return (600), WITH the
  manager PIN — approved, the full 600 refunds in cash.
- Case 4: boundary — privileged cashier, cash return of EXACTLY
  500, NO PIN — refused (>= threshold needs approval).
- Case 5: non-privileged cashier, SMALL return (70), NO PIN —
  unchanged, proceeds without approval.
- Case 6: non-privileged cashier, LARGE return (600) — unchanged:
  refused without a PIN, approved with it.
- Case 7: admin, LARGE return (600), NO PIN — the
  admin/super_admin bypass is preserved; the gate binds
  canDirectReturn holders, not the admin role itself.

NOTE on scope: the reprint half of the package (a duplicate mark
on reprinted receipts) is frontend-only — an `isReprint` option
threaded through printPostedSaleReceipt into the receipt
template and the hardware formatter — and cannot be driven from
this backend spec. It is covered by CI (frontend typecheck +
guards), not by a spec here.
*/

const ADMIN = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: [],
} as unknown as AuthContext;
const CASHIER = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'cashier',
  userId: 2,
  username: 'cashier',
  permissions: [],
} as unknown as AuthContext;
const PRIVILEGED_CASHIER = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'cashier',
  userId: 2,
  username: 'cash2',
  permissions: ['canDirectReturn'],
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
  await sql`INSERT INTO cashier_shifts VALUES (2, 't1', 'a1', 'SHIFT-2', 2, 'open', 1, 1, 0, NOW())`.execute(db);
  await sql`INSERT INTO products VALUES (10, 't1', 'a1', 'Widget', '', '', '', 100, 0, 10, true, false, NOW())`.execute(
    db,
  );
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty, updated_at) VALUES ('t1', 'a1', 10, 1, 1, 100, 0, NOW())`.execute(
    db,
  );
  await sql`INSERT INTO customers VALUES (25, 't1', 'Cash customer', 0, 0, 0, 0, false, NOW())`.execute(db);
}

/* One unit at `total`, paid wholly in cash, no tip / fee / service,
   so a full return refunds exactly `total` in a single cash leg. */
async function seedCashSale(db: Kysely<Database>, total: number): Promise<number> {
  await sql`INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, status, total, paid_amount, store_credit_used, discount, tax_amount, subtotal, prices_include_tax, payment_type, payment_channel, branch_id, location_id, tip_amount, delivery_fee, delivery_fee_mode, service_charge)
    VALUES (1, 't1', 'a1', 'S-1', 25, 'posted', ${total}, ${total}, 0, 0, 0, ${total}, false, 'cash', 'cash', 1, 1, 0, 0, NULL, 0)`.execute(
    db,
  );
  await sql`INSERT INTO sale_items (id, tenant_id, account_id, sale_id, product_id, product_name, qty, unit_price, line_total, net_unit_price, net_line_total, allocated_discount, allocated_tax, cost_price, unit_multiplier)
    VALUES (10, 't1', 'a1', 1, 10, 'Widget', 1, ${total}, ${total}, ${total}, ${total}, 0, 0, 0, 1)`.execute(db);
  await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount) VALUES ('t1', 'a1', 1, 'cash', ${total})`.execute(
    db,
  );
  return 1;
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
  auth: AuthContext,
  managerPin?: string,
): Promise<Record<string, unknown>> {
  const result = (await returns.createReturn(
    {
      type: 'sale',
      invoiceId: saleId,
      note: 'spec return',
      items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 10 }],
      settlementMode: 'refund',
      refundMethod: 'cash',
      ...(managerPin ? { managerPin } : {}),
    } as never,
    auth,
  )) as unknown as Record<string, unknown>;
  assert.equal(result.ok, true);
  assert.equal(result.refundTotal, unitPrice);
  return result;
}

async function returnCount(db: Kysely<Database>): Promise<number> {
  const count = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM return_documents`.execute(db);
  return Number(count.rows[0].n);
}

async function main(): Promise<void> {
  // Case 1 — privileged cashier (canDirectReturn), SMALL cash
  // return: the live-trial 70.00 return still proceeds WITHOUT any
  // approval — small returns keep the generous cashier default.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCashSale(db, 70);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 70, PRIVILEGED_CASHIER);
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 70 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -70);
      const journal = await journalBySource(pg, db, 'sales_return', Number(result.id));
      assert.equal(journal.get('1110')?.credit, 70);
    } finally {
      await db.destroy();
    }
  }

  // Case 2 — privileged cashier, LARGE cash return (600 >= 500
  // default threshold), NO manager PIN: refused with
  // MANAGER_AUTH_REQUIRED and nothing is posted — this is the
  // hole: before the fix the privileged actor skipped approval
  // entirely and the 600 left the drawer unchecked.
  {
    const { db } = await makeDb();
    try {
      await seedBase(db);
      await seedCashSale(db, 600);
      const returns = makeServices(db);
      await assert.rejects(
        createFullReturn(returns, 1, 600, PRIVILEGED_CASHIER),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      assert.equal(await returnCount(db), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 3 — privileged cashier, LARGE cash return (600), WITH
  // the manager PIN: approved, the full 600 refunds in cash.
  {
    const { pg, db } = await makeDb();
    try {
      await seedBase(db);
      await seedCashSale(db, 600);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 600, PRIVILEGED_CASHIER, '2468');
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 600 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -600);
      const journal = await journalBySource(pg, db, 'sales_return', Number(result.id));
      assert.equal(journal.get('1110')?.credit, 600);
    } finally {
      await db.destroy();
    }
  }

  // Case 4 — boundary: privileged cashier, cash return of EXACTLY
  // the 500 threshold, NO manager PIN: refused (>= threshold
  // needs approval, not only above it).
  {
    const { db } = await makeDb();
    try {
      await seedBase(db);
      await seedCashSale(db, 500);
      const returns = makeServices(db);
      await assert.rejects(
        createFullReturn(returns, 1, 500, PRIVILEGED_CASHIER),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      assert.equal(await returnCount(db), 0);
      assert.equal(await treasurySum(db, 'sale_return_refund'), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 5 — non-privileged cashier, SMALL cash return (70), NO
  // PIN: unchanged — proceeds without approval, as before.
  {
    const { db } = await makeDb();
    try {
      await seedBase(db);
      await seedCashSale(db, 70);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 70, CASHIER);
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 70 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -70);
    } finally {
      await db.destroy();
    }
  }

  // Case 6 — non-privileged cashier, LARGE cash return (600):
  // unchanged — refused without a PIN, approved with it.
  {
    const { db } = await makeDb();
    try {
      await seedBase(db);
      await seedCashSale(db, 600);
      const returns = makeServices(db);
      await assert.rejects(
        createFullReturn(returns, 1, 600, CASHIER),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      assert.equal(await returnCount(db), 0);
      const result = await createFullReturn(returns, 1, 600, CASHIER, '2468');
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 600 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -600);
    } finally {
      await db.destroy();
    }
  }

  // Case 7 — admin, LARGE cash return (600), NO PIN: the
  // admin/super_admin bypass is preserved — the gate binds
  // canDirectReturn holders, not the admin role itself.
  {
    const { db } = await makeDb();
    try {
      await seedBase(db);
      await seedCashSale(db, 600);
      const returns = makeServices(db);
      const result = await createFullReturn(returns, 1, 600, ADMIN);
      assert.equal(result.refundMethod, 'cash');
      assert.deepEqual(parseAllocations(result.refundAllocations), [{ tender: 'cash', amount: 600 }]);
      assert.equal(await treasurySum(db, 'sale_return_refund'), -600);
    } finally {
      await db.destroy();
    }
  }

  console.log('Cash-return approval-threshold tests passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
