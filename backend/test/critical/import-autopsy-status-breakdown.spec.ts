/*
New file: backend/test/critical/import-autopsy-status-breakdown.spec.ts
Pins the container P&L (autopsy) status mapping and the breakdown
rows that sum to the total (I8-E, R6).

WHAT WAS WRONG (live re-test 2026-11-09, deployed 4d811676):
- MSCU-TEST-001 autopsy status read "في البحر" although the
  container is Arrived (list: تم الوصول للمخزن, status select:
  Arrived). Root cause: getContainerAutopsySheet read
  container_status, which no status transition ever updates —
  the only writer sets 'empty_returned' — so the column kept
  its 'on_water' migration default for an arrived container.
  The shipment status ('Pending' | 'In Customs' | 'Arrived')
  is the authoritative arrival state.
- MSCU-TEST-003 autopsy breakdown listed only
  goods/freight/customs/transport (900.00) and omitted the
  insurance/duty/VAT rows (207.60) while including them in the
  1,107.60 total. Root cause: the backend already returns
  insuranceEgp/dutyEgp/vatEgp and includes them in the total,
  but the modal never rendered them.

WHAT THIS PINS, driving the real getContainerAutopsySheet on
PGlite (the backend half of the fix; the modal renders the
already-returned insuranceEgp/dutyEgp/vatEgp rows):
- An Arrived shipment whose container_status is the stale
  'on_water' default reads warehouse_received / "تم الوصول
  للمخزن" — the live MSCU-TEST-001 shape.
- A NULL container_status on an Arrived shipment resolves the
  same way (the legacy NULL default).
- An 'In Customs' shipment on the stale default reads
  port_arrived / "وصلت إلى الميناء"; a Pending one stays
  on_water / "في البحر" (the live MSCU-TEST-003 shape).
- An explicit container_status is never overridden:
  warehouse_received and empty_returned keep their labels, and
  an unknown value still gets the honest "حالة غير معروفة"
  (D6 behaviour, preserved).
- The nine breakdown components sum to the total in both live
  shapes: MSCU-TEST-003 rated 500 + 250 + 50 + 40 + 117.60 +
  100 + 50 = 1,107.60, and MSCU-TEST-001 500 + 250 + 100 + 50
  + 20.00 late expenses = 920.00 / 92.00 per unit.
- 92.00/unit on MSCU-TEST-001 is CORRECT and is pinned as
  such: 900.00 receipt + 20.00 capitalised late expense =
  920.00 / 10 — it must NOT be "fixed" back to 90.00.
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
  opts: {
    status: string;
    containerStatus: string | null;
    duty: number;
    vat: number;
    insuranceUsd: number;
    lateExpensesEgp: number;
    storedPerUnit: number;
  },
): Promise<void> {
  await (db as any).insertInto('import_shipments').values({
    id: shipmentId, tenant_id: 't1', container_number: 'MSCU-TEST-001', supplier_id: 1,
    bill_of_lading: 'BL-TEST-001', status: opts.status, project_id: 'proj-1',
    exchange_rate_at_arrival: 50, pricing_exchange_rate: null,
    shipping_cost_usd: 5, customs_cost_egp: 100, internal_transport_cost_egp: 50,
    actual_demurrage_fees: 0, late_expenses_total_egp: opts.lateExpensesEgp,
    container_status: opts.containerStatus,
    customs_duty_rate_percent: opts.duty, vat_rate_percent: opts.vat,
    insurance_cost_usd: opts.insuranceUsd, funding_type: 'bank_transfer',
  } as never).execute();
  await (db as any).insertInto('import_shipment_items').values({
    id: `${shipmentId}-item`, tenant_id: 't1', shipment_id: shipmentId, product_id: 1,
    quantity: 10, received_quantity: 10, factory_unit_price_usd: 1,
    allocated_overhead_egp: 0, landed_cost_egp: opts.storedPerUnit,
    shortage_handling_method: 'capitalize',
  } as never).execute();
}

/** The nine breakdown components the modal renders; they must sum to the total. */
function breakdownSum(costs: any): number {
  return Number(
    (
      Number(costs.factoryTotalEgp) +
      Number(costs.shippingEgp) +
      Number(costs.insuranceEgp) +
      Number(costs.dutyEgp) +
      Number(costs.vatEgp) +
      Number(costs.customsEgp) +
      Number(costs.transportEgp) +
      Number(costs.demurrageEgp) +
      Number(costs.lateExpensesEgp)
    ).toFixed(2),
  );
}

