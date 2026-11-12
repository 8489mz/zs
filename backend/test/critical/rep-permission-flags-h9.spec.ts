/*
New file: backend/test/critical/rep-permission-flags-h9.spec.ts
Pins H9 (D3 + D4 + B10), driving the REAL VanSalesService,
VanFieldExecutionService and VanRoutesService on PGlite.

WHAT THE AUDIT FEARED: the cash discount in executeFieldSaleInternal
applied with no supervisor PIN and no check of can_give_discount /
max_discount_percent — a second, ungated discount channel for the
same sale, while the item-price guard directly above it demands a
verified supervisor PIN. And the six rep permission flags
(can_edit_routes, can_add_customers, require_gps_on_visit,
can_give_discount, max_discount_percent, can_sell_over_credit_limit,
can_collect_cash) were stored and editable but never enforced anywhere:
a rep could create customers, collect cash, sell over a credit limit
with only a PIN, visit with no GPS, and persist route sequences
regardless of what the supervisor configured.

WHAT THIS PINS (one case per flag, allow + refuse, plus the PIN
interaction cases):
1. Cash discount: flag false refuses ANY cash discount, even with a
   supervisor PIN; within max_discount_percent it applies; above the
   limit without a PIN it is refused; above the limit WITH a verified
   supervisor PIN it applies; max 0 means any discount needs a PIN.
2. Cash collection: can_collect_cash false refuses a cash collection
   and leaves the customer balance untouched; a non-cash (instapay)
   collection by the same rep is unaffected.
3. Customer creation: can_add_customers false refuses
   createDriverCustomer; true allows it.
4. Credit limit: over the limit WITH a supervisor PIN but
   can_sell_over_credit_limit false is refused; with the flag true the
   existing PIN flow allows it; within the limit no PIN is needed and
   the flag does not block.
5. Visits: require_gps_on_visit true refuses checkInVisit and
   recordFieldVisit with missing GPS; false allows both.
6. Routes: can_edit_routes false refuses a driver persistSequence
   optimize and leaves every route_sequence untouched; true persists;
   a read-only optimize (no persist) is never gated.

CHECKED, NOT GATED (same root cause, already closed): the other
discount entry points on the field-sale path are supervisor-gated,
not rep-controlled — a client unit price below the system price needs
a verified supervisor PIN (price-integrity guard), a bonus line needs
an active BOGO offer or a PIN, and offer prices come from the shared
system offer selector. Only the cash discount was ungated, so only it
is gated here; the supervisor PIN stays the per-sale override for the
already-gated channels.

HARNESS: the real VanSalesService with a no-op posting stub (postSale
/ clearPostingFailure / postVanFieldCollection) and a no-op fraud
radar, exactly as the H7 spec stubs them — the spec pins the gates'
throws, not the journal or the audit write. resolveSystemAuthContext
is shadowed the way the book-digits spec does it, because on PGlite's
single-connection dialect a pool read inside the sale/collection
transaction would deadlock. The supervisor PIN is the shared manager
PIN from settings (bcrypt via hashManagerPin, '4321'), verified by
the production verifySupervisorPin — never a plaintext compare.

LEGACY NOTE: reps in this spec carry explicit permissions objects.
A rep row with no stored permissions object parses to the legacy
pre-flag behaviour in parseRepPermissions (everything allowed, as
before the flags existed) — so older specs whose fixtures have no
permissions column, or a NULL permissions value, keep passing
unchanged (e.g. the book-digits spec's 3dp cash-discount case).
Money-strictness applies to every CONFIGURED rep; an unconfigured
rep is configured the moment a supervisor saves its flags.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanFieldExecutionService } from '../../src/modules/delivery-reps/services/van-field-execution.service';
import { VanRoutesService } from '../../src/modules/delivery-reps/services/van-routes.service';
import { VanFleetService } from '../../src/modules/delivery-reps/services/van-fleet.service';
import { hashManagerPin } from '../../src/common/utils/manager-approval';

const TENANT = 't-rep-flags-h9';
const ACCOUNT = 'a-rep-flags-h9';
const PIN = '4321';

const REP_NODISC = 11;
const REP_DISC10 = 12;
const REP_DISC0 = 13;
const REP_NOCASH = 14;
const REP_NOCUST = 15;
const REP_NOGPS = 16;
const REP_ROUTES = 17;
const REP_NOROUTES = 18;
const REP_OVERLIMIT = 19;
const REP_NOOVERLIMIT = 20;

const CUST_CREDIT = 100;
const CUST_DEBT14 = 200;
const CUST_DEBT11 = 201;
const CUST_VISIT11 = 300;
const CUST_VISIT16 = 301;
const CUST_ROUTE_A = 400;
const CUST_ROUTE_B = 401;

function flags(over: Record<string, unknown>): string {
  return JSON.stringify({
    can_edit_routes: false,
    can_add_customers: true,
    require_gps_on_visit: true,
    can_give_discount: false,
    max_discount_percent: 0,
    can_sell_over_credit_limit: false,
    can_collect_cash: true,
    ...over,
  });
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, permissions text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, is_active boolean DEFAULT true, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, account_id text, username text, display_name text, phone text, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, negative_reason text, postponed_to_date date, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_store_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, customer_name text, check_in_at timestamptz, check_in_lat numeric, check_in_lng numeric, is_geofence_valid boolean, geofence_distance_meters numeric, store_inventory text, no_sale_reason text, no_sale_notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, doc_no text, total_amount numeric DEFAULT 0, return_reason text, refund_method text, status text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, gps_lat numeric, gps_lng numeric);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, customer_id bigint, amount numeric, note text, transfer_reference text, transfer_receipt_url text, tenant_id text, account_id text, van_trip_id bigint, rep_id bigint, payment_channel text, client_tx_id text, created_at timestamptz DEFAULT NOW());
    `);

    const postingStub = {
      postSale: async () => undefined,
      clearPostingFailure: async () => undefined,
      postVanFieldCollection: async () => undefined,
      postVanStockTransfer: async () => undefined,
    };
    const fraudStub = { recordSuspicionEvent: async () => undefined };
    const service = new VanSalesService(db, {} as never, {} as never, postingStub as never,
      undefined, undefined, undefined, undefined, undefined, undefined, fraudStub as never);
    (service as any).resolveSystemAuthContext = async () => ({
      userId: 1, sessionId: 'spec', username: 'spec', role: 'admin',
      permissions: ['accounting'], tenantId: TENANT, accountId: ACCOUNT,
    });
    const fieldExecution = new VanFieldExecutionService(db, fraudStub as never);
    const routesService = new VanRoutesService(db, new VanFleetService(db), fraudStub as never);

    await anyDb.insertInto('settings').values([
      { tenant_id: TENANT, key: 'currency', value: 'EGP' },
      { tenant_id: TENANT, key: 'managerPin', value: JSON.stringify(await hashManagerPin(PIN)) },
    ]).execute();
    await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
    await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, username: 'sys', display_name: 'Sys', phone: '01000000000', role: 'admin', password_hash: '', password_salt: '', is_active: true }).execute();
    await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true }).execute();

    const repRows: Array<[number, string, Record<string, unknown>]> = [
      [REP_NODISC, '01000000011', {}],
      [REP_DISC10, '01000000012', { can_give_discount: true, max_discount_percent: 10 }],
      [REP_DISC0, '01000000013', { can_give_discount: true, max_discount_percent: 0 }],
      [REP_NOCASH, '01000000014', { can_collect_cash: false }],
      [REP_NOCUST, '01000000015', { can_add_customers: false }],
      [REP_NOGPS, '01000000016', { require_gps_on_visit: false }],
      [REP_ROUTES, '01000000017', { can_edit_routes: true }],
      [REP_NOROUTES, '01000000018', { can_edit_routes: false }],
      [REP_OVERLIMIT, '01000000019', { can_sell_over_credit_limit: true }],
      [REP_NOOVERLIMIT, '01000000020', { can_sell_over_credit_limit: false }],
    ];
    for (const [id, phone, over] of repRows) {
      await anyDb.insertInto('delivery_representatives').values({
        id, tenant_id: TENANT, account_id: ACCOUNT, name: `Rep ${id}`, phone,
        permissions: flags(over), van_location_id: 20, is_van_rep: true, is_active: true,
      }).execute();
    }
    // REP_LEGACY (21): no permissions object at all — the legacy case.
    await anyDb.insertInto('delivery_representatives').values({
      id: 21, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 21', phone: '01000000021',
      permissions: null, van_location_id: 20, is_van_rep: true, is_active: true,
    }).execute();

    // One open trip per sale/collection/visit case (distinct trips dodge
    // the sale + collection dedup backstops, which key on trip + rep).
    const trips: Array<[number, number]> = [
      [1, REP_NODISC], [2, REP_DISC10], [3, REP_DISC10], [4, REP_DISC10],
      [5, REP_NODISC], [6, REP_DISC0], [7, REP_OVERLIMIT], [8, REP_NOOVERLIMIT],
      [9, REP_OVERLIMIT], [10, REP_NOCASH], [11, REP_NOCASH], [12, REP_NODISC],
      [13, REP_NODISC], [14, REP_NOGPS], [15, 21],
    ];
    for (const [id, repId] of trips) {
      await anyDb.insertInto('van_sales_trips').values({
        id, tenant_id: TENANT, account_id: ACCOUNT, rep_id: repId, van_location_id: 20, status: 'open', settlement_status: 'open',
      }).execute();
    }

    for (const [id, retail, cost] of [[101, 100, 40], [102, 150, 60], [103, 50, 20]] as const) {
      await anyDb.insertInto('products').values({
        id, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${id}`,
        stock_qty: 100, cost_price: cost, retail_price: retail, credit_price: 0, is_active: true,
      }).execute();
      await anyDb.insertInto('product_location_stock').values({
        tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: 100,
      }).execute();
    }

    await anyDb.insertInto('customers').values([
      { id: CUST_CREDIT, tenant_id: TENANT, account_id: ACCOUNT, name: 'Credit Customer', phone: '011100', balance: 0, credit_limit: 100, customer_type: 'credit', is_active: true, metadata: JSON.stringify({ assigned_rep_ids: [REP_OVERLIMIT, REP_NOOVERLIMIT] }) },
      { id: CUST_DEBT14, tenant_id: TENANT, account_id: ACCOUNT, name: 'Debt Customer 14', phone: '011200', balance: 100, credit_limit: 0, customer_type: 'cash', is_active: true, metadata: JSON.stringify({ assigned_rep_ids: [REP_NOCASH] }) },
      { id: CUST_DEBT11, tenant_id: TENANT, account_id: ACCOUNT, name: 'Debt Customer 11', phone: '011201', balance: 100, credit_limit: 0, customer_type: 'cash', is_active: true, metadata: JSON.stringify({ assigned_rep_ids: [REP_NODISC] }) },
      { id: CUST_VISIT11, tenant_id: TENANT, account_id: ACCOUNT, name: 'Visit Customer 11', phone: '011300', balance: 0, credit_limit: 0, customer_type: 'cash', is_active: true, metadata: JSON.stringify({ assigned_rep_ids: [REP_NODISC] }) },
      { id: CUST_VISIT16, tenant_id: TENANT, account_id: ACCOUNT, name: 'Visit Customer 16', phone: '011301', balance: 0, credit_limit: 0, customer_type: 'cash', is_active: true, metadata: JSON.stringify({ assigned_rep_ids: [REP_NOGPS] }) },
      { id: CUST_ROUTE_A, tenant_id: TENANT, account_id: ACCOUNT, name: 'Route A', phone: '011400', balance: 0, credit_limit: 0, customer_type: 'cash', is_active: true, metadata: JSON.stringify({ route: 'R1', route_sequence: 0 }) },
      { id: CUST_ROUTE_B, tenant_id: TENANT, account_id: ACCOUNT, name: 'Route B', phone: '011401', balance: 0, credit_limit: 0, customer_type: 'cash', is_active: true, metadata: JSON.stringify({ route: 'R1', route_sequence: 0 }) },
    ]).execute();

    const isCode = (code: string, status: number) => (err: any) =>
      err && err.code === code && err.statusCode === status;
    const customerBalance = async (id: number): Promise<number> => {
      const row = await anyDb.selectFrom('customers').select(['balance']).where('id', '=', id).where('tenant_id', '=', TENANT).executeTakeFirst();
      return Number(row?.balance || 0);
    };
    const salesCount = async (): Promise<number> => {
      const rows = await anyDb.selectFrom('sales').select(['id']).where('tenant_id', '=', TENANT).execute();
      return rows.length;
    };
    const routeSequence = async (id: number): Promise<number> => {
      const row = await anyDb.selectFrom('customers').select(['metadata']).where('id', '=', id).where('tenant_id', '=', TENANT).executeTakeFirst();
      let meta: any = {};
      try { meta = JSON.parse(String(row?.metadata || '{}')); } catch { meta = {}; }
      return Number(meta.route_sequence || 0);
    };
    // actingRepId is built through `any` so this spec also COMPILES
    // against the un-fixed service: in the removal proof the route
    // calls must run and fail as assertions (persist succeeds when it
    // should refuse), not as a TS2353 excess-property error.
    const routeCall = (actingRepId: number, persistSequence?: boolean): any => ({
      customerIds: [CUST_ROUTE_A, CUST_ROUTE_B],
      actingRepId,
      ...(persistSequence ? { persistSequence: true } : {}),
    });

    // 1. (D3) can_give_discount false: ANY cash discount is refused,
    // even with a supervisor PIN — the flag is the control, the PIN
    // alone is not enough. No sale row is written.
    const salesBefore = await salesCount();
    await assert.rejects(
      service.executeFieldSale(REP_NODISC, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash', cashDiscountAmount: 10,
        items: [{ productId: 101, qty: 1 }],
      }),
      isCode('REP_DISCOUNT_NOT_ALLOWED', 403),
    );
    await assert.rejects(
      service.executeFieldSale(REP_NODISC, TENANT, ACCOUNT, {
        tripId: 5, paymentMethod: 'cash', cashDiscountAmount: 10, supervisorOverridePin: PIN,
        items: [{ productId: 101, qty: 1 }],
      }),
      isCode('REP_DISCOUNT_NOT_ALLOWED', 403),
    );
    assert.equal(await salesCount(), salesBefore, 'refused discounts must not write a sale');

    // 2. (D3) Within the limit the discount applies: 10% off a 100
    // sale with max 10 stores total 90, discount 10.
    const within = await service.executeFieldSale(REP_DISC10, TENANT, ACCOUNT, {
      tripId: 2, paymentMethod: 'cash', cashDiscountAmount: 10,
      items: [{ productId: 101, qty: 1 }],
    });
    assert.equal(within.total, 90);
    assert.equal(within.discount, 10);

    // 3. (D3) Above the limit without a PIN it is refused.
    await assert.rejects(
      service.executeFieldSale(REP_DISC10, TENANT, ACCOUNT, {
        tripId: 3, paymentMethod: 'cash', cashDiscountAmount: 20,
        items: [{ productId: 101, qty: 1 }],
      }),
      isCode('CASH_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN', 403),
    );

    // 4. (D3) Above the limit WITH a verified supervisor PIN it applies.
    const overPin = await service.executeFieldSale(REP_DISC10, TENANT, ACCOUNT, {
      tripId: 4, paymentMethod: 'cash', cashDiscountAmount: 20, supervisorOverridePin: PIN,
      items: [{ productId: 101, qty: 1 }],
    });
    assert.equal(overPin.total, 80);
    assert.equal(overPin.discount, 20);

    // 5. (D3) max 0 means any discount needs a PIN.
    await assert.rejects(
      service.executeFieldSale(REP_DISC0, TENANT, ACCOUNT, {
        tripId: 6, paymentMethod: 'cash', cashDiscountAmount: 5,
        items: [{ productId: 101, qty: 1 }],
      }),
      isCode('CASH_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN', 403),
    );

    // 6. (D4) Credit limit, in-limit first: 50 against a 100 limit
    // needs no PIN and the flag does not block it.
    const inLimit = await service.executeFieldSale(REP_OVERLIMIT, TENANT, ACCOUNT, {
      tripId: 9, paymentMethod: 'credit', customerId: CUST_CREDIT,
      items: [{ productId: 103, qty: 1 }],
    });
    assert.equal(inLimit.total, 50);
    assert.equal(await customerBalance(CUST_CREDIT), 50);

    // 7. (D4) Over the limit WITH a PIN and the flag true: allowed,
    // and recorded as a supervisor override.
    const overLimit = await service.executeFieldSale(REP_OVERLIMIT, TENANT, ACCOUNT, {
      tripId: 7, paymentMethod: 'credit', customerId: CUST_CREDIT, supervisorOverridePin: PIN,
      items: [{ productId: 102, qty: 1 }],
    });
    assert.equal(overLimit.total, 150);
    assert.equal(await customerBalance(CUST_CREDIT), 200);
    const overSale = await anyDb.selectFrom('sales').select(['is_credit_overridden']).where('id', '=', overLimit.saleId).executeTakeFirst();
    assert.equal(Boolean((overSale as any)?.is_credit_overridden), true);

    // 8. (D4) Over the limit WITH a PIN but the flag false: refused —
    // the PIN alone is not enough. Balance stays 200.
    await assert.rejects(
      service.executeFieldSale(REP_NOOVERLIMIT, TENANT, ACCOUNT, {
        tripId: 8, paymentMethod: 'credit', customerId: CUST_CREDIT, supervisorOverridePin: PIN,
        items: [{ productId: 102, qty: 1 }],
      }),
      isCode('REP_CANNOT_SELL_OVER_CREDIT_LIMIT', 403),
    );
    assert.equal(await customerBalance(CUST_CREDIT), 200);

    // 9. (D4 + B10) can_collect_cash false: a cash collection is
    // refused and the customer balance is untouched.
    await assert.rejects(
      service.recordFieldCollection(REP_NOCASH, TENANT, ACCOUNT, {
        tripId: 10, customerId: CUST_DEBT14, amount: 40, paymentMethod: 'cash',
      }),
      isCode('REP_CANNOT_COLLECT_CASH', 403),
    );
    assert.equal(await customerBalance(CUST_DEBT14), 100);

    // 10. (D4 + B10) The same rep's NON-cash collection is unaffected
    // (supervisor PIN + real transfer reference, the existing
    // non-cash evidence gate).
    const instapay = await service.recordFieldCollection(REP_NOCASH, TENANT, ACCOUNT, {
      tripId: 11, customerId: CUST_DEBT14, amount: 40, paymentMethod: 'instapay',
      transferReference: 'REF123', supervisorOverridePin: PIN,
    });
    assert.equal(instapay.ok, true);
    assert.equal(instapay.amount, 40);
    assert.equal(await customerBalance(CUST_DEBT14), 60);

    // 11. (D4 + B10) can_collect_cash true: a cash collection works.
    const cash = await service.recordFieldCollection(REP_NODISC, TENANT, ACCOUNT, {
      tripId: 12, customerId: CUST_DEBT11, amount: 40, paymentMethod: 'cash',
    });
    assert.equal(cash.ok, true);
    assert.equal(await customerBalance(CUST_DEBT11), 60);

    // 12. (D4) can_add_customers false refuses field customer creation.
    await assert.rejects(
      service.createDriverCustomer(REP_NOCUST, TENANT, ACCOUNT, { name: 'Blocked Shop H9', phone: '011900' }),
      isCode('REP_CANNOT_ADD_CUSTOMERS', 403),
    );
    const blocked = await anyDb.selectFrom('customers').select(['id']).where('name', '=', 'Blocked Shop H9').where('tenant_id', '=', TENANT).execute();
    assert.equal(blocked.length, 0, 'refused customer creation must not write a row');

    // 13. (D4) can_add_customers true allows it.
    const created = await service.createDriverCustomer(REP_NODISC, TENANT, ACCOUNT, { name: 'Allowed Shop H9', phone: '011901' });
    assert.equal((created as any)?.ok, true);
    const allowed = await anyDb.selectFrom('customers').select(['id', 'name']).where('name', '=', 'Allowed Shop H9').where('tenant_id', '=', TENANT).executeTakeFirst();
    assert.ok(allowed, 'allowed customer creation must write a row');

    // 14. (D4) require_gps_on_visit true: check-in without GPS refused.
    await assert.rejects(
      fieldExecution.checkInVisit(TENANT, 1, REP_NODISC, { customerId: CUST_VISIT11 }),
      isCode('REP_VISIT_GPS_REQUIRED', 403),
    );
    // ... and with GPS it is allowed (the customer carries no GPS, so
    // the visit is unmapped — the gate is about the rep's fix, not
    // the customer's).
    const checkIn = await fieldExecution.checkInVisit(TENANT, 1, REP_NODISC, {
      customerId: CUST_VISIT11, latitude: 30.05, longitude: 31.25,
    });
    assert.equal(checkIn.ok, true);

    // 15. (D4) require_gps_on_visit false: check-in without GPS allowed.
    const checkInNoGps = await fieldExecution.checkInVisit(TENANT, 1, REP_NOGPS, { customerId: CUST_VISIT16 });
    assert.equal(checkInNoGps.ok, true);

    // 16. (D4) require_gps_on_visit true: a field visit without GPS
    // is refused; false: it is allowed.
    await assert.rejects(
      service.recordFieldVisit(TENANT, ACCOUNT, REP_NODISC, {
        tripId: 13, customerId: CUST_VISIT11, visitType: 'negative', negativeReason: 'shop_closed',
      }),
      isCode('REP_VISIT_GPS_REQUIRED', 403),
    );
    const fieldVisit = await service.recordFieldVisit(TENANT, ACCOUNT, REP_NOGPS, {
      tripId: 14, customerId: CUST_VISIT16, visitType: 'negative', negativeReason: 'shop_closed',
    });
    assert.equal(fieldVisit.ok, true);

    // 17. (D4) can_edit_routes false: a driver persist is refused and
    // no route_sequence is written.
    await assert.rejects(
      routesService.optimizeCustomerRoute(TENANT, routeCall(REP_NOROUTES, true)),
      isCode('REP_CANNOT_EDIT_ROUTES', 403),
    );
    assert.equal(await routeSequence(CUST_ROUTE_A), 0);
    assert.equal(await routeSequence(CUST_ROUTE_B), 0);

    // 18. (D4) can_edit_routes true: the same persist writes the new
    // sequence (1-based, one per stop).
    const persisted = await routesService.optimizeCustomerRoute(TENANT, routeCall(REP_ROUTES, true));
    assert.equal(persisted.persistedCount, 2);
    const seqs = [await routeSequence(CUST_ROUTE_A), await routeSequence(CUST_ROUTE_B)].sort((a, b) => a - b);
    assert.deepEqual(seqs, [1, 2]);

    // 19. (D4) A read-only optimize (no persist) is never gated, even
    // for a rep whose flag is false.
    const readonly = await routesService.optimizeCustomerRoute(TENANT, routeCall(REP_NOROUTES));
    assert.ok(Array.isArray((readonly as any).orderedStops));
    assert.equal((readonly as any).orderedStops.length, 2);

    // 20. (D4, legacy) A rep with NO permissions object at all keeps
    // the pre-flag behaviour: a cash discount is allowed. This pins
    // the legacy decision — it is what keeps the book-digits spec's
    // 3dp cash-discount case (whose rep carries no flags) green.
    const legacy = await service.executeFieldSale(21, TENANT, ACCOUNT, {
      tripId: 15, paymentMethod: 'cash', cashDiscountAmount: 10,
      items: [{ productId: 101, qty: 1 }],
    });
    assert.equal(legacy.total, 90);
    assert.equal(legacy.discount, 10);

    // The specific errors name the problem (never a generic message).
    await assert.rejects(
      service.executeFieldSale(REP_NODISC, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash', cashDiscountAmount: 10,
        items: [{ productId: 101, qty: 1 }],
      }),
      (err: any) => err.code === 'REP_DISCOUNT_NOT_ALLOWED' && String(err.message || '').includes('can_give_discount'),
    );

    console.log('rep permission flags H9 checks passed (20 cases)');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
