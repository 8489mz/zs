import { strict as assert } from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { SettingsBackupService } from '../../src/modules/settings/services/settings-backup.service';
import { CloudBackupService } from '../../src/modules/settings/services/cloud-backup.service';

async function run(): Promise<void> {
  const cashier = {
    role: 'cashier',
    userId: 5,
    tenantId: 't1',
    accountId: 't1:main',
    permissions: ['settings', 'canManageSettings'],
  } as any;
  const backup = new SettingsBackupService({} as any, {} as any, {} as any, {} as any);
  const cloud = new CloudBackupService({} as any, backup);
  await assert.rejects(() => backup.exportBackup(cashier), ForbiddenException);
  await assert.rejects(() => backup.listSnapshots(cashier), ForbiddenException);
  await assert.rejects(() => backup.getBackupConfig(cashier), ForbiddenException);
  await assert.rejects(() => cloud.getCloudConfig(cashier), ForbiddenException);
  const adminWithoutBackups = { ...cashier, role: 'admin', permissions: ['settings'] };
  await assert.rejects(() => cloud.getCloudConfig(adminWithoutBackups), ForbiddenException);
  // P0A-32: even an authorized actor cannot upload backups to a disabled cloud destination.
  const disabled = new CloudBackupService({} as any, backup);
  (disabled as any).getCloudConfig = async () => ({ enabled: false });
  await assert.rejects(
    () =>
      disabled.uploadBackupToCloud(Buffer.from('test'), 'backup.zip', {
        ...cashier,
        permissions: ['canManageBackups'],
      }),
    /النسخ الاحتياطي السحابي غير مفعل/,
  );
}
run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
