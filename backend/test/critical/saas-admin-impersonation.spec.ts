import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database } from '../../src/database/database.types';
import {
  SessionService,
  isMfaChallenge,
  type AuthenticatedSessionResult,
} from '../../src/core/auth/services/session.service';
import {
  SaasAdminSession,
  type SaasAdminSessionBoundDeps,
} from '../../src/modules/saas-admin/saas-admin/saas-admin-session';
import { AuditService, AUDIT_EVENT_CODES } from '../../src/core/audit/audit.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { isPlatformTenantId } from '../../src/core/auth/utils/tenant-boundary';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/**
 * S5 (INV-SESSION-IMPERSONATION-TTL-ALIGNED): SaaS-admin impersonation
 * sessions use the same TTL as regular sessions.
 *
 * - `impersonateTenant` mints the impersonation session with SESSION_TTL_MS
 *   (7 days), not 24 hours. The row and the returned expiry agree.
 * - `exitImpersonation` returns the ORIGINAL session's real stored expiry
 *   (as resolved — and possibly renewed — by `resolveAuthContext`), not a
 *   freshly computed 30 days. Both results feed `setAuthCookies`
 *   (saas-admin.controller.ts), so the cookie and the DB row can no longer
 *   disagree on the super-admin path — the same disagreement S2 closed for
 *   regular sessions.
 * - An impersonation session is a session row like any other: it renews
 *   under the S1 sliding rule, and renewal keeps the impersonator stamp.
 * - The audit calls carry NO TTL (action/details/eventCode/targetTenantId
 *   only), so S5 changes no audit record's meaning; the spec pins the
 *   audit rows anyway. The start/end rows are the admin's own actions
 *   (created_by = admin, impersonated_by = null); the owner attribution
 *   applies to actions taken DURING the visit, via the impersonated auth
 *   (pinned in (a) as imp.auth.impersonatedBy = 1, and its mapping onto
 *   the row by impersonation-audit-trail.spec.ts).
 *
 * Host note: this file (not impersonation-audit-trail.spec.ts) hosts the
 * TTL pins. That file drives ONLY `AuditService` with a FakeDb and never
 * constructs `SaasAdminSession`; extending its fake would test the fake,
 * not the real code (the S2 host-decision precedent). This PGlite fixture
 * drives the real `SaasAdminSession` + real `SessionService` + real
 * `AuditService`. The bound deps replicate the real
 * `saas-admin.service.ts` methods faithfully against the same PGlite DB
 * (platform-access check, tenant lookup, owner lookup) — they are the
 * service's own queries, not stubs of the behaviour under test.
 * Tenant 'tenant-a' is status 'active' with a seeded active subscription,
 * because `assertTenantLoginAllowed` expires an active tenant with no
 * subscription — the impersonated resolve would return null otherwise.
 * Prospective only: rows already stored keep their `expires_at` until
 * they are renewed or expire; no migration touches them.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

class FakeConfigService {
  constructor(private readonly values: Record<string, unknown> = {}) {}
  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
}

function expectSession(result: Awaited<ReturnType<SessionService['authenticate']>>): AuthenticatedSessionResult {
  assert.ok(result, 'expected a successful login');
  assert.ok(!isMfaChallenge(result), 'an account without MFA must get a session, not a challenge');
  return result as AuthenticatedSessionResult;
}

