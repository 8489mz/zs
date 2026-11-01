/*
New file: backend/test/critical/users-grant-subset.spec.ts
Pins INV-USER-GRANT-SUBSET: no actor may grant a permission they do not
themselves hold, the granted role may not exceed the actor's own role,
and '*' (grant-everything) may be granted only from the platform tenant.

WHAT THE AUDIT FEARED: Batch 1 P1 froze SELF-promotion, but a delegated
canManageUsers holder could still promote OTHER users to admin with
['*'], because executeUserUpdate wrote the payload role/permissions
verbatim for other rows. The same hole existed on creation (POST
/api/users and the bulk sync create path), so the guard covers
executeUserCreate too; otherwise the update guard would be bypassable
by creating a new admin instead of promoting one.

WHAT THIS PINS, driving the REAL UsersService on PGlite:
1. Granting a permission the actor holds succeeds.
2. Granting a permission the actor lacks -> 403
   GRANT_EXCEEDS_ACTOR_PERMISSIONS, row unchanged.
3. A cashier granting role 'admin' -> 403 GRANT_ROLE_ABOVE_ACTOR, even
   when every granted permission is one they hold.
4. Granting '*' outside the platform tenant -> 403
   GRANT_STAR_FORBIDDEN, including by an actor who holds '*' themselves.
5. An actor holding '*' may grant ordinary permissions (their '*' counts
   as holding everything).
6. An admin granting role 'admin' with held permissions succeeds.
7. Platform tenant: a super_admin granting '*' succeeds; a platform
   admin granting 'super_admin' -> 403 GRANT_ROLE_ABOVE_ACTOR.
8. Creation: a delegated holder creating a user with a permission they
   lack -> 403, no row created; creating within their holdings succeeds.
9. Omitted permissions keep their current meaning (writes []).
10. Self-edits are still governed by SELF_PROMOTION_FORBIDDEN, which
    takes precedence over the grant codes.
11. The bulk syncUsers path rejects an over-broad grant atomically: an
    earlier valid entry in the same batch is rolled back too.

Role ordering used by the guard (the only roles the DTO allows):
super_admin (3) > admin (2) > cashier (1); the effective role is
compared after the existing super_admin-to-admin demotion outside the
platform tenant, exactly like the self-guard.

Harness note: ensureUniqueUsername / ensureUniquePhone read the pool
(this.db) from inside the update transaction, and getPlanLimitForTenant
reads the pool from inside the create transaction. On PGlite's
single-connection dialect a pool read inside db.transaction() deadlocks
and the process exits 0 silently with no error (the same hazard as the
P1 spec). The guard under test runs before those helpers, so rejection
cases are unaffected; for the success cases the three helpers are
shadowed on the service instance in this harness only, and the
shadowing is stated here. The production code is untouched by the
harness. The actor row is seeded for every actor, so the guard reads
the actor's STORED role/permissions; the AuthContext fallback is not
exercised here.
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

const TENANT = 't-grant-subset';
const PLATFORM_TENANT = 'zs';
const ACCOUNT = 'a-grant-subset';

function actor(userId: number, tenantId: string, role: string, permissions: string[]): AuthContext {
  return {
    userId,
    sessionId: 'sess-spec',
    username: `actor-${userId}`,
    role,
    permissions,
    tenantId,
    accountId: ACCOUNT,
  };
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE users (id bigserial PRIMARY KEY, username text NOT NULL, phone text, password_hash text NOT NULL DEFAULT '', password_salt text NOT NULL DEFAULT '', role text NOT NULL, is_active boolean NOT NULL DEFAULT true, permissions_json text NOT NULL DEFAULT '[]', default_branch_id bigint, display_name text NOT NULL DEFAULT '', must_change_password boolean NOT NULL DEFAULT false, failed_login_count int NOT NULL DEFAULT 0, locked_until timestamptz, last_login_at timestamptz, tenant_id text NOT NULL, account_id text NOT NULL, created_at timestamptz DEFAULT NOW());
      CREATE TABLE tenants (id text PRIMARY KEY, plan_id text, status text);
      CREATE TABLE sessions (id text PRIMARY KEY, user_id bigint, tenant_id text);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    `);

    const auditStub = { log: async () => undefined };
    const service = new UsersService(db, new TransactionHelper(), auditStub as never);
    // See the header note: pool-reading helpers are shadowed in this
    // harness only so success cases can run inside a transaction.
    (service as any).ensureUniqueUsername = async () => undefined;
    (service as any).ensureUniquePhone = async () => undefined;
    (service as any).getPlanLimitForTenant = async () => ({
      maxUsers: null, isUnlimited: true, isLimitReached: false,
      activeUsersCount: 0, planName: 'spec', planCode: null,
    });

    async function seedUser(id: number, tenantId: string, username: string, role: string, permissions: string[]): Promise<void> {
      await anyDb.insertInto('users').values({
        id, username, phone: `010000000${String(id).padStart(2, '0')}`, password_hash: 'x', password_salt: 'y',
        role, is_active: true, permissions_json: JSON.stringify(permissions),
        display_name: username, tenant_id: tenantId, account_id: ACCOUNT,
      }).execute();
    }
    async function readUser(id: number): Promise<any> {
      return anyDb.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    }
    async function countUsers(tenantId: string): Promise<number> {
      const rows = await anyDb.selectFrom('users').select('id').where('tenant_id', '=', tenantId).execute();
      return rows.length;
    }
    function payload(username: string, role: string, permissions?: string[], extra?: Record<string, unknown>): any {
      const body: any = { username, phone: '01000000001', role, name: username, ...extra };
      if (permissions !== undefined) body.permissions = permissions;
      return body;
    }
    function createPayload(username: string, role: string, permissions?: string[]): any {
      return { ...payload(username, role, permissions), password: 'Str0ng!Pass9', phone: `010000009${String(Math.floor(Math.random() * 90) + 10)}` };
    }

    await anyDb.insertInto('tenants').values({ id: TENANT, plan_id: null, status: 'active' }).execute();
    await anyDb.insertInto('tenants').values({ id: PLATFORM_TENANT, plan_id: null, status: 'active' }).execute();
    await seedUser(1, TENANT, 'manager', 'cashier', ['canManageUsers']);
    await seedUser(2, TENANT, 'clerk', 'cashier', []);
    await seedUser(3, TENANT, 'boss', 'admin', ['canManageUsers']);
    await seedUser(4, TENANT, 'starowner', 'admin', ['*']);
    await seedUser(10, PLATFORM_TENANT, 'root', 'super_admin', ['*']);
    await seedUser(11, PLATFORM_TENANT, 'padmin', 'admin', ['canManageUsers']);
    await seedUser(12, PLATFORM_TENANT, 'ptarget', 'cashier', []);
    // Explicit-id seeds do not advance the bigserial sequence; without
    // this the first created row collides with a seeded id (users_pkey).
    await pg.exec(`SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users));`);

    const manager = actor(1, TENANT, 'cashier', ['canManageUsers']);
    const boss = actor(3, TENANT, 'admin', ['canManageUsers']);
    const starOwner = actor(4, TENANT, 'admin', ['*']);
    const root = actor(10, PLATFORM_TENANT, 'super_admin', ['*']);
    const padmin = actor(11, PLATFORM_TENANT, 'admin', ['canManageUsers']);

    // Case 1: granting a permission the actor holds succeeds.
    const ok1 = await service.updateUser(2, payload('clerk', 'cashier', ['canManageUsers']), manager, 'sess-spec');
    assert.equal((ok1 as any).ok, true);
    assert.equal((await readUser(2)).permissions_json, JSON.stringify(['canManageUsers']));

    // Case 2: granting a permission the actor lacks is rejected, row unchanged.
    await assert.rejects(
      service.updateUser(2, payload('clerk', 'cashier', ['canManageBackups']), manager, 'sess-spec'),
      (err: any) => err && err.code === 'GRANT_EXCEEDS_ACTOR_PERMISSIONS' && err.statusCode === 403,
    );
    assert.equal((await readUser(2)).permissions_json, JSON.stringify(['canManageUsers']));

    // Case 3: a cashier granting role 'admin' is rejected even when the
    // granted permissions are all ones they hold.
    await assert.rejects(
      service.updateUser(2, payload('clerk', 'admin', ['canManageUsers']), manager, 'sess-spec'),
      (err: any) => err && err.code === 'GRANT_ROLE_ABOVE_ACTOR' && err.statusCode === 403,
    );
    assert.equal((await readUser(2)).role, 'cashier');

    // Case 4: granting '*' outside the platform tenant is rejected.
    await assert.rejects(
      service.updateUser(2, payload('clerk', 'cashier', ['*']), manager, 'sess-spec'),
      (err: any) => err && err.code === 'GRANT_STAR_FORBIDDEN' && err.statusCode === 403,
    );
    assert.equal((await readUser(2)).permissions_json, JSON.stringify(['canManageUsers']));

    // Case 4b: even an actor who holds '*' may not grant it outside the
    // platform tenant.
    await assert.rejects(
      service.updateUser(2, payload('clerk', 'cashier', ['*']), starOwner, 'sess-spec'),
      (err: any) => err && err.code === 'GRANT_STAR_FORBIDDEN' && err.statusCode === 403,
    );

    // Case 5: an actor holding '*' may grant ordinary permissions.
    const ok5 = await service.updateUser(2, payload('clerk', 'cashier', ['canManageBackups']), starOwner, 'sess-spec');
    assert.equal((ok5 as any).ok, true);
    assert.equal((await readUser(2)).permissions_json, JSON.stringify(['canManageBackups']));

    // Case 6: an admin granting role 'admin' with held permissions succeeds.
    const ok6 = await service.updateUser(2, payload('clerk', 'admin', ['canManageUsers']), boss, 'sess-spec');
    assert.equal((ok6 as any).ok, true);
    assert.equal((await readUser(2)).role, 'admin');

    // Case 7: platform tenant — a super_admin granting '*' succeeds, but
    // a platform admin granting 'super_admin' exceeds their own role.
    const ok7 = await service.updateUser(12, payload('ptarget', 'admin', ['*']), root, 'sess-spec');
    assert.equal((ok7 as any).ok, true);
    assert.equal((await readUser(12)).permissions_json, JSON.stringify(['*']));
    await assert.rejects(
      service.updateUser(12, payload('ptarget', 'super_admin', ['canManageUsers']), padmin, 'sess-spec'),
      (err: any) => err && err.code === 'GRANT_ROLE_ABOVE_ACTOR' && err.statusCode === 403,
    );
    assert.equal((await readUser(12)).role, 'admin');

    // Case 8: creation — a delegated holder creating a user with a
    // permission they lack is rejected and creates no row; creating
    // within their holdings succeeds.
    const beforeCreate = await countUsers(TENANT);
    await assert.rejects(
      service.createUser(createPayload('newclerk', 'cashier', ['canManageBackups']), manager),
      (err: any) => err && err.code === 'GRANT_EXCEEDS_ACTOR_PERMISSIONS' && err.statusCode === 403,
    );
    assert.equal(await countUsers(TENANT), beforeCreate);
    const ok8 = await service.createUser(createPayload('newclerk', 'cashier', ['canManageUsers']), manager);
    assert.equal((ok8 as any).ok, true);
    assert.equal(await countUsers(TENANT), beforeCreate + 1);

    // Case 9: omitted permissions keep their current meaning (writes []).
    const ok9 = await service.updateUser(2, payload('clerk', 'cashier'), boss, 'sess-spec');
    assert.equal((ok9 as any).ok, true);
    assert.equal((await readUser(2)).permissions_json, JSON.stringify([]));

    // Case 10: self-edits are still governed by SELF_PROMOTION_FORBIDDEN,
    // which takes precedence over the grant codes.
    await assert.rejects(
      service.updateUser(1, payload('manager', 'admin', ['canManageUsers']), manager, 'sess-spec'),
      (err: any) => err && err.code === 'SELF_PROMOTION_FORBIDDEN' && err.statusCode === 403,
    );
    assert.equal((await readUser(1)).role, 'cashier');

    // Case 11: the bulk sync path rejects an over-broad grant atomically.
    await assert.rejects(
      service.syncUsers(
        [
          { id: 2, ...payload('clerk', 'cashier', ['canManageUsers']) },
          { id: 2, ...payload('clerk', 'cashier', ['canManageBackups']) },
        ],
        manager,
        'sess-spec',
      ),
      (err: any) => err && err.code === 'GRANT_EXCEEDS_ACTOR_PERMISSIONS' && err.statusCode === 403,
    );
    // The first entry's write was rolled back with the rejected batch.
    assert.equal((await readUser(2)).permissions_json, JSON.stringify([]));
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => console.log('users grant subset checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