async function main(): Promise<void> {
  // Case 1: the live MSCU-TEST-001 shape — Arrived, but
  // container_status still the 'on_water' default. The status
  // must read warehouse_received / "تم الوصول للمخزن", and
  // 92.00/unit is CORRECT (900 receipt + 20 late expense).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-001', {
        status: 'Arrived', containerStatus: 'on_water',
        duty: 0, vat: 0, insuranceUsd: 0, lateExpensesEgp: 20, storedPerUnit: 92,
      });
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-001');
      assert.equal(autopsy.operational.containerStatus, 'warehouse_received', 'Stale on_water default resolves from the Arrived shipment status');
      assert.equal(autopsy.operational.containerStatusLabel, 'تم الوصول للمخزن', 'Arrived container never reads "في البحر"');
      assert.equal(autopsy.landedCosts.totalLandedCostEgp, 920, 'Total 500 + 250 + 100 + 50 + 20 late expenses');
      assert.equal(autopsy.landedCosts.avgCostPerUnitEgp, 92, '92.00/unit is CORRECT (900 receipt + 20 late expense) / 10 — not 90.00');
      assert.equal(breakdownSum(autopsy.landedCosts), autopsy.landedCosts.totalLandedCostEgp, 'Breakdown rows sum to the total');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: the live MSCU-TEST-003 shape — Pending, on_water,
  // rated (duty 5%, VAT 14%, insurance $1). The status stays
  // "في البحر" (correct — it is Pending), and the breakdown
  // rows — including the 207.60 insurance/duty/VAT the modal
  // used to omit — sum to the 1,107.60 total.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-003', {
        status: 'Pending', containerStatus: 'on_water',
        duty: 5, vat: 14, insuranceUsd: 1, lateExpensesEgp: 0, storedPerUnit: 110.76,
      });
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-003');
      assert.equal(autopsy.operational.containerStatus, 'on_water', 'Pending container stays on_water');
      assert.equal(autopsy.operational.containerStatusLabel, 'في البحر', 'Pending container correctly reads "في البحر"');
      const costs = autopsy.landedCosts;
      assert.equal(costs.insuranceEgp, 50, 'Insurance $1 x FX 50');
      assert.equal(costs.dutyEgp, 40, 'Duty 5% of CIF 800');
      assert.equal(costs.vatEgp, 117.6, 'VAT 14% of CIF+duty 840');
      assert.equal(costs.totalLandedCostEgp, 1107.6, 'Total 500 + 250 + 50 + 40 + 117.60 + 100 + 50');
      assert.equal(costs.avgCostPerUnitEgp, 110.76, 'Avg per unit 1,107.60 / 10');
      assert.equal(breakdownSum(costs), costs.totalLandedCostEgp, 'Breakdown rows sum to the total — the omitted 207.60 is now itemised');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: a NULL container_status (the legacy default) on an
  // Arrived shipment resolves the same way, and 'In Customs'
  // on the stale default reads port_arrived.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-null', {
        status: 'Arrived', containerStatus: null,
        duty: 0, vat: 0, insuranceUsd: 0, lateExpensesEgp: 0, storedPerUnit: 90,
      });
      const nullStatus: any = await service.getContainerAutopsySheet('t1', 'sh-null');
      assert.equal(nullStatus.operational.containerStatus, 'warehouse_received', 'NULL container_status resolves from the Arrived shipment status');
      assert.equal(nullStatus.operational.containerStatusLabel, 'تم الوصول للمخزن');
      await seedShipment(db, 'sh-customs', {
        status: 'In Customs', containerStatus: 'on_water',
        duty: 0, vat: 0, insuranceUsd: 0, lateExpensesEgp: 0, storedPerUnit: 90,
      });
      const inCustoms: any = await service.getContainerAutopsySheet('t1', 'sh-customs');
      assert.equal(inCustoms.operational.containerStatus, 'port_arrived', 'In Customs resolves from the stale on_water default');
      assert.equal(inCustoms.operational.containerStatusLabel, 'وصلت إلى الميناء');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: an explicit container_status is never overridden —
  // warehouse_received and empty_returned keep their labels,
  // and an unknown value still gets the honest fallback (D6).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedShipment(db, 'sh-explicit', {
        status: 'Arrived', containerStatus: 'warehouse_received',
        duty: 0, vat: 0, insuranceUsd: 0, lateExpensesEgp: 0, storedPerUnit: 90,
      });
      const explicit: any = await service.getContainerAutopsySheet('t1', 'sh-explicit');
      assert.equal(explicit.operational.containerStatus, 'warehouse_received');
      assert.equal(explicit.operational.containerStatusLabel, 'تم الوصول للمخزن');
      await seedShipment(db, 'sh-empty', {
        status: 'Arrived', containerStatus: 'empty_returned',
        duty: 0, vat: 0, insuranceUsd: 0, lateExpensesEgp: 0, storedPerUnit: 90,
      });
      const empty: any = await service.getContainerAutopsySheet('t1', 'sh-empty');
      assert.equal(empty.operational.containerStatus, 'empty_returned');
      assert.equal(empty.operational.containerStatusLabel, 'تم تسليم الفارغ والمطابقة');
      await seedShipment(db, 'sh-unknown', {
        status: 'Arrived', containerStatus: 'bogus_status',
        duty: 0, vat: 0, insuranceUsd: 0, lateExpensesEgp: 0, storedPerUnit: 90,
      });
      const unknown: any = await service.getContainerAutopsySheet('t1', 'sh-unknown');
      assert.equal(unknown.operational.containerStatus, 'bogus_status', 'Raw status still passes through');
      assert.equal(unknown.operational.containerStatusLabel, 'حالة غير معروفة', 'Unknown status gets an honest fallback, never a wrong specific state');
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import autopsy status and breakdown tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
