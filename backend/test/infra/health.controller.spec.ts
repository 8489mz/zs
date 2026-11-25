import { GUARDS_METADATA } from '@nestjs/common/constants';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../../src/core/health/health.controller';

async function run(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.APP_VERSION = 'test-build';

  const mockMaintenanceService = {
    getLastResults: () => null,
    runFullOptimization: async () => ({ ok: true }),
    runFastCleanup: async () => ({ ok: true }),
  };

  const controller = new HealthController({} as any, mockMaintenanceService as any, {} as any);
  (controller as any).checkDatabase = async () => ({ status: 'ok', database: 'up' });

  const live = controller.getLiveness();
  assert.equal(live.status, 'ok');
  assert.equal(typeof live.timestamp, 'string');
  assert.equal(live.environment, 'test');
  assert.equal(live.version, 'test-build');

  const health = await controller.getHealth();
  assert.equal(health.status, 'ok');
  assert.equal(health.database, 'up');
  assert.equal(health.environment, 'test');
  assert.equal(health.version, 'test-build');

  const degradedController = new HealthController({} as any, mockMaintenanceService as any, {} as any);
  (degradedController as any).checkDatabase = async () => ({ status: 'degraded', database: 'down' });

  let threw = false;
  try {
    await degradedController.getReadiness();
  } catch (error) {
    threw = true;
    assert.ok(error instanceof ServiceUnavailableException);
    const response = error.getResponse() as Record<string, unknown>;
    assert.equal(response.status, 'degraded');
    assert.equal(response.database, 'down');
    assert.equal(response.environment, 'test');
    assert.equal(response.version, 'test-build');
  }

  assert.equal(threw, true);

  // O22: operations endpoints need a platform super admin; the probes stay public.
  const guardNames = (method: keyof HealthController) =>
    (
      (Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype[method] as object) || []) as Array<{
        name: string;
      }>
    ).map((g) => g.name);
  for (const method of [
    'getDatabaseStats',
    'getSystemMetrics',
    'testTelegramAlert',
    'runDatabaseOptimization',
  ] as const) {
    assert.deepEqual(guardNames(method), ['SessionAuthGuard', 'SuperAdminRoleGuard'], `${method} is super-admin only`);
  }
  for (const method of ['getHealth', 'getLiveness', 'getReadiness'] as const) {
    assert.deepEqual(guardNames(method), [], `${method} stays public for uptime probes`);
  }
  console.log('health controller checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
