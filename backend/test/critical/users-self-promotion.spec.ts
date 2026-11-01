/*
New file: backend/test/critical/users-self-promotion.spec.ts
Pins INV-USER-SELF-PROMOTION-FORBIDDEN: an actor must never change their
own role or permissions through the shared user-update helper, which
serves both the single update and the bulk sync.

WHAT THE AUDIT FEARED: any holder of the single delegable permission
canManageUsers could PUT /api/users/<ownId> with role 'admin' and
permissions ['*'] and take over the whole tenant, because
executeUserUpdate wrote the payload verbatim.

WHAT THIS PINS, driving the REAL UsersService on PGlite:
1. Self-promotion of role -> 403 SELF_PROMOTION_FORBIDDEN, row unchanged.
2. Self-change of permissions (same role) -> 403, row unchanged.
3. Self-edit repeating the stored role and permissions (name change) succeeds.
4. The same actor changing ANOTHER user within their own holdings
   (same role, a permission they hold) succeeds. Grants beyond the
   actor's holdings are governed by INV-USER-GRANT-SUBSET (see
   users-grant-subset.spec.ts); the old Case 4 grant of role 'admin'
   with ['*'] by this cashier actor is now forbidden there.
5. The bulk syncUsers path rejects a self-promotion entry the same way.

Harness note: ensureUniqueUsername / ensureUniquePhone read the pool
(this.db) from inside the update transaction. On PGlite's
single-connection dialect a pool read inside db.transaction() deadlocks
and the process exits 0 silently with no error (the same hazard as
resolveSystemAuthContext in the van-FEFO harness). The guard under test
runs before those helpers, so rejection cases are unaffected; for the
success cases the two uniqueness helpers are shadowed on the service
instance in this harness only, and the shadowing is stated here. The
production code is untouched by the harness.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { UsersService } from '../../src/modules/users/users.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't-self-promo';
const ACCOUNT = 'a-self-promo';

function actor(userId: number): AuthContext {
  return {
    userId,
    sessionId: 'sess-spec',
    username: `actor-${userId}`,
    role: 'cashier',
    permissions: ['canManageUsers'],
    tenantId: TENANT,
    accountId: ACCOUNT,
  };
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE users (id bigserial PRIMARY KEY, username text NOT NULL, phone text, password_hash text NOT NULL DEFAULT '', password_salt text NOT NULL DEFAULT '', role text NOT NULL, is_active boolean NOT NULL DEFAULT true, permissions_json text NOT NULL DEFAULT '[]', default_branch_id bigint, display_name text NOT NULL DEFAULT '', must_change_password boolean NOT NULL DEFAULT false, failed_login_count int NOT NULL DEFAULT 0, locked_until timestamptz, tenant_id text NOT NULL, account_id text NOT NULL, created_at timestamptz DEFAULT NOW());
      CREATE TABLE tenants (id text PRIMARY KEY, plan_id text, status text);
      CREATE TABLE sessions (id text PRIMARY KEY, user_id bigint, tenant_id text);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    `);

    const auditStub = { log: async () => undefined };
    const service = new UsersService(db, new TransactionHelper(), auditStub as never);
    // See the header note: pool-reading uniqueness helpers are shadowed
    // in this harness only so success cases can run inside a transaction.
    (service as any).ensureUniqueUsername = async () => undefined;
    (service as any).ensureUniquePhone = async () => undefined;

    async function seedUser(id: number, username: string, role: string, permissions: string[]): Promise<void> {
      await anyDb.insertInto('users').values({
        id, username, phone: `0100000000${id}`, password_hash: 'x', password_salt: 'y',
        role, is_active: true, permissions_json: JSON.stringify(permissions),
        display_name: username, tenant_id: TENANT, account_id: ACCOUNT,
      }).execute();
    }
    async function readUser(id: number): Promise<any> {
      return anyDb.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    }
    function payload(username: string, role: string, permissions: string[], name?: string): any {
      return { username, phone: '01000000001', role, permissions, name: name ?? username };
    }

    await anyDb.insertInto('tenants').values({ id: TENANT, plan_id: null, status: 'active' }).execute();
    await seedUser(1, 'manager', 'cashier', ['canManageUsers']);
    await seedUser(2, 'clerk', 'cashier', []);

    // Case 1: self-promotion of role is rejected and the row is unchanged.
    await assert.rejects(
      service.updateUser(1, payload('manager', 'admin', ['canManageUsers']), actor(1), 'sess-spec'),
      (err: any) => err && err.code === 'SELF_PROMOTION_FORBIDDEN' && err.statusCode === 403,
    );
    const after1 = await readUser(1);
    assert.equal(after1.role, 'cashier');
    assert.equal(after1.permissions_json, JSON.stringify(['canManageUsers']));

    // Case 2: self-change of permissions with the same role is rejected too.
    await assert.rejects(
      service.updateUser(1, payload('manager', 'cashier', ['*', 'canManageUsers']), actor(1), 'sess-spec'),
      (err: any) => err && err.code === 'SELF_PROMOTION_FORBIDDEN' && err.statusCode === 403,
    );
    const after2 = await readUser(1);
    assert.equal(after2.permissions_json, JSON.stringify(['canManageUsers']));

    // Case 3: a self-edit repeating the stored role and permissions succeeds.
    const ok3 = await service.updateUser(1, payload('manager', 'cashier', ['canManageUsers'], 'Manager Renamed'), actor(1), 'sess-spec');
    assert.equal((ok3 as any).ok, true);
    const after3 = await readUser(1);
    assert.equal(after3.display_name, 'Manager Renamed');
    assert.equal(after3.role, 'cashier');

    // Case 4: the same actor changing ANOTHER user within their own
    // holdings (same role, a permission they hold) succeeds.
    const ok4 = await service.updateUser(2, payload('clerk', 'cashier', ['canManageUsers']), actor(1), 'sess-spec');
    assert.equal((ok4 as any).ok, true);
    const after4 = await readUser(2);
    assert.equal(after4.role, 'cashier');
    assert.equal(after4.permissions_json, JSON.stringify(['canManageUsers']));

    // Case 5: the bulk sync path rejects a self-promotion entry the same way.
    await assert.rejects(
      service.syncUsers(
        [{ id: 1, ...payload('manager', 'admin', ['canManageUsers']) }],
        actor(1),
        'sess-spec',
      ),
      (err: any) => err && err.code === 'SELF_PROMOTION_FORBIDDEN' && err.statusCode === 403,
    );
    const after5 = await readUser(1);
    assert.equal(after5.role, 'cashier');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('users self-promotion checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
