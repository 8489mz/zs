import { strict as assert } from 'node:assert';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { TenantSubscriptionController } from '../../src/modules/tenant-subscription/tenant-subscription.controller';

async function run(): Promise<void> {
  const fakeContext = (request: any) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ clearCookie: () => undefined }),
      }),
    }) as any;
  const authContext = {
    tenantId: 'tenant-a',
    accountId: 'tenant-a:main',
    userId: 42,
    sessionId: 'sess1',
    permissions: [],
    role: 'admin',
  };
  const mockSession = { resolveAuthContext: async () => authContext };
  const cloud = new SessionAuthGuard(
    mockSession as any,
    {
      get: (name: string) =>
        (({ APP_MODE: 'CLOUD_SAAS', NODE_ENV: 'development', ALLOW_SESSION_ID_HEADER: 'true' }) as any)[name],
    } as any,
  );
  await assert.rejects(
    () =>
      cloud.canActivate(
        fakeContext({
          method: 'GET',
          headers: { 'x-session-id': 'sess1' },
        }),
      ),
    /Unauthorized/,
  );
  const desktop = new SessionAuthGuard(
    mockSession as any,
    {
      get: (name: string) =>
        (({ APP_MODE: 'SELF_CONTAINED', NODE_ENV: 'development', ALLOW_SESSION_ID_HEADER: 'true' }) as any)[name],
    } as any,
  );
  assert.equal(await desktop.canActivate(fakeContext({ method: 'GET', headers: { 'x-session-id': 'sess1' } })), true);

  let captured: Record<string, unknown> | undefined;
  const controller = new TenantSubscriptionController(
    {} as any,
    {
      processWebhook: async (_gateway: string, headers: Record<string, unknown>) => {
        captured = headers;
        return { ok: true };
      },
    } as any,
  );
  await controller.handlePaymentWebhook('paymob', {}, { obj: {} }, {} as any, 'signed-query-value');
  assert.equal(captured?.hmac, 'signed-query-value');
  captured = undefined;
  await controller.handlePaymentWebhook('stripe', {}, {}, {} as any, 'not-a-stripe-signature');
  assert.equal(
    (captured as Record<string, unknown> | undefined)?.['hmac'],
    undefined,
    'Never inject Paymob signature into other gateways',
  );
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
