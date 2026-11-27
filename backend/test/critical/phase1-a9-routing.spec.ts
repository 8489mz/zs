/*
New file: backend/test/critical/phase1-a9-routing.spec.ts
Pins INV-PHASE1-A9-REMAINING-WRITER (the routing half): the remaining 18
stock-movements sites now route through the single writer
(recordStockMovement / recordStockMovementRow / recordStockRelocation)
instead of hand-writing their rows.

WHAT THE MIGRATION MUST NOT CHANGE: every row keeps its exact fields.
The writer computes total_cost = roundMoney(|delta| * unitCost) from the
same inputs the old code used, so the totals are identical by
construction — except the two shapes whose totals are NOT the writer's:
- archive :319/:364 and the QA legs: see the per-site notes below.
- receipt-posting :339/:701: NOT migrated here (they store a 4-decimal
  total; the writer rounds at book digits; brute-force proved 99% @2dp /
  90% @3dp divergence) — deferred to A10 with the 3 purchases sites.

THE 18 SITES (rows) and their writer mode:
- catalog archive :277 (deduct, locStocks loop): recordStockMovement.
  The row stamps the ledger return (scopeBefore = the location row qty).
- catalog archive :319 (deduct, no location rows) + :364 (deduct,
  residual drift): recordStockMovementRow — the rows stamp the GLOBAL
  basis (globalQty / remainingGlobal -> 0), not the ledger's location
  scope (0 -> -qty). The naive delta mode was PROVEN wrong here by the
  pre-existing residual spec (it failed `before_qty is remainingGlobal`
  on the writer row (0, -4) vs the pinned (4, 0)); row-only preserves it.
- fashion :554 (zeroing deduct): recordStockMovement (same shape as the
  archive loop leg; the cache line stays as-is).
- import-sales preorders :751 (sale): recordStockMovementRow +
  omitTotalCost — the ledger call ran 160 lines above the row, and the
  row keeps total_cost NULL (the A7 sale-row shape); reason defaults to
  movementType 'sale' (the old row had NO reason field).
- inventory adjustment :256: recordStockMovementRow — stamped from the
  carried signedDelta / stockChange; the no-change guard still throws
  after the ledger call but before the row, so a no-change run rolls
  back exactly as before.
- inventory count :638 (gain/loss): setScopedStockQty (kept) +
  recordStockMovementRow — movement_type comes from the post-setter
  actualDelta, which the set mode cannot know upfront; the set mode
  also always writes a row, so it cannot express :638's / :225's
  post-setter decisions (this corrects the A5 writer-doc anticipation).
- inventory count :817 (damaged): recordStockMovement.
- inventory QA :348/:360 (transfer_send/receive): recordStockRelocation
  (1 call, 2 rows). The .toFixed(6) total spelling retires here (A5:
  0.333 x 3 books 1.00 at book digits).
- maintenance delete-ticket :121 + ticket-parts :154/:305:
  recordStockMovement (writer first, then valueStockReceipt on the
  returned globalAfter).
- returns purchase-return :460 + sale-return :367/:380:
  recordStockMovement (writer first, then the WAC revalue / receipt on
  the returned globalAfter). roundBookMoney IS roundMoney, so the
  totals are identical.
- settings suppliers-stock :225 (opening_stock): setScopedStockQty
  (kept) + recordStockMovementRow with signedTotal — the zero-skip
  (`continue`, no row when actualDelta === 0) is decided after the
  setter, and the signed total agrees with the signed journal leg.
- tradein :401: recordStockMovement (writer first, then
  valueStockReceipt on the returned globalAfter). agreed is validated
  via toMinorUnits, so roundMoney(1 x agreed) == agreed.

WHAT THIS PINS, driving the REAL writer functions on PGlite plus
static routing pins over the migrated files:
0. The routing itself: the 12 migrated files hold ZERO direct
   insertInto('stock_movements') and the expected writer-call counts;
   the writer file still holds exactly one direct insert; the deferred
   set is empty — A10 migrated the 5 deferred sites (3 purchases + 2
   receipt-posting), and eval P3 migrated the last one, moveVanStock
   (the template), so NO direct insert remains in modules.
   (Pre-migration this fails: 24 direct inserts.)
1. Delta mode: one row with the exact fields, balances moved.
2. Row-only global-basis (archive :319 shape): the row stamps the
   CARRIED before/after (7 -> 0), not the ledger scope (0 -> -7).
3. Row-only omitTotalCost (preorders shape): total_cost NULL and
   reason defaults to movementType 'sale'.
4. Relocation (QA shape): two rows with exact fields; 0.333 x 3 books
   1.00 at 2dp (the .toFixed(6) spelling retires).
5. SignedTotal (suppliers shape): a negative delta books a NEGATIVE
   total, agreeing with the signed journal leg.
6. Rollback: a failed run leaves ZERO movement rows and untouched
   balances — the writer runs inside the same transaction.
7. The critical lists: 370 = 370, identical order, last entry the B1
   spec (the A9 specs' 369 pins are updated in this package the same
   way A9 updated A8's).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  recordStockMovement,
  recordStockMovementRow,
  recordStockRelocation,
} from '../../src/common/utils/stock-movement-writer';
import { applyStockDelta, setScopedStockQty } from '../../src/common/utils/location-stock-ledger';

const SRC = path.resolve(__dirname, '../../src');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

function countCalls(source: string, fn: string): number {
  return source.split(`${fn}(trx`).length - 1;
}

function countDirectInserts(source: string): number {
  return source.split("insertInto('stock_movements')").length - 1;
}

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, sku text, style_code text, item_kind text, item_type text, color text, size text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, min_stock_qty numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, catalog_updated_at timestamptz, updated_at timestamptz);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
  `);
  await (db as any).insertInto('settings').values({ tenant_id: 't1', key: 'currency', value: '"EGP"' }).execute();
  await (db as any)
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: 't1', currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await (db as any)
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: 't1',
      account_id: 'a1',
      branch_id: 1,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await (db as any)
    .insertInto('stock_locations')
    .values({
      id: 20,
      tenant_id: 't1',
      account_id: 'a1',
      branch_id: 1,
      name: 'Quarantine',
      location_type: 'quarantine',
      is_active: true,
    })
    .execute();
  return { pg, db };
}

async function seedProduct(
  db: Kysely<Database>,
  id: number,
  qty: number,
  cost: number,
  locQty: number | null = null,
): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials, default_location_id) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, ${cost}, true, false, 10)`.execute(
    db,
  );
  if (locQty !== null) {
    await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 10, ${locQty}, 0)`.execute(
      db,
    );
  }
}

type Row = {
  product_id: number;
  movement_type: string;
  qty: string;
  before_qty: string | null;
  after_qty: string | null;
  unit_cost: string | null;
  total_cost: string | null;
  reason: string | null;
  note: string;
  reference_type: string | null;
  reference_id: number | null;
  branch_id: number | null;
  location_id: number | null;
};

async function rows(db: Kysely<Database>): Promise<Row[]> {
  return (db as any).selectFrom('stock_movements').selectAll().orderBy('id', 'asc').execute();
}

async function main(): Promise<void> {
  // 0. Routing: zero direct inserts in the 12 migrated files, with the
  //    expected writer-call counts; the writer keeps exactly one insert;
  //    the deferred set is empty (A10 migrated the 5 deferred sites,
  //    eval P3 migrated moveVanStock — no direct insert remains).
  {
    const migrated: Array<{ file: string; delta: number; row: number; relocation: number }> = [
      { file: 'modules/catalog/services/catalog-product-archive.service.ts', delta: 1, row: 2, relocation: 0 },
      // Fashion holds 5 delta calls: 4 are A3's (consolidation x2,
      // stock-edit, +1) and 1 is A9's :554 zeroing leg.
      { file: 'modules/catalog/services/catalog-product-fashion.service.ts', delta: 5, row: 0, relocation: 0 },
      { file: 'modules/inventory/services/inventory-adjustment.service.ts', delta: 0, row: 1, relocation: 0 },
      { file: 'modules/inventory/services/inventory-count.service.ts', delta: 1, row: 1, relocation: 0 },
      { file: 'modules/inventory/services/quality-assurance.service.ts', delta: 0, row: 0, relocation: 1 },
      { file: 'modules/import-sales/services/import-container-preorders.service.ts', delta: 0, row: 1, relocation: 0 },
      { file: 'modules/maintenance/maintenance/delete-ticket.slice.ts', delta: 1, row: 0, relocation: 0 },
      { file: 'modules/maintenance/maintenance/ticket-parts.slice.ts', delta: 2, row: 0, relocation: 0 },
      { file: 'modules/returns/returns-purchase-return.service.ts', delta: 1, row: 0, relocation: 0 },
      { file: 'modules/returns/returns-sale-return.service.ts', delta: 2, row: 0, relocation: 0 },
      {
        file: 'modules/settings/services/settings-import/settings-import-suppliers-stock.ts',
        delta: 0,
        row: 1,
        relocation: 0,
      },
      { file: 'modules/tradein/tradein.service.ts', delta: 1, row: 0, relocation: 0 },
    ];
    for (const m of migrated) {
      const source = read(m.file);
      assert.equal(countDirectInserts(source), 0, `${m.file} must hold zero direct stock_movements inserts`);
      assert.equal(countCalls(source, 'recordStockMovement'), m.delta, `${m.file} recordStockMovement calls`);
      assert.equal(countCalls(source, 'recordStockMovementRow'), m.row, `${m.file} recordStockMovementRow calls`);
      assert.equal(countCalls(source, 'recordStockRelocation'), m.relocation, `${m.file} recordStockRelocation calls`);
    }
    const writer = read('common/utils/stock-movement-writer.ts');
    assert.equal(countDirectInserts(writer), 1, 'the writer file holds exactly one direct insert (the shared insert)');
    assert.ok(
      writer.includes('omitTotalCost: params.omitTotalCost'),
      'recordStockMovementRow forwards omitTotalCost to the shared insert (A9)',
    );
    // Deferred set, pinned: A10 migrated the 5 deferred sites and eval
    // P3 migrated moveVanStock, so NO direct insert remains in modules.
    // The 5 files stay listed so the pin still covers them (each must
    // hold zero) plus the van file's one writer call.
    const deferred = [
      'modules/purchases/services/goods-receipt-post.service.ts',
      'modules/purchases/services/purchases-write-create.service.ts',
      'modules/purchases/services/purchases-write-receive-goods.service.ts',
      'modules/import-sales/services/import-receipt-posting.service.ts',
      'modules/delivery-reps/services/van-common.util.ts',
    ];
    let remaining = 0;
    for (const f of deferred) remaining += countDirectInserts(read(f));
    assert.equal(remaining, 0, 'exactly 0 direct inserts remain (moveVanStock migrated by eval P3)');
    assert.equal(countDirectInserts(read('modules/purchases/services/goods-receipt-post.service.ts')), 0);
    assert.equal(countDirectInserts(read('modules/purchases/services/purchases-write-create.service.ts')), 0);
    assert.equal(countDirectInserts(read('modules/purchases/services/purchases-write-receive-goods.service.ts')), 0);
    assert.equal(countDirectInserts(read('modules/import-sales/services/import-receipt-posting.service.ts')), 0);
    assert.equal(countDirectInserts(read('modules/delivery-reps/services/van-common.util.ts')), 0);
    assert.equal(
      countCalls(read('modules/delivery-reps/services/van-common.util.ts'), 'recordStockMovement'),
      1,
      'moveVanStock calls recordStockMovement exactly once (eval P3)',
    );
    console.log('  routing pins (12 files, writer, deferred set) passed');
  }

  const { pg: _pg, db } = await makeDb();
  try {
    // 1. Delta mode: one row with the exact fields, balances moved.
    {
      await seedProduct(db, 101, 10, 5, 10);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(trx as any, {
          productId: 101,
          delta: -4,
          branchId: 1,
          locationId: 10,
          tenantId: 't1',
          accountId: 'a1',
          disableAutoDrain: true,
          allowNegative: true,
          movementType: 'deduct',
          referenceType: 'inventory_adjustment',
          referenceId: 101,
          note: 'test deduct',
          unitCost: 5,
          moneyDigits: 2,
          createdBy: 1,
        });
      });
      assert.ok(result.movementId > 0, 'delta mode returns the movement id');
      const found = await rows(db);
      assert.equal(found.length, 1, 'delta mode writes exactly one row');
      const [r] = found;
      assert.equal(r.movement_type, 'deduct');
      assert.equal(Number(r.qty), -4);
      assert.equal(Number(r.before_qty), 10);
      assert.equal(Number(r.after_qty), 6);
      assert.equal(Number(r.unit_cost), 5);
      assert.equal(Number(r.total_cost), 20);
      assert.equal(r.reason, 'deduct', 'reason defaults to movementType');
      assert.equal(r.reference_type, 'inventory_adjustment');
      assert.equal(Number(r.reference_id), 101);
      assert.equal(Number(r.location_id), 10);
      // The ledger provisions the unassigned-pool row (branch/location
      // NULL) alongside the location row, so the read must name the
      // location — an unfiltered takeFirst may return the pool row (0).
      const loc: any = await (db as any)
        .selectFrom('product_location_stock')
        .select('qty')
        .where('product_id', '=', 101)
        .where('location_id', '=', 10)
        .executeTakeFirst();
      assert.equal(Number(loc.qty), 6, 'location balance moved');
      const prod: any = await (db as any)
        .selectFrom('products')
        .select('stock_qty')
        .where('id', '=', 101)
        .executeTakeFirst();
      assert.equal(Number(prod.stock_qty), 6, 'global balance moved');
      console.log('  delta mode writes one exact row passed');
    }

    // 2. Row-only global-basis (archive :319 shape): the row stamps the
    //    CARRIED before/after (7 -> 0), not the ledger scope (0 -> -7).
    {
      const { pg: _pg2, db: db2 } = await makeDb();
      try {
        await seedProduct(db2, 102, 7, 5, null);
        await db2.transaction().execute(async (trx) => {
          await applyStockDelta(trx as any, {
            productId: 102,
            delta: -7,
            locationId: 10,
            tenantId: 't1',
            accountId: 'a1',
            disableAutoDrain: true,
            allowNegative: true,
          });
          await recordStockMovementRow(trx as any, {
            productId: 102,
            locationId: 10,
            delta: -7,
            beforeQty: 7,
            afterQty: 0,
            tenantId: 't1',
            accountId: 'a1',
            movementType: 'deduct',
            referenceType: 'inventory_adjustment',
            referenceId: 102,
            reason: 'archive_stock_zeroing',
            note: 'test',
            unitCost: 5,
            moneyDigits: 2,
            createdBy: 1,
          });
        });
        const found = await rows(db2);
        assert.equal(found.length, 1);
        assert.equal(Number(found[0].before_qty), 7, 'row-only stamps the carried before_qty, not the ledger scope 0');
        assert.equal(Number(found[0].after_qty), 0, 'row-only stamps the carried after_qty, not the ledger scope -7');
        assert.equal(Number(found[0].total_cost), 35);
        console.log('  row-only global-basis stamps carried before/after passed');
      } finally {
        await db2.destroy();
      }
    }

    // 3. Row-only omitTotalCost (preorders shape): total NULL, reason
    //    defaults to movementType 'sale'.
    {
      const { pg: _pg3, db: db3 } = await makeDb();
      try {
        await seedProduct(db3, 103, 4, 10, 4);
        await db3.transaction().execute(async (trx) => {
          const change = await applyStockDelta(trx as any, {
            productId: 103,
            delta: -2,
            branchId: 1,
            locationId: 10,
            tenantId: 't1',
            accountId: 'a1',
            allowNegative: false,
          });
          await recordStockMovementRow(trx as any, {
            productId: 103,
            branchId: 1,
            locationId: 10,
            delta: -2,
            beforeQty: change.scopeBefore,
            afterQty: change.scopeAfter,
            tenantId: 't1',
            accountId: 'a1',
            movementType: 'sale',
            referenceType: 'sale',
            referenceId: 9001,
            note: 'preorder sale',
            unitCost: 10,
            moneyDigits: 2,
            omitTotalCost: true,
            createdBy: 1,
          });
        });
        const found = await rows(db3);
        assert.equal(found.length, 1);
        assert.equal(found[0].total_cost, null, 'omitTotalCost stores total_cost NULL');
        assert.equal(found[0].reason, 'sale', 'missing reason defaults to movementType');
        assert.equal(Number(found[0].qty), -2);
        console.log('  row-only omitTotalCost NULL total + reason default passed');
      } finally {
        await db3.destroy();
      }
    }

    // 4. Relocation (QA shape): two rows; 0.333 x 3 books 1.00 at 2dp.
    {
      const { pg: _pg4, db: db4 } = await makeDb();
      try {
        await seedProduct(db4, 104, 3, 0.333, null);
        await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', 104, 1, 20, 3, 0)`.execute(
          db4,
        );
        await db4.transaction().execute(async (trx) => {
          await recordStockRelocation(trx as any, {
            productId: 104,
            qty: 3,
            fromBranchId: 1,
            fromLocationId: 20,
            toBranchId: 1,
            toLocationId: 10,
            tenantId: 't1',
            accountId: 'a1',
            referenceType: 'goods_receipt',
            referenceId: 77,
            reason: 'quarantine_release',
            note: 'test release',
            unitCost: 0.333,
            moneyDigits: 2,
            createdBy: 1,
          });
        });
        const found = await rows(db4);
        assert.equal(found.length, 2, 'relocation writes exactly two rows');
        const [send, receive] = found;
        assert.equal(send.movement_type, 'transfer_send');
        assert.equal(Number(send.qty), -3);
        assert.equal(Number(send.before_qty), 3);
        assert.equal(Number(send.after_qty), 0);
        assert.equal(Number(send.total_cost), 1, '0.333 x 3 books 1.00 at 2dp (the .toFixed(6) spelling retires)');
        assert.equal(send.reason, 'quarantine_release');
        assert.equal(Number(send.location_id), 20);
        assert.equal(receive.movement_type, 'transfer_receive');
        assert.equal(Number(receive.qty), 3);
        assert.equal(Number(receive.before_qty), 0);
        assert.equal(Number(receive.after_qty), 3);
        assert.equal(Number(receive.total_cost), 1);
        assert.equal(Number(receive.location_id), 10);
        console.log('  relocation two-leg rows + 2dp total passed');
      } finally {
        await db4.destroy();
      }
    }

    // 5. SignedTotal (suppliers shape): a negative delta books a
    //    NEGATIVE total, agreeing with the signed journal leg.
    {
      const { pg: _pg5, db: db5 } = await makeDb();
      try {
        await seedProduct(db5, 105, 10, 10, 10);
        await db5.transaction().execute(async (trx) => {
          const change = await setScopedStockQty(trx as any, {
            productId: 105,
            nextQty: 5,
            branchId: 1,
            locationId: 10,
            tenantId: 't1',
            accountId: 'a1',
            disableAutoDrain: true,
          });
          const actualDelta = Number((change.scopeAfter - change.scopeBefore).toFixed(3));
          assert.equal(actualDelta, -5);
          await recordStockMovementRow(trx as any, {
            productId: 105,
            branchId: 1,
            locationId: 10,
            delta: actualDelta,
            beforeQty: change.scopeBefore,
            afterQty: change.scopeAfter,
            tenantId: 't1',
            accountId: 'a1',
            movementType: 'opening_stock',
            referenceType: 'product',
            referenceId: 105,
            reason: 'inventory_adjustment',
            note: 'test',
            unitCost: 10,
            moneyDigits: 2,
            signedTotal: true,
            createdBy: 1,
          });
        });
        const found = await rows(db5);
        assert.equal(found.length, 1);
        assert.equal(Number(found[0].qty), -5);
        assert.equal(Number(found[0].total_cost), -50, 'signedTotal books a NEGATIVE total for a decrease');
        console.log('  signedTotal negative total passed');
      } finally {
        await db5.destroy();
      }
    }

    // 6. Rollback: a failed run leaves ZERO rows and untouched balances.
    {
      const { pg: _pg6, db: db6 } = await makeDb();
      try {
        await seedProduct(db6, 106, 10, 5, 10);
        let threw = false;
        try {
          await db6.transaction().execute(async (trx) => {
            await recordStockMovement(trx as any, {
              productId: 106,
              delta: -4,
              branchId: 1,
              locationId: 10,
              tenantId: 't1',
              accountId: 'a1',
              disableAutoDrain: true,
              allowNegative: true,
              movementType: 'deduct',
              referenceType: 'inventory_adjustment',
              referenceId: 106,
              note: 'rollback test',
              unitCost: 5,
              moneyDigits: 2,
              createdBy: 1,
            });
            throw new Error('simulated failure after the row');
          });
        } catch (e: any) {
          threw = e.message === 'simulated failure after the row';
        }
        assert.ok(threw, 'the simulated failure propagated');
        assert.equal((await rows(db6)).length, 0, 'a failed run leaves zero movement rows');
        const loc: any = await (db6 as any)
          .selectFrom('product_location_stock')
          .select('qty')
          .where('product_id', '=', 106)
          .where('location_id', '=', 10)
          .executeTakeFirst();
        assert.equal(Number(loc.qty), 10, 'balances untouched after rollback');
        console.log('  rollback leaves zero rows + untouched balances passed');
      } finally {
        await db6.destroy();
      }
    }

    // 7. The critical lists: 370 = 370, identical order, last entry
    //    the B1 spec.
    {
      const specs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 405);
      assert.equal(chain.length, 405);
      assert.deepEqual(chain, specs);
      assert.equal(specs[363], 'test/critical/purchases-writer.spec.ts');
      assert.equal(specs[364], 'test/critical/phase1-a9-routing.spec.ts');
      assert.equal(specs[365], 'test/critical/phase1-a9-inventory-writer.spec.ts');
      assert.equal(specs[366], 'test/critical/phase1-a9-services-writer.spec.ts');
      assert.equal(specs[367], 'test/critical/phase1-a10-rounding.spec.ts');
      assert.equal(specs[368], 'test/critical/phase1-a10-purchases-writer.spec.ts');
      assert.equal(specs[369], 'test/critical/phase1-a10-import-writer.spec.ts');
      console.log('  evidence specs wired into both critical lists (373 = 373, identical order), passed');
    }
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => {
    console.log('phase1-a9-routing.spec: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('phase1-a9-routing.spec: FAIL');
    console.error(err);
    process.exit(1);
  });
