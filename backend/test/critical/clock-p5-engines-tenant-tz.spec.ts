/*
 * Clock P5 — engines env-or-Cairo -> tenant tz (RC-4).
 *
 * ar-dunning.engine.ts and fmcg-promotions.engine.ts derived their
 * business day from `process.env.BUSINESS_TIMEZONE || 'Africa/Cairo'`,
 * ignoring the tenant's `settings.timezone`. Both engines now take an
 * optional tenant timezone (allocateCustomerOverdueFifo /
 * evaluateCustomerDunning: `businessTimezone?`; evaluateFmcgCartPromotions:
 * `params.businessTimezone?`), resolved by the live callers via
 * getTenantTimezone; the env fallback is preserved for pure-engine
 * callers with no tenant context.
 *
 * Frozen instant 2026-04-08T21:30:00Z = 23:30 Cairo on 2026-04-08 but
 * 00:30 Kuwait on 2026-04-09, so a Kuwait tenant and a Cairo tenant
 * disagree about the day by design.
 *
 * Honest limits, pinned in the sections below:
 * - In ArCollectionsService.syncCollections the engine is ALWAYS called
 *   with a pre-aggregated overdueSummary, so allocateCustomerOverdueFifo
 *   is unreachable from the live dunning path. The day behaviour is
 *   therefore pinned at engine level (section A); section C pins the
 *   live services do not regress with a Kuwait tenant (same totals,
 *   same applied promos). The tz threading itself is the audit-required
 *   wiring (RC-4 fix shape) plus future-proofing for callers that pass
 *   invoices without a summary.
 * - In VanPromotionsService.evaluateCart the referenceDate is already
 *   the tenant-local day STRING (Cat 1-a F1), so the engine's string
 *   branch never consults the tz on the live path. The tz param covers
 *   the Date branch and pure-engine callers; section B pins it with a
 *   frozen Date reference, section C pins the live path.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import {
  allocateCustomerOverdueFifo,
  evaluateCustomerDunning,
  type CustomerDunningInput,
  type DunningLevel,
} from '../../src/modules/accounting/engines/ar-dunning.engine';
import { evaluateFmcgCartPromotions, type FmcgPromotion } from '../../src/modules/delivery-reps/fmcg-promotions.engine';
import { todayTenantDate, getTenantTimezone } from '../../src/common/utils/tenant-timezone.util';
import { ArCollectionsService } from '../../src/modules/accounting/services/ar-collections.service';
import { VanPromotionsService } from '../../src/modules/delivery-reps/services/van-promotions.service';

// 2026-04-08T21:30:00Z: 23:30 Cairo on 04-08, 00:30 Kuwait on 04-09.
const FROZEN = new Date('2026-04-08T21:30:00Z');
const KUWAIT = 'Asia/Kuwait';
const CAIRO = 'Africa/Cairo';

const KWD_AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;
const EGP_AUTH = {
  tenantId: 't3',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: ['settings'],
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, tenantId: string, currency: string): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS settings (tenant_id text, key text, value text, PRIMARY KEY (tenant_id, key))`.execute(
    db,
  );
  await sql`CREATE TABLE IF NOT EXISTS currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric)`.execute(
    db,
  );
  await sql`INSERT INTO settings (tenant_id, key, value) VALUES (${tenantId}, 'currency', ${currency})`.execute(db);
  await sql`INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate) VALUES (${tenantId}, ${currency}, true, 1)`.execute(
    db,
  );
}

function mixMatchPromo(code: string, startDate: string | null, endDate: string | null): FmcgPromotion {
  return {
    id: code === 'PROMO-STARTS' ? 1 : 2,
    name: `Promo ${code}`,
    code,
    promoType: 'mix_and_match',
    applyType: 'free_bonus',
    buyConditions: [{ productId: 10, minQty: 2, productName: 'صنف 10' }],
    reward: { bonusProductId: 30, bonusProductName: 'بونص', bonusQty: 1, bonusUom: 'قطعة' } as never,
    customerTypes: ['all'],
    startDate,
    endDate,
    isActive: true,
    maxApplicationsPerOrder: 1,
    priority: 0,
    notes: null,
  };
}

const CART = [{ productId: 10, productName: 'صنف 10', qty: 2, unitPrice: 100 }];

async function main(): Promise<void> {
  // ---- §0. The frozen instant is two different business days ----
  {
    assert.equal(todayTenantDate(KUWAIT, FROZEN), '2026-04-09', '§0: frozen instant is 2026-04-09 in Kuwait');
    assert.equal(todayTenantDate(CAIRO, FROZEN), '2026-04-08', '§0: frozen instant is 2026-04-08 in Cairo');
    console.log('✓ §0 Passed: frozen instant splits Kuwait 04-09 / Cairo 04-08');
  }

  // ---- §A. Dunning engine renders the tenant day ----
  {
    const asOf = new Date('2026-05-01T12:00:00Z');
    // A1: Kuwait zone -> the Kuwait day for createdAt and dueDate.
    const kwd = allocateCustomerOverdueFifo(
      100,
      [{ id: 1, invoiceNumber: 'INV-1', createdAt: FROZEN, total: 100, paidAmount: 0 }],
      asOf,
      0,
      2,
      KUWAIT,
    );
    assert.equal(kwd.overdueInvoices.length, 1, 'A1: one overdue invoice');
    assert.equal(kwd.overdueInvoices[0].createdAt, '2026-04-09', 'A1: createdAt is the Kuwait day');
    assert.equal(kwd.overdueInvoices[0].dueDate, '2026-04-09', 'A1: dueDate (createdAt + 0 terms) is the Kuwait day');
    console.log('✓ A1 Passed: allocateCustomerOverdueFifo renders the Kuwait day with businessTimezone');

    // A2: no zone passed -> the env-or-Cairo fallback is preserved.
    const fallbackDay = todayTenantDate(process.env.BUSINESS_TIMEZONE || CAIRO, FROZEN);
    const fb = allocateCustomerOverdueFifo(
      100,
      [{ id: 1, invoiceNumber: 'INV-1', createdAt: FROZEN, total: 100, paidAmount: 0 }],
      asOf,
      0,
      2,
    );
    assert.equal(fb.overdueInvoices[0].createdAt, fallbackDay, 'A2: no-zone call keeps the env-or-Cairo fallback day');
    console.log('✓ A2 Passed: allocateCustomerOverdueFifo without a zone keeps the fallback');

    // A3: an explicit datetime dueDate renders in the tenant zone too.
    const due = allocateCustomerOverdueFifo(
      100,
      [{ id: 1, invoiceNumber: 'INV-1', createdAt: FROZEN, dueDate: FROZEN, total: 100, paidAmount: 0 }],
      asOf,
      0,
      2,
      KUWAIT,
    );
    assert.equal(due.overdueInvoices[0].dueDate, '2026-04-09', 'A3: explicit datetime dueDate is the Kuwait day');
    console.log('✓ A3 Passed: explicit dueDate renders in the tenant zone');

    // A4: evaluateCustomerDunning threads the zone into the FIFO call.
    const input: CustomerDunningInput = {
      customerId: 101,
      customerName: 'شركة النور',
      balance: 100,
      invoices: [{ id: 1, invoiceNumber: 'INV-1', createdAt: FROZEN, total: 100, paidAmount: 0 }],
      asOfDate: asOf,
    };
    const threaded = evaluateCustomerDunning(input, [] as DunningLevel[], undefined, 2, KUWAIT);
    assert.equal(threaded.overdueInvoices.length, 1, 'A4: one overdue invoice via evaluateCustomerDunning');
    assert.equal(threaded.overdueInvoices[0].createdAt, '2026-04-09', 'A4: threaded zone renders the Kuwait day');
    console.log('✓ A4 Passed: evaluateCustomerDunning threads businessTimezone into the FIFO call');
  }

  // ---- §B. Promotions engine uses the tenant zone for a Date reference ----
  {
    const starts = mixMatchPromo('PROMO-STARTS', '2026-04-09', null);
    const ended = mixMatchPromo('PROMO-ENDED', null, '2026-04-08');
    const promos = [starts, ended];

    // B1: frozen Date + Kuwait zone -> ref day 2026-04-09: the promo
    // starting 04-09 applies, the one that ended 04-08 does not.
    const kwd = evaluateFmcgCartPromotions({
      cartItems: CART,
      activePromotions: promos,
      referenceDate: FROZEN,
      businessTimezone: KUWAIT,
    });
    assert.deepEqual(
      kwd.appliedPromotions.map((p) => p.promoCode).sort(),
      ['PROMO-STARTS'],
      'B1: with the Kuwait zone only the promo starting 2026-04-09 applies',
    );
    console.log('✓ B1 Passed: promotions engine applies the Kuwait-day promo with a Date reference');

    // B2: same frozen Date, no zone -> the env-or-Cairo fallback day.
    // (Expected set is computed from the fallback day so the pin holds
    // whatever the env fallback resolves to; with the default env it is
    // 2026-04-08, so only the promo that ended 04-08 applies.)
    const fallbackDay = todayTenantDate(process.env.BUSINESS_TIMEZONE || CAIRO, FROZEN);
    const fb = evaluateFmcgCartPromotions({
      cartItems: CART,
      activePromotions: promos,
      referenceDate: FROZEN,
    });
    const expectedB2 = [
      ...(fallbackDay >= '2026-04-09' ? ['PROMO-STARTS'] : []),
      ...(fallbackDay <= '2026-04-08' ? ['PROMO-ENDED'] : []),
    ].sort();
    assert.deepEqual(
      fb.appliedPromotions.map((p) => p.promoCode).sort(),
      expectedB2,
      `B2: without a zone the engine uses the fallback day ${fallbackDay}`,
    );
    console.log('✓ B2 Passed: promotions engine without a zone keeps the env-or-Cairo fallback');
  }

  // ---- §C. Live callers resolve the tenant zone and do not regress ----
  {
    // C1: real VanPromotionsService.evaluateCart on PGlite, Kuwait tenant.
    const { pg, db } = await makeDb();
    try {
      await sql`CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '')`.execute(
        db,
      );
      await sql`CREATE TABLE currency_exchange_rates (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, currency_code TEXT NOT NULL, currency_name TEXT NOT NULL, exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1, is_base BOOLEAN NOT NULL DEFAULT false)`.execute(
        db,
      );
      await sql`CREATE TABLE fmcg_promotions (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, promo_type TEXT NOT NULL, apply_type TEXT NOT NULL, buy_conditions JSONB, reward JSONB, customer_types JSONB, start_date DATE, end_date DATE, is_active BOOLEAN NOT NULL DEFAULT true, max_applications_per_order INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(
        db,
      );
      await db.insertInto('settings').values({ tenant_id: 't-kw', key: 'currency', value: '"EGP"' }).execute();
      await db.insertInto('settings').values({ tenant_id: 't-kw', key: 'timezone', value: 'Asia/Kuwait' }).execute();
      await db
        .insertInto('currency_exchange_rates')
        .values({
          tenant_id: 't-kw',
          currency_code: 'EGP',
          currency_name: 'Egyptian Pound',
          exchange_rate: 1,
          is_base: true,
        })
        .execute();
      const promoRow = (code: string, startDate: string | null, endDate: string | null) => ({
        tenant_id: 't-kw',
        name: `Promo ${code}`,
        code,
        promo_type: 'mix_and_match',
        apply_type: 'free_bonus',
        buy_conditions: JSON.stringify([{ productId: 10, minQty: 2, productName: 'صنف 10' }]),
        reward: JSON.stringify({ bonusProductId: 30, bonusProductName: 'بونص', bonusQty: 1, bonusUom: 'قطعة' }),
        customer_types: JSON.stringify(['all']),
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        max_applications_per_order: 1,
        priority: 0,
        notes: null,
      });
      await db
        .insertInto('fmcg_promotions')
        .values(promoRow('PROMO-ALWAYS', '2026-01-01', '2027-12-31'))
        .execute();
      await db
        .insertInto('fmcg_promotions')
        .values(promoRow('PROMO-NODATES', null, null))
        .execute();
      assert.equal(await getTenantTimezone(db as never, 't-kw'), 'Asia/Kuwait', 'C1: the Kuwait settings row resolves');
      const promos = new VanPromotionsService(db as any);
      const res = await promos.evaluateCart('t-kw', {
        cartItems: [{ productId: 10, productName: 'صنف 10', qty: 2, unitPrice: 100 }],
        customerType: 'regular',
      });
      assert.deepEqual(
        res.appliedPromotions.map((p) => p.promoCode).sort(),
        ['PROMO-ALWAYS', 'PROMO-NODATES'],
        'C1: live evaluateCart still applies the always-live promos with a Kuwait tenant',
      );
      console.log('✓ C1 Passed: live VanPromotionsService.evaluateCart resolves Kuwait and applies promos');
    } finally {
      await db.destroy();
    }
  }

  {
    // C2: real ArCollectionsService.syncCollections on PGlite, Kuwait (t1)
    // and Cairo (t3) tenants — same totals, no regression from the wiring.
    const { pg, db } = await makeDb();
    try {
      await pg.exec(`
        CREATE TABLE ar_dunning_levels (id text PRIMARY KEY, tenant_id text, level_order int, level_name text, days_past_due int, auto_block_sales boolean, action_type text, template_text text);
        CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, balance numeric, credit_limit numeric, is_credit_blocked boolean, is_active boolean);
        CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, created_at timestamptz, total numeric, paid_amount numeric, status text);
        CREATE TABLE ar_collection_cases (id text PRIMARY KEY, tenant_id text, customer_id bigint, current_level_id text, total_overdue numeric, oldest_overdue_days int, status text, promised_payment_date timestamptz, promised_amount numeric, updated_at timestamptz, UNIQUE (tenant_id, customer_id));
        INSERT INTO ar_dunning_levels VALUES ('lvl-1-t1', 't1', 1, 'تذكير ودي', 7, false, 'whatsapp', 'مستحق {total_overdue}'), ('lvl-1-t3', 't3', 1, 'تذكير ودي', 7, false, 'whatsapp', 'مستحق {total_overdue}');
        INSERT INTO customers VALUES (1, 't1', 'Cust A', NULL, 100.125, 0, false, true), (2, 't3', 'Cust A', NULL, 100.125, 0, false, true);
        INSERT INTO sales (id, tenant_id, customer_id, created_at, total, paid_amount, status) VALUES (1, 't1', 1, NOW() - INTERVAL '10 days', 100.125, 0, 'posted'), (2, 't3', 2, NOW() - INTERVAL '10 days', 100.125, 0, 'posted');
      `);
      await seedCurrency(db, 't1', 'KWD');
      await seedCurrency(db, 't3', 'EGP');
      await sql`INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'timezone', 'Asia/Kuwait'), ('t3', 'timezone', 'Africa/Cairo')`.execute(
        db,
      );
      assert.equal(await getTenantTimezone(db as never, 't1'), 'Asia/Kuwait', 'C2: the Kuwait settings row resolves');
      const service = new ArCollectionsService(db as never);
      const kwd = await service.syncCollections(KWD_AUTH);
      const egp = await service.syncCollections(EGP_AUTH);
      assert.equal(kwd.activeCases, 1, 'C2: Kuwait tenant has one active case');
      assert.equal(egp.activeCases, 1, 'C2: Cairo tenant has one active case');
      const kwdCase = await db
        .selectFrom('ar_collection_cases')
        .selectAll()
        .where('tenant_id', '=', 't1')
        .executeTakeFirstOrThrow();
      const egpCase = await db
        .selectFrom('ar_collection_cases')
        .selectAll()
        .where('tenant_id', '=', 't3')
        .executeTakeFirstOrThrow();
      assert.equal(Number(kwdCase.total_overdue), 100.125, 'C2: Kuwait case total at KWD digits');
      assert.equal(Number(egpCase.total_overdue), 100.13, 'C2: Cairo case total at EGP digits');
      console.log('✓ C2 Passed: live ArCollectionsService.syncCollections is unchanged with a Kuwait tenant');
    } finally {
      await db.destroy();
    }
  }

  console.log('ALL CLOCK-P5 CHECKS PASSED');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
