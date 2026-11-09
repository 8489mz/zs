/*
New file: backend/test/critical/import-traceability-approvals-pool.spec.ts
Pins import traceability (INV-IMPORT-TRACEABILITY-APPROVALS-POOL).

WHAT WAS WRONG (live trials phase 1 P10 + phase 2 D5/D15): after a
fully posted flow — project IMP-261109-0001, approved PI
PI-IMP-261109-0001-5287, shipment MSCU-TEST-001, receipt #1 posted
as JE-00015025 (Dr 1140 / Cr 2110 900 EGP), supplier payment — the
approvals queue stayed 0/0/0, reconciliation showed 0/0/0 and the
profit pool showed 0 with no per-project/per-shipment attribution,
no closing action, and a distribution step demanding a maker-checker
approval UUID that did not exist.

ROOT CAUSES (grounded in code, not guessed):
(a) Approvals read only import_approval_requests, whose ONLY writer
is the manual createApprovalRequest: no flow transition (project
create, PI approval, shipment create, receipt posting, supplier
payment) ever inserts a row — so 0/0/0 was the correct answer to
the wrong question.
(b) The reconciliation scan only looks for stale broker advances
(>30d) and overdue container deposits; no receipt <-> journal
tie-out exists anywhere.
(c) generatePeriodProfitReport supports a projectId (lot-allocation
attribution, POSTED_LEDGER_ONLY basis) but the profit-pool page
never passes one (useProfitReportQuery has no projectId), so it can
only render the company-wide aggregate; the returned shape has no
per-project or per-shipment rows at all. The pool page also has no
closing action (close lives only in the projects manager).
(d) Distribution DOES have an approval creator — the pool modal's
"+ raise approval" button mints a partner_distribution approval —
but it stuffs the just-created PENDING id into the consumable UUID
field, and verifyAndConsumeApprovalRequest rejects any non-approved
status; the select also lists pending/rejected approvals as
choosable, and the modal never sends the project the approval was
raised for, so the payout binds to whatever the approval says
instead of the project shown.

WHAT THIS PINS, driving the real service on PGlite:
- listImportFlowEvents (the one traceability source of truth, read
  from the tables that store each event): the trial flow appears
  with its REAL state — project active, PI approved+paid, shipment
  Arrived, receipt posted with journalEntryNo JE-00015025 and
  journalMatched true, supplier payment FT-261109-0001 — and the
  counts derived from those same events (receiptsPosted 1,
  receiptsMatched 1) instead of a separate counter that stays 0.
- A receipt that is NOT posted (legacy_review_required, no journal)
  traces as journalMatched false with receiptsMatched 0.
- listProjectProfitAttribution: per-project row for IMP-261109-0001
  (revenue 1,200, cost 900, net 300, shares 150/150, verified) with
  a per-shipment row for MSCU-TEST-001 (received 10, landed 900,
  sales 1,200/900); the untouched project IMP-261108-0001 traces
  0/0/0 as NO_SALES_RECORDED.
- Distribution references a REAL approval: a pending approval and
  an unknown UUID are both refused naming the approval; an approved
  partner_distribution approval (created, then decided by a second
  user) pays 100 EGP with a balanced JE (Dr equity 3100 / Cr bank
  1120) plus payout + ledger rows.
- Closing: closeProject without an approval is refused naming
  maker-checker; with a real approved project_closure approval the
  project closes and closureData carries the verified 300 EGP
  profit report.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

async function makeDb(opts: { withSecondShipment?: boolean } = {}): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const second = opts.withSecondShipment !== false;
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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, title text, project_no text, status text, feasibility_data text, closure_data jsonb, closure_date timestamptz, closed_by bigint, allocated_capital numeric, budget_currency text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW(), payment_method text, payment_reference text, bank_swift_code text, form4_number text, form4_date date, evidence_carrier_name text, evidence_travel_date date, evidence_handover_receipt text, evidence_lc_number text, evidence_lc_issuing_bank text, evidence_lc_expiry date, evidence_lc_documents text, evidence_cad_proof text, evidence_payment_terms text, evidence_payment_due_date date);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY DEFAULT ('pi-' || md5(random()::text)), tenant_id text, pi_number text, supplier_id bigint, project_id text, currency text, total_amount_foreign numeric, paid_amount_foreign numeric, exchange_rate_contract numeric, payment_status text, pi_date text, incoterm text, delivery_port text, payment_terms text, advance_percentage numeric, balance_percentage numeric, status text, items text, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id text, shipment_id text, sale_id bigint, sale_item_id bigint, lot_id text, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, product_id bigint, qty numeric, line_total numeric, allocated_discount numeric, cost_price numeric);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_items (id bigint PRIMARY KEY, return_document_id bigint, product_id bigint, qty numeric, line_total numeric, cost_price numeric);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date timestamptz, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), tenant_id text, project_id text, actual_cost_egp numeric, start_date text, journal_entry_id bigint);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, approved_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE import_broker_advances (id text PRIMARY KEY DEFAULT ('badv-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, project_id text, shipment_id text, advance_no text, amount_egp numeric, disbursement_date text, payment_method text, treasury_account_id bigint, status text, settled_amount_egp numeric, remaining_amount_egp numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date text, expected_return_date text, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, notes text, actual_return_date text, deduction_reason text, updated_at timestamptz DEFAULT NOW(), created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_refund_events (id text PRIMARY KEY DEFAULT ('ref-' || md5(random()::text)), serial_id bigserial, tenant_id text, deposit_id text, idempotency_key text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, created_by bigint, journal_entry_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_project_partners (id text PRIMARY KEY DEFAULT ('pp-' || md5(random()::text)), tenant_id text, project_id text, partner_id text, profit_percentage numeric, capital_share_amount numeric, is_active boolean);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, withdrawn_profit numeric, profit_share_percentage numeric, capital_amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, treasury_transaction_id bigint, amount_egp numeric, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_ledger (id text PRIMARY KEY DEFAULT ('pl-' || md5(random()::text)), tenant_id text, partner_id text, type text, amount numeric, transaction_date timestamptz, note text, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, retail_price numeric, wholesale_price numeric, supplier_id bigint, category_id bigint, notes text, metadata text, updated_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, 12, 12, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (12, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (27, 't1', 't1', '5201', 'خسائر فروق عملة', 'Forex Loss', 'expense', 'expenses', true, false, false, false, false, false),
      (28, 't1', 't1', '4201', 'أرباح فروق عملة', 'Forex Gain', 'revenue', 'revenues', true, false, false, false, false, false),
      (30, 't1', 't1', '3100', 'رأس مال الشركاء', 'Partner Capital', 'equity', 'equity', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO import_projects VALUES
      ('proj-1', 't1', 'Project One', 'IMP-261109-0001', 'active', '{}', NULL, NULL, NULL, 100, 'USD', '2026-11-08 00:00:00+00', NOW()),
      ('proj-2', 't1', 'Project Two', 'IMP-261108-0001', 'feasibility', '{}', NULL, NULL, NULL, 100, 'USD', '2026-11-08 00:00:00+00', NOW());
    INSERT INTO import_proforma_invoices (id, tenant_id, pi_number, supplier_id, project_id, currency, total_amount_foreign, paid_amount_foreign, exchange_rate_contract, payment_status, status) VALUES
      ('pi-1', 't1', 'PI-IMP-261109-0001-5287', 1, 'proj-1', 'USD', 10, 10, 50, 'paid', 'approved'),
      ('pi-2', 't1', 'PI-IMP-261108-0001-8359', 1, 'proj-2', 'USD', 10, 0, 50, 'unpaid', 'pending');
    INSERT INTO import_shipments (id, tenant_id, container_number, supplier_id, bill_of_lading, status, project_id, shipping_cost_usd, customs_cost_egp, internal_transport_cost_egp) VALUES
      ('sh-1', 't1', 'MSCU-TEST-001', 1, 'BL-001', 'Arrived', 'proj-1', 5, 100, 50)
      ${second ? `,('sh-2', 't1', 'MSCU-TEST-002', 1, 'BL-002', 'In Customs', 'proj-1', 5, 100, 50)` : ''};
    INSERT INTO import_shipment_items (id, tenant_id, shipment_id, product_id, quantity, factory_unit_price_usd, landed_cost_egp, received_quantity, shortage_handling_method) VALUES
      ('sh-1-item', 't1', 'sh-1', 1, 10, 1, 90, 10, 'capitalize')
      ${second ? `,('sh-2-item', 't1', 'sh-2', 1, 10, 1, 90, 0, 'capitalize')` : ''};
    INSERT INTO journal_entries (id, tenant_id, account_id, entry_no, entry_date, description, source_type, source_id, status) VALUES
      (1, 't1', 't1', 'JE-00015025', '2026-11-08', 'Import receipt MSCU-TEST-001', 'import_inventory_receipt', 1, 'posted');
    INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, description, debit, credit, partner_type, partner_id) VALUES
      ('t1', 1, 21, 'Inventory receipt', 900, 0, 'none', NULL),
      ('t1', 1, 22, 'Supplier payable', 0, 900, 'supplier', 1);
    INSERT INTO import_inventory_receipts (id, tenant_id, shipment_id, state, posted_at, created_by, journal_entry_id) VALUES
      (1, 't1', 'sh-1', 'posted', '2026-11-09 00:03:00+00', 1, 1)
      ${second ? `,(2, 't1', 'sh-2', 'legacy_review_required', NULL, 1, NULL)` : ''};
    INSERT INTO supplier_payments (tenant_id, account_id, supplier_id, amount, amount_foreign, currency, exchange_rate, proforma_invoice_id, doc_no, payment_date) VALUES
      ('t1', 't1', 1, 500, 10, 'USD', 50, 'pi-1', 'FT-261109-0001', '2026-11-09');
    INSERT INTO products VALUES (1, 't1', 't1', 'Test import item 001', NULL, NULL, 10, 0, 90, 120, 0, 1, NULL, NULL, NULL, NOW());
    INSERT INTO sales VALUES (501, 't1', 'completed', '2026-11-09 00:30:00+00');
    INSERT INTO sale_items VALUES (701, 501, 1, 10, 1200, 0, 90);
    INSERT INTO import_inventory_lots (id, tenant_id, lot_number, project_id, shipment_id, product_id, initial_quantity, remaining_quantity, unit_landed_cost_egp, status, receipt_date) VALUES
      ('lot-1', 't1', 'LOT-1', 'proj-1', 'sh-1', 1, 10, 0, 90, 'active', '2026-11-09');
    INSERT INTO import_sale_allocations (tenant_id, project_id, shipment_id, sale_id, sale_item_id, lot_id, product_id, quantity, unit_sale_price_egp, unit_cost_egp, allocation_type, created_at) VALUES
      ('t1', 'proj-1', 'sh-1', 501, 701, 'lot-1', 1, 10, 120, 90, 'sale', '2026-11-09 00:30:00+00');
    INSERT INTO import_partners VALUES
      ('par-1', 't1', 'Partner 1', 0, 50, 0, NOW()),
      ('par-2', 't1', 'Partner 2', 0, 50, 0, NOW());
    INSERT INTO import_project_partners (tenant_id, project_id, partner_id, profit_percentage, capital_share_amount, is_active) VALUES
      ('t1', 'proj-1', 'par-1', 50, 0, true),
      ('t1', 'proj-1', 'par-2', 50, 0, true);
    -- The seeded receipt journal used an explicit id: advance the
    -- sequence past it, or the payout journal the service posts
    -- later in this DB would collide on id 1.
    SELECT setval(pg_get_serial_sequence('journal_entries', 'id'), (SELECT MAX(id) FROM journal_entries));
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

async function approveRequest(db: Kysely<Database>, service: any, requestId: string): Promise<void> {
  // Maker-checker: the approver (user 2) must differ from the requester (user 1).
  await service.decideApprovalRequest('t1', 2, requestId, { decision: 'approved' });
}

async function payoutJournalLines(db: Kysely<Database>): Promise<Array<{ account_id: number; debit: number; credit: number }>> {
  const rows = await sql<{ account_id: string; debit: string; credit: string }>`
    SELECT l.account_id, l.debit, l.credit FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE e.tenant_id = 't1' AND e.source_type = 'import_partner_payout'
    ORDER BY l.id
  `.execute(db);
  return rows.rows.map((r) => ({ account_id: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

async function main(): Promise<void> {
  // Case 1: the posted trial flow appears in the trace with its REAL state.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const trace = await service.listImportFlowEvents('t1');
      const byKind = (kind: string) => trace.events.filter((e: any) => e.kind === kind);
      assert.equal(byKind('project').length, 2, 'Both trial projects must trace');
      assert.equal(byKind('project').find((e: any) => e.ref === 'IMP-261109-0001')?.state, 'active', 'The received project traces as active');
      const pi = byKind('proforma_invoice').find((e: any) => e.ref === 'PI-IMP-261109-0001-5287');
      assert.equal(pi?.state, 'approved', 'The approved PI traces as approved, not pending');
      assert.equal(Number(pi?.amountForeign), 10, 'The PI traces its real foreign amount');
      assert.equal(byKind('shipment').find((e: any) => e.ref === 'MSCU-TEST-001')?.state, 'Arrived', 'The received container traces as Arrived');
      const receipt = byKind('receipt').find((e: any) => e.label === 'MSCU-TEST-001');
      assert.equal(receipt?.state, 'posted', 'Receipt #1 traces as posted');
      assert.equal(receipt?.journalEntryNo, 'JE-00015025', 'The receipt traces its real journal number');
      assert.equal(receipt?.journalMatched, true, 'A posted receipt with a posted journal is matched');
      assert.equal(byKind('supplier_payment').find((e: any) => e.ref === 'FT-261109-0001')?.amountEgp, 500, 'The supplier payment traces with its real EGP amount');
      assert.equal(trace.counts.receiptsPosted, 1, 'Counts derive from the traced events: 1 posted receipt');
      assert.equal(trace.counts.receiptsMatched, 1, 'Counts derive from the traced events: 1 matched receipt');
      assert.equal(trace.counts.proformaInvoicesApproved, 1, 'Counts derive from the traced events: 1 approved PI');
      assert.equal(trace.counts.approvalsPending, 0, 'No approval request exists yet — the count is honestly 0, not a hidden flow');
      // Project-scoped trace: the second project sees only its own events.
      const scoped = await service.listImportFlowEvents('t1', 'proj-2');
      assert.equal(scoped.events.filter((e: any) => e.kind === 'project').length, 1, 'A project trace lists only that project');
      assert.equal(scoped.events.filter((e: any) => e.kind === 'receipt').length, 0, 'A project with no shipment traces no receipts');
      assert.equal(scoped.counts.proformaInvoices, 1, 'The second project traces its own pending PI');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: an unposted receipt traces as unmatched — never a silent 100%.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const trace = await service.listImportFlowEvents('t1');
      const unposted = trace.events.filter((e: any) => e.kind === 'receipt' && e.label === 'MSCU-TEST-002');
      assert.equal(unposted.length, 1, 'The unposted receipt must still appear in the trace');
      assert.equal(unposted[0].state, 'legacy_review_required', 'The unposted receipt traces its real state');
      assert.equal(unposted[0].journalEntryNo, null, 'An unposted receipt has no journal to trace');
      assert.equal(unposted[0].journalMatched, false, 'An unposted receipt is never reported as matched');
      assert.equal(trace.counts.receipts, 2, 'Both receipts are counted');
      assert.equal(trace.counts.receiptsMatched, 1, 'Only the posted receipt counts as matched');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: per-project / per-shipment profit attribution.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const attr = await service.listProjectProfitAttribution('t1', '2026-10-31', '2026-11-09');
      const proj1 = attr.projects.find((p: any) => p.projectId === 'proj-1');
      assert.equal(proj1?.projectNo, 'IMP-261109-0001', 'Attribution is keyed by the real project number');
      assert.equal(Number(proj1?.totalRevenue), 1200, 'Project revenue is the lot-attributed sale (10 x 120)');
      assert.equal(Number(proj1?.totalCost), 900, 'Project cost is the lot-attributed landed cost (10 x 90)');
      assert.equal(Number(proj1?.netProfitPool), 300, 'Project net pool is 300 EGP');
      assert.equal(proj1?.profitAttributionVerified, true, 'Fully lot-allocated sales verify the attribution');
      assert.equal(proj1?.profitBasis, 'POSTED_LEDGER_ONLY', 'A project report uses the posted-ledger basis, never the company-wide aggregate');
      const share1 = proj1?.partnerShares.find((p: any) => p.partnerId === 'par-1');
      assert.equal(Number(share1?.shareAmount), 150, 'Partner 1 share is 50% of the 300 EGP pool');
      const ship = proj1?.shipments.find((s: any) => s.containerNumber === 'MSCU-TEST-001');
      assert.equal(Number(ship?.receivedQuantity), 10, 'The shipment row traces the received quantity');
      assert.equal(Number(ship?.landedCostEgp), 900, 'The shipment row traces the landed cost');
      assert.equal(Number(ship?.salesRevenueEgp), 1200, 'The shipment row traces its own sales revenue');
      assert.equal(Number(ship?.salesCostEgp), 900, 'The shipment row traces its own sales cost');
      const proj2 = attr.projects.find((p: any) => p.projectId === 'proj-2');
      assert.equal(Number(proj2?.netProfitPool), 0, 'The untouched project attributes 0 profit');
      assert.equal(proj2?.attributionStatus, 'NO_SALES_RECORDED', 'The untouched project says so honestly');
      assert.equal(Number(attr.total.totalRevenue), 1200, 'The aggregate row still carries the company-wide total');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: distribution references a REAL approval — nothing else pays.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      // A pending approval cannot be consumed: the modal must only
      // offer approved ones, never the id it just minted.
      const pending = await service.createApprovalRequest('t1', 1, {
        actionType: 'partner_distribution',
        referenceId: 'par-1',
        requestPayload: { amount: 100, partnerId: 'par-1', projectId: 'proj-1' },
      });
      await assert.rejects(
        async () => service.recordPartnerPayout('t1', 1, 'par-1', 100, String(pending.id), 'proj-1', '12'),
        /غير مؤهل للتنفيذ/,
        'A pending approval must not pay out',
      );
      // An invented UUID fails closed naming the approval.
      await assert.rejects(
        async () => service.recordPartnerPayout('t1', 1, 'par-1', 100, '00000000-0000-0000-0000-000000000000', 'proj-1', '12'),
        /غير موجود/,
        'A UUID that does not exist must not pay out',
      );
      // The real flow: request, then a SECOND user approves, then pay.
      const real = await service.createApprovalRequest('t1', 1, {
        actionType: 'partner_distribution',
        referenceId: 'par-1',
        requestPayload: { amount: 100, partnerId: 'par-1', projectId: 'proj-1' },
      });
      await approveRequest(db, service, String(real.id));
      const res = await service.recordPartnerPayout('t1', 1, 'par-1', 100, String(real.id), 'proj-1', '12');
      assert.equal(res.success, true, 'An approved real approval must pay out');
      const lines = await payoutJournalLines(db);
      assert.deepEqual(lines, [
        { account_id: 30, debit: 100, credit: 0 },
        { account_id: 12, debit: 0, credit: 100 },
      ], 'The payout posts a balanced JE: Dr partner equity 3100 / Cr bank 1120');
      const payouts = await db.selectFrom('import_partner_project_payouts').selectAll().execute();
      assert.equal(payouts.length, 1, 'Exactly one project payout row is recorded');
      assert.equal(Number(payouts[0].amount_egp), 100, 'The payout row carries the paid amount');
      assert.equal(String(payouts[0].project_id), 'proj-1', 'The payout row is attributed to the approved project');
      // The paid distribution now traces as an event too.
      const trace = await service.listImportFlowEvents('t1');
      assert.equal(trace.events.filter((e: any) => e.kind === 'partner_payout').length, 1, 'The payout appears in the trace');
      assert.equal(trace.counts.approvalsExecuted, 1, 'The consumed approval traces as executed');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: the pool closes — only with a real approved closure approval.
  {
    const db = await makeDb({ withSecondShipment: false });
    try {
      const service = makeService(db);
      await assert.rejects(
        async () => service.closeProject('t1', 1, 'proj-1'),
        /Maker-Checker/,
        'Closing without an approval must be refused naming maker-checker',
      );
      const closure = await service.createApprovalRequest('t1', 1, {
        actionType: 'project_closure',
        referenceId: 'proj-1',
        requestPayload: { amount: 100, projectId: 'proj-1', justification: 'Close trial project' },
      });
      await approveRequest(db, service, String(closure.id));
      const res = await service.closeProject('t1', 1, 'proj-1', String(closure.id));
      assert.equal(res.success, true, 'An approved closure approval must close the project');
      assert.equal(Number(res.closureData.financialReconciliation.netProfitPool), 300, 'The closure record carries the verified 300 EGP profit report');
      const project = await db.selectFrom('import_projects').selectAll().where('id', '=', 'proj-1').executeTakeFirstOrThrow();
      assert.equal(project.status, 'closed', 'The project status is closed');
      const trace = await service.listImportFlowEvents('t1', 'proj-1');
      assert.equal(trace.events.find((e: any) => e.kind === 'project')?.state, 'closed', 'The closed project traces as closed');
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('import traceability approvals pool checks passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
