import { strict as assert } from 'node:assert';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HttpException } from '@nestjs/common';
import { SaasDiagnosticsController } from '../../src/modules/saas-admin/saas-diagnostics.controller';
import {
  DIAGNOSTICS_UPLOADS_PER_HOUR,
  DiagnosticsUploadRateLimitGuard,
} from '../../src/modules/saas-admin/diagnostics-upload-rate-limit.guard';
import { SaasDiagnosticsService, isZipBuffer } from '../../src/modules/saas-admin/saas-diagnostics.service';

// O36 (ARCHITECTURE_INVARIANTS.md §8): the public diagnostics upload could fill the platform disk.

function contextFor(ip: string) {
  const headers: Record<string, string> = {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: { remoteAddress: ip }, headers: {} }),
      getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
    }),
    headers,
  } as any;
}

async function testGuardRunsBeforeTheUpload(): Promise<void> {
  const guards = Reflect.getMetadata(GUARDS_METADATA, SaasDiagnosticsController.prototype.uploadDiagnosticBundle) || [];
  assert.deepEqual(guards, [DiagnosticsUploadRateLimitGuard], 'the public upload is rate limited');

  const counts = new Map<string, number>();
  const fakeLimiter = {
    hit: async (key: string, limit: number, windowSeconds: number) => {
      assert.equal(windowSeconds, 3600);
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return { allowed: n <= limit, remaining: Math.max(0, limit - n), retryAfterSeconds: 60, limit, resetAt: 0 };
    },
  };
  const guard = new DiagnosticsUploadRateLimitGuard(fakeLimiter as any);
  for (let i = 0; i < DIAGNOSTICS_UPLOADS_PER_HOUR; i++) {
    assert.equal(await guard.canActivate(contextFor('203.0.113.9')), true);
  }
  const ctx = contextFor('203.0.113.9');
  await assert.rejects(
    () => guard.canActivate(ctx),
    (err: unknown) => err instanceof HttpException && err.getStatus() === 429,
  );
  assert.equal(ctx.headers['Retry-After'], '60');
  assert.equal(await guard.canActivate(contextFor('203.0.113.10')), true, 'limits are per client IP');
}

async function testOnlyZipBundlesAreStored(): Promise<void> {
  assert.equal(isZipBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])), true);
  assert.equal(isZipBuffer(Buffer.from('not a zip at all')), false);
  assert.equal(isZipBuffer(Buffer.alloc(0)), false);

  let touchedDb = false;
  const db = new Proxy(
    {},
    {
      get: () => {
        touchedDb = true;
        throw new Error('db must not be reached');
      },
    },
  );
  const service = new SaasDiagnosticsService(db as any);
  await assert.rejects(
    () =>
      service.saveUploadedDiagnosticBundle({ buffer: Buffer.from('junk'), size: 4 } as any, {
        clientName: 'x',
        clientIdentifier: 'y',
      }),
    /ZIP/,
  );
  assert.equal(touchedDb, false, 'a non-zip body is refused before any query or disk write');
}

(async () => {
  await testGuardRunsBeforeTheUpload();
  await testOnlyZipBundlesAreStored();
  console.log('diagnostics-upload-hardening.spec: all checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
