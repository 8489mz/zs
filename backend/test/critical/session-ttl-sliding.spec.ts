import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import type { Database } from '../../src/database/database.types';
import {
  SessionService,
  isMfaChallenge,
  type AuthenticatedSessionResult,
} from '../../src/core/auth/services/session.service';
import { SessionsController } from '../../src/modules/sessions/sessions.controller';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

/**
 * S1 (INV-SESSION-TTL-7D-SLIDING): sessions expire after 7 days of inactivity,
 * with sliding renewal on the cache-miss resolve path.
 *
 * - A login mints a session that expires in 7 days, not 30.
 * - Resolving a session whose remaining TTL is below 24 h extends `expires_at`
 *   to now + 7 days and stamps `last_seen_at`; the session id never changes
 *   (CSRF is derived from it).
 * - Resolving a session with >= 24 h remaining writes nothing.
 * - A session idle past its expiry is rejected.
 *
 * S2 (INV-SESSION-ME-COOKIE-DB-EXPIRY): `GET /api/auth/me` sets the session
 * cookie to the DB row's expiry — as resolved (and possibly renewed) by
 * `resolveAuthContext` — never a freshly computed 30-day value.
 *
 * - /me on a fresh session: the cookie expiry equals the stored row's
 *   `expires_at` (within 1 s), for both the session and the CSRF cookie.
 * - /me after a renewal: the cookie carries the RENEWED expiry, not the old one.
 * - An expired session resolves to null, so /me is unreachable (the guard
 *   401s — that half is pinned in session-auth.guard.spec.ts, not here).
 * - The /me payload shape is unchanged: exactly the pre-S2 top-level keys.
 *
 * Host note: this file (not session-auth.spec.ts) hosts the /me pins.
 * session-auth.spec.ts drives a FakeDb with no `sessions` select/join, so
 * `resolveAuthContext` — the only path that knows the DB expiry — cannot be
 * driven against it; extending the fake would test the fake, not the real
 * code. This PGlite fixture drives the real service and the real controller.
 *
 * Drives the real SessionService against PGlite (no FakeDb — the resolve path
 * is a join and the renewal is an UPDATE, both proven against real SQL).
 * Tenant 'zs' is the platform tenant, so `assertTenantLoginAllowed` returns
 * early and no subscription tables are needed. A fresh SessionService (fresh
 * AuthCacheService) is built per resolve case: the 60 s in-memory cache would
 * otherwise hide the DB behaviour on the second resolve of the same id.
 * Prospective only: rows already stored keep their `expires_at` until they
 * are renewed or expire; no migration touches them.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

type CookieCall = { name: string; value: unknown; options: { expires?: Date } };

function captureCookies() {
  const calls: CookieCall[] = [];
  const res = {
    cookie(name: string, value: unknown, options: { expires?: Date }) {
      calls.push({ name, value, options });
    },
  };
  return { res, calls };
}

function findCookie(calls: CookieCall[], name: string): CookieCall {
  const found = calls.find((call) => call.name === name);
  assert.ok(found, `/me must set the ${name} cookie`);
  return found;
}

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
        must_change_password boolean, display_name text, default_branch_id bigint);
      CREATE TABLE sessions (id text PRIMARY KEY, user_id bigint, tenant_id text,
        account_id text, expires_at timestamptz, last_seen_at timestamptz,
        ip_address text, user_agent text, impersonated_by text, created_at timestamptz);
      CREATE TABLE user_mfa (user_id bigint, tenant_id text, confirmed_at timestamptz);
      CREATE TABLE tenant_feature_overrides (tenant_id text, feature_code text, granted boolean);
      CREATE TABLE user_branches (user_id bigint, branch_id bigint, tenant_id text);
      CREATE TABLE settings (key text, value text, tenant_id text);
      CREATE TABLE tenant_tax_settings (tenant_id text, provider text, is_active boolean);
    `);
    await db
      .insertInto('tenants')
      .values({
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
        trial_ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      })
      .execute();

    const password = await createPasswordRecord('correct-horse');
    await db
      .insertInto('users')
      .values({
        id: 1,
        username: 'admin',
        phone: null,
        password_hash: password.hash,
        password_salt: password.salt,
        role: 'admin',
        permissions_json: '[]',
        is_active: true,
        locked_until: null,
        failed_login_count: 0,
        tenant_id: 'zs',
        account_id: 'default',
        display_name: 'Admin Root',
        must_change_password: false,
      })
      .execute();

    const newService = () => new SessionService(db, new FakeConfigService() as any, { log: async () => {} } as any);

    // (a) A login mints a session that expires in 7 days, not 30.
    const beforeLogin = Date.now();
    const login = expectSession(await newService().authenticate('admin', 'correct-horse'));
    const afterLogin = Date.now();
    assert.ok(
      login.expiresAt.getTime() >= beforeLogin + SEVEN_DAYS_MS - 1000 &&
        login.expiresAt.getTime() <= afterLogin + SEVEN_DAYS_MS + 1000,
      `login session must expire in 7 days, got ${login.expiresAt.toISOString()}`,
    );
    const loginRow = await db
      .selectFrom('sessions')
      .select(['id', 'expires_at', 'last_seen_at'])
      .where('id', '=', login.sessionId)
      .executeTakeFirstOrThrow();
    assert.equal(
      loginRow.expires_at.getTime(),
      login.expiresAt.getTime(),
      'the stored row must carry the same expiry the login returned',
    );

    // (b) Remaining TTL below 24 h: resolve extends expires_at to now + 7 days.
    const shortSessionId = 'short-lived-session';
    const shortSeenAt = new Date(Date.now() - 6 * DAY_MS);
    await db
      .insertInto('sessions')
      .values({
        id: shortSessionId,
        user_id: 1,
        tenant_id: 'zs',
        account_id: 'default',
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000),
        last_seen_at: shortSeenAt,
        ip_address: '',
        user_agent: 'spec',
      })
      .execute();
    const beforeResolve = Date.now();
    const shortAuth = await newService().resolveAuthContext(shortSessionId);
    const afterResolve = Date.now();
    assert.ok(shortAuth, 'a session with 12 h remaining must still resolve');
    assert.equal(shortAuth?.sessionId, shortSessionId, 'renewal must not change the session id');
    const shortRow = await db
      .selectFrom('sessions')
      .select(['id', 'expires_at', 'last_seen_at'])
      .where('id', '=', shortSessionId)
      .executeTakeFirstOrThrow();
    assert.equal(shortRow.id, shortSessionId, 'renewal is an UPDATE, never a re-insert');
    assert.ok(
      shortRow.expires_at.getTime() >= beforeResolve + SEVEN_DAYS_MS - 1000 &&
        shortRow.expires_at.getTime() <= afterResolve + SEVEN_DAYS_MS + 1000,
      `a session with < 24 h remaining must be renewed to now + 7 days, got ${shortRow.expires_at.toISOString()}`,
    );
    assert.ok(shortRow.last_seen_at, 'the renewed row must carry a last_seen_at stamp');
    assert.ok(shortRow.last_seen_at.getTime() > shortSeenAt.getTime(), 'renewal must stamp last_seen_at');

    // (c) Remaining TTL at or above 24 h: resolve writes nothing.
    const freshSessionId = 'fresh-session';
    const freshExpiresAt = new Date(Date.now() + 3 * DAY_MS);
    const freshSeenAt = new Date(Date.now() - 60 * 60 * 1000);
    await db
      .insertInto('sessions')
      .values({
        id: freshSessionId,
        user_id: 1,
        tenant_id: 'zs',
        account_id: 'default',
        expires_at: freshExpiresAt,
        last_seen_at: freshSeenAt,
        ip_address: '',
        user_agent: 'spec',
      })
      .execute();
    const freshAuth = await newService().resolveAuthContext(freshSessionId);
    assert.ok(freshAuth, 'a session with 3 days remaining must still resolve');
    const freshRow = await db
      .selectFrom('sessions')
      .select(['expires_at', 'last_seen_at'])
      .where('id', '=', freshSessionId)
      .executeTakeFirstOrThrow();
    assert.ok(
      Math.abs(freshRow.expires_at.getTime() - freshExpiresAt.getTime()) < 1000,
      'a session with >= 24 h remaining must NOT be extended',
    );
    assert.ok(freshRow.last_seen_at, 'the untouched row must still carry its last_seen_at stamp');
    assert.ok(
      Math.abs(freshRow.last_seen_at.getTime() - freshSeenAt.getTime()) < 1000,
      'a session with >= 24 h remaining must NOT stamp last_seen_at',
    );

    // (d) Idle past expiry: resolve rejects the session.
    const deadSessionId = 'dead-session';
    await db
      .insertInto('sessions')
      .values({
        id: deadSessionId,
        user_id: 1,
        tenant_id: 'zs',
        account_id: 'default',
        expires_at: new Date(Date.now() - 60 * 60 * 1000),
        last_seen_at: new Date(Date.now() - 8 * DAY_MS),
        ip_address: '',
        user_agent: 'spec',
      })
      .execute();
    const deadAuth = await newService().resolveAuthContext(deadSessionId);
    assert.equal(deadAuth, null, 'a session idle past its expiry must be rejected');

    // S2 (e) /me on a fresh session: the cookie expiry equals the DB row's
    // expires_at, never a freshly computed 30 days.
    const meService = newService();
    const meAuth = await meService.resolveAuthContext(login.sessionId);
    assert.ok(meAuth, '/me requires a resolvable session');
    const meRow = await db
      .selectFrom('sessions')
      .select(['expires_at'])
      .where('id', '=', login.sessionId)
      .executeTakeFirstOrThrow();
    const meController = new SessionsController(
      meService,
      {} as any,
      new FakeConfigService({ SESSION_CSRF_SECRET: 'spec-secret' }) as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const { res: meRes, calls: meCalls } = captureCookies();
    const mePayload = await meController.me({ authContext: meAuth, headers: {} } as any, meRes as any);
    const meSessionCookie = findCookie(meCalls, 'session_id');
    assert.equal(meSessionCookie.value, login.sessionId, '/me must re-set the same session id');
    assert.ok(meSessionCookie.options.expires instanceof Date, 'the session cookie must carry an expiry');
    assert.ok(
      Math.abs(meSessionCookie.options.expires.getTime() - meRow.expires_at.getTime()) < 1000,
      `/me session cookie must equal the DB row expiry, got ${meSessionCookie.options.expires.toISOString()} vs row ${meRow.expires_at.toISOString()}`,
    );
    const meCsrfCookie = findCookie(meCalls, 'csrf_token');
    assert.ok(
      meCsrfCookie.options.expires instanceof Date &&
        Math.abs(meCsrfCookie.options.expires.getTime() - meRow.expires_at.getTime()) < 1000,
      'the CSRF cookie must carry the same DB row expiry',
    );
    assert.deepEqual(
      Object.keys(mePayload).sort(),
      ['security', 'settings', 'tenant', 'user'],
      'the /me payload shape must not change',
    );
    assert.equal((mePayload.user as any).username, 'admin', '/me must still return the user');

    // S2 (f) /me after a renewal: the cookie carries the RENEWED expiry.
    const renewSessionId = 'renew-me-session';
    await db
      .insertInto('sessions')
      .values({
        id: renewSessionId,
        user_id: 1,
        tenant_id: 'zs',
        account_id: 'default',
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000),
        last_seen_at: new Date(Date.now() - 6 * DAY_MS),
        ip_address: '',
        user_agent: 'spec',
      })
      .execute();
    const renewService = newService();
    const renewAuth = await renewService.resolveAuthContext(renewSessionId);
    assert.ok(renewAuth, 'a session with 12 h remaining must still resolve for /me');
    const renewRow = await db
      .selectFrom('sessions')
      .select(['expires_at'])
      .where('id', '=', renewSessionId)
      .executeTakeFirstOrThrow();
    assert.ok(
      renewRow.expires_at.getTime() > Date.now() + 6 * DAY_MS,
      'the resolve must actually have renewed the row before /me runs',
    );
    const renewController = new SessionsController(
      renewService,
      {} as any,
      new FakeConfigService({ SESSION_CSRF_SECRET: 'spec-secret' }) as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const { res: renewRes, calls: renewCalls } = captureCookies();
    await renewController.me({ authContext: renewAuth, headers: {} } as any, renewRes as any);
    const renewCookie = findCookie(renewCalls, 'session_id');
    assert.ok(
      renewCookie.options.expires instanceof Date &&
        Math.abs(renewCookie.options.expires.getTime() - renewRow.expires_at.getTime()) < 1000,
      `/me must return the RENEWED expiry after a renewal, got ${renewCookie.options.expires?.toISOString()} vs row ${renewRow.expires_at.toISOString()}`,
    );

    // S2 (g) An expired session resolves to null, so /me is unreachable.
    // The 401 itself is guard-owned (session-auth.guard.spec.ts pins a null
    // resolve to UnauthorizedException); here we pin the resolve half.
    const deadAuthForMe = await newService().resolveAuthContext(deadSessionId);
    assert.equal(deadAuthForMe, null, 'an expired session must not reach /me');

    console.log('session TTL sliding renewal checks passed');
    console.log('session /me cookie alignment checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
