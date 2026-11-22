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
 * Van pre-sales consolidate deliveryRepId alias (F18, trial problem 30).
 *
 * THE GAP: the admin dialog sends `deliveryRepId` (FE
 * van-sales-presales.ts `consolidateAdminPreSalesOrdersToRequisition`
 * posts `{ orderIds, deliveryRepId, notes }` verbatim, and
 * VanPreSalesAdminTab sends `deliveryRepId: Number(consolidateTargetRepId)`),
 * but the backend read only `payload?.targetRepId` — so every
 * consolidate from the dialog threw TARGET_REP_REQUIRED even with a
 * rep selected. The dialog's "توليد إذن تحميل" button feeds the same
 * call (it sets consolidateTargetRepId from the inspected order's
 * repId), so it was broken the same way.
 *
 * THE RULE: the backend accepts `deliveryRepId` as an alias for
 * `targetRepId` (single place, the consolidate service). `targetRepId`
 * keeps working — other callers may use it — and a payload with
 * neither rep still refuses with TARGET_REP_REQUIRED. Prospective only.
 *
 * HARNESS: the real VanPreSalesService on PGlite. Reserved quantities
 * are 0, so the location-stock release is skipped; the order carries
 * warehouse_location_id 1, so the default-warehouse resolver is
 * skipped. Teardown is db.destroy() only.
 *
 * WHAT THIS PINS, driving the REAL consolidatePreSalesOrdersToRequisition:
 * - Case 1: payload `{ orderIds, deliveryRepId: 7 }` consolidates
 *   (no TARGET_REP_REQUIRED) — requisition row rep_id 7, status
 *   'pending', docNo VL-*, source order 'converted'.
 * - Case 2: payload with neither rep field refuses TARGET_REP_REQUIRED.
 * - Case 3 (no regression): `{ orderIds, targetRepId: 7 }` still works.
 * - Case 4: `{ orderIds, deliveryRepId: 999 }` (unknown rep) refuses
 *   REP_NOT_FOUND.
 */

