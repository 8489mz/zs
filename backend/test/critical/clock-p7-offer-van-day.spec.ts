/* clock-p7-offer-van-day.spec.ts — P7 (clock, RC-8 + RC-10): the offer
 * clock, the van route day and the van visit day derive from the TENANT
 * day (single-server-clock rule), and the mobile visit check-out is
 * wired end to end (server stamps it, never the client clock).
 *
 * Frozen instant used by §0/§C: 2026-04-08T21:30:00Z = 23:30 Cairo
 * (Wed 2026-04-08) = 00:30 Kuwait (Thu 2026-04-09) — the same instant
 * is a different business day in the two zones, so a host-local
 * implementation and a tenant-zone implementation disagree on it.
 * On pristine 1b9ee3f4e (host = UTC) every section below REDs:
 * §0 Kuwait pins fail (host evaluates 21:30 Wed), §B finds the
 * other-zone customer unscheduled, §C finds the Kuwait-date visit
 * missing and the Cairo-date visit present, §D source pins fail.
 *
 * Honest limitation: there is no rendered-frontend spec for the
 * 4,000-line VanSalesMobilePage — the check-out wiring is pinned by
 * source pins (§D) + the backend check-out contract (§D) + the
 * scoped tsc / mirror checks; a rendered page test is out of scope
 * for this package.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import {
  zonedOfferClockParts,
  isOfferActive,
  calculateAllowedSaleUnitPrice,
  todayLocalIsoDate,
} from '../../src/modules/sales/helpers/sales-write.helper';
import {
  getCurrentBusinessDay,
  DAY_KEY_TO_ARABIC,
} from '../../src/modules/delivery-reps/van-routes-schedule.util';
import { VanRoutesService } from '../../src/modules/delivery-reps/services/van-routes.service';
import { VanFieldExecutionService } from '../../src/modules/delivery-reps/services/van-field-execution.service';

const FROZEN = new Date('2026-04-08T21:30:00Z');

async function main(): Promise<void> {
// §0. Pure offer-clock pins: the same instant is Wed 23:30 in Cairo
// and Thu 00:30 in Kuwait — the offer day, the weekday and the
// happy-hour window must all follow the zone the caller passes.
{
  // The tenant day itself splits at the frozen instant.
  assert.equal(todayTenantDate('Asia/Kuwait', FROZEN), '2026-04-09');
  assert.equal(todayTenantDate('Africa/Cairo', FROZEN), '2026-04-08');

  // Zoned clock parts: Kuwait Thu 00:30, Cairo Wed 23:30.
  assert.deepEqual(zonedOfferClockParts('Asia/Kuwait', FROZEN), { weekday: 4, minutes: 30 });
  assert.deepEqual(zonedOfferClockParts('Africa/Cairo', FROZEN), { weekday: 3, minutes: 1410 });

  // Weekday gate: a Thursday-only offer is live in Kuwait, dead in Cairo.
  const thursdayOffer = { start_date: '2026-04-01', end_date: '2026-04-30', days_of_week: '4' };
  assert.equal(isOfferActive(thursdayOffer, '2026-04-09', FROZEN, 'Asia/Kuwait'), true);
  assert.equal(isOfferActive(thursdayOffer, '2026-04-08', FROZEN, 'Africa/Cairo'), false);

  // Happy-hour gate: 00:00-01:00 is live in Kuwait (00:30), dead in Cairo (23:30).
  const midnightOffer = { start_date: '2026-04-01', end_date: '2026-04-30', happy_hour_start: '00:00', happy_hour_end: '01:00' };
  assert.equal(isOfferActive(midnightOffer, '2026-04-09', FROZEN, 'Asia/Kuwait'), true);
  assert.equal(isOfferActive(midnightOffer, '2026-04-08', FROZEN, 'Africa/Cairo'), false);

  // End-to-end price: an offer ending 2026-04-08 is expired in Kuwait
  // (tenant day 04-09) and live in Cairo (tenant day 04-08).
  const dayOffer = { offer_type: 'percent', value: 10, min_qty: 1, start_date: '2026-04-08', end_date: '2026-04-08' };
  assert.equal(
    calculateAllowedSaleUnitPrice({ retailPrice: 100, priceType: 'retail', offers: [dayOffer], qty: 1, now: FROZEN, businessTimezone: 'Asia/Kuwait', moneyDigits: 2 }),
    100,
  );
  assert.equal(
    calculateAllowedSaleUnitPrice({ retailPrice: 100, priceType: 'retail', offers: [dayOffer], qty: 1, now: FROZEN, businessTimezone: 'Africa/Cairo', moneyDigits: 2 }),
    90,
  );
  // No-tz default unchanged: an explicit todayIso still decides.
  assert.equal(
    calculateAllowedSaleUnitPrice({ retailPrice: 100, priceType: 'retail', offers: [dayOffer], qty: 1, now: FROZEN, todayIso: '2026-04-08', moneyDigits: 2 }),
    90,
  );

  // The shared date helper stays exported for both writers.
  assert.equal(typeof todayLocalIsoDate, 'function');

  // The route-day util resolves a live zone (independent Intl check).
  const kuwaitDay = getCurrentBusinessDay('Asia/Kuwait');
  const kuwaitWeekdayLong = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kuwait', weekday: 'long' }).format(new Date()).toLowerCase();
  assert.equal(kuwaitDay.dayKey, kuwaitWeekdayLong);
}

// §B. Route day: a customer scheduled only for the weekday of a zone
// whose local date differs from Cairo's MUST be scheduled today in
// that zone, and a Cairo-only customer must NOT be scheduled there.
// The zone is picked at runtime (Kiritimati / Midway / Cape Verde
// cover every UTC hour between them), so the test is deterministic
// whenever it runs — on pristine the service always used Cairo.
{
  const TENANT = 't-p7-route';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    const anyDb = db as any;
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, customer_name text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, status text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, negative_reason text, postponed_to_date date, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales_orders (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, rep_id bigint);
    `);

    const now = new Date();
    const cairoDay = todayTenantDate('Africa/Cairo', now);
    const otherZone = ['Pacific/Kiritimati', 'Pacific/Midway', 'Atlantic/Cape_Verde'].find(
      (z) => todayTenantDate(z, now) !== cairoDay,
    );
    assert.ok(otherZone, 'a zone whose local date differs from Cairo must exist at any hour');
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const otherDayKey = dayKeys[zonedOfferClockParts(otherZone, now).weekday];
    const cairoDayKey = dayKeys[zonedOfferClockParts('Africa/Cairo', now).weekday];
    assert.notEqual(otherDayKey, cairoDayKey, 'the two zones must be on different weekdays');
    const otherDayArabic = (DAY_KEY_TO_ARABIC as Record<string, string>)[otherDayKey];
    const cairoDayArabic = (DAY_KEY_TO_ARABIC as Record<string, string>)[cairoDayKey];

    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: `"${otherZone}"` }).execute();
    await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
    await anyDb.insertInto('customers').values({ id: 1, tenant_id: TENANT, name: 'عميل يوم آخر', is_active: true, balance: 0, credit_limit: 0, metadata: JSON.stringify({ assigned_rep_ids: [1], visit_days: [otherDayArabic] }) }).execute();
    await anyDb.insertInto('customers').values({ id: 2, tenant_id: TENANT, name: 'عميل يوم القاهرة', is_active: true, balance: 0, credit_limit: 0, metadata: JSON.stringify({ assigned_rep_ids: [1], visit_days: [cairoDayArabic] }) }).execute();

    const service = new VanRoutesService(db, {} as never);
    const itinerary = await service.getDriverTodayItinerary(TENANT, 1);
    const other = (itinerary as any[]).find((c) => c.customerId === 1);
    const cairoOnly = (itinerary as any[]).find((c) => c.customerId === 2);
    assert.ok(other, 'the other-zone customer must be on the itinerary');
    assert.ok(cairoOnly, 'the Cairo-only customer must be on the itinerary');
    assert.equal(other.isScheduledToday, true, 'other-zone weekday is today in the tenant zone');
    assert.equal(other.currentDayName, otherDayArabic, 'the route day name is the tenant-zone day');
    assert.equal(cairoOnly.isScheduledToday, false, 'the Cairo-only weekday is NOT today in the tenant zone');
  } finally {
    await db.destroy();
  }
}

// §C. Visit day: a check-in at 2026-04-08T21:30:00Z is 04-09 in
// Kuwait and 04-08 in Cairo. With the tenant zone Asia/Kuwait the
// 04-09 history must contain the visit, its direct sale and its
// collection — and the 04-08 history must be empty. On pristine the
// plain DATE() filter reads the DB session timezone, so the 04-09
// query finds nothing and the 04-08 query finds everything.
{
  const TENANT = 't-p7-visit';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    const anyDb = db as any;
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE van_store_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, customer_name text, check_in_at timestamptz, check_out_at timestamptz, dwell_time_seconds numeric, check_in_lat numeric, check_in_lng numeric, is_geofence_valid boolean, geofence_distance_meters numeric, has_sale boolean, sale_id bigint, sale_amount numeric, has_collection boolean, collection_amount numeric, no_sale_reason text, no_sale_notes text, store_inventory text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, note text, transfer_reference text, transfer_receipt_url text, van_trip_id bigint, rep_id bigint, client_tx_id text, payment_channel text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, customer_name text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
    `);

    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: '"Asia/Kuwait"' }).execute();
    await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
    await anyDb.insertInto('customers').values({ id: 1, tenant_id: TENANT, name: 'عميل', is_active: true }).execute();
    const instant = '2026-04-08T21:30:00Z';
    await anyDb.insertInto('van_store_visits').values({ id: 1, tenant_id: TENANT, trip_id: 1, rep_id: 1, customer_id: 1, customer_name: 'عميل', check_in_at: instant, created_at: instant }).execute();
    await anyDb.insertInto('sales').values({ id: 1, tenant_id: TENANT, doc_no: 'S-1', total: 120, customer_id: 1, delivery_rep_id: 1, van_trip_id: 1, payment_type: 'cash', created_at: instant }).execute();
    await anyDb.insertInto('customer_payments').values({ id: 1, tenant_id: TENANT, customer_id: 1, amount: 50, van_trip_id: 1, rep_id: 1, created_at: instant }).execute();

    const service = new VanFieldExecutionService(db, {} as never);
    const kuwait = await service.getVisitsHistory(TENANT, { date: '2026-04-09' });
    assert.equal((kuwait as any).visits.length, 2, 'Kuwait 04-09 sees the check-in + the direct sale');
    assert.ok((kuwait as any).visits.some((v: any) => Number(v.id) === 1), 'Kuwait 04-09 sees the check-in visit');
    assert.ok((kuwait as any).visits.some((v: any) => Number(v.saleId) === 1), 'Kuwait 04-09 sees the direct sale');
    assert.equal((kuwait as any).metrics.totalVisits, 2);
    assert.equal((kuwait as any).metrics.totalSalesAmount, 120);
    assert.equal((kuwait as any).metrics.totalCollectionsAmount, 50);

    const cairo = await service.getVisitsHistory(TENANT, { date: '2026-04-08' });
    assert.equal((cairo as any).visits.length, 0, 'Cairo 04-08 sees nothing — the instant is 04-09 in the tenant zone');
    assert.equal((cairo as any).metrics.totalVisits, 0);
    assert.equal((cairo as any).metrics.totalSalesAmount, 0);
    assert.equal((cairo as any).metrics.totalCollectionsAmount, 0);
  } finally {
    await db.destroy();
  }
}

// §D. Check-out wiring: the mobile page calls checkOutVisit with the
// stored server visit id at end-visit, the API posts it with no
// client timestamp, and the backend stamps check-out + dwell.
{
  const page = readFileSync(resolve(__dirname, '../../../frontend/src/features/delivery-reps/pages/van-sales-mobile/useVanVisit.tsx'), 'utf8');
  assert.ok(page.includes('visitId?: number'), 'activeVisit carries the server visit id');
  assert.ok(page.includes('visitId: Number(res.visitId)'), 'the check-in response visitId is stored');
  assert.ok(page.includes('vanSalesApi.checkOutVisit(visitId)'), 'end-visit calls checkOutVisit with the stored id');
  const api = readFileSync(resolve(__dirname, '../../../frontend/src/features/delivery-reps/api/van-sales/van-sales-visits-ledger.ts'), 'utf8');
  const apiStart = api.indexOf('checkOutVisit: async');
  const apiEnd = api.indexOf('recordTradeSurvey', apiStart);
  assert.ok(apiStart > 0 && apiEnd > apiStart);
  const apiBody = api.slice(apiStart, apiEnd);
  assert.ok(apiBody.includes('/visits/${visitId}/check-out'), 'check-out posts to the visit check-out endpoint');
  assert.ok(!apiBody.includes('checkOutAt') && !apiBody.includes('new Date'), 'no client timestamp is sent with check-out');

  const TENANT = 't-p7-checkout';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE van_store_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, customer_name text, check_in_at timestamptz, check_out_at timestamptz, dwell_time_seconds numeric, check_in_lat numeric, check_in_lng numeric, is_geofence_valid boolean, geofence_distance_meters numeric, has_sale boolean, sale_id bigint, sale_amount numeric, has_collection boolean, collection_amount numeric, no_sale_reason text, no_sale_notes text, store_inventory text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    `);
    const checkInAt = new Date(Date.now() - 5 * 60 * 1000);
    await (db as any).insertInto('van_store_visits').values({ id: 1, tenant_id: TENANT, trip_id: 1, rep_id: 7, customer_id: 1, customer_name: 'عميل', check_in_at: checkInAt, created_at: checkInAt }).execute();
    const service = new VanFieldExecutionService(db, {} as never);
    const res = await service.checkOutVisit(TENANT, 1, {}, 7);
    assert.equal((res as any).ok, true);
    assert.equal((res as any).visitId, 1);
    assert.ok((res as any).dwellTimeSeconds >= 240 && (res as any).dwellTimeSeconds <= 360, `dwell is ~5 minutes, got ${(res as any).dwellTimeSeconds}s`);
    const row = await (db as any).selectFrom('van_store_visits').select(['check_out_at', 'dwell_time_seconds']).where('id', '=', 1).executeTakeFirst();
    assert.ok(row.check_out_at, 'check_out_at is stamped by the server');
    assert.ok(Number(row.dwell_time_seconds) >= 240, 'dwell is stored on the visit row');
  } finally {
    await db.destroy();
  }
}

console.log('✓ All clock P7 offer / van-day / check-out invariants passed successfully.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