/** Bound deps faithful to saas-admin.service.ts, against the same PGlite DB. */
function boundDeps(db: Kysely<Database>): SaasAdminSessionBoundDeps {
  return {
    assertPlatformAccess: (auth: AuthContext): void => {
      if (auth.role !== 'super_admin') {
        throw new ForbiddenException('غير مسموح: هذه الشاشة مخصصة لمسؤول المنصة فقط.');
      }
      const tenantId = String(auth.tenantId || '').trim();
      if (!tenantId || !isPlatformTenantId(tenantId)) {
        throw new ForbiddenException('غير مسموح: هذه الشاشة مخصصة لمسؤول المنصة فقط.');
      }
    },
    getTenantForMutation: async (id: string) => {
      const tenant = await db.selectFrom('tenants').selectAll().where('id', '=', id).executeTakeFirst();
      if (!tenant) throw new NotFoundException('النسخة غير موجودة.');
      return tenant;
    },
    assertNotPlatformTenantTarget: (targetTenantId: string): void => {
      const tid = String(targetTenantId || '').trim();
      if (isPlatformTenantId(tid)) {
        throw new ForbiddenException('لا يمكن تعديل حالة نسخة المنصة من هذه الصفحة.');
      }
    },
    getOwnerUserForTenant: async (tenantId: string) => {
      const owner = await db
        .selectFrom('users')
        .select([
          'id',
          'username',
          'tenant_id',
          'account_id',
          'is_active',
          'must_change_password',
          'failed_login_count',
          'locked_until',
        ])
        .where('tenant_id', '=', tenantId)
        .where('role', 'in', ['super_admin', 'admin'])
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .executeTakeFirst();
      if (!owner) throw new NotFoundException('مستخدم مالك النسخة غير موجود.');
      return owner;
    },
  };
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, business_name text,
        status text, trial_ends_at timestamptz, created_at timestamptz,
        updated_at timestamptz, plan_id text, extra_features text,
        activity_type text, owner_email text, owner_name text, owner_phone text,
        trial_starts_at timestamptz);
      CREATE TABLE users (id bigint PRIMARY KEY, username text, phone text,
        password_hash text, password_salt text, role text, permissions_json text,
        is_active boolean, locked_until timestamptz, failed_login_count int,
        tenant_id text, account_id text, last_login_at timestamptz,
        must_change_password boolean, display_name text, default_branch_id bigint,
        created_at timestamptz DEFAULT now());
      CREATE TABLE sessions (id text PRIMARY KEY, user_id bigint, tenant_id text,
        account_id text, expires_at timestamptz, last_seen_at timestamptz,
        ip_address text, user_agent text, impersonated_by bigint,
        created_at timestamptz DEFAULT now());
      CREATE TABLE user_mfa (user_id bigint, tenant_id text, confirmed_at timestamptz);
      CREATE TABLE tenant_feature_overrides (tenant_id text, feature_code text, granted boolean);
      CREATE TABLE tenant_subscriptions (id serial PRIMARY KEY, tenant_id text,
        plan_id int, status text, starts_at timestamptz, ends_at timestamptz,
        grace_ends_at timestamptz, auto_renew boolean,
        created_at timestamptz DEFAULT now(), updated_at timestamptz);
      CREATE TABLE audit_logs (id serial PRIMARY KEY, tenant_id text, account_id text,
        action text, event_code text, idempotency_key text, details text,
        target_tenant_id text, created_by bigint, impersonated_by bigint,
        created_at timestamptz DEFAULT now());
    `);
    await db
      .insertInto('tenants')
      .values([
        {
          id: 'zs',
          slug: 'zs',
          business_name: 'Platform',
          status: 'active',
          plan_id: null,
          extra_features: '[]',
          activity_type: null,
          owner_name: 'Platform',
          owner_phone: '',
          trial_starts_at: new Date(),
          trial_ends_at: new Date(Date.now() + 365 * DAY_MS),
        },
        {
          id: 'tenant-a',
          slug: 'tenant-a',
          business_name: 'Tenant A',
          status: 'active',
          plan_id: null,
          extra_features: '[]',
          activity_type: null,
          owner_name: 'Owner A',
          owner_phone: '',
          trial_starts_at: new Date(),
          trial_ends_at: new Date(Date.now() + 365 * DAY_MS),
        },
      ])
      .execute();
    await db
      .insertInto('tenant_subscriptions')
      .values({
        tenant_id: 'tenant-a',
        plan_id: 1,
        status: 'active',
        starts_at: new Date(),
        ends_at: new Date(Date.now() + 365 * DAY_MS),
        grace_ends_at: null,
        auto_renew: true,
      })
      .execute();

    const password = await createPasswordRecord('correct-horse');
    await db
      .insertInto('users')
      .values([
        {
          id: 1,
          username: 'root',
          phone: null,
          password_hash: password.hash,
          password_salt: password.salt,
          role: 'super_admin',
          permissions_json: '[]',
          is_active: true,
          locked_until: null,
          failed_login_count: 0,
          tenant_id: 'zs',
          account_id: 'default',
          display_name: 'Root',
          must_change_password: false,
        },
        {
          id: 2,
          username: 'owner-a',
          phone: null,
          password_hash: password.hash,
          password_salt: password.salt,
          role: 'admin',
          permissions_json: '[]',
          is_active: true,
          locked_until: null,
          failed_login_count: 0,
          tenant_id: 'tenant-a',
          account_id: 'tenant-a:main',
          display_name: 'Owner A',
          must_change_password: false,
        },
      ])
      .execute();

    const newService = () => new SessionService(db, new FakeConfigService() as any, { log: async () => {} } as any);
    const platformService = newService();

    // Platform admin login (the original session exit must return).
    const login = expectSession(await platformService.authenticate('root', 'correct-horse'));
    const platformAuth = login.auth;
    assert.equal(platformAuth.role, 'super_admin', 'the platform login must keep the super_admin role');
    assert.equal(platformAuth.tenantId, 'zs', 'the platform login must stay on the platform tenant');

    const saas = new SaasAdminSession(
      db,
      new AuditService(db),
      new FakeConfigService() as any,
      platformService,
      {} as any,
      boundDeps(db),
    );

    // (a) impersonateTenant mints a session that expires in 7 days, not 24 h.
    const beforeImpersonate = Date.now();
    const imp = await saas.impersonateTenant('tenant-a', platformAuth);
    const afterImpersonate = Date.now();
    assert.ok(
      imp.expiresAt.getTime() >= beforeImpersonate + SEVEN_DAYS_MS - 1000 &&
        imp.expiresAt.getTime() <= afterImpersonate + SEVEN_DAYS_MS + 1000,
      `impersonation session must expire in 7 days, got ${imp.expiresAt.toISOString()}`,
    );
    const impRow = await db
      .selectFrom('sessions')
      .select(['id', 'user_id', 'tenant_id', 'account_id', 'expires_at', 'impersonated_by'])
      .where('id', '=', imp.sessionId)
      .executeTakeFirstOrThrow();
    assert.equal(
      impRow.expires_at.getTime(),
      imp.expiresAt.getTime(),
      'the stored row must carry the same expiry impersonateTenant returned',
    );
    assert.equal(Number(impRow.user_id), 2, 'the impersonation session must run as the tenant owner');
    assert.equal(impRow.tenant_id, 'tenant-a', 'the impersonation session must belong to the visited tenant');
    assert.equal(Number(impRow.impersonated_by), 1, 'the row must stamp the platform admin as impersonator');
    assert.ok(imp.auth, 'impersonateTenant must return a resolved auth context');
    assert.equal(imp.auth.tenantId, 'tenant-a', 'the impersonated auth must be scoped to the visited tenant');
    assert.equal(Number(imp.auth.impersonatedBy), 1, 'the impersonated auth must carry the impersonator');
    assert.ok(
      imp.auth.expiresAt && Math.abs(imp.auth.expiresAt.getTime() - impRow.expires_at.getTime()) < 1000,
      'the returned auth must carry the S2 row expiry',
    );
    assert.equal(imp.originalSessionId, login.sessionId, 'impersonateTenant must return the original session id');

    // (c) The impersonation session renews under the S1 sliding rule.
    // (Runs before (b): exit deletes the impersonation row.)
    await db
      .updateTable('sessions')
      .set({ expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000) })
      .where('id', '=', imp.sessionId)
      .execute();
    const beforeRenew = Date.now();
    const renewAuth = await newService().resolveAuthContext(imp.sessionId);
    const afterRenew = Date.now();
    assert.ok(renewAuth, 'an impersonation session with 12 h remaining must still resolve');
    assert.equal(renewAuth.sessionId, imp.sessionId, 'renewal must not change the session id');
    const renewedRow = await db
      .selectFrom('sessions')
      .select(['expires_at', 'impersonated_by'])
      .where('id', '=', imp.sessionId)
      .executeTakeFirstOrThrow();
    assert.ok(
      renewedRow.expires_at.getTime() >= beforeRenew + SEVEN_DAYS_MS - 1000 &&
        renewedRow.expires_at.getTime() <= afterRenew + SEVEN_DAYS_MS + 1000,
      `an impersonation session with < 24 h remaining must be renewed to now + 7 days, got ${renewedRow.expires_at.toISOString()}`,
    );
    assert.equal(Number(renewedRow.impersonated_by), 1, 'renewal must keep the impersonator stamp');

    // (b) exitImpersonation returns the ORIGINAL session's real stored expiry.
    const origRow = await db
      .selectFrom('sessions')
      .select(['expires_at'])
      .where('id', '=', login.sessionId)
      .executeTakeFirstOrThrow();
    const exit = await saas.exitImpersonation(login.sessionId, imp.auth);
    assert.equal(exit.sessionId, login.sessionId, 'exit must return the original session id');
    assert.equal(
      exit.expiresAt.getTime(),
      origRow.expires_at.getTime(),
      `exit must return the original row expiry, not a fresh 30 days, got ${exit.expiresAt.toISOString()} vs row ${origRow.expires_at.toISOString()}`,
    );
    assert.ok(exit.expiresAt.getTime() < Date.now() + 8 * DAY_MS, 'exit must not mint a 30-day expiry');
    const gone = await db.selectFrom('sessions').select(['id']).where('id', '=', imp.sessionId).executeTakeFirst();
    assert.equal(gone, undefined, 'exit must delete the temporary impersonation session');

    // Audit rows: the start and end are the admin's own actions — the
    // owner attribution applies to rows written DURING the visit, via
    // the impersonated auth (pinned in (a)). No TTL is recorded.
    const auditRows = await db
      .selectFrom('audit_logs')
      .select(['event_code', 'created_by', 'impersonated_by', 'tenant_id'])
      .orderBy('id', 'asc')
      .execute();
    assert.equal(auditRows.length, 2, 'impersonate + exit must write exactly two audit rows');
    assert.equal(auditRows[0].event_code, AUDIT_EVENT_CODES.SAAS_IMPERSONATION_STARTED);
    assert.equal(Number(auditRows[0].created_by), 1, 'the start row is the admin starting the visit');
    assert.equal(auditRows[0].impersonated_by, null, 'the start row must not look impersonated');
    assert.equal(auditRows[1].event_code, AUDIT_EVENT_CODES.SAAS_IMPERSONATION_ENDED);
    assert.equal(Number(auditRows[1].created_by), 1, 'the end row is the admin returning');
    assert.equal(auditRows[1].impersonated_by, null, 'the end row must not look impersonated');

    // (b2) Exit with a short original session returns the RENEWED expiry:
    // resolveAuthContext inside exit renews it (S1), and exit must return
    // that resolved value, not a computed one.
    await db
      .insertInto('sessions')
      .values({
        id: 'orig-short',
        user_id: 1,
        tenant_id: 'zs',
        account_id: 'default',
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000),
        last_seen_at: new Date(Date.now() - 6 * DAY_MS),
        ip_address: '',
        user_agent: 'spec',
      })
      .execute();
    const imp2 = await saas.impersonateTenant('tenant-a', platformAuth);
    const beforeExit2 = Date.now();
    const exit2 = await saas.exitImpersonation('orig-short', imp2.auth);
    const afterExit2 = Date.now();
    assert.equal(exit2.sessionId, 'orig-short', 'exit must return the short original session id');
    assert.ok(
      exit2.expiresAt.getTime() >= beforeExit2 + SEVEN_DAYS_MS - 1000 &&
        exit2.expiresAt.getTime() <= afterExit2 + SEVEN_DAYS_MS + 1000,
      `exit with a short original session must return the RENEWED expiry, got ${exit2.expiresAt.toISOString()}`,
    );
    const shortRow = await db
      .selectFrom('sessions')
      .select(['expires_at'])
      .where('id', '=', 'orig-short')
      .executeTakeFirstOrThrow();
    assert.equal(
      shortRow.expires_at.getTime(),
      exit2.expiresAt.getTime(),
      'the renewed row must carry the expiry exit returned',
    );

    console.log('saas-admin impersonation TTL alignment checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
