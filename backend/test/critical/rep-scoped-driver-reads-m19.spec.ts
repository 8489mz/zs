/*
New file: backend/test/critical/rep-scoped-driver-reads-m19.spec.ts
Pins INV-REP-SCOPED-DRIVER-READS (M19: D8 + D9 + D10), driving the REAL
VanRoutesService, VanPreSalesService, VanRequisitionsService,
VanFleetService, VanTransfersService (and the VanSalesService
pass-throughs that wire the driver controller's repId into them) on
PGlite.

WHAT THE AUDIT FEARED: optimizeCustomerRoute ignored repId, so any
driver could pull any customer's name/phone/address/GPS and rewrite
other reps' route sequences; the pre-sale catalog exposed cost_price
(plus wholesale/credit/consumer prices) for the whole catalog to any
driver; and the remaining driver reads were tenant-only — stock in
every warehouse, maintenance alerts for every vehicle, peer reps with
their phone numbers.

WHAT THIS PINS:
1. (D8) A driver optimizing a route sees only his own customers
   (assigned + served + ledger-active, the H7 definition): the shared
   route name is silently restricted to his scope, and an explicitly
   requested customer outside his scope is refused with a specific
   403 (REP_CUSTOMER_NOT_IN_SCOPE). persistSequence only ever writes
   the scoped rows, so another rep's route_sequence is untouched. The
   admin path (no repId) keeps its full breadth and can persist any
   customer's sequence.
2. (D9) The pre-sale catalog for a driver exposes the retail price
   only — costPrice/wholesalePrice/creditPrice/consumerPrice keys are
   absent entirely — and its stock resolves to a warehouse the driver
   loads from; an explicitly requested warehouse outside his scope is
   refused (REP_WAREHOUSE_NOT_USABLE 403). The staff read still
   returns the full price set.
3. (D10) Driver warehouse reads return only the warehouses the rep
   has loaded from (trip/requisition sources); driver product reads
   show stock only in those warehouses, and an explicit out-of-scope
   warehouse is refused. A rep with no load history yet falls back to
   the full list (bootstrap — no rep<->warehouse assignment exists to
   restrict him to, and his first load needs a source). The admin
   reads are unchanged, and the per-warehouse breakdown now lists only
   the requested warehouse when one is requested.
4. (D10) Fleet maintenance alerts for a driver cover only his own
   vehicles (assigned rep, or active driver on the vehicle); an
   explicitly requested vehicle that is not his is refused
   (REP_VEHICLE_NOT_ASSIGNED 403). The admin read still sees all.
5. (D10) Peer reps expose no phone numbers (phone is an empty
   string), while name + plate stay for the transfer picker.

DELIBERATELY NOT SCOPED (no rep dimension exists in the data, so
there is nothing to scope with — see the report):
- Promotions (fmcg_promotions): tenant-wide selling rules the driver
  must know to apply at the point of sale; the only scoping dimension
  is customerTypes, which evaluateCart already honors.
- Category filtering of the catalog by rep: no rep<->category
  assignment exists anywhere in the schema.

Deliberately NOT driven here: the controller wiring
(verifyDriverToken -> driver.repId -> service) is one-line call sites
verified by inspection; the HTTP layer is not booted in this harness.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanRoutesService } from '../../src/modules/delivery-reps/services/van-routes.service';
import { VanFleetService } from '../../src/modules/delivery-reps/services/van-fleet.service';
import { VanPreSalesService } from '../../src/modules/delivery-reps/services/van-pre-sales.service';
import { VanRequisitionsService } from '../../src/modules/delivery-reps/services/van-requisitions.service';
import { VanTransfersService } from '../../src/modules/delivery-reps/services/van-transfers.service';

const TENANT = 't-m19';
const ACCOUNT = 'a-m19';
const REP_OWN = 11;
const REP_OTHER = 22;
const REP_NEW = 33;
const WH_OWN = 1;
const WH_OTHER = 2;
const VAN_OWN = 10;
const VAN_OTHER = 20;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, van_location_id bigint, vehicle_plate text, is_van_rep boolean DEFAULT false, is_active boolean DEFAULT true);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, location_type text, is_active boolean DEFAULT true);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint, is_active boolean DEFAULT true);
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, account_id text, plate_number text, model_name text, current_odometer numeric DEFAULT 0, license_expires_at timestamptz, status text, assigned_rep_id bigint, van_location_id bigint);
      CREATE TABLE fleet_vehicle_drivers (id bigserial PRIMARY KEY, tenant_id text, account_id text, vehicle_id bigint, rep_id bigint, shift_name text, is_active boolean DEFAULT true);
      CREATE TABLE fleet_oil_changes (id bigserial PRIMARY KEY, tenant_id text, vehicle_id bigint, next_due_odometer numeric DEFAULT 0, alert_km_before numeric DEFAULT 500, oil_type text, with_filter boolean DEFAULT false, status text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE suppliers (id bigint PRIMARY KEY, name text);
      CREATE TABLE product_categories (id bigint PRIMARY KEY, name text);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, barcode text, metadata text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, category_id bigint, supplier_id bigint, is_active boolean DEFAULT true);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, location_id bigint, tenant_id text, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0);
      CREATE TABLE product_units (id bigserial PRIMARY KEY, product_id bigint, tenant_id text, name text, multiplier numeric DEFAULT 1, is_base_unit boolean DEFAULT false, is_sale_unit_default boolean DEFAULT false);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, batch_number text, expiry_date date, quantity numeric DEFAULT 0, location_id bigint);
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric DEFAULT 0, start_date date, end_date date, min_qty numeric, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_active boolean DEFAULT true, metadata text, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text, is_active boolean DEFAULT true);
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, customer_name text, customer_phone text, customer_address text, rep_id bigint, warehouse_location_id bigint, order_source text, payment_terms text, subtotal numeric DEFAULT 0, discount_amount numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, supervisor_approved_at timestamptz, supervisor_approved_by bigint, supervisor_rejection_reason text, notes text, delivery_date date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, van_location_id bigint, source_warehouse_id bigint, vehicle_id bigint, status text, settlement_status text, opened_at timestamptz, closed_at timestamptz, submitted_at timestamptz, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, variance numeric DEFAULT 0, distance_km numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, night_stock_approved boolean DEFAULT false, notes text, start_odometer numeric DEFAULT 0, end_odometer numeric DEFAULT 0);
      CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, rep_id bigint, source_warehouse_id bigint, status text, requested_items text, approved_items text, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, negative_reason text, postponed_to_date date, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz DEFAULT NOW(), created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, status text, payment_type text, customer_id bigint, delivery_rep_id bigint, van_trip_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric DEFAULT 0, note text, van_trip_id bigint, reference_id bigint, reference_type text, gps_lat numeric, gps_lng numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, doc_no text, total_amount numeric DEFAULT 0, return_reason text, refund_method text, status text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_damaged_swaps (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, damaged_product_id bigint, replacement_product_id bigint, damaged_qty numeric DEFAULT 0, damage_reason text, replacement_qty numeric DEFAULT 0, price_difference numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    `);

    const postingStub = {
      postSale: async () => undefined,
      clearPostingFailure: async () => undefined,
      postVanStockTransfer: async () => undefined,
    };
    const fleetService = new VanFleetService(db);
    const routesService = new VanRoutesService(db, fleetService);
    const preSalesService = new VanPreSalesService(db);
    const requisitionsService = new VanRequisitionsService(db);
    const transfersService = new VanTransfersService(db);
    const vanService = new VanSalesService(db, {} as never, {} as never, postingStub as never);

    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1 }).execute();

    await anyDb.insertInto('delivery_representatives').values([
      { id: REP_OWN, tenant_id: TENANT, account_id: ACCOUNT, name: 'Own Rep', phone: '01000000001', van_location_id: VAN_OWN, vehicle_plate: 'ABC-1', is_active: true },
      { id: REP_OTHER, tenant_id: TENANT, account_id: ACCOUNT, name: 'Other Rep', phone: '01000000002', van_location_id: VAN_OTHER, vehicle_plate: 'XYZ-2', is_active: true },
      { id: REP_NEW, tenant_id: TENANT, account_id: ACCOUNT, name: 'New Rep', phone: '01000000003', van_location_id: null, vehicle_plate: null, is_active: true },
    ]).execute();
    await anyDb.insertInto('stock_locations').values([
      { id: WH_OWN, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main Warehouse', code: 'WH-1', location_type: 'internal_warehouse', is_active: true },
      { id: WH_OTHER, tenant_id: TENANT, account_id: ACCOUNT, name: 'Branch Warehouse', code: 'WH-2', location_type: 'branch_stock', is_active: true },
      { id: VAN_OWN, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van Own', code: 'VAN_11', location_type: 'van_stock', is_active: true },
      { id: VAN_OTHER, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van Other', code: 'VAN_22', location_type: 'van_stock', is_active: true },
    ]).execute();
    await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, default_stock_location_id: WH_OWN, is_active: true }).execute();

    // Products: P1 in both warehouses (100 own-source / 500 other),
    // P2 only in the own-source warehouse.
    await anyDb.insertInto('products').values([
      { id: 101, tenant_id: TENANT, name: 'Product One', barcode: 'P101', stock_qty: 600, reserved_qty: 0, cost_price: 40, retail_price: 100, wholesale_price: 70, credit_price: 90, consumer_price: 110, is_active: true, metadata: null },
      { id: 102, tenant_id: TENANT, name: 'Product Two', barcode: 'P102', stock_qty: 5, reserved_qty: 0, cost_price: 10, retail_price: 50, wholesale_price: 30, credit_price: 45, consumer_price: 55, is_active: true, metadata: null },
    ]).execute();
    await anyDb.insertInto('product_location_stock').values([
      { product_id: 101, location_id: WH_OWN, tenant_id: TENANT, qty: 100, reserved_qty: 0 },
      { product_id: 101, location_id: WH_OTHER, tenant_id: TENANT, qty: 500, reserved_qty: 0 },
      { product_id: 102, location_id: WH_OWN, tenant_id: TENANT, qty: 5, reserved_qty: 0 },
    ]).execute();

    // Customers on shared route R1: 100 assigned to OWN, 200 assigned
    // to OTHER, 300 unassigned, 400 served by OWN via a field visit.
    const meta = (o: any) => JSON.stringify(o);
    await anyDb.insertInto('customers').values([
      { id: 100, tenant_id: TENANT, name: 'Assigned Own', phone: '011100', address: 'Addr 100', balance: 50, credit_limit: 100, is_active: true, metadata: meta({ assigned_rep_ids: [REP_OWN], route: 'R1', route_sequence: 5, location_url: 'https://maps.google.com/?q=30.04,31.23' }) },
      { id: 200, tenant_id: TENANT, name: 'Other Rep Customer', phone: '011200', address: 'Addr 200', balance: 70, credit_limit: 200, is_active: true, metadata: meta({ assigned_rep_ids: [REP_OTHER], route: 'R1', route_sequence: 9, location_url: 'https://maps.google.com/?q=30.05,31.24' }) },
      { id: 300, tenant_id: TENANT, name: 'Unassigned Stranger', phone: '011300', address: 'Addr 300', balance: 999, credit_limit: 500, is_active: true, metadata: meta({ route: 'R1', route_sequence: 7, location_url: 'https://maps.google.com/?q=30.06,31.25' }) },
      { id: 400, tenant_id: TENANT, name: 'Visited By Own', phone: '011400', address: 'Addr 400', balance: 10, credit_limit: 0, is_active: true, metadata: meta({ route: 'R1', route_sequence: 3, location_url: 'https://maps.google.com/?q=30.07,31.26' }) },
    ]).execute();

    // Trips: OWN loaded from WH_OWN, OTHER from WH_OTHER. Requisition:
    // OWN also requisitioned from WH_OWN (both evidence legs).
    await anyDb.insertInto('van_sales_trips').values([
      { id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OWN, van_location_id: VAN_OWN, source_warehouse_id: WH_OWN, status: 'open', settlement_status: 'open' },
      { id: 2, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OTHER, van_location_id: VAN_OTHER, source_warehouse_id: WH_OTHER, status: 'open', settlement_status: 'open' },
    ]).execute();
    await anyDb.insertInto('van_load_requisitions').values(
      { id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'REQ-260101-0001', rep_id: REP_OWN, source_warehouse_id: WH_OWN, status: 'approved', requested_items: '[]', approved_items: '[]' },
    ).execute();
    await anyDb.insertInto('van_field_visits').values(
      { tenant_id: TENANT, account_id: ACCOUNT, trip_id: 1, rep_id: REP_OWN, customer_id: 400, visit_type: 'positive' },
    ).execute();

    // Fleet: V1 assigned to OWN (licence long expired + oil overdue),
    // V2 assigned to OTHER (licence long expired too).
    await anyDb.insertInto('fleet_vehicles').values([
      { id: 1, tenant_id: TENANT, account_id: ACCOUNT, plate_number: 'ABC-1', model_name: 'Van A', current_odometer: 5000, license_expires_at: '2020-01-01', status: 'assigned', assigned_rep_id: REP_OWN, van_location_id: VAN_OWN },
      { id: 2, tenant_id: TENANT, account_id: ACCOUNT, plate_number: 'XYZ-2', model_name: 'Van B', current_odometer: 5000, license_expires_at: '2020-01-01', status: 'assigned', assigned_rep_id: REP_OTHER, van_location_id: VAN_OTHER },
    ]).execute();
    await anyDb.insertInto('fleet_oil_changes').values([
      { tenant_id: TENANT, vehicle_id: 1, next_due_odometer: 1000, alert_km_before: 500, oil_type: '5W-30', with_filter: false, status: 'active' },
      { tenant_id: TENANT, vehicle_id: 2, next_due_odometer: 1000, alert_km_before: 500, oil_type: '5W-30', with_filter: false, status: 'active' },
    ]).execute();

    const isCode = (code: string, status: number) => (err: any) =>
      err && err.code === code && err.statusCode === status;

    const readSequence = async (customerId: number): Promise<number> => {
      const row = await anyDb
        .selectFrom('customers')
        .select('metadata')
        .where('id', '=', customerId)
        .where('tenant_id', '=', TENANT)
        .executeTakeFirst();
      const m = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata || {});
      return Number(m.route_sequence || 0);
    };

    // 1. (D8) Driver route optimization on the shared route name
    // returns only OWN's customers (assigned 100 + served 400) and
    // persists sequences only for them.
    const driverRoute = await routesService.optimizeCustomerRoute(TENANT, {
      route: 'R1',
      repId: REP_OWN,
      persistSequence: true,
    });
    const driverIds = driverRoute.orderedStops.map((s: any) => Number(s.id)).sort((a: number, b: number) => a - b);
    assert.deepEqual(driverIds, [100, 400]);
    assert.ok(!driverIds.includes(200), 'another rep customer must not leak into the route');
    assert.ok(!driverIds.includes(300), 'unassigned customer must not leak into the route');
    assert.equal(await readSequence(200), 9, 'another rep route_sequence must be untouched by the driver persist');
    assert.equal(await readSequence(300), 7, 'unassigned route_sequence must be untouched by the driver persist');

    // 2. (D8) An explicitly requested customer outside the rep's scope
    // is refused with a specific error naming the problem.
    await assert.rejects(
      routesService.optimizeCustomerRoute(TENANT, { customerIds: [100, 200], repId: REP_OWN }),
      isCode('REP_CUSTOMER_NOT_IN_SCOPE', 403),
    );
    await assert.rejects(
      routesService.optimizeCustomerRoute(TENANT, { customerIds: [100, 200], repId: REP_OWN }),
      (err: any) => err && String(err.message || '').includes('غير مسند'),
    );

    // 3. (D8) Admin path (no repId) keeps its full breadth and can
    // persist any customer's sequence.
    const adminRoute = await routesService.optimizeCustomerRoute(TENANT, { route: 'R1' });
    const adminIds = adminRoute.orderedStops.map((s: any) => Number(s.id)).sort((a: number, b: number) => a - b);
    assert.deepEqual(adminIds, [100, 200, 300, 400]);
    await routesService.optimizeCustomerRoute(TENANT, { customerIds: [200], persistSequence: true });
    assert.notEqual(await readSequence(200), 9, 'admin persist must still be able to write the sequence');

    // 4. (D9) Driver catalog: retail price only, no cost/wholesale/
    // credit/consumer price keys at all; stock resolves to the
    // warehouse the driver loads from (WH_OWN).
    const driverCatalog = await preSalesService.listWarehouseCatalog(TENANT, undefined, {}, REP_OWN);
    assert.equal(driverCatalog.items.length, 2);
    assert.equal(driverCatalog.targetWarehouseId, WH_OWN);
    for (const item of driverCatalog.items) {
      assert.ok(!('costPrice' in item), 'costPrice must not reach a driver');
      assert.ok(!('wholesalePrice' in item), 'wholesalePrice must not reach a driver');
      assert.ok(!('creditPrice' in item), 'creditPrice must not reach a driver');
      assert.ok(!('consumerPrice' in item), 'consumerPrice must not reach a driver');
      assert.ok(Number((item as any).retailPrice) > 0, 'retail price must still be present');
    }
    const p1Driver = driverCatalog.items.find((i: any) => Number(i.id) === 101);
    assert.equal(
      Number(p1Driver?.stockQty), 100, 'driver catalog stock must be his own warehouse stock');
    // An explicitly requested warehouse outside his scope is refused.
    await assert.rejects(
      preSalesService.listWarehouseCatalog(TENANT, WH_OTHER, {}, REP_OWN),
      isCode('REP_WAREHOUSE_NOT_USABLE', 403),
    );
    // Staff read still returns the full price set.
    const staffCatalog = await preSalesService.listWarehouseCatalog(TENANT);
    const p1Staff = staffCatalog.items.find((i: any) => Number(i.id) === 101);
    assert.equal(Number(p1Staff?.costPrice), 40);
    assert.equal(Number(p1Staff?.wholesalePrice), 70);
    assert.equal(Number(p1Staff?.creditPrice), 90);
    assert.equal(Number(p1Staff?.consumerPrice), 110);

    // 5. (D10) Driver warehouses: only the warehouse the rep loaded
    // from. A rep with no load history yet (bootstrap) sees the full
    // list; the staff read is unchanged.
    const ownWh = await requisitionsService.getDriverWarehouses(TENANT, REP_OWN);
    assert.deepEqual(ownWh.map((w: any) => Number(w.id)), [WH_OWN]);
    const newWh = await requisitionsService.getDriverWarehouses(TENANT, REP_NEW);
    assert.deepEqual(newWh.map((w: any) => Number(w.id)).sort((a: number, b: number) => a - b), [WH_OWN, WH_OTHER]);
    const staffWh = await requisitionsService.getDriverWarehouses(TENANT);
    assert.deepEqual(staffWh.map((w: any) => Number(w.id)).sort((a: number, b: number) => a - b), [WH_OWN, WH_OTHER]);
    // Same scoping through the VanSalesService pass-through the driver
    // controller calls.
    const ownWhViaService = await vanService.getDriverWarehouses(TENANT, REP_OWN);
    assert.deepEqual(ownWhViaService.map((w: any) => Number(w.id)), [WH_OWN]);

    // 6. (D10) Driver products: stock only in his own warehouses, with
    // a per-warehouse breakdown limited to those warehouses. An
    // explicit out-of-scope warehouse is refused. Staff reads keep the
    // full picture, and the breakdown now lists only the requested
    // warehouse when one is requested.
    const ownProducts = await requisitionsService.getDriverAvailableProducts(TENANT, undefined, REP_OWN);
    const p1Own = ownProducts.find((p: any) => Number(p.id) === 101);
    assert.equal(Number(p1Own?.totalStock), 100, 'driver total must be his own warehouse stock only');
    assert.deepEqual(
      (p1Own?.warehouseStocks || []).map((w: any) => Number(w.warehouseId)),
      [WH_OWN],
      'driver breakdown must not name the other warehouse',
    );
    const p2Own = ownProducts.find((p: any) => Number(p.id) === 102);
    assert.equal(Number(p2Own?.totalStock), 5);
    await assert.rejects(
      requisitionsService.getDriverAvailableProducts(TENANT, WH_OTHER, REP_OWN),
      isCode('REP_WAREHOUSE_NOT_USABLE', 403),
    );
    const staffProducts = await requisitionsService.getDriverAvailableProducts(TENANT);
    const p1StaffProd = staffProducts.find((p: any) => Number(p.id) === 101);
    assert.equal(Number(p1StaffProd?.totalStock), 600, 'staff total must still sum all warehouses');
    assert.deepEqual(
      (p1StaffProd?.warehouseStocks || []).map((w: any) => Number(w.warehouseId)).sort((a: number, b: number) => a - b),
      [WH_OWN, WH_OTHER],
    );
    const staffWh2 = await requisitionsService.getDriverAvailableProducts(TENANT, WH_OTHER);
    const p1Wh2 = staffWh2.find((p: any) => Number(p.id) === 101);
    assert.equal(Number(p1Wh2?.totalStock), 500);
    assert.deepEqual(
      (p1Wh2?.warehouseStocks || []).map((w: any) => Number(w.warehouseId)),
      [WH_OTHER],
      'single-warehouse request must not leak the other warehouse breakdown',
    );
    const ownProductsViaService = await vanService.getDriverAvailableProducts(TENANT, undefined, REP_OWN);
    const p1ViaService = ownProductsViaService.find((p: any) => Number(p.id) === 101);
    assert.equal(Number(p1ViaService?.totalStock), 100);

    // 7. (D10) Fleet alerts: a driver sees only his own vehicles'
    // alerts; an explicitly requested vehicle that is not his is
    // refused; the staff read still sees all vehicles.
    const ownAlerts = await fleetService.getFleetMaintenanceAlerts(TENANT, undefined, REP_OWN);
    assert.ok((ownAlerts.alerts || []).length > 0, 'own vehicle must produce alerts');
    assert.ok(
      (ownAlerts.alerts || []).every((a: any) => Number(a.vehicleId) === 1),
      'no other rep vehicle alert must leak to the driver',
    );
    assert.ok(
      (ownAlerts.alerts || []).every((a: any) => String(a.plateNumber) === 'ABC-1'),
      'no other rep plate must leak to the driver',
    );
    await assert.rejects(
      fleetService.getFleetMaintenanceAlerts(TENANT, 2, REP_OWN),
      isCode('REP_VEHICLE_NOT_ASSIGNED', 403),
    );
    const staffAlerts = await fleetService.getFleetMaintenanceAlerts(TENANT);
    const staffVehicleIds = [...new Set((staffAlerts.alerts || []).map((a: any) => Number(a.vehicleId)))].sort((a: number, b: number) => a - b);
    assert.deepEqual(staffVehicleIds, [1, 2]);
    const ownAlertsViaService = await vanService.getFleetMaintenanceAlerts(TENANT, undefined, REP_OWN);
    assert.ok((ownAlertsViaService.alerts || []).every((a: any) => Number(a.vehicleId) === 1));

    // 8. (D10) Peer reps expose no phone numbers, while name + plate
    // stay for the transfer picker.
    const peers = await transfersService.getPeerReps(TENANT, REP_OWN);
    assert.deepEqual(peers.map((r: any) => Number(r.id)).sort((a: number, b: number) => a - b), [REP_OTHER, REP_NEW]);
    for (const peer of peers) {
      assert.equal(peer.phone, '', 'peer phone must be hidden');
    }
    assert.ok(!JSON.stringify(peers).includes('01000000002'), 'no peer phone number may leak');
    const otherPeer = peers.find((r: any) => Number(r.id) === REP_OTHER);
    assert.equal(otherPeer?.name, 'Other Rep');
    assert.equal(otherPeer?.vehiclePlate, 'XYZ-2');
    const peersViaService = await vanService.getPeerReps(TENANT, REP_OWN);
    assert.ok(peersViaService.every((r: any) => r.phone === ''));

    console.log('rep scoped driver reads M19 checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
