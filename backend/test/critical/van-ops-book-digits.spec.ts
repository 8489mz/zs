/* Van-ops book digits (D6b): money computed on van paths rounds at the
 * tenant's book digits, not a hardcoded 2 decimals. On a 3-decimal tenant
 * (KWD) the old toFixed(2) form silently cut the third decimal:
 *   - fuel cost 3 litres x 33.375 = 100.125 was stored as 100.13
 *   - a 12.5% promo on an 801 subtotal = 100.125 discount was 100.13
 *   - a 12.5% aggregator commission on 801 = 100.125 / net 700.875
 *     was stored as 100.13 / 700.87
 *   - fraud-radar amounts 100.125 + 33.375 were stored as 100.13 +
 *     33.38, so the at-risk total read 133.51 instead of 133.5
 *   - visit sales/collections totals 100.125 / 33.375 were 100.13 / 33.38
 * On a 2-decimal tenant (EGP) every figure above is byte-identical to
 * the old form, which the EGP control cases pin.
 *
 * WHAT IS DRIVEN: the real services end to end on one fresh PGlite db
 * (VanFleetService.recordFuelLog, VanPromotionsService.evaluateCart,
 * DeliveryAggregatorsService.ingestOrder, VanFraudRadarService
 * .recordSuspicionEvent + getSummary) plus the real pure engines
 * (evaluateFmcgCartPromotions, calculateStrikeRateMetrics) with an
 * explicit moneyDigits argument and with the default (2dp) preserved.
 * The live callers resolve the digits from settings/currency, so the
 * service cases prove the wiring, not just the engines.
 *
 * NOT DRIVEN: DeliveryRepsService.settleAllOrders (same roundMoney
 * pattern on the transaction handle; covered by the existing settle
 * specs) and the WhatsApp alert text, which stays a 2dp display format
 * of an already book-rounded amount.
 */
import assert from 'node:assert/strict';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { VanFleetService } from '../../src/modules/delivery-reps/services/van-fleet.service';
import { VanPromotionsService } from '../../src/modules/delivery-reps/services/van-promotions.service';
import { DeliveryAggregatorsService } from '../../src/modules/sales/services/delivery-aggregators.service';
import { VanFraudRadarService } from '../../src/modules/delivery-reps/services/van-fraud-radar.service';
import { evaluateFmcgCartPromotions } from '../../src/modules/delivery-reps/fmcg-promotions.engine';
import { FmcgVisitExecutionEngine } from '../../src/modules/delivery-reps/fmcg-visit-execution.engine';

const KWD = 't-kwd';
const EGP = 't-egp';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'admin',
  permissions: ['*'],
  tenantId: KWD,
  accountId: 'a1',
};
const ACTOR_EGP: any = { ...ACTOR, tenantId: EGP };