async function makeDb(): Promise<{ db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, name text, full_name text, is_active boolean);
    CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_name text, warehouse_location_id bigint, status text, order_source text, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text, sales_order_id bigint, product_id bigint, product_name text, unit_name text, quantity numeric, reserved_quantity numeric, delivered_quantity numeric, unit_multiplier numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, rep_id bigint, source_warehouse_id bigint, status text, requested_items text, notes text, created_at timestamptz DEFAULT NOW());
  `);
  return { db };
}

async function seedWorld(db: Kysely<Database>): Promise<void> {
  await db.insertInto('delivery_representatives' as never).values({
    id: 7, tenant_id: 't1', name: 'مندوب اختبار', full_name: 'مندوب اختبار', is_active: true,
  } as never).execute();
  await db.insertInto('sales_orders' as never).values({
    id: 100, tenant_id: 't1', account_id: 'a1', order_number: 'SO-261122-0001',
    customer_name: 'عميل اختبار', warehouse_location_id: 1, status: 'approved',
    order_source: 'van_presales', notes: '',
  } as never).execute();
  await db.insertInto('sales_order_items' as never).values({
    tenant_id: 't1', sales_order_id: 100, product_id: 1, product_name: 'صنف اختبار',
    unit_name: 'قطعة', quantity: 2, reserved_quantity: 0, delivered_quantity: 0, unit_multiplier: 1,
  } as never).execute();
}

async function requisitionRow(db: Kysely<Database>, id: number): Promise<any> {
  const rows = await (db as any).selectFrom('van_load_requisitions')
    .select(['rep_id as repId', 'status', 'doc_no as docNo'])
    .where('id', '=', id).where('tenant_id', '=', 't1').execute() as any[];
  assert.equal(rows.length, 1, `expected exactly one requisition ${id}`);
  return rows[0];
}

async function orderStatus(db: Kysely<Database>, id: number): Promise<string> {
  const rows = await (db as any).selectFrom('sales_orders')
    .select(['status'])
    .where('id', '=', id).where('tenant_id', '=', 't1').execute() as any[];
  assert.equal(rows.length, 1, `expected exactly one order ${id}`);
  return String(rows[0].status);
}

async function main(): Promise<void> {
  // Case 1: the dialog payload — deliveryRepId only — consolidates.
  {
    const { db } = await makeDb();
    try {
      await seedWorld(db);
      const service = new VanPreSalesService(db as any);
      const res = await service.consolidatePreSalesOrdersToRequisition('t1', 'a1', 99, {
        orderIds: [100],
        deliveryRepId: 7,
      });
      assert.equal(res.ok, true, 'consolidate succeeds with deliveryRepId');
      assert.equal(res.targetRepId, 7, 'targetRepId resolved from deliveryRepId');
      assert.ok(String(res.docNo).startsWith('VL-'), `docNo is a VL number, got ${res.docNo}`);
      const req = await requisitionRow(db, res.requisitionId);
      assert.equal(Number(req.repId), 7, 'requisition stored for rep 7');
      assert.equal(req.status, 'pending', 'requisition starts pending');
      assert.equal(await orderStatus(db, 100), 'converted', 'source order marked converted');
      console.log('case 1 passed: deliveryRepId 7 consolidates, requisition pending');
    } finally { await db.destroy(); }
  }

  // Case 2: neither rep field -> still refuses TARGET_REP_REQUIRED.
  {
    const { db } = await makeDb();
    try {
      await seedWorld(db);
      const service = new VanPreSalesService(db as any);
      await assert.rejects(
        service.consolidatePreSalesOrdersToRequisition('t1', 'a1', 99, { orderIds: [100] }),
        (err: any) => err && err.code === 'TARGET_REP_REQUIRED',
        'missing rep still refuses',
      );
      console.log('case 2 passed: no rep -> TARGET_REP_REQUIRED');
    } finally { await db.destroy(); }
  }

  // Case 3: targetRepId still works (other callers).
  {
    const { db } = await makeDb();
    try {
      await seedWorld(db);
      const service = new VanPreSalesService(db as any);
      const res = await service.consolidatePreSalesOrdersToRequisition('t1', 'a1', 99, {
        orderIds: [100],
        targetRepId: 7,
      });
      assert.equal(res.ok, true, 'consolidate succeeds with targetRepId');
      assert.equal(res.targetRepId, 7, 'targetRepId kept');
      console.log('case 3 passed: targetRepId 7 still consolidates');
    } finally { await db.destroy(); }
  }

  // Case 4: deliveryRepId for an unknown rep -> REP_NOT_FOUND.
  {
    const { db } = await makeDb();
    try {
      await seedWorld(db);
      const service = new VanPreSalesService(db as any);
      await assert.rejects(
        service.consolidatePreSalesOrdersToRequisition('t1', 'a1', 99, {
          orderIds: [100],
          deliveryRepId: 999,
        }),
        (err: any) => err && err.code === 'REP_NOT_FOUND',
        'unknown rep refuses',
      );
      console.log('case 4 passed: deliveryRepId 999 -> REP_NOT_FOUND');
    } finally { await db.destroy(); }
  }

  // 5. This spec is wired into both critical lists, in identical order
  // (308 specs — F18 wired van-presales-consolidate-delivery-rep-alias
  // and van-presales-order-details-line-total).
  {
    const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8')).specs as string[];
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 308);
    assert.equal(chain.length, 308);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/van-presales-consolidate-delivery-rep-alias.spec.ts'));
    console.log('5. evidence spec wired into both critical lists (308 = 308, identical order), passed');
  }

  console.log('van-presales-consolidate-delivery-rep-alias: all cases passed');
}

main()
  .then(async () => {
    console.log('van-presales-consolidate-delivery-rep-alias: all cases passed');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
