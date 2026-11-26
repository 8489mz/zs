/*
 * F13 — Reports: discounted-only filter, per-rep profit, top-products base pieces.
 *
 * THE RULES (trial problems 18, 27, 39):
 * (1) Discounted-only filter: a sale is discounted when its invoice discount
 * is > 0 OR any line carries a line discount > 0 — the ONE shared predicate
 * (discountedSaleSql) already used by listOrders / listDriverSales / the rep
 * lifetime report. The sales-report summary honours it on the sales side
 * (count, total, discounts, COGS, top products) and counts only sale returns
 * of discounted invoices, so netSales stays internally consistent.
 * (2) Staff Report per-user profit: salesProfit = (salesTotal - returnsTotal)
 * - (raw COGS - returned COGS), COGS from sale_items.qty x cost_price, the
 * same shape as the summary helper. Trial-shaped numbers below.
 * (3) Top products count BASE pieces, not sold units: a 1-carton sale with
 * unit_multiplier 12 is 12 pieces (stock moves in base pieces; revenue
 * already reflects 12 pieces, so qty 1 next to revenue 288.00 was the
 * trial's problem 39). Piece sales (multiplier 1) are unchanged.
 * (4) Rep targets VERIFY-ONLY (no rebuild): month actuals sum posted sales
 * by delivery_rep_id, so a POS sale stamped with delivery_rep_id by the F7
 * attribution fix counts toward the rep's target.
 *
 * HARNESS: the real ReportsService + ReportsAdminService (employeeSummary)
 * + VanTargetsService on PGlite, one fresh DB per pin. Tear down is
 * db.destroy() only.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { buildReportSummaryPayload } from '../../src/modules/reports/helpers/reports-summary.helper';
import { VanTargetsService } from '../../src/modules/delivery-reps/services/van-targets.service';

const TENANT = 't-f13-reports';
const ACCOUNT = 'a-f13-reports';
const DAY = '2026-11-21';
const FROM = '2026-11-21T00:00:00+02:00';
const TO = '2026-11-21T23:59:59+02:00';

const AUTH = {
  userId: 2,
  sessionId: 'spec',
  username: 'sup',
  role: 'admin',
  permissions: ['reports', 'deliveryReps', 'sales'],
  tenantId: TENANT,
  accountId: ACCOUNT,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true, display_name text, last_login_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, stock_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, is_active boolean DEFAULT true, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, is_active boolean DEFAULT true, rep_type text, permissions jsonb, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_rep_targets (id bigserial PRIMARY KEY, tenant_id text, rep_id bigint, period_month text, target_amount numeric DEFAULT 0, collection_target numeric, visits_target numeric);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, shift_name text, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, business_day date, opened_at timestamptz, closed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_store_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, check_in_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE hr_holidays (id bigserial PRIMARY KEY, tenant_id text, start_date date, end_date date);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, status text, payment_type text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, note text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric DEFAULT 0, allocated_tax numeric DEFAULT 0, cost_price numeric, consumer_price numeric, pricing_tier_type text, price_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric DEFAULT 1, is_bonus boolean DEFAULT false, bonus_reason text, serials jsonb, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_type text, invoice_id bigint, doc_no text, total numeric DEFAULT 0, total_amount numeric DEFAULT 0, settlement_mode text, refund_method text, status text, created_by bigint, note text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint, sale_item_id bigint, product_id bigint, product_name text, qty numeric DEFAULT 0, unit_total numeric DEFAULT 0, line_total numeric DEFAULT 0, allocated_tax numeric DEFAULT 0, cost_price numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE purchases (id bigserial PRIMARY KEY, tenant_id text, account_id text, total numeric DEFAULT 0, status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, account_id text, amount numeric DEFAULT 0, is_active boolean DEFAULT true, branch_id bigint, location_id bigint, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, amount numeric DEFAULT 0, title text, note text, branch_id bigint, location_id bigint, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric DEFAULT 0, request_key text, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, action text, event_code text, idempotency_key text, details text, target_tenant_id text, created_by bigint, impersonated_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, opening_cash numeric DEFAULT 0, opening_note text, status text, terminal_code text, expected_cash numeric, counted_cash numeric, variance numeric, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb
    .insertInto('settings')
    .values([
      { tenant_id: TENANT, key: 'currency', value: 'EGP' },
      { tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' },
    ])
    .execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values([
      { id: 2, tenant_id: TENANT, username: 'sup', role: 'admin', display_name: 'Admin', is_active: true },
      { id: 3, tenant_id: TENANT, username: 'cashier', role: 'cashier', display_name: 'Cashier', is_active: true },
      {
        id: 11,
        tenant_id: TENANT,
        username: 'vanrep1',
        role: 'cashier',
        display_name: 'مندوب تجربة 1',
        is_active: true,
      },
    ])
    .execute();
  await anyDb
    .insertInto('products')
    .values([
      {
        id: 100,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'صنف اختبار جمله ب',
        cost_price: 15,
        retail_price: 50,
        is_active: true,
      },
      {
        id: 101,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'صنف اختبار جمله ج',
        cost_price: 5,
        retail_price: 35,
        is_active: true,
      },
    ])
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values([
      {
        id: 1,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'مندوب تجربة 1',
        phone: null,
        van_location_id: null,
        is_van_rep: true,
        is_active: true,
        rep_type: 'van_sales',
      },
      {
        id: 2,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'مندوب تجربة 2',
        phone: null,
        van_location_id: null,
        is_van_rep: true,
        is_active: true,
        rep_type: 'van_sales',
      },
    ])
    .execute();
  await anyDb
    .insertInto('delivery_rep_targets')
    .values({
      tenant_id: TENANT,
      rep_id: 1,
      period_month: '2026-11',
      target_amount: 1000,
      collection_target: null,
      visits_target: null,
    })
    .execute();
  const at = (h: string) => `${DAY}T${h}+02:00`;
  // S1 full-price (rep NULL) · S2 invoice discount (rep 1) · S3 line
  // discount only (rep 1) · S4 one carton of 12 (rep NULL) · S5 other user.
  await anyDb
    .insertInto('sales')
    .values([
      {
        id: 101,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        doc_no: 'S-101',
        total: 100,
        subtotal: 100,
        discount: 0,
        tax_amount: 0,
        status: 'posted',
        created_by: 11,
        delivery_rep_id: null,
        created_at: at('10:00:00'),
      },
      {
        id: 102,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        doc_no: 'S-102',
        total: 180,
        subtotal: 200,
        discount: 20,
        tax_amount: 0,
        status: 'posted',
        created_by: 11,
        delivery_rep_id: 1,
        created_at: at('11:00:00'),
      },
      {
        id: 103,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        doc_no: 'S-103',
        total: 90,
        subtotal: 105,
        discount: 0,
        tax_amount: 0,
        status: 'posted',
        created_by: 11,
        delivery_rep_id: 1,
        created_at: at('12:00:00'),
      },
      {
        id: 104,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        doc_no: 'S-104',
        total: 288,
        subtotal: 288,
        discount: 0,
        tax_amount: 0,
        status: 'posted',
        created_by: 11,
        delivery_rep_id: null,
        created_at: at('13:00:00'),
      },
      {
        id: 105,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        doc_no: 'S-105',
        total: 50,
        subtotal: 50,
        discount: 0,
        tax_amount: 0,
        status: 'posted',
        created_by: 3,
        delivery_rep_id: null,
        created_at: at('14:00:00'),
      },
    ])
    .execute();
  await anyDb
    .insertInto('sale_items')
    .values([
      {
        id: 1001,
        sale_id: 101,
        product_id: 100,
        product_name: 'صنف اختبار جمله ب',
        qty: 2,
        unit_price: 50,
        line_total: 100,
        line_discount: 0,
        cost_price: 15,
        unit_multiplier: 1,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      },
      {
        id: 1002,
        sale_id: 102,
        product_id: 100,
        product_name: 'صنف اختبار جمله ب',
        qty: 4,
        unit_price: 50,
        line_total: 180,
        line_discount: 0,
        cost_price: 15,
        unit_multiplier: 1,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      },
      {
        id: 1003,
        sale_id: 103,
        product_id: 101,
        product_name: 'صنف اختبار جمله ج',
        qty: 3,
        unit_price: 35,
        line_total: 90,
        line_discount: 15,
        cost_price: 5,
        unit_multiplier: 1,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      },
      {
        id: 1004,
        sale_id: 104,
        product_id: 100,
        product_name: 'صنف اختبار جمله ب',
        qty: 1,
        unit_price: 288,
        line_total: 288,
        line_discount: 0,
        cost_price: 180,
        unit_multiplier: 12,
        unit_name: 'كرتونة',
        tenant_id: TENANT,
        account_id: ACCOUNT,
      },
      {
        id: 1005,
        sale_id: 105,
        product_id: 101,
        product_name: 'صنف اختبار جمله ج',
        qty: 1,
        unit_price: 50,
        line_total: 50,
        line_discount: 0,
        cost_price: 5,
        unit_multiplier: 1,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      },
    ])
    .execute();
  // R1 returns 1 pc of the DISCOUNTED sale S2 · R2 returns 1 pc of the
  // full-price sale S1.
  await anyDb
    .insertInto('return_documents')
    .values([
      {
        id: 201,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        return_type: 'sale',
        invoice_id: 102,
        doc_no: 'R-201',
        total: 45,
        created_by: 11,
        created_at: at('15:00:00'),
      },
      {
        id: 202,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        return_type: 'sale',
        invoice_id: 101,
        doc_no: 'R-202',
        total: 50,
        created_by: 11,
        created_at: at('16:00:00'),
      },
    ])
    .execute();
  await anyDb
    .insertInto('return_items')
    .values([
      {
        id: 2001,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        return_document_id: 201,
        sale_item_id: 1002,
        product_id: 100,
        product_name: 'صنف اختبار جمله ب',
        qty: 1,
        line_total: 45,
        allocated_tax: 0,
        cost_price: null,
      },
      {
        id: 2002,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        return_document_id: 202,
        sale_item_id: 1001,
        product_id: 100,
        product_name: 'صنف اختبار جمله ب',
        qty: 1,
        line_total: 50,
        allocated_tax: 0,
        cost_price: null,
      },
    ])
    .execute();
}

function buildReports(db: Kysely<Database>): ReportsService {
  return new ReportsService(db as never);
}

async function main(): Promise<void> {
  // 1. Discounted-only: invoice discount (S2) + line discount only (S3)
  // in, full-price sales (S1, S4, S5) out.
  {
    const { pg, db } = await makeDb();
    try {
      await seed(db);
      const service = buildReports(db);
      const summary = (await service.reportSummary(
        { from: FROM, to: TO, discountedOnly: true } as never,
        AUTH as never,
      )) as any;
      assert.equal(summary.sales.count, 2);
      assert.equal(summary.sales.total, 270);
      assert.equal(summary.returns.discountsTotal, 20);
      console.log('1. discounted-only filter keeps invoice + line discounts, drops full-price, passed');
    } finally {
      await db.destroy();
    }
  }

  // 2. Discounted-only returns + COGS + top products stay consistent:
  // only R1 (discounted invoice) counts; R2 (full-price invoice) drops.
  {
    const { pg, db } = await makeDb();
    try {
      await seed(db);
      const service = buildReports(db);
      const summary = (await service.reportSummary(
        { from: FROM, to: TO, discountedOnly: true } as never,
        AUTH as never,
      )) as any;
      assert.equal(summary.returns.salesTotal, 45);
      assert.equal(summary.returns.total, 65);
      assert.equal(summary.sales.netSales, 225);
      assert.equal(summary.commercial.cogs, 60);
      assert.equal(summary.commercial.grossProfit, 165);
      const top = summary.topProducts as Array<{ name: string; qty: number; revenue: number }>;
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ب')?.qty, 4);
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ب')?.revenue, 180);
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ج')?.qty, 3);
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ج')?.revenue, 90);
      console.log('2. discounted-only returns/COGS/top-products consistent, passed');
    } finally {
      await db.destroy();
    }
  }

  // 3. Top products count base pieces (problem 39): the 1-carton sale
  // (qty 1 x multiplier 12) is 12 pieces, so product B totals 2 + 4 + 12.
  // Unfiltered revenue/COGS/gross profit reconcile at the same time.
  {
    const { pg, db } = await makeDb();
    try {
      await seed(db);
      const service = buildReports(db);
      const summary = (await service.reportSummary({ from: FROM, to: TO } as never, AUTH as never)) as any;
      assert.equal(summary.sales.count, 5);
      assert.equal(summary.sales.total, 708);
      assert.equal(summary.returns.salesTotal, 95);
      assert.equal(summary.commercial.cogs, 260);
      assert.equal(summary.commercial.grossProfit, 353);
      const top = summary.topProducts as Array<{ name: string; qty: number; revenue: number }>;
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ب')?.qty, 18);
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ب')?.revenue, 568);
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ج')?.qty, 4);
      assert.equal(top.find((r) => r.name === 'صنف اختبار جمله ج')?.revenue, 140);
      console.log('3. top products count base pieces (carton 1x12 = 12), passed');
    } finally {
      await db.destroy();
    }
  }

  // 4. Row path (buildTopProducts): a carton row counts its base pieces,
  // a row without a multiplier counts as pieces (multiplier defaults 1).
  {
    const payload = buildReportSummaryPayload({
      saleItemsRows: [
        { product_name: 'صنف اختبار جمله ب', qty: 1, line_total: 288, cost_price: 180, unit_multiplier: 12 },
        { product_name: 'صنف اختبار جمله ب', qty: 2, line_total: 100, cost_price: 15 },
      ],
    });
    assert.equal(payload.topProducts[0]?.qty, 14);
    assert.equal(payload.topProducts[0]?.revenue, 388);
    console.log('4. row-path top products count base pieces, passed');
  }

  // 5. Staff Report per-user profit (problem 18): user 11 sold 658.00,
  // returned 95.00, net COGS 255.00 (285 - 30 returned) -> profit 308.00;
  // user 3 sold 50.00 with COGS 5.00 -> profit 45.00; the summary profit
  // 353.00 reconciles with the sales-report gross profit.
  {
    const { pg, db } = await makeDb();
    try {
      await seed(db);
      const service = buildReports(db);
      const staff = (await service.employeeSummary({ from: FROM, to: TO } as never, AUTH as never)) as any;
      const rep = (staff.rows as Array<Record<string, unknown>>).find((r) => r.username === 'vanrep1');
      assert.ok(rep, 'vanrep1 row present');
      assert.equal(rep.salesCount, 4);
      assert.equal(rep.salesTotal, 658);
      assert.equal(rep.returnsCount, 2);
      assert.equal(rep.returnsTotal, 95);
      assert.equal(rep.salesCogs, 255);
      assert.equal(rep.salesProfit, 308);
      const cashier = (staff.rows as Array<Record<string, unknown>>).find((r) => r.username === 'cashier');
      assert.ok(cashier, 'cashier row present');
      assert.equal(cashier.salesCount, 1);
      assert.equal(cashier.salesTotal, 50);
      assert.equal(cashier.salesCogs, 5);
      assert.equal(cashier.salesProfit, 45);
      assert.equal(staff.summary.totalSales, 708);
      assert.equal(staff.summary.totalSalesCogs, 260);
      assert.equal(staff.summary.totalSalesProfit, 353);
      console.log('5. employeeSummary per-user profit (308.00 / 45.00), passed');
    } finally {
      await db.destroy();
    }
  }

  // 6. Rep targets VERIFY-ONLY (problem 18): the month actuals sum posted
  // sales by delivery_rep_id — the POS sale stamped with the rep by the F7
  // attribution fix (S2 180 + S3 90) counts; the rep-NULL sales do not.
  // Target 1000 -> actual 270 -> achievement 27.
  {
    const { pg, db } = await makeDb();
    try {
      await seed(db);
      const targets = new VanTargetsService(db as never);
      const rows = await targets.listAllRepTargets(TENANT, '2026-11');
      const rep1 = (rows as Array<Record<string, unknown>>).find((r) => r.repId === 1);
      assert.ok(rep1, 'rep 1 row present');
      assert.equal(rep1.targetAmount, 1000);
      assert.equal(rep1.actualSales, 270);
      assert.equal(rep1.achievementRate, 27);
      const rep2 = (rows as Array<Record<string, unknown>>).find((r) => r.repId === 2);
      assert.ok(rep2, 'rep 2 row present');
      assert.equal(rep2.actualSales, 0);
      assert.equal(rep2.achievementRate, 0);
      console.log('6. rep-target actuals include the F7-stamped POS sales, passed');
    } finally {
      await db.destroy();
    }
  }

  // 7. This spec is wired into both critical lists, in identical order
  // (349 specs — F13 wired reports-discount-profit; F18 followed it
  // with the two van-presales specs and F20 followed them, so it is no longer the last entry).
  {
    const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 377);
    assert.equal(chain.length, 377);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/reports-discount-profit.spec.ts'));
    const idx = specs.indexOf('test/critical/reports-discount-profit.spec.ts');
    assert.equal(specs[idx + 1], 'test/critical/van-presales-consolidate-delivery-rep-alias.spec.ts');
    assert.equal(specs[idx + 2], 'test/critical/van-presales-order-details-line-total.spec.ts');
    console.log('7. evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('reports-discount-profit: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
