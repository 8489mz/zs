/*
 * Container-deposit account 1180 seed (INV-IMPORT-CONTAINER-DEPOSIT-ROLE-ACCOUNT,
 * I8-D). Migration 0307 seeds one 1180 row — "تأمينات الحاويات المستردة" /
 * "Container Deposits", asset, parent 1100, group 'current_assets', no role
 * flag — for every tenant that already has a chart, and the same row joins
 * DEFAULT_SEED_ACCOUNTS so brand-new tenants get it too. Grounding, read
 * from the live code before this spec was written:
 * - resolveTenantAccount('container_deposit') looks for 1180 FIRST
 *   (candidates ['1180', '1182', '1240']) and rejects any cash/bank,
 *   inventory or payable account and codes 1110/1120/1140/1100 — so the
 *   seeded row must be a plain asset with all flags false, or the resolver
 *   still fail-closes. 1180 is the code the existing deposit spec already
 *   pins (import-container-deposit.spec.ts: JE Dr 1180 / Cr 1120); no name
 *   or definition for 1182/1240 exists anywhere in the repo, so neither
 *   is seeded.
 * - Live re-test 6(a) (deployed 4d811676): a valid 100 EGP deposit was
 *   rejected with "تعذر تحديد حساب محاسبي نشط ومصنف لدور
 *   (container_deposit)…" — 0 deposits / 0.00, no JE — because the
 *   seeded chart has no 1180/1182/1240 row. The D8 payload/validation
 *   fix already works (re-test 6(b) PASS); the missing account is the
 *   only remaining blocker.
 * - The old seed file 20260529000300 is NOT the vehicle: it already
 *   ran on every live database and its INSERT carries no tenant_id,
 *   so editing it would change nothing for any existing tenant.
 *   The migration is the vehicle (precedent: 0106 seeded GRNI/PPV
 *   per tenant the same way; 0305 seeded 1181 the same way).
 *
 * Drives the REAL migration up()/down() on PGlite, then the REAL
 * recordContainerDeposit through the real posting boundary:
 * - Part A, Case 0: the base state — a seeded chart has no
 *   1180/1182/1240 row.
 * - Part A, Case 1: up() inserts exactly one 1180 for the charted
 *   tenant, with the resolver-eligible shape and parent 1100.
 * - Part A, Case 2: up() twice is a no-op (idempotent).
 * - Part A, Case 3: a tenant-created 1180 (manual, is_system false)
 *   is never overwritten by up().
 * - Part A, Case 4: a tenant with no chart gets no row, and no
 *   1182/1240 row is invented for anyone.
 * - Part A, Case 5: down() removes only the row it added, never the
 *   tenant-created one.
 * - Part A, Case 6: down() never removes a 1180 any journal line
 *   references.
 * - Part B: on the live-shape deposit fixture (chart with no 1180),
 *   the trial 100 EGP deposit first rejects naming the
 *   (container_deposit) role — the exact live failure — then, after
 *   a single migration.up(), the SAME deposit records pending and
 *   posts one balanced JE Dr 1180 / Cr bank 1120 for 100 plus one
 *   treasury row of -100. That is the whole fix chain in one run:
 *   migration seeds the row, the resolver finds it, the deposit posts.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { migration } from '../../src/database/migrations/2040000000307_import_container_deposit_account_1180';

const BANK_ACCOUNT_ID = 12;

async function makeChartDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
    CREATE TABLE accounting_accounts (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT, account_type TEXT, account_group TEXT, parent_id BIGINT, normal_balance TEXT NOT NULL DEFAULT 'debit', is_active BOOLEAN NOT NULL DEFAULT true, is_system BOOLEAN NOT NULL DEFAULT false, allow_manual_entries BOOLEAN NOT NULL DEFAULT true, is_control_account BOOLEAN NOT NULL DEFAULT false, is_cash_bank BOOLEAN NOT NULL DEFAULT false, is_receivable BOOLEAN NOT NULL DEFAULT false, is_payable BOOLEAN NOT NULL DEFAULT false, is_inventory BOOLEAN NOT NULL DEFAULT false, is_tax BOOLEAN NOT NULL DEFAULT false, description_ar TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(tenant_id, code));
    CREATE TABLE journal_entry_lines (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id BIGINT);
    INSERT INTO tenants VALUES ('t1'), ('t2'), ('t3');
    INSERT INTO accounting_accounts (tenant_id, account_id, code, name_ar, name_en, account_type, account_group, parent_id, normal_balance, is_active, is_system, sort_order) VALUES
      ('t1', 't1', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', NULL, 'debit', true, true, 1100),
      ('t1', 't1', '1110', 'الخزينة', 'Cash', 'asset', 'cash_bank', 1, 'debit', true, true, 1110),
      ('t1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', 1, 'debit', true, true, 1120),
      ('t1', 't1', '1130', 'العملاء', 'Customers', 'asset', 'receivable', 1, 'debit', true, true, 1130),
      ('t1', 't1', '1140', 'المخزون', 'Inventory', 'asset', 'inventory', 1, 'debit', true, true, 1140),
      ('t1', 't1', '1150', 'ضريبة مشتريات قابلة للخصم', 'Purchase VAT Receivable', 'asset', 'tax', 1, 'debit', true, true, 1150),
      ('t1', 't1', '1160', 'عهد وسلف موظفين', 'Employee Advances', 'asset', 'current_assets', 1, 'debit', true, true, 1160),
      ('t1', 't1', '1170', 'مصروفات مدفوعة مقدمًا', 'Prepaid Expenses', 'asset', 'current_assets', 1, 'debit', true, true, 1170),
      ('t2', 't2', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', NULL, 'debit', true, true, 1100),
      ('t2', 't2', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', 9, 'debit', true, true, 1120),
      ('t2', 't2', '1180', 'تأمين حاوية يدوي', 'Manual container deposit', 'asset', 'current_assets', 9, 'debit', true, false, 1180);
  `);
  return db;
}

async function rowsFor(db: Kysely<Database>, tenantId: string, code: string): Promise<any[]> {
  return (db as any)
    .selectFrom('accounting_accounts')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('code', '=', code)
    .execute();
}

async function makeDepositDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, parent_id bigint, normal_balance text, is_active boolean, is_system boolean, sort_order int, allow_manual_entries boolean, is_control_account boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean, description_ar text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, status text, feasibility_data text, closure_data text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE import_customs_brokers (id text PRIMARY KEY, tenant_id text, name text, license_number text, phone text, port_name text, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_advances (id text PRIMARY KEY DEFAULT ('badv-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, project_id text, shipment_id text, advance_no text, amount_egp numeric, disbursement_date text, payment_method text, treasury_account_id bigint, status text, settled_amount_egp numeric, remaining_amount_egp numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date date, expected_return_date date, actual_return_date date, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, deduction_reason text, treasury_account_id bigint, notes text, idempotency_key text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id text, sale_item_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, allocation_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, product_id bigint, qty numeric, line_total numeric, allocated_discount numeric, cost_price numeric);
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), tenant_id text, project_id text, actual_cost_egp numeric, start_date text, journal_entry_id bigint);
    CREATE TABLE import_project_partners (id text PRIMARY KEY DEFAULT ('pp-' || md5(random()::text)), tenant_id text, project_id text, partner_id text, profit_percentage numeric, capital_share_amount numeric, is_active boolean);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, withdrawn_profit numeric, profit_share_percentage numeric, capital_share_amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, amount_egp numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, 12, 12, NULL, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO accounting_accounts (id, tenant_id, account_id, code, name_ar, name_en, account_type, account_group, parent_id, normal_balance, is_active, is_system, sort_order, allow_manual_entries, is_control_account, is_cash_bank, is_inventory, is_payable, is_receivable, is_tax) VALUES
      (11, 't1', 't1', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', NULL, 'debit', true, true, 1100, false, false, false, false, false, false, false),
      (12, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', 11, 'debit', true, true, 1120, true, false, true, false, false, false, false),
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', 11, 'debit', true, true, 1140, true, true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', NULL, 'credit', true, true, 2110, true, true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', NULL, 'debit', true, true, 5100, true, false, false, false, false, false, false),
      (25, 't1', 't1', '1130', 'عهد مخلصين', 'Broker advances', 'asset', 'assets', 11, 'debit', true, true, 1130, true, false, false, false, false, false, false),
      (26, 't1', 't1', '1160', 'ضريبة مستردة', 'VAT receivable', 'asset', 'assets', 11, 'debit', true, true, 1160, true, false, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'active', NULL, NULL, NOW());
    INSERT INTO import_shipments (id, tenant_id, container_number, project_id, status) VALUES ('sh-1', 't1', 'MSCU-TEST-001', 'proj-1', 'in_transit');
  `);
  return db;
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

function trialDto(overrides: Record<string, unknown> = {}): any {
  return {
    projectId: 'proj-1',
    shipmentId: 'sh-1',
    containerNo: 'MSCU-TEST-001',
    shippingLine: 'MSC Mediterranean Shipping Company',
    depositAmountEgp: 100,
    paymentDate: '2026-11-09',
    expectedReturnDate: '2026-12-20',
    treasuryAccountId: '12',
    ...overrides,
  };
}

async function journalLines(db: Kysely<Database>): Promise<Array<{ account_id: number; debit: number; credit: number }>> {
  const rows = await sql<{ account_id: string; debit: string; credit: string }>`
    SELECT l.account_id, l.debit, l.credit FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE e.tenant_id = 't1' AND e.source_type = 'import_container_deposit'
    ORDER BY l.id
  `.execute(db);
  return rows.rows.map((r) => ({ account_id: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

async function main(): Promise<void> {
  // Part A — the migration itself, on a compact chart fixture.
  {
    const db = await makeChartDb();
    try {
      // Case 0: the base state — the seeded chart has no 1180/1182/1240.
      assert.equal((await rowsFor(db, 't1', '1180')).length, 0, 'Base chart has no 1180 row');
      assert.equal((await rowsFor(db, 't1', '1182')).length, 0, 'Base chart has no 1182 row');
      assert.equal((await rowsFor(db, 't1', '1240')).length, 0, 'Base chart has no 1240 row');

      // Case 1: up() inserts exactly one 1180 for the charted tenant,
      // with the resolver-eligible shape and parent 1100.
      await migration.up(db as never);
      const seeded = await rowsFor(db, 't1', '1180');
      assert.equal(seeded.length, 1, 'up() inserts exactly one 1180 for t1');
      const row = seeded[0];
      assert.equal(row.name_ar, 'تأمينات الحاويات المستردة', '1180 carries the container-deposit Arabic name');
      assert.equal(row.name_en, 'Container Deposits', '1180 carries the container-deposit English name');
      assert.equal(row.account_type, 'asset', '1180 is an asset, not a receivable/control account');
      assert.equal(row.normal_balance, 'debit', '1180 is debit-normal');
      assert.equal(row.account_group, 'current_assets', '1180 sits in current assets like 1160');
      assert.equal(Number(row.parent_id), 1, '1180 hangs under 1100 Current Assets');
      assert.equal(row.is_active, true, '1180 is active');
      assert.equal(row.is_system, true, '1180 is seeded as a system row');
      assert.equal(row.allow_manual_entries, true, '1180 allows manual entries');
      assert.equal(row.is_control_account, false, '1180 is not a control account');
      assert.equal(row.is_cash_bank, false, '1180 is not cash/bank');
      assert.equal(row.is_receivable, false, '1180 is not a receivable');
      assert.equal(row.is_payable, false, '1180 is not a payable');
      assert.equal(row.is_inventory, false, '1180 is not inventory');
      assert.equal(row.is_tax, false, '1180 is not a tax account');

      // Case 2: up() twice is a no-op (idempotent).
      await migration.up(db as never);
      assert.equal((await rowsFor(db, 't1', '1180')).length, 1, 'Second up() still leaves exactly one 1180 for t1');

      // Case 3: a tenant-created 1180 is never overwritten by up().
      const manual = await rowsFor(db, 't2', '1180');
      assert.equal(manual.length, 1, 't2 keeps exactly one 1180');
      assert.equal(manual[0].name_ar, 'تأمين حاوية يدوي', 'up() never overwrites the tenant-created 1180 name');
      assert.equal(manual[0].is_system, false, 'up() never flips the tenant-created 1180 to a system row');

      // Case 4: a tenant with no chart gets no row, and no 1182/1240
      // row is invented for anyone.
      assert.equal((await rowsFor(db, 't3', '1180')).length, 0, 'A tenant with no chart gets no 1180 row');
      assert.equal((await rowsFor(db, 't1', '1182')).length, 0, 'No 1182 row is invented for t1');
      assert.equal((await rowsFor(db, 't1', '1240')).length, 0, 'No 1240 row is invented for t1');
      assert.equal((await rowsFor(db, 't2', '1182')).length, 0, 'No 1182 row is invented for t2');

      // Case 5: down() removes only the row it added, never the
      // tenant-created one.
      await migration.down!(db as never);
      assert.equal((await rowsFor(db, 't1', '1180')).length, 0, 'down() removes the seeded 1180 for t1');
      const manualAfterDown = await rowsFor(db, 't2', '1180');
      assert.equal(manualAfterDown.length, 1, 'down() never removes the tenant-created 1180');
      assert.equal(manualAfterDown[0].name_ar, 'تأمين حاوية يدوي', 'down() leaves the tenant-created row untouched');

      // Case 6: down() never removes a 1180 any journal line
      // references.
      await migration.up(db as never);
      const reseeded = await rowsFor(db, 't1', '1180');
      assert.equal(reseeded.length, 1, 'up() re-seeds 1180 for t1 after down()');
      await sql`INSERT INTO journal_entry_lines (account_id) VALUES (${Number(reseeded[0].id)})`.execute(db);
      await migration.down!(db as never);
      assert.equal((await rowsFor(db, 't1', '1180')).length, 1, 'down() keeps a 1180 that posted journals reference');
    } finally {
      await db.destroy();
    }
  }

  // Part B — the whole fix chain: base rejects, migration seeds, deposit posts.
  {
    const db = await makeDepositDb();
    try {
      const service = makeService(db);

      // Base behaviour (the exact live failure, re-test 6(a)): no
      // 1180/1182/1240 in the chart, so the valid 100 EGP deposit
      // rejects naming the (container_deposit) role and records nothing.
      assert.equal((await rowsFor(db, 't1', '1180')).length, 0, 'Deposit fixture starts with no 1180 row');
      await assert.rejects(
        async () => service.recordContainerDeposit('t1', 1, trialDto()),
        /دور \(container_deposit\)/,
        'Before the seed, a valid deposit fails naming the container_deposit role',
      );
      assert.equal(
        (await db.selectFrom('import_container_deposits').select('id').execute()).length,
        0,
        'A fail-closed deposit records nothing',
      );

      // The fix: one migration.up() seeds the row the resolver needs.
      await migration.up(db as never);
      const seeded = await rowsFor(db, 't1', '1180');
      assert.equal(seeded.length, 1, 'migration.up() seeds exactly one 1180 for the deposit tenant');
      const seededId = Number(seeded[0].id);
      assert.ok(Number.isSafeInteger(seededId) && seededId > 0, 'The seeded 1180 has a real chart id');

      // The same valid deposit now records + posts: Dr 1180 / Cr 1120.
      const deposit = await service.recordContainerDeposit('t1', 1, trialDto());
      assert.equal(Number(deposit.deposit_amount_egp), 100, 'Deposit records the trial 100 EGP amount');
      assert.equal(deposit.refund_status, 'pending', 'Deposit starts pending');
      assert.equal(deposit.container_no, 'MSCU-TEST-001', 'Deposit records the trial container');
      assert.deepEqual(
        await journalLines(db),
        [
          { account_id: seededId, debit: 100, credit: 0 },
          { account_id: BANK_ACCOUNT_ID, debit: 0, credit: 100 },
        ],
        'JE is Dr container-deposit asset 1180 / Cr bank 1120 for 100',
      );
      const treasury = await db.selectFrom('treasury_transactions').select(['amount', 'txn_type']).execute();
      assert.equal(treasury.length, 1, 'One treasury row is recorded');
      assert.equal(Number(treasury[0].amount), -100, 'Treasury row pays out 100');
      assert.equal(treasury[0].txn_type, 'import_container_deposit', 'Treasury row is typed as a container deposit');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import container deposit account 1180 seed tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
