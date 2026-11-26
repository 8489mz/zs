import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { recordStockMovement, recordStockMovementRow } from '../../src/common/utils/stock-movement-writer';

/*
 * Phase 1 A10 — cost-rounding unification (INV-PHASE1-A10-ROUNDING-UNIFICATION).
 *
 * THE PROBLEM (grounding phase1-grounding-stock-movements.md §4.2 + A8/A9
 * deferrals): the writer's ONE total computation —
 * roundMoney(|delta| * unitCost, moneyDigits) — could not reproduce five
 * sites' stored totals, so they stayed hand-written:
 * - GRN :301 stores stockMovementTotal(accepted, lineUnitCost) + freight,
 *   a COMPOSITE total (bare line total at book digits + the exact
 *   integer-minor-unit freight share). The plain writer sees the landed
 *   6dp unit and books 101.12 where the row stores 101.13 (A8 §4).
 * - create :708 stores roundMoney(net*qty) + freight — the same composite,
 *   with netUnit itself a repeating-decimal division when prices include
 *   tax (effectiveUnitCost / (1 + tax/100)) and the base unit a second
 *   division (netUnit / multiplier): roundMoney(increasedQty * baseUnit)
 *   must equal roundMoney(netUnit * qty) — reassociation, brute-forced
 *   0/2M lines in phase1-a10-bruteforce.js (BF1).
 * - receive-goods :247 stores roundMoney(effectiveUnitCost * qty) from
 *   the FULL repeating-decimal division; the writer would see the 6dp
 *   unit and book 2.53 where the row stores 2.52 (A8 §4).
 * - receipt-posting :339/:701 store Number(group.value.toFixed(4)) with
 *   unit Number((value/qty).toFixed(6)). CORRECTION to the A9 deferral:
 *   groupImportReceipts rounds each group's value ONCE at book digits
 *   (INV-IMPORT-RECEIPT-BOOK-DIGITS), so the stored total is ALREADY a
 *   book-digit value and toFixed(4) is a formatting no-op on it — A9's
 *   brute-force generated raw 4dp values a real group value can never
 *   be. The real divergence is only the 6dp-unit rounding (qty x
 *   round6(value/qty) vs value): 0/2M at qty <= 500, but 67% @2dp /
 *   95% @3dp at container quantities (BF2b) — the 6dp error grows with
 *   qty (qty x 5e-7) while the full-precision round-trip error stays
 *   ~1e-13. The :701 reversal reads the ORIGINAL rows' stored totals,
 *   so both sites migrate together (BF3: 0/2M).
 *
 * THE UNIFICATION: the total computation exists in exactly ONE place
 * (insertMovementRow) — roundMoney(|delta| * totalUnit, digits) +
 * freightShare — with two new optional params on the delta mode (and
 * totalUnitCost on the row mode, so the signed spelling composes with
 * the unified computation — the signed site is a row-mode caller):
 * - totalUnitCost?: the unit the TOTAL is computed from, when it differs
 *   from the stored unitCost. The stored unit_cost column keeps unitCost
 *   verbatim (the A0 "stored as given" contract). Receive-goods passes
 *   the full-precision effective unit; receipt-posting passes
 *   value / qty at full precision. This is NOT an override: the total
 *   is still computed by the writer from (delta x unit) at book digits.
 * - freightShare?: an exact minor-unit addend (landed-cost share,
 *   integer minor units via allocateLandedCosts). The addition is NOT
 *   re-rounded — exactly the old `stockMovementTotal(...) + freight`
 *   expression. GRN/create pass the BARE unit as totalUnitCost.
 * - recordStockMovement returns totalCost (the computed total, null
 *   when omitTotalCost), so GRN's journal sums the same number the row
 *   stores instead of computing it twice (INV-GRN-JOURNAL-CENTRAL-POSTING).
 * - DECISION (the A5 open question): the signedTotal spelling SURVIVES.
 *   It is not a rounding variant — it is the journal-agreement sign for
 *   the single suppliers-stock re-set site (:225), where a decrease stores
 *   a NEGATIVE total agreeing with its signed journal leg
 *   (INV-GL-INVENTORY-VALUE); the sign is load-bearing for the WAC pool
 *   direction. Removing it would change a posted amount.
 * - What retires: the GRN stockMovementTotal call, the create/receive
 *   roundMoney calls, the receipt-posting toFixed(4) totals. The
 *   toFixed(6) stored-unit spellings STAY (the unit column's 6dp
 *   precision is not a total spelling); moveVanStock's .toFixed(4) stays
 *   (van template, not a migration target).
 *
 * WHAT THIS PINS, driving the REAL writer on PGlite (harness copied
 * from stock-movement-writer.spec.ts, no mocks):
 * 0. Routing: the 5 files hold ZERO direct inserts (1 writer call each;
 *    receipt-posting 2); the writer holds exactly one direct insert;
 *    moveVanStock keeps its 1 (not a target); the new params exist on
 *    the delta mode and the shared insert computes with them.
 * 1. Composite (GRN concrete): 3 x 33.375 + freight 1 books 101.13
 *    with unit 33.708333; the returned totalCost is 101.13.
 * 2. Full-precision receive: 33.33 / 12 / 1.1 x 1 books 2.52 (not 2.53),
 *    unit stored 2.525.
 * 3. Receipt round-trip: 42.88 / 7 books 42.88 at 2dp; 42.875 / 7 books
 *    42.875 at 3dp (the wac spec's pins, re-driven at writer level).
 * 4. Reversal shape: delta -7 with totalUnitCost 42.88/7 books +42.88
 *    (|delta| contract — the reversal total is positive, mirroring the
 *    original row).
 * 5. signedTotal composes with totalUnitCost (row mode): -5 x 10.5
 *    books -52.5.
 * 6. omitTotalCost still stores NULL with totalUnitCost present, and
 *    the returned totalCost is null.
 * 7. Plain mode unchanged: no totalUnitCost/freightShare behaves
 *    exactly as A0 (total from unitCost, returned totalCost set).
 * 8. Rollback: a throw after the writer leaves no row and balances
 *    unchanged — the writer runs inside the caller's transaction.
 * 9. Wiring: both critical lists carry 370 specs in identical order,
 *    with the three A10 specs last.
 */

