/*
New file: backend/test/critical/import-autopsy-estimate-duty-vat.spec.ts
Pins the container P&L (autopsy) OPEN ESTIMATE with duty/VAT/insurance
(coordinator micro-fix, I2-P6 follow-through).

WHY THIS EXISTS: P6 added customs_duty_rate_percent / vat_rate_percent /
insurance_cost_usd to the shipment and the receipt now posts 1,107.60 for
the trial goods — but getContainerAutopsySheet's open estimate summed only
the pre-P6 fields (factory + freight + flat customs + transport +
demurrage + late = 900.00) and fed avgCostPerUnit + ROI, so the sheet
contradicted its own posted value for any shipment with rates. The posted
path reads the JE (frozen, correct); only the estimate was stale.

WHAT THIS PINS, driving the real getContainerAutopsySheet on PGlite:
- A rated shipment (duty 5%, VAT 14%, insurance $1, FX 50, trial goods)
  estimates 1,107.60 total / 110.76 per unit, with duty 40.00, VAT
  117.60, insurance 50.00 itemized (CIF 800 = 500 + 250 + 50; duty
  5% of CIF; VAT 14% of CIF+duty) — the same formula as the
  landed-cost engine, intermediates unrounded.
- The rated shipment's lots rows (stored per-unit 110.76, as a post-P6
  receipt writes) sum to the estimate — the sheet is internally
  consistent, not just correct in one corner.
- An unrated shipment (rates 0, no insurance) is unchanged: 900.00
  total / 90.00 per unit, duty/VAT/insurance 0 — the D6 trial numbers.
- A rated shipment with no insurance proves insurance is part of the
  CIF basis: CIF 750, duty 37.50, VAT 110.25, total 1,047.75.
- The estimate basis stays 'shipment_field_estimates' while no receipt
  has posted.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
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
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, title text, project_no text, status text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, sku text, barcode text);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, carrier_name text, actual_demurrage_fees numeric, late_expenses_total_egp numeric, container_status text, unstuffing_date text, empty_returned_date text, customs_duty_rate_percent numeric, vat_rate_percent numeric, insurance_cost_usd numeric, funding_type text);
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text);
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY, tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text);
    CREATE TABLE import_container_preorders (id text PRIMARY KEY, tenant_id text, shipment_id text, customer_id bigint, product_id bigint, reserved_quantity numeric, unit_price_egp numeric, total_price_egp numeric, deposit_amount_egp numeric, refunded_amount_egp numeric, status text);
    CREATE TABLE import_broker_expenses (id text PRIMARY KEY, tenant_id text, shipment_id text, amount_egp numeric, capitalization_state text, is_verified boolean);
    CREATE TABLE import_container_deposits (id text PRIMARY KEY, tenant_id text, shipment_id text, deposit_amount_egp numeric, refund_status text);
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, status text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, debit numeric, credit numeric);
    CREATE TABLE import_broker_capitalizations (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, amount_egp numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, sale_item_id bigint, quantity numeric, unit_sale_price_egp numeric, unit_cost_egp numeric, allocation_type text);
    INSERT INTO import_projects VALUES ('proj-1', 't1', 'Project One', 'IMP-261109-0001', 'active');
    INSERT INTO suppliers VALUES (1, 't1', 'Supplier A');
    INSERT INTO products VALUES (1, 't1', 'Widget', NULL, NULL);
    INSERT INTO customers VALUES (1, 't1', 'Customer A');
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

/** Trial goods: 10 units, $1 FOB, $5 freight, FX 50, flat customs 100, transport 50. */
async function seedShipment(
  db: Kysely<Database>,
  shipmentId: string,
  rates: { duty: number | null; vat: number | null; insuranceUsd: number | null },
  storedPerUnit: number,
  storedOverhead: number,
): Promise<void> {
  await (db as any).insertInto('import_shipments').values({
    id: shipmentId, tenant_id: 't1', container_number: 'MSCU-TEST-001', supplier_id: 1,
    bill_of_lading: 'BL-TEST-001', status: 'Arrived', project_id: 'proj-1',
    exchange_rate_at_arrival: 50, pricing_exchange_rate: null,
    shipping_cost_usd: 5, customs_cost_egp: 100, internal_transport_cost_egp: 50,
    actual_demurrage_fees: 0, late_expenses_total_egp: 0,
    container_status: 'warehouse_received',
    customs_duty_rate_percent: rates.duty, vat_rate_percent: rates.vat,
    insurance_cost_usd: rates.insuranceUsd, funding_type: 'bank_transfer',
  } as never).execute();
  await (db as any).insertInto('import_shipment_items').values({
    id: `${shipmentId}-item`, tenant_id: 't1', shipment_id: shipmentId, product_id: 1,
    quantity: 10, received_quantity: 10, factory_unit_price_usd: 1,
    allocated_overhead_egp: storedOverhead, landed_cost_egp: storedPerUnit,
    shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function main(): Promise<void> {
  // Case 1: rated shipment — the trial goods with duty 5%, VAT 14%,
  // insurance $1. Estimate must be 1,107.60 (the same total the
  // receipt posts), not the pre-P6 900.00.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      // Stored per-unit 110.76, exactly as a post-P6 receipt writes it.
      await seedShipment(db, 'sh-rated', { duty: 5, vat: 14, insuranceUsd: 1 }, 110.76, 607.6);
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-rated');
      const costs = autopsy.landedCosts;
      assert.equal(costs.insuranceEgp, 50, 'Insurance $1 x FX 50');
      assert.equal(costs.dutyEgp, 40, 'Duty 5% of CIF 800 (500 + 250 + 50)');
      assert.equal(costs.vatEgp, 117.6, 'VAT 14% of CIF+duty 840');
      assert.equal(costs.totalLandedCostEgp, 1107.6, 'Estimate 500 + 250 + 50 + 100 + 50 + 40 + 117.60');
      assert.equal(costs.avgCostPerUnitEgp, 110.76, 'Avg per unit follows the estimate, not the stale 90.00');
      assert.equal(costs.landedCostBasis, 'shipment_field_estimates', 'No receipt posted yet');
      const rowTotals = autopsy.items.reduce((s: number, i: any) => s + Number(i.total_landed_cost_egp), 0);
      assert.equal(rowTotals, costs.totalLandedCostEgp, 'Lots rows sum to the estimate for a rated shipment');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: unrated shipment — rates 0, no insurance. Unchanged:
  // the D6 trial numbers (900.00 / 90.00) still hold.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-unrated', { duty: 0, vat: 0, insuranceUsd: 0 }, 90, 400);
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-unrated');
      const costs = autopsy.landedCosts;
      assert.equal(costs.insuranceEgp, 0, 'No insurance');
      assert.equal(costs.dutyEgp, 0, 'No duty at 0%');
      assert.equal(costs.vatEgp, 0, 'No VAT at 0%');
      assert.equal(costs.totalLandedCostEgp, 900, 'Estimate unchanged: 500 + 250 + 100 + 50');
      assert.equal(costs.avgCostPerUnitEgp, 90, 'Avg 900 / 10');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: rated shipment, no insurance — proves insurance is part
  // of the CIF basis: CIF 750 (500 + 250), duty 37.50, VAT 110.25.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-noins', { duty: 5, vat: 14, insuranceUsd: 0 }, 104.78, 547.75);
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-noins');
      const costs = autopsy.landedCosts;
      assert.equal(costs.insuranceEgp, 0, 'No insurance');
      assert.equal(costs.dutyEgp, 37.5, 'Duty 5% of CIF 750');
      assert.equal(costs.vatEgp, 110.25, 'VAT 14% of CIF+duty 787.50');
      assert.equal(costs.totalLandedCostEgp, 1047.75, 'Estimate 500 + 250 + 100 + 50 + 37.50 + 110.25');
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import autopsy estimate duty/VAT tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
