import { strict as assert } from 'node:assert';
import {
  SettingsBackupService,
  isTenantBackupDataTable,
} from '../../src/modules/settings/services/settings-backup.service';
import { PLATFORM_TENANT_TABLES } from '../../src/core/tenant-transfer/tenant-package';

function run(): void {
  // The policy belongs to the same source of truth as tenant package transfer.
  for (const table of PLATFORM_TENANT_TABLES) {
    assert.equal(isTenantBackupDataTable(table), false, table);
  }
  assert.equal(isTenantBackupDataTable('products'), true);
  assert.equal(isTenantBackupDataTable('journal_entry_lines'), true);
  assert.equal(isTenantBackupDataTable('tenants'), false);

  const input: Record<string, unknown> = {
    meta: { tenantId: 'merchant-a', accountId: 'merchant-a:main' },
    tables: {
      sessions: [{ id: 'stolen-cookie', tenant_id: 'merchant-a' }],
      tenant_subscriptions: [{ id: 1, tenant_id: 'merchant-a', plan_id: 999, status: 'active' }],
      tenant_subscription_payments: [{ id: 1, amount: 0, tenant_id: 'merchant-a' }],
      tenant_offline_id_blocks: [{ tenant_id: 'merchant-a', block_index: 999 }],
      trial_signups: [{ tenant_id: 'merchant-a' }],
      products: [{ id: 123, tenant_id: 'merchant-a' }],
      journal_entry_lines: [{ id: 234, tenant_id: 'merchant-a' }],
    },
  };
  // Exercise the exact normalization used before dry-run or destructive restore.
  const normalized = (SettingsBackupService.prototype as any).normalizeEnvelope(input);
  for (const table of PLATFORM_TENANT_TABLES) {
    assert.equal(Object.prototype.hasOwnProperty.call(normalized.tables, table), false, table);
  }
  assert.equal(normalized.tables.products.length, 1);
  assert.equal(normalized.tables.journal_entry_lines.length, 1);
}
run();
