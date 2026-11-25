import { strict as assert } from 'node:assert';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { createCsrfToken } from '../../src/core/auth/utils/csrf-token';

class FakeSessionService {
  async resolveAuthContext(sessionId: string) {
    if (sessionId !== 'session-1') return null;
    return {
      userId: 7,
      sessionId,
      username: 'admin',
      role: 'super_admin',
      permissions: ['settings'],
      tenantId: 'tenant-a',
      accountId: 'account-a',
    };
  }
}

class FakeConfigService {
  constructor(private readonly values: Record<string, unknown>) {}
  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }
}

function createContext(request: Record<string, unknown>) {
  const response = {
    cookie: () => response,
    clearCookie: () => response,
    setHeader: () => response,
    status: () => response,
    json: () => response,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as any;
}

async function expectThrows(fn: () => Promise<unknown>, ctor: new (...args: any[]) => Error): Promise<void> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof ctor, `Expected ${ctor.name}`);
}

async function run(): Promise<void> {
  const csrfSecret = 'super-secret-csrf-key';
  const csrfToken = createCsrfToken('session-1', csrfSecret);
  const guard = new SessionAuthGuard(
    new FakeSessionService() as any,
    new FakeConfigService({ SESSION_CSRF_SECRET: csrfSecret, ALLOW_SESSION_ID_HEADER: false }) as any,
  );

  const safeGetRequest: any = {
    method: 'GET',
    headers: {
      cookie: 'session_id=session-1',
    },
  };
  const canAccessGet = await guard.canActivate(createContext(safeGetRequest));
  assert.equal(canAccessGet, true);
  assert.equal(safeGetRequest.authContext.username, 'admin');

  await expectThrows(
    () =>
      guard.canActivate(
        createContext({
          method: 'GET',
          headers: { cookie: 'session_id=session-1', 'x-tenant-id': 'tenant-b' },
        } as any),
      ),
    ForbiddenException,
  );

  const canAccessScopedGet = await guard.canActivate(
    createContext({
      method: 'GET',
      headers: { cookie: 'session_id=session-1', 'x-tenant-id': 'tenant-a', 'x-account-id': 'account-a' },
    } as any),
  );
  assert.equal(canAccessScopedGet, true);

  const unsafeMissingCsrf: any = {
    method: 'POST',
    headers: {
      cookie: 'session_id=session-1',
    },
  };
  await expectThrows(() => guard.canActivate(createContext(unsafeMissingCsrf)), ForbiddenException);

  const unsafeValidCsrf: any = {
    method: 'DELETE',
    headers: {
      cookie: `session_id=session-1; csrf_token=${csrfToken}`,
      'x-csrf-token': csrfToken,
    },
  };
  const canAccessUnsafe = await guard.canActivate(createContext(unsafeValidCsrf));
  assert.equal(canAccessUnsafe, true);

  const blockedHeaderSessionGuard = new SessionAuthGuard(
    new FakeSessionService() as any,
    new FakeConfigService({
      SESSION_CSRF_SECRET: csrfSecret,
      ALLOW_SESSION_ID_HEADER: false,
      NODE_ENV: 'production',
    }) as any,
  );
  await expectThrows(
    () =>
      blockedHeaderSessionGuard.canActivate(
        createContext({ method: 'GET', headers: { 'x-session-id': 'session-1' } } as any),
      ),
    UnauthorizedException,
  );

  const allowedHeaderSessionGuard = new SessionAuthGuard(
    new FakeSessionService() as any,
    new FakeConfigService({
      SESSION_CSRF_SECRET: csrfSecret,
      ALLOW_SESSION_ID_HEADER: true,
      APP_MODE: 'SELF_CONTAINED',
    }) as any,
  );
  const allowed = await allowedHeaderSessionGuard.canActivate(
    createContext({ method: 'GET', headers: { 'x-session-id': 'session-1' } } as any),
  );
  assert.equal(allowed, true);
}

run().then(() => {
  console.log('session-auth.guard.spec: ok');
});
