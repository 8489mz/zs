/*
New file: backend/test/critical/import-broker-advance-account.spec.ts
Pins the D9 trial shape (INV-IMPORT-BROKER-ADVANCE-ACCOUNT).

WHAT WAS WRONG (live trial phase 2, 2026-11-09): a broker custody
advance posted JE-00015026 Dr 1130 "العملاء" (Customers) 50.00 /
Cr 1120 "البنك" 50.00, and its settlement posted JE-00015027
Dr 1140 "المخزون" 20.00 / Cr 1130 "العملاء" 20.00 — a broker
advance is not a customer receivable. Root cause, in
resolveTenantAccount (import-sales.service.ts): the
broker_advance candidate list started with '1130', and the
seeded chart of accounts has no 1181/1230 row, so the first
candidate always won; the eligibility check never excluded the
receivable control account. The old broker specs masked it by
labelling their fixture 1130 row "عهد مخلصين" — in the real COA
1130 is Customers (is_receivable, is_control_account).

WHAT THIS PINS, driving the real disburseBrokerAdvance,
liquidateBrokerExpenses and updateShipmentCosts (receipt
posting) on PGlite through the real posting boundary, with a
live-shape fixture (1130 IS Customers, 1181 IS the broker
advance account):
- Disburse 50 EGP (ADV-TEST-001): one journal Dr 1181 50 /
  Cr 1120 50; no line anywhere touches 1130.
- Post-receipt settlement 20 EGP (RCP-TEST-001): the response
  carries capitalization_state 'revalued' — the posted state,
  not "awaiting approval" — one journal Dr 1140 20 / Cr 1181
  20; no line anywhere touches 1130.
- Pre-receipt settlement folded into the shipment bucket, then
  receipt posting: the receipt journal credits 1181 for the
  folded 20, never 1130.
- Fail-closed: with no 1181/1230 account in the chart, disburse
  rejects with the clear "configure the account" error and
  writes no advance row and no journal — it never silently
  posts a broker advance to the Customers ledger.
- Frontend wiring pin: the settlement toast in
  CustomsBrokerManager reads the response capitalization_state
  and the file no longer contains the false "بانتظار التحقق
  بموافقة ثانية" settlement toast; the per-expense verification
  state stays in the statement table, where it belongs.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const BROKER_ADVANCE_ACCOUNT_ID = 25;
const CUSTOMERS_ACCOUNT_ID = 27;
const BANK_ACCOUNT_ID = 24;
const INVENTORY_ACCOUNT_ID = 21;

async function makeDb(withBrokerAccount = true): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const brokerRow = withBrokerAccount
    ? `      (25, 't1', 't1', '1181', 'عهد المخلصين الجمركيين', 'Broker advances', 'asset', 'assets', true, false, false, false, false, false),\n`
    : '';
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, parent_id bigint, is_active boolean, description text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_cost_centers_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, allocated_capital numeric, status text, feasibility_data text, closure_data text, created_at timestamptz DEFAULT NOW());
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
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), tenant_id text, project_id text, shipment_id text, container_no text, refund_status text);
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
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
${brokerRow}      (26, 't1', 't1', '1160', 'ضريبة مستردة', 'VAT receivable', 'asset', 'assets', true, false, false, false, false, false),
      (27, 't1', 't1', '1130', 'العملاء', 'Customers', 'asset', 'assets', true, false, false, false, true, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects (id, tenant_id, project_no, title, allocated_capital, status, feasibility_data, closure_data, created_at) VALUES ('proj-1', 't1', 'IMP-261109-0001', 'اختبار مشروع استيراد 001', 100, 'active', '{}', NULL, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 10, 0, 2000, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 10, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
    INSERT INTO import_customs_brokers VALUES ('br-1', 't1', 'Broker One', NULL, NULL, 'Alexandria', NULL, NOW());
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

async function seedShipment(db: Kysely<Database>): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'sh-1-item', tenant_id: 't1', shipment_id: 'sh-1', product_id: 1,
    quantity: 10, factory_unit_price_usd: 50, shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function postReceipt(db: Kysely<Database>, service: any): Promise<number> {
  await service.updateShipmentCosts('t1', 1, 'sh-1', { status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10 });
  const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
  return Number(receipt.id);
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select((eb: any) => eb.fn.countAll().as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function journalLines(db: Kysely<Database>, entryId: number): Promise<any[]> {
  return (db as any).selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', entryId).execute();
}

async function linesOnCustomersAccount(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('journal_entry_lines').selectAll().where('account_id', '=', CUSTOMERS_ACCOUNT_ID).execute();
}

function lineFor(lines: any[], accountId: number): any {
  const line = lines.find((l) => Number(l.account_id) === accountId);
  assert.ok(line, `Expected a journal line on account ${accountId}`);
  return line;
}

async function disburseTrialAdvance(db: Kysely<Database>, service: any, amount: number, shipmentId?: string): Promise<any> {
  return service.disburseBrokerAdvance('t1', 1, {
    brokerId: 'br-1', advanceNo: 'ADV-TEST-001', amountEgp: amount,
    projectId: 'proj-1', shipmentId: shipmentId || undefined, paymentMethod: 'bank_transfer', treasuryAccountId: BANK_ACCOUNT_ID,
  });
}

async function main(): Promise<void> {
  // Case 1: the trial advance — 50 EGP disburses Dr 1181 / Cr 1120,
  // never 1130 Customers.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburseTrialAdvance(db, service, 50, 'sh-1');
      assert.equal(Number(advance.amount_egp), 50, 'The advance records 50 EGP');
      const entries: any[] = await (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', 'import_broker_advance').execute();
      assert.equal(entries.length, 1, 'Exactly one advance journal');
      const lines = await journalLines(db, Number(entries[0].id));
      assert.equal(lines.length, 2, 'Advance journal: one debit + one credit');
      assert.equal(Number(lineFor(lines, BROKER_ADVANCE_ACCOUNT_ID).debit), 50, 'Dr broker-advance account 1181 50');
      assert.equal(Number(lineFor(lines, BANK_ACCOUNT_ID).credit), 50, 'Cr bank 1120 50');
      assert.equal((await linesOnCustomersAccount(db)).length, 0, 'No journal line anywhere touches 1130 Customers');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the trial settlement — post-receipt liquidation of 20
  // EGP capitalises Dr 1140 / Cr 1181, and the response carries
  // the posted state ('revalued'), not "awaiting approval".
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      await postReceipt(db, service);
      const advance = await disburseTrialAdvance(db, service, 50, 'sh-1');
      const journalsBefore = await countRows(db, 'journal_entries');
      const expense = await service.liquidateBrokerExpenses('t1', 1, {
        brokerId: 'br-1', advanceId: advance.id, projectId: 'proj-1', shipmentId: 'sh-1',
        receiptNo: 'RCP-TEST-001', category: 'customs_duty', amountEgp: 20,
      });
      assert.equal(expense.capitalization_state, 'revalued', 'The settlement response carries the posted state');
      assert.equal(expense.is_verified, false, 'Verification is a separate step; the settlement itself is posted');
      assert.equal(await countRows(db, 'journal_entries'), journalsBefore + 1, 'Exactly one settlement journal');
      const entry: any = await (db as any).selectFrom('journal_entries').selectAll().orderBy('id', 'desc').executeTakeFirstOrThrow();
      assert.equal(entry.source_type, 'import_broker_capitalization', 'The settlement journal is the capitalisation journal');
      const lines = await journalLines(db, Number(entry.id));
      assert.equal(Number(lineFor(lines, INVENTORY_ACCOUNT_ID).debit), 20, 'Dr inventory 1140 20');
      assert.equal(Number(lineFor(lines, BROKER_ADVANCE_ACCOUNT_ID).credit), 20, 'Cr broker-advance account 1181 20');
      assert.equal((await linesOnCustomersAccount(db)).length, 0, 'No journal line anywhere touches 1130 Customers');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: pre-receipt settlement folds into the shipment bucket
  // and the receipt journal relieves 1181 for the folded 20 —
  // the receipt credit leg never lands on 1130 either.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db);
      const advance = await disburseTrialAdvance(db, service, 50, 'sh-1');
      const expense = await service.liquidateBrokerExpenses('t1', 1, {
        brokerId: 'br-1', advanceId: advance.id, projectId: 'proj-1', shipmentId: 'sh-1',
        receiptNo: 'RCP-TEST-001', category: 'customs_duty', amountEgp: 20,
      });
      assert.equal(expense.capitalization_state, 'folded', 'Pre-receipt capitalisation folds');
      const journalsBeforeReceipt = await countRows(db, 'journal_entries');
      assert.equal(journalsBeforeReceipt, 1, 'The fold posts no journal (only the advance journal exists)');
      const receiptId = await postReceipt(db, service);
      const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll().where('id', '=', receiptId).executeTakeFirstOrThrow();
      const lines = await journalLines(db, Number(receipt.journal_entry_id));
      const advanceLine = lineFor(lines, BROKER_ADVANCE_ACCOUNT_ID);
      assert.equal(Number(advanceLine.credit), 20, 'Cr broker-advance account 1181 20 for the folded cost');
      assert.equal((await linesOnCustomersAccount(db)).length, 0, 'No journal line anywhere touches 1130 Customers');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: fail-closed — with no dedicated broker-advance account
  // (no 1181/1230) the advance is rejected with a clear message
  // and writes nothing, instead of silently posting to 1130.
  {
    const db = await makeDb(false);
    try {
      const service = makeService(db);
      await seedShipment(db);
      await assert.rejects(
        async () => disburseTrialAdvance(db, service, 50, 'sh-1'),
        /تعذر تحديد حساب محاسبي/,
        'Without a broker-advance account the disburse must fail closed, never fall back to Customers',
      );
      assert.equal(await countRows(db, 'import_broker_advances'), 0, 'No advance row is written by a rejected disburse');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal is written by a rejected disburse');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: frontend wiring — the settlement toast reads the
  // posted state from the response and never claims the posted
  // settlement awaits a second approval.
  {
    const managerPath = join(__dirname, '..', '..', '..', 'frontend', 'src', 'features', 'import-sales', 'CustomsBrokerManager.tsx');
    const source = readFileSync(managerPath, 'utf8');
    assert.ok(!source.includes('بانتظار التحقق بموافقة ثانية'), 'The settlement toast never says "awaiting second approval"');
    assert.ok(source.includes('capitalization_state'), 'The toast reads the settlement response posted state');
    assert.ok(source.includes('تمت تسوية المصروف وترحيل قيدها'), 'The posted settlement toast states the journal is posted');
    assert.ok(source.includes('بانتظار التحقق'), 'The per-expense verification state still shows in the statement table');
  }

  console.log('Import broker advance account tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
