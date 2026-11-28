import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuditService } from '../../src/core/audit/audit.service';
import { requireTenantScope } from '../../src/core/auth/utils/tenant-boundary';
import { SettingsLocationsAdmin } from '../../src/modules/settings/settings/settings-locations-admin';

/*
 * Phase 1 A1 — deleteLocation into a transaction (INV-PHASE1-A1-DELETE-LOCATION-TXN).
 *
 * THE GAP (grounding phase1-grounding-stock-movements.md §1, row 70): deleteLocation
 * is the SINGLE non-transactional business write — every statement runs on the pool
 * this.db, so the movement-history delete, the location delete and the audit log are
 * not atomic. If the hard delete of stock_locations fails with 23503 (a
 * stock_transfers row references the location — its from/to_location_id FKs are
 * RESTRICT), the pre-fix code has ALREADY committed the movement-history delete:
 * the audit trail is gone while the location survives as a soft-deleted row.
 *
 * THE RULE: the writes run in ONE transaction — empty stock cleanup + movement
 * history delete + hard location delete + audit row (via logWithExecutor on the
 * trx) commit or roll back together. A 23503 aborts a Postgres transaction, so the
 * soft-delete fallback runs as its OWN second transaction (same behaviour as
 * before, only when the location is active); any other error rethrows. Guard reads
 * stay on the pool — reads, not writes.
 * - recordStockMovement does NOT fit here: this path deletes history rows, it runs
 *   no balance delta and writes no new row. The write is placed inside the caller's
 *   transaction explicitly instead.
 * - Cache invalidation happens AFTER commit, outside the transaction callback.
 * - Cost rounding is A10, not this package; the docs' stale "17 unpaired /
 *   15 remaining" claim is A10's docs correction, not this package.
 *
 * WHAT THIS PINS, driving the REAL code on PGlite (fresh database per case):
 * - Happy path: a location with movement history + one empty stock row deletes
 *   hard — location row gone, its movements gone, the empty stock row gone, a
 *   movement of ANOTHER location untouched, exactly one audit row
 *   ('حذف مخزن نهائي').
 * - Rollback: with a stock_transfers row referencing the location, the hard delete
 *   fails 23503 — the movement history and the empty stock row SURVIVE (attempt 1
 *   rolled back), the location survives as is_active = false (fallback transaction),
 *   exactly one audit row ('أرشفة مخزن') and zero 'حذف مخزن نهائي' rows.
 * - Guards unchanged: LOCATION_HAS_STOCK and LOCATION_IS_DEFAULT_FOR_BRANCH throw
 *   before any write — nothing deleted, no audit row.
 * - Source pins: exactly one deleteFrom('stock_movements') in the service file,
 *   running on trx (no this.db.deleteFrom('stock_movements') remains), and the
 *   docs row lists the write at its new line with the in-transaction flag 'yes'.
 * This is not an end-to-end run on live Postgres.
 */

const TENANT = 't1';
const ACCOUNT = 'a1';

const ACTOR = { userId: 1, username: 'tester', tenantId: TENANT, accountId: ACCOUNT } as never;

async function makeDb(): Promise<{
  pg: InstanceType<typeof PGlite>;
  db: Kysely<Database>;
  admin: SettingsLocationsAdmin;
  invalidated: string[];
}> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE branches (id bigint PRIMARY KEY, default_stock_location_id bigint, is_active boolean, tenant_id text, account_id text);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, is_active boolean, tenant_id text, account_id text);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, tenant_id text, account_id text);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, serial_tracking jsonb, batch_tracking jsonb, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, idempotency_key text, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE stock_transfers (id bigserial PRIMARY KEY, from_location_id bigint NOT NULL REFERENCES stock_locations(id), to_location_id bigint NOT NULL REFERENCES stock_locations(id));
  `);
  const invalidated: string[] = [];
  const audit = new AuditService(db as never);
  const admin = new SettingsLocationsAdmin(
    db as never,
    audit as never,
    {
      invalidateBranchesCache: () => undefined,
      invalidateLocationsCache: (tenantId: string | undefined) => {
        invalidated.push(String(tenantId));
      },
      listBranches: async () => ({ branches: [] }),
      listLocations: async () => {
        const rows = await db
          .selectFrom('stock_locations')
          .select(['id', 'is_active'])
          .where('tenant_id', '=', TENANT)
          .execute();
        return { locations: rows };
      },
      scope: (actor: never) => requireTenantScope(actor as never),
      tenantPredicate: (actor: never, alias?: string) => {
        const { tenantId, accountId } = requireTenantScope(actor as never);
        return alias
          ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId} AND ${sql.ref(`${alias}.account_id`)} = ${accountId}`
          : sql<boolean>`tenant_id = ${tenantId} AND account_id = ${accountId}`;
      },
    } as never,
  );
  return { pg, db, admin, invalidated };
}

