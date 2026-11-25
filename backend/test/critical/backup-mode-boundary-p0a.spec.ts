import { strict as assert } from 'node:assert';
import { SettingsBackupService } from '../../src/modules/settings/services/settings-backup.service';
import { isDesktopRuntimeMode } from '../../src/config/app-mode';

async function run(): Promise<void> {
  for (const mode of ['CLOUD_SAAS', 'unrecognized', undefined]) {
    assert.equal(isDesktopRuntimeMode(mode), false);
  }
  for (const mode of ['SELF_CONTAINED', 'LOCAL_PILOT']) {
    assert.equal(isDesktopRuntimeMode(mode), true);
  }
  const env = process.env.APP_MODE;
  const portable = process.env.PORTABLE_MODE;
  const service = new SettingsBackupService(
    {} as any,
    {} as any,
    { invalidateTenant: () => undefined } as any,
    {} as any,
  );
  try {
    process.env.APP_MODE = 'CLOUD_SAAS';
    process.env.PORTABLE_MODE = 'true';
    assert.throws(() => (service as any).assertDesktopMode(), /Local backup folders/);
    process.env.APP_MODE = 'SELF_CONTAINED';
    assert.doesNotThrow(() => (service as any).assertDesktopMode());
  } finally {
    if (env === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = env;
    if (portable === undefined) delete process.env.PORTABLE_MODE;
    else process.env.PORTABLE_MODE = portable;
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