async function setup() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });

  await sql`CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '')`.execute(db);
  await sql`CREATE TABLE currency_exchange_rates (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, currency_code TEXT NOT NULL, exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1, is_base BOOLEAN NOT NULL DEFAULT false)`.execute(db);
  await sql`CREATE TABLE tenants (id VARCHAR(50) PRIMARY KEY, business_name TEXT)`.execute(db);
  await sql`CREATE TABLE fleet_vehicles (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, plate_number TEXT, current_odometer NUMERIC(14,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ)`.execute(db);
  await sql`CREATE TABLE fleet_fuel_logs (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id VARCHAR(50) NOT NULL DEFAULT 'a1', vehicle_id INTEGER NOT NULL, trip_id INTEGER, rep_id INTEGER, odometer NUMERIC(14,2) NOT NULL DEFAULT 0, liters NUMERIC(14,3) NOT NULL DEFAULT 0, price_per_liter NUMERIC(14,3) NOT NULL DEFAULT 0, total_cost NUMERIC(14,3) NOT NULL DEFAULT 0, station_name TEXT, km_since_last_fuel NUMERIC(14,2) NOT NULL DEFAULT 0, consumption_rate NUMERIC(14,2) NOT NULL DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE fmcg_promotions (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, promo_type TEXT NOT NULL, apply_type TEXT NOT NULL, buy_conditions JSONB, reward JSONB, customer_types JSONB, start_date DATE, end_date DATE, is_active BOOLEAN NOT NULL DEFAULT true, max_applications_per_order INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0, notes TEXT)`.execute(db);
  await sql`CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id VARCHAR(50) NOT NULL DEFAULT 'a1', action TEXT NOT NULL, event_code TEXT, details TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE delivery_representatives (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, name TEXT NOT NULL, phone TEXT, is_van_rep BOOLEAN NOT NULL DEFAULT true, rep_type TEXT, is_active BOOLEAN NOT NULL DEFAULT true)`.execute(db);
  await sql`CREATE TABLE pos_delivery_aggregators (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id VARCHAR(50) NOT NULL DEFAULT 'a1', code TEXT NOT NULL, name TEXT NOT NULL, name_en TEXT, commission_rate NUMERIC(14,3) NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, auto_accept_orders BOOLEAN NOT NULL DEFAULT true, api_key TEXT, webhook_secret TEXT, price_markup_percentage NUMERIC(14,3), price_markup_fixed NUMERIC(14,3))`.execute(db);
  await sql`CREATE TABLE pos_aggregator_orders (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, account_id VARCHAR(50) NOT NULL DEFAULT 'a1', aggregator_id INTEGER NOT NULL, external_order_id TEXT NOT NULL, display_number TEXT, branch_id INTEGER, status TEXT NOT NULL DEFAULT 'received', customer_name TEXT, customer_phone TEXT, delivery_address TEXT, rider_name TEXT, rider_phone TEXT, subtotal NUMERIC(14,3) NOT NULL DEFAULT 0, delivery_fee NUMERIC(14,3) NOT NULL DEFAULT 0, aggregator_commission NUMERIC(14,3) NOT NULL DEFAULT 0, net_payout NUMERIC(14,3) NOT NULL DEFAULT 0, order_payload JSONB)`.execute(db);

  for (const [tenantId, code] of [[KWD, 'KWD'], [EGP, 'EGP']] as const) {
    await db.insertInto('settings').values({ tenant_id: tenantId, key: 'currency', value: `"${code}"` }).execute();
    await db.insertInto('currency_exchange_rates').values({ tenant_id: tenantId, currency_code: code, exchange_rate: 1, is_base: true }).execute();
    await db.insertInto('tenants').values({ id: tenantId, business_name: `Tenant ${code}` }).execute();
    await db.insertInto('fleet_vehicles').values({ tenant_id: tenantId, plate_number: `VAN-${code}`, current_odometer: 1000 }).execute();
    await db.insertInto('delivery_representatives').values({ tenant_id: tenantId, name: 'Rep', is_active: true }).execute();
    await db.insertInto('pos_delivery_aggregators').values({ tenant_id: tenantId, account_id: 'a1', code: 'talabat', name: 'Talabat', commission_rate: 12.5, is_active: true, auto_accept_orders: true }).execute();
    await db.insertInto('fmcg_promotions').values({
      tenant_id: tenantId,
      name: 'Threshold 12.5%',
      code: 'THR125',
      promo_type: 'invoice_threshold',
      apply_type: 'discount_percent',
      buy_conditions: JSON.stringify({ minInvoiceTotal: 100 }),
      reward: JSON.stringify({ discountPercent: 12.5 }),
      customer_types: null,
      start_date: null,
      end_date: null,
      is_active: true,
      max_applications_per_order: 1,
      priority: 1,
      notes: null,
    }).execute();
  }

  const repKwd = await db.selectFrom('delivery_representatives').select('id').where('tenant_id', '=', KWD).executeTakeFirstOrThrow();
  const repEgp = await db.selectFrom('delivery_representatives').select('id').where('tenant_id', '=', EGP).executeTakeFirstOrThrow();
  return { db, repKwd: Number(repKwd.id), repEgp: Number(repEgp.id) };
}

