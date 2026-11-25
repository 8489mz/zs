/*
 * New file: backend/test/critical/category-1a-money-dates.spec.ts
 *
 * WHAT THIS PINS (Category 1-a, INV-BUSINESS-DATE-TENANT-LOCAL): six
 * UTC-derived business dates that are wrong around local midnight,
 * each fixed to the tenant-local day. Every case drives the real
 * production code with an instant where the UTC day and the Cairo day
 * DIFFER (00:00-02:00 Cairo), and FAILS on the unfixed code:
 *
 * - F1 fmcg-promotions: the engine's reference day (Date branch and
 *   no-argument default) was the UTC day, and the live caller passed
 *   no referenceDate at all. At 00:30 Cairo a promo starting today
 *   was skipped and one that ended yesterday still applied.
 * - F2 van pushRepShortagesToPayroll: the default targetMonth was the
 *   UTC month, so a push on the 1st of a month at 00:30 Cairo landed
 *   the shortage in the PREVIOUS month's payroll run.
 * - F3 supplier-payment-schedules: addDays mixed host-local setDate
 *   with a UTC slice (wrong across a DST transition), and
 *   formatIsoDate sliced pg DATE values (local-midnight Dates) to
 *   the UTC day -- the previous day on a Cairo host.
 * - F4 reports daily rollup: the compute-day default was the UTC day
 *   AND the aggregation window was the UTC day, so a no-date rollup
 *   at 01:00 Cairo was stored under the wrong day with the wrong
 *   sales (the UTC window of the Cairo day is mostly in the future).
 * - F5 ar-dunning: the due-date display was a UTC slice while the
 *   sibling createdAt line was already tenant-local.
 * - F6 subscription calculateNextBillingDate: a stored DATE value
 *   (pg local-midnight Date) was sliced to the UTC day, so the next
 *   billing date advanced from the previous day.
 *
 * TIMEZONE CONTROL: the VM and CI run UTC, where the UTC day and the
 * local day coincide and the bug is invisible. This spec sets
 * process.env.TZ itself (runtime assignment takes effect in this
 * Node -- proven) and patches the global Date only around the calls
 * that read "now", so the RED proof is deterministic on any host.
 * Expected date strings are built from local calendar parts, never
 * from UTC toISOString() after local-midnight setHours.
 */

process.env.TZ = 'Africa/Cairo';
process.env.BUSINESS_TIMEZONE = 'Africa/Cairo';

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { types as pgTypes } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { evaluateFmcgCartPromotions } from '../../src/modules/delivery-reps/fmcg-promotions.engine';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';
import { ReportsController } from '../../src/modules/reports/reports.controller';
import { DailyCommercialRollupService } from '../../src/modules/reports/services/daily-commercial-rollup.service';
import { allocateCustomerOverdueFifo } from '../../src/modules/accounting/engines/ar-dunning.engine';
import { calculateNextBillingDate } from '../../src/modules/sales/engines/subscription-billing.engine';

// 00:30 Cairo on 2026-11-14 == 22:30 UTC on 2026-11-13: UTC day and
// Cairo day differ. The month-boundary twin is 00:30 Cairo on
// 2026-11-01 == 22:30 UTC on 2026-10-31.
const CAIRO_HALF_PAST_MIDNIGHT = '2026-11-13T22:30:00.000Z';
const CAIRO_MONTH_START = '2026-10-31T22:30:00.000Z';

// A date-only column reads back as a Date at midnight UTC under
// PGlite; the stored calendar date is its UTC parts (m2 convention).
const dateKey = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

