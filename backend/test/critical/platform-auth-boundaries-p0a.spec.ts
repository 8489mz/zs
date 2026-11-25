import { strict as assert } from 'node:assert';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { isLocalAuthCookieHost } from '../../src/core/auth/utils/auth-cookie-cleanup';

function context(auth?: unknown) {
  return {
    getHandler: () => function protectedRoute() {},
    getClass: () => class ProtectedController {},
    switchToHttp: () => ({ getRequest: () => ({ authContext: auth, url: '/api/protected' }) }),
  } as any;
}

async function run(): Promise<void> {
  assert.equal(isLocalAuthCookieHost('CLOUD_SAAS', 'localhost'), false);
  assert.equal(isLocalAuthCookieHost('CLOUD_SAAS', '127.0.0.1'), false);
  assert.equal(isLocalAuthCookieHost('SELF_CONTAINED', 'localhost'), true);
  assert.equal(isLocalAuthCookieHost('LOCAL_PILOT', '127.0.0.1:3001'), true);
  assert.equal(isLocalAuthCookieHost('UNKNOWN', 'localhost'), false);

  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === 'required_permissions') return ['settings'];
      if (key === 'required_feature') return 'storefront';
      return undefined;
    },
  };
  const guard = new PermissionsGuard(
    reflector as any,
    { hasAllPermissions: () => false, hasAnyPermission: () => false } as any,
    { hasFeature: () => false } as any,
    {} as any,
  );
  assert.throws(() => guard.canActivate(context()), ForbiddenException);
  assert.throws(
    () =>
      guard.canActivate(
        context({
          role: 'super_admin',
          tenantId: 'ordinary-merchant',
          permissions: [],
        }),
      ),
    ForbiddenException,
  );

  const oldMode = process.env.APP_MODE;
  try {
    process.env.APP_MODE = 'CLOUD_SAAS';
    const cleared: any[] = [];
    const authGuard = new SessionAuthGuard(
      { resolveAuthContext: async () => null } as any,
      {
        get: (key: string) =>
          (
            ({
              APP_MODE: 'CLOUD_SAAS',
              SESSION_COOKIE_SECURE: true,
              SESSION_COOKIE_NAME: 'session_id',
              SESSION_COOKIE_SAME_SITE: 'strict',
            }) as Record<string, unknown>
          )[key],
      } as any,
    );
    const request = {
      method: 'GET',
      headers: { host: 'erp.example.com', 'x-forwarded-host': 'localhost', cookie: 'session_id=%EG' },
    };
    const response = {
      clearCookie: (_name: string, opts: any) => {
        cleared.push(opts);
      },
    };
    await assert.rejects(
      () =>
        authGuard.canActivate({
          switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => response,
          }),
        } as any),
      UnauthorizedException,
    );
    assert.ok(cleared.length > 0);
    assert.ok(
      cleared.every((options) => options.secure === true),
      'Cloud must not clear/send insecure auth cookies based on spoofed host',
    );
  } finally {
    if (oldMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = oldMode;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