async function seedLocation(
  db: Kysely<Database>,
  id: number,
  opts: { isActive?: boolean; stockQty?: number; movements?: number; otherLocationMovements?: number } = {},
): Promise<void> {
  await db
    .insertInto('stock_locations' as never)
    .values({ id, is_active: opts.isActive ?? true, tenant_id: TENANT, account_id: ACCOUNT } as never)
    .execute();
  await db
    .insertInto('branches' as never)
    .values({
      id: id * 10,
      default_stock_location_id: null,
      is_active: true,
      tenant_id: TENANT,
      account_id: ACCOUNT,
    } as never)
    .execute();
  await db
    .insertInto('product_location_stock' as never)
    .values({
      product_id: 1,
      branch_id: id * 10,
      location_id: id,
      qty: opts.stockQty ?? 0,
      reserved_qty: 0,
      tenant_id: TENANT,
      account_id: ACCOUNT,
    } as never)
    .execute();
  for (let i = 0; i < (opts.movements ?? 0); i += 1) {
    await db
      .insertInto('stock_movements' as never)
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        product_id: 1,
        movement_type: 'sale',
        qty: -1,
        before_qty: 10,
        after_qty: 9,
        reason: 'sale',
        note: '',
        reference_type: 'sale',
        reference_id: i + 1,
        created_by: 1,
        branch_id: id * 10,
        location_id: id,
        unit_cost: 5,
        total_cost: 5,
        import_receipt_id: null,
      } as never)
      .execute();
  }
  for (let i = 0; i < (opts.otherLocationMovements ?? 0); i += 1) {
    await db
      .insertInto('stock_movements' as never)
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        product_id: 1,
        movement_type: 'sale',
        qty: -1,
        before_qty: 10,
        after_qty: 9,
        reason: 'sale',
        note: '',
        reference_type: 'sale',
        reference_id: 100 + i,
        created_by: 1,
        branch_id: 99,
        location_id: 99,
        unit_cost: 5,
        total_cost: 5,
        import_receipt_id: null,
      } as never)
      .execute();
  }
}

