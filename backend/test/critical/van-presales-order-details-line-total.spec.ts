import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanPreSalesService } from '../../src/modules/delivery-reps/services/van-pre-sales.service';

/*
 * Van pre-sales order details lineTotal + rep fallback (F18, trial problem 31).
 *
 * THE GAP: the backend details read selected `soi.total` and mapped it
 * as `total`, while the frontend type declares items with `lineTotal`
 * and the details dialog renders `Number(it.lineTotal).toFixed(2)` —
 * `Number(undefined)` is NaN, so every line total showed NaN. The rep
 * name came from `dr.full_name as repName` with no fallback, so a rep
 * row with NULL full_name rendered blank in the details dialog while
 * the list row falls back to `مندوب #<repId>` (pre-sales-orders-table).
 *
 * THE RULE: the details read returns `lineTotal` alongside `total`
 * (additive — no FE type break) as a real number, and the rep name
 * falls back to `مندوب #<repId>` when full_name is NULL. The details
 * dialog render applies the same fallback. Prospective only.
 *
 * HARNESS: the real VanPreSalesService.getPreSalesOrderDetails on
 * PGlite. Teardown is db.destroy() only.
 *
 * WHAT THIS PINS, driving the REAL getPreSalesOrderDetails:
 * - Case 1: rep with full_name NULL -> items[0].lineTotal is the real
 *   number 125.5 (the exact FE render `Number(lineTotal).toFixed(2)`
 *   gives '125.50', never NaN), `total` still 125.5, repName
 *   'مندوب #9'.
 * - Case 2 (no regression): rep with full_name 'أحمد المندوب' keeps
 *   that name, and lineTotal is still numeric.
 */

async function makeDb(): Promise<{ db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, name text, full_name text, phone text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, branch_id bigint, location_type text, is_active boolean);
    CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, customer_name text, customer_phone text, customer_address text, rep_id bigint, warehouse_location_id bigint, order_source text, payment_terms text, subtotal numeric, discount_amount numeric, total_amount numeric, status text, supervisor_approved_at timestamptz, supervisor_approved_by bigint, supervisor_rejection_reason text, notes text, delivery_date timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sales_order_id bigint, product_id bigint, product_name text, unit_name text, unit_multiplier numeric, quantity numeric, reserved_quantity numeric, delivered_quantity numeric, unit_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, discount numeric, total numeric, created_at timestamptz DEFAULT NOW());
  `);
  return { db };
}

async function seedOrder(db: Kysely<Database>, repId: number, fullName: string | null): Promise<number> {
  await db
    .insertInto('delivery_representatives' as never)
    .values({
      id: repId,
      tenant_id: 't1',
      name: `مندوب ${repId}`,
      full_name: fullName,
      phone: '01000000000',
    } as never)
    .execute();
  await db
    .insertInto('stock_locations' as never)
    .values({
      id: 1,
      tenant_id: 't1',
      account_id: 'a1',
      name: 'المستودع الرئيسي',
      branch_id: null,
      location_type: 'internal_warehouse',
      is_active: true,
    } as never)
    .execute();
  const inserted = (await db
    .insertInto('sales_orders' as never)
    .values({
      tenant_id: 't1',
      account_id: 'a1',
      order_number: 'SO-261122-0002',
      customer_id: null,
      customer_name: 'عميل اختبار',
      customer_phone: null,
      customer_address: null,
      rep_id: repId,
      warehouse_location_id: 1,
      order_source: 'pre_sales_rep',
      payment_terms: 'cash',
      subtotal: 125.5,
      discount_amount: 0,
      total_amount: 125.5,
      status: 'approved',
      supervisor_approved_at: null,
      supervisor_approved_by: null,
      supervisor_rejection_reason: null,
      notes: '',
      delivery_date: null,
    } as never)
    .returning(['id'] as never)
    .executeTakeFirst()) as any;
  const orderId = Number(inserted.id);
  await db
    .insertInto('sales_order_items' as never)
    .values({
      tenant_id: 't1',
      account_id: 'a1',
      sales_order_id: orderId,
      product_id: 1,
      product_name: 'صنف اختبار',
      unit_name: 'قطعة',
      unit_multiplier: 1,
      quantity: 1,
      reserved_quantity: 0,
      delivered_quantity: 0,
      unit_price: 125.5,
      consumer_price: 125.5,
      pricing_tier_type: 'cash',
      unit_offer_savings: 0,
      discount: 0,
      total: 125.5,
    } as never)
    .execute();
  return orderId;
}

async function main(): Promise<void> {
  // Case 1: full_name NULL -> lineTotal is a real number, repName falls back.
  {
    const { db } = await makeDb();
    try {
      const orderId = await seedOrder(db, 9, null);
      const service = new VanPreSalesService(db as any);
      const details = await service.getPreSalesOrderDetails(orderId, 't1');
      assert.equal(details.items.length, 1, 'one item');
      const item = details.items[0] as any;
      assert.equal(typeof item.lineTotal, 'number', 'lineTotal is a number, not undefined');
      assert.ok(Number.isFinite(item.lineTotal), 'lineTotal is finite (never NaN)');
      assert.equal(item.lineTotal, 125.5, 'lineTotal equals the stored total');
      assert.equal(Number(item.lineTotal).toFixed(2), '125.50', 'the FE render expression gives 125.50, not NaN');
      assert.equal(item.total, 125.5, 'total still present alongside lineTotal');
      assert.equal((details as any).repName, 'مندوب #9', 'repName falls back to مندوب #id when full_name is NULL');
      console.log('case 1 passed: lineTotal 125.50 (not NaN), repName مندوب #9');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: full_name present -> the name is kept, lineTotal still numeric.
  {
    const { db } = await makeDb();
    try {
      const orderId = await seedOrder(db, 10, 'أحمد المندوب');
      const service = new VanPreSalesService(db as any);
      const details = await service.getPreSalesOrderDetails(orderId, 't1');
      assert.equal((details as any).repName, 'أحمد المندوب', 'named rep keeps his name');
      assert.equal((details.items[0] as any).lineTotal, 125.5, 'lineTotal numeric for the named rep too');
      console.log('case 2 passed: repName أحمد المندوب kept, lineTotal numeric');
    } finally {
      await db.destroy();
    }
  }

  // 3. This spec is wired into both critical lists, in identical order
  // (349 specs — F18 wired van-presales-consolidate-delivery-rep-alias
  // and van-presales-order-details-line-total; F20 followed it, so this
  // spec is no longer the last entry).
  {
    const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 358);
    assert.equal(chain.length, 358);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/van-presales-order-details-line-total.spec.ts'));
    assert.equal(
      specs[specs.indexOf('test/critical/van-presales-order-details-line-total.spec.ts') + 1],
      'test/critical/van-portal-sale-rep-attribution-f20.spec.ts',
    );
    console.log('3. evidence spec wired into both critical lists (358 = 358, identical order), passed');
  }

  console.log('van-presales-order-details-line-total: all cases passed');
}

main()
  .then(async () => {
    console.log('van-presales-order-details-line-total: all cases passed');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
