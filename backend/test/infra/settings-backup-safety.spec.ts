import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { AppError } from '../../src/common/errors/app-error';
import { SettingsAdminService } from '../../src/modules/settings/services/settings-admin.service';
import { SettingsBackupService } from '../../src/modules/settings/services/settings-backup.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

function actor(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: 1,
    sessionId: 'session-1',
    username: 'admin',
    role: 'admin',
    permissions: [],
    tenantId: 'backup-ci-tenant',
    accountId: 'backup-ci-tenant',
    ...overrides,
  };
}

const backupPayload = {
  meta: {
    version: '1.1.0',
    exportedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    tenantId: 'backup-ci-tenant',
  },
  tables: {
    settings: [{ key: 'company_name', value: 'Acceptance', tenant_id: 'backup-ci-tenant' }],
  },
};

function createBackupService() {
  return new SettingsBackupService(
    {} as any,
    { log: async () => undefined } as any,
    { invalidateTenant: () => undefined } as any,
    {
      invalidateSettingsCache: () => undefined,
      invalidateBranchesCache: () => undefined,
      invalidatePlanFeaturesCache: () => undefined,
    } as any,
  );
}

function createAdminService() {
  return new SettingsAdminService({} as any, { log: async () => undefined } as any);
}

async function run(): Promise<void> {
  {
    const previousMode = process.env.APP_MODE;
    process.env.APP_MODE = 'CLOUD_SAAS';
    try {
      const service = createBackupService();
      await assert.rejects(
        // Exercise runtime isolation after the independent backup-administrator permission gate.
        () => service.saveBackupToConfiguredFolder(actor({ permissions: ['settings', 'canManageBackups'] })),
        (error: unknown) => error instanceof AppError && error.code === 'FEATURE_NOT_AVAILABLE',
      );
    } finally {
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
    }
  }
  {
    const service = createBackupService();
    const result = await service.restoreBackup(backupPayload, actor({ permissions: ['settings'] }), true);
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
  }

  {
    const service = createBackupService();
    await assert.rejects(
      () =>
        service.restoreBackup(
          { ...backupPayload, confirmation: 'RESTORE BACKUP' },
          actor({ permissions: ['settings'] }),
          false,
        ),
      ForbiddenException,
    );
  }

  {
    const service = createBackupService();
    await assert.rejects(
      () => service.restoreBackup(backupPayload, actor({ permissions: ['canManageBackups'] }), false),
      (error: unknown) => error instanceof AppError && error.code === 'BACKUP_RESTORE_CONFIRMATION_REQUIRED',
    );
  }

  {
    const service = createAdminService();
    await assert.rejects(
      () => service.cleanupExpiredSessions(actor({ permissions: ['settings'] })),
      ForbiddenException,
    );
  }

  console.log('settings-backup-safety.spec: ok');
}

void run();
