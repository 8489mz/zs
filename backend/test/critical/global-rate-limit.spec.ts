import { strict as assert } from 'node:assert';
import { HttpException, HttpStatus } from '@nestjs/common';
import { GlobalRateLimitMiddleware } from '../../src/common/middleware/global-rate-limit.middleware';
import { LoginRateLimitMiddleware } from '../../src/common/middleware/login-rate-limit.middleware';
import { InMemoryRateLimitService } from '../../src/common/security/in-memory-rate-limit.service';
import { validateEnv } from '../../src/config/env.schema';

/**
 * S4 (INV-SESSION-GLOBAL-RATE-LIMIT): a global outer request budget on every route.
 * Before S4 there was no global limiter at all — only four scoped mechanisms
 * (login 10/600s, auth burst 60/60s, storefront buckets, table-call guard) — so an
 * unbounded flood on any unscoped route was never refused. The middleware reuses
 * InMemoryRateLimitService (DB-backed, fail-closed in production) and the
 * storefront resolveClientIp; it is disabled in desktop mode like the login
 * limiter, and the scoped limits are untouched (an additional layer, never a
 * replacement).
 *
 * Budget (parent decision D4, validated against the live code at 4bb84885b — see
 * lint-prettier-log.md S4): 600 req / 60 s per IP. No polling exists in the
 * frontend (fastest refetchInterval is 15 s); imports send sequential 1,000-row
 * chunks; POS is one lookup per scan (text debounced 250 ms) + one POST per sale,
 * so the realistic worst case (10 cashiers behind one NAT) is ~300 req/min —
 * 2x headroom under the budget.
 */

class FakeConfigService {
  constructor(private readonly values: Record<string, unknown>) {}
  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
}

function createResponse() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = String(value);
    },
  } as any;
}

async function expectTooManyRequests(fn: () => Promise<void>): Promise<void> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof HttpException, 'Expected HttpException');
  assert.equal((thrown as HttpException).getStatus(), HttpStatus.TOO_MANY_REQUESTS);
}

async function runGlobalLimit(): Promise<void> {
  const service = new InMemoryRateLimitService();
  const middleware = new GlobalRateLimitMiddleware(
    new FakeConfigService({ GLOBAL_RATE_LIMIT_MAX: 3, GLOBAL_RATE_LIMIT_WINDOW_SECONDS: 60 }) as any,
    service,
  );

  const next = () => undefined;
  const req = { ip: '127.0.0.1', path: '/api/sales' } as any;

  // Within the budget: three requests pass.
  for (let i = 0; i < 3; i += 1) {
    const res = createResponse();
    await middleware.use({ ...req }, res, next);
    assert.equal(res.headers['X-RateLimit-Limit'], '3');
    assert.equal(res.headers['X-RateLimit-Remaining'], String(2 - i));
  }

  // The budget is global, not per path: the same IP on another route is refused too.
  const res = createResponse();
  await expectTooManyRequests(async () => {
    await middleware.use({ ip: '127.0.0.1', path: '/api/other' } as any, res, next);
  });
  assert.ok(res.headers['Retry-After'], 'Expected Retry-After on the 429 response');
}

async function runDesktopDisabled(): Promise<void> {
  const service = new InMemoryRateLimitService();
  const middleware = new GlobalRateLimitMiddleware(
    new FakeConfigService({
      APP_MODE: 'SELF_CONTAINED',
      GLOBAL_RATE_LIMIT_MAX: 1,
      GLOBAL_RATE_LIMIT_WINDOW_SECONDS: 60,
    }) as any,
    service,
  );

  const next = () => undefined;
  // A limit of 1 would refuse the second request in cloud mode; in desktop mode
  // every request passes untouched.
  for (let i = 0; i < 3; i += 1) {
    await middleware.use({ ip: '127.0.0.1', path: '/api/sales' } as any, createResponse(), next);
  }
}

