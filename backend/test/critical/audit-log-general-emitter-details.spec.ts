/*
 * audit-log-general-emitter-details.spec.ts — INV-AUDIT-GENERAL-LOG-CONTENT (ب + ز).
 *
 * THE GAP: three emitters wrote bare sentences with no money, no category
 * and no id — 'تم تسجيل مصروف بواسطة admin', 'تمت إضافة خدمة بواسطة
 * admin', 'Created sale return by admin' — although the amount, the name
 * and the id were all in scope. And the service posting path dropped the
 * journal entry entirely: postService returns { posted, journalEntryId }
 * but createService ignored the return, so a posted service revenue
 * journal (JE #14982, 75.00 credit) and its treasury transaction (#15811)
 * left no trace in the general log.
 *
 * THE RULE: every emitter stores the amount + the category/name + the id
 * in details; the service create additionally names the journal entry
 * and the treasury transaction it really posted.
 *
 * WHAT THIS PINS, driving the REAL emitters on PGlite:
 * - createExpense(75, 'كهرباء المكتب') -> the 'تسجيل مصروف' row contains
 *   the expense id, '75.00' and the title.
 * - createService('توصيل طلبات', 75 cash) -> the 'إضافة خدمة' row contains
 *   the service id, '75.00', the name, the real JE number from the real
 *   posting engine, and the real treasury transaction id.
 * - createReturn (1 x Widget @ 100, cash refund) -> the 'إنشاء مرتجع' row
 *   contains the return id, the real document number and '100.00'.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { TreasuryService } from '../../src/modules/treasury/treasury.service';
import { ServicesService } from '../../src/modules/services/services.service';
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { migration as auditKeyMigration } from '../../src/database/migrations/2040000000293_audit_logs_idempotency_key';

const ADMIN = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;
const CASHIER = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 2, username: 'cashier', permissions: [] } as unknown as AuthContext;
const DATE = '2026-10-31T10:00:00.000Z';

function realPosting(): AccountingPostingService {
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  return new AccountingPostingService(foundation);
}

async function auditDetails(db: Kysely<Database>, action: string): Promise<string> {
  const rows = await sql<{ details: string }>`SELECT details FROM audit_logs WHERE action = ${action} ORDER BY id DESC LIMIT 1`.execute(db);
  assert.equal(rows.rows.length, 1, `one audit row for ${action}`);
  return rows.rows[0].details;
}

async function main(): Promise<void> {
  // Case A: expense emitter.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE tenants (id text PRIMARY KEY);
        INSERT INTO tenants VALUES ('t1');
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        INSERT INTO settings VALUES ('t1','currency','EGP');
        INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
        CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
        CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
        INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, allow_manual_entries) VALUES (1110,'t1','a1','1110','asset',true), (6900,'t1','a1','6900','expense',true);
        CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
        INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,6900,NULL,NULL,NULL);
        CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
        CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
        CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
        CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
        CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
        INSERT INTO branches VALUES (1, 't1', 'Main', 1);
        CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
        INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
        INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
        CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
        CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '', request_key TEXT NULL);
        CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
        CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      `);
      await auditKeyMigration.up(db as never);
      const service = new TreasuryService(db as never, new TransactionHelper(), new AuditService(db as never), realPosting());
      const result = await service.createExpense({ title: 'كهرباء المكتب', amount: 75, note: '', date: DATE, requestKey: 'expense-key-001' } as never, ADMIN);
      assert.equal(result.ok, true);
      const expense = await sql<{ id: number }>`SELECT id FROM expenses ORDER BY id DESC LIMIT 1`.execute(db);
      const expenseId = Number(expense.rows[0].id);
      const details = await auditDetails(db, 'تسجيل مصروف');
      assert.ok(details.includes(`#${expenseId}`), `expense id #${expenseId} in: ${details}`);
      assert.ok(details.includes('75.00'), `amount 75.00 in: ${details}`);
      assert.ok(details.includes('كهرباء المكتب'), `title in: ${details}`);
      console.log('expense emitter details checks passed');
    } finally {
      await db.destroy();
    }
  }

  // Case B: service create emitter + posted journal entry (ز).
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE tenants (id text PRIMARY KEY);
        INSERT INTO tenants VALUES ('t1');
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        INSERT INTO settings VALUES ('t1','currency','EGP'), ('t1','timezone','Africa/Cairo');
        INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
        CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
        INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, allow_manual_entries) VALUES (1110,'t1','a1','1110','asset',true), (4200,'t1','a1','4200','revenue',true);
        CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
        INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,6900,NULL,NULL,NULL);
        CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
        CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
        CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
        CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
        CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, code text NOT NULL DEFAULT '', is_active boolean NOT NULL DEFAULT TRUE);
        INSERT INTO branches VALUES (1, 't1', 'Main', '', true);
        CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text NOT NULL DEFAULT '', is_active boolean NOT NULL DEFAULT TRUE);
        INSERT INTO stock_locations VALUES (1, 't1', 1, 'Store', '', true);
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, password_hash text NOT NULL DEFAULT '', password_salt text NOT NULL DEFAULT '', role text NOT NULL DEFAULT 'admin', is_active boolean NOT NULL DEFAULT TRUE);
        INSERT INTO users VALUES (1, 't1', 'admin', '', '', 'admin', true);
        CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, expected_cash numeric DEFAULT 0, updated_at timestamptz);
        CREATE TABLE services (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', service_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), payment_channel TEXT NOT NULL DEFAULT 'cash', branch_id BIGINT NULL, location_id BIGINT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
        CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
        CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      `);
      await auditKeyMigration.up(db as never);
      const service = new ServicesService(db as never, new TransactionHelper(), new AuditService(db as never), {} as never, realPosting());
      const result = await service.createService(
        { service: { name: 'توصيل طلبات', amount: 75, notes: '', date: DATE, paymentChannel: 'cash' } } as never,
        ADMIN,
      );
      assert.equal(result.ok, true);
      const svc = await sql<{ id: number }>`SELECT id FROM services ORDER BY id DESC LIMIT 1`.execute(db);
      const serviceId = Number(svc.rows[0].id);
      const journal = await sql<{ id: number }>`SELECT id FROM journal_entries WHERE source_type = 'service' ORDER BY id DESC LIMIT 1`.execute(db);
      const journalEntryId = Number(journal.rows[0].id);
      assert.ok(journalEntryId > 0, 'a service journal entry was posted');
      const txn = await sql<{ id: number }>`SELECT id FROM treasury_transactions WHERE reference_type = 'service' ORDER BY id DESC LIMIT 1`.execute(db);
      const treasuryTransactionId = Number(txn.rows[0].id);
      assert.ok(treasuryTransactionId > 0, 'a cash treasury transaction was created');
      const details = await auditDetails(db, 'إضافة خدمة');
      assert.ok(details.includes(`#${serviceId}`), `service id #${serviceId} in: ${details}`);
      assert.ok(details.includes('75.00'), `amount 75.00 in: ${details}`);
      assert.ok(details.includes('توصيل طلبات'), `name in: ${details}`);
      assert.ok(details.includes(`#${journalEntryId}`), `journal entry #${journalEntryId} in: ${details}`);
      assert.ok(details.includes(`#${treasuryTransactionId}`), `treasury txn #${treasuryTransactionId} in: ${details}`);
      console.log('service emitter + journal entry details checks passed');
    } finally {
      await db.destroy();
    }
  }

  // Case C: sale return emitter.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
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
          cost_price numeric DEFAULT 0, unit_multiplier numeric DEFAULT 1, serials text, modifiers text,
          line_discount numeric(15, 3));
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
          exchange_return_id bigint,
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
      await auditKeyMigration.up(db as never);
      await sql`INSERT INTO settings VALUES ('t1', 'currency', 'EGP')`.execute(db);
      await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);
      const adminRecord = await createPasswordRecord('admin-pass');
      await sql`INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', ${adminRecord.hash}, ${adminRecord.salt}, true)`.execute(db);
      await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', '', '', true)`.execute(db);
      await sql`INSERT INTO cashier_shifts VALUES (1, 't1', 'a1', 'SHIFT-1', 2, 'open', 1, 0, NOW())`.execute(db);
      await sql`INSERT INTO products VALUES (10, 't1', 'a1', 'Widget', '', '', '', 100, 0, 10, true, false, NOW())`.execute(db);
      await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty, updated_at) VALUES ('t1', 'a1', 10, 1, 1, 100, 0, NOW())`.execute(db);
      await sql`INSERT INTO sales VALUES (1, 't1', 'a1', 'S-1', NULL, 'posted', 1000, 1000, 0, 0, 0, 1000, false, 'cash', 'cash', 1, 1, 1, NOW())`.execute(db);
      await sql`INSERT INTO sale_items VALUES (1, 't1', 'a1', 1, 10, 'Widget', 10, 100, 1000, 100, 1000, 0, 0, 10, 1, NULL)`.execute(db);
      await sql`INSERT INTO sale_payments (tenant_id, account_id, sale_id, payment_channel, amount, created_at) VALUES ('t1', 'a1', 1, 'cash', 1000, NOW())`.execute(db);

      const idempotencyStub = { check: async () => null, commitOperation: async () => undefined };
      const service = new ReturnsService(db as any, new TransactionHelper(), new AuditService(db as never), realPosting() as any, idempotencyStub as any);
      const result = await service.createReturn({
        type: 'sale', invoiceId: 1, note: 'customer changed mind',
        items: [{ productId: 10, productName: 'Widget', qty: 1, saleItemId: 1 }],
        settlementMode: 'refund', refundMethod: 'cash',
      } as never, CASHIER) as unknown as { ok: boolean };
      assert.equal(result.ok, true);
      const doc = await sql<{ id: number; doc_no: string; total: string }>`SELECT id, doc_no, total FROM return_documents ORDER BY id DESC LIMIT 1`.execute(db);
      const returnId = Number(doc.rows[0].id);
      const docNo = String(doc.rows[0].doc_no || '');
      assert.equal(Number(doc.rows[0].total), 100, 'return total is 100');
      const details = await auditDetails(db, 'إنشاء مرتجع');
      assert.ok(details.includes(`#${returnId}`), `return id #${returnId} in: ${details}`);
      assert.ok(docNo && details.includes(docNo), `doc_no ${docNo} in: ${details}`);
      assert.ok(details.includes('100.00'), `amount 100.00 in: ${details}`);
      console.log('sale return emitter details checks passed');
    } finally {
      await db.destroy();
    }
  }

  console.log('audit-log-general emitter details checks passed');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