const TENANT = 't1';
const ACCOUNT = 'a1';

const SRC = (rel: string): string => fs.readFileSync(path.resolve(__dirname, '../../src', rel), 'utf8');

function countDirectInserts(src: string): number {
  return (src.match(/insertInto\('stock_movements'\)/g) || []).length;
}

function countWriterCalls(src: string): number {
  return (src.match(/await recordStockMovement\(trx, \{/g) || []).length;
}

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigint PRIMARY KEY, name text, stock_qty numeric, reserved_qty numeric, tenant_id text, account_id text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, tenant_id text, account_id text, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, serial_tracking jsonb, batch_tracking jsonb, created_at timestamptz NOT NULL DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedStock(db: Kysely<Database>, globalQty: number, locationQty: number): Promise<void> {
  await db
    .insertInto('products' as never)
    .values({
      id: 1,
      name: 'Widget',
      stock_qty: globalQty,
      reserved_qty: 0,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      updated_at: new Date(),
    } as never)
    .execute();
  await db
    .insertInto('product_location_stock' as never)
    .values({
      product_id: 1,
      branch_id: 1,
      location_id: 5,
      qty: locationQty,
      reserved_qty: 0,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      updated_at: new Date(),
    } as never)
    .execute();
}

async function readRow(db: Kysely<Database>): Promise<Record<string, unknown>> {
  const rows = (await db.selectFrom('stock_movements').selectAll().execute()) as unknown as Array<
    Record<string, unknown>
  >;
  assert.equal(rows.length, 1, 'exactly one movement row');
  return rows[0];
}

function baseParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: 1,
    branchId: 1,
    locationId: 5,
    tenantId: TENANT,
    accountId: ACCOUNT,
    movementType: 'goods_receipt',
    referenceType: 'goods_receipt',
    referenceId: 1,
    moneyDigits: 2,
    unitCost: 33.375,
    createdBy: 1,
    note: 'test receipt',
    ...overrides,
  };
}

