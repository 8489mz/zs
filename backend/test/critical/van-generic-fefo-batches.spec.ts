/*
New file: backend/test/critical/van-generic-fefo-batches.spec.ts
Pins INV-VAN-GENERIC-FEFO, driving the REAL production code on PGlite:
the VanSalesService end-to-end for the van legs (as
van-fefo-batches.spec.ts does for pharmacy), the real
SalesRestaurantAndSerialsHelper for the shop legs, the real
upsertInventoryBatchFromReceipt helper for intake, the real
moveDirectTrackedStock helper for transfers, and the real
ReturnsService restore for shop returns.

WHAT THE AUDIT FEARED: FEFO existed only for pharmacy-tracked products,
so general wholesale goods sold pooled-only and expired stock could
reach a customer; and a second ledger risked double-deducting the same
sale if both paths ever ran for one product.

WHAT THIS PINS:
(a) shop sale sells the 2-month batch first, then 6-month, then 1-year.
(b) same on a van field sale (van location, real openTripAndLoad /
    executeFieldSale, allocations written).
(c) a NULL-expiry batch is consumed ONLY after all dated batches.
(d) an expired generic batch is skipped, never sold.
(e) an uncovered sale fails closed with INVENTORY_FEFO_STOCK_UNAVAILABLE
    and rolls the whole sale back (no partial deduction).
(f) a no-batch product sells pooled-only, exactly as before.
(g) PRECEDENCE: a drug-linked product uses the pharmacy ledger only
    (generic rows untouched); a product with legacy active pharmacy rows
    and no drug link also stays on the pharmacy ledger until they drain.
(h) intake helper: batch+expiry creates the row; batch without expiry
    creates a NULL-expiry row; same batch+expiry merges; different
    expiry is 422 INVENTORY_BATCH_EXPIRY_MISMATCH; expired expiry is 422
    INVENTORY_BATCH_EXPIRED; NULL merges with NULL.
(i) edit/cancel restores generic quantities (allocations deleted on
    edit, kept on cancel); shop return restores to the original batch,
    newest-first; van return restores on approval via the same rule.
(j) (proof step, not a case here) van-fefo-batches.spec.ts passes
    UNCHANGED — run alongside this spec.
(k) the direct transfer helper moves generic batches with the goods
    (full-balance rule) and refuses a partial move.

Deliberately NOT driven here: the full GRN / purchase-bill service
methods (their GRNI/journal harness is out of scope for this PGlite
spec, same as the settlement legs in van-fefo-batches.spec.ts) — the
intake ROUTING (drug -> pharmacy, non-drug -> generic) is a two-line
condition at each call site, verified by inspection; the upsert
mechanics it calls are driven here in (h). The van-load FEFO display
query is read-only and verified by inspection; the ordering semantics
it relies on are pinned by (a)-(c).
*/
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { SalesRestaurantAndSerialsHelper } from '../../src/modules/sales/services/sales-restaurant-and-serials.service';
import { upsertInventoryBatchFromReceipt } from '../../src/modules/purchases/helpers/inventory-batch-receipt.helper';
import { moveDirectTrackedStock } from '../../src/modules/inventory/helpers/direct-tracked-stock-move.helper';
import { restoreReturnedInventoryBatches } from '../../src/modules/delivery-reps/services/van-inventory-batches.helper';
import { ReturnsService } from '../../src/modules/returns/returns.service';

