/*
 * Phase 1 final inspection, slice 3 — money-precision remainders
 * (INV-MONEY-PRECISION-HR-IMPORT-3DP).
 *
 * THE GAP: two sets of EGP report totals still rounded at a hardcoded
 * 2dp, so on a 3-digit tenant (KWD/OMR/BHD/JOD/TND/IQD/LYD) they
 * truncated the third digit:
 * (1) the six HR loan-report aggregates in withdrawals()
 * (hr-advances.service.ts:326-331) — totalWithdrawals,
 * totalRepayments, totalManualCashRepayments,
 * totalSalaryDeductionRepayments, totalRemaining,
 * totalSalaryDeductionDue — all Number(Number(x).toFixed(2));
 * (2) the EGP components of the import profit report
 * (import-profit-report.service.ts) — 29 sites across
 * generatePeriodProfitReport (posted-ledger components, unposted
 * exclusions, partner shares, the returned revenue/cost/profit
 * block) and getImportCommandCenterMetrics (partner capital +
 * totalDebtEgp).
 *
 * THE RULE: every EGP figure rounds through roundMoney at the
 * tenant's book digits (tenantBookDigits in HR — already imported
 * and already used by the sibling methods of the same service;
 * currencyMoneyDigits(await tenantBaseCurrency(qb, tenantId)) in
 * the profit report — the P2 pattern, resolved through qb so a
 * caller-passed executor/trx stays in the same connection).
 * The USD figures stay at 2dp (correct for USD): unpaidForeignUsd,
 * unpaidProformaUsd, and the foreign branch of totalDebtForeign.
 *
 * SCOPE DECISIONS (recorded): price-setting and the 2dp
 * refund-amount validation are NOT in this slice — their own
 * package. The preorder sites (import-container-preorders,
 * reservation total / refund remaining + persisted refunded
 * total / sale total) feed posted JEs and persisted rows, and
 * the :363 validation rejects refund amounts with more than 2
 * decimals, so changing it changes accepted input; the pricing
 * preview price endings (pricing.service.ts) are commercial
 * endings, explicitly not book-digits postings. Both stay pinned
 * as-is in the architecture-guard allowlist (7 + 7) and in the
 * engine-map money row. Customs-calculator shaping
 * (import-sourcing, display values) also stays. The engine-map
 * money row loses the HR aggregates, the profit-report /
 * command-center items, and the van loaded_amount item (already
 * closed by INV-VAN-TRANSFER-LOADED-AMOUNT-3DP — the row was
 * stale on it too).
 *
 * CONSIDERED + RECORDED: withdrawals() and
 * generatePeriodProfitReport() now resolve book digits through
 * the tenant currency config, so a tenant with no (or
 * inconsistent) currency config fails closed instead of
 * reporting 2dp — matching the command-center path, which
 * already calls tenantBaseCurrency, and the sibling HR methods.
 * The foreign proforma amounts are USD-denominated per the
 * field names (unpaidProformaUsd / unpaidForeignUsd); a
 * multi-foreign-currency proforma book would need its own
 * package, out of scope.
 *
 * WHAT THIS PINS, driving the REAL services on PGlite:
 * - §1: HR withdrawals on a KWD tenant — a disbursed loan of
 *   100.125 reports totalWithdrawals 100.125 and totalRemaining
 *   100.125 (the old code reported 100.13 on both).
 * - §1b: CONTROL — the same seed on an EGP tenant still reports
 *   100.13: the fix is digits-aware, not "never round".
 * - §2: the company-wide profit report on a KWD tenant — a sale
 *   of 100.125 reports grossSalesRevenue / netSalesRevenue /
 *   totalRevenue / grossProfit / netProfitPool all 100.125.
 * - §3: the command center on a KWD tenant — partner capital
 *   100.125, totalDebtEgp 50.125, and the USD figures pinned at
 *   2dp (unpaidProformaUsd 10.12, totalDebtForeign 10.12,
 *   unpaidForeignUsd 10.12).
 * - §4: static pins — no toFixed(2) left in hr-advances; exactly
 *   3 left in the profit report (the USD sites); roundMoney call
 *   counts 6 + 30; the allowlist entries moved (6->0, 32->3);
 *   the engine-map money row cites the INV and drops the closed
 *   items while keeping the deferred ones; the deferred files'
 *   allowlist counts are untouched (7 + 7).
 * - §5: the INV exists exactly once in
 *   ARCHITECTURE_INVARIANTS.md + the guard tail exactly once.
 * - §6: wiring 409 in both lists, this spec last, all earlier
 *   specs re-pinned.
 * - §7: the re-pin sweep is complete (no stale count,
 *   last-entry, or guard INV).
 * - §8: the guard re-pin list (every earlier spec's guard
 *   assertion points at the new INV).
 * - §9: boundary / frontend / baseline / write pins do not
 *   move (backend 740 ceiling, delivery-reps->accounting 109,
 *   frontend 105/44, baselines 57/152, writes 5) and the two
 *   "highest migration" pins still point at 0343 (no migration
 *   in this package).
 *
 * Wiring: both critical lists carry 409 specs in identical
 * order, this spec last.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const ENGINE_MAP = path.join(REPO_ROOT, 'docs', 'ENGINE_MAP.md');
const HR_ADVANCES = path.join(BACKEND, 'src', 'modules', 'hr', 'services', 'hr-advances.service.ts');
const PROFIT_REPORT = path.join(
  BACKEND,
  'src',
  'modules',
  'import-sales',
  'services',
  'import-profit-report.service.ts',
);
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
const B8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b8-delivery-reps-sales.spec.ts');
const F2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f2-feature-public-indices.spec.ts');
const F3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f3-feature-boundary-legs.spec.ts');
const F4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f4-settings-access-door.spec.ts');
const F5A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5a-audit-settings.spec.ts');
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const F5C_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5c-accounts-purchases.spec.ts');
const F5D_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5d-maintenance-products.spec.ts');
const F5E_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5e-accounting-treasury.spec.ts');
const F5F_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5f-cash-drawer-pos.spec.ts');
const F5G_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5g-customers-sales.spec.ts');
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const F5I_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5i-pos-settings.spec.ts');
const F5H_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-sales-envelope-check.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const F5K_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5k-pos-products.spec.ts');
const F5J_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-repair-expiry-spec-import.spec.ts');
const F5L_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-pos-storefront.spec.ts');
const F5L_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-repair-bundle-budget.spec.ts');
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const D_M3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m3-mail-nested.spec.ts');
const D_D10A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-d10a-serials-payload.spec.ts');
const DISCOUNT_FIX_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-discount-fix-line-amount.spec.ts');
const CLEANUP_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-cleanup-as-any-reduction.spec.ts');
const P1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p1-frontend-lint.spec.ts');
const P2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p2-dev-passcode.spec.ts');
const P3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p3-van-writer.spec.ts');
const REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-repair-type-imports.spec.ts');
const S1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s1-fx-maritime-close-asof.spec.ts');
const S2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s2-maritime-settlement-idempotency.spec.ts');
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';

const NEW_INV = 'INV-MONEY-PRECISION-HR-IMPORT-3DP';
const NEW_SPEC_NAME = 'phase1-final-s3-money-precision-hr-import.spec.ts';

const HR_AUTH = {
  userId: 1,
  sessionId: 'sess-spec',
  username: 'actor-1',
  role: 'admin',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

async function makeHrDb(currency: string): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`SET TIME ZONE 'UTC'`);
  await pg.exec(`
    CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
    CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, hire_date date);
    CREATE TABLE hr_employee_loans (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, loan_no text, loan_type text, principal_amount numeric, paid_amount numeric, remaining_amount numeric, installment_count int, installment_amount numeric, repayment_mode text, monthly_installment_amount numeric, status text, issue_date date, first_due_date date, salary_due_date date, created_by bigint, notes text, created_at timestamptz, updated_at timestamptz, approved_at timestamptz, disbursed_at timestamptz, branch_id bigint, location_id bigint);
    CREATE TABLE hr_employee_ledger (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, reference_id bigint, reference_type text, entry_type text, amount numeric, balance_after numeric, repayment_method text, note text, created_by bigint, created_at timestamptz);
    CREATE TABLE hr_employee_loan_installments (id bigint PRIMARY KEY, tenant_id text, loan_id bigint, paid_at timestamptz);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text);
    INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'timezone', 'Africa/Cairo'), ('t1', 'currency', '"${currency}"');
    INSERT INTO hr_employees (id, tenant_id, display_name, hire_date) VALUES (1, 't1', 'Test Employee', '2020-01-01');
    INSERT INTO users (id, tenant_id, display_name, username) VALUES (1, 't1', 'Admin User', 'admin');
    INSERT INTO hr_employee_loans (id, tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, paid_amount, remaining_amount, installment_count, installment_amount, repayment_mode, monthly_installment_amount, status, issue_date, created_by, notes, created_at, updated_at, disbursed_at) VALUES
      (1, 't1', 'a1', 1, 'L001', 'loan', 100.125, 0.00, 100.125, 10, 100.00, 'manual_cash', NULL, 'disbursed', '2026-01-10', 1, '', '2026-01-09 08:00:00+00', '2026-01-09 08:00:00+00', '2026-01-10 09:00:00+00');
  `);
  return { pg, db };
}

function makeHrService(db: Kysely<Database>): HrService {
  return new HrService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    {} as never,
    undefined,
  );
}

async function makeProfitDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
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
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, return_type text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, qty numeric, line_total numeric, cost_price numeric);
    CREATE TABLE import_partner_ledger (id bigserial PRIMARY KEY, tenant_id text, type text, amount numeric);
    CREATE TABLE import_suppliers_meta (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, audit_status text);
    CREATE TABLE import_aci_compliance (id text PRIMARY KEY, tenant_id text, status text, acid_expiry_date date);
    INSERT INTO settings VALUES ('t1', 'currency', '"KWD"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'KWD', 1, true), ('t1', 'USD', 50, false);
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
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 50.125, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects (id, tenant_id, title, project_no, allocated_capital, status, feasibility_data, closure_data, created_at) VALUES ('proj-1', 't1', 'Project One', 'IMP-261102-0001', 100, 'active', '{}', NULL, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', NULL, NULL, 10, 0, 2000, 0, 0, NULL, NULL, NULL, NULL, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 10, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
    INSERT INTO import_customs_brokers VALUES ('br-1', 't1', 'Broker One', NULL, NULL, 'Alexandria', NULL, NOW());
    INSERT INTO sales VALUES (1, 't1', 'completed', NOW());
    INSERT INTO sale_items VALUES (1, 1, 1, 1, 100.125, 0, 0);
    INSERT INTO import_proforma_invoices (id, tenant_id, pi_number, supplier_id, currency, total_amount_foreign, paid_amount_foreign, exchange_rate_contract, payment_status, status) VALUES ('pi-1', 't1', 'PI-1', 1, 'USD', 10.124, 0, 50, 'unpaid', 'open');
    INSERT INTO import_partner_ledger (tenant_id, type, amount) VALUES ('t1', 'DEPOSIT', 100.125);
  `);
  return { pg, db };
}

function makeProfitService(db: Kysely<Database>): any {
  const fakeFoundation: any = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  };
  const posting = new AccountingPostingService(fakeFoundation);
  return new (ImportSalesService as any)(db, posting);
}

async function main(): Promise<void> {
  // §1: HR withdrawals on a KWD tenant — the six summary totals keep
  // the third digit. The old code reported 100.13 on both.
  {
    const { db } = await makeHrDb('KWD');
    try {
      const hr = makeHrService(db);
      const result = (await hr.withdrawals({ employeeId: 1, period: 'all' }, HR_AUTH)) as any;
      assert.equal(result.rows.length, 1, 'one disbursed loan row must be listed');
      assert.equal(result.summary.totalWithdrawals, 100.125, 'totalWithdrawals must keep 100.125 on a 3dp tenant');
      assert.equal(result.summary.totalRepayments, 0, 'totalRepayments must be 0 with no ledger rows');
      assert.equal(result.summary.totalManualCashRepayments, 0, 'totalManualCashRepayments must be 0');
      assert.equal(result.summary.totalSalaryDeductionRepayments, 0, 'totalSalaryDeductionRepayments must be 0');
      assert.equal(result.summary.totalRemaining, 100.125, 'totalRemaining must keep 100.125 on a 3dp tenant');
      assert.equal(result.summary.totalSalaryDeductionDue, 0, 'totalSalaryDeductionDue must be 0 (manual_cash mode)');
      assert.equal(result.summary.openLoanCount, 1, 'openLoanCount must be 1');
      console.log('  ✓ §1: HR withdrawals keep 100.125 on a KWD tenant');
    } finally {
      await db.destroy();
    }
  }

  // §1b: CONTROL — the same seed on an EGP tenant still reports
  // 100.13: the fix is digits-aware, not "never round". This
  // passes on the old code too, by design.
  {
    const { db } = await makeHrDb('EGP');
    try {
      const hr = makeHrService(db);
      const result = (await hr.withdrawals({ employeeId: 1, period: 'all' }, HR_AUTH)) as any;
      assert.equal(result.summary.totalWithdrawals, 100.13, 'totalWithdrawals must round to 100.13 on a 2dp tenant');
      assert.equal(result.summary.totalRemaining, 100.13, 'totalRemaining must round to 100.13 on a 2dp tenant');
      console.log('  ✓ §1b: HR withdrawals still round to 100.13 on an EGP tenant');
    } finally {
      await db.destroy();
    }
  }

  // §2: the company-wide profit report on a KWD tenant — a sale of
  // 100.125 reports 100.125 everywhere. The old code reported
  // 100.13 on every figure.
  {
    const { db } = await makeProfitDb();
    try {
      const service = makeProfitService(db);
      const report: any = await service.generatePeriodProfitReport(
        't1',
        new Date('2026-01-01'),
        new Date('2027-12-31'),
      );
      assert.equal(report.success, true, 'the report must succeed');
      assert.equal(report.data.profitBasis, 'COMPANY_WIDE_EXPENSES_TABLE', 'no project means the company-wide path');
      assert.equal(report.data.grossSalesRevenue, 100.125, 'grossSalesRevenue must keep 100.125');
      assert.equal(report.data.salesDiscounts, 0, 'salesDiscounts must be 0');
      assert.equal(report.data.salesReturnsRevenue, 0, 'salesReturnsRevenue must be 0');
      assert.equal(report.data.netSalesRevenue, 100.125, 'netSalesRevenue must keep 100.125');
      assert.equal(report.data.totalRevenue, 100.125, 'totalRevenue must keep 100.125');
      assert.equal(report.data.grossCogs, 0, 'grossCogs must be 0');
      assert.equal(report.data.netCogs, 0, 'netCogs must be 0');
      assert.equal(report.data.totalCost, 0, 'totalCost must be 0');
      assert.equal(report.data.grossProfit, 100.125, 'grossProfit must keep 100.125');
      assert.equal(report.data.operatingExpenses, 0, 'operatingExpenses must be 0');
      assert.equal(report.data.totalExpenses, 0, 'totalExpenses must be 0');
      assert.equal(report.data.netProfitPool, 100.125, 'netProfitPool must keep 100.125');
      console.log('  ✓ §2: profit report keeps 100.125 on a KWD tenant');
    } finally {
      await db.destroy();
    }
  }

  // §3: the command center on a KWD tenant — EGP capital and debt
  // keep the third digit, while the USD figures stay at 2dp (the
  // exemption, pinned here so a later sweep does not "fix" them).
  {
    const { db } = await makeProfitDb();
    try {
      const service = makeProfitService(db);
      const m: any = await service.getImportCommandCenterMetrics('t1');
      assert.deepEqual(
        m.capital,
        { totalCapital: 100.125, deployedCapital: 0, availableCapital: 100.125 },
        'capital must keep 100.125 on a 3dp tenant',
      );
      assert.equal(m.liabilities.totalDebtEgp, 50.125, 'totalDebtEgp must keep 50.125');
      assert.equal(m.liabilities.unpaidProformaUsd, 10.12, 'unpaidProformaUsd stays 2dp (USD)');
      assert.equal(m.liabilities.totalDebtForeign, 10.12, 'totalDebtForeign stays 2dp on the foreign branch (USD)');
      assert.equal(m.liabilities.supplierLiabilities.length, 1, 'one supplier with a balance');
      assert.equal(
        m.liabilities.supplierLiabilities[0].unpaidForeignUsd,
        10.12,
        'supplier unpaidForeignUsd stays 2dp (USD)',
      );
      assert.equal(m.liabilities.supplierLiabilities[0].balanceEgp, 50.125, 'supplier balanceEgp is stored unrounded');
      assert.equal(m.performance.grossSalesRevenue, 100.125, 'the embedded profit report must keep 100.125 too');
      console.log('  ✓ §3: command center keeps EGP 3dp, USD stays 2dp');
    } finally {
      await db.destroy();
    }
  }

  // §4: static pins — the two files round through roundMoney at
  // book digits; the only toFixed(2) left in the profit report
  // are the three USD sites; the allowlist entries moved;
  // the engine-map money row cites the INV and drops the closed
  // items while keeping the deferred ones; the deferred files'
  // allowlist counts are untouched.
  {
    const hr = fs.readFileSync(HR_ADVANCES, 'utf8');
    assert.equal(
      (hr.match(/\.toFixed\(\s*2\s*\)/g) || []).length,
      0,
      'hr-advances.service.ts must carry no toFixed(2) at all',
    );
    assert.equal(
      (hr.match(/roundMoney\(/g) || []).length,
      9,
      'hr-advances.service.ts must round through roundMoney at exactly 9 sites (the six summary totals + the three pre-existing withdrawal-balance/payroll sites)',
    );
    assert.ok(
      hr.includes('const digits = await tenantBookDigits(this.db, tenantId);'),
      'withdrawals must resolve book digits through tenantBookDigits',
    );
    assert.ok(
      hr.includes('INV-MONEY-PRECISION-HR-IMPORT-3DP'),
      'hr-advances.service.ts must cite the new INV in its header',
    );
    const profit = fs.readFileSync(PROFIT_REPORT, 'utf8');
    assert.equal(
      (profit.match(/\.toFixed\(\s*2\s*\)/g) || []).length,
      3,
      'import-profit-report.service.ts must carry exactly 3 toFixed(2) sites (the USD ones)',
    );
    assert.ok(
      profit.includes('unpaidForeignUsd: Number((unpaidProformaBySupplier.get(Number(s.id)) || 0).toFixed(2))'),
      'the unpaidForeignUsd site must stay 2dp (USD)',
    );
    assert.ok(
      profit.includes('unpaidProformaUsd: Number(unpaidProformaForeign.toFixed(2))'),
      'the unpaidProformaUsd site must stay 2dp (USD)',
    );
    assert.ok(
      /totalDebtForeign =\s+unpaidProformaForeign > 0\s+\? Number\(unpaidProformaForeign\.toFixed\(2\)\)\s+: roundMoney\(totalDebtEgp, digits\)/.test(
        profit,
      ),
      'totalDebtForeign must round its foreign branch at 2dp (USD) and its EGP fallback at book digits',
    );
    assert.equal(
      (profit.match(/roundMoney\(/g) || []).length,
      30,
      'import-profit-report.service.ts must round exactly 30 EGP sites through roundMoney',
    );
    assert.ok(
      profit.includes('const digits = currencyMoneyDigits(await tenantBaseCurrency(qb, tenantId));'),
      'generatePeriodProfitReport must resolve book digits through qb (executor-aware)',
    );
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const hrEntry = guard.slice(guard.indexOf("file: 'backend/src/modules/hr/services/hr-advances.service.ts'"));
    assert.ok(
      hrEntry.startsWith("file: 'backend/src/modules/hr/services/hr-advances.service.ts'"),
      'the guard must list hr-advances',
    );
    assert.ok(
      hrEntry.slice(0, 600).includes('toFixed2: 0,'),
      'the guard allowlist must pin hr-advances at 0 toFixed(2)',
    );
    const profitEntry = guard.slice(
      guard.indexOf("file: 'backend/src/modules/import-sales/services/import-profit-report.service.ts'"),
    );
    assert.ok(
      profitEntry.startsWith("file: 'backend/src/modules/import-sales/services/import-profit-report.service.ts'"),
      'the guard must list import-profit-report',
    );
    assert.ok(
      profitEntry.slice(0, 600).includes('toFixed2: 3,'),
      'the guard allowlist must pin import-profit-report at 3 toFixed(2)',
    );
    const preordersEntry = guard.slice(
      guard.indexOf("file: 'backend/src/modules/import-sales/services/import-container-preorders.service.ts'"),
    );
    assert.ok(
      preordersEntry.slice(0, 600).includes('toFixed2: 7,'),
      'the guard allowlist must still pin import-container-preorders at 7 (deferred package)',
    );
    const pricingEntry = guard.slice(guard.indexOf("file: 'backend/src/modules/pricing/pricing.service.ts'"));
    assert.ok(
      pricingEntry.slice(0, 600).includes('toFixed2: 7,'),
      'the guard allowlist must still pin pricing.service.ts at 7 (deferred package)',
    );
    const engineMap = fs.readFileSync(ENGINE_MAP, 'utf8');
    assert.ok(engineMap.includes(NEW_INV), 'the engine-map money row must cite the new INV');
    assert.ok(
      engineMap.includes('the six HR loan-report aggregates now round through roundMoney at tenant book digits'),
      'the engine-map money row must record the closed HR aggregates item',
    );
    assert.ok(
      !engineMap.includes('pricing-preview price-ending, and HR loan-report aggregates'),
      'the engine-map money row must drop the HR aggregates from its open-items list',
    );
    assert.ok(
      engineMap.includes('was already closed (INV-VAN-TRANSFER-LOADED-AMOUNT-3DP)'),
      'the engine-map money row must record the already-closed van loaded_amount item',
    );
    assert.ok(
      !engineMap.includes('`loaded_amount` retail deduction, pricing-preview'),
      'the engine-map money row must drop the van loaded_amount item from its open-items list',
    );
    assert.ok(
      engineMap.includes('price-setting'),
      'the engine-map money row must keep price-setting as an open item (own package)',
    );
    assert.ok(
      engineMap.includes('refund-amount validation'),
      'the engine-map money row must keep the refund-amount validation as an open item (own package)',
    );
    assert.ok(
      engineMap.includes('pricing-preview price-ending'),
      'the engine-map money row must keep pricing-preview price-ending as an open item (own package)',
    );
    console.log('  ✓ §4: static pins (roundMoney counts, allowlist, engine-map row)');
  }

  // §5: The INV entry exists exactly once in both places (never
  // quote another INV id literally in the guard assertion — the
  // slice-2 lesson: the next slice's repin sweep replaces
  // literal guard.match lines only).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-SETTINGS-IMPORT-POSTING-PORT/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §6: Wiring: both critical lists carry 409 specs in identical
  // order, this spec last.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 414);
    assert.equal(chain.length, 414);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 409 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s8-settings-import-posting-port.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s8-settings-import-posting-port.spec.ts');
    for (const [label, specPath] of [
      ['B1', B1_SPEC],
      ['B2', B2_SPEC],
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 414);') && src.includes('assert.equal(chain.length, 414);'),
        `${label} spec wiring must re-pin to 409`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s8-settings-import-posting-port.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §7: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-2 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s2-maritime-settlement-' + 'idempotency.spec.ts';
    const prevInv = 'INV-MARITIME-AGENT-SETTLEMENT-' + 'IDEMPOTENCY';
    const staleSpecs = 'specs.length, 40' + '8';
    const staleChain = 'chain.length, 40' + '8';
    const staleList = 'list.length, 40' + '8';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (408)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-2 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 2)');
  }

  // §8: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1/S2 specs' guard assertions to the new INV; their
  // invariants-file assertions still pin their own id (each line
  // stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
    for (const [label, specPath] of [
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-SETTINGS-IMPORT-POSTING-PORT/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §9: The module-boundary pins do not move in this package
  // (no new import statement: HR resolves digits through the
  // already-imported tenantBookDigits, and the profit report
  // joins roundMoney onto its existing money-minor-units import
  // line — same statement, no new edge and no total move). No
  // migration in this package, so the two "highest migration"
  // pins still point at 0343.
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
      'module-boundary must still pin the backend total 740',
    );
    assert.ok(
      boundary.includes("'delivery-reps->accounting': 109,"),
      'module-boundary must still pin delivery-reps->accounting 109',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
      'module-boundary must still pin the frontend total 105',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      'module-boundary must still pin 63 backend edges',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
      'module-boundary must still pin 44 frontend edges',
    );
    assert.ok(
      boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
      'module-boundary must still pin the frontend edge floor 44',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
      'the frontend bidirectional pair list must stay empty',
    );
    const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
    assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
    const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
    assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');
    const writesSpec = fs.readFileSync(WRITES_SPEC, 'utf8');
    const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
    assert.ok(
      writesSpec.includes('const PINNED_WRITE_COUNT = 5;'),
      'stock-movements-writes must pin the write count 5',
    );
    assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
    for (const [label, specPath] of [
      ['deposit-3dp', DEPOSIT_3DP_SPEC],
      ['van-transfer-3dp', VAN_TRANSFER_3DP_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const HIGHEST_MIGRATION_FILE = '${MIGRATION_FILE}';`),
        `${label} spec highest-migration pin must re-point to 0345`,
      );
      assert.ok(
        src.includes('the 0345 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must re-point to 0345`,
      );
    }
  }

  console.log('phase1 final slice 3 checks passed (money precision HR + import, 409 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
