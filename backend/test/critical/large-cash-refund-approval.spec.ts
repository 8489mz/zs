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
New file: backend/test/critical/large-cash-refund-approval.spec.ts
Pins the spirit-of-law large-cash-refund rule (INV-SPIRIT-LARGE-CASH-REFUND).

THE GAP: a cashier without the canDirectReturn permission needed a
manager PIN/password for EVERY return, however small -- a 100-unit
cash refund waited on a manager exactly like a 10,000-unit one.

THE RULE: manager PIN/password approval is required only for a LARGE
cash refund: the cash tender of the return's refund allocation at or
above the posLargeCashRefundThreshold setting (coordinator-chosen
default 500 tenant currency units, owner-set). Smaller cash refunds,
card refunds and store-credit returns proceed with the recorded
reason and no approval credential. The refund-override path still
always needs manager approval, and the exchange gate is unchanged.
The cash-refund own-shift rule is deliberately unchanged: cash still
leaves an attributed open shift.

WHAT THIS PINS, driving the REAL ReturnsService on PGlite (fresh
database per case; audit + idempotency stubbed, tenant foundation
stubbed as in the purchase-return specs):
- a 100-unit cash refund by a cashier with no credential succeeds.
- a 600-unit cash refund by a cashier with no credential is rejected
  with MANAGER_AUTH_REQUIRED and posts nothing; the same refund
  succeeds with the manager PIN, and an equivalent refund succeeds
  with the admin password.
- a 500-unit cash refund (exactly at the default threshold) needs
  approval.
- with posLargeCashRefundThreshold set to 700, a 600-unit cash
  refund by a cashier with no credential succeeds.
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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text,
      barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0,
      is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint, tenant_id text, balance numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint,
      points_change numeric, balance_after numeric, reason text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint, tenant_id text, balance numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text,
      amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint,
      return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint);
    CREATE TABLE supplier_payment_schedules (id bigint PRIMARY KEY, tenant_id text, purchase_id bigint, paid_amount numeric DEFAULT 0);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint,
      payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric, paid_amount numeric DEFAULT 0,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted',
      prices_include_tax boolean DEFAULT false, tax_rate numeric DEFAULT 0);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint,
      qty numeric, unit_cost numeric, unit_multiplier numeric DEFAULT 1, line_total numeric,
      location_id bigint, batch_number text, grn_line_id bigint, grni_amount numeric);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint,
      status text, total numeric, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0,
      discount numeric DEFAULT 0, tax_amount numeric DEFAULT 0, subtotal numeric DEFAULT 0,
      prices_include_tax boolean DEFAULT false, payment_type text, payment_channel text,
      branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01',
      exchange_return_id bigint, tip_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0,
      delivery_fee_mode text, service_charge numeric DEFAULT 0);
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
      exchange_return_id bigint, exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3),
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
      opened_by bigint, status text, branch_id bigint, expected_cash numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE damaged_stock_records (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      branch_id bigint, location_id bigint, qty numeric, reason text, note text, created_by bigint,
      unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text,
      created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    INSERT INTO accounting_settings VALUES
      (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
  `);
  for (const code of [1110, 1120, 1130, 1140, 1150, 2110, 2120, 4100, 4300, 5100, 5190, 5200, 5300, 7100]) {
    await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,is_tax) VALUES ($1,$2,$3,$4)',
      [code, 't1', String(code), code === 1150 || code === 2120]);
  }
  return { pg, db };
}

function makeServices(db: Kysely<Database>): ReturnsService {
  const foundation = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined, logWithExecutor: async () => undefined };
  const idempotencyStub = { check: async () => null, commitOperation: async () => undefined };
  return new ReturnsService(db as any, new TransactionHelper(), auditStub as any, posting as any, idempotencyStub as any);
}

async function seedSaleFixture(db: Kysely<Database>, opts: { threshold?: number }): Promise<void> {
  await sql`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`.execute(db);
  await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);
  if (opts.threshold !== undefined) {
    await sql`INSERT INTO settings VALUES ('t1', 'posLargeCashRefundThreshold', ${JSON.stringify(opts.threshold)})`.execute(db);
  }
  const adminRecord = await createPasswordRecord('admin-pass');
  await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', ${adminRecord.hash}, ${adminRecord.salt}, true)`.execute(db);
  await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true)`.execute(db);
  await sql`INSERT INTO cashier_shifts VALUES (1, 't1', 'a1', 'SHIFT-1', 2, 'open', 1, 0, NOW())`.execute(db);
  await sql`INSERT INTO products VALUES (10, 't1', 'a1', 'Widget', '', '', '', 100, 0, 10, true, false, NOW())`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty, updated_at) VALUES ('t1', 'a1', 10, 1, 1, 100, 0, NOW())`.execute(db);
  await sql`INSERT INTO sales VALUES (1, 't1', 'a1', 'S-1', NULL, 'posted', 1000, 1000, 0, 0, 0, 1000, false, 'cash', 'cash', 1, 1, 1, NOW())`.execute(db);
  await sql`INSERT INTO sale_items VALUES (1, 't1', 'a1', 1, 10, 'Widget', 10, 100, 1000, 100, 1000, 0, 0, 10, 1, NULL)`.execute(db);
  await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount, created_at) VALUES ('t1', 'a1', 1, 'cash', 1000, NOW())`.execute(db);
}

async function returnCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM return_documents`.execute(db);
  return Number(row.rows[0].n);
}

