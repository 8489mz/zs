/*
New file: backend/test/critical/import-apply-prices-no-wac-overwrite.spec.ts
Pins the applySuggestedPrices guard (INV-IMPORT-APPLY-PRICES-NO-WAC-OVERWRITE).

WHAT WAS WRONG: applySuggestedPrices wrote products.cost_price — which
IS the weighted-average cost — to the current shipment's landed cost,
and overwrote supplier_id and category_id for every product in the
shipment, with no product locks and no receipt-state guard. Running it
after receipt on a product with prior stock destroyed the blended WAC
and broke GL inventory reconciliation (sum(stock_qty x cost_price)
against posted 1140), and silently re-homed catalog identity.

WHAT THIS PINS, driving the real applySuggestedPrices on PGlite:
- A product with pre-existing stock keeps its blended cost_price, its
  supplier_id and its category_id after apply; only retail/wholesale
  prices move, from the existing pricingCostEgp computation.
- A pricing exchange rate different from the arrival rate still
  reprices retail/wholesale only; cost_price never moves.
- An unknown shipment id fails closed instead of silently succeeding.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

async function makeDb(): Promise<Kysely<Database>> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, cost_price numeric, retail_price numeric, wholesale_price numeric, supplier_id bigint, category_id bigint, stock_qty numeric, reserved_qty numeric, catalog_updated_at timestamptz, updated_at timestamptz);
    CREATE TABLE import_shipments (id text PRIMARY KEY, tenant_id text, exchange_rate_at_arrival numeric, pricing_exchange_rate numeric, project_id text, supplier_id bigint, container_number text);
    CREATE TABLE import_shipment_items (id text PRIMARY KEY, tenant_id text, shipment_id text, product_id bigint, landed_cost_egp numeric, factory_unit_price_usd numeric, target_retail_margin numeric, target_wholesale_margin numeric);
    CREATE TABLE import_projects (id text PRIMARY KEY, tenant_id text, supplier_id bigint);
    CREATE TABLE product_categories (id bigint PRIMARY KEY, tenant_id text, name text);
  `);
  return db;
}

async function seedCase(db: Kysely<Database>, opts: { arrivalRate: number; pricingRate: number | null }): Promise<void> {
  await db.insertInto('products' as never).values({
    id: 5, tenant_id: 't1', account_id: 't1', name: 'Widget', cost_price: 500,
    retail_price: 600, wholesale_price: 550, supplier_id: 11, category_id: 21,
    stock_qty: 10, reserved_qty: 0, catalog_updated_at: new Date(), updated_at: new Date(),
  } as never).execute();
  await db.insertInto('import_projects' as never).values({
    id: 'proj-1', tenant_id: 't1', supplier_id: 99,
  } as never).execute();
  await db.insertInto('product_categories' as never).values({
    id: 22, tenant_id: 't1', name: 'قطع غيار شاحنات ونقل ثقيل',
  } as never).execute();
  await db.insertInto('import_shipments' as never).values({
    id: 'sh-1', tenant_id: 't1', exchange_rate_at_arrival: opts.arrivalRate,
    pricing_exchange_rate: opts.pricingRate, project_id: 'proj-1', supplier_id: 99,
    container_number: 'MSCU-1',
  } as never).execute();
  await db.insertInto('import_shipment_items' as never).values({
    id: 'item-1', tenant_id: 't1', shipment_id: 'sh-1', product_id: 5,
    landed_cost_egp: 700, factory_unit_price_usd: 10,
    target_retail_margin: 20, target_wholesale_margin: 5,
  } as never).execute();
}

async function readProduct(db: Kysely<Database>): Promise<any> {
  return (db as any).selectFrom('products').selectAll().where('id', '=', 5).executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  // Case 1: blended WAC and catalog identity survive; prices move.
  {
    const db = await makeDb();
    try {
      await seedCase(db, { arrivalRate: 50, pricingRate: 50 });
      const service = new (ImportSalesService as any)(db);
      const result = await service.applySuggestedPrices('t1', 'sh-1');
      assert.equal(result.updatedCount, 1);
      const product = await readProduct(db);
      assert.equal(Number(product.cost_price), 500, 'Blended WAC must survive applySuggestedPrices');
      assert.equal(Number(product.supplier_id), 11, 'supplier_id must not be overwritten');
      assert.equal(Number(product.category_id), 21, 'category_id must not be overwritten');
      assert.equal(Number(product.retail_price), 840, 'Retail follows pricing cost 700 x 1.20');
      assert.equal(Number(product.wholesale_price), 735, 'Wholesale follows pricing cost 700 x 1.05');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: a different pricing rate reprices selling prices only.
  {
    const db = await makeDb();
    try {
      await seedCase(db, { arrivalRate: 50, pricingRate: 55 });
      const service = new (ImportSalesService as any)(db);
      await service.applySuggestedPrices('t1', 'sh-1');
      const product = await readProduct(db);
      assert.equal(Number(product.cost_price), 500, 'Cost must stay at the blended WAC, not the repriced cost');
      // pricingCostEgp = 700 + 10 x (55 - 50) = 750; retail 20% -> 900.
      assert.equal(Number(product.retail_price), 900);
      assert.equal(Number(product.wholesale_price), 787.5);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: an unknown shipment fails closed.
  {
    const db = await makeDb();
    try {
      const service = new (ImportSalesService as any)(db);
      await assert.rejects(
        async () => service.applySuggestedPrices('t1', 'no-such-shipment'),
        /غير موجود/,
        'Applying prices to a missing shipment must fail closed',
      );
    } finally {
      await db.destroy();
    }
  }

  console.log('Import apply-prices no-WAC-overwrite tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
