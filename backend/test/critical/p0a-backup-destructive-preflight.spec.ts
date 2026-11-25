import { strict as assert } from 'node:assert';
import { SettingsBackupService } from '../../src/modules/settings/services/settings-backup.service';

function run(): void {
  const backup = new SettingsBackupService({} as any, {} as any, {} as any, {} as any);
  const normalize = (input: unknown) => (backup as any).normalizeEnvelope(input);
  assert.throws(() => normalize({}), /Backup has no tables object/);
  assert.throws(() => normalize({ tables: {} }), /Backup has no restorable tenant tables/);
  assert.throws(
    () =>
      normalize({
        meta: { tenantId: 'shop-a' },
        tables: { tenant_subscriptions: [{ id: 1, status: 'active' }], sessions: [{ id: 'stolen' }] },
      }),
    /Backup has no restorable tenant tables/,
  );
  const good = normalize({ meta: { tenantId: 'shop-a' }, tables: { products: [] } });
  assert.deepEqual(Object.keys(good.tables), ['products'], 'Missing tables must NOT be invented as empty');
}
run();
