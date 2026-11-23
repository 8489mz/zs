/*
 * INV-PERMISSIONS-CACHE-INVALIDATION: permissions-cache invalidation
 * coverage gaps (execution plan section 2).
 *
 * GROUNDING (re-verified in code at HEAD 52af05ae8, not taken from the
 * plan's line numbers): AuthCacheService (backend/src/core/auth/services/
 * auth-cache.service.ts) is an in-process Map with a 60s session TTL that
 * caches the full AuthContext. UsersService.updateUser invalidates on
 * commit (CORE-005), as do changePassword, syncUsers, deleteUser and
 * bulkDisableUsers — but updateProfile (users.service.ts) wrote the row
 * with NO invalidation. This package adds invalidateUserSessions(id) to
 * updateProfile, on the same commit-then-invalidate order updateUser
 * uses. The 60s TTL is NOT shortened and no second process / cluster
 * mode is added (AGENTS.md section 1-c forbids cluster mode: the auth
 * cache lives in process memory).
 *
 * PREMISE CORRECTION, pinned here so a later reader does not re-derive
 * the wrong field: the cached AuthContext carries `username`, NOT
 * `display_name` (see backend/src/core/auth/interfaces/
 * auth-context.interface.ts — there is no displayName field).
 * display_name is re-read fresh from the users row by
 * SessionService.getSessionUserProfile on every cache miss, so the
 * /me payload was never stale — but the cached `username` IS stale
 * after updateProfile renames the user, and that stale username is
 * what audit rows (actor.username), guards and every other
 * auth.username consumer see for up to 60s. The behavioural test
 * below therefore pins the USERNAME case, the real stale field.
 *
 * FIVE-WRITER AUDIT (proven from the code path, not asserted):
 * 1. bootstrap-admin.service.ts — INSERT-only for new users
 *    (ensureBootstrapUser returns early when the user exists; the 'zs'
 *    insert runs only when the row is missing). Its two
 *    updateTable('users') writes both live inside
 *    ensurePlatformSuperAdminIntegrity, which runs ONLY from
 *    onApplicationBootstrap — before the server listens, when the
 *    in-process cache of the fresh process is necessarily empty.
 *    The static ratchet below pins both facts (2 inserts / 2 updates
 *    / a single call site inside onApplicationBootstrap). SAFE.
 * 2. activation.service.ts — one insertInto('users'), zero updates:
 *    a brand-new admin created inside first-time activation; the
 *    user has no sessions to stale. SAFE.
 * 3. trial-tenant-provisioning.service.ts — one insertInto('users'),
 *    zero updates: a brand-new tenant admin created inside trial
 *    provisioning; no sessions exist yet. SAFE.
 * 4. demo-data/settings-demo-data-seed.ts — one insertInto('users'), zero
 *    updates, guarded by `if (!existing)` per username per tenant:
 *    demo users are only ever inserted, never rewritten. SAFE.
 * 5. migration 2040000000309_kitchen_permission_backfill.ts — a
 *    one-time migration that ADDS 'kitchen' to users holding 'sales'.
 *    It cannot call AuthCacheService (a DB migration has no access
 *    to the running process's memory). It runs at deploy before the
 *    folder swap, and the deploy restarts the process, so the new
 *    process starts with an empty cache. Worst case the OLD process
 *    serves its pre-migration cache for the remainder of the 60s TTL
 *    — a newly GRANTED permission arriving at most 60s late, never a
 *    revoked permission lingering. SAFE, bounded by the TTL.
 * No writer needed a code change; the ratchet below fails if any of
 * the five grows an update path without invalidation.
 *
 * HONEST LIMITS (recorded, not fixed): the cache is in-process
 * memory, so a SECOND server process (if one ever ran) would still
 * hold stale sessions until its own TTL — cluster mode is forbidden
 * by AGENTS.md section 1-c, so this package does not invent a
 * cross-process fix. The migration case above is bounded by the TTL
 * for the same reason. Live-trial check still owed: rename a user on
 * the live tenant and confirm the next request carries the new name
 * with no 60s wait.
 *
 * Fail-first: with the updateProfile invalidation removed, the
 * behavioural test fails (resolveAuthContext keeps returning
 * 'oldname' from the cache); with it present it passes. Proven by
 * running this spec against the unpatched service before the fix.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Kysely } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { KYSELY_DB } from '../../src/database/database.constants';
import { DatabaseModule } from '../../src/database/database.module';
import { AuditModule } from '../../src/core/audit/audit.module';
import type { Database } from '../../src/database/database.types';
import { AuthCacheService } from '../../src/core/auth/services/auth-cache.service';
import { AuthFoundationModule } from '../../src/core/auth/auth.module';
import { UsersModule } from '../../src/modules/users/users.module';
import { SessionService } from '../../src/core/auth/services/session.service';
import { UsersService } from '../../src/modules/users/users.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend', 'src');

/*
 * Nest resolves a service's constructor deps inside ITS OWN module's
 * scope, so a ConfigService provided at the testing-module root is
 * invisible to AuthFoundationModule. The fake config therefore lives
 * in its own @Global module (the same mechanism the production
 * AuthFoundationModule / DatabaseModule / AuditModule use), and the
 * PGlite database replaces DatabaseModule's KYSELY_DB factory via
 * overrideProvider (the factory itself would open a real pg Pool).
 */
