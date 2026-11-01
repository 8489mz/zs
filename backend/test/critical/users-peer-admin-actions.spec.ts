/*
New file: backend/test/critical/users-peer-admin-actions.spec.ts
Pins INV-USER-PEER-ADMIN-ACTIONS: an actor may reset the password of,
or change the active state of, only a user whose stored role ranks
strictly BELOW their own (super_admin 3 > admin 2 > cashier 1).

WHAT THE AUDIT FEARED: INV-USER-GRANT-SUBSET stopped a delegated
canManageUsers holder from promoting OTHER users, but executeUserUpdate
wrote the payload password and isActive verbatim for other rows. The
same holder could reset a fellow admin's password — the update revokes
the victim's sessions, so the attacker then logs in as them — or
disable every fellow admin. The grant guard never saw it, because it
inspects only the role/permissions fields.

WHAT THIS PINS, driving the REAL UsersService on PGlite (harness notes
mirror users-grant-subset.spec.ts: pool-reading uniqueness helpers are
shadowed on the instance for success cases only; rejection cases fail
before them; every actor row is seeded so the guard reads the STORED
role):
1. An admin resetting a cashier's password succeeds; the hash changes
   and the cashier's sessions are revoked.
2. An admin resetting a peer admin's password -> 403
   PASSWORD_RESET_TARGET_RANK_FORBIDDEN; hash, salt, and sessions
   untouched.
3. An admin disabling a peer admin -> 403
   STATUS_CHANGE_TARGET_RANK_FORBIDDEN; the peer stays active.
4. An admin disabling a cashier succeeds.
5. An admin re-enabling a disabled peer admin (isActive true, stored
   false) -> 403 STATUS_CHANGE_TARGET_RANK_FORBIDDEN.
6. A platform super_admin resetting an admin's password succeeds
   (rank 3 above rank 2).
7. A cashier holding canManageUsers resetting an admin's password ->
   403 PASSWORD_RESET_TARGET_RANK_FORBIDDEN.
8. Bulk disable by an admin: the peer admin is skipped with a reason
   and stays active; the cashier is disabled (disabledCount 1).
9. Boundary, deliberately unchanged: an admin demoting a peer admin
   to cashier (no password, no status change) still succeeds — downward
   grants stay governed by INV-USER-GRANT-SUBSET, not by this guard.
10. A status-neutral edit of a peer admin (same active state, no
    password) is not blocked by this guard.

Deliberately NOT driven here: user deletion (own-password
re-authentication, unchanged), unlock (lock counters only, unchanged),
and self password change via PUT me/password (old password required,
unchanged).
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

const TENANT = 't-peer-admin';
const PLATFORM_TENANT = 'zs';
const ACCOUNT = 'a-peer-admin';

function actor(userId: number, tenantId: string, role: string, permissions: string[]): AuthContext {
  return {
    userId,
    sessionId: 'sess-spec',
    username: `actor-${userId}`,
    role,
    permissions,
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
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
    (service as any).ensureUniqueUsername = async () => undefined;
    (service as any).ensureUniquePhone = async () => undefined;
    (service as any).getPlanLimitForTenant = async () => ({
      maxUsers: null, isUnlimited: true, isLimitReached: false,
      activeUsersCount: 0, planName: 'spec', planCode: null,
    });

    async function seedUser(id: number, tenantId: string, username: string, role: string, permissions: string[], isActive = true): Promise<void> {
      await anyDb.insertInto('users').values({
        id, username, phone: `010000000${String(id).padStart(2, '0')}`, password_hash: 'old-hash', password_salt: 'old-salt',
        role, is_active: isActive, permissions_json: JSON.stringify(permissions),
        display_name: username, tenant_id: tenantId, account_id: ACCOUNT,
      }).execute();
    }
    async function readUser(id: number): Promise<any> {
      return anyDb.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    }
    async function sessionCount(userId: number): Promise<number> {
      const rows = await anyDb.selectFrom('sessions').select('id').where('user_id', '=', userId).execute();
      return rows.length;
    }
    function payload(username: string, role: string, permissions: string[], extra?: Record<string, unknown>): any {
      return { username, phone: '01000000001', role, name: username, permissions, isActive: true, ...extra };
    }

    await anyDb.insertInto('tenants').values({ id: TENANT, plan_id: null, status: 'active' }).execute();
    await anyDb.insertInto('tenants').values({ id: PLATFORM_TENANT, plan_id: null, status: 'active' }).execute();

    // Tenant actors/targets: 1 = admin, 2 = peer admin, 3 = cashier, 4 = cashier holder.
    await seedUser(1, TENANT, 'admin-one', 'admin', ['canManageUsers']);
    await seedUser(2, TENANT, 'admin-two', 'admin', ['canManageUsers']);
    await seedUser(3, TENANT, 'clerk', 'cashier', []);
    await seedUser(4, TENANT, 'clerk-holder', 'cashier', ['canManageUsers']);
    await seedUser(5, TENANT, 'disabled-peer', 'admin', ['canManageUsers'], false);
    // Platform actors/targets: 6 = super_admin, 7 = platform admin.
    await seedUser(6, PLATFORM_TENANT, 'platform-root', 'super_admin', ['*']);
    await seedUser(7, PLATFORM_TENANT, 'platform-admin', 'admin', ['canManageUsers']);

    const adminActor = actor(1, TENANT, 'admin', ['canManageUsers']);
    const cashierHolderActor = actor(4, TENANT, 'cashier', ['canManageUsers']);
    const platformActor = actor(6, PLATFORM_TENANT, 'super_admin', ['*']);

    // 1. Admin resets a cashier's password: succeeds, hash changes, sessions revoked.
    await anyDb.insertInto('sessions').values({ id: 'sess-clerk', user_id: 3, tenant_id: TENANT }).execute();
    const resetCashier = await service.updateUser(3, payload('clerk', 'cashier', [], { password: 'Str0ng!Pass9' }), adminActor);
    assert.equal((resetCashier as any).ok, true);
    const clerkAfter = await readUser(3);
    assert.notEqual(clerkAfter.password_hash, 'old-hash');
    assert.equal(await sessionCount(3), 0);

    // 2. Admin resets a peer admin's password: 403, row and sessions untouched.
    await anyDb.insertInto('sessions').values({ id: 'sess-peer', user_id: 2, tenant_id: TENANT }).execute();
    await assert.rejects(
      () => service.updateUser(2, payload('admin-two', 'admin', ['canManageUsers'], { password: 'Str0ng!Pass9' }), adminActor),
      /PASSWORD_RESET_TARGET_RANK_FORBIDDEN/,
    );
    const peerAfter = await readUser(2);
    assert.equal(peerAfter.password_hash, 'old-hash');
    assert.equal(peerAfter.password_salt, 'old-salt');
    assert.equal(await sessionCount(2), 1);

    // 3. Admin disables a peer admin: 403, peer stays active.
    await assert.rejects(
      () => service.updateUser(2, payload('admin-two', 'admin', ['canManageUsers'], { isActive: false }), adminActor),
      /STATUS_CHANGE_TARGET_RANK_FORBIDDEN/,
    );
    assert.equal((await readUser(2)).is_active, true);

    // 4. Admin disables a cashier: succeeds.
    const disableCashier = await service.updateUser(3, payload('clerk', 'cashier', [], { isActive: false }), adminActor);
    assert.equal((disableCashier as any).ok, true);
    assert.equal((await readUser(3)).is_active, false);

    // 5. Admin re-enables a disabled peer admin: 403.
    await assert.rejects(
      () => service.updateUser(5, payload('disabled-peer', 'admin', ['canManageUsers'], { isActive: true }), adminActor),
      /STATUS_CHANGE_TARGET_RANK_FORBIDDEN/,
    );
    assert.equal((await readUser(5)).is_active, false);

    // 6. Platform super_admin resets an admin's password: succeeds.
    const platformReset = await service.updateUser(7, payload('platform-admin', 'admin', ['canManageUsers'], { password: 'Str0ng!Pass9' }), platformActor);
    assert.equal((platformReset as any).ok, true);
    assert.notEqual((await readUser(7)).password_hash, 'old-hash');

    // 7. Cashier holder resets an admin's password: 403. The payload
    // keeps role/permissions within the holder's own holdings so the
    // grant guard passes and only the peer-action guard can fire.
    await assert.rejects(
      () => service.updateUser(2, payload('admin-two', 'cashier', [], { password: 'Str0ng!Pass9' }), cashierHolderActor),
      /PASSWORD_RESET_TARGET_RANK_FORBIDDEN/,
    );

    // 8. Bulk disable by an admin: peer skipped, cashier disabled.
    await anyDb.updateTable('users').set({ is_active: true } as any).where('id', '=', 3).execute();
    const bulk = await service.bulkDisableUsers([2, 3], adminActor) as any;
    assert.equal(bulk.disabledCount, 1);
    assert.equal(bulk.skippedCount, 1);
    assert.equal(String(bulk.skipped[0].id), '2');
    assert.equal((await readUser(2)).is_active, true);
    assert.equal((await readUser(3)).is_active, false);

    // 9. Boundary: demoting a peer admin (no password, no status change) is unchanged.
    const demote = await service.updateUser(2, payload('admin-two', 'cashier', [], { isActive: true }), adminActor);
    assert.equal((demote as any).ok, true);
    assert.equal((await readUser(2)).role, 'cashier');

    // 10. Status-neutral edit of a peer admin is not blocked by this guard.
    await anyDb.updateTable('users').set({ role: 'admin' } as any).where('id', '=', 2).execute();
    const neutral = await service.updateUser(2, payload('admin-two-renamed', 'admin', ['canManageUsers'], { isActive: true }), adminActor);
    assert.equal((neutral as any).ok, true);
    assert.equal((await readUser(2)).username, 'admin-two-renamed');

    // eslint-disable-next-line no-console
    console.log('users peer admin actions checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
