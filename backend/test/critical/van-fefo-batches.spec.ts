/*
New file: backend/test/critical/van-fefo-batches.spec.ts
Pins INV-VAN-FEFO-BATCHES: the pharmacy batch ledger moves with the pooled
van stock, driving the REAL VanSalesService on PGlite.

WHAT THE AUDIT FEARED: van field sales bypassed FEFO entirely. Loading a
van moved pooled stock only, so no batch rows ever reached the van
location; a field sale then deducted pooled stock only, so expired
batches could be sold, the batch ledger never decreased, and the
warehouse ledger kept claiming stock that was already on the street.

WHAT THIS PINS, driving the real openTripAndLoad / executeFieldSale:
1. Loading carries the earliest-expiry batches onto the van location and
   merges into the destination row of the same batch number.
2. A field sale deducts the van's batches earliest-expiry-first, skips
   expired batches, and writes sale_pharmacy_batch_allocations rows.
3. A sale whose valid van batches cannot cover the quantity fails closed
   with PHARMACY_FEFO_STOCK_UNAVAILABLE and rolls the whole sale back.
4. Products with no drug link and no batch rows sell pooled-only, exactly
   as before.
5. A load whose source batches cannot cover the quantity still loads the
   pooled stock (the move is soft); the sale is the fail-closed boundary.

Deliberately NOT driven here: the settlement unload/shortage legs share
the proven move helper but need the full settlement harness, which this
PGlite spec does not build; their one-line call sites are verified by
inspection. Null-location batches keep the shop gate's shared-pool
meaning at sale time and are never moved by a load.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

const TENANT = 't-van-fefo';
const ACCOUNT = 'a-van-fefo';

async function batchRows(db: Kysely<Database>, productId: number): Promise<Array<{ id: number; locationId: number | null; batch: string; expiry: string; qty: number; status: string }>> {
  const rows = await (db as any)
    .selectFrom('pharmacy_batches')
    .selectAll()
    .where('product_id', '=', productId)
    .where('tenant_id', '=', TENANT)
    .orderBy('expiry_date', 'asc')
    .orderBy('id', 'asc')
    .execute();
  return rows.map((r: any) => ({
    id: Number(r.id),
    locationId: r.location_id == null ? null : Number(r.location_id),
    batch: String(r.batch_number),
    expiry: String(r.expiry_date),
    qty: Number(r.quantity),
    status: String(r.status),
  }));
}

async function scopedQty(db: Kysely<Database>, productId: number, locationId: number): Promise<number> {
  const row = await (db as any)
    .selectFrom('product_location_stock')
    .select('qty')
    .where('product_id', '=', productId)
    .where('location_id', '=', locationId)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirst();
  return row ? Number(row.qty) : 0;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, name text, metadata text);
    `);

    const postingStub = {
      postSale: async () => undefined,
      clearPostingFailure: async () => undefined,
      postVanStockTransfer: async () => undefined,
    };
    const service = new VanSalesService(db, {} as never, {} as never, postingStub as never);
    // Harness note: resolveSystemAuthContext reads the pool (this.db), not
    // the transaction. On real Postgres that is a second pooled connection;
    // on PGlite's single-connection dialect it deadlocks the transaction
    // that calls it. The posting collaborator is stubbed, so the auth
    // context value is never consumed; shadow it for the harness only.
    (service as any).resolveSystemAuthContext = async () => ({ userId: 1, sessionId: 'spec', username: 'spec' });

    await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'sys', is_active: true }).execute();
    await anyDb.insertInto('accounting_settings').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT }).execute();
    await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();

    async function seedRep(repId: number): Promise<void> {
      await anyDb.insertInto('delivery_representatives').values({ id: repId, tenant_id: TENANT, account_id: ACCOUNT, name: `Rep ${repId}`, is_van_rep: true }).execute();
    }
    async function seedProduct(productId: number, stock: number): Promise<void> {
      await anyDb.insertInto('products').values({ id: productId, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${productId}`, stock_qty: stock, cost_price: 10, retail_price: 100, wholesale_price: 90, credit_price: 100, consumer_price: 100, is_active: true }).execute();
      await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: productId, location_id: 10, qty: stock }).execute();
    }
    async function seedBatch(productId: number, batch: string, expiry: string, qty: number): Promise<number> {
      const row = await anyDb.insertInto('pharmacy_batches').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: productId, drug_id: null, batch_number: batch, expiry_date: expiry, quantity: qty, unit_cost: 10, location_id: 10, status: 'active' }).returning(['id']).executeTakeFirstOrThrow();
      return Number(row.id);
    }
    async function vanLocationId(repId: number): Promise<number> {
      const rep = await anyDb.selectFrom('delivery_representatives').select('van_location_id').where('id', '=', repId).executeTakeFirstOrThrow();
      return Number(rep.van_location_id);
    }

    // Case 1: load carries FEFO batches onto the van, merging by batch number.
    await seedRep(1);
    await seedProduct(101, 20);
    await anyDb.insertInto('pharmacy_drugs').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, name: 'Drug 101' }).execute();
    await seedBatch(101, 'B-EARLY', '2027-01-31', 10);
    await seedBatch(101, 'B-LATE', '2027-06-30', 10);
    const trip1 = await service.openTripAndLoad(1, TENANT, ACCOUNT, { sourceWarehouseId: 10, items: [{ productId: 101, qty: 12 }] });
    assert.ok(trip1.tripId > 0);
    const van1 = await vanLocationId(1);
    assert.equal(await scopedQty(db, 101, 10), 8);
    assert.equal(await scopedQty(db, 101, van1), 12);
    const afterLoad = await batchRows(db, 101);
    assert.deepEqual(
      afterLoad.map((r) => [r.locationId, r.batch, r.qty, r.status]),
      [
        [10, 'B-EARLY', 0, 'depleted'],
        [van1, 'B-EARLY', 10, 'active'],
        [10, 'B-LATE', 8, 'active'],
        [van1, 'B-LATE', 2, 'active'],
      ],
    );

    // Case 2: a second load of the same batch merges into the van row.
    await service.loadSupplementaryStockToActiveTrip(1, TENANT, ACCOUNT, trip1.tripId, { sourceWarehouseId: 10, items: [{ productId: 101, qty: 4 }] });
    const afterReload = await batchRows(db, 101);
    assert.deepEqual(
      afterReload.map((r) => [r.locationId, r.batch, r.qty, r.status]),
      [
        [10, 'B-EARLY', 0, 'depleted'],
        [van1, 'B-EARLY', 10, 'active'],
        [10, 'B-LATE', 4, 'active'],
        [van1, 'B-LATE', 6, 'active'],
      ],
    );

    // Case 3: a field sale deducts the van batches earliest-first, skips an
    // expired batch, and records allocations against the sale items.
    await seedRep(2);
    await seedProduct(102, 20);
    await anyDb.insertInto('pharmacy_drugs').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 102, name: 'Drug 102' }).execute();
    const expiredId = await seedBatch(102, 'B-OLD', '2020-01-31', 5);
    await seedBatch(102, 'B-NEW', '2027-03-31', 10);
    const trip2 = await service.openTripAndLoad(2, TENANT, ACCOUNT, { sourceWarehouseId: 10, items: [{ productId: 102, qty: 12 }] });
    const van2 = await vanLocationId(2);
    // The expired batch is skipped at load: only 10 valid units travel.
    const loaded2 = await batchRows(db, 102);
    assert.equal(loaded2.filter((r) => r.locationId === van2).reduce((s, r) => s + r.qty, 0), 10);
    assert.equal(loaded2.find((r) => r.id === expiredId)?.qty, 5);
    const sale2 = await service.executeFieldSale(2, TENANT, ACCOUNT, {
      tripId: trip2.tripId,
      paymentMethod: 'cash',
      items: [{ productId: 102, qty: 4, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
    });
    assert.ok(sale2.saleId > 0);
    assert.equal(await scopedQty(db, 102, van2), 8);
    const sold2 = await batchRows(db, 102);
    assert.equal(sold2.filter((r) => r.locationId === van2).reduce((s, r) => s + r.qty, 0), 6);
    assert.equal(sold2.find((r) => r.id === expiredId)?.qty, 5);
    const allocs = await anyDb.selectFrom('sale_pharmacy_batch_allocations').selectAll().where('sale_id', '=', sale2.saleId).where('tenant_id', '=', TENANT).execute();
    assert.equal(allocs.length, 1);
    assert.equal(Number(allocs[0].quantity), 4);
    assert.equal(Number(allocs[0].product_id), 102);
    const saleItems = await anyDb.selectFrom('sale_items').selectAll().where('sale_id', '=', sale2.saleId).execute();
    assert.equal(saleItems.length, 1);
    assert.equal(Number(allocs[0].sale_item_id), Number(saleItems[0].id));

    // Case 4: a sale the van's valid batches cannot cover fails closed and
    // rolls everything back (pooled stock, batches, no sale row).
    await seedRep(3);
    await seedProduct(103, 5);
    await anyDb.insertInto('pharmacy_drugs').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 103, name: 'Drug 103' }).execute();
    await seedBatch(103, 'B-ONLY', '2027-01-31', 3);
    const trip3 = await service.openTripAndLoad(3, TENANT, ACCOUNT, { sourceWarehouseId: 10, items: [{ productId: 103, qty: 5 }] });
    const van3 = await vanLocationId(3);
    await assert.rejects(
      service.executeFieldSale(3, TENANT, ACCOUNT, {
        tripId: trip3.tripId,
        paymentMethod: 'cash',
        items: [{ productId: 103, qty: 4, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
      }),
      (err: any) => err && err.code === 'PHARMACY_FEFO_STOCK_UNAVAILABLE',
    );
    assert.equal(await scopedQty(db, 103, van3), 5);
    assert.equal((await batchRows(db, 103)).filter((r) => r.locationId === van3).reduce((s, r) => s + r.qty, 0), 3);
    const sales3 = await anyDb.selectFrom('sales').select('id').where('van_trip_id', '=', trip3.tripId).where('tenant_id', '=', TENANT).execute();
    assert.equal(sales3.length, 0);

    // Case 5: a product with no drug link and no batch rows sells pooled-only.
    await seedRep(4);
    await seedProduct(104, 10);
    const trip4 = await service.openTripAndLoad(4, TENANT, ACCOUNT, { sourceWarehouseId: 10, items: [{ productId: 104, qty: 6 }] });
    const van4 = await vanLocationId(4);
    const sale4 = await service.executeFieldSale(4, TENANT, ACCOUNT, {
      tripId: trip4.tripId,
      paymentMethod: 'cash',
      items: [{ productId: 104, qty: 2, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
    });
    assert.ok(sale4.saleId > 0);
    assert.equal(await scopedQty(db, 104, van4), 4);
    assert.equal((await batchRows(db, 104)).length, 0);

    // Case 6: the load is soft — pooled stock still loads when the source
    // batches cannot cover it; the sale remains the fail-closed boundary.
    await seedRep(5);
    await seedProduct(105, 8);
    await anyDb.insertInto('pharmacy_drugs').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 105, name: 'Drug 105' }).execute();
    await seedBatch(105, 'B-PART', '2027-01-31', 2);
    const trip5 = await service.openTripAndLoad(5, TENANT, ACCOUNT, { sourceWarehouseId: 10, items: [{ productId: 105, qty: 8 }] });
    const van5 = await vanLocationId(5);
    assert.equal(await scopedQty(db, 105, van5), 8);
    assert.equal((await batchRows(db, 105)).filter((r) => r.locationId === van5).reduce((s, r) => s + r.qty, 0), 2);
    await assert.rejects(
      service.executeFieldSale(5, TENANT, ACCOUNT, {
        tripId: trip5.tripId,
        paymentMethod: 'cash',
        items: [{ productId: 105, qty: 3, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
      }),
      (err: any) => err && err.code === 'PHARMACY_FEFO_STOCK_UNAVAILABLE',
    );
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('van FEFO batch checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
