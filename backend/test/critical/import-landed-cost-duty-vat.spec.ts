/*
 * New file: backend/test/critical/import-landed-cost-duty-vat.spec.ts
 * Pins the I2-P6 landed-cost agreement between feasibility and
 * shipment (INV-IMPORT-LANDED-COST-DUTY-VAT).
 *
 * WHAT WAS WRONG (live trial 2026-11-09, problem 6): for the same
 * test goods (10 x $1, freight $5, FX 50) feasibility computed duty
 * 5% (40 EGP) + VAT 14% (117.60 EGP) -> total 1,107.60 EGP
 * (110.76/unit), but the shipment cost model had NO duty/VAT
 * fields — its "جمارك" is a flat EGP fee — so the same goods
 * landed at 90.00/unit (total 900 EGP). The two stages disagreed
 * by 207.60 EGP with no reconciliation.
 *
 * WHAT THIS PINS, driving the REAL engines and the REAL
 * ImportSalesService on PGlite through the real posting boundary:
 * - (a) the same goods compute the same landed cost in both
 *   stages: feasibility total 1,107.60 EGP / 110.76 per unit
 *   equals the shipment breakdown total 1,107.60 / 110.76.
 * - (b) duty and VAT are itemized as separate components
 *   (duty 40.00, VAT 117.60, insurance 50.00, CIF 800.00),
 *   distinct from the flat customs fee.
 * - (c) the receipt journal totals 1,107.60 with itemized
 *   credit lines (goods 500 / freight 250 / insurance 50 /
 *   customs 100 / duty 40 / VAT 117.60 / transport 50), it
 *   balances, and every supplier subledger agrees with its
 *   own components.
 * - (d) the flat "جمارك" fee still works as a clearance fee
 *   and is never treated as tax: with rates 0, duty and VAT
 *   are 0 while the flat fee still lands in cost; changing
 *   only the flat fee moves the total by exactly that amount
 *   while duty/VAT stay fixed.
 * - (e) a shipment created without feasibility still works:
 *   duty/VAT default to 0, no crash, old totals unchanged
 *   (900.00 for the trial goods without tax).
 * - (f) duty/VAT with no customs payee and no unallocable
 *   reason fails closed with IMPORT_COMPONENT_PAYEE_REQUIRED
 *   before any write (the customs broker is the duty/VAT
 *   payee; no new payee type is invented).
 * - (g) a shipment created from a feasibility carries the
 *   study's duty % / VAT % / insurance, so both stages agree
 *   without re-typing the rates.
 *
 * DELIBERATELY UNCHANGED: the pre-existing refundable-VAT
 * amount path (vat_refundable_egp, excluded from overhead) is
 * untouched — the rate-derived VAT here is capitalized into
 * landed cost exactly as feasibility capitalizes it by default
 * (vatIsRefundable false); no VAT is reclassified to a
 * recoverable/input-tax account and no new GL account or payee
 * type is introduced. Duty is charged on CIF (goods + freight
 * + insurance at the arrival rate) and VAT on (CIF + duty),
 * the same bases the feasibility engine uses.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { calculateImportFeasibility } from '../../src/modules/import-sales/engines/import-feasibility.engine';
import { calculateLandedCostBreakdown } from '../../src/modules/import-sales/engines/import-landed-cost.engine';

// Trial goods, shared by every case: 10 x $1, freight $5,
// insurance $1, customs 5%, VAT 14%, clearance (flat) 100,
// inland transport 50, FX 50.
const TRIAL_ITEM = { id: '1', productId: 1, quantity: 10, factoryUnitPriceUsd: 1 };

function trialFeasibility(): any {
  return calculateImportFeasibility({
    items: [{ name: 'Widget', qty: 10, factoryPriceUsd: 1 }],
    exchangeRateCommercial: 50,
    internationalShippingUsd: 5,
    insuranceUsd: 1,
    customsDutyRatePercent: 5,
    vatRatePercent: 14,
    clearanceAndPortFeesEgp: 100,
    internalTransportEgp: 50,
  });
}

function trialLanded(): any {
  return calculateLandedCostBreakdown({
    items: [TRIAL_ITEM],
    exchangeRate: 50,
    shippingCostUsd: 5,
    insuranceCostUsd: 1,
    customsCostEgp: 100,
    internalTransportCostEgp: 50,
    customsDutyRatePercent: 5,
    vatRatePercent: 14,
  } as any);
}

function testFeasibilityAndShipmentAgree(): void {
  const feas = trialFeasibility();
  assert.equal(feas.customsDutyEgp, 40, 'Feasibility duty must be 5% of CIF 800 = 40');
  assert.equal(feas.customsVatEgp, 117.6, 'Feasibility VAT must be 14% of (800 + 40) = 117.60');
  assert.equal(feas.totalAccountingCostEgp, 1107.6, 'Feasibility total must be 1,107.60');
  assert.equal(feas.items[0].unitLandedCostEgp, 110.76, 'Feasibility unit landed cost must be 110.76');

  const landed: any = trialLanded();
  assert.equal(landed.dutyEgp, 40, 'Shipment duty must be 40.00');
  assert.equal(landed.vatEgp, 117.6, 'Shipment VAT must be 117.60');
  assert.equal(landed.insuranceEgp, 50, 'Shipment insurance must be $1 x 50 = 50');
  assert.equal(landed.cifValueEgp, 800, 'Shipment CIF must be (10 + 5 + 1) x 50 = 800');
  assert.equal(landed.totalOverheadEgp, 607.6, 'Shipment overhead must be 250 + 50 + 100 + 50 + 40 + 117.60 = 607.60');
  assert.equal(landed.items[0].totalItemLandedCostEgp, 1107.6, 'Shipment total must be 1,107.60');
  assert.equal(landed.items[0].landedCostEgp, 110.76, 'Shipment unit landed cost must be 110.76');
  assert.equal(
    landed.items[0].totalItemLandedCostEgp,
    feas.totalAccountingCostEgp,
    'Both stages must agree on the total landed cost for the same goods',
  );
  assert.equal(
    landed.items[0].landedCostEgp,
    feas.items[0].unitLandedCostEgp,
    'Both stages must agree on the per-unit landed cost',
  );
  console.log('Case A passed: feasibility and shipment agree at 1,107.60 / 110.76');
}

function testFlatCustomsIsNeverTax(): void {
  // Rates 0: the flat fee still lands in cost, duty/VAT are 0.
  const noTax: any = calculateLandedCostBreakdown({
    items: [TRIAL_ITEM],
    exchangeRate: 50,
    shippingCostUsd: 5,
    customsCostEgp: 100,
    internalTransportCostEgp: 50,
    customsDutyRatePercent: 0,
    vatRatePercent: 0,
  } as any);
  assert.equal(noTax.dutyEgp, 0, 'Zero duty rate must yield zero duty');
  assert.equal(noTax.vatEgp, 0, 'Zero VAT rate must yield zero VAT');
  assert.equal(noTax.totalOverheadEgp, 400, 'Flat fee still lands: 250 + 100 + 50 = 400');
  assert.equal(noTax.items[0].totalItemLandedCostEgp, 900, 'No-tax total stays the old 900.00');

  // Moving ONLY the flat fee moves the total by exactly that
  // amount while duty/VAT stay fixed — the fee is never folded
  // into the tax.
  const flat150: any = calculateLandedCostBreakdown({
    items: [TRIAL_ITEM],
    exchangeRate: 50,
    shippingCostUsd: 5,
    insuranceCostUsd: 1,
    customsCostEgp: 150,
    internalTransportCostEgp: 50,
    customsDutyRatePercent: 5,
    vatRatePercent: 14,
  } as any);
  assert.equal(flat150.dutyEgp, 40, 'Duty must not move when only the flat fee changes');
  assert.equal(flat150.vatEgp, 117.6, 'VAT must not move when only the flat fee changes');
  assert.equal(flat150.totalOverheadEgp, 657.6, 'Overhead rises by exactly the +50 flat fee');
  console.log('Case B passed: flat customs fee is a clearance fee, never the tax');
}

function testDefaultsWithoutFeasibility(): void {
  // No rates supplied at all (old callers, direct shipments):
  // duty/VAT default to 0, no crash, old totals unchanged.
  const legacy: any = calculateLandedCostBreakdown({
    items: [TRIAL_ITEM],
    exchangeRate: 50,
    shippingCostUsd: 5,
    customsCostEgp: 100,
    internalTransportCostEgp: 50,
  });
  assert.equal(legacy.dutyEgp, 0, 'Omitted duty rate must default to 0');
  assert.equal(legacy.vatEgp, 0, 'Omitted VAT rate must default to 0');
  assert.equal(legacy.items[0].totalItemLandedCostEgp, 900, 'Omitted rates keep the old 900.00 total');
  console.log('Case C passed: shipment without feasibility defaults to 0 tax, no crash');
}

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text, name_en text, account_type text, account_group text, is_active boolean, is_cash_bank boolean, is_inventory boolean, is_payable boolean, is_receivable boolean, is_tax boolean);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, purchase_tax_account_id bigint, sales_tax_account_id bigint, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, cogs_account_id bigint, clearing_account_id bigint, updated_at timestamptz);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, fiscal_year_id bigint, name text, period_number int, start_date date, end_date date, status text, closed_at timestamptz, closed_by bigint, closing_notes text, updated_at timestamptz);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric, is_active boolean, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, supplier_id bigint, tenant_id text, account_id text, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, created_by bigint, created_at date, branch_id bigint, location_id bigint);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, code text, name text, dimension text, budget_amount numeric, parent_id bigint, is_active boolean, description text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), CONSTRAINT uq_cost_centers_tenant_code UNIQUE (tenant_id, code));
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, allocated_capital numeric, status text, feasibility_data text);
    CREATE TABLE import_shipments (id text PRIMARY KEY DEFAULT ('sh-' || md5(random()::text)), tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, funding_type text, customs_duty_rate_percent numeric, vat_rate_percent numeric, insurance_cost_usd numeric, freight_supplier_id bigint, customs_supplier_id bigint, transport_supplier_id bigint, demurrage_supplier_id bigint, unallocable_cost_reason text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_inventory_receipt_reversals (id bigserial PRIMARY KEY, tenant_id text, receipt_id bigint, shipment_id text, approval_request_id text, journal_entry_id bigint, reason text, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, receipt_id));
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, proforma_invoice_id text, payment_method text, form4_number text);
    CREATE TABLE import_proforma_invoices (id text PRIMARY KEY, tenant_id text, project_id text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id text PRIMARY KEY DEFAULT ('alloc-' || md5(random()::text)), tenant_id text, sale_id bigint, sale_item_id bigint, lot_id text, project_id text, shipment_id text, product_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, gross_margin_egp numeric, allocation_type text, reversal_of_allocation_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text, supplier_id bigint, unallocable_reason text);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_approval_requests (id text PRIMARY KEY DEFAULT ('appr-' || md5(random()::text)), tenant_id text, module text, action_type text, reference_id text, requested_by bigint, created_by bigint, status text, request_payload text, decided_by bigint, decision_notes text, rejection_reason text, created_at timestamptz DEFAULT NOW(), decided_at timestamptz, consumed_at timestamptz, consumed_by bigint, updated_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, unit_cost numeric, total_cost numeric, reason text, note text, reference_type text, reference_id bigint, import_receipt_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings (id, tenant_id, customer_receivable_account_id, supplier_payable_account_id, inventory_account_id, sales_revenue_account_id, cogs_account_id, clearing_account_id, updated_at) VALUES (1, 't1', 25, 22, 21, 26, 23, 27, NOW());
    INSERT INTO accounting_accounts VALUES
      (21, 't1', 't1', '1140', 'مخزون', 'Inventory', 'asset', 'assets', true, false, true, false, false, false),
      (22, 't1', 't1', '2110', 'موردون', 'Payables', 'liability', 'liabilities', true, false, false, true, false, false),
      (23, 't1', 't1', '5100', 'تكلفة', 'COGS', 'expense', 'expenses', true, false, false, false, false, false),
      (24, 't1', 't1', '1010', 'بنك', 'Bank', 'asset', 'assets', true, true, false, false, false, false),
      (25, 't1', 't1', '1120', 'عملاء', 'Receivables', 'asset', 'assets', true, false, false, false, true, false),
      (26, 't1', 't1', '4100', 'إيراد مبيعات', 'Sales revenue', 'revenue', 'income', true, false, false, false, false, false),
      (27, 't1', 't1', '2190', 'حساب تسوية', 'Clearing', 'liability', 'liabilities', true, false, false, false, false, false);
    INSERT INTO suppliers VALUES
      (1, 't1', 't1', 'Goods Supplier', '', '', 0, true, NOW()),
      (2, 't1', 't1', 'Carrier', '', '', 0, true, NOW()),
      (3, 't1', 't1', 'Customs Broker', '', '', 0, true, NOW()),
      (4, 't1', 't1', 'Transporter', '', '', 0, true, NOW());
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
    INSERT INTO branches VALUES (1, 't1', 'Main Branch');
    INSERT INTO import_projects (id, tenant_id, project_no, title, allocated_capital, status, feasibility_data) VALUES ('proj-1', 't1', 'IMP-261109-0001', 'اختبار مشروع استيراد 001', 100, 'active', '{}');
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 'W-1', NULL, 0, 0, 0, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES
      ('t1', 't1', 1, NULL, 10, 0, 0),
      ('t1', 't1', 1, NULL, NULL, 0, 0);
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

async function seedTrialShipment(db: Kysely<Database>): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', supplier_id: 1, status: 'Pending',
    exchange_rate_at_arrival: 50, cost_allocation_method: 'value', project_id: 'proj-1',
    shipping_cost_usd: 5, insurance_cost_usd: 1, customs_cost_egp: 100,
    internal_transport_cost_egp: 50, customs_duty_rate_percent: 5, vat_rate_percent: 14,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'sh-1-item', tenant_id: 't1', shipment_id: 'sh-1', product_id: 1,
    quantity: 10, received_quantity: 10, factory_unit_price_usd: 1,
    shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row: any = await (db as any).selectFrom(table).select(sql`count(*)`.as('c')).executeTakeFirstOrThrow();
  return Number(row.c);
}

async function receiptJournalLines(db: Kysely<Database>): Promise<any[]> {
  const entry: any = await (db as any).selectFrom('journal_entries').selectAll()
    .where('source_type', '=', 'import_inventory_receipt').executeTakeFirstOrThrow();
  return (db as any).selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', entry.id).orderBy('id').execute();
}

async function supplierLedgerTotal(db: Kysely<Database>, supplierId: number): Promise<number> {
  const rows: any[] = await (db as any).selectFrom('supplier_ledger').select('amount')
    .where('supplier_id', '=', supplierId).execute();
  return rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

function creditByLabel(lines: any[], label: string): number {
  const line = lines.find((l) => Number(l.credit) > 0 && String(l.description || '').includes(`(${label})`));
  assert.ok(line, `A receipt credit line for (${label}) must exist`);
  return Number(line.credit);
}

async function main(): Promise<void> {
  testFeasibilityAndShipmentAgree();
  testFlatCustomsIsNeverTax();
  testDefaultsWithoutFeasibility();

  // Case D: live recalculation wiring — the service reads the
  // stored duty/VAT/insurance and the stored per-unit cost
  // matches the trial agreement.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedTrialShipment(db);
      const result = await service.calculateLandedCost('t1', 'sh-1');
      assert.equal(result.breakdown.totalOverheadEgp, 607.6, 'Live overhead must be 607.60');
      assert.equal((result.breakdown as any).dutyEgp, 40, 'Live duty must be 40');
      assert.equal((result.breakdown as any).vatEgp, 117.6, 'Live VAT must be 117.60');
      assert.equal(result.breakdown.items[0].landedCostEgp, 110.76, 'Live unit landed cost must be 110.76');
      const stored: any = await (db as any).selectFrom('import_shipment_items')
        .select(['landed_cost_egp']).where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
      assert.equal(Number(stored.landed_cost_egp), 110.76, 'Stored per-unit landed cost must be 110.76');
      console.log('Case D passed: live recalculation carries duty/VAT into the stored landed cost');
    } finally {
      await db.destroy();
    }
  }

  // Case E: the receipt journal totals 1,107.60 with itemized
  // credit lines, balances, and agrees with every subledger.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedTrialShipment(db);
      await service.updateShipmentCosts('t1', 1, 'sh-1', {
        status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
        shippingCostUsd: 5, insuranceCostUsd: 1, customsCostEgp: 100,
        internalTransportCostEgp: 50, customsDutyRatePercent: 5, vatRatePercent: 14,
        freightSupplierId: 2, customsSupplierId: 3, transportSupplierId: 4,
      });
      const receipt: any = await (db as any).selectFrom('import_inventory_receipts').selectAll()
        .where('shipment_id', '=', 'sh-1').executeTakeFirstOrThrow();
      assert.equal(receipt.state, 'posted', 'Receipt must post');
      const lines = await receiptJournalLines(db);
      const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit, 'Receipt journal must balance');
      assert.equal(debit, 1107.6, 'Receipt journal total must be 1,107.60');
      assert.equal(creditByLabel(lines, 'بضاعة'), 500, 'Goods credit must be 500');
      assert.equal(creditByLabel(lines, 'شحن بحري'), 250, 'Freight credit must be 250');
      assert.equal(creditByLabel(lines, 'تأمين شحن'), 50, 'Insurance credit must be 50');
      assert.equal(creditByLabel(lines, 'جمارك وتخليص'), 100, 'Flat customs credit must be 100');
      assert.equal(creditByLabel(lines, 'رسوم جمركية (ضريبة)'), 40, 'Duty credit must be 40');
      assert.equal(creditByLabel(lines, 'ضريبة قيمة مضافة'), 117.6, 'VAT credit must be 117.60');
      assert.equal(creditByLabel(lines, 'نقل داخلي'), 50, 'Transport credit must be 50');
      assert.equal(await supplierLedgerTotal(db, 1), 500, 'Goods supplier subledger agrees');
      assert.equal(await supplierLedgerTotal(db, 2), 300, 'Carrier subledger: freight 250 + insurance 50');
      assert.equal(await supplierLedgerTotal(db, 3), 257.6, 'Customs broker subledger: 100 + 40 + 117.60');
      assert.equal(await supplierLedgerTotal(db, 4), 50, 'Transporter subledger agrees');
      const product: any = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.cost_price), 110.76, 'WAC must be the agreed 110.76 per unit');
      console.log('Case E passed: receipt journal totals 1,107.60 with itemized duty/VAT lines');
    } finally {
      await db.destroy();
    }
  }

  // Case F: duty/VAT with no customs payee and no recorded
  // reason fails closed before any write — even when the flat
  // customs fee itself is zero, so the old customs component
  // cannot be the reason it fails.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedTrialShipment(db);
      await assert.rejects(
        service.updateShipmentCosts('t1', 1, 'sh-1', {
          status: 'Arrived', exchangeRateAtArrival: 50, receiptLocationId: 10,
          shippingCostUsd: 5, insuranceCostUsd: 1, customsCostEgp: 0,
          internalTransportCostEgp: 50, customsDutyRatePercent: 5, vatRatePercent: 14,
          freightSupplierId: 2, transportSupplierId: 4,
        }),
        /IMPORT_COMPONENT_PAYEE_REQUIRED/,
        'Duty/VAT with no customs payee must fail closed',
      );
      assert.equal(await countRows(db, 'import_inventory_receipts'), 0, 'No receipt may exist after a refused posting');
      assert.equal(await countRows(db, 'journal_entries'), 0, 'No journal may exist after a refused posting');
      assert.equal(await countRows(db, 'stock_movements'), 0, 'No stock movement may exist after a refused posting');
      console.log('Case F passed: unattributed duty/VAT fails closed with zero writes');
    } finally {
      await db.destroy();
    }
  }

  // Case G: a shipment created from a feasibility carries the
  // study's duty % / VAT % / insurance.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await (db as any).insertInto('import_projects').values({
        id: 'proj-feas', tenant_id: 't1', status: 'active',
        feasibility_data: JSON.stringify({
          customsDutyRatePercent: 5, vatRatePercent: 14, insuranceUsd: 1,
          internationalShippingUsd: 5, exchangeRateCommercial: 50,
        }),
      }).execute();
      const created: any = await service.createShipment('t1', {
        containerNumber: 'MSCU-TEST-F6', projectId: 'proj-feas',
      });
      assert.equal(Number(created.customs_duty_rate_percent), 5, 'Duty rate must carry from the feasibility');
      assert.equal(Number(created.vat_rate_percent), 14, 'VAT rate must carry from the feasibility');
      assert.equal(Number(created.insurance_cost_usd), 1, 'Insurance must carry from the feasibility');
      console.log('Case G passed: shipment created from feasibility carries duty/VAT/insurance');
    } finally {
      await db.destroy();
    }
  }

  // Case H: a shipment created without feasibility still works —
  // duty/VAT default to 0 and the old totals are unchanged.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const created: any = await service.createShipment('t1', {
        containerNumber: 'MSCU-TEST-NF',
      });
      assert.equal(Number(created.customs_duty_rate_percent ?? 0), 0, 'Duty rate must default to 0');
      assert.equal(Number(created.vat_rate_percent ?? 0), 0, 'VAT rate must default to 0');
      assert.equal(Number(created.insurance_cost_usd ?? 0), 0, 'Insurance must default to 0');
      await db.insertInto('import_shipment_items' as never).values({
        id: 'nf-item', tenant_id: 't1', shipment_id: created.id, product_id: 1,
        quantity: 10, received_quantity: 10, factory_unit_price_usd: 1,
        shortage_handling_method: 'capitalize',
      } as never).execute();
      await (db as any).updateTable('import_shipments' as never).set({
        exchange_rate_at_arrival: 50, shipping_cost_usd: 5,
        customs_cost_egp: 100, internal_transport_cost_egp: 50,
      } as never).where('id', '=', created.id).execute();
      const result = await service.calculateLandedCost('t1', created.id);
      assert.equal(result.breakdown.totalOverheadEgp, 400, 'No-feasibility overhead stays 250 + 100 + 50 = 400');
      assert.equal(result.breakdown.items[0].totalItemLandedCostEgp, 900, 'No-feasibility total stays the old 900.00');
      console.log('Case H passed: shipment without feasibility defaults to 0 tax, no crash');
    } finally {
      await db.destroy();
    }
  }

  console.log('Import landed cost duty/VAT tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
