import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  assertTrustedOfflineUpdatePackage,
  OfflineReleasesService,
} from '../../src/modules/settings/services/offline-releases.service';
import { BadRequestException } from '@nestjs/common';

const payload = Buffer.from('test release archive bytes, not a real update');
const trusted = createHash('sha256').update(payload).digest('hex');
assert.doesNotThrow(() => assertTrustedOfflineUpdatePackage(payload, trusted));
assert.throws(() => assertTrustedOfflineUpdatePackage(payload, undefined), 'no configured operator digest');
assert.throws(() => assertTrustedOfflineUpdatePackage(payload, 'a'.repeat(64)), 'untrusted package');
assert.throws(() => assertTrustedOfflineUpdatePackage(Buffer.alloc(0), trusted), 'empty ZIP');
assert.throws(() => assertTrustedOfflineUpdatePackage(Buffer.alloc(128 * 1024 * 1024 + 1), trusted), 'oversized ZIP');
console.log('Offline update package trust and upload limit regressions passed');

async function rejectCloudUpdates(): Promise<void> {
  const saved = {
    APP_MODE: process.env.APP_MODE,
    PORTABLE_MODE: process.env.PORTABLE_MODE,
    IS_ELECTRON: process.env.IS_ELECTRON,
  };
  try {
    process.env.APP_MODE = 'CLOUD_SAAS';
    process.env.PORTABLE_MODE = 'true';
    process.env.IS_ELECTRON = 'true';
    // No DB or filesystem is supplied: rejection must precede any update work.
    const service = new OfflineReleasesService({} as any);
    await assert.rejects(() => service.triggerUpdate({} as any), BadRequestException);
    await assert.rejects(
      () => service.applyLocalUpdate({ version: '1.2.3', patchUrl: 'https://example.com/patch.zip', changelog: '' }),
      BadRequestException,
    );
    await assert.rejects(() => service.applyLocalZipUpdate({ buffer: payload } as any), BadRequestException);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

void rejectCloudUpdates().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
