import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { VanReturnsService } from '../../src/modules/delivery-reps/services/van-returns.service';

/*
 * Van eligible-sales payment type (INV-VAN-RETURN-REFUND-METHOD-DEFAULT).
 *
 * THE GAP: the return form hardcoded refundMethod to 'credit'
 * (VanCollectionTab.tsx:88), so a return against a CASH invoice
 * defaulted to a credit settlement — and the server refused it:
 * "المرتجع كائتمان (144) يتجاوز المديونية المتبقية (0)" (live trial
 * test10k 2026-11-13, VRET-261113-0001 against cash invoice
 * VAN-261113-0002). The rep had to notice and switch manually.
 * The data was already in the database: getCustomerEligibleSales
 * never selected s.payment_type, and the frontend
 * CustomerEligibleSale type had no paymentType field, so the form
 * could not know.
 *
 * THE RULE: the eligible-sales select carries the sale's payment
 * type (s.payment_type as paymentType, '' when null/legacy) and the
 * form defaults refundMethod from the picked sale — 'credit' for a
 * credit sale, 'cash' for any other method (cash, card, split,
 * instapay, vodafone_cash, unknown). The manual override stays:
 * the default is set only at pick time. The server-side
 * assertRefundMethodCoveredByLegs still validates the chosen method
 * against the sale's legs at submit.
 *
 * HARNESS: the real VanReturnsService on PGlite, same DDL as
 * van-field-return-carton-qty.spec.ts (sales carries payment_type).
 * No posting is driven here — getCustomerEligibleSales only reads.
 *
 * WHAT THIS PINS, driving the REAL getCustomerEligibleSales:
 * - Case 1: a cash sale returns paymentType 'cash'; a credit sale
 *   returns paymentType 'credit'.
 * - Case 2: a sale with payment_type NULL (legacy) returns
 *   paymentType '' — the frontend treats any non-'credit' as cash.
 */

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, allow_manual_entries boolean, is_control_account boolean, is_receivable boolean, is_payable boolean, is_inventory boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint, subtotal numeric, discount numeric, tax_amount numeric, total numeric, paid_amount numeric, store_credit_used numeric, exchange_return_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, delivery_fee numeric, delivery_fee_mode text, service_charge numeric, tip_amount numeric, prices_include_tax boolean, sale_origin text, payment_type text, collection_status text, status text, delivery_rep_id bigint, van_trip_id bigint);
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, tenant_id text, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, unit_multiplier numeric, unit_name text, modifiers jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, tenant_id text, payment_channel text, amount numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, balance numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, branch_id bigint, location_type text, is_active boolean);
    CREATE TABLE van_sales_trips (id bigint PRIMARY KEY, tenant_id text, account_id text, status text, van_location_id bigint, source_warehouse_id bigint, rep_id bigint, cash_collected numeric, cash_refunds numeric, returns_amount numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_field_returns (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric, items_json text, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await db.insertInto('settings' as never).values({ tenant_id: 't1', key: 'currency', value: `"${code}"` } as never).execute();
  await db.insertInto('currency_exchange_rates' as never).values({ tenant_id: 't1', currency_code: code, exchange_rate: 1, is_base: true } as never).execute();
}

function makeServices(db: Kysely<Database>): { returns: VanReturnsService } {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  const returns = new VanReturnsService(db as any, posting);
  return { returns };
}

async function seedSale(
  db: Kysely<Database>,
  opts: { id: number; docNo: string; paymentType: string | null; total: number },
): Promise<void> {
  await db.insertInto('sales' as never).values({
    id: opts.id, tenant_id: 't1', doc_no: opts.docNo, customer_id: 5, subtotal: opts.total,
    discount: 0, tax_amount: 0, total: opts.total, paid_amount: 0, store_credit_used: 0,
    exchange_return_id: null, branch_id: null, location_id: null, created_by: 1, created_at: new Date(),
    delivery_fee: 0, delivery_fee_mode: null, service_charge: 0, tip_amount: 0, prices_include_tax: false,
    sale_origin: 'van', payment_type: opts.paymentType, collection_status: 'paid', status: 'posted',
    delivery_rep_id: null, van_trip_id: null,
  } as never).execute();
  await db.insertInto('sale_items' as never).values({
    id: 10 + opts.id, sale_id: opts.id, tenant_id: 't1', product_id: 100, product_name: 'Widget', qty: 2,
    unit_price: opts.total / 2, line_total: opts.total, cost_price: 96, unit_multiplier: 12, unit_name: 'كرتونة', modifiers: JSON.stringify([]),
  } as never).execute();
}

async function main(): Promise<void> {
  // Case 1: cash sale -> 'cash', credit sale -> 'credit'.
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedCurrency(db, 'EGP');
      await db.insertInto('products' as never).values({
        id: 100, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: 46, reserved_qty: 0, cost_price: 8,
      } as never).execute();
      await db.insertInto('customers' as never).values({
        id: 5, tenant_id: 't1', account_id: 'a1', name: 'Shop', balance: 0,
      } as never).execute();
      await seedSale(db, { id: 1, docNo: 'VAN-261113-0002', paymentType: 'cash', total: 288 });
      await seedSale(db, { id: 2, docNo: 'VAN-261113-0003', paymentType: 'credit', total: 288 });

      const sales = await returns.getCustomerEligibleSales('t1', 5);
      assert.equal(sales.length, 2, 'both posted sales are eligible');
      const byId = new Map(sales.map((s: any) => [s.id, s]));
      assert.equal((byId.get(1) as any).paymentType, 'cash', 'cash sale carries paymentType cash');
      assert.equal((byId.get(2) as any).paymentType, 'credit', 'credit sale carries paymentType credit');
      console.log('case 1 passed: cash -> cash, credit -> credit');
    } finally {
      await pg.close();
    }
  }

  // Case 2: payment_type NULL (legacy) -> '' (frontend treats any
  // non-'credit' as cash).
  {
    const { pg, db } = await makeDb();
    try {
      const { returns } = makeServices(db);
      await seedCurrency(db, 'EGP');
      await db.insertInto('products' as never).values({
        id: 100, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: 46, reserved_qty: 0, cost_price: 8,
      } as never).execute();
      await db.insertInto('customers' as never).values({
        id: 5, tenant_id: 't1', account_id: 'a1', name: 'Shop', balance: 0,
      } as never).execute();
      await seedSale(db, { id: 1, docNo: 'VAN-261113-0004', paymentType: null, total: 72 });

      const sales = await returns.getCustomerEligibleSales('t1', 5);
      assert.equal(sales.length, 1, 'the legacy sale is eligible');
      assert.equal((sales[0] as any).paymentType, '', 'null payment_type surfaces as empty string');
      console.log('case 2 passed: null payment_type -> empty string');
    } finally {
      await pg.close();
    }
  }

  console.log('van-eligible-sales-payment-type checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
