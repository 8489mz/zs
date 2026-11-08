/*
New file: backend/test/critical/import-fx-resolver.spec.ts
Pins the F1 rule (INV-IMPORT-FX-RESOLVER): no hardcoded FX fallback
rate anywhere in the import module outside the D6c-owned feasibility
engine. The two invented-50 sites that lived in
import-sales.service.ts now resolve live through resolveFxRate:

1. QUOTATIONS: createQuotation with no caller-supplied exchange rate
   used to invent 50. It now resolves the live registered rate for
   the quotation currency (fail-closed when none is registered), and
   a supplied rate is validated through the same resolver (a
   non-finite / non-positive supplied rate rejects instead of being
   stored, and a base-currency quotation resolves to 1).
2. AUTOPSY SHEET: getContainerAutopsySheet with no arrival or
   pricing rate used to invent 50 labelled 'assumed_50'. It now
   resolves the live registered USD rate — the denomination of the
   factory/shipping figures — labelled 'live', and fails closed
   when no rate is registered. A recorded arrival rate still wins
   over the live rate.

WHAT THIS PINS, driving the real createQuotation and
getContainerAutopsySheet on PGlite:
- No supplied rate + USD 60 registered -> the quotation stores
  exchange_rate_used 60 (NOT the old hardcoded 50) and the
  estimate is computed at 60.
- No supplied rate + no USD row -> createQuotation rejects with
  the resolver's fail-closed message (no silent fallback).
- Supplied rate 55 -> stored as 55, assumed false; supplied NaN
  -> rejects through the resolver instead of storing NaN.
- Quotation in EGP with no supplied rate -> resolves to 1.
- Autopsy with no shipment rates + USD 60 registered -> source
  'live', assumed false, factory totals at 60.
- Autopsy with no shipment rates + no USD row -> rejects.
- Autopsy with an arrival rate recorded -> 'arrival' still wins
  over the live rate (recorded evidence is authoritative).
- Source pin: the service file contains no 'assumed_50' and no
  hardcoded ': 50' quotation fallback anymore.

The rounding of the computed figures is deliberately NOT changed
here: the estimate keeps its 4dp store and the sheet its 2dp
display rounding. F1 unifies the RATE SOURCE; digits rounding
belongs to the digits packages.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely } from 'kysely';
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
    CREATE TABLE import_container_preorders (id text PRIMARY KEY DEFAULT ('po-' || md5(random()::text)), tenant_id text, preorder_no text, project_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, deposit_treasury_account_id bigint, status text, sale_invoice_id bigint, expected_delivery_date text, notes text);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY DEFAULT ('bexp-' || md5(random()::text)), serial_id bigserial, tenant_id text, broker_id text, advance_id text, project_id text, shipment_id text, receipt_no text, expense_date text, category text, amount_egp numeric, is_capitalized boolean, is_refundable_vat boolean, attachment_url text, is_verified boolean, verified_by bigint, verified_at timestamptz, notes text, late_expense_event_id bigint, capitalization_state text, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, broker_expense_id text, shipment_id text, cost_bucket text, amount_egp numeric, state text, late_expense_event_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, broker_expense_id));
    CREATE TABLE import_container_deposits (id text PRIMARY KEY DEFAULT ('dep-' || md5(random()::text)), serial_id bigserial, tenant_id text, project_id text, shipment_id text, container_no text, shipping_line text, deposit_amount_egp numeric, payment_date text, expected_return_date text, refund_status text, refunded_amount_egp numeric, deductions_amount_egp numeric, treasury_account_id bigint, notes text, actual_return_date text, deduction_reason text, updated_at timestamptz DEFAULT NOW(), created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, project_id text, shipment_id text, sale_item_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, allocation_type text, created_at timestamptz DEFAULT NOW());
    -- t1 carries a live USD rate of 60 on purpose: 60 is NOT the old
    -- hardcoded 50, so a stored 60 proves live resolution.
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true), ('t1', 'USD', 60, false);
    -- t2 has a base currency but NO foreign rate row: the resolver
    -- must fail closed for it instead of inventing a rate.
    INSERT INTO settings VALUES ('t2', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t2', 'EGP', 1, true);
    INSERT INTO accounting_settings (id, tenant_id, updated_at) VALUES (1, 't1', NOW());
    INSERT INTO suppliers VALUES (1, 't1', 't1', 'Goods Supplier', '', '', 0, true, NOW());
    INSERT INTO products VALUES (1, 't1', 't1', 'Widget', 'W-1', NULL, 0, 0, 0, NULL, NULL, NULL, NOW());
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

async function seedShipment(db: Kysely<Database>, tenantId: string, shipmentId: string, rates: { arrival?: number | null; pricing?: number | null }): Promise<void> {
  await db.insertInto('import_shipments' as never).values({
    id: shipmentId, tenant_id: tenantId, container_number: 'C-FX', supplier_id: 1, status: 'Arrived',
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
    exchange_rate_at_arrival: rates.arrival ?? null, pricing_exchange_rate: rates.pricing ?? null,
    project_id: null,
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: `${shipmentId}-item`, tenant_id: tenantId, shipment_id: shipmentId, product_id: 1,
    quantity: 10, factory_unit_price_usd: 100, received_quantity: 10,
  } as never).execute();
}

async function main(): Promise<void> {
  const db = await makeDb();
  try {
    const svc = makeService(db);

    // Case 1 — quotation with no supplied rate resolves the LIVE rate.
    const live = await svc.createQuotation('t1', {
      supplierId: '1',
      quotationNo: 'RFQ-LIVE',
      itemName: 'Widget',
      unitPriceForeign: 100,
    });
    assert.equal(Number(live.exchange_rate_used), 60, 'Live USD rate 60, not the old hardcoded 50');
    assert.equal(live.exchange_rate_assumed, true);
    // 100 x 60 + 0 + 100 x 60 x 5% = 6300.
    assert.equal(Number(live.estimated_landed_cost_egp), 6300);
    console.log('Case 1 passed: quotation without a supplied rate uses the live registered rate');

    // Case 2 — quotation with no supplied rate and no registered
    // rate fails closed instead of inventing one.
    await assert.rejects(
      () => svc.createQuotation('t2', {
        supplierId: '1',
        quotationNo: 'RFQ-NORATE',
        itemName: 'Widget',
        unitPriceForeign: 100,
      }),
      /سعر صرف USD غير متاح/,
    );
    console.log('Case 2 passed: quotation without a registered rate fails closed');

    // Case 3 — a supplied rate still wins, validated by the resolver.
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
    assert.equal(Number(explicit.estimated_landed_cost_egp), 6050);
    console.log('Case 3 passed: supplied quotation rate is used and validated');

    // Case 4 — a non-finite supplied rate rejects instead of
    // storing NaN.
    await assert.rejects(
      () => svc.createQuotation('t1', {
        supplierId: '1',
        quotationNo: 'RFQ-NAN',
        itemName: 'Widget',
        unitPriceForeign: 100,
        exchangeRate: NaN,
      }),
      /موجباً/,
    );
    console.log('Case 4 passed: non-finite supplied rate rejects');

    // Case 5 — a base-currency quotation resolves to 1.
    const egp = await svc.createQuotation('t1', {
      supplierId: '1',
      quotationNo: 'RFQ-EGP',
      itemName: 'Widget',
      unitPriceForeign: 100,
      currency: 'EGP',
    });
    assert.equal(Number(egp.exchange_rate_used), 1);
    assert.equal(egp.exchange_rate_assumed, true);
    // 100 x 1 + 0 + 100 x 1 x 5% = 105.
    assert.equal(Number(egp.estimated_landed_cost_egp), 105);
    console.log('Case 5 passed: base-currency quotation resolves to 1');

    // Case 6 — autopsy with no shipment rates uses the LIVE rate.
    await seedShipment(db, 't1', 'sh-live', {});
    const autopsyLive: any = await svc.getContainerAutopsySheet('t1', 'sh-live');
    assert.equal(autopsyLive.basis.exchangeRateSource, 'live');
    assert.equal(autopsyLive.basis.exchangeRateAssumed, false);
    assert.equal(autopsyLive.landedCosts.exchangeRateSource, 'live');
    assert.equal(autopsyLive.landedCosts.exchangeRateAssumed, false);
    assert.equal(Number(autopsyLive.landedCosts.exchangeRate), 60);
    assert.equal(Number(autopsyLive.landedCosts.factoryTotalUsd), 1000);
    assert.equal(Number(autopsyLive.landedCosts.factoryTotalEgp), 60000);
    assert.equal(Number(autopsyLive.landedCosts.totalLandedCostEgp), 60000);
    assert.equal(autopsyLive.landedCosts.landedCostBasis, 'shipment_field_estimates');
    console.log('Case 6 passed: autopsy without shipment rates uses the live registered rate');

    // Case 7 — autopsy with no shipment rates and no registered
    // rate fails closed instead of inventing one.
    await seedShipment(db, 't2', 'sh-norate', {});
    await assert.rejects(
      () => svc.getContainerAutopsySheet('t2', 'sh-norate'),
      /سعر صرف USD غير متاح/,
    );
    console.log('Case 7 passed: autopsy without a registered rate fails closed');

    // Case 8 — a recorded arrival rate still wins over the live rate.
    await seedShipment(db, 't1', 'sh-arrival', { arrival: 48 });
    const autopsyArrival: any = await svc.getContainerAutopsySheet('t1', 'sh-arrival');
    assert.equal(autopsyArrival.basis.exchangeRateSource, 'arrival');
    assert.equal(autopsyArrival.basis.exchangeRateAssumed, false);
    assert.equal(Number(autopsyArrival.landedCosts.exchangeRate), 48);
    assert.equal(Number(autopsyArrival.landedCosts.factoryTotalEgp), 48000);
    console.log('Case 8 passed: recorded arrival rate wins over the live rate');

    // Case 9 — source pin: no invented-50 fallback remains in the
    // import service file.
    const src = readFileSync(
      resolve(__dirname, '../../src/modules/import-sales/import-sales.service.ts'),
      'utf8',
    );
    assert.equal(src.includes('assumed_50'), false, 'No assumed_50 source remains');
    assert.equal(
      src.includes('? Number(dto.exchangeRate) : 50'),
      false,
      'No hardcoded : 50 quotation fallback remains',
    );
    console.log('Case 9 passed: no invented-50 fallback remains in the import service');
  } finally {
    await db.destroy();
  }
  console.log('Import FX resolver tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