async function main() {
  const { db, repKwd, repEgp } = await setup();
  const fleet = new VanFleetService(db as any);
  const promos = new VanPromotionsService(db as any);
  const aggregators = new DeliveryAggregatorsService(db as any);
  const radar = new VanFraudRadarService(db as any);

  // A: fuel cost — 3 litres x 33.375 = 100.125 stays 100.125 on KWD.
  {
    const vehicle = await db.selectFrom('fleet_vehicles').select('id').where('tenant_id', '=', KWD).executeTakeFirstOrThrow();
    const res: any = await fleet.recordFuelLog(KWD, 'a1', repKwd, {
      vehicleId: Number(vehicle.id),
      odometer: 1100,
      liters: 3,
      pricePerLiter: 33.375,
      stationName: 'Station',
    });
    assert.equal(res.totalCost, 100.125, `KWD fuel total must be 100.125, got ${res.totalCost}`);
    const stored = await db.selectFrom('fleet_fuel_logs').select('total_cost').where('tenant_id', '=', KWD).executeTakeFirstOrThrow();
    assert.equal(Number(stored.total_cost), 100.125, `KWD stored fuel cost must be 100.125, got ${stored.total_cost}`);
  }

  // B: fuel cost — identical 2dp behaviour on EGP (100.13, as before).
  {
    const vehicle = await db.selectFrom('fleet_vehicles').select('id').where('tenant_id', '=', EGP).executeTakeFirstOrThrow();
    const res: any = await fleet.recordFuelLog(EGP, 'a1', repEgp, {
      vehicleId: Number(vehicle.id),
      odometer: 1100,
      liters: 3,
      pricePerLiter: 33.375,
      stationName: 'Station',
    });
    assert.equal(res.totalCost, 100.13, `EGP fuel total must stay 100.13, got ${res.totalCost}`);
  }

  // C: promo discount through the live caller — 12.5% of 801 = 100.125.
  {
    const res = await promos.evaluateCart(KWD, {
      cartItems: [{ productId: 1, qty: 1, unitPrice: 801 }],
      invoiceSubtotal: 801,
      customerType: 'regular',
    });
    assert.equal(res.totalPromotionalDiscount, 100.125, `KWD promo discount must be 100.125, got ${res.totalPromotionalDiscount}`);
    assert.equal(res.appliedPromotions[0]?.discountAmount, 100.125, `KWD applied discount must be 100.125, got ${res.appliedPromotions[0]?.discountAmount}`);
  }

  // D: promo discount — identical 2dp behaviour on EGP.
  {
    const res = await promos.evaluateCart(EGP, {
      cartItems: [{ productId: 1, qty: 1, unitPrice: 801 }],
      invoiceSubtotal: 801,
      customerType: 'regular',
    });
    assert.equal(res.totalPromotionalDiscount, 100.13, `EGP promo discount must stay 100.13, got ${res.totalPromotionalDiscount}`);
  }

  // E: pure promo engine — explicit digits and the 2dp default.
  {
    const promo: any = {
      id: 9, name: 'Amount', code: 'AMT', promoType: 'invoice_threshold',
      applyType: 'discount_amount', buyConditions: { minInvoiceTotal: 100 },
      reward: { discountAmount: 100.125 }, isActive: true,
    };
    const cart = [{ productId: 1, qty: 1, unitPrice: 801 }];
    const at3 = evaluateFmcgCartPromotions({ cartItems: cart, invoiceSubtotal: 801, activePromotions: [promo], moneyDigits: 3 });
    assert.equal(at3.totalPromotionalDiscount, 100.125, `engine at 3dp must be 100.125, got ${at3.totalPromotionalDiscount}`);
    const at2 = evaluateFmcgCartPromotions({ cartItems: cart, invoiceSubtotal: 801, activePromotions: [promo] });
    assert.equal(at2.totalPromotionalDiscount, 100.13, `engine default must stay 100.13, got ${at2.totalPromotionalDiscount}`);
  }

  // F: visit sales/collections totals — pure engine, explicit digits + default.
  {
    const visits: any = [{ has_sale: true, has_collection: true, sale_amount: 100.125, collection_amount: 33.375, dwell_time_seconds: 60 }];
    const at3 = FmcgVisitExecutionEngine.calculateStrikeRateMetrics(visits, 3);
    assert.equal(at3.totalSalesAmount, 100.125, `visit sales at 3dp must be 100.125, got ${at3.totalSalesAmount}`);
    assert.equal(at3.totalCollectionsAmount, 33.375, `visit collections at 3dp must be 33.375, got ${at3.totalCollectionsAmount}`);
    const at2 = FmcgVisitExecutionEngine.calculateStrikeRateMetrics(visits);
    assert.equal(at2.totalSalesAmount, 100.13, `visit sales default must stay 100.13, got ${at2.totalSalesAmount}`);
    assert.equal(at2.totalCollectionsAmount, 33.38, `visit collections default must stay 33.38, got ${at2.totalCollectionsAmount}`);
  }

  // G: aggregator commission + net payout through the live service.
  {
    const res: any = await aggregators.ingestOrder(ACTOR, {
      aggregatorCode: 'talabat',
      externalOrderId: 'EXT-1',
      subtotal: 801,
      deliveryFee: 0,
      commissionRate: 12.5,
      items: [{ name: 'Item', qty: 1, unitPrice: 801 }],
    });
    assert.equal(res.commissionAmount, 100.125, `KWD commission must be 100.125, got ${res.commissionAmount}`);
    assert.equal(res.netPayout, 700.875, `KWD net payout must be 700.875, got ${res.netPayout}`);
    const stored = await db.selectFrom('pos_aggregator_orders').select(['aggregator_commission', 'net_payout']).where('tenant_id', '=', KWD).executeTakeFirstOrThrow();
    assert.equal(Number(stored.aggregator_commission), 100.125, `KWD stored commission must be 100.125, got ${stored.aggregator_commission}`);
    assert.equal(Number(stored.net_payout), 700.875, `KWD stored net payout must be 700.875, got ${stored.net_payout}`);
  }

  // H: aggregator — identical 2dp behaviour on EGP.
  {
    const res: any = await aggregators.ingestOrder(ACTOR_EGP, {
      aggregatorCode: 'talabat',
      externalOrderId: 'EXT-1',
      subtotal: 801,
      deliveryFee: 0,
      commissionRate: 12.5,
      items: [{ name: 'Item', qty: 1, unitPrice: 801 }],
    });
    assert.equal(res.commissionAmount, 100.13, `EGP commission must stay 100.13, got ${res.commissionAmount}`);
    assert.equal(res.netPayout, 700.87, `EGP net payout must stay 700.87, got ${res.netPayout}`);
  }

  // I: fraud radar — stored amounts keep the third decimal on KWD, and
  // the at-risk total sums the stored amounts (100.125 + 33.375 = 133.5,
  // not the old 100.13 + 33.38 = 133.51).
  {
    await radar.recordSuspicionEvent({
      tenantId: KWD, accountId: 'a1', repId: repKwd,
      eventCode: 'VAN_SUSPICION_SETTLEMENT_SHORTAGE', severity: 'high',
      titleAr: 'Shortage', detailsAr: 'Shortage', amountInvolved: 100.125, actorUserId: 1,
    });
    await radar.recordSuspicionEvent({
      tenantId: KWD, accountId: 'a1', repId: repKwd,
      eventCode: 'VAN_SUSPICION_SETTLEMENT_SHORTAGE', severity: 'high',
      titleAr: 'Shortage', detailsAr: 'Shortage', amountInvolved: 33.375, actorUserId: 1,
    });
    const rows = await db.selectFrom('audit_logs').select('details').where('tenant_id', '=', KWD).orderBy('id', 'asc').execute();
    assert.equal(rows.length, 2, `two radar events must be stored, got ${rows.length}`);
    assert.equal(JSON.parse(String(rows[0].details)).amountInvolved, 100.125, `first stored amount must be 100.125, got ${JSON.parse(String(rows[0].details)).amountInvolved}`);
    assert.equal(JSON.parse(String(rows[1].details)).amountInvolved, 33.375, `second stored amount must be 33.375, got ${JSON.parse(String(rows[1].details)).amountInvolved}`);
    const summary: any = await radar.getSummary(KWD, { days: 30 });
    assert.equal(summary.kpis.totalAmountAtRisk, 133.5, `KWD at-risk total must be 133.5, got ${summary.kpis.totalAmountAtRisk}`);
    const profile = (summary.repProfiles || []).find((p: any) => Number(p.repId) === repKwd);
    assert.ok(profile, 'the KWD rep must have a risk profile');
    assert.equal(profile.totalAmountAtRisk, 133.5, `KWD rep at-risk total must be 133.5, got ${profile.totalAmountAtRisk}`);
  }

  // J: fraud radar — identical 2dp behaviour on EGP.
  {
    await radar.recordSuspicionEvent({
      tenantId: EGP, accountId: 'a1', repId: repEgp,
      eventCode: 'VAN_SUSPICION_SETTLEMENT_SHORTAGE', severity: 'high',
      titleAr: 'Shortage', detailsAr: 'Shortage', amountInvolved: 100.125, actorUserId: 1,
    });
    const rows = await db.selectFrom('audit_logs').select('details').where('tenant_id', '=', EGP).orderBy('id', 'asc').execute();
    assert.equal(JSON.parse(String(rows[0].details)).amountInvolved, 100.13, `EGP stored amount must stay 100.13, got ${JSON.parse(String(rows[0].details)).amountInvolved}`);
  }

  await db.destroy();
  console.log('van-ops-book-digits: PASS (10 cases)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
