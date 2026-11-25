/*
 * Import-sales slice S6 (ImportProfitReportService): focused spec for the
 * two moved methods no other spec references by name (prep §4.4):
 * getImportCommandCenterMetrics and sumPostedProjectCostComponents
 * (driven here through the public generatePeriodProfitReport).
 *
 * Pure-move proof: the methods live in the slice, the facade delegates
 * to them, and they behave identically — the empty command-center shape,
 * the tenant-day ACI expiry window (acidBound, the Batch 5 P3 site), and
 * the posted-cost components (all zero on an empty period) are pinned
 * driving the REAL facade on PGlite. Unwired (orphan); the merge
 * decides wiring per the 2026-11-14 decision.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { resolveBusinessDateKey } from '../../src/modules/accounting/engines/accounting-date.engine';
import { addDaysToDayKey } from '../../src/common/utils/client-date-bounds.util';

const SRC = path.join(__dirname, '..', '..', 'src');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

async function makeDb(): Promise<{ db: Kysely<Database>; pg: PGlite }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, title text, project_no text, allocated_capital numeric, status text, feasibility_data text, closure_data text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, amount numeric, amount_foreign numeric, note text, created_by bigint, payment_date text, currency text, exchange_rate numeric, forex_variance_egp numeric, proforma_invoice_id text, idempotency_key text, doc_no text, created_at timestamptz DEFAULT NOW(), payment_method text, payment_reference text, bank_swift_code text, form4_number text, form4_date date, evidence_carrier_name text, evidence_travel_date date, evidence_handover_receipt text, evidence_lc_number text, evidence_lc_issuing_bank text, evidence_lc_expiry date, evidence_lc_documents text, evidence_cad_proof text, evidence_payment_terms text, evidence_payment_due_date date);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY DEFAULT ('pi-' || md5(random()::text)), tenant_id text, pi_number text, supplier_id bigint, project_id text, currency text, total_amount_foreign numeric, paid_amount_foreign numeric, exchange_rate_contract numeric, payment_status text, pi_date text, incoterm text, delivery_port text, payment_terms text, advance_percentage numeric, balance_percentage numeric, status text, items text, notes text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE import_customs_brokers (id text PRIMARY KEY, tenant_id text, name text, license_number text, phone text, port_name text, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_advances (id text PRIMARY KEY DEFAULT ('badv-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, project_id text, shipment_id text, advance_no text, amount_egp numeric, disbursement_date text, payment_method text, treasury_account_id bigint, status text, settled_amount_egp numeric, remaining_amount_egp numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    -- PGlite harness adaptation (production behaviour unchanged): the
    -- company-wide report binds Date params to expenses.expense_date.
    -- node-postgres stringifies Dates for a text column; PGlite refuses
    -- to bind a Date to a text column ('Invalid input for string type').
    -- timestamptz here lets the query bind; this spec asserts zero
    -- shapes on empty tables, so the comparison result is identical.
    -- The production column stays text.
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date timestamptz, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date text, expected_return_date text, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, notes text, actual_return_date text, deduction_reason text, updated_at timestamptz DEFAULT NOW(), created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_refund_events (id text PRIMARY KEY DEFAULT ('ref-' || md5(random()::text)), serial_id bigserial, tenant_id text, deposit_id text, idempotency_key text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, created_by bigint, journal_entry_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id text, shipment_id text, sale_item_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, allocation_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigint PRIMARY KEY, sale_id bigint, product_id bigint, qty numeric, line_total numeric, allocated_discount numeric, cost_price numeric);
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), tenant_id text, project_id text, actual_cost_egp numeric, start_date text, journal_entry_id bigint);
    CREATE TABLE import_project_partners (id text PRIMARY KEY DEFAULT ('pp-' || md5(random()::text)), tenant_id text, project_id text, partner_id text, profit_percentage numeric, capital_share_amount numeric, is_active boolean);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, withdrawn_profit numeric, profit_share_percentage numeric, capital_share_amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, amount_egp numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, retail_price numeric, wholesale_price numeric, supplier_id bigint, category_id bigint, notes text, metadata text, updated_at timestamptz DEFAULT NOW());
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
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1181', 'عهد مخلصين', 'Broker advances', 'asset', 'assets', true, false, false, false, false, false),
      (26, 't1', 't1', '1160', 'ضريبة مستردة', 'VAT receivable', 'asset', 'assets', true, false, false, false, false, false),
      (27, 't1', 't1', '5201', 'خسائر فروق عملة', 'Forex Loss', 'expense', 'expenses', true, false, false, false, false, false),
      (28, 't1', 't1', '4201', 'أرباح فروق عملة', 'Forex Gain', 'revenue', 'revenues', true, false, false, false, false, false),
      (29, 't1', 't1', '1180', 'تأمينات حاويات', 'Container deposits', 'asset', 'assets', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects (id, tenant_id, title, project_no, allocated_capital, status, feasibility_data, closure_data, created_at) VALUES ('proj-1', 't1', 'Project One', 'IMP-261102-0001', 100, 'active', '{}', NULL, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', NULL, NULL, 10, 0, 2000, 0, 0, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 10, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
    INSERT INTO import_customs_brokers VALUES ('br-1', 't1', 'Broker One', NULL, NULL, 'Alexandria', NULL, NOW());
    -- S6 slice extra tables: the 5 tables the moved methods read that the
    -- honesty harness does not create (no FK references — this harness
    -- has no tenants/users tables, and the slice only reads these columns).
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, return_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, qty numeric, line_total numeric, cost_price numeric);
    CREATE TABLE import_partner_ledger (id bigserial PRIMARY KEY, tenant_id text, type text, amount numeric);
    CREATE TABLE import_suppliers_meta (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, audit_status text);
    CREATE TABLE import_aci_compliance (id text PRIMARY KEY, tenant_id text, status text, acid_expiry_date date);
  `);
  return { db, pg };
}

function makeService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function main(): Promise<void> {
  // §A — empty tenant: the command center returns the zero shape.
  {
    const { db } = await makeDb();
    try {
      const service = makeService(db);
      const m: any = await service.getImportCommandCenterMetrics('t1');
      assert.deepEqual(m.capital, {
        totalCapital: 0,
        deployedCapital: 0,
        availableCapital: 0,
      });
      // The harness seeds one active project ('proj-1'), so the
      // pipeline counts it; everything else is zero.
      assert.deepEqual(m.pipeline, {
        projects: { active: 1 },
        shipments: { inTransit: 0, inCustoms: 0, arrived: 0, total: 0 },
      });
      assert.deepEqual(m.liabilities, {
        totalDebtForeign: 0,
        totalDebtEgp: 0,
        unpaidProformaUsd: 0,
        supplierLiabilities: [],
      });
      assert.deepEqual(m.alerts.demurrageAlerts, []);
      assert.deepEqual(m.alerts.aciExpiring, []);
      assert.ok(m.performance && typeof m.performance === 'object', 'performance must be the profit report data');
      assert.equal(m.performance.profitBasis, 'COMPANY_WIDE_EXPENSES_TABLE');
      console.log('✓ §A passed: empty command center returns the zero shape');
    } finally {
      await db.destroy();
    }
  }

  // §B — ACI expiry window at the service level (time-independent: the
  // tenant day comes from the real clock, the +14/+15 bounds from the
  // same real day keys the service uses).
  {
    const { db } = await makeDb();
    try {
      const service = makeService(db);
      const todayKey = await resolveBusinessDateKey(db, 't1', new Date());
      const bound14 = addDaysToDayKey(todayKey, 14);
      const bound15 = addDaysToDayKey(todayKey, 15);
      assert.ok(bound14 && bound15, 'tenant day + 14/+15 must be valid day keys');
      await db
        .insertInto('import_aci_compliance' as never)
        .values([
          { id: 'aci-14', tenant_id: 't1', status: 'pending', acid_expiry_date: bound14 },
          { id: 'aci-15', tenant_id: 't1', status: 'pending', acid_expiry_date: bound15 },
          { id: 'aci-appr', tenant_id: 't1', status: 'approved', acid_expiry_date: bound14 },
          { id: 'aci-exp', tenant_id: 't1', status: 'expired', acid_expiry_date: bound14 },
          { id: 'aci-null', tenant_id: 't1', status: 'pending', acid_expiry_date: null },
        ] as never)
        .execute();
      const m: any = await service.getImportCommandCenterMetrics('t1');
      const ids = (m.alerts.aciExpiring as any[]).map((r) => r.id).sort();
      assert.deepEqual(
        ids,
        ['aci-14'],
        `ACI window must list exactly the tenant-day+14 pending expiry, got ${JSON.stringify(ids)}`,
      );
      console.log('✓ §B passed: ACI expiry window lists only the tenant-day+14 pending row');
    } finally {
      await db.destroy();
    }
  }

  // §C — project profit report on an empty period: the posted cost
  // components are all zero. Drives sumPostedProjectCostComponents
  // through the public report (the method is private; the report is
  // its only caller).
  {
    const { db } = await makeDb();
    try {
      const service = makeService(db);
      const report: any = await service.generatePeriodProfitReport(
        't1',
        new Date('2026-01-01'),
        new Date('2027-12-31'),
        'proj-1',
      );
      assert.equal(report.success, true);
      assert.equal(report.data.profitBasis, 'POSTED_LEDGER_ONLY');
      assert.deepEqual(report.data.postedCostComponents, {
        shortageExpenseEgp: 0,
        brokerExpensedEgp: 0,
        fxVarianceEgp: 0,
        depositDeductionsEgp: 0,
        totalPostedCostComponentsEgp: 0,
      });
      assert.deepEqual(report.data.unpostedEstimatesExcluded, {
        unpostedTripEstimatesEgp: 0,
        unpostedLateExpenseMemosEgp: 0,
        totalExcludedEgp: 0,
      });
      assert.equal(report.data.grossProfit, 0);
      assert.equal(report.data.netProfitPool, 0);
      console.log('✓ §C passed: empty project report has zero posted components');
    } finally {
      await db.destroy();
    }
  }

  // §D — wiring pin: the facade delegates the 3 methods to the slice,
  // and the slice carries the tenant-day ACI bound.
  {
    const facade = read('modules/import-sales/import-sales.service.ts');
    const slice = read('modules/import-sales/services/import-profit-report.service.ts');
    for (const name of [
      'sumPostedProjectCostComponents',
      'generatePeriodProfitReport',
      'getImportCommandCenterMetrics',
    ]) {
      assert.ok(facade.includes(`this.profitReportService.${name}(`), `facade must delegate ${name} to the slice`);
      assert.ok(slice.includes(name), `slice must contain ${name}`);
    }
    assert.ok(slice.includes('acidBound'), 'slice must carry the tenant-day ACI bound');
    assert.ok(
      facade.includes('private async eligibleRoleAccountIds('),
      'eligibleRoleAccountIds stays in the facade (kernel)',
    );
    console.log('✓ §D passed: facade delegates the 3 methods to the slice');
    console.log('IMPORT-PROFIT-REPORT-SLICE CHECKS PASSED');
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
