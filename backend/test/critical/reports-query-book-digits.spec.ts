import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { summarizeSales } from '../../src/modules/sales/helpers/sales-query.helper';
import { summarizePurchases } from '../../src/modules/purchases/helpers/purchases-query.helper';
import { ReportsSummaryService } from '../../src/modules/reports/services/reports-summary.service';
import { buildCustomerRfmPayload } from '../../src/modules/reports/helpers/reports-summary.helper';
import { buildFoodCostVarianceReport } from '../../src/modules/reports/helpers/reports-food-waste.helper';
import { buildDynamicPivotMatrix } from '../../src/modules/reports/engines/pivot-aggregation.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Report/query money totals at book digits (U2-D5).
 *
 * THE GAP: sales/purchase list summaries, the RFM report, the dead-stock
 * report, the food-cost variance report and the dynamic pivot engine all
 * shaped money totals with a hardcoded Number(n.toFixed(2)). For a
 * three-decimal tenant (KWD) a 100.125 total came back as 100.13 in every
 * one of those surfaces, while the posting boundary keeps 100.125 — so
 * the reports disagreed with the ledger by design.
 *
 * THE RULE: money totals round at book digits with the canonical
 * roundMoney(amount, digits). Digits resolve once per service method
 * from tenantBaseCurrency (fail-closed on a base-currency/rate
 * mismatch) and are passed down to the pure helpers, which keep a
 * default of 2 so pre-existing callers are unchanged. Quantities,
 * rates and percentages keep their legacy shaping (see the source
 * pin below); display-only formatted strings are untouched.
 *
 * FLOAT ORDER: roundMoney rounds the binary float product, so the
 * cases below use exact-binary examples (33.375, 66.75, 100.125) and
 * pin identity with the canonical engine. 2dp identity is pinned on
 * the same exact-binary values, where roundMoney and the old
 * toFixed(2) agree; inexact-binary half-cents (e.g. 2.675) round by
 * the true decimal value under roundMoney, which is the deliberate
 * canonical behaviour, not a regression.
 *
 * WHAT THIS PINS, driving the REAL services/helpers on PGlite
 * (fresh database per case):
 * - Pure helpers (3dp): summarizeSales / summarizePurchases /
 *   buildCustomerRfmPayload / buildDynamicPivotMatrix keep 100.125.
 * - Pure helpers (2dp): the same inputs return 100.13, identical to
 *   the old toFixed(2) shaping.
 * - listSales end to end (KWD): summary totalSales 100.125,
 *   cashTotal 33.375, creditTotal 66.75.
 * - listSales end to end (EGP): the same seed returns 100.13 /
 *   33.38 / 66.75.
 * - deadStockReport (KWD): tiedCapital 100.125; (EGP): 100.13.
 * - buildFoodCostVarianceReport (KWD): theoreticalCost 100.125;
 *   (EGP): 100.13.
 * - Fail-closed digits: a base-currency/rate mismatch rejects
 *   listSales instead of returning a wrongly-rounded total.
 * - Source pin: the only remaining toFixed(2) lines in the eight
 *   package files are the classified non-money sites (a qty/day
 *   rate, a stock quantity, and the pivot quantity/count branch).
 * This is not an end-to-end post on live Postgres, and it does not
 * drive the HTTP controllers (their wiring is the unchanged
 * controller -> service delegation).
 */

const TENANT = 't1';

const auth = {
  tenantId: TENANT, accountId: 'a1', role: 'admin', userId: 1, permissions: ['sales', 'reports'],
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, loyalty_points numeric DEFAULT 0);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE product_categories (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, barcode text, style_code text, category_id bigint, supplier_id bigint, stock_qty numeric DEFAULT 0, min_stock_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, is_active boolean DEFAULT true);
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, status text, note text, table_number text, order_type text, delivery_rep_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_line_total numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, price_type text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, payment_channel text, amount numeric);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, invoice_id bigint, total numeric, created_at timestamptz, settlement_mode text, refund_method text, return_type text);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint, quantity numeric, unit_name text);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, name text, component_product_id bigint, consumption_qty numeric, unit_name text);
    CREATE TABLE restaurant_food_waste_logs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, quantity numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, qty numeric, movement_type text, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedCurrency(db: Kysely<Database>, code: string): Promise<void> {
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: `"${code}"` }).execute();
  await (db as any).insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: code, exchange_rate: 1, is_base: true }).execute();
}

async function seedSales(db: Kysely<Database>): Promise<void> {
  const now = new Date();
  await (db as any).insertInto('sales').values({
    id: 1, tenant_id: TENANT, doc_no: 'Z-1', customer_id: null, payment_type: 'cash', payment_channel: 'cash',
    subtotal: 33.375, total: 33.375, status: 'posted', branch_id: 1, location_id: 1, created_by: 1, created_at: now,
  }).execute();
  await (db as any).insertInto('sales').values({
    id: 2, tenant_id: TENANT, doc_no: 'Z-2', customer_id: null, payment_type: 'credit', payment_channel: 'credit',
    subtotal: 66.75, total: 66.75, status: 'posted', branch_id: 1, location_id: 1, created_by: 1, created_at: now,
  }).execute();
  await (db as any).insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main' }).execute();
  await (db as any).insertInto('stock_locations').values({ id: 1, tenant_id: TENANT, name: 'Warehouse' }).execute();
  await (db as any).insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin' }).execute();
}