// Patch the global Date so `new Date()` (no args) returns the fixed
// instant, while constructed Dates behave normally. Restored by the
// returned function; the patch is held only around the single call
// under test. (A subclass + super(...spread) cannot satisfy TS2556
// for the Date overloads, so the patch is a delegating function built
// on Reflect.construct.)
const RealDate = Date;
function installFixedDate(iso: string): () => void {
  const fixed = new RealDate(iso).getTime();
  const FixedDate: any = function (this: unknown, ...args: any[]) {
    return Reflect.construct(RealDate, args.length === 0 ? [fixed] : args, FixedDate);
  };
  Object.setPrototypeOf(FixedDate, RealDate);
  FixedDate.prototype = Object.create(RealDate.prototype);
  FixedDate.prototype.constructor = FixedDate;
  FixedDate.now = () => fixed;
  (globalThis as any).Date = FixedDate;
  return () => {
    (globalThis as any).Date = RealDate;
  };
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, employee_id bigint, national_id text, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, display_name text, national_id text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, hire_date date, end_of_service_date date, has_social_insurance boolean, insurance_salary numeric, has_income_tax boolean, pay_frequency text, user_id bigint, commission_type text, commission_value numeric, commission_target numeric, delay_policy text, approved_leave_days numeric);
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, payroll_run_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE hr_employee_adjustments (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, run_id bigint, item_id bigint, status text, applied_in_run_id bigint, amount numeric, date date, adjustment_type text, amount_type text, accounting_category text, reason text, source_type text, source_id text, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, account_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, updated_at timestamptz);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz, branch_id bigint,
        total numeric, payment_type text, payment_channel text, subtotal numeric, discount numeric, service_charge numeric,
        tax_amount numeric, tax_rate numeric, prices_include_tax boolean);
      CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, qty numeric, cost_price numeric);
      CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, amount numeric, expense_date timestamptz);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, account_id text, return_type text, invoice_id bigint, total numeric DEFAULT 0, created_at timestamptz DEFAULT NOW(), branch_id bigint);
      CREATE TABLE return_items (id bigint PRIMARY KEY, return_document_id bigint, tenant_id text, account_id text, qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, sale_item_id bigint);
    CREATE TABLE daily_commercial_rollups (tenant_id text, rollup_date date, branch_id bigint, branch_key bigint,
        sales_count bigint, sales_total numeric, cash_sales_total numeric, credit_sales_total numeric, cogs_total numeric,
        gross_profit numeric, returns_count bigint, returns_total numeric, expenses_total numeric, net_profit numeric, updated_at timestamptz,
        UNIQUE (tenant_id, rollup_date, branch_key));
      INSERT INTO settings VALUES ('t1','currency','EGP'),('t1-rollup','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1-rollup','EGP',true,1);
    `);

    // ---- F1. FMCG promotion window: the reference day is Cairo ----
    {
      const promo = {
        id: 1,
        name: 'Mix 10%',
        code: 'MIX10',
        promoType: 'mix_and_match',
        applyType: 'discount_percent',
        buyConditions: [{ productId: 1, minQty: 1 }],
        reward: { discountPercent: 10 },
        startDate: '2026-11-14',
        endDate: '2026-11-14',
        isActive: true,
      };
      const cart = [{ productId: 1, qty: 2, unitPrice: 100 }];
      // (a) A Date reference at 00:30 Cairo Nov 14: the UTC day is Nov 13.
      const byDate = evaluateFmcgCartPromotions({
        cartItems: cart,
        activePromotions: [promo as never],
        referenceDate: new Date(CAIRO_HALF_PAST_MIDNIGHT),
      });
      assert.equal(
        byDate.appliedPromotions.length,
        1,
        'F1(a): one-day promo starting today (Cairo) applies for a Date reference at 00:30 Cairo',
      );
      assert.equal(byDate.totalPromotionalDiscount, 20, 'F1(a): discount is 10% of the 200 subtotal');
      // (b) No referenceDate at all ("now" is 00:30 Cairo Nov 14).
      const restore = installFixedDate(CAIRO_HALF_PAST_MIDNIGHT);
      try {
        const byDefault = evaluateFmcgCartPromotions({ cartItems: cart, activePromotions: [promo as never] });
        assert.equal(
          byDefault.appliedPromotions.length,
          1,
          'F1(b): one-day promo starting today (Cairo) applies for the no-argument default at 00:30 Cairo',
        );
        assert.equal(byDefault.totalPromotionalDiscount, 20, 'F1(b): discount is 10% of the 200 subtotal');
      } finally {
        restore();
      }
      // (c) String reference still drives the window (U5 pin, regression guard).
      const byString = evaluateFmcgCartPromotions({
        cartItems: cart,
        activePromotions: [{ ...promo, startDate: '2026-11-01', endDate: '2026-11-30' } as never],
        referenceDate: '2026-11-08',
      });
      assert.equal(byString.appliedPromotions.length, 1, 'F1(c): string reference inside the window still applies');
      console.log(
        '✓ F1 Passed: FMCG reference day is the tenant-local day (Date branch, default branch, string guard)',
      );
    }

    // ---- F2. Van shortage push: the default target month is Cairo ----
    {
      const TENANT = 't1';
      const ACCOUNT = 'a1';
      await (db as any)
        .insertInto('hr_employees')
        .values({
          id: 21,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          display_name: 'Rep Emp',
          national_id: null,
          status: 'active',
          compensation_type: 'monthly',
          hourly_rate: 0,
          expected_daily_hours: 8,
          hire_date: '2026-01-01',
          end_of_service_date: null,
          has_social_insurance: false,
          insurance_salary: 0,
          has_income_tax: false,
          pay_frequency: 'monthly',
          user_id: null,
          commission_type: null,
          commission_value: 0,
          commission_target: null,
          delay_policy: null,
          approved_leave_days: 0,
        })
        .execute();
      await (db as any)
        .insertInto('delivery_representatives')
        .values({
          id: 11,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          name: 'Rep Emp',
          phone: null,
          vehicle_plate: null,
          van_location_id: 10,
          employee_id: 21,
          national_id: null,
        })
        .execute();
      await (db as any)
        .insertInto('van_rep_financial_settlements')
        .values({
          id: 401,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          rep_id: 11,
          trip_id: 11,
          entry_type: 'cash_shortage',
          amount: 100,
          status: 'pending',
          notes: 'shortage',
        })
        .execute();
      await (db as any)
        .insertInto('hr_payroll_runs')
        .values({
          id: 501,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          period_month: '2026-11',
          start_date: '2026-11-01',
          end_date: '2026-11-30',
          pay_frequency: 'monthly',
          status: 'draft',
        })
        .execute();
      const adminAuth: any = {
        userId: 1,
        sessionId: 'spec',
        username: 'admin',
        role: 'admin',
        permissions: ['deliveryReps', 'accounting'],
        tenantId: TENANT,
        accountId: ACCOUNT,
      };
      const service: any = Object.create(VanSalesService.prototype);
      service.db = db;
      // "Now" is 00:30 Cairo on 2026-11-01: the UTC month is still 2026-10.
      const restore = installFixedDate(CAIRO_MONTH_START);
      let pushed: any;
      try {
        pushed = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [401] }, adminAuth);
      } finally {
        restore();
      }
      assert.equal(pushed.targetMonth, '2026-11', 'F2: default targetMonth is the Cairo month, not the UTC month');
      assert.equal(pushed.effectiveMonth, '2026-11', 'F2: effective month follows the Cairo default');
      assert.equal(pushed.effectiveRunId, 501, 'F2: the November run is the effective run');
      const adjustments = await (db as any).selectFrom('hr_employee_adjustments').selectAll().execute();
      assert.equal(adjustments.length, 1, 'F2: exactly one payroll adjustment is written');
      assert.equal(
        dateKey(adjustments[0].date),
        '2026-11-01',
        'F2: the adjustment is dated inside the November run period',
      );
      const row = await (db as any)
        .selectFrom('van_rep_financial_settlements')
        .selectAll()
        .where('id', '=', 401)
        .executeTakeFirst();
      assert.ok(String(row.notes).includes('شهر 2026-11'), 'F2: the settlement note records the November run');
      console.log('✓ F2 Passed: van shortage push defaults to the tenant-local month');
    }

    // ---- F3. Supplier schedules: UTC-safe day math + DATE rendering ----
    {
      const svc: any = Object.create(SupplierPaymentSchedulesService.prototype);
      // (a) addDays across a DST transition, Berlin host: the old
      // host-local setDate returned 2026-03-29 for +2d from 2026-03-28.
      process.env.TZ = 'Europe/Berlin';
      assert.equal(
        svc.addDays(svc.parseDate('2026-03-28'), 2),
        '2026-03-30',
        'F3(a): addDays crosses the spring-forward transition without losing a day',
      );
      assert.equal(
        svc.addDays(svc.parseDate('2026-11-14'), 30),
        '2026-12-14',
        'F3(a): addDays ordinary case is unchanged',
      );
      process.env.TZ = 'Africa/Cairo';
      // (b) formatIsoDate on a pg DATE value: node-postgres returns a
      // stored DATE as a local-midnight Date, so on a Cairo host the
      // stored 2026-11-14 arrives as 2026-11-13T22:00Z.
      const stored = pgTypes.getTypeParser(1082)('2026-11-14');
      assert.equal(
        stored.toISOString(),
        '2026-11-13T22:00:00.000Z',
        'F3(b): harness check -- pg parses the stored DATE as local midnight on a Cairo host',
      );
      assert.equal(
        svc.formatIsoDate(stored),
        '2026-11-14',
        'F3(b): formatIsoDate renders the stored calendar day, not the UTC day',
      );
      assert.equal(svc.formatIsoDate('2026-11-14'), '2026-11-14', 'F3(b): string passthrough is unchanged');
      assert.equal(svc.formatIsoDate(null), '', 'F3(b): empty input stays empty');
      console.log('✓ F3 Passed: supplier schedule day math is UTC-safe and DATE values render as stored');
    }

    // ---- F4. Daily rollup: no-date default AND window are Cairo ----
    {
      const TENANT = 't1-rollup';
      await pg.exec(`
        INSERT INTO sales VALUES (1,'${TENANT}','posted','2026-11-13 22:30:00+00',NULL,100,'cash','cash',100,0,0,0,0,false);
        INSERT INTO sale_items VALUES (1,'${TENANT}',1,1,10);
        INSERT INTO sales VALUES (2,'${TENANT}','posted','2026-11-14 23:30:00+00',NULL,50,'cash','cash',50,0,0,0,0,false);
        INSERT INTO sale_items VALUES (2,'${TENANT}',2,1,10);
        INSERT INTO expenses VALUES (1,'${TENANT}',NULL,5,'2026-11-13 22:30:00+00');
      `);
      const rollup = new DailyCommercialRollupService(db);
      const controller = new ReportsController({} as any, {} as any, rollup);
      const req: any = { authContext: { tenantId: TENANT, accountId: 'a1', userId: 1, role: 'admin' } };
      // Sale 1 is 00:30 Cairo Nov 14 (22:30 UTC Nov 13); sale 2 is 01:30
      // Cairo Nov 15 (23:30 UTC Nov 14). The Cairo Nov 14 day holds
      // sale 1 only; the UTC Nov 14 day holds sale 2 only.
      const restore = installFixedDate(CAIRO_HALF_PAST_MIDNIGHT);
      let summary: any;
      try {
        summary = await controller.computeDayRollup(undefined as any, undefined as any, req);
      } finally {
        restore();
      }
      assert.equal(
        summary.rollupDate,
        '2026-11-14',
        'F4(a): no-date rollup is stored under the Cairo day, not the UTC day',
      );
      assert.equal(summary.salesCount, 1, 'F4(a): the Cairo day counts exactly one sale');
      assert.equal(summary.salesTotal, 100, 'F4(a): the Cairo day totals sale 1 only');
      assert.equal(summary.cogsTotal, 10, 'F4(a): COGS follows the Cairo window');
      assert.equal(summary.expensesTotal, 5, 'F4(a): expenses follow the Cairo window');
      // (b) An explicit date aggregates the tenant-local day, not the UTC day.
      const explicit = await controller.computeDayRollup('2026-11-14', undefined as any, req);
      assert.equal(explicit.rollupDate, '2026-11-14', 'F4(b): explicit date keeps its key');
      assert.equal(explicit.salesTotal, 100, 'F4(b): the explicit Cairo day totals sale 1, not sale 2 (UTC day)');
      const stored = await (db as any)
        .selectFrom('daily_commercial_rollups')
        .selectAll()
        .where('tenant_id', '=', TENANT)
        .executeTakeFirst();
      assert.equal(dateKey(stored.rollup_date), '2026-11-14', 'F4(b): the stored rollup row is keyed by the Cairo day');
      console.log('✓ F4 Passed: daily rollup default and window are the tenant-local day');
    }

    // ---- F5. AR dunning: the due-date display is the business day ----
    {
      const asOf = new Date('2026-11-20T12:00:00Z');
      const invoice = {
        id: 1,
        invoiceNumber: 'INV-1',
        // 01:30 Cairo Nov 14 == 23:30 UTC Nov 13: the UTC day is Nov 13.
        createdAt: '2026-11-13T23:30:00.000Z',
        total: 100,
        paidAmount: 0,
      };
      const result = allocateCustomerOverdueFifo(100, [invoice], asOf, 0, 2);
      assert.equal(result.overdueInvoices.length, 1, 'F5: the unpaid invoice is overdue');
      assert.equal(
        result.overdueInvoices[0].createdAt,
        '2026-11-14',
        'F5: createdAt stays the Cairo day (sibling pin)',
      );
      assert.equal(result.overdueInvoices[0].dueDate, '2026-11-14', 'F5: dueDate is the Cairo day, not the UTC day');
      assert.equal(result.overdueInvoices[0].daysOverdue, 6, 'F5: the day-count math is unchanged by the display fix');
      console.log('✓ F5 Passed: AR dunning due date is the business-timezone day');
    }

    // ---- F6. Subscription: next billing date advances from the stored day ----
    {
      const stored = pgTypes.getTypeParser(1082)('2026-11-14');
      assert.equal(
        stored.toISOString(),
        '2026-11-13T22:00:00.000Z',
        'F6: harness check -- pg parses the stored DATE as local midnight on a Cairo host',
      );
      assert.equal(
        calculateNextBillingDate(stored, 'monthly'),
        '2026-12-14',
        'F6: next billing date advances from the stored day, not the UTC day',
      );
      assert.equal(calculateNextBillingDate('2026-01-15', 'monthly'), '2026-02-15', 'F6: string input is unchanged');
      assert.equal(
        calculateNextBillingDate('2026-01-31', 'monthly'),
        '2026-02-28',
        'F6: month-end clamping is unchanged',
      );
      console.log('✓ F6 Passed: next billing date advances from the stored calendar day');
    }

    console.log(
      'category-1a-money-dates.spec: ok (F1 FMCG, F2 van month, F3 supplier days, F4 rollup, F5 dunning, F6 billing)',
    );
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
