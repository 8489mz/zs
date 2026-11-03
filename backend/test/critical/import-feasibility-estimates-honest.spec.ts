/*
New file: backend/test/critical/import-feasibility-estimates-honest.spec.ts
Pins the honest-estimates rule (INV-IMPORT-ESTIMATES-HONEST): no silent
default in any money-creating path. Four grounded dispositions:

1. QUOTATIONS (estimate, labelled): createQuotation still computes the
   estimate from the 50 rate / 5% customs fallbacks when the caller
   supplies neither — but the row now RECORDS the basis
   (exchange_rate_used, exchange_rate_assumed, customs_rate_assumed)
   so the comparison list and any consumer can label the estimate with
   what was assumed instead of presenting an invented rate as fact.
2. FEASIBILITY SCHEDULE (estimate, labelled + honest text): the
   cash-flow schedule stored on conversion states the ACTUAL advance /
   balance percentages in its milestone text (the old hardcoded
   "(30%)" / "(70%)" text lied whenever the caller supplied a different
   split) and each entry carries is_estimate, whether the split was
   assumed, and the rate used.
3. SUGGESTED PRICES (money-creating, fail closed): applySuggestedPrices
   reprices from (pricingRate - arrivalRate). A recorded pricing rate
   with NO arrival rate used to fall back to arrival 1 and inflate
   every selling price by unitUsd x (pricingRate - 1). That
   inconsistent state now rejects with IMPORT_ARRIVAL_RATE_REQUIRED
   before any price write; when neither rate exists the adjustment is
   exactly zero and pricing proceeds from the stored landed cost.
4. DEMURRAGE RISK (estimate, labelled): calculateDemurrageRisk still
   assumes 14 free days / $50 per day / rate 1 when the shipment
   records none — but the result now carries an `assumptions` object
   naming every default used and the effective values, so the warning
   banner shows the basis instead of an invented rate.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

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
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, updated_at timestamptz, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, project_no text, title text, target_market text, country_origin text, country_destination text, budget_currency text, allocated_capital numeric, target_roi_percentage numeric, status text, feasibility_data jsonb, notes text, feasibility_converted_at timestamptz, cash_flow_schedule jsonb, initial_po_id text, sector_preset text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, freight_supplier_id bigint, customs_supplier_id bigint, transport_supplier_id bigint, demurrage_supplier_id bigint, unallocable_cost_reason text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text CHECK (state IN ('posted', 'legacy_review_required')), review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE import_quotations (id text PRIMARY KEY DEFAULT ('q-' || md5(random()::text)), tenant_id text, project_id text, supplier_id bigint, quotation_no text, inquiry_date text, expiry_date text, incoterm text, currency text, item_name text, product_id bigint, unit_price_foreign numeric, moq int, production_lead_days int, port_of_loading text, estimated_freight_usd numeric, estimated_customs_rate_percent numeric, estimated_landed_cost_egp numeric, exchange_rate_used numeric, exchange_rate_assumed boolean, customs_rate_assumed boolean, status text, selection_reason text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, cost_price numeric, retail_price numeric, wholesale_price numeric, catalog_updated_at timestamptz, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 50, false);
    INSERT INTO accounting_settings (id, tenant_id, updated_at) VALUES (1, 't1', NOW());
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Goods Supplier', '', '', 0, true, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 'W-1', NULL, 0, 0, 0, NULL, NULL, NULL, NOW());
    INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 't1', 1, NULL, NULL, 0, 0);
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

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const db = await makeDb();
  try {
    const svc = makeService(db);

    // Case 1 — quotation estimate basis is recorded, never silent.
    const assumed = await svc.createQuotation('t1', {
      supplierId: '1',
      quotationNo: 'RFQ-ASSUMED',
      itemName: 'Widget',
      unitPriceForeign: 100,
    });
    assert.equal(Number(assumed.exchange_rate_used), 50);
    assert.equal(assumed.exchange_rate_assumed, true);
    assert.equal(assumed.customs_rate_assumed, true);
    assert.equal(Number(assumed.estimated_customs_rate_percent), 5);
    assert.equal(Number(assumed.estimated_landed_cost_egp), 5250);
    const explicit = await svc.createQuotation('t1', {
      supplierId: '1',
      quotationNo: 'RFQ-EXPLICIT',
      itemName: 'Widget',
      unitPriceForeign: 100,
      exchangeRate: 55,
      estimatedCustomsRatePercent: 10,
    });
    assert.equal(Number(explicit.exchange_rate_used), 55);
    assert.equal(explicit.exchange_rate_assumed, false);
    assert.equal(explicit.customs_rate_assumed, false);
    assert.equal(Number(explicit.estimated_landed_cost_egp), 6050);
    console.log('Case 1 passed: quotation estimates record their assumed-rate basis');

    // Case 2 — feasibility schedule states the actual split and its basis.
    const feas: any = {
      items: [{ productName: 'Widget', quantity: 10, unitPriceForeign: 100 }],
      exchangeRateCommercial: 50,
      totalFactoryCostUsd: 10000,
      internationalShippingUsd: 500,
      insuranceUsd: 100,
      customsDutyEgp: 2000,
      clearanceAndPortFeesEgp: 500,
      customsVatEgp: 0,
      vatIsRefundable: true,
      internalTransportEgp: 300,
    };
    await db.insertInto('import_projects' as never).values({
      id: 'proj-40', tenant_id: 't1', project_no: 'P-40', title: 'Split 40', status: 'feasibility',
      budget_currency: 'USD', country_destination: 'Egypt', feasibility_data: feas,
    } as never).execute();
    await db.insertInto('import_projects' as never).values({
      id: 'proj-30', tenant_id: 't1', project_no: 'P-30', title: 'Split default', status: 'feasibility',
      budget_currency: 'USD', country_destination: 'Egypt', feasibility_data: feas,
    } as never).execute();
    const conv40 = await svc.convertFeasibilityToProject('t1', 'proj-40', { projectId: 'proj-40', advancePaymentPercentage: 40 });
    assert.equal(conv40.success, true);
    const t0 = conv40.cashFlowSchedule[0];
    const t1 = conv40.cashFlowSchedule[1];
    assert.match(String(t0.milestone), /40%/);
    assert.match(String(t1.milestone), /60%/);
    assert.equal(Number(t0.amountUsd), 4000);
    assert.equal(Number(t0.amountEgp), 200000);
    assert.equal(Number(t1.amountUsd), 6000);
    assert.equal(t0.is_estimate, true);
    assert.equal(t0.assumed_advance_percentage, false);
    assert.equal(Number(t0.exchange_rate_used), 50);
    const conv30 = await svc.convertFeasibilityToProject('t1', 'proj-30', { projectId: 'proj-30' });
    const s0 = conv30.cashFlowSchedule[0];
    assert.match(String(s0.milestone), /30%/);
    assert.equal(Number(s0.amountUsd), 3000);
    assert.equal(s0.assumed_advance_percentage, true);
    const stored = await (db as any).selectFrom('import_projects').selectAll().where('id', '=', 'proj-40').executeTakeFirstOrThrow() as any;
    const storedSchedule = typeof stored.cash_flow_schedule === 'string' ? JSON.parse(stored.cash_flow_schedule) : stored.cash_flow_schedule;
    assert.match(String(storedSchedule[0].milestone), /40%/);
    assert.equal(storedSchedule[0].assumed_advance_percentage, false);
    console.log('Case 2 passed: schedule milestones state the actual split with its basis');

    // Case 3 — suggested prices fail closed on pricing-rate-without-arrival-rate.
    await db.insertInto('import_shipments' as never).values({
      id: 'sh-price-bad', tenant_id: 't1', container_number: 'CBAD', supplier_id: 1, status: 'Pending',
      pricing_exchange_rate: 55, exchange_rate_at_arrival: null, project_id: null,
    } as never).execute();
    await db.insertInto('import_shipment_items' as never).values({
      id: 'item-bad', tenant_id: 't1', shipment_id: 'sh-price-bad', product_id: 1,
      quantity: 10, factory_unit_price_usd: 50, landed_cost_egp: 3300,
      target_retail_margin: 20, target_wholesale_margin: 10,
    } as never).execute();
    await assert.rejects(
      () => svc.applySuggestedPrices('t1', 'sh-price-bad'),
      /IMPORT_ARRIVAL_RATE_REQUIRED/,
    );
    const untouched = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow() as any;
    assert.equal(untouched.retail_price, null);
    assert.equal(untouched.wholesale_price, null);
    await (db as any).updateTable('import_shipments').set({ exchange_rate_at_arrival: 50 }).where('id', '=', 'sh-price-bad').execute();
    const applied = await svc.applySuggestedPrices('t1', 'sh-price-bad');
    assert.equal(applied.success, true);
    const priced = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow() as any;
    // pricingCost = 3300 + 50 x (55 - 50) = 3550; retail x1.2 = 4260; wholesale x1.1 = 3905.
    assert.equal(Number(priced.retail_price), 4260);
    assert.equal(Number(priced.wholesale_price), 3905);
    await db.insertInto('import_shipments' as never).values({
      id: 'sh-price-none', tenant_id: 't1', container_number: 'CNONE', supplier_id: 1, status: 'Pending',
      pricing_exchange_rate: null, exchange_rate_at_arrival: null, project_id: null,
    } as never).execute();
    await db.insertInto('import_shipment_items' as never).values({
      id: 'item-none', tenant_id: 't1', shipment_id: 'sh-price-none', product_id: 1,
      quantity: 10, factory_unit_price_usd: 50, landed_cost_egp: 3300,
      target_retail_margin: 20, target_wholesale_margin: 10,
    } as never).execute();
    await svc.applySuggestedPrices('t1', 'sh-price-none');
    const pricedNone = await (db as any).selectFrom('products').selectAll().where('id', '=', 1).executeTakeFirstOrThrow() as any;
    assert.equal(Number(pricedNone.retail_price), 3960);
    assert.equal(Number(pricedNone.wholesale_price), 3630);
    console.log('Case 3 passed: pricing fails closed on the inconsistent rate state only');

    // Case 4 — demurrage risk names every assumed input.
    await db.insertInto('import_shipments' as never).values({
      id: 'sh-dem-assumed', tenant_id: 't1', container_number: 'CDEM1', supplier_id: 1, status: 'InTransit',
      arrival_date: daysAgo(20), container_status: 'Pending', project_id: null,
    } as never).execute();
    const gotAssumed = await svc.getShipmentById('t1', 'sh-dem-assumed');
    assert.equal(gotAssumed.demurrageRisk.isOverdue, true);
    assert.equal(gotAssumed.demurrageRisk.overdueDays, 6);
    assert.equal(Number(gotAssumed.demurrageRisk.estimatedFeesEgp), 300);
    assert.deepEqual(gotAssumed.demurrageRisk.assumptions, {
      freeDays: 14, freeDaysAssumed: true,
      dailyRateUsd: 50, dailyRateAssumed: true,
      exchangeRate: 1, exchangeRateAssumed: true,
    });
    await db.insertInto('import_shipments' as never).values({
      id: 'sh-dem-explicit', tenant_id: 't1', container_number: 'CDEM2', supplier_id: 1, status: 'InTransit',
      arrival_date: daysAgo(20), container_status: 'Pending', project_id: null,
      free_demurrage_days: 10, demurrage_rate_per_day: 80, exchange_rate_at_arrival: 50,
    } as never).execute();
    const gotExplicit = await svc.getShipmentById('t1', 'sh-dem-explicit');
    assert.equal(gotExplicit.demurrageRisk.overdueDays, 10);
    assert.equal(Number(gotExplicit.demurrageRisk.estimatedFeesEgp), 40000);
    assert.deepEqual(gotExplicit.demurrageRisk.assumptions, {
      freeDays: 10, freeDaysAssumed: false,
      dailyRateUsd: 80, dailyRateAssumed: false,
      exchangeRate: 50, exchangeRateAssumed: false,
    });
    console.log('Case 4 passed: demurrage risk carries its assumed-input basis');
  } finally {
    await db.destroy();
  }
  console.log('Import feasibility estimates honest tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
