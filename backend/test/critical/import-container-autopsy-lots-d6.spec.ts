/*
New file: backend/test/critical/import-container-autopsy-lots-d6.spec.ts
Pins the container P&L (autopsy) lots row and status label (I2-D6).

WHAT WAS WRONG (live trial MSCU-TEST-001, 10 units, JE-00015025):
the summary was correct — landed cost 900.00, avg 90.00/unit
(FOB 500.00 + freight 250.00 + customs 100.00 + transport 50.00) —
but the "متابعة تشغيلات الأصناف" lots row showed unit 9.00 and
line total 90.00. Root cause: import_shipment_items.landed_cost_egp
stores the PER-UNIT landed cost (the landed-cost engine's
landedCostEgp = totalItemLandedCostEgp / effectiveQty; pinned by
import-landed-cost-canonical.spec.ts), while the autopsy modal
divided it by quantity AGAIN (landed_cost_egp / received_quantity)
and showed the stored value itself as the line total — one extra
division by qty (900/10/10). The P&L also hardcoded its status:
anything not empty_returned read "قيد الاستلام والتفريغ", while
the container record said "تم الوصول للمخزن".

WHAT THIS PINS, driving the real getContainerAutopsySheet on
PGlite with the trial numbers seeded exactly as the engine stores
them (landed_cost_egp = 90.00 per unit):
- The lots row carries unit 90.00 and line total 900.00, and the
  row totals sum to the summary totalLandedCostEgp.
- The received-quantity basis: 8 of 10 received at 90.00/unit
  gives a line total of 720.00.
- The stored landed_cost_egp value itself is unchanged (90.00):
  the fix is at the autopsy call site, not in the engine or the
  stored per-unit semantics — sale costing (which reads the same
  per-unit value through the lot) is untouched.
- The status label reads the container's ACTUAL status:
  warehouse_received -> "تم الوصول للمخزن",
  empty_returned -> "تم تسليم الفارغ والمطابقة", and an unknown
  status -> the honest "حالة غير معروفة", never a wrong specific
  state.
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
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, carrier_name text, actual_demurrage_fees numeric, late_expenses_total_egp numeric, container_status text, unstuffing_date text, empty_returned_date text);
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

/** Trial container MSCU-TEST-001: 10 units, $1 FOB, $5 freight, FX 50, customs 100, transport 50. */
async function seedTrialShipment(db: Kysely<Database>, shipmentId: string, containerStatus: string | null, receivedQty: number): Promise<void> {
  await (db as any).insertInto('import_shipments').values({
    id: shipmentId, tenant_id: 't1', container_number: 'MSCU-TEST-001', supplier_id: 1,
    bill_of_lading: 'BL-TEST-001', status: 'Arrived', project_id: 'proj-1',
    exchange_rate_at_arrival: 50, pricing_exchange_rate: null,
    shipping_cost_usd: 5, customs_cost_egp: 100, internal_transport_cost_egp: 50,
    actual_demurrage_fees: 0, late_expenses_total_egp: 0,
    container_status: containerStatus,
  } as never).execute();
  await (db as any).insertInto('import_shipment_items').values({
    id: `${shipmentId}-item`, tenant_id: 't1', shipment_id: shipmentId, product_id: 1,
    quantity: 10, received_quantity: receivedQty, factory_unit_price_usd: 1,
    // Stored PER-UNIT, exactly as calculateLandedCostInTransaction
    // writes the engine's landedCostEgp: (10 x $1 x 50 + 400) / 10.
    allocated_overhead_egp: 40, landed_cost_egp: 90,
    shortage_handling_method: 'capitalize',
  } as never).execute();
}

async function main(): Promise<void> {
  // Case 1: the trial container — lots row 90.00/unit, 900.00 total,
  // and the received container reads "تم الوصول للمخزن".
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedTrialShipment(db, 'sh-trial', 'warehouse_received', 10);
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-trial');
      // The summary was already correct on the live trial; pin it
      // so the row fix cannot drift from it.
      assert.equal(autopsy.landedCosts.totalLandedCostEgp, 900, 'Summary landed cost 500 + 250 + 100 + 50');
      assert.equal(autopsy.landedCosts.avgCostPerUnitEgp, 90, 'Summary avg 900 / 10');
      assert.equal(autopsy.items.length, 1, 'One lots row');
      const row = autopsy.items[0];
      assert.equal(Number(row.landed_cost_egp), 90, 'Stored value stays per-unit (engine semantics, unchanged)');
      assert.equal(Number(row.unit_landed_cost_egp), 90, 'Lots row unit landed cost is 90.00, not 9.00');
      assert.equal(Number(row.total_landed_cost_egp), 900, 'Lots row line total is 900.00, not 90.00');
      const rowTotals = autopsy.items.reduce((s: number, i: any) => s + Number(i.total_landed_cost_egp), 0);
      assert.equal(rowTotals, autopsy.landedCosts.totalLandedCostEgp, 'Lots rows sum to the summary total');
      assert.equal(autopsy.operational.containerStatus, 'warehouse_received');
      assert.equal(autopsy.operational.containerStatusLabel, 'تم الوصول للمخزن', 'P&L status reads the actual container status');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: partial receipt — 8 of 10 received at 90.00/unit is a
  // 720.00 line total (received-qty basis, not ordered qty).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedTrialShipment(db, 'sh-partial', 'port_arrived', 8);
      const autopsy: any = await service.getContainerAutopsySheet('t1', 'sh-partial');
      const row = autopsy.items[0];
      assert.equal(Number(row.unit_landed_cost_egp), 90, 'Unit cost unchanged by a short receipt');
      assert.equal(Number(row.total_landed_cost_egp), 720, 'Line total is unit x received qty (90 x 8)');
      assert.equal(autopsy.operational.containerStatusLabel, 'وصلت إلى الميناء');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: empty-returned container keeps its existing label, and
  // an unknown status never reads as a wrong specific state.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await seedTrialShipment(db, 'sh-empty', 'empty_returned', 10);
      const empty: any = await service.getContainerAutopsySheet('t1', 'sh-empty');
      assert.equal(empty.operational.containerStatusLabel, 'تم تسليم الفارغ والمطابقة');
      await seedTrialShipment(db, 'sh-unknown', 'bogus_status', 10);
      const unknown: any = await service.getContainerAutopsySheet('t1', 'sh-unknown');
      assert.equal(unknown.operational.containerStatus, 'bogus_status', 'Raw status still passes through');
      assert.equal(unknown.operational.containerStatusLabel, 'حالة غير معروفة', 'Unknown status gets an honest fallback');
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import container autopsy lots D6 tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
