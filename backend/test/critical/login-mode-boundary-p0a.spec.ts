import { strict as assert } from 'node:assert';
import { LoginRateLimitMiddleware } from '../../src/common/middleware/login-rate-limit.middleware';

async function run() {
  const old = {
    APP_MODE: process.env.APP_MODE,
    IS_ELECTRON: process.env.IS_ELECTRON,
    PORTABLE_MODE: process.env.PORTABLE_MODE,
  };
  try {
    process.env.APP_MODE = 'CLOUD_SAAS';
    process.env.IS_ELECTRON = 'true';
    process.env.PORTABLE_MODE = 'true';
    let calls = 0;
    const middleware = new LoginRateLimitMiddleware(
      { get: (key: string) => (key === 'APP_MODE' ? 'CLOUD_SAAS' : undefined) } as any,
      {
        hit: async () => {
          calls++;
          return { allowed: true, remaining: 9, limit: 10, resetAt: null };
        },
      } as any,
    );
    let nextCount = 0;
    await middleware.use(
      { ip: '198.51.100.42', headers: {}, body: { username: 'account' } } as any,
      { setHeader: () => undefined } as any,
      () => {
        nextCount++;
      },
    );
    assert.equal(calls, 3, 'Cloud must rate limit even if desktop flags have been set');
    assert.equal(nextCount, 1);
    process.env.APP_MODE = 'SELF_CONTAINED';
    calls = 0;
    const desktop = new LoginRateLimitMiddleware(
      { get: (key: string) => (key === 'APP_MODE' ? 'SELF_CONTAINED' : undefined) } as any,
      {
        hit: async () => {
          calls++;
          throw new Error('desktop rate limiter invoked');
        },
      } as any,
    );
    await desktop.use({ headers: {}, body: {} } as any, {} as any, () => undefined);
    assert.equal(calls, 0);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
