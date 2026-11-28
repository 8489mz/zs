import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { migration } from '../../src/database/migrations/2040000000345_import_fx_payout_idempotency_keys';

/*
 * Phase 1 final-inspection slice 6 — service-level idempotency keys
 * for recordFxAcquisition + recordPartnerPayout.
 *
 * THE RULE (R2 review, grounded at 54b2d26): the import-sales
 * controller already carries the class-wide interceptor, so an HTTP
 * retry WITH a key header is protected. The gap is SERVICE-level:
 * recordFxAcquisition inserts into import_fx_acquisitions
 * unconditionally (no key column, no unique index) and
 * recordPartnerPayout has no key path at all — a direct service
 * call, or any path that bypasses the controller interceptor,
 * double-applies (FX) or fails at the already-consumed approval
 * instead of replaying (payout). This package adds the optional
 * DTO idempotencyKey + the in-transaction pre-check + replay in
 * both services, backed by migration 0345 (partial unique indexes
 * on (tenant_id, idempotency_key) for both tables).
 *
 * WHAT THIS PINS, driving the REAL ImportSalesService facade on
 * PGlite (no mocks of the services, the posting service or the
 * migration):
 * - §1: a keyed FX retry returns the original acquisition (same
 *   serial, same journal) with one row, one journal and one leg
 *   pair; a same-key different-amount retry Conflicts loudly.
 * - §2: a keyed payout retry returns the original response
 *   (same ledger / journal / treasury ids) with one payout row,
 *   one ledger row and the profit withdrawn once; a same-key
 *   different-amount retry Conflicts loudly.
 * - §3: the real migration 0345 on PGlite — up / down /
 *   duplicate-23505 / loud refusal / NULL rows.
 * - §4: CONTROLS — keyless FX double-books (the gap, still open
 *   without a frontend key); a keyless payout retry fails at the
 *   consumed approval; the interceptor stays exactly one
 *   class-wide decorator on the controller.
 * - §5: static pins — DTO fields, controller header wiring,
 *   facade pass-through, both services' key handling, the
 *   migration file, the engine-map idempotency row.
 * - §6: the INV entry exists exactly once in both places.
 * - §7: wiring 412 in both lists, this spec last.
 * - §8: the re-pin sweep is complete (no stale count,
 *   last-entry or guard id remains).
 * - §9: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §10: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5)
 *   and the "highest migration" pins re-point to 0345.
 *
 * RED-1: run this spec BEFORE the two service methods learn
 * the key path — §1 fails (two acquisition rows) and §2 fails
 * (the retry throws the approval-consumed error). The migration,
 * DTO fields and controller wiring are inert without the service
 * handling, so they are already in place at RED-1 time.
 * PGlite note: every key read runs on the tx handle inside the
 * transaction, or on the pool outside it — never a pool read
 * inside an open transaction.
 *
 * Wiring: both critical lists carry 412 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const BACKEND_SRC = path.join(BACKEND, 'src');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const ENGINE_MAP = path.join(REPO_ROOT, 'docs', 'ENGINE_MAP.md');
const MIGRATIONS_DIR = path.join(BACKEND, 'src', 'database', 'migrations');
const TREASURY_SERVICE = path.join(BACKEND, 'src', 'modules', 'import-sales', 'services', 'import-treasury.service.ts');
const PARTNERS_SERVICE = path.join(
  BACKEND,
  'src',
  'modules',
  'import-sales',
  'services',
  'import-projects-partners.service.ts',
);
const FX_DTO = path.join(
  BACKEND,
  'src',
  'modules',
  'import-sales',
  'dto',
  'import-sales-dto',
  'import-sales-dto-preorders-fx.ts',
);
const PAYOUT_DTO = path.join(
  BACKEND,
  'src',
  'modules',
  'import-sales',
  'dto',
  'import-sales-dto',
  'import-sales-dto-documents-approvals.ts',
);
const IMPORT_CONTROLLER = path.join(BACKEND, 'src', 'modules', 'import-sales', 'import-sales.controller.ts');
const IMPORT_FACADE = path.join(BACKEND, 'src', 'modules', 'import-sales', 'import-sales.service.ts');
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
const S3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s3-money-precision-hr-import.spec.ts');
const S4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s4-legacy-doc-numbers.spec.ts');
const S5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s5-business-date-r3.spec.ts');
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';

const NEW_INV = 'INV-IMPORT-FX-PAYOUT-IDEMPOTENCY';
const NEW_SPEC_NAME = 'phase1-final-s6-import-fx-payout-idempotency.spec.ts';

async function makeDb(): Promise<Kysely<Database>> {
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
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sourcing_trips (id text PRIMARY KEY DEFAULT ('trip-' || md5(random()::text)), tenant_id text, project_id text, actual_cost_egp numeric, start_date text, journal_entry_id bigint);
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text);
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, approved_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE import_broker_advances (id text PRIMARY KEY DEFAULT ('badv-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, project_id text, shipment_id text, advance_no text, amount_egp numeric, disbursement_date text, payment_method text, treasury_account_id bigint, status text, settled_amount_egp numeric, remaining_amount_egp numeric, notes text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date text, expected_return_date text, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, notes text, actual_return_date text, deduction_reason text, updated_at timestamptz DEFAULT NOW(), created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_refund_events (id text PRIMARY KEY DEFAULT ('ref-' || md5(random()::text)), serial_id bigserial, tenant_id text, deposit_id text, idempotency_key text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, created_by bigint, journal_entry_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE purchases (id text PRIMARY KEY DEFAULT ('pur-' || md5(random()::text)), tenant_id text, import_project_id text, doc_no text, total numeric, paid_amount numeric, status text);
    CREATE TABLE import_project_partners (id text PRIMARY KEY DEFAULT ('pp-' || md5(random()::text)), tenant_id text, project_id text, partner_id text, profit_percentage numeric, capital_share_amount numeric, is_active boolean);
    CREATE TABLE import_partners (id text PRIMARY KEY DEFAULT ('par-' || md5(random()::text)), tenant_id text, name text, withdrawn_profit numeric, profit_share_percentage numeric, capital_amount numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, treasury_transaction_id bigint, amount_egp numeric, created_by bigint, idempotency_key text, created_at timestamptz DEFAULT NOW());
    CREATE UNIQUE INDEX uq_partner_payouts_tenant_key ON import_partner_project_payouts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE import_partner_ledger (id text PRIMARY KEY DEFAULT ('pl-' || md5(random()::text)), tenant_id text, partner_id text, type text, amount numeric, transaction_date timestamptz, note text, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text);
    CREATE UNIQUE INDEX uq_partner_ledger_tenant_partner_key ON import_partner_ledger (tenant_id, partner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE import_fx_acquisitions (id text PRIMARY KEY DEFAULT ('fx-' || md5(random()::text)), serial_id bigserial, tenant_id text, currency text, foreign_amount numeric, egp_cost numeric, effective_exchange_rate numeric, acquisition_date text, source text, bank_account_id bigint, notes text, journal_entry_id bigint, supplier_payment_id bigint, idempotency_key text, created_at timestamptz DEFAULT NOW());
    CREATE UNIQUE INDEX uq_fx_acquisitions_tenant_key ON import_fx_acquisitions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, retail_price numeric, wholesale_price numeric, supplier_id bigint, category_id bigint, notes text, metadata text, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings VALUES (1, 't1', NULL, NULL, NULL, NULL, NULL, 12, 12, NULL, 22, 21, NULL, 23, NOW());
    INSERT INTO accounting_accounts VALUES
      (12, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1120', 'البنك', 'Bank', 'asset', 'cash_bank', true, true, false, false, false, false),
      (27, 't1', 't1', '1110', 'الخزينة', 'Cash', 'asset', 'cash_bank', true, true, false, false, false, false),
      (28, 't1', 't1', '4201', 'أرباح فروق عملة', 'Forex Gain', 'revenue', 'revenues', true, false, false, false, false, false),
      (30, 't1', 't1', '3100', 'رأس مال الشركاء', 'Partner Capital', 'equity', 'equity', true, false, false, false, false, false),
      (1530, 't1', 't1', '1160', 'عهد وسلف موظفين', 'Employee Advances', 'asset', 'current_assets', true, false, false, false, false, false),
      (1537, 't1', 't1', '1100', 'الأصول المتداولة', 'Current Assets', 'asset', 'current_assets', true, false, false, false, false, false),
      (1538, 't1', 't1', '1170', 'مصروفات مدفوعة مقدمًا', 'Prepaid Expenses', 'asset', 'current_assets', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Supplier A', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO import_projects VALUES
      ('proj-1', 't1', 'Project One', 'IMP-261109-0001', 'active', '{}', NULL, NULL, NULL, 100, 'USD', '2026-11-08 00:00:00+00', NOW()),
      ('proj-2', 't1', 'Project Two', 'IMP-261108-0001', 'feasibility', '{}', NULL, NULL, NULL, 100, 'USD', '2026-11-08 00:00:00+00', NOW());
    INSERT INTO import_proforma_invoices (id, tenant_id, pi_number, supplier_id, project_id, currency, total_amount_foreign, paid_amount_foreign, exchange_rate_contract, payment_status, status) VALUES
      ('pi-1', 't1', 'PI-IMP-261109-0001-5287', 1, 'proj-1', 'USD', 10, 10, 50, 'paid', 'approved'),
      ('pi-2', 't1', 'PI-IMP-261108-0001-8359', 1, 'proj-2', 'USD', 10, 0, 50, 'unpaid', 'pending');
    INSERT INTO import_shipments (id, tenant_id, container_number, supplier_id, bill_of_lading, status, project_id, shipping_cost_usd, customs_cost_egp, internal_transport_cost_egp) VALUES
      ('sh-1', 't1', 'MSCU-TEST-001', 1, 'BL-001', 'Arrived', 'proj-1', 5, 100, 50);
    INSERT INTO import_shipment_items (id, tenant_id, shipment_id, product_id, quantity, factory_unit_price_usd, landed_cost_egp, received_quantity, shortage_handling_method) VALUES
      ('sh-1-item', 't1', 'sh-1', 1, 10, 1, 90, 10, 'capitalize');
    INSERT INTO journal_entries (id, tenant_id, account_id, entry_no, entry_date, description, source_type, source_id, status) VALUES
      (1, 't1', 't1', 'JE-00015025', '2026-11-08', 'Import receipt MSCU-TEST-001', 'import_inventory_receipt', 1, 'posted');
    INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, account_id, description, debit, credit, partner_type, partner_id) VALUES
      ('t1', 1, 21, 'Inventory receipt', 900, 0, 'none', NULL),
      ('t1', 1, 22, 'Supplier payable', 0, 900, 'supplier', 1);
    INSERT INTO import_inventory_receipts (id, tenant_id, shipment_id, state, posted_at, created_by, journal_entry_id) VALUES
      (1, 't1', 'sh-1', 'posted', '2026-11-09 00:03:00+00', 1, 1);
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

async function makeApprovedPayout(db: Kysely<Database>, service: any, amount = 100): Promise<string> {
  const real = await service.createApprovalRequest('t1', 1, {
    actionType: 'partner_distribution',
    referenceId: 'par-1',
    requestPayload: { amount, partnerId: 'par-1', projectId: 'proj-1' },
  });
  await approveRequest(db, service, String(real.id));
  return String(real.id);
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any)
    .selectFrom(table)
    .select((eb: any) => eb.fn.countAll().as('c'))
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

function fxDto(overrides: Record<string, unknown> = {}): any {
  return {
    currency: 'USD',
    foreignAmount: 10000,
    acquisitionDate: '2026-01-10',
    source: 'bank',
    bankAccountId: '24',
    sourceAccountId: '27',
    ...overrides,
  };
}

function classBody(src: string, className: string): string {
  const start = src.indexOf(`export class ${className}`);
  assert.ok(start >= 0, `${className} must exist`);
  const next = src.indexOf('export class ', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

function methodSlice(src: string, methodName: string): string {
  const start = src.indexOf(`async ${methodName}(`);
  assert.ok(start >= 0, `${methodName} must exist`);
  return src.slice(start, start + 4000);
}

async function makeMigrationDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE import_fx_acquisitions (id text PRIMARY KEY, serial_id bigserial, tenant_id text, currency text, foreign_amount numeric, egp_cost numeric, effective_exchange_rate numeric, acquisition_date text, source text, bank_account_id bigint, notes text, journal_entry_id bigint, supplier_payment_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_partner_project_payouts (id bigserial PRIMARY KEY, tenant_id text, project_id text, partner_id text, treasury_transaction_id bigint, amount_egp numeric, created_by bigint, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function columnExists(db: Kysely<Database>, table: string, column: string): Promise<boolean> {
  const rows = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}
  `.execute(db);
  return Number(rows.rows[0]?.n ?? 0) === 1;
}

async function indexCount(db: Kysely<Database>, name: string): Promise<number> {
  const rows = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = ${name}
  `.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

async function allKeyIndexesCount(db: Kysely<Database>): Promise<number> {
  return (
    (await indexCount(db, 'uq_fx_acquisitions_tenant_key')) + (await indexCount(db, 'uq_partner_payouts_tenant_key'))
  );
}

async function insertFxKey(db: Kysely<Database>, tenant: string, key: string | null): Promise<void> {
  await (db as any)
    .insertInto('import_fx_acquisitions')
    .values({ id: `fx-${tenant}-${key ?? 'null'}-${Math.random()}`, tenant_id: tenant, idempotency_key: key })
    .execute();
}

async function insertPayoutKey(db: Kysely<Database>, tenant: string, key: string | null): Promise<void> {
  await (db as any)
    .insertInto('import_partner_project_payouts')
    .values({ tenant_id: tenant, project_id: 'proj-1', partner_id: 'par-1', amount_egp: 100, idempotency_key: key })
    .execute();
}

async function withdrawnProfit(db: Kysely<Database>): Promise<number> {
  const row: any = await (db as any)
    .selectFrom('import_partners')
    .select('withdrawn_profit')
    .where('id', '=', 'par-1')
    .where('tenant_id', '=', 't1')
    .executeTakeFirstOrThrow();
  return Number(row.withdrawn_profit || 0);
}

async function main(): Promise<void> {
  // §1: a keyed FX retry returns the original acquisition — one
  // row, one journal, one leg pair; a same-key different-amount
  // retry Conflicts loudly.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const first: any = await service.recordFxAcquisition('t1', 1, fxDto({ idempotencyKey: 'fx-key-1' }));
      assert.equal(Number(first.egp_cost), 500000, '1: the EGP cost is the live rate result (10000 x 50)');
      assert.ok(first.journal_entry_id, '1: the acquisition carries its journal');
      const second: any = await service.recordFxAcquisition('t1', 1, fxDto({ idempotencyKey: 'fx-key-1' }));
      assert.equal(second.serial_id, first.serial_id, '1: the retry returns the original serial');
      assert.equal(second.journal_entry_id, first.journal_entry_id, '1: the retry returns the original journal');
      assert.equal(second.id, first.id, '1: the retry returns the original row');
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 1, '1: one acquisition row, not two');
      assert.equal(await countRows(db, 'journal_entries'), 2, '1: one FX journal on top of the seeded receipt');
      assert.equal(await countRows(db, 'treasury_transactions'), 2, '1: one leg pair, not two');
      await assert.rejects(
        async () => service.recordFxAcquisition('t1', 1, fxDto({ idempotencyKey: 'fx-key-1', foreignAmount: 20000 })),
        /IMPORT_FX_ACQUISITION_DUPLICATE_KEY/,
        '1: the same key with a different amount must Conflict loudly, not silently replay',
      );
      assert.equal(await countRows(db, 'import_fx_acquisitions'), 1, '1: the refused retry adds no row');
      console.log('  ✓ §1 keyed FX retry replays the original; mismatch Conflicts');
    } finally {
      await db.destroy();
    }
  }

  // §2: a keyed payout retry returns the original response —
  // one payout row, one ledger row, the profit withdrawn once;
  // a same-key different-amount retry Conflicts loudly.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const approvalId = await makeApprovedPayout(db, service, 100);
      const first: any = await service.recordPartnerPayout(
        't1',
        1,
        'par-1',
        100,
        approvalId,
        'proj-1',
        '12',
        'pay-key-1',
      );
      assert.equal(first.success, true, '2: the first payout must succeed');
      const second: any = await service.recordPartnerPayout(
        't1',
        1,
        'par-1',
        100,
        approvalId,
        'proj-1',
        '12',
        'pay-key-1',
      );
      assert.deepEqual(second, first, '2: the retry returns the identical original response');
      assert.equal(await countRows(db, 'import_partner_project_payouts'), 1, '2: one payout row, not two');
      assert.equal(await countRows(db, 'import_partner_ledger'), 1, '2: one ledger row, not two');
      assert.equal(await countRows(db, 'treasury_transactions'), 1, '2: one treasury leg, not two');
      assert.equal(await countRows(db, 'journal_entries'), 2, '2: one payout journal on top of the seeded receipt');
      assert.equal(await withdrawnProfit(db), 100, '2: the profit is withdrawn once, not twice');
      await assert.rejects(
        async () => service.recordPartnerPayout('t1', 1, 'par-1', 50, approvalId, 'proj-1', '12', 'pay-key-1'),
        /IMPORT_PARTNER_PAYOUT_DUPLICATE_KEY/,
        '2: the same key with a different amount must Conflict loudly, not silently replay',
      );
      assert.equal(await countRows(db, 'import_partner_project_payouts'), 1, '2: the refused retry adds no row');
      assert.equal(await withdrawnProfit(db), 100, '2: the refused retry withdraws nothing more');
      console.log('  ✓ §2 keyed payout retry replays the original; mismatch Conflicts');
    } finally {
      await db.destroy();
    }
  }

  // §3: the real migration 0345 on PGlite — up / down /
  // duplicate-23505 / loud refusal / NULL rows.
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3a: up() adds both columns + both indexes and is idempotent');
      await migration.up(db as any);
      assert.equal(
        await columnExists(db, 'import_fx_acquisitions', 'idempotency_key'),
        true,
        '3a: the FX key column must exist after up()',
      );
      assert.equal(
        await columnExists(db, 'import_partner_project_payouts', 'idempotency_key'),
        true,
        '3a: the payout key column must exist after up()',
      );
      assert.equal(await allKeyIndexesCount(db), 2, '3a: up() must create both unique indexes');
      await migration.up(db as any);
      assert.equal(await allKeyIndexesCount(db), 2, '3a: up() must be idempotent (up -> up keeps exactly two indexes)');
      console.log('  ✓ both columns + both indexes created once, up -> up stable');
    } finally {
      await db.destroy();
    }
  }
  for (const table of ['import_fx_acquisitions', 'import_partner_project_payouts'] as const) {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log(`Case 3b (${table}): duplicate key fails 23505; tenant scoping kept`);
      await migration.up(db as any);
      const insert = table === 'import_fx_acquisitions' ? insertFxKey : insertPayoutKey;
      await insert(db, 't1', 'dup-key-1');
      await assert.rejects(
        async () => insert(db, 't1', 'dup-key-1'),
        (err: any) => err?.code === '23505',
        `A duplicate key for the same tenant in ${table} must fail with 23505`,
      );
      await insert(db, 't2', 'dup-key-1');
      assert.equal(await countRows(db, table), 2, `Two rows must exist in ${table} (t1 + t2, same key)`);
      console.log(`  ✓ 23505 on duplicate in ${table}, other tenant fine`);
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3c: down() removes the guard — duplicate then lands (fail-without-fix sensitivity)');
      await migration.up(db as any);
      await insertFxKey(db, 't1', 'down-key-1');
      await assert.rejects(
        async () => insertFxKey(db, 't1', 'down-key-1'),
        (err: any) => err?.code === '23505',
        'Duplicate must fail while the index exists',
      );
      await migration.down(db as any);
      assert.equal(await allKeyIndexesCount(db), 0, 'down() must remove both indexes');
      assert.equal(
        await columnExists(db, 'import_fx_acquisitions', 'idempotency_key'),
        false,
        'down() must drop the FX key column',
      );
      assert.equal(
        await columnExists(db, 'import_partner_project_payouts', 'idempotency_key'),
        false,
        'down() must drop the payout key column',
      );
      await migration.up(db as any);
      assert.equal(await allKeyIndexesCount(db), 2, 'A final up() must restore both indexes');
      console.log('  ✓ down drops the guard, up restores it');
    } finally {
      await db.destroy();
    }
  }
  for (const table of ['import_fx_acquisitions', 'import_partner_project_payouts'] as const) {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log(`Case 3d (${table}): up() refuses loudly on pre-existing duplicates and leaves no index`);
      // The column exists before the index here (a partial state):
      // the pre-check is written for exactly this shape.
      await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.execute(db);
      const insert = table === 'import_fx_acquisitions' ? insertFxKey : insertPayoutKey;
      await insert(db, 't1', 'pre-key-1');
      await insert(db, 't1', 'pre-key-1');
      await assert.rejects(
        async () => migration.up(db as any),
        new RegExp(`import-sales idempotency backstop refused: ${table} already holds 1 duplicate`),
        `up() must refuse loudly on pre-existing duplicates in ${table}, naming the table`,
      );
      assert.equal(await allKeyIndexesCount(db), 0, 'A refused up() must leave no index behind');
      console.log(`  ✓ loud refusal in ${table}, no index created`);
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3e: NULL keys do not block up() (unique indexes permit multiple NULLs)');
      for (const table of ['import_fx_acquisitions', 'import_partner_project_payouts'] as const) {
        await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.execute(db);
        const insert = table === 'import_fx_acquisitions' ? insertFxKey : insertPayoutKey;
        await insert(db, 't1', null);
        await insert(db, 't1', null);
      }
      await migration.up(db as any);
      assert.equal(await allKeyIndexesCount(db), 2, 'up() must succeed with legacy NULL keys present');
      console.log('  ✓ NULL rows are not duplicates');
    } finally {
      await db.destroy();
    }
  }

  // §4: CONTROLS — without a key the gap is still there (the
  // frontend sends no keys today); the interceptor stays exactly
  // one class-wide decorator.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await service.recordFxAcquisition('t1', 1, fxDto());
      await service.recordFxAcquisition('t1', 1, fxDto());
      assert.equal(
        await countRows(db, 'import_fx_acquisitions'),
        2,
        '4: keyless FX double-books (the gap, still open without a frontend key)',
      );
      assert.equal(await countRows(db, 'journal_entries'), 3, '4: two FX journals on top of the seeded receipt');
      assert.equal(await countRows(db, 'treasury_transactions'), 4, '4: two leg pairs without a key');
      console.log('  ✓ keyless FX still double-books (gap proven; the key is what closes it)');
    } finally {
      await db.destroy();
    }
  }
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const approvalId = await makeApprovedPayout(db, service, 100);
      const first: any = await service.recordPartnerPayout('t1', 1, 'par-1', 100, approvalId, 'proj-1', '12');
      assert.equal(first.success, true, '4: the first keyless payout must succeed');
      await assert.rejects(
        async () => service.recordPartnerPayout('t1', 1, 'par-1', 100, approvalId, 'proj-1', '12'),
        /تم استهلاكه/,
        '4: a keyless retry with the same approval must fail at the consumed approval, not replay',
      );
      assert.equal(await countRows(db, 'import_partner_project_payouts'), 1, '4: the failed retry adds no payout row');
      console.log('  ✓ keyless payout retry still errors at the consumed approval (gap proven)');
    } finally {
      await db.destroy();
    }
  }
  {
    const controller = fs.readFileSync(IMPORT_CONTROLLER, 'utf8');
    const occurrences = (controller.match(/@UseInterceptors\(IdempotencyInterceptor\)/g) || []).length;
    assert.equal(
      occurrences,
      1,
      '4: the controller must carry exactly one IdempotencyInterceptor decorator (class-wide)',
    );
    assert.ok(
      controller.indexOf('@UseInterceptors(IdempotencyInterceptor)') <
        controller.indexOf('export class ImportSalesController'),
      '4: the single decorator must sit above the controller class',
    );
    for (const method of ['recordFxAcquisition(', 'recordPartnerPayout('] as const) {
      const idx = controller.indexOf(`async ${method}`);
      assert.ok(idx > 0, `4: ${method} must exist on the controller`);
      const routeIdx = controller.lastIndexOf('@Post(', idx);
      assert.ok(
        !controller.slice(routeIdx, idx).includes('@UseInterceptors'),
        `4: ${method} must carry no per-method interceptor (the class-wide one is the coverage)`,
      );
    }
    console.log('  ✓ interceptor stays exactly one class-wide decorator');
  }

  // §5: static pins — the DTO fields, the controller header
  // wiring, the facade pass-through, both services' key
  // handling, the migration file, the engine-map row.
  {
    const fxDtoSrc = classBody(fs.readFileSync(FX_DTO, 'utf8'), 'RecordFxAcquisitionDto');
    assert.ok(fxDtoSrc.includes('idempotencyKey?: string;'), '5: RecordFxAcquisitionDto must carry the optional key');
    assert.ok(fxDtoSrc.includes('@MaxLength(128)'), '5: the FX key must be capped at 128 chars');
    const payoutDtoSrc = classBody(fs.readFileSync(PAYOUT_DTO, 'utf8'), 'RecordPartnerPayoutDto');
    assert.ok(
      payoutDtoSrc.includes('idempotencyKey?: string;'),
      '5: RecordPartnerPayoutDto must carry the optional key',
    );
    assert.ok(payoutDtoSrc.includes('@MaxLength(128)'), '5: the payout key must be capped at 128 chars');
    const controller = fs.readFileSync(IMPORT_CONTROLLER, 'utf8');
    for (const method of ['recordFxAcquisition', 'recordPartnerPayout'] as const) {
      const slice = methodSlice(controller, method);
      assert.ok(slice.includes("@Headers('x-idempotency-key')"), `5: ${method} must read the x-idempotency-key header`);
      assert.ok(
        slice.includes('dto.idempotencyKey = headerIdempotencyKey;'),
        `5: ${method} must copy the header into the DTO key`,
      );
    }
    const payoutSlice = methodSlice(controller, 'recordPartnerPayout');
    assert.ok(payoutSlice.includes('dto.idempotencyKey,'), '5: the payout endpoint must pass the key to the facade');
    const facade = fs.readFileSync(IMPORT_FACADE, 'utf8');
    const facadeSlice = methodSlice(facade, 'recordPartnerPayout');
    assert.ok(facadeSlice.includes('idempotencyKey?: string,'), '5: the facade payout must take the optional key');
    assert.ok(facadeSlice.includes('idempotencyKey,'), '5: the facade payout must pass the key to the slice service');
    const treasury = fs.readFileSync(TREASURY_SERVICE, 'utf8');
    assert.ok(
      treasury.includes("const suppliedKey = typeof dto.idempotencyKey === 'string' ? dto.idempotencyKey.trim() : '';"),
      '5: the FX service must read the DTO key',
    );
    assert.ok(treasury.includes('IMPORT_FX_ACQUISITION_KEY_INVALID'), '5: the FX key must be validated');
    assert.ok(
      treasury.includes('this.replayFxAcquisition(trx, tenantId, dto, suppliedKey)'),
      '5: the FX service must pre-check the key inside the transaction',
    );
    assert.ok(treasury.includes('idempotency_key: suppliedKey || null,'), '5: the FX insert must store the key');
    assert.ok(treasury.includes('private async replayFxAcquisition('), '5: the FX replay helper must exist');
    assert.ok(
      treasury.includes('this.replayFxAcquisition(this.db, tenantId, dto, suppliedKey)'),
      '5: the FX catch must replay the committed row',
    );
    assert.ok(treasury.includes('IMPORT_FX_ACQUISITION_DUPLICATE_KEY'), '5: the FX mismatch must Conflict loudly');
    const partners = fs.readFileSync(PARTNERS_SERVICE, 'utf8');
    assert.ok(
      partners.includes("const effectiveKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';"),
      '5: the payout service must read the key',
    );
    assert.ok(partners.includes('IMPORT_PARTNER_PAYOUT_KEY_INVALID'), '5: the payout key must be validated');
    assert.ok(
      partners.includes('this.replayPayout(trx, tenantId, partnerId, effectiveKey, cleanAmount, targetProjectId)'),
      '5: the payout service must pre-check the key before consuming the approval',
    );
    assert.equal(
      (partners.match(/idempotency_key: effectiveKey \|\| null,/g) || []).length,
      2,
      '5: both payout writes (payout row + ledger row) must store the key',
    );
    assert.ok(partners.includes('private async replayPayout('), '5: the payout replay helper must exist');
    assert.ok(
      partners.includes('this.replayPayout(this.db, tenantId, partnerId, effectiveKey, cleanAmount, projectId)'),
      '5: the payout catch must replay the committed row',
    );
    assert.ok(partners.includes('IMPORT_PARTNER_PAYOUT_DUPLICATE_KEY'), '5: the payout mismatch must Conflict loudly');
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'))
      .sort();
    assert.ok(files.includes(MIGRATION_FILE), '5: the 0345 migration file must exist in the migrations directory');
    const engineMap = fs.readFileSync(ENGINE_MAP, 'utf8');
    assert.ok(engineMap.includes(NEW_INV), '5: the engine-map idempotency row must cite the new INV');
    assert.ok(engineMap.includes('uq_fx_acquisitions_tenant_key'), '5: the engine-map row must state the FX backstop');
    assert.ok(
      engineMap.includes('uq_partner_payouts_tenant_key'),
      '5: the engine-map row must state the payout backstop',
    );
    assert.ok(engineMap.includes('seven service methods'), '5: the engine-map row must count seven keyed methods');
    assert.ok(
      engineMap.includes('a keyless retry with no supplied reference still double-books'),
      '5: the engine-map row must keep the keyless residual honestly',
    );
    console.log('  ✓ §5 DTOs + controller + facade + both services + migration + engine-map row');
  }

  // §6: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S14/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §7: Wiring: both critical lists carry 412 specs in identical
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
    assert.equal(specs.length, 450);
    assert.equal(chain.length, 450);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 412 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
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
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 450);') && src.includes('assert.equal(chain.length, 450);'),
        `${label} spec wiring must re-pin to 412`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §8: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-5 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s5-business-date-' + 'r3.spec.ts';
    const prevInv = 'INV-BUSINESS-DATE-R3-' + 'CONTINUATION';
    const staleSpecs = 'specs.length, 41' + '1';
    const staleChain = 'chain.length, 41' + '1';
    const staleList = 'list.length, 41' + '1';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (411)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-5 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 5)');
  }

  // §9: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1/S2/S3/S4/S5 specs' guard assertions to the new
  // INV; their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
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
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S14/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §10: The module-boundary pins do not move in this package
  // (a migration + DTO fields + controller header copies add no
  // import statement — no new edge and no total move). The
  // "highest migration" pins re-point to 0345 because this
  // package's migration is the highest on disk (the two 3dp
  // specs, the S2 spec §5/§10, the S3 spec §9, the S4 spec
  // §4/§9 and the S5 spec §9).
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
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes(`const MIGRATION_FILE = '${MIGRATION_FILE}';`),
      'S2 spec migration-file pin must re-point to 0345',
    );
    assert.ok(
      s2Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must re-point to 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration pin must re-point to 0345'),
      'S2 spec §10 pin message must re-point to 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration message must re-point to 0345'),
      'S2 spec §10 message must re-point to 0345',
    );
    const s3Src = fs.readFileSync(S3_SPEC, 'utf8');
    assert.ok(
      s3Src.includes(`const MIGRATION_FILE = '${MIGRATION_FILE}';`),
      'S3 spec migration-file pin must re-point to 0345',
    );
    assert.ok(s3Src.includes('must re-point to 0345'), 'S3 spec highest-migration assertions must re-point to 0345');
    const s4Src = fs.readFileSync(S4_SPEC, 'utf8');
    assert.ok(
      s4Src.includes(
        "import { migration } from '../../src/database/migrations/2040000000344_legacy_document_number_unique_indexes';",
      ),
      'S4 spec must still drive the real 0344 migration (its own migration under test)',
    );
    assert.ok(
      s4Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S4 spec highest-migration assertion must re-point to 0345',
    );
    assert.ok(
      s4Src.includes('spec highest-migration pin must re-point to 0345'),
      'S4 spec §9 pin message must re-point to 0345',
    );
    const s5Src = fs.readFileSync(S5_SPEC, 'utf8');
    assert.ok(
      s5Src.includes(`const MIGRATION_FILE = '${MIGRATION_FILE}';`),
      'S5 spec migration-file pin must re-point to 0345',
    );
    assert.ok(s5Src.includes('must re-point to 0345'), 'S5 spec highest-migration assertions must re-point to 0345');
  }

  console.log('phase1 final slice 6 checks passed (import FX + payout idempotency, 412 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
