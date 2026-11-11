/*
 * Shared offer selection between POS and van field sales
 * (INV-OFFER-SELECTION-SHARED-POS-VAN, Slice 5 P7 item 1).
 *
 * THE DEFECT: the van field-sale writer re-implemented offer
 * selection with different rules from POS. POS picks the applicable
 * offer with the LOWEST adjusted unit price
 * (`pickBestApplicableOffer`); the van writer picked the single
 * offer with the HIGHEST minimum quantity, ignoring price entirely,
 * qualified offers against `baseQty` (base units, qty x multiplier)
 * while POS qualifies against sold qty, dropped happy-hour and
 * days-of-week windows entirely, and compared start/end dates in
 * UTC while POS uses host-local time. The same customer could get
 * a different price depending on the channel.
 *
 * THE FIX: the van field-sale writer calls the shared POS selector
 * (`pickBestApplicableOffer`, `isOfferActive`) with the sold
 * quantity, the per-sold-unit baseline, the tenant's book digits,
 * and one captured instant evaluated in host-local parts — the
 * POS reference clock. The van per-type price derivation, fraud
 * gates, 5-second fingerprint dedup and 4dp `baseQty` stock
 * quantity are unchanged. The BOGO bonus gate now requires a BOGO
 * active under the same shared rule (dates AND windows), where
 * before it only saw the UTC date filter.
 *
 * SETTLED FROM CODE (not invented): the POS selector already took
 * explicit `(todayIso, now)` inputs and defaulted them to
 * host-local parts; the only change to the shared helper is
 * exporting `todayLocalIsoDate` and letting it take the instant,
 * so both writers evaluate the same instant identically. There is
 * NO tenant-local offer clock: business dates are tenant-local
 * (INV-BUSINESS-DATE-TENANT-LOCAL, tenant-timezone.util.ts), but
 * offer windows never used that mechanism on either channel, and
 * unifying the clock source to tenant-local would change POS
 * window evaluation — that stays an open P9 decision. The van
 * baseline stays each writer's own (credit_price for credit sales,
 * else retail_price, times the multiplier): only the SELECTION
 * rule is shared, not the baseline. Van pre-sales order pricing
 * and the van catalog display still select offers with their own
 * rules and are named follow-ups, not part of this package.
 * Bundle/BOGO per-type price derivation in the van writer is
 * unchanged and still computes from the winner with its own
 * formulas; only WHICH offer wins is now shared.
 *
 * WHAT THIS DRIVES: the REAL VanSalesService + AccountingPosting
 * service on PGlite (harness copied from
 * van-field-sale-book-digits.spec.ts, with happy_hour/days_of_week
 * columns added to the spec product_offers DDL because the real
 * table carries them), plus the REAL shared selector and POS seam
 * on identical inputs. The e2e happy-hour case uses wide windows
 * (+/-1h in-window, +3h out-of-window) so an hour-boundary
 * rollover during the run cannot flip it. The integrated
 * createSale path is not driven here (the POS seam is driven
 * directly); the wiring guarantee for the van side is the e2e
 * field-sale cases plus the source pins below.
 *
 * FLOAT ORDER: roundMoney is plain Math.round at book digits; the
 * 3dp case pins the literal both float paths produce (verified:
 * 20.255 x 0.9 and 20.255 - 20.255 x 10 / 100 both round to
 * 18.229 at 3dp).
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
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';
import {
  calculateAllowedSaleUnitPrice,
  isOfferActive,
  pickBestApplicableOffer,
  todayLocalIsoDate,
  type SaleProductOfferRow,
} from '../../src/modules/sales/helpers/sales-write.helper';

const TENANT = 't-offer-share';
const ACCOUNT = 'a-offer-share';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
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
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
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

async function seedProduct(db: Kysely<Database>, id: number, retail: number, cost: number, vanQty: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({ id, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${id}`, stock_qty: vanQty, cost_price: cost, retail_price: retail, credit_price: 0, is_active: true }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty }).execute();
}

async function seedOffer(db: Kysely<Database>, offer: Record<string, unknown>): Promise<void> {
  await (db as any).insertInto('product_offers').values({ tenant_id: TENANT, is_active: true, ...offer }).execute();
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hhmm(hour: number, minute: number): string {
  return `${pad2(((hour % 24) + 24) % 24)}:${pad2(minute)}`;
}

async function main(): Promise<void> {
  // 1. E2E lowest adjusted price wins (2dp): fixed 5 off at min_qty 3
  // (95) vs 20% off at min_qty 1 (80), qty 3. The old van rule picked
  // the highest min_qty (95); the shared rule picks 80, as POS does.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 101, 100, 50, 100);
      await seedOffer(db, { product_id: 101, offer_type: 'fixed', value: 5, min_qty: 3 });
      await seedOffer(db, { product_id: 101, offer_type: 'percent', value: 20, min_qty: 1 });
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 3 }],
      });
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 80);
      assert.equal(Number(items[0].unit_offer_savings), 20);
      const posPrice = calculateAllowedSaleUnitPrice({
        retailPrice: 100, priceType: 'retail', qty: 3, moneyDigits: 2,
        offers: [
          { offer_type: 'fixed', value: 5, min_qty: 3 },
          { offer_type: 'percent', value: 20, min_qty: 1 },
        ],
      });
      assert.equal(posPrice, 80);
    } finally { await db.destroy(); }
  }

  // 2. E2E sold-quantity basis: 1 carton x12, offers 50% at min_qty 10
  // and 10% at min_qty 1. Base units (12) meet min_qty 10, sold units
  // (1) do not — the shared rule applies only the 10% offer (108 on
  // a 120 baseline), as POS does. The old rule applied the 50%.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 102, 10, 5, 100);
      await seedOffer(db, { product_id: 102, offer_type: 'percent', value: 50, min_qty: 10 });
      await seedOffer(db, { product_id: 102, offer_type: 'percent', value: 10, min_qty: 1 });
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 102, qty: 1, unitMultiplier: 12 }],
      });
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 108);
      const posPrice = calculateAllowedSaleUnitPrice({
        retailPrice: 10, priceType: 'retail', qty: 1, unitMultiplier: 12, moneyDigits: 2,
        offers: [
          { offer_type: 'percent', value: 50, min_qty: 10 },
          { offer_type: 'percent', value: 10, min_qty: 1 },
        ],
      });
      assert.equal(posPrice, 108);
    } finally { await db.destroy(); }
  }

  // 3. E2E happy-hour windows: the 30% offer sits outside its window,
  // the 10% offer inside. The old van rule ignored windows and
  // picked the 30% (highest min_qty tie); the shared rule picks 90.
  // Windows are wide (+/-1h in, +3h out) so an hour-boundary
  // rollover mid-run cannot flip the case.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 103, 100, 50, 100);
      const now = new Date();
      const h = now.getHours();
      await seedOffer(db, {
        product_id: 103, offer_type: 'percent', value: 10, min_qty: 1,
        happy_hour_start: hhmm(h - 1, 0), happy_hour_end: hhmm(h + 1, 59),
      });
      await seedOffer(db, {
        product_id: 103, offer_type: 'percent', value: 30, min_qty: 1,
        happy_hour_start: hhmm(h + 3, 0), happy_hour_end: hhmm(h + 4, 59),
      });
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 103, qty: 1 }],
      });
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 90);
      const specNow = new Date();
      const posPrice = calculateAllowedSaleUnitPrice({
        retailPrice: 100, priceType: 'retail', qty: 1, moneyDigits: 2, now: specNow,
        offers: [
          { offer_type: 'percent', value: 10, min_qty: 1, happy_hour_start: hhmm(h - 1, 0), happy_hour_end: hhmm(h + 1, 59) },
          { offer_type: 'percent', value: 30, min_qty: 1, happy_hour_start: hhmm(h + 3, 0), happy_hour_end: hhmm(h + 4, 59) },
        ],
      });
      assert.equal(posPrice, 90);
    } finally { await db.destroy(); }
  }

  // 4. E2E 3dp tenant (KWD): 20.255 -10% = 18.229 at book digits,
  // identical on the van sale and the POS seam.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'KWD');
      await seedProduct(db, 104, 20.255, 4.005, 100);
      await seedOffer(db, { product_id: 104, offer_type: 'percent', value: 10, min_qty: 1 });
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 104, qty: 1 }],
      });
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 18.229);
      assert.equal(roundMoney(20.255 * 0.9, 3), 18.229);
      const posPrice = calculateAllowedSaleUnitPrice({
        retailPrice: 20.255, priceType: 'retail', qty: 1, moneyDigits: 3,
        offers: [{ offer_type: 'percent', value: 10, min_qty: 1 }],
      });
      assert.equal(posPrice, 18.229);
    } finally { await db.destroy(); }
  }

  // 5. BOGO bonus gate is window-aware: the only BOGO sits in a
  // future happy-hour window, so a bonus without a supervisor PIN
  // fails closed. Before this package the gate saw only the UTC
  // date filter and would have let the bonus through.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 105, 100, 50, 100);
      const h = new Date().getHours();
      await seedOffer(db, {
        product_id: 105, offer_type: 'bogo', value: 100, min_qty: 1,
        bogo_buy_qty: 1, bogo_get_qty: 1, bogo_discount_percent: 100,
        happy_hour_start: hhmm(h + 3, 0), happy_hour_end: hhmm(h + 4, 59),
      });
      const service = buildService(db);
      await assert.rejects(
        service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1, paymentMethod: 'cash',
          items: [{ productId: 105, qty: 1, isBonus: true }],
        }),
        (err: any) => String(err?.message || err).includes('BONUS_REQUIRES_SUPERVISOR_PIN') || String(err?.code || '').includes('BONUS_REQUIRES_SUPERVISOR_PIN'),
      );
      const count = await (db as any).selectFrom('sales').select(sql`count(*)`.as('c')).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow() as any;
      assert.equal(Number(count.c), 0);
    } finally { await db.destroy(); }
  }

  // 6. Direct selector, fixed instant (Wednesday 2026-11-04 10:30
  // host-local): days-of-week, date range, happy-hour, tie-break,
  // and bundle-vs-percent parity — all through the shared selector
  // the van writer now calls.
  {
    const now = new Date(2026, 10, 4, 10, 30);
    const todayIso = todayLocalIsoDate(now);
    assert.equal(todayIso, '2026-11-04');
    const wedOnly: SaleProductOfferRow = { offer_type: 'percent', value: 10, min_qty: 1, days_of_week: '3' };
    const thuOnly: SaleProductOfferRow = { offer_type: 'percent', value: 30, min_qty: 1, days_of_week: '4' };
    assert.ok(isOfferActive(wedOnly, todayIso, now));
    assert.ok(!isOfferActive(thuOnly, todayIso, now));
    assert.equal(pickBestApplicableOffer([wedOnly, thuOnly], todayIso, 1, 100, now, 2), wedOnly);

    const inWindow: SaleProductOfferRow = { offer_type: 'percent', value: 10, min_qty: 1, happy_hour_start: '09:00', happy_hour_end: '12:00' };
    const outWindow: SaleProductOfferRow = { offer_type: 'percent', value: 30, min_qty: 1, happy_hour_start: '13:00', happy_hour_end: '15:00' };
    assert.equal(pickBestApplicableOffer([inWindow, outWindow], todayIso, 1, 100, now, 2), inWindow);

    const expired: SaleProductOfferRow = { offer_type: 'percent', value: 30, min_qty: 1, end_date: '2026-11-03' };
    const live: SaleProductOfferRow = { offer_type: 'percent', value: 10, min_qty: 1, start_date: '2026-11-01', end_date: '2026-11-30' };
    assert.equal(pickBestApplicableOffer([expired, live], todayIso, 1, 100, now, 2), live);

    // Same adjusted price (90): the higher minimum quantity wins
    // the tie-break, exactly as POS has always ordered it.
    const lowMin: SaleProductOfferRow = { offer_type: 'percent', value: 10, min_qty: 1 };
    const highMin: SaleProductOfferRow = { offer_type: 'fixed', value: 10, min_qty: 3 };
    assert.equal(pickBestApplicableOffer([lowMin, highMin], todayIso, 3, 100, now, 2), highMin);

    // Bundle (2 for 150 over 4 units = 75) beats 20% off (80).
    const bundle: SaleProductOfferRow = { offer_type: 'bundle', value: 150, min_qty: 2 };
    const pct: SaleProductOfferRow = { offer_type: 'percent', value: 20, min_qty: 1 };
    assert.equal(pickBestApplicableOffer([bundle, pct], todayIso, 4, 100, now, 2), bundle);
    assert.equal(
      calculateAllowedSaleUnitPrice({ retailPrice: 100, priceType: 'retail', qty: 4, moneyDigits: 2, offers: [bundle, pct] }),
      75,
    );
  }

  // 7. Source pins: the field-sale slice calls the shared selector
  // with the sold quantity and fetches the window columns; the old
  // highest-min-qty / base-units selector is gone from the writer.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
    const start = source.indexOf('private async executeFieldSaleInternal(');
    const end = source.indexOf('async recordFieldCollection(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes('pickBestApplicableOffer(activeOffers, offerTodayIso, inputQty, baseUnitPrice, saleNow, bookDigits)'), 'van calls the shared selector on sold qty');
    assert.ok(body.includes('isOfferActive(o, offerTodayIso, saleNow)'), 'BOGO bonus gate uses the shared activity rule');
    assert.ok(body.includes("'happy_hour_start', 'happy_hour_end', 'days_of_week'"), 'window columns fetched for selection');
    for (const gone of ['getMinQty(b) - getMinQty(a)', 'baseQty >= getMinQty', 'toISOString().slice(0, 10)']) {
      assert.ok(!body.includes(gone), `old van selector must be gone: ${gone}`);
    }
    const helper = readFileSync(resolve(__dirname, '../../src/modules/sales/helpers/sales-write.helper.ts'), 'utf8');
    assert.ok(helper.includes('export function todayLocalIsoDate('), 'shared offer-clock date is exported for both writers');
  }

  // 8. Invariant pin: exactly once. (Last-line ownership passes to
  // newer entries: INV-FLOATING-POOL-ALLOCATION-LEG appends after
  // this entry, so the last-line assertion that held at this
  // package's own landing is relaxed here — test-only, behaviour
  // cases above are unchanged.)
  {
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    const name = 'INV-OFFER-SELECTION-SHARED-POS-VAN';
    const occurrences = invariants.split(name).length - 1;
    assert.equal(occurrences, 1);
    assert.equal(invariants.split('INV-SALE-TAX-BOOK-DIGITS-PRE-ROUND').length - 1, 1);
    assert.equal(invariants.split('INV-CONVERSION-LINE-DISCOUNTS-PRESERVED').length - 1, 1);
  }

  console.log('shared-offer-selection-pos-van: all cases passed');
}

main()
  .then(async () => {
    console.log('shared-offer-selection-pos-van: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