async function countMovements(db: Kysely<Database>, locationId: number): Promise<number> {
  const row = await db
    .selectFrom('stock_movements')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('location_id', '=', locationId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

async function countStockRows(db: Kysely<Database>, locationId: number): Promise<number> {
  const row = await db
    .selectFrom('product_location_stock')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('location_id', '=', locationId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

async function auditActions(db: Kysely<Database>): Promise<string[]> {
  const rows = await db.selectFrom('audit_logs').select('action').execute();
  return (rows as Array<{ action: string }>).map((r) => r.action);
}

async function locationRow(db: Kysely<Database>, id: number): Promise<{ is_active: boolean } | undefined> {
  const row = await db.selectFrom('stock_locations').select('is_active').where('id', '=', id).executeTakeFirst();
  return row as { is_active: boolean } | undefined;
}

async function main(): Promise<void> {
  // 1. Happy path: hard delete removes the location, its movements and the
  //    empty stock row; another location's movements are untouched; one audit row.
  {
    const { db, admin } = await makeDb();
    try {
      await seedLocation(db, 5, { movements: 2, otherLocationMovements: 1 });
      const result = await admin.deleteLocation(5, ACTOR);
      assert.equal(result.ok, true);
      assert.equal(await locationRow(db, 5), undefined, 'location row must be gone');
      assert.equal(await countMovements(db, 5), 0, 'its movements must be gone');
      assert.equal(await countMovements(db, 99), 1, 'another location’s movements survive');
      assert.equal(await countStockRows(db, 5), 0, 'the empty stock row must be gone');
      assert.deepEqual(await auditActions(db), ['حذف مخزن نهائي']);
      assert.equal(
        (result.locations as Array<{ id: number }>).some((l) => Number(l.id) === 5),
        false,
      );
      console.log('  happy path hard delete: passed');
    } finally {
      await db.destroy();
    }
  }

  // 2. Rollback: a stock_transfers row blocks the hard delete (23503) — the
  //    movement history and the empty stock row SURVIVE (attempt 1 rolled back),
  //    the location survives soft-deleted, exactly one 'أرشفة مخزن' audit row.
  {
    const { db, admin } = await makeDb();
    try {
      await seedLocation(db, 6, { movements: 2 });
      await db
        .insertInto('stock_transfers' as never)
        .values({ from_location_id: 6, to_location_id: 6 } as never)
        .execute();
      const result = await admin.deleteLocation(6, ACTOR);
      assert.equal(result.ok, true, 'the fallback still returns ok');
      assert.equal(await countMovements(db, 6), 2, 'rolled back: movements must survive');
      assert.equal(await countStockRows(db, 6), 1, 'rolled back: empty stock row must survive');
      const loc = await locationRow(db, 6);
      assert.ok(loc, 'location must survive');
      assert.equal(loc!.is_active, false, 'fallback soft-deletes the location');
      assert.deepEqual(await auditActions(db), ['أرشفة مخزن']);
      console.log('  rollback + fallback: passed');
    } finally {
      await db.destroy();
    }
  }

  // 3. Guard LOCATION_HAS_STOCK: throws before any write — nothing deleted, no audit.
  {
    const { db, admin } = await makeDb();
    try {
      await seedLocation(db, 7, { stockQty: 5, movements: 1 });
      await assert.rejects(
        admin.deleteLocation(7, ACTOR),
        (error: unknown) => (error as { code?: string }).code === 'LOCATION_HAS_STOCK',
      );
      assert.equal(await countMovements(db, 7), 1, 'guard: movements untouched');
      assert.equal(await countStockRows(db, 7), 1, 'guard: stock row untouched');
      assert.ok(await locationRow(db, 7), 'guard: location untouched');
      assert.deepEqual(await auditActions(db), [], 'guard: no audit row');
      console.log('  LOCATION_HAS_STOCK guard: passed');
    } finally {
      await db.destroy();
    }
  }

  // 4. Guard LOCATION_IS_DEFAULT_FOR_BRANCH: throws before any write.
  {
    const { db, admin } = await makeDb();
    try {
      await seedLocation(db, 8, { movements: 1 });
      await db.updateTable('branches').set({ default_stock_location_id: 8 }).where('id', '=', 80).execute();
      await assert.rejects(
        admin.deleteLocation(8, ACTOR),
        (error: unknown) => (error as { code?: string }).code === 'LOCATION_IS_DEFAULT_FOR_BRANCH',
      );
      assert.equal(await countMovements(db, 8), 1, 'guard: movements untouched');
      assert.ok(await locationRow(db, 8), 'guard: location untouched');
      assert.deepEqual(await auditActions(db), [], 'guard: no audit row');
      console.log('  LOCATION_IS_DEFAULT_FOR_BRANCH guard: passed');
    } finally {
      await db.destroy();
    }
  }

  // 5. Source pins: exactly one stock_movements delete in the service file,
  //    running on trx (no pool delete remains); the docs row lists the write
  //    at its scanned line with the in-transaction flag 'yes'.
  {
    const src = readFileSync(
      resolve(__dirname, '../../src/modules/settings/settings/settings-locations-admin.ts'),
      'utf8',
    );
    const deleteLines = src.split('\n').filter((line) => line.includes("deleteFrom('stock_movements')"));
    assert.equal(deleteLines.length, 1, 'exactly one stock_movements delete site');
    assert.ok(!src.includes("this.db.deleteFrom('stock_movements')"), 'the delete must run on trx, not on the pool');
    assert.ok(src.includes('transaction().execute'), 'deleteLocation must run inside a transaction');
    const deleteLine = src.split('\n').findIndex((line) => line.includes("deleteFrom('stock_movements')")) + 1;
    const doc = readFileSync(resolve(__dirname, '../../../docs/STOCK_MOVEMENTS_WRITES.md'), 'utf8');
    assert.ok(
      doc.includes(
        `backend/src/modules/settings/settings/settings-locations-admin.ts:${deleteLine} | delete | (delete) | yes`,
      ),
      'the docs row must list the write at its new line with flag yes',
    );
    console.log('  source pins: passed');
  }

  // 6. Wiring: this spec is in both critical lists, in identical order
  // (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 451);
    assert.equal(chain.length, 451);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/delete-location-transaction.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-r1-offline-below-floor-gate.spec.ts');
    console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('Delete location transaction tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