async function main(): Promise<void> {
  // Case 1: pure helpers — 3dp preserves 100.125, 2dp is identical to the old shaping.
  {
    const nowIso = new Date().toISOString();
    const salesRows = [
      { total: 33.375, paymentType: 'cash', status: 'posted', date: nowIso },
      { total: 66.75, paymentType: 'credit', status: 'posted', date: nowIso },
    ];
    const s3 = summarizeSales(salesRows as never, 3);
    assert.equal(s3.totalSales, 100.125);
    assert.equal(s3.todaySalesTotal, 100.125);
    assert.equal(s3.cashTotal, 33.375);
    assert.equal(s3.creditTotal, 66.75);
    const s2 = summarizeSales(salesRows as never, 2);
    assert.equal(s2.totalSales, 100.13);
    assert.equal(s2.cashTotal, 33.38);
    assert.equal(s2.creditTotal, 66.75);
    assert.equal(summarizeSales(salesRows as never).totalSales, 100.13, 'default digits stay 2');

    const purchaseRows = [
      { total: 33.375, paymentType: 'cash' },
      { total: 66.75, paymentType: 'credit' },
    ];
    assert.equal(summarizePurchases(purchaseRows as never, 3).totalAmount, 100.125);
    assert.equal(summarizePurchases(purchaseRows as never, 3).creditTotal, 66.75);
    assert.equal(summarizePurchases(purchaseRows as never, 2).totalAmount, 100.13);
    assert.equal(summarizePurchases(purchaseRows as never).totalAmount, 100.13, 'default digits stay 2');

    const rfm3 = buildCustomerRfmPayload(
      [{ customerId: 1, customerName: 'A', frequency: 2, monetary: 100.125, lastSaleDate: nowIso }],
      undefined, 3,
    );
    assert.equal(rfm3.summary.totalRevenue, 100.125);
    assert.equal(rfm3.summary.averageAov, 50.063);
    assert.equal(rfm3.items[0].monetary, 100.125);
    assert.equal(rfm3.items[0].aov, 50.063);
    const rfm2 = buildCustomerRfmPayload(
      [{ customerId: 1, customerName: 'A', frequency: 2, monetary: 100.125, lastSaleDate: nowIso }],
      undefined, 2,
    );
    assert.equal(rfm2.summary.totalRevenue, 100.13);
    assert.equal(rfm2.summary.averageAov, 50.07);
    assert.equal(rfm2.items[0].monetary, 100.13);

    const pivot3 = buildDynamicPivotMatrix({
      records: [
        { branch: 'B', total_amount: 33.375 },
        { branch: 'B', total_amount: 66.75 },
      ],
      rowDimension: 'branch', metric: 'total_amount', digits: 3,
    });
    assert.equal(pivot3.grandTotal.value, 100.125);
    assert.equal(pivot3.matrix.B.total.value, 100.125);
    const pivot2 = buildDynamicPivotMatrix({
      records: [
        { branch: 'B', total_amount: 33.375 },
        { branch: 'B', total_amount: 66.75 },
      ],
      rowDimension: 'branch', metric: 'total_amount', digits: 2,
    });
    assert.equal(pivot2.grandTotal.value, 100.13);
    const pivotDefault = buildDynamicPivotMatrix({
      records: [{ branch: 'B', total_amount: 100.125 }],
      rowDimension: 'branch', metric: 'total_amount',
    });
    assert.equal(pivotDefault.grandTotal.value, 100.13, 'default digits stay 2');
    // Quantity/count keep the legacy 2dp shaping even at 3dp book digits.
    const pivotQty = buildDynamicPivotMatrix({
      records: [{ branch: 'B', quantity: 100.125 }],
      rowDimension: 'branch', metric: 'quantity', digits: 3,
    });
    assert.equal(pivotQty.grandTotal.value, 100.13);
  }

  // Case 2: listSales end to end (KWD, 3dp) through the real service.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await seedSales(db);
      const query = new SalesQueryService(db as never, new SalesAuthorizationService(db as never));
      const result = await query.listSales({}, auth) as any;
      assert.equal(result.summary.totalSales, 100.125);
      assert.equal(result.summary.cashTotal, 33.375);
      assert.equal(result.summary.creditTotal, 66.75);
      assert.equal(result.sales.length, 2);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: listSales end to end (EGP, 2dp) — identical to the old shaping.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await seedSales(db);
      const query = new SalesQueryService(db as never, new SalesAuthorizationService(db as never));
      const result = await query.listSales({}, auth) as any;
      assert.equal(result.summary.totalSales, 100.13);
      assert.equal(result.summary.cashTotal, 33.38);
      assert.equal(result.summary.creditTotal, 66.75);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: deadStockReport (KWD) through the real service.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      await (db as any).insertInto('products').values({
        id: 7, tenant_id: TENANT, name: 'Widget', stock_qty: 3, min_stock_qty: 0,
        cost_price: 33.375, retail_price: 40, is_active: true,
      }).execute();
      const service = new ReportsSummaryService(db as never);
      const result = await service.deadStockReport({} as never, auth) as any;
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].tiedCapital, 100.125);
      assert.equal(result.summary.totalTiedCapital, 100.125);
      assert.equal(result.summary.totalRetailValue, 120);
      assert.equal(result.summary.totalDeadStockQty, 3);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: deadStockReport (EGP) — identical to the old shaping.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      await (db as any).insertInto('products').values({
        id: 7, tenant_id: TENANT, name: 'Widget', stock_qty: 3, min_stock_qty: 0,
        cost_price: 33.375, retail_price: 40, is_active: true,
      }).execute();
      const service = new ReportsSummaryService(db as never);
      const result = await service.deadStockReport({} as never, auth) as any;
      assert.equal(result.items[0].tiedCapital, 100.13);
      assert.equal(result.summary.totalTiedCapital, 100.13);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: food-cost variance report (KWD) through the real helper.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'KWD');
      const now = new Date();
      await (db as any).insertInto('products').values({
        id: 7, tenant_id: TENANT, name: 'Component', cost_price: 33.375, retail_price: 40, is_active: true,
      }).execute();
      await (db as any).insertInto('sales').values({
        id: 1, tenant_id: TENANT, doc_no: 'Z-1', payment_type: 'cash', total: 100.125, status: 'posted', created_at: now,
      }).execute();
      await (db as any).insertInto('sale_items').values({
        tenant_id: TENANT, sale_id: 1, product_id: 7, product_name: 'Component', qty: 3, unit_price: 33.375, line_total: 100.125,
      }).execute();
      const result = await buildFoodCostVarianceReport(db as never, {} as never, auth) as any;
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].theoreticalCost, 100.125);
      assert.equal(result.items[0].actualCost, 100.125);
      assert.equal(result.items[0].wasteCost, 0);
      assert.equal(result.summary.totalTheoreticalCost, 100.125);
      assert.equal(result.summary.totalActualCost, 100.125);
    } finally {
      await db.destroy();
    }
  }

  // Case 7: food-cost variance report (EGP) — identical to the old shaping.
  {
    const { pg, db } = await makeDb();
    try {
      await seedCurrency(db, 'EGP');
      const now = new Date();
      await (db as any).insertInto('products').values({
        id: 7, tenant_id: TENANT, name: 'Component', cost_price: 33.375, retail_price: 40, is_active: true,
      }).execute();
      await (db as any).insertInto('sales').values({
        id: 1, tenant_id: TENANT, doc_no: 'Z-1', payment_type: 'cash', total: 100.125, status: 'posted', created_at: now,
      }).execute();
      await (db as any).insertInto('sale_items').values({
        tenant_id: TENANT, sale_id: 1, product_id: 7, product_name: 'Component', qty: 3, unit_price: 33.375, line_total: 100.125,
      }).execute();
      const result = await buildFoodCostVarianceReport(db as never, {} as never, auth) as any;
      assert.equal(result.items[0].theoreticalCost, 100.13);
      assert.equal(result.summary.totalTheoreticalCost, 100.13);
    } finally {
      await db.destroy();
    }
  }

  // Case 8: fail-closed digits — base-currency/rate mismatch rejects listSales.
  {
    const { pg, db } = await makeDb();
    try {
      await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: '"KWD"' }).execute();
      await (db as any).insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
      await seedSales(db);
      const query = new SalesQueryService(db as never, new SalesAuthorizationService(db as never));
      await assert.rejects(query.listSales({}, auth));
    } finally {
      await db.destroy();
    }
  }

  // Case 9: source pin — the only remaining toFixed(2) lines in the
  // package files are the classified non-money sites.
  {
    const allowed: Array<[string, string]> = [
      ['reports/services/reports-summary.service.ts', 'dailyBurnRate'],
      ['reports/services/reports-summary.service.ts', 'totalDeadStockQty'],
      ['reports/engines/pivot-aggregation.engine.ts', 'shapeCell'],
    ];
    const files = [
      'sales/helpers/sales-query.helper.ts',
      'purchases/helpers/purchases-query.helper.ts',
      'sales/services/sales-query.service.ts',
      'purchases/services/purchases-query.service.ts',
      'reports/helpers/reports-summary.helper.ts',
      'reports/services/reports-summary.service.ts',
      'reports/helpers/reports-food-waste.helper.ts',
      'reports/engines/pivot-aggregation.engine.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, '../../src/modules', file), 'utf8');
      const lines = source.split('\n').filter((line) => line.includes('toFixed(2)'));
      for (const line of lines) {
        const ok = allowed.some(([f, marker]) => file.endsWith(f) && line.includes(marker));
        assert.ok(ok, `unexpected toFixed(2) site in ${file}: ${line.trim()}`);
      }
      const expected = allowed.filter(([f]) => file.endsWith(f)).length;
      assert.equal(lines.length, expected, `${file}: expected ${expected} toFixed(2) line(s), found ${lines.length}`);
    }
  }

  console.log('reports-query-book-digits: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