async function main(): Promise<void> {
  // §0 — the routing pin: the 5 deferred files hold ZERO direct inserts
  // (1 writer call each; receipt-posting 2), the writer holds exactly
  // one, and moveVanStock keeps its 1 (template, not a target).
  // (Pre-migration this fails: 1 + 1 + 1 + 2 inserts, 0 calls.)
  {
    const grn = SRC('modules/purchases/services/goods-receipt-post.service.ts');
    const create = SRC('modules/purchases/services/purchases-write-create.service.ts');
    const receive = SRC('modules/purchases/services/purchases-write-receive-goods.service.ts');
    const receipt = SRC('modules/import-sales/services/import-receipt-posting.service.ts');
    const writer = SRC('common/utils/stock-movement-writer.ts');
    const van = SRC('modules/delivery-reps/services/van-common.util.ts');
    assert.equal(countDirectInserts(grn), 0, 'GRN must hold zero direct stock_movements inserts');
    assert.equal(countWriterCalls(grn), 1, 'GRN must call recordStockMovement exactly once');
    assert.equal(countDirectInserts(create), 0, 'create must hold zero direct stock_movements inserts');
    assert.equal(countWriterCalls(create), 1, 'create must call recordStockMovement exactly once');
    assert.equal(countDirectInserts(receive), 0, 'receive-goods must hold zero direct stock_movements inserts');
    assert.equal(countWriterCalls(receive), 1, 'receive-goods must call recordStockMovement exactly once');
    assert.equal(countDirectInserts(receipt), 0, 'receipt-posting must hold zero direct stock_movements inserts');
    assert.equal(countWriterCalls(receipt), 2, 'receipt-posting must call recordStockMovement exactly twice');
    assert.equal(countDirectInserts(writer), 1, 'the writer holds exactly one direct insert (the shared insert)');
    assert.equal(countDirectInserts(van), 1, 'moveVanStock keeps its 1 insert (template, not a migration target)');
    assert.ok(writer.includes('totalUnitCost?: number'), 'the delta mode takes totalUnitCost');
    assert.ok(writer.includes('freightShare?: number'), 'the delta mode takes freightShare');
    assert.ok(
      writer.includes('totalUnitCost: params.totalUnitCost'),
      'recordStockMovement forwards totalUnitCost to the shared insert',
    );
    assert.ok(
      writer.includes('freightShare: params.freightShare'),
      'recordStockMovement forwards freightShare to the shared insert',
    );
    assert.ok(writer.includes('totalCost: number | null'), 'recordStockMovement returns the computed totalCost');
  }

  // §1 — composite (GRN concrete from A8 §4): 3 x 33.375 + freight 1
  // books 101.13 with unit 33.708333; the returned totalCost is 101.13.
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(
          trx,
          baseParams({
            delta: 3,
            unitCost: Number((33.375 + 1 / 3).toFixed(6)),
            totalUnitCost: 33.375,
            freightShare: 1,
          }) as never,
        );
      });
      assert.equal(Number(result.totalCost), 101.13, 'composite total is 101.13, not the plain-writer 101.12');
      const row = await readRow(db);
      assert.equal(Number(row.total_cost), 101.13);
      assert.equal(Number(row.unit_cost), 33.708333, 'stored unit is the landed 6dp unit');
      assert.equal(Number(row.qty), 3);
      assert.equal(Number(row.before_qty), 40);
      assert.equal(Number(row.after_qty), 43);
    } finally {
      await pg.close();
    }
  }

  // §2 — full-precision receive (A8 §4 concrete): 33.33 / 12 / 1.1 x 1
  // books 2.52 (not the 6dp-unit 2.53); stored unit is 2.525.
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const effective = 33.33 / 12 / 1.1;
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(
          trx,
          baseParams({
            delta: 1,
            unitCost: Number(effective.toFixed(6)),
            totalUnitCost: effective,
            movementType: 'purchase_receipt',
            referenceType: 'purchase',
          }) as never,
        );
      });
      assert.equal(Number(result.totalCost), 2.52, 'full-precision total is 2.52, not 2.53');
      const row = await readRow(db);
      assert.equal(Number(row.total_cost), 2.52);
      assert.equal(Number(row.unit_cost), 2.525, 'stored unit is the 6dp effective unit');
    } finally {
      await pg.close();
    }
  }

  // §3 — receipt round-trip (the wac spec's pins, at writer level):
  // 42.88 / 7 books 42.88 at 2dp; 42.875 / 7 books 42.875 at 3dp.
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(
          trx,
          baseParams({
            delta: 7,
            unitCost: Number((42.88 / 7).toFixed(6)),
            totalUnitCost: 42.88 / 7,
            movementType: 'import_receipt',
            referenceType: 'import_inventory_receipt',
          }) as never,
        );
      });
      assert.equal(Number(result.totalCost), 42.88, 'receipt total is the rounded group value 42.88');
      const row = await readRow(db);
      assert.equal(Number(row.total_cost), 42.88);
    } finally {
      await pg.close();
    }
  }
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 100, 100);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(
          trx,
          baseParams({
            delta: 7,
            unitCost: Number((42.875 / 7).toFixed(6)),
            totalUnitCost: 42.875 / 7,
            moneyDigits: 3,
            movementType: 'import_receipt',
            referenceType: 'import_inventory_receipt',
          }) as never,
        );
      });
      assert.equal(Number(result.totalCost), 42.875, 'KWD receipt total keeps the third decimal');
    } finally {
      await pg.close();
    }
  }

  // §4 — reversal shape: delta -7 with totalUnitCost 42.88/7 books
  // +42.88 (|delta| contract — the reversal total is positive,
  // mirroring the original row).
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(
          trx,
          baseParams({
            delta: -7,
            unitCost: Number((42.88 / 7).toFixed(6)),
            totalUnitCost: 42.88 / 7,
            movementType: 'import_receipt_reversal',
            referenceType: 'import_inventory_receipt',
          }) as never,
        );
      });
      assert.equal(Number(result.totalCost), 42.88, 'reversal total mirrors the original row, positive');
      const row = await readRow(db);
      assert.equal(Number(row.qty), -7);
      assert.equal(Number(row.total_cost), 42.88);
    } finally {
      await pg.close();
    }
  }

  // §5 — signedTotal composes with totalUnitCost (row mode): -5 x 10.5
  // books -52.5 (the A5 signed spelling survives — see the header).
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const id = await db.transaction().execute(async (trx) => {
        return recordStockMovementRow(trx, {
          productId: 1,
          branchId: 1,
          locationId: 5,
          tenantId: TENANT,
          accountId: ACCOUNT,
          movementType: 'opening_stock',
          delta: -5,
          beforeQty: 40,
          afterQty: 35,
          referenceType: 'opening_stock',
          referenceId: 1,
          unitCost: 10,
          totalUnitCost: 10.5,
          signedTotal: true,
          moneyDigits: 2,
        } as never);
      });
      assert.ok(Number(id) > 0, 'row-only call returns the row id');
      const row = await readRow(db);
      assert.equal(Number(row.total_cost), -52.5, 'signed total composes with the total unit');
    } finally {
      await pg.close();
    }
  }

  // §6 — omitTotalCost still stores NULL with totalUnitCost present,
  // and the returned totalCost is null.
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(
          trx,
          baseParams({
            delta: 7,
            unitCost: Number((42.88 / 7).toFixed(6)),
            totalUnitCost: 42.88 / 7,
            omitTotalCost: true,
            movementType: 'sale',
            referenceType: 'sale',
          }) as never,
        );
      });
      assert.equal(result.totalCost, null, 'returned totalCost is null when omitted');
      const row = await readRow(db);
      assert.equal(row.total_cost, null, 'stored total_cost is NULL');
    } finally {
      await pg.close();
    }
  }

  // §7 — plain mode unchanged: no totalUnitCost/freightShare behaves
  // exactly as A0 (total from unitCost, returned totalCost set).
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(trx, baseParams({ delta: -10, unitCost: 12.5 }) as never);
      });
      assert.equal(Number(result.totalCost), 125, 'plain total is still |delta| x unitCost');
      const row = await readRow(db);
      assert.equal(Number(row.total_cost), 125);
      assert.equal(Number(row.unit_cost), 12.5);
    } finally {
      await pg.close();
    }
  }

  // §8 — rollback: a throw after the writer leaves no row and balances
  // unchanged — the writer runs inside the caller's transaction.
  {
    const { pg, db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          await recordStockMovement(trx, baseParams({ delta: 3, totalUnitCost: 33.375, freightShare: 1 }) as never);
          throw new Error('boom after the writer');
        }),
        /boom after the writer/,
      );
      const rows = (await db.selectFrom('stock_movements').selectAll().execute()) as unknown as Array<unknown>;
      assert.equal(rows.length, 0, 'no movement row survives the rollback');
      const product = await db.selectFrom('products').select('stock_qty').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(product.stock_qty), 40, 'global balance is untouched');
    } finally {
      await pg.close();
    }
  }

  // §9 — wiring: both critical lists carry 370 specs in identical
  // order, with the three A10 specs last.
  {
    const specs = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 372);
    assert.equal(chain.length, 372);
    assert.deepEqual(chain, specs);
    assert.equal(specs[366], 'test/critical/phase1-a10-rounding.spec.ts');
    assert.equal(specs[367], 'test/critical/phase1-a10-purchases-writer.spec.ts');
    assert.equal(specs[368], 'test/critical/phase1-a10-import-writer.spec.ts');
    console.log('  evidence specs wired into both critical lists (372 = 372, identical order), passed');
  }
}

main()
  .then(() => {
    console.log('phase1-a10-rounding.spec: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('phase1-a10-rounding.spec: FAIL');
    console.error(err);
    process.exit(1);
  });
