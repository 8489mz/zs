import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { isPlatformTenantId } from '../../src/core/auth/utils/tenant-boundary';
import { ForbiddenException } from '@nestjs/common';
import { AppError } from '../../src/common/errors/app-error';

// ==============================================================================
// Constitutional Invariant Test: Super Admin & Platform Tenant Immunity Shield
// ==============================================================================

function testPlatformTenantIdentity(): void {
  const previousMode = process.env.APP_MODE;
  const previousPlatform = process.env.PLATFORM_TENANT_ID;

  try {
    process.env.APP_MODE = 'CLOUD_SAAS';
    process.env.PLATFORM_TENANT_ID = 'zs';
    assert.equal(isPlatformTenantId('zs'), true, 'zs is always the platform tenant in CLOUD_SAAS');
    assert.equal(isPlatformTenantId('ragab'), false, 'ragab is a customer tenant, not platform');
    assert.equal(isPlatformTenantId('store-1'), false, 'store-1 is a customer tenant, not platform');

    process.env.APP_MODE = 'SELF_CONTAINED';
    assert.equal(isPlatformTenantId('default'), true, 'default is local platform in desktop');
    assert.equal(isPlatformTenantId('zs'), true, 'zs remains protected in all modes');
    assert.equal(isPlatformTenantId('client-store'), false, 'client-store is not platform');
  } finally {
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
    if (previousPlatform === undefined) delete process.env.PLATFORM_TENANT_ID;
    else process.env.PLATFORM_TENANT_ID = previousPlatform;
  }
}

function testPlatformRestoreShield(): void {
  // Read service source code to verify structural invariants
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const service = readFileSync(join(__dirname, '../../src/modules/settings/services/settings-backup.service.ts'), 'utf8');

  // 1. Guard against restoring backup on platform tenant: the
  // shield lives in isProtectedTenantDataTarget (shared helper,
  // true for 'zs' and every platform id), called at the top of
  // restoreBackup — the literal inline check this spec used to
  // grep for was refactored into the helper, not removed.
  assert.ok(
    service.includes("isProtectedTenantDataTarget(scope.tenantId)"),

    'restoreBackup must explicitly check and reject platform tenant restore'
  );
  assert.ok(
    service.includes('TENANT_MISMATCH'),
    'restoreBackup must reject mismatched tenant backups'
  );

  // 2. Sanitize users during restore
  assert.ok(
    service.includes("if (String(row.username || '').trim().toLowerCase() === 'zs') continue;"),
    'restoreBackup must never restore a user named zs'
  );
  assert.ok(
    service.includes("if (row.role === 'super_admin') row.role = 'admin';"),
    'restoreBackup must downgrade any super_admin role to admin'
  );
  // The tenants/sessions exclusion was refactored: 'sessions'
  // rows are skipped inline in the restore loop, and 'tenants'
  // is excluded by isTenantBackupDataTable, which filters the
  // clear/restore table lists. Both current forms are pinned.
  assert.ok(
    service.includes("if (String(table) === 'sessions') continue;"),
    'restoreBackup must never wipe or restore sessions'
  );
  assert.ok(
    service.includes("name !== 'tenants'"),
    'restoreBackup must never wipe or restore tenants table'
  );
}

function testTenantTransferShield(): void {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const transferService = readFileSync(join(__dirname, '../../src/modules/settings/services/tenant-transfer.service.ts'), 'utf8');
  const pkgService = readFileSync(join(__dirname, '../../src/core/tenant-transfer/tenant-package.ts'), 'utf8');

  // Both platform rejections were refactored into the shared
  // isProtectedTenantDataTarget helper (true for 'zs' and every
  // platform id); the current call forms are pinned, not the old
  // inline literal comparisons.
  assert.ok(
    transferService.includes("isProtectedTenantDataTarget(scope.tenantId)"),
    'TenantTransferService.importForActor must reject platform tenant'
  );
  assert.ok(
    pkgService.includes("isProtectedTenantDataTarget(target.tenantId)"),
    'tenant-package.importTenantPackage must reject platform tenant'
  );

}

function testUsersServiceImmunity(): void {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const usersService = readFileSync(join(__dirname, '../../src/modules/users/users.service.ts'), 'utf8');

  // 1. Reserved username zs
  assert.ok(
    usersService.includes('RESERVED_PLATFORM_USERNAME'),
    'UsersService must reject non-platform tenants creating username zs'
  );

  // 2. Cannot delete super_admin
  assert.ok(
    usersService.includes('CANNOT_DELETE_PLATFORM_SUPER_ADMIN'),
    'UsersService must protect super admin user from deletion'
  );

  // 3. Cannot rename or demote super_admin
  assert.ok(
    usersService.includes('CANNOT_RENAME_PLATFORM_SUPER_ADMIN'),
    'UsersService must protect super admin user from renaming'
  );
  assert.ok(
    usersService.includes('CANNOT_DEMOTE_PLATFORM_SUPER_ADMIN'),
    'UsersService must protect super admin user from demotion'
  );
}

function testBootstrapAdminSelfHealing(): void {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const bootstrap = readFileSync(join(__dirname, '../../src/core/auth/services/bootstrap-admin.service.ts'), 'utf8');

  assert.ok(
    bootstrap.includes('ensurePlatformSuperAdminIntegrity'),
    'BootstrapAdminService must include ensurePlatformSuperAdminIntegrity'
  );
  assert.ok(
    bootstrap.includes('await this.ensurePlatformSuperAdminIntegrity();'),
    'BootstrapAdminService must execute ensurePlatformSuperAdminIntegrity on application bootstrap'
  );
}

function run(): void {
  testPlatformTenantIdentity();
  testPlatformRestoreShield();
  testTenantTransferShield();
  testUsersServiceImmunity();
  testBootstrapAdminSelfHealing();
  console.log('✓ platform-superadmin-immunity.spec: All platform immunity shields verified successfully!');
}

run();
