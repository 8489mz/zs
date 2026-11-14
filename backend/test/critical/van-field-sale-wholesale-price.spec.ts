/*
 * Van field-sale wholesale price (INV-VAN-FIELD-SALE-WHOLESALE-PRICE).
 *
 * THE GAP: the van field-sale writer charged every customer retail
 * (or credit_price on credit sales) — products.wholesale_price was
 * selected (:2356) and never referenced again, customer_type was never
 * read for pricing, and pricingTierType had no 'wholesale' variant.
 * The live trial (test10k, 2026-11-13) proved it: wholesale customer
 * C-3060 bought A x 2 cartons at 12/pc (288.00, retail) and B x 12 pcs
 * at 24/pc (288.00, retail) although A wholesale is 10 and B 20.
 *
 * THE RULE: a customer with customer_type === 'wholesale' is charged
 * products.wholesale_price, on BOTH cash and credit sales, and
 * wholesale beats credit_price for such a customer (the type defines
 * the price; credit terms affect payment, not price). The server price
 * is authoritative for the wholesale tier: the Price Integrity Guard
 * no longer takes a higher client price there, so the old frontend
 * (still sending retail) cannot silently defeat the fix. Non-wholesale
 * customers are unchanged (cash / credit / offer / bonus as today).
 *
 * PER-UNIT NOTE (read before "fixing" the numbers): the service stores
 * unit_price per CHOSEN unit — baseUnitPrice = defaultBasePrice x
 * multiplier — and the real frontend submits per-unit prices
 * (changeCartItemUnit multiplies the per-piece price by the unit
 * multiplier). So case 1 sends the real frontend payload for 2
 * cartons of A: client unitPrice 144 (retail 12 x 12 pcs per carton),
 * qty 2, unitMultiplier 12; the stored unit_price is 120 (wholesale
 * 10 x 12 per carton) and the line total is 240.00. The brief's
 * "unitPrice 12 -> stored 10" was per-piece framing; the total
 * 240.00 is identical either way.
 *
 * DELIBERATELY UNCHANGED: the price-list engine (calculateEffectivePrice)
 * is NOT wired here — no customer can currently hold a price_list_id,
 * so that path would be dead on arrival (separate follow-up). The
 * pre-sales writer shares the gap (sibling package, not this one).
 * The absolute +/-0.05 client-price tolerance is unchanged; only the
 * higher-client-price branch is skipped for the wholesale tier.
 *
 * HARNESS: the real VanSalesService + the real
 * AccountingPostingService on PGlite, same harness as
 * van-field-sale-book-digits.spec.ts (tenant foundation stubbed
 * no-op; resolveSystemAuthContext shadowed; fraud radar stubbed
 * no-op — a pool read inside the sale transaction would deadlock
 * on PGlite's single-connection dialect). The DDL here carries the
 * delivery_representatives.phone column the book-digits DDL lacks:
 * M18's resolveVanMoneyAuditActor reads rep name + phone on every
 * field sale, so the book-digits harness fails on this base with
 * "column phone does not exist" (pre-existing drift, CI-blind
 * because book-digits is not in test:critical — separate follow-up,
 * not this package).
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const TENANT = 't-van-wholesale';
const ACCOUNT = 'a-van-wholesale';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, currency: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: currency }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: currency, exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'sys', is_active: true }).execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [2120, '2120', 'liability'], [4100, '4100', 'revenue'], [4300, '4300', 'revenue'], [5100, '5100', 'expense'],
  ];
  for (const [id, code, type] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: type, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 1', van_location_id: 20, is_van_rep: true }).execute();
  await anyDb.insertInto('van_sales_trips').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
}

async function seedProduct(db: Kysely<Database>, id: number, retail: number, wholesale: number, credit: number, cost: number, vanQty: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({ id, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${id}`, stock_qty: vanQty, cost_price: cost, retail_price: retail, wholesale_price: wholesale, credit_price: credit, is_active: true }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty }).execute();
}

async function seedCustomer(db: Kysely<Database>, id: number, customerType: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('customers').values({ id, tenant_id: TENANT, account_id: ACCOUNT, name: `Customer ${id}`, balance: 0, credit_limit: 5000, customer_type: customerType, metadata: '{}', is_active: true }).execute();
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const fraudStub = { recordSuspicionEvent: async () => {}, getSummary: async () => ({}), getEvents: async () => [] };
  const service = new VanSalesService(db, {} as never, {} as never, posting as never,
    undefined, undefined, undefined, undefined, undefined, undefined, fraudStub as never);
  (service as any).resolveSystemAuthContext = async () => ({
    userId: 1, sessionId: 'spec', username: 'spec', role: 'admin',
    permissions: ['accounting'], tenantId: TENANT, accountId: ACCOUNT,
  });
  return service;
}

async function saleItems(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any).selectFrom('sale_items').selectAll().where('sale_id', '=', saleId).where('tenant_id', '=', TENANT).execute();
}

async function main(): Promise<void> {
  // 1. Cash, wholesale customer, 2 cartons of A: the old frontend sends
  // retail per carton (144); the server must charge wholesale (120).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 101, 12, 10, 0, 5, 100);
      await seedProduct(db, 102, 24, 20, 22, 8, 100);
      await seedCustomer(db, 3060, 'wholesale');
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash', customerId: 3060,
        items: [{ productId: 101, qty: 2, unitPrice: 144, unitMultiplier: 12 }],
      });
      assert.equal(res.total, 240);
      const items = await saleItems(db, res.saleId);
      assert.equal(items.length, 1);
      assert.equal(Number(items[0].unit_price), 120);
      assert.equal(Number(items[0].line_total), 240);
      assert.equal(items[0].pricing_tier_type, 'wholesale');
    } finally { await db.destroy(); }
  }

  // 2. Credit, wholesale customer, 12 pieces of B: wholesale (20) beats
  // the seeded credit_price (22) and the client-sent retail (24).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 101, 12, 10, 0, 5, 100);
      await seedProduct(db, 102, 24, 20, 22, 8, 100);
      await seedCustomer(db, 3060, 'wholesale');
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'credit', customerId: 3060,
        items: [{ productId: 102, qty: 12, unitPrice: 24 }],
      });
      assert.equal(res.total, 240);
      assert.equal(res.creditOwed, 240);
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 20);
      assert.equal(Number(items[0].line_total), 240);
      assert.equal(items[0].pricing_tier_type, 'wholesale');
      const cust = await (db as any).selectFrom('customers').select('balance').where('id', '=', 3060).executeTakeFirstOrThrow() as any;
      assert.equal(Number(cust.balance), 240);
    } finally { await db.destroy(); }
  }

  // 3. No regression: a cash (non-wholesale) customer pays retail.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 101, 12, 10, 0, 5, 100);
      await seedProduct(db, 102, 24, 20, 22, 8, 100);
      await seedCustomer(db, 3061, 'cash');
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash', customerId: 3061,
        items: [
          { productId: 101, qty: 2, unitPrice: 144, unitMultiplier: 12 },
          { productId: 102, qty: 1, unitPrice: 24 },
        ],
      });
      assert.equal(res.total, 312);
      const items = await saleItems(db, res.saleId);
      assert.equal(items.length, 2);
      const a = items.find((i: any) => Number(i.product_id) === 101);
      const b = items.find((i: any) => Number(i.product_id) === 102);
      assert.equal(Number(a.unit_price), 144);
      assert.equal(Number(a.line_total), 288);
      assert.equal(a.pricing_tier_type, 'cash');
      assert.equal(Number(b.unit_price), 24);
      assert.equal(Number(b.line_total), 24);
      assert.equal(b.pricing_tier_type, 'cash');
    } finally { await db.destroy(); }
  }

  // 4. Source pin: the wholesale branch, tier and guard skip live in
  // executeFieldSaleInternal.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/services/van-field-sales.service.ts'), 'utf8');
    const start = source.indexOf('async executeFieldSaleInternal(');
    const end = source.indexOf('async listDriverSales(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes("customerType === 'wholesale'"), 'customer_type drives the price branch');
    assert.ok(body.includes("'wholesale'"), 'wholesale pricing tier exists');
    assert.ok(body.includes("} else if (pricingTierType === 'wholesale') {"), 'server price is authoritative for the wholesale tier');
  }

  console.log('van-field-sale-wholesale-price: all cases passed');
}

main()
  .then(async () => {
    console.log('van-field-sale-wholesale-price: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