async function runPerIpIsolation(): Promise<void> {
  const service = new InMemoryRateLimitService();
  const middleware = new GlobalRateLimitMiddleware(
    new FakeConfigService({ GLOBAL_RATE_LIMIT_MAX: 2, GLOBAL_RATE_LIMIT_WINDOW_SECONDS: 60 }) as any,
    service,
  );
  const next = () => undefined;
  const behindProxy = (realIp: string) =>
    ({ ip: '127.0.0.1', headers: { 'x-real-ip': realIp }, path: '/api/sales' }) as any;

  // The first visitor behind the proxy exhausts its own bucket.
  await middleware.use(behindProxy('41.0.0.1'), createResponse(), next);
  await middleware.use(behindProxy('41.0.0.1'), createResponse(), next);
  await expectTooManyRequests(async () => {
    await middleware.use(behindProxy('41.0.0.1'), createResponse(), next);
  });

  // A second visitor behind the same proxy is unaffected.
  await middleware.use(behindProxy('41.0.0.2'), createResponse(), next);
  await middleware.use(behindProxy('41.0.0.2'), createResponse(), next);

  // A client talking to the app directly cannot forge its way past its own IP.
  const forgedService = new InMemoryRateLimitService();
  const forgedMiddleware = new GlobalRateLimitMiddleware(
    new FakeConfigService({ GLOBAL_RATE_LIMIT_MAX: 1, GLOBAL_RATE_LIMIT_WINDOW_SECONDS: 60 }) as any,
    forgedService,
  );
  const forged = (realIp: string) =>
    ({ ip: '203.0.113.9', headers: { 'x-real-ip': realIp }, path: '/api/sales' }) as any;
  await forgedMiddleware.use(forged('8.8.8.1'), createResponse(), next);
  await expectTooManyRequests(async () => {
    await forgedMiddleware.use(forged('8.8.8.2'), createResponse(), next);
  });
}

async function runScopedLoginLimiterUntouched(): Promise<void> {
  // S4 adds an outer budget; it must not change the scoped login limiter's own
  // numbers (pinned here, and the full login-rate-limit.spec.ts re-runs green).
  const service = new InMemoryRateLimitService();
  const middleware = new LoginRateLimitMiddleware(
    new FakeConfigService({ LOGIN_RATE_LIMIT_MAX: 2, LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60 }) as any,
    service,
  );

  const next = () => undefined;
  await middleware.use({ ip: '127.0.0.1', body: { username: 'admin' } } as any, createResponse(), next);
  await middleware.use({ ip: '127.0.0.1', body: { username: 'admin' } } as any, createResponse(), next);
  await expectTooManyRequests(async () => {
    await middleware.use({ ip: '127.0.0.1', body: { username: 'admin' } } as any, createResponse(), next);
  });
}

function runEnvDefaults(): void {
  const base = {
    NODE_ENV: 'production',
    APP_MODE: 'CLOUD_SAAS',
    DATABASE_HOST: 'db.example.com',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'app',
    DATABASE_USER: 'user',
    DATABASE_PASSWORD: 'password',
    DATABASE_SSL: 'true',
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    CORS_ORIGINS: 'https://app.example.com',
    SMTP_HOST: 'smtp.example.com',
    MAIL_FROM_EMAIL: 'no-reply@example.com',
    TENANT_ID: 'tenant-a',
    ACCOUNT_ID: 'account-a',
    SESSION_CSRF_SECRET: '1234567890123456',
  };

  const parsed = validateEnv(base);
  assert.equal(parsed.GLOBAL_RATE_LIMIT_MAX, 600);
  assert.equal(parsed.GLOBAL_RATE_LIMIT_WINDOW_SECONDS, 60);

  const explicit = validateEnv({ ...base, GLOBAL_RATE_LIMIT_MAX: '50', GLOBAL_RATE_LIMIT_WINDOW_SECONDS: '30' });
  assert.equal(explicit.GLOBAL_RATE_LIMIT_MAX, 50);
  assert.equal(explicit.GLOBAL_RATE_LIMIT_WINDOW_SECONDS, 30);
}

async function main(): Promise<void> {
  await runGlobalLimit();
  await runDesktopDisabled();
  await runPerIpIsolation();
  await runScopedLoginLimiterUntouched();
  runEnvDefaults();
  console.log('global-rate-limit.spec: ok');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