function fakeConfigModule(fakeConfig: ConfigService): any {
  @Global()
  @Module({ providers: [{ provide: ConfigService, useValue: fakeConfig }], exports: [ConfigService] })
  class FakeConfigModule {}
  return FakeConfigModule;
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await db.schema
      .createTable('tenants')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('slug', 'text', (col) => col.notNull())
      .addColumn('business_name', 'text', (col) => col.notNull())
      .addColumn('owner_name', 'text', (col) => col.notNull())
      .addColumn('owner_phone', 'text', (col) => col.notNull())
      .addColumn('owner_email', 'text')
      .addColumn('activity_type', 'text')
      .addColumn('status', 'text', (col) => col.notNull())
      .addColumn('trial_starts_at', 'timestamptz', (col) => col.notNull())
      .addColumn('trial_ends_at', 'timestamptz', (col) => col.notNull())
      .addColumn('activated_at', 'timestamptz')
      .addColumn('plan_id', 'text')
      .addColumn('extra_features', 'jsonb')
      .addColumn('country_code', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
      .execute();
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('username', 'text', (col) => col.notNull())
      .addColumn('phone', 'text')
      .addColumn('password_hash', 'text', (col) => col.notNull())
      .addColumn('password_salt', 'text', (col) => col.notNull())
      .addColumn('role', 'text', (col) => col.notNull())
      .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
      .addColumn('permissions_json', 'text', (col) => col.notNull().defaultTo('[]'))
      .addColumn('default_branch_id', 'integer')
      .addColumn('display_name', 'text', (col) => col.notNull())
      .addColumn('must_change_password', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('failed_login_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('locked_until', 'timestamptz')
      .addColumn('last_login_at', 'timestamptz')
      .addColumn('tenant_id', 'text', (col) => col.notNull())
      .addColumn('account_id', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
      .execute();
    await db.schema
      .createTable('sessions')
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('tenant_id', 'text')
      .addColumn('account_id', 'text')
      .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
      .addColumn('last_seen_at', 'timestamptz')
      .addColumn('ip_address', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('user_agent', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('impersonated_by', 'integer')
      .execute();
    await db.schema
      .createTable('user_branches')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('branch_id', 'integer', (col) => col.notNull())
      .addColumn('tenant_id', 'text')
      .addColumn('account_id', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
      .execute();
    await db.schema
      .createTable('audit_logs')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'text')
      .addColumn('account_id', 'text')
      .addColumn('action', 'text', (col) => col.notNull())
      .addColumn('event_code', 'text')
      .addColumn('idempotency_key', 'text')
      .addColumn('details', 'text', (col) => col.notNull())
      .addColumn('target_tenant_id', 'text')
      .addColumn('created_by', 'integer')
      .addColumn('impersonated_by', 'integer')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo('now()'))
      .execute();

    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sessionExpiry = new Date(now.getTime() + 60 * 60 * 1000);
    await db
      .insertInto('tenants')
      .values({
        id: 'tenant-test',
        slug: 'tenant-test',
        business_name: 'Tenant Test',
        owner_name: 'Owner',
        owner_phone: '01000000000',
        owner_email: null,
        activity_type: 'retail_general',
        status: 'trial',
        trial_starts_at: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        trial_ends_at: future,
        activated_at: now,
        plan_id: null,
        extra_features: '[]',
        country_code: 'EG',
      })
      .execute();
    await db
      .insertInto('users')
      .values({
        id: 1,
        username: 'oldname',
        phone: null,
        password_hash: 'hash-1',
        password_salt: 'salt-1',
        role: 'admin',
        is_active: true,
        permissions_json: JSON.stringify(['pos', 'sales']),
        default_branch_id: null,
        display_name: 'Old Name',
        must_change_password: false,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        tenant_id: 'tenant-test',
        account_id: 'tenant-test',
      })
      .execute();
    await db
      .insertInto('users')
      .values({
        id: 2,
        username: 'other',
        phone: null,
        password_hash: 'hash-2',
        password_salt: 'salt-2',
        role: 'cashier',
        is_active: true,
        permissions_json: JSON.stringify(['pos']),
        default_branch_id: null,
        display_name: 'Other',
        must_change_password: false,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        tenant_id: 'tenant-test',
        account_id: 'tenant-test',
      })
      .execute();
    await db
      .insertInto('sessions')
      .values([
        {
          id: 'sess-1',
          user_id: 1,
          tenant_id: 'tenant-test',
          account_id: 'tenant-test',
          expires_at: sessionExpiry,
          last_seen_at: null,
          ip_address: '',
          user_agent: '',
          impersonated_by: null,
        },
        {
          id: 'sess-2',
          user_id: 2,
          tenant_id: 'tenant-test',
          account_id: 'tenant-test',
          expires_at: sessionExpiry,
          last_seen_at: null,
          ip_address: '',
          user_agent: '',
          impersonated_by: null,
        },
      ])
      .execute();

    const fakeConfig = { get: (_key: string): undefined => undefined } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      imports: [fakeConfigModule(fakeConfig), DatabaseModule, AuditModule, AuthFoundationModule, UsersModule],
    })
      .overrideProvider(KYSELY_DB)
      .useValue(db)
      .compile();
    try {
      const cache = moduleRef.get(AuthCacheService);
      const usersService = moduleRef.get(UsersService);
      const sessionService = moduleRef.get(SessionService);

      /* ---------------------------------------------------------- */
      /* 1. One shared instance: invalidation from UsersService     */
      /*    must be visible to SessionService, and vice versa.      */
      /*    AuthFoundationModule is @Global, so Nest must inject    */
      /*    its singleton into both services — never a private      */
      /*    `new AuthCacheService()` per service.                   */
      /* ---------------------------------------------------------- */
      const usersCache = (usersService as unknown as { authCache: AuthCacheService }).authCache;
      const sessionCache = (sessionService as unknown as { authCache: AuthCacheService }).authCache;
      assert.equal(usersCache, cache, 'UsersService must hold the shared AuthCacheService singleton from AuthFoundationModule');
      assert.equal(sessionCache, cache, 'SessionService must hold the shared AuthCacheService singleton from AuthFoundationModule');
      assert.equal(usersCache, sessionCache, 'both services must hold the SAME instance — never a private copy each');

      const actor: AuthContext = {
        userId: 1,
        sessionId: 'sess-1',
        username: 'oldname',
        role: 'admin',
        permissions: ['pos', 'sales'],
        tenantId: 'tenant-test',
        accountId: 'tenant-test',
      };

      /* ---------------------------------------------------------- */
      /* 2. Fail-first target: updateProfile must invalidate the    */
      /*    cached session, so the next request re-resolves the     */
      /*    renamed user from the DB instead of serving the old     */
      /*    username for up to 60s.                                */
      /* ---------------------------------------------------------- */
      const first = await sessionService.resolveAuthContext('sess-1');
      assert.ok(first, 'resolveAuthContext must resolve the seeded session');
      assert.equal(first.username, 'oldname', 'first resolve must carry the pre-rename username');
      assert.equal(cache.getSession('sess-1')?.username, 'oldname', 'the first resolve must have cached the old username');
      const other = await sessionService.resolveAuthContext('sess-2');
      assert.ok(other, 'the second user session must resolve');
      assert.equal(other.username, 'other', 'second resolve must carry the other username');

      await usersService.updateProfile({ username: 'newname', name: 'New Name' }, actor);

      assert.equal(cache.getSession('sess-1'), null, 'updateProfile must invalidate the renamed user sessions immediately (no 60s wait)');
      assert.ok(cache.getSession('sess-2'), 'invalidation is per-user: the other user session must survive');
      const after = await sessionService.resolveAuthContext('sess-1');
      assert.ok(after, 'resolve after updateProfile must still resolve the session from the DB');
      assert.equal(after.username, 'newname', 'the next request after updateProfile must see the NEW username, not the cached old one');

      const renamed = await db.selectFrom('users').select(['username', 'display_name']).where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(renamed.username, 'newname', 'the users row itself must carry the new username');
      assert.equal(renamed.display_name, 'New Name', 'the users row itself must carry the new display name');

      /* ---------------------------------------------------------- */
      /* 3. Regression pin: the pre-existing updateUser path        */
      /*    (CORE-005) still invalidates through the same shared    */
      /*    instance — here as a REAL permission change: the admin  */
      /*    grants the cashier 'sales' (a subset of the admin's     */
      /*    own holdings, so the grant-subset guard allows it).     */
      /* ---------------------------------------------------------- */
      await sessionService.resolveAuthContext('sess-1');
      await sessionService.resolveAuthContext('sess-2');
      assert.equal(cache.getSession('sess-1')?.username, 'newname', 're-resolve must re-cache the new username');
      assert.equal(cache.getSession('sess-2')?.username, 'other', 're-resolve must re-cache the other user');
      await usersService.updateUser(
        2,
        { username: 'other', phone: '01000000001', role: 'cashier', permissions: ['pos', 'sales'], name: 'Other', isActive: true },
        { ...actor, username: 'newname', permissions: ['pos', 'sales'] },
      );
      assert.equal(cache.getSession('sess-2'), null, 'updateUser must still invalidate the changed user sessions on commit (CORE-005)');
      assert.ok(cache.getSession('sess-1'), 'invalidation is per-user: the admin session must survive the cashier update');
      const changed = await db.selectFrom('users').select(['permissions_json']).where('id', '=', 2).executeTakeFirstOrThrow();
      assert.equal(changed.permissions_json, JSON.stringify(['pos', 'sales']), 'the cashier row itself must carry the newly granted permissions');
      const afterUpdateUser = await sessionService.resolveAuthContext('sess-2');
      assert.equal(afterUpdateUser, null, 'updateUser also revokes the DB session rows, so the session must no longer resolve');

      /* ---------------------------------------------------------- */
      /* 4. Static ratchet: the TTL stays 60s (invalidation, not   */
      /*    TTL, is the mechanism) and the five unaudited writers   */
      /*    keep exactly their audited shape. Any new update path   */
      /*    in one of them fails here until it is audited.         */
      /* ---------------------------------------------------------- */
      const cacheSource = fs.readFileSync(path.join(BACKEND_SRC, 'core', 'auth', 'services', 'auth-cache.service.ts'), 'utf8');
      assert.ok(
        cacheSource.includes('private readonly defaultSessionTtl = 60'),
        'the session TTL must stay 60s — invalidation is the mechanism, never a shorter TTL',
      );

      const readService = (relative: string): string =>
        fs.readFileSync(path.join(BACKEND_SRC, relative), 'utf8');
      const writerInventory: Array<{ file: string; inserts: number; updates: number }> = [
        { file: 'modules/activation/activation.service.ts', inserts: 1, updates: 0 },
        { file: 'modules/saas-admin/trial-tenant-provisioning.service.ts', inserts: 1, updates: 0 },
        { file: 'modules/settings/services/demo-data/settings-demo-data-seed.ts', inserts: 1, updates: 0 },
      ];
      for (const entry of writerInventory) {
        const source = readService(entry.file);
        assert.equal(
          countOccurrences(source, "insertInto('users')"),
          entry.inserts,
          `${entry.file} must keep exactly ${entry.inserts} users insert(s) — a new insert is a new writer to audit`,
        );
        assert.equal(
          countOccurrences(source, "updateTable('users')"),
          entry.updates,
          `${entry.file} must keep zero users updates — a new update path needs invalidation or a documented safe reason`,
        );
      }

      const bootstrapSource = readService('core/auth/services/bootstrap-admin.service.ts');
      assert.equal(countOccurrences(bootstrapSource, "insertInto('users')"), 2, 'bootstrap-admin must keep exactly 2 users inserts (seed + zs provision)');
      assert.equal(countOccurrences(bootstrapSource, "updateTable('users')"), 2, 'bootstrap-admin must keep exactly 2 users updates (both inside the bootstrap-only integrity repair)');
      assert.equal(
        countOccurrences(bootstrapSource, 'ensurePlatformSuperAdminIntegrity()'),
        2,
        'ensurePlatformSuperAdminIntegrity must have exactly one definition and one call site',
      );
      const bootstrapBody = bootstrapSource.slice(bootstrapSource.indexOf('async onApplicationBootstrap'));
      assert.ok(
        bootstrapBody.includes('ensurePlatformSuperAdminIntegrity()'),
        'the single ensurePlatformSuperAdminIntegrity call must live inside onApplicationBootstrap (fresh process, empty cache)',
      );

      const migrationPath = path.join(BACKEND_SRC, 'database', 'migrations', '2040000000309_kitchen_permission_backfill.ts');
      assert.ok(fs.existsSync(migrationPath), 'the kitchen backfill migration must still exist at its pinned number');
      const referencingFiles: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile() && entry.name.endsWith('.ts') && full !== migrationPath) {
            if (fs.readFileSync(full, 'utf8').includes('2040000000309')) referencingFiles.push(full);
          }
        }
      };
      walk(BACKEND_SRC);
      assert.deepEqual(referencingFiles, [], 'no backend source file may import the one-time kitchen backfill migration');

      const usersSource = readService('modules/users/users.service.ts');
      assert.ok(
        usersSource.includes('this.authCache.invalidateUserSessions(id);'),
        'users.service.ts must call invalidateUserSessions on the profile-update path',
      );
    } finally {
      await moduleRef.close();
    }
  } finally {
    await db.destroy();
  }
  console.log('permissions-cache-invalidation: OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