const TENANT = 't-van-generic-fefo';
const ACCOUNT = 'a-van-generic-fefo';
const SCOPE = { tenantId: TENANT, accountId: ACCOUNT };
const AUTH: any = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'super_admin',
  permissions: ['sales', 'reports'],
  tenantId: TENANT,
  accountId: ACCOUNT,
};

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
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, half_wholesale_price numeric, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, location_id bigint, branch_id bigint, status text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, business_day text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, system_cash_discount_amount numeric, gps_missing_reason text, received_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, line_discount numeric DEFAULT 0, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
      CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE price_list_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric DEFAULT 1, fixed_price numeric, discount_percent numeric, created_at timestamptz DEFAULT NOW());
    `);

    const postingStub = {
      postSale: async () => undefined,
      clearPostingFailure: async () => undefined,
      postVanStockTransfer: async () => undefined,
    };
    const vanService = new VanSalesService(db, {} as never, {} as never, postingStub as never);
    (vanService as any).resolveSystemAuthContext = async () => ({ userId: 1, sessionId: 'spec', username: 'spec' });
    // PGlite single-connection: the lifecycle service is built EAGERLY
    // in the VanSalesService ctor, so it captured the ORIGINAL bound
    // resolveSystemAuthContext (a pool read) before this shadow landed.
    // Its openTripAndLoad calls it INSIDE the load transaction
    // (van-trip-lifecycle.service.ts, postVanStockTransfer leg) — a pool
    // read inside the open transaction never returns on PGlite and the
    // process exits 0 with no error. Shadow it on the lifecycle
    // instance too (same harness-only pattern as the nine specs).
    (vanService as any).tripLifecycle.resolveSystemAuthContext = async () => ({
      userId: 1,
      sessionId: 'spec',
      username: 'spec',
    });
    const shopHelper = new SalesRestaurantAndSerialsHelper({
      accountingPosting: {} as never,
      planFeatureService: {} as never,
    });
    const returnsService = new ReturnsService(db, {} as never, {} as never, {} as never, {} as never);

    await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'sys', is_active: true }).execute();
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' }).execute();
    await anyDb
      .insertInto('currency_exchange_rates')
      .values({ tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1 })
      .execute();
    await anyDb.insertInto('accounting_settings').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT }).execute();
    await anyDb
      .insertInto('stock_locations')
      .values({
        id: 10,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Main warehouse',
        location_type: 'internal_warehouse',
        is_active: true,
      })
      .execute();

    async function seedRep(repId: number): Promise<void> {
      await anyDb
        .insertInto('delivery_representatives')
        .values({ id: repId, tenant_id: TENANT, account_id: ACCOUNT, name: `Rep ${repId}`, is_van_rep: true })
        .execute();
    }
    async function seedProduct(productId: number, stock: number): Promise<void> {
      await anyDb
        .insertInto('products')
        .values({
          id: productId,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: `Product ${productId}`,
          stock_qty: stock,
          cost_price: 10,
          retail_price: 100,
          wholesale_price: 90,
          credit_price: 100,
          consumer_price: 100,
          is_active: true,
        })
        .execute();
      await anyDb
        .insertInto('product_location_stock')
        .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: productId, location_id: 10, qty: stock })
        .execute();
    }
    async function seedGenericBatch(
      productId: number,
      batch: string,
      expiry: string | null,
      qty: number,
      locationId = 10,
    ): Promise<number> {
      const row = await anyDb
        .insertInto('inventory_batches')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          product_id: productId,
          batch_number: batch,
          expiry_date: expiry,
          quantity: qty,
          unit_cost: 10,
          location_id: locationId,
          status: 'active',
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return Number(row.id);
    }
    async function seedPharmacyBatch(
      productId: number,
      batch: string,
      expiry: string,
      qty: number,
      drugId: number | null = null,
      locationId = 10,
    ): Promise<number> {
      const row = await anyDb
        .insertInto('pharmacy_batches')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          product_id: productId,
          drug_id: drugId,
          batch_number: batch,
          expiry_date: expiry,
          quantity: qty,
          unit_cost: 10,
          location_id: locationId,
          status: 'active',
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return Number(row.id);
    }
    async function genericRows(productId: number): Promise<
      Array<{
        id: number;
        locationId: number | null;
        batch: string;
        expiry: string | null;
        qty: number;
        status: string;
      }>
    > {
      const rows = await anyDb
        .selectFrom('inventory_batches')
        .selectAll()
        .where('product_id', '=', productId)
        .where('tenant_id', '=', TENANT)
        .orderBy('expiry_date', (ob: any) => ob.asc().nullsLast())
        .orderBy('id', 'asc')
        .execute();
      return rows.map((r: any) => ({
        id: Number(r.id),
        locationId: r.location_id == null ? null : Number(r.location_id),
        batch: String(r.batch_number),
        expiry: r.expiry_date == null ? null : String(r.expiry_date),
        qty: Number(r.quantity),
        status: String(r.status),
      }));
    }
    async function scopedQty(productId: number, locationId: number): Promise<number> {
      const row = await anyDb
        .selectFrom('product_location_stock')
        .select('qty')
        .where('product_id', '=', productId)
        .where('location_id', '=', locationId)
        .where('tenant_id', '=', TENANT)
        .executeTakeFirst();
      return row ? Number(row.qty) : 0;
    }
    async function vanLocationId(repId: number): Promise<number> {
      const rep = await anyDb
        .selectFrom('delivery_representatives')
        .select('van_location_id')
        .where('id', '=', repId)
        .executeTakeFirstOrThrow();
      return Number(rep.van_location_id);
    }

    // (a) shop sale sells the 2-month batch first, then 6-month, then 1-year.
    await seedProduct(201, 30);
    await seedGenericBatch(201, 'B-1Y', '2027-11-30', 5);
    await seedGenericBatch(201, 'B-6MO', '2027-05-31', 5);
    await seedGenericBatch(201, 'B-2MO', '2027-01-31', 5);
    await db.transaction().execute(async (trx) => {
      await shopHelper.deductInventoryBatchesFefo(trx, 201, [{ locationId: 10, qty: 8 }], SCOPE, 9001, 1);
    });
    assert.deepEqual(
      (await genericRows(201)).map((r) => [r.batch, r.qty, r.status]),
      [
        ['B-2MO', 0, 'depleted'],
        ['B-6MO', 2, 'active'],
        ['B-1Y', 5, 'active'],
      ],
    );
    const allocsA = await anyDb
      .selectFrom('sale_inventory_batch_allocations')
      .selectAll()
      .where('sale_id', '=', 9001)
      .where('tenant_id', '=', TENANT)
      .orderBy('id', 'asc')
      .execute();
    assert.deepEqual(
      allocsA.map((a: any) => Number(a.quantity)),
      [5, 3],
    );

    // (c) a NULL-expiry batch is consumed ONLY after all dated batches.
    await seedProduct(202, 20);
    await seedGenericBatch(202, 'B-DATED', '2027-01-31', 5);
    await seedGenericBatch(202, 'B-NODATE', null, 5);
    await db.transaction().execute(async (trx) => {
      await shopHelper.deductInventoryBatchesFefo(trx, 202, [{ locationId: 10, qty: 7 }], SCOPE, 9002, 1);
    });
    assert.deepEqual(
      (await genericRows(202)).map((r) => [r.batch, r.qty, r.status]),
      [
        ['B-DATED', 0, 'depleted'],
        ['B-NODATE', 3, 'active'],
      ],
    );

    // (d) an expired generic batch is skipped, never sold.
    await seedProduct(203, 20);
    await seedGenericBatch(203, 'B-OLD', '2020-01-31', 5);
    await seedGenericBatch(203, 'B-NEW', '2027-03-31', 10);
    await db.transaction().execute(async (trx) => {
      await shopHelper.deductInventoryBatchesFefo(trx, 203, [{ locationId: 10, qty: 4 }], SCOPE, 9003, 1);
    });
    assert.deepEqual(
      (await genericRows(203)).map((r) => [r.batch, r.qty]),
      [
        ['B-OLD', 5],
        ['B-NEW', 6],
      ],
    );

    // (e) an uncovered SHOP sale fails closed and rolls back (no partial deduction).
    await seedProduct(204, 10);
    await seedGenericBatch(204, 'B-ONLY', '2027-01-31', 3);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await shopHelper.deductInventoryBatchesFefo(trx, 204, [{ locationId: 10, qty: 4 }], SCOPE, 9004, 1);
      }),
      (err: any) => err && err.code === 'INVENTORY_FEFO_STOCK_UNAVAILABLE' && err.statusCode === 422,
    );
    assert.deepEqual(
      (await genericRows(204)).map((r) => [r.batch, r.qty]),
      [['B-ONLY', 3]],
    );
    assert.equal(
      (await anyDb.selectFrom('sale_inventory_batch_allocations').select('id').where('sale_id', '=', 9004).execute())
        .length,
      0,
    );

    // (b) van field sale deducts the van's generic batches earliest-first.
    await seedRep(11);
    await seedProduct(205, 20);
    await seedGenericBatch(205, 'B-EARLY', '2027-01-31', 10);
    await seedGenericBatch(205, 'B-LATE', '2027-06-30', 10);
    const tripB = await vanService.openTripAndLoad(11, TENANT, ACCOUNT, {
      sourceWarehouseId: 10,
      items: [{ productId: 205, qty: 12 }],
    });
    const vanB = await vanLocationId(11);
    assert.deepEqual(
      (await genericRows(205)).map((r) => [r.locationId, r.batch, r.qty, r.status]),
      [
        [10, 'B-EARLY', 0, 'depleted'],
        [vanB, 'B-EARLY', 10, 'active'],
        [10, 'B-LATE', 8, 'active'],
        [vanB, 'B-LATE', 2, 'active'],
      ],
    );
    const saleB = await vanService.executeFieldSale(11, TENANT, ACCOUNT, {
      tripId: tripB.tripId,
      paymentMethod: 'cash',
      items: [{ productId: 205, qty: 4, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
    });
    assert.ok(saleB.saleId > 0);
    assert.equal(await scopedQty(205, vanB), 8);
    const soldB = await genericRows(205);
    assert.equal(
      soldB.filter((r) => r.locationId === vanB).reduce((s, r) => s + r.qty, 0),
      8,
    );
    const allocsB = await anyDb
      .selectFrom('sale_inventory_batch_allocations')
      .selectAll()
      .where('sale_id', '=', saleB.saleId)
      .where('tenant_id', '=', TENANT)
      .execute();
    assert.equal(allocsB.length, 1);
    assert.equal(Number(allocsB[0].quantity), 4);
    const saleItemsB = await anyDb.selectFrom('sale_items').selectAll().where('sale_id', '=', saleB.saleId).execute();
    assert.equal(saleItemsB.length, 1);
    assert.equal(Number(allocsB[0].sale_item_id), Number(saleItemsB[0].id));

    // (e, van half) an uncovered VAN sale fails closed and rolls back.
    await seedRep(12);
    await seedProduct(206, 5);
    await seedGenericBatch(206, 'B-ONLY', '2027-01-31', 3);
    const tripE = await vanService.openTripAndLoad(12, TENANT, ACCOUNT, {
      sourceWarehouseId: 10,
      items: [{ productId: 206, qty: 5 }],
    });
    const vanE = await vanLocationId(12);
    await assert.rejects(
      vanService.executeFieldSale(12, TENANT, ACCOUNT, {
        tripId: tripE.tripId,
        paymentMethod: 'cash',
        items: [{ productId: 206, qty: 4, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
      }),
      (err: any) => err && err.code === 'INVENTORY_FEFO_STOCK_UNAVAILABLE',
    );
    assert.equal(await scopedQty(206, vanE), 5);
    assert.equal(
      (await genericRows(206)).filter((r) => r.locationId === vanE).reduce((s, r) => s + r.qty, 0),
      3,
    );
    const salesE = await anyDb
      .selectFrom('sales')
      .select('id')
      .where('van_trip_id', '=', tripE.tripId)
      .where('tenant_id', '=', TENANT)
      .execute();
    assert.equal(salesE.length, 0);

    // (f) a no-batch product sells pooled-only, exactly as before.
    await seedRep(13);
    await seedProduct(207, 10);
    const tripF = await vanService.openTripAndLoad(13, TENANT, ACCOUNT, {
      sourceWarehouseId: 10,
      items: [{ productId: 207, qty: 6 }],
    });
    const vanF = await vanLocationId(13);
    const saleF = await vanService.executeFieldSale(13, TENANT, ACCOUNT, {
      tripId: tripF.tripId,
      paymentMethod: 'cash',
      items: [{ productId: 207, qty: 2, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
    });
    assert.ok(saleF.saleId > 0);
    assert.equal(await scopedQty(207, vanF), 4);
    assert.equal((await genericRows(207)).length, 0);
    assert.equal(
      (
        await anyDb
          .selectFrom('sale_inventory_batch_allocations')
          .select('id')
          .where('sale_id', '=', saleF.saleId)
          .execute()
      ).length,
      0,
    );

    // (g) PRECEDENCE: a drug-linked product uses the pharmacy ledger only.
    await seedRep(14);
    await seedProduct(208, 20);
    const drug208 = await anyDb
      .insertInto('pharmacy_drugs')
      .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 208, name: 'Drug 208' })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    await seedPharmacyBatch(208, 'B-PHARM', '2027-01-31', 10, Number(drug208.id));
    await seedGenericBatch(208, 'B-GEN', '2027-01-31', 10);
    const tripG = await vanService.openTripAndLoad(14, TENANT, ACCOUNT, {
      sourceWarehouseId: 10,
      items: [{ productId: 208, qty: 12 }],
    });
    const vanG = await vanLocationId(14);
    const saleG = await vanService.executeFieldSale(14, TENANT, ACCOUNT, {
      tripId: tripG.tripId,
      paymentMethod: 'cash',
      items: [{ productId: 208, qty: 4, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
    });
    assert.ok(saleG.saleId > 0);
    const pharmG = await anyDb
      .selectFrom('pharmacy_batches')
      .selectAll()
      .where('product_id', '=', 208)
      .where('tenant_id', '=', TENANT)
      .execute();
    assert.equal(
      pharmG
        .filter((r: any) => Number(r.location_id) === vanG)
        .reduce((s: number, r: any) => s + Number(r.quantity), 0),
      6,
    );
    assert.deepEqual(
      (await genericRows(208)).map((r) => [r.locationId, r.qty]),
      [[10, 10]],
    );
    assert.equal(
      (
        await anyDb
          .selectFrom('sale_inventory_batch_allocations')
          .select('id')
          .where('sale_id', '=', saleG.saleId)
          .execute()
      ).length,
      0,
    );
    assert.equal(
      (
        await anyDb
          .selectFrom('sale_pharmacy_batch_allocations')
          .select('id')
          .where('sale_id', '=', saleG.saleId)
          .execute()
      ).length,
      1,
    );

    // (g, legacy half) a product with ACTIVE pharmacy rows and NO drug link
    // also stays on the pharmacy ledger until those rows drain.
    await seedRep(15);
    await seedProduct(209, 20);
    await seedPharmacyBatch(209, 'B-LEG', '2027-01-31', 10, null);
    await seedGenericBatch(209, 'B-GEN2', '2027-01-31', 10);
    const tripH = await vanService.openTripAndLoad(15, TENANT, ACCOUNT, {
      sourceWarehouseId: 10,
      items: [{ productId: 209, qty: 12 }],
    });
    const vanH = await vanLocationId(15);
    const saleH = await vanService.executeFieldSale(15, TENANT, ACCOUNT, {
      tripId: tripH.tripId,
      paymentMethod: 'cash',
      items: [{ productId: 209, qty: 4, unitPrice: 100, unitName: 'قطعة', unitMultiplier: 1 }],
    });
    assert.ok(saleH.saleId > 0);
    const pharmH = await anyDb
      .selectFrom('pharmacy_batches')
      .selectAll()
      .where('product_id', '=', 209)
      .where('tenant_id', '=', TENANT)
      .execute();
    assert.equal(
      pharmH
        .filter((r: any) => Number(r.location_id) === vanH)
        .reduce((s: number, r: any) => s + Number(r.quantity), 0),
      6,
    );
    assert.deepEqual(
      (await genericRows(209)).map((r) => [r.locationId, r.qty]),
      [[10, 10]],
    );
    assert.equal(
      (
        await anyDb
          .selectFrom('sale_inventory_batch_allocations')
          .select('id')
          .where('sale_id', '=', saleH.saleId)
          .execute()
      ).length,
      0,
    );

    // (h) intake helper: batch+expiry creates the row; batch without
    // expiry creates a NULL-expiry row; same batch+expiry merges;
    // NULL merges with NULL; different expiry and expired expiry fail.
    await db.transaction().execute(async (trx) => {
      await upsertInventoryBatchFromReceipt(trx, {
        tenantId: TENANT,
        accountId: ACCOUNT,
        productId: 210,
        batchNumber: 'GRN-1',
        expiryDate: '2027-03-31',
        qty: 10,
        unitCost: 5,
        locationId: 10,
        supplierName: 'Sup',
        notes: 'وارد',
      });
      await upsertInventoryBatchFromReceipt(trx, {
        tenantId: TENANT,
        accountId: ACCOUNT,
        productId: 210,
        batchNumber: 'GRN-2',
        expiryDate: '',
        qty: 4,
        unitCost: 5,
        locationId: 10,
        supplierName: 'Sup',
        notes: 'وارد',
      });
    });
    assert.deepEqual(
      (await genericRows(210)).map((r) => [r.batch, r.expiry, r.qty]),
      [
        ['GRN-1', '2027-03-31', 10],
        ['GRN-2', null, 4],
      ],
    );
    await db.transaction().execute(async (trx) => {
      await upsertInventoryBatchFromReceipt(trx, {
        tenantId: TENANT,
        accountId: ACCOUNT,
        productId: 210,
        batchNumber: 'GRN-1',
        expiryDate: '2027-03-31',
        qty: 5,
        unitCost: 5,
        locationId: 10,
        supplierName: 'Sup',
        notes: 'وارد',
      });
      await upsertInventoryBatchFromReceipt(trx, {
        tenantId: TENANT,
        accountId: ACCOUNT,
        productId: 210,
        batchNumber: 'GRN-2',
        expiryDate: '',
        qty: 2,
        unitCost: 5,
        locationId: 10,
        supplierName: 'Sup',
        notes: 'وارد',
      });
    });
    assert.deepEqual(
      (await genericRows(210)).map((r) => [r.batch, r.qty]),
      [
        ['GRN-1', 15],
        ['GRN-2', 6],
      ],
    );
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await upsertInventoryBatchFromReceipt(trx, {
          tenantId: TENANT,
          accountId: ACCOUNT,
          productId: 210,
          batchNumber: 'GRN-1',
          expiryDate: '2027-06-30',
          qty: 1,
          unitCost: 5,
          locationId: 10,
          supplierName: 'Sup',
          notes: 'وارد',
        });
      }),
      (err: any) => err && err.code === 'INVENTORY_BATCH_EXPIRY_MISMATCH' && err.statusCode === 422,
    );
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await upsertInventoryBatchFromReceipt(trx, {
          tenantId: TENANT,
          accountId: ACCOUNT,
          productId: 210,
          batchNumber: 'GRN-3',
          expiryDate: '2020-01-31',
          qty: 1,
          unitCost: 5,
          locationId: 10,
          supplierName: 'Sup',
          notes: 'وارد',
        });
      }),
      (err: any) => err && err.code === 'INVENTORY_BATCH_EXPIRED' && err.statusCode === 422,
    );
    assert.equal((await genericRows(210)).filter((r) => r.batch === 'GRN-3').length, 0);

    // (i) edit/cancel restores generic quantities (allocations deleted on
    // edit, kept on cancel); shop return restores to the original batch,
    // newest-first; van return restores on approval via the same rule.
    await db.transaction().execute(async (trx) => {
      await shopHelper.restoreSaleInventoryBatches(trx, 9001, [{ id: 1, product_id: 201 }], SCOPE, true);
    });
    assert.deepEqual(
      (await genericRows(201)).map((r) => [r.batch, r.qty, r.status]),
      [
        ['B-2MO', 5, 'active'],
        ['B-6MO', 5, 'active'],
        ['B-1Y', 5, 'active'],
      ],
    );
    assert.equal(
      (await anyDb.selectFrom('sale_inventory_batch_allocations').select('id').where('sale_id', '=', 9001).execute())
        .length,
      0,
    );
    await db.transaction().execute(async (trx) => {
      await shopHelper.deductInventoryBatchesFefo(trx, 201, [{ locationId: 10, qty: 8 }], SCOPE, 9010, 1);
      await shopHelper.restoreSaleInventoryBatches(trx, 9010, [{ id: 1, product_id: 201 }], SCOPE, false);
    });
    assert.deepEqual(
      (await genericRows(201)).map((r) => [r.batch, r.qty]),
      [
        ['B-2MO', 5],
        ['B-6MO', 5],
        ['B-1Y', 5],
      ],
    );
    assert.equal(
      (await anyDb.selectFrom('sale_inventory_batch_allocations').select('id').where('sale_id', '=', 9010).execute())
        .length,
      2,
    );

    // Shop return restore (real ReturnsService method): sale 9011 deducts
    // 6 (2MO 5 + 6MO 1); returning 2 restores newest-first (6MO 1, 2MO 1).
    await seedProduct(211, 30);
    await seedGenericBatch(211, 'B-2MO', '2027-01-31', 5);
    await seedGenericBatch(211, 'B-6MO', '2027-05-31', 5);
    await db.transaction().execute(async (trx) => {
      await shopHelper.deductInventoryBatchesFefo(trx, 211, [{ locationId: 10, qty: 6 }], SCOPE, 9011, 1);
    });
    assert.deepEqual(
      (await genericRows(211)).map((r) => [r.batch, r.qty]),
      [
        ['B-2MO', 0],
        ['B-6MO', 4],
      ],
    );
    await db.transaction().execute(async (trx) => {
      await (returnsService as any).restoreReturnedInventoryBatches(trx, 9011, 1, 211, 0, 2, AUTH);
    });
    assert.deepEqual(
      (await genericRows(211)).map((r) => [r.batch, r.qty, r.status]),
      [
        ['B-2MO', 1, 'active'],
        ['B-6MO', 5, 'active'],
      ],
    );
    // A return beyond what is left restorable fails closed.
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await (returnsService as any).restoreReturnedInventoryBatches(trx, 9011, 1, 211, 2, 5, AUTH);
      }),
      (err: any) => err && err.code === 'INVENTORY_BATCH_RETURN_EXCEEDED',
    );

    // Van return restore (real helper): the (b) sale consumed 4 from
    // B-EARLY; returning 2 restores 2, then the remaining 2.
    const saleItemB = Number(saleItemsB[0].id);
    await db.transaction().execute(async (trx) => {
      await restoreReturnedInventoryBatches(trx, saleB.saleId, saleItemB, 205, 0, 2, SCOPE);
    });
    assert.equal((await genericRows(205)).find((r) => r.batch === 'B-EARLY' && r.locationId === vanB)?.qty, 8);
    await db.transaction().execute(async (trx) => {
      await restoreReturnedInventoryBatches(trx, saleB.saleId, saleItemB, 205, 2, 2, SCOPE);
    });
    assert.equal((await genericRows(205)).find((r) => r.batch === 'B-EARLY' && r.locationId === vanB)?.qty, 10);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await restoreReturnedInventoryBatches(trx, saleB.saleId, saleItemB, 205, 4, 1, SCOPE);
      }),
      (err: any) => err && err.code === 'INVENTORY_BATCH_RETURN_EXCEEDED',
    );

    // (k) the direct transfer helper moves generic batches with the goods
    // (full-balance rule) and refuses a partial move.
    await seedProduct(212, 20);
    await seedGenericBatch(212, 'B-T1', '2027-01-31', 5);
    await seedGenericBatch(212, 'B-T2', '2027-06-30', 5);
    const trace = await db.transaction().execute(async (trx) => {
      return moveDirectTrackedStock(trx, SCOPE, 212, 10, { id: 10, branchId: null }, { id: 20, branchId: null }, 1);
    });
    assert.equal(trace.batchTracking.length, 2);
    assert.deepEqual(
      (await genericRows(212)).map((r) => [r.locationId, r.batch, r.qty, r.status]),
      [
        [10, 'B-T1', 0, 'transferred'],
        [20, 'B-T1', 5, 'active'],
        [10, 'B-T2', 0, 'transferred'],
        [20, 'B-T2', 5, 'active'],
      ],
    );
    await seedProduct(213, 20);
    await seedGenericBatch(213, 'B-P1', '2027-01-31', 10);
    await assert.rejects(
      db.transaction().execute(async (trx) => {
        await moveDirectTrackedStock(trx, SCOPE, 213, 5, { id: 10, branchId: null }, { id: 20, branchId: null }, 2);
      }),
      (err: any) => err && err.code === 'DIRECT_TRANSFER_BATCH_SELECTION_REQUIRED',
    );
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('van generic FEFO batch checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
