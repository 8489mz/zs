/*
New file: backend/test/critical/location-assign-no-drain.spec.ts

WHAT THIS PINS (INV-LOCATION-ASSIGN-NO-DRAIN):
assigning a product to a location provisions the location
row at quantity zero and moves NOTHING. Before this fix
the provisioning call was a zero-delta applyStockDelta
without disableAutoDrain, so the ledger's historical
auto-drain first re-homed the whole floating (unassigned)
pool into the new location -- with no stock movement, no
journal and no audit trace. The location balances then
disagreed with the floor: a count at the new location
found stock that was never physically moved there, while
the location that physically held the goods came up short.

THE CASES, WORKED ONCE:
(a) A product with 100 units floating (unassigned) and
none at the location: after assignment the unassigned
balance is still 100, the new location row exists at 0,
and the global counter is still 100.
(b) The floating pool stays consumable through the normal
pooled paths: a later location-scoped deduction of 30
drains the pool and lands the location at 70, unassigned
at 0, global at 70 -- provisioning changed no deduction
semantics, only the assignment itself.
(c) A product with nothing floating provisions the same
way: location row at 0, global unchanged.

HOW THIS IS DRIVEN: the real InventoryScopeService over
PGlite for the assignment, and the real applyStockDelta
ledger function for the follow-up deduction -- both
production code, figures read from the stored rows.

RED PROOF: on the unfixed tree case (a) leaves the
unassigned balance at 0 and the new location at 100.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { applyStockDelta } from '../../src/common/utils/location-stock-ledger';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['inventory'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, branch_id bigint, location_type text, is_active boolean DEFAULT true);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz DEFAULT NOW());
  `);
  const anyDb = db as any;
  await anyDb.insertInto('stock_locations').values({ id: 5, tenant_id: TENANT, account_id: ACCOUNT, name: 'Warehouse A', branch_id: null, location_type: 'warehouse', is_active: true }).execute();
  // Product 10: 100 units floating, none assigned anywhere.
  await anyDb.insertInto('products').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Widget', stock_qty: 100 }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 10, location_id: null, branch_id: null, qty: 100 }).execute();
  // Product 20: nothing anywhere.
  await anyDb.insertInto('products').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Gadget', stock_qty: 0 }).execute();
  return { pg, db };
}

async function balanceOf(db: Kysely<Database>, productId: number, locationId: number | null): Promise<number | null> {
  let query = (db as any).selectFrom('product_location_stock').select('qty')
    .where('product_id', '=', productId).where('tenant_id', '=', TENANT);
  query = locationId == null ? query.where('location_id', 'is', null) : query.where('location_id', '=', locationId);
  const row = await query.executeTakeFirst();
  return row == null ? null : Number(row.qty);
}

async function globalOf(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('products').select('stock_qty').where('id', '=', productId).executeTakeFirst();
  return Number(row?.stock_qty || 0);
}

async function main(): Promise<void> {
  // (a) Assignment provisions at zero and moves nothing.
  {
    const { pg, db } = await makeDb();
    try {
      const service = new InventoryScopeService(db as any);
      const result = await service.assignProductsToLocation(5, [10], adminAuth);
      assert.equal(result.success, true, 'assignment succeeds');
      assert.equal(await balanceOf(db, 10, null), 100, 'the floating pool stays floating');
      assert.equal(await balanceOf(db, 10, 5), 0, 'the new location row exists at zero');
      assert.equal(await globalOf(db, 10), 100, 'the global counter is untouched');
    } finally {
      await db.destroy();
    }
    console.log('  Location assign provisions at zero passed');
  }

  // (b) The pool stays consumable through the normal pooled paths.
  {
    const { pg, db } = await makeDb();
    try {
      const service = new InventoryScopeService(db as any);
      await service.assignProductsToLocation(5, [10], adminAuth);
      await db.transaction().execute(async (trx) => {
        await applyStockDelta(trx as any, {
          tenantId: TENANT, accountId: ACCOUNT, productId: 10,
          branchId: null, locationId: 5, delta: -30,
        });
      });
      assert.equal(await balanceOf(db, 10, 5), 70, 'the deduction lands at the location');
      assert.equal(await balanceOf(db, 10, null), 0, 'the floating pool is drained by the deduction');
      assert.equal(await globalOf(db, 10), 70, 'the global counter follows the deduction');
    } finally {
      await db.destroy();
    }
    console.log('  Post-assign pooled deduction passed');
  }

  // (c) A product with nothing floating provisions the same way.
  {
    const { pg, db } = await makeDb();
    try {
      const service = new InventoryScopeService(db as any);
      await service.assignProductsToLocation(5, [20], adminAuth);
      assert.equal(await balanceOf(db, 20, 5), 0, 'the new location row exists at zero');
      assert.equal(await globalOf(db, 20), 0, 'the global counter is untouched');
    } finally {
      await db.destroy();
    }
    console.log('  Empty-product assign passed');
  }

  console.log('Location assign no-drain tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
