/*
New file: backend/test/critical/import-sector-preset.spec.ts
Pins per-project sector presets (INV-IMPORT-SECTOR-PRESET).

WHAT WAS WRONG: importing feasibility items into a shipment
ALWAYS behaved as a truck-parts import — it created the truck
category, applied an 11-entry truck OEM map, fabricated SKUs
and barcodes from the project number, stamped HOWO/Shacman
metadata and 2018-2026 years on every product, priced new
products at cost x1.35 / x1.20, silently fell back to rate 50,
and REWROTE any existing product matched by name (supplier,
category, SKU, barcode, notes, metadata).

WHAT THIS PINS, driving the real createProject,
updateProject and importProjectItemsToShipment on PGlite:
- A generic project (no preset) creates no category, invents
  no SKU/barcode/OEM/metadata defaults, and prices new
  products at estimated cost (no markup).
- The truck_parts preset keeps the sector conventions
  verbatim (category, OEM map, markups, metadata defaults).
- Unknown preset keys fail closed at creation; a missing
  exchange rate fails closed instead of silently using 50.
- An existing product matched by name is linked as-is and
  never rewritten, under any preset.
- The preset cannot change once shipment items exist.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const KNOWN_TRUCK_ITEM = 'طقم تيل فرامل وبطانات مكابح شاحنات وتريلات ثقيلة';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    INSERT INTO settings VALUES ('t1', 'timezone', '"Africa/Cairo"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    CREATE TABLE import_projects (id text PRIMARY KEY DEFAULT ('proj-' || md5(random()::text)), tenant_id text, project_no text, title text, target_market text, country_origin text, country_destination text, budget_currency text, allocated_capital numeric, target_roi_percentage numeric, status text, feasibility_data text, closure_data text, notes text, sector_preset text, supplier_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, container_number text, supplier_id bigint, bill_of_lading text, arrival_date text, shipping_date text, shipped_date text, eta_date text, clearance_date text, shipping_cost_usd numeric, customs_cost_egp numeric, internal_transport_cost_egp numeric, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, status text, shipping_expense_id bigint, customs_expense_id bigint, transport_expense_id bigint, project_id text, freight_type text, container_size text, port_of_loading text, port_of_discharge text, cbm_volume numeric, gross_weight_kg numeric, carrier_name text, free_demurrage_days int, demurrage_start_date text, demurrage_rate_per_day numeric, actual_demurrage_fees numeric, customs_declaration_no text, vat_refundable_egp numeric, is_consolidated boolean, cost_allocation_method text, late_expenses_total_egp numeric, late_cogs_adjustment_egp numeric, late_inventory_adjustment_egp numeric, freight_job_id text, broker_id text, container_status text, gate_out_date text, unstuffing_date text, empty_returned_date text, form4_number text, form4_date date, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_receipts (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, state text, review_reason text, posted_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), journal_entry_id bigint);
    CREATE TABLE product_categories (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text);
    CREATE TABLE products (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, tenant_id text, account_id text, name text, sku text, barcode text, stock_qty numeric, reserved_qty numeric, min_stock_qty numeric, cost_price numeric, retail_price numeric, wholesale_price numeric, supplier_id bigint, category_id bigint, notes text, metadata jsonb, is_active boolean, item_kind text, item_type text, track_serials boolean, catalog_updated_at timestamptz, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_shipment_items (id text PRIMARY KEY DEFAULT ('si-' || md5(random()::text)), tenant_id text, shipment_id text, product_id bigint, quantity numeric, factory_unit_price_usd numeric, allocated_overhead_egp numeric, landed_cost_egp numeric, received_quantity numeric, shortage_handling_method text, target_margin_percent numeric, target_retail_margin numeric, target_wholesale_margin numeric, gross_weight_kg_unit numeric, cbm_unit numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id text PRIMARY KEY DEFAULT ('lot-' || md5(random()::text)), tenant_id text, lot_number text, project_id text, shipment_id text, shipment_item_id text, product_id bigint, location_id bigint, initial_quantity numeric, remaining_quantity numeric, unit_landed_cost_egp numeric, status text, receipt_date text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE import_late_expense_events (id bigserial PRIMARY KEY, tenant_id text, shipment_id text, title text, total_amount_egp numeric, inventory_amount_egp numeric, cogs_amount_egp numeric, journal_entry_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), idempotency_key text, broker_expense_id text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, title text, amount numeric, expense_date text, created_by bigint, note text, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
    INSERT INTO stock_locations VALUES (10, 't1', NULL);
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

function feasibilityItems(rate?: number): any {
  return {
    items: [
      { name: KNOWN_TRUCK_ITEM, qty: 2, factoryPriceUsd: 100 },
      { name: 'Generic Widget Alpha', qty: 3, factoryPriceUsd: 40 },
    ],
    ...(rate ? { exchangeRateCommercial: rate } : {}),
  };
}

async function seedShipment(db: Kysely<Database>, projectId: string, rate: number | null): Promise<void> {
  await (db as any).insertInto('import_shipments').values({
    id: 'sh-1', tenant_id: 't1', container_number: 'C1', status: 'Pending',
    exchange_rate_at_arrival: rate, project_id: projectId,
    shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
    cost_allocation_method: 'value',
  }).execute();
}

async function expectReject(promise: Promise<any>, code: string): Promise<void> {
  let err: any = null;
  try {
    await promise;
  } catch (e: any) {
    err = e;
  }
  assert.ok(err, `Expected rejection with ${code}`);
  assert.ok(
    String(err.message || '').includes(code),
    `Expected error to include ${code}, got: ${err?.message}`,
  );
}

async function main(): Promise<void> {
  // Case 1: generic project — no invented catalog data.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const project: any = await service.createProject('t1', {
        title: 'Generic import', feasibilityData: feasibilityItems(),
      });
      assert.equal(project.sector_preset, null);
      await seedShipment(db, project.id, 50);
      const res = await service.importProjectItemsToShipment('t1', 1, 'sh-1');
      assert.equal(res.importedCount, 2);

      const cats: any[] = await (db as any).selectFrom('product_categories').selectAll().execute();
      assert.equal(cats.length, 0, 'Generic import creates no category');

      const products: any[] = await (db as any).selectFrom('products').selectAll().orderBy('id').execute();
      assert.equal(products.length, 2);
      for (const p of products) {
        assert.equal(p.sku, null, 'No fabricated SKU');
        assert.equal(p.barcode, null, 'No fabricated barcode');
        assert.equal(p.category_id, null, 'No preset category');
        assert.equal(Number(p.retail_price), Number(p.cost_price), 'No retail markup without a preset');
        assert.equal(Number(p.wholesale_price), Number(p.cost_price), 'No wholesale markup without a preset');
        const meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
        assert.equal(meta.carBrand, undefined, 'No default brand without a preset');
        assert.equal(meta.carModel, undefined, 'No default model without a preset');
        assert.equal(meta.origin, undefined, 'No default origin without a preset');
        assert.equal(meta.projectNo, project.project_no);
        assert.equal(meta.containerNo, 'C1');
        assert.ok(meta.importedAt, 'Provenance timestamp kept');
      }
      const truck = products.find((p) => p.name === KNOWN_TRUCK_ITEM);
      const truckMeta = typeof truck.metadata === 'string' ? JSON.parse(truck.metadata) : truck.metadata;
      assert.equal(truckMeta.oemNumber, undefined, 'The OEM map does not apply without a preset');
      assert.equal(Number(truck.cost_price), 5000, 'Cost = 100 USD x arrival rate 50');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: truck_parts preset — sector conventions verbatim.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const project: any = await service.createProject('t1', {
        title: 'Truck parts import', sectorPreset: 'truck_parts', feasibilityData: feasibilityItems(),
      });
      assert.equal(project.sector_preset, 'truck_parts');
      await seedShipment(db, project.id, 50);
      await service.importProjectItemsToShipment('t1', 1, 'sh-1');

      const cats: any[] = await (db as any).selectFrom('product_categories').selectAll().execute();
      assert.equal(cats.length, 1);
      assert.equal(cats[0].name, 'قطع غيار شاحنات ونقل ثقيل');

      const products: any[] = await (db as any).selectFrom('products').selectAll().orderBy('id').execute();
      const truck = products.find((p) => p.name === KNOWN_TRUCK_ITEM);
      const meta = typeof truck.metadata === 'string' ? JSON.parse(truck.metadata) : truck.metadata;
      assert.equal(meta.oemNumber, 'WG9100440030', 'Preset OEM map applies');
      assert.equal(truck.sku, 'WG9100440030', 'SKU falls back to the OEM number under the preset');
      assert.ok(String(truck.barcode).startsWith('200'), 'Preset barcode pattern kept');
      assert.equal(Number(truck.category_id), Number(cats[0].id));
      assert.equal(Number(truck.cost_price), 5000);
      assert.equal(Number(truck.retail_price), 6750, 'Preset retail markup 1.35');
      assert.equal(Number(truck.wholesale_price), 6000, 'Preset wholesale markup 1.20');
      assert.equal(meta.carBrand, 'شاحنات نقل ثقيل (HOWO / Shacman / Weichai)');
      assert.equal(meta.carModel, 'ديزل تجاري');
      assert.equal(meta.carYearFrom, 2018);
      assert.equal(meta.carYearTo, 2026);
      assert.equal(meta.origin, 'الصين');

      const presets = service.listSectorPresets();
      assert.equal(presets.length, 1);
      assert.equal(presets[0].key, 'truck_parts');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: unknown preset fails closed at creation; missing
  // rate fails closed at import (no silent 50).
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await expectReject(
        service.createProject('t1', { title: 'Bad sector', sectorPreset: 'spaceships', feasibilityData: feasibilityItems() }),
        'IMPORT_UNKNOWN_SECTOR_PRESET',
      );
      const rows: any[] = await (db as any).selectFrom('import_projects').select('id').execute();
      assert.equal(rows.length, 0, 'Failed creation writes nothing');

      const project: any = await service.createProject('t1', {
        title: 'No rate', feasibilityData: feasibilityItems(),
      });
      await seedShipment(db, project.id, null);
      await expectReject(
        service.importProjectItemsToShipment('t1', 1, 'sh-1'),
        'IMPORT_EXCHANGE_RATE_REQUIRED',
      );
      const items: any[] = await (db as any).selectFrom('import_shipment_items').select('id').execute();
      assert.equal(items.length, 0, 'Failed import writes no items');

      // A feasibility-only rate is NOT enough: the landed-cost
      // calculation at the end of the import demands a real
      // arrival rate, so the whole import fails closed and the
      // transaction rolls back (no items, no products).
      const project2: any = await service.createProject('t1', {
        title: 'Feasibility rate', feasibilityData: feasibilityItems(48),
      });
      await (db as any).insertInto('import_shipments').values({
        id: 'sh-2', tenant_id: 't1', container_number: 'C2', status: 'Pending',
        exchange_rate_at_arrival: null, project_id: project2.id,
        shipping_cost_usd: 0, customs_cost_egp: 0, internal_transport_cost_egp: 0,
        cost_allocation_method: 'value',
      }).execute();
      await expectReject(
        service.importProjectItemsToShipment('t1', 1, 'sh-2'),
        'IMPORT_ARRIVAL_RATE_REQUIRED',
      );
      const itemsAfter: any[] = await (db as any).selectFrom('import_shipment_items').select('id').execute();
      assert.equal(itemsAfter.length, 0, 'Rolled-back import leaves no items');
      const productsAfter: any[] = await (db as any).selectFrom('products').select('id').execute();
      assert.equal(productsAfter.length, 0, 'Rolled-back import leaves no products');
    } finally {
      await db.destroy();
    }
  }

  // Case 4: an existing product is linked as-is, never rewritten.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      await (db as any).insertInto('suppliers').values({ id: 7, tenant_id: 't1', account_id: 't1', name: 'Curated Supplier' }).execute();
      await (db as any).insertInto('product_categories').values({ id: 9, tenant_id: 't1', account_id: 't1', name: 'Curated Category', is_active: true }).execute();
      await (db as any).insertInto('products').values({
        tenant_id: 't1', account_id: 't1', name: KNOWN_TRUCK_ITEM,
        sku: 'CURATED-SKU', barcode: 'CURATED-BARCODE', supplier_id: 7, category_id: 9,
        cost_price: 111, retail_price: 222, wholesale_price: 199,
        stock_qty: 5, reserved_qty: 0, min_stock_qty: 0,
        notes: 'Curated notes, do not touch',
        metadata: JSON.stringify({ curated: true }),
        is_active: true, item_kind: 'standard', item_type: 'product', track_serials: false,
        catalog_updated_at: new Date('2026-01-01'),
      }).execute();
      const before: any = await (db as any).selectFrom('products').selectAll().executeTakeFirstOrThrow();

      const project: any = await service.createProject('t1', {
        title: 'Truck parts import', sectorPreset: 'truck_parts', feasibilityData: feasibilityItems(),
      });
      await seedShipment(db, project.id, 50);
      const res = await service.importProjectItemsToShipment('t1', 1, 'sh-1');
      assert.equal(res.importedCount, 2, 'Both items import, one linked to the curated product');

      const after: any = await (db as any).selectFrom('products').selectAll().where('id', '=', before.id).executeTakeFirstOrThrow();
      assert.equal(after.sku, 'CURATED-SKU');
      assert.equal(after.barcode, 'CURATED-BARCODE');
      assert.equal(Number(after.supplier_id), 7);
      assert.equal(Number(after.category_id), 9);
      assert.equal(Number(after.cost_price), 111);
      assert.equal(Number(after.retail_price), 222);
      assert.equal(after.notes, 'Curated notes, do not touch');
      const afterMeta = typeof after.metadata === 'string' ? JSON.parse(after.metadata) : after.metadata;
      assert.deepEqual(afterMeta, { curated: true }, 'Metadata untouched');
    } finally {
      await db.destroy();
    }
  }

  // Case 5: the preset locks once shipment items exist.
  {
    const db = await makeDb();
    try {
      const service = makeService(db);
      const project: any = await service.createProject('t1', {
        title: 'Generic first', feasibilityData: feasibilityItems(),
      });
      const updated: any = await service.updateProject('t1', project.id, { sectorPreset: 'truck_parts' });
      assert.equal(updated.sector_preset, 'truck_parts', 'Preset change allowed before any items exist');

      await seedShipment(db, project.id, 50);
      await service.importProjectItemsToShipment('t1', 1, 'sh-1');
      await expectReject(
        service.updateProject('t1', project.id, { sectorPreset: null }),
        'IMPORT_SECTOR_PRESET_LOCKED',
      );
      const kept: any = await (db as any).selectFrom('import_projects').select('sector_preset').where('id', '=', project.id).executeTakeFirstOrThrow();
      assert.equal(kept.sector_preset, 'truck_parts', 'Locked preset unchanged after rejection');
      await expectReject(
        service.updateProject('t1', project.id, { sectorPreset: 'spaceships' }),
        'IMPORT_UNKNOWN_SECTOR_PRESET',
      );
    } finally {
      await db.destroy();
    }
  }
}

main()
  .then(() => {
    console.log('Import sector preset tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