async function main(): Promise<void> {
  // Case 1: a small (100) cash refund by a cashier with no credential succeeds.
  {
    const { pg, db } = await makeDb();
    try {
      await seedSaleFixture(db, {});
      const svc = makeServices(db);
      const result = await svc.createReturn({
        type: 'sale', invoiceId: 1, note: 'customer changed mind',
        items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 1 }],
        settlementMode: 'refund', refundMethod: 'cash',
      } as never, CASHIER) as unknown as { ok: boolean };
      assert.equal(result.ok, true);
      assert.equal(await returnCount(db), 1);
      const treasury = await sql<{ amount: string }>`SELECT amount FROM treasury_transactions WHERE txn_type = 'sale_return_refund'`.execute(db);
      assert.equal(Number(treasury.rows[0].amount), -100);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a large (600) cash refund with no credential is rejected and
  // posts nothing; the manager PIN approves it.
  {
    const { pg, db } = await makeDb();
    try {
      await seedSaleFixture(db, {});
      const svc = makeServices(db);
      await assert.rejects(
        svc.createReturn({
          type: 'sale', invoiceId: 1, note: 'bulk return',
          items: [{ productId: 10, productName: 'Widget', qty: 6, saleItemId: 1 }],
          settlementMode: 'refund', refundMethod: 'cash',
        } as never, CASHIER),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      assert.equal(await returnCount(db), 0);
      const result = await svc.createReturn({
        type: 'sale', invoiceId: 1, note: 'bulk return', managerPin: '2468',
        items: [{ productId: 10, productName: 'Widget', qty: 6, saleItemId: 1 }],
        settlementMode: 'refund', refundMethod: 'cash',
      } as never, CASHIER) as unknown as { ok: boolean };
      assert.equal(result.ok, true);
      assert.equal(await returnCount(db), 1);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: the same large refund succeeds with the admin password.
  {
    const { pg, db } = await makeDb();
    try {
      await seedSaleFixture(db, {});
      const svc = makeServices(db);
      const result = await svc.createReturn({
        type: 'sale', invoiceId: 1, note: 'bulk return', managerPin: 'admin-pass',
        items: [{ productId: 10, productName: 'Widget', qty: 6, saleItemId: 1 }],
        settlementMode: 'refund', refundMethod: 'cash',
      } as never, CASHIER) as unknown as { ok: boolean };
      assert.equal(result.ok, true);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: exactly at the default threshold (500) still needs approval.
  {
    const { pg, db } = await makeDb();
    try {
      await seedSaleFixture(db, {});
      const svc = makeServices(db);
      await assert.rejects(
        svc.createReturn({
          type: 'sale', invoiceId: 1, note: 'at threshold',
          items: [{ productId: 10, productName: 'Widget', qty: 5, saleItemId: 1 }],
          settlementMode: 'refund', refundMethod: 'cash',
        } as never, CASHIER),
        (error: any) => error.code === 'MANAGER_AUTH_REQUIRED',
      );
      assert.equal(await returnCount(db), 0);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: with the threshold raised to 700, a 600 refund needs no credential.
  {
    const { pg, db } = await makeDb();
    try {
      await seedSaleFixture(db, { threshold: 700 });
      const svc = makeServices(db);
      const result = await svc.createReturn({
        type: 'sale', invoiceId: 1, note: 'below raised threshold',
        items: [{ productId: 10, productName: 'Widget', qty: 6, saleItemId: 1 }],
        settlementMode: 'refund', refundMethod: 'cash',
      } as never, CASHIER) as unknown as { ok: boolean };
      assert.equal(result.ok, true);
      assert.equal(await returnCount(db), 1);
    } finally {
      await db.destroy();
    }
  }

  console.log('large cash refund approval checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
