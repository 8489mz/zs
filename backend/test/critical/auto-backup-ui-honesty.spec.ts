/* Auto-backup UI honesty (INV-BACKUP-UI-HONESTY): the stored auto-backup
 * flag defaults to "on" even on cloud, where the scheduler never runs
 * (SettingsBackupService.onModuleInit returns early unless desktop). The
 * config endpoint must therefore tell the UI whether a scheduler exists
 * at all, so the page never renders a never-running schedule as "active".
 * Drives the REAL SettingsBackupService.getBackupConfig on PGlite.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { SettingsBackupService } from '../../src/modules/settings/services/settings-backup.service';

const TENANT = 't1';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'admin',
  // getBackupConfig needs canManageBackups (restore gate) and settings
  // (the auto-backup attempt's admin gate).
  permissions: ['settings', 'canManageBackups'],
  tenantId: TENANT,
  accountId: 'a1',
};

function createService(db: Kysely<any>): SettingsBackupService {
  return new SettingsBackupService(
    db as never,
    { log: async () => undefined } as never,
    { invalidateTenant: () => undefined } as never,
    { invalidateSettingsCache: () => undefined, invalidateBranchesCache: () => undefined, invalidatePlanFeaturesCache: () => undefined } as never,
  );
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    await sql`CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, key TEXT NOT NULL, value TEXT)`.execute(db);

    const previousMode = process.env.APP_MODE;

    // 1. Cloud, no stored rows: the legacy flag still defaults to "on"
    // (enabled === true) — but there is no scheduler, so the UI must not
    // render the schedule as active.
    process.env.APP_MODE = 'CLOUD_SAAS';
    const cloud = await createService(db).getBackupConfig(ACTOR);
    assert.equal((cloud.automation as any).enabled, true, 'legacy default keeps enabled true on cloud');
    assert.equal((cloud.automation as any).schedulerAvailable, false, 'cloud must report schedulerAvailable false');

    // 2. Desktop: the scheduler exists. The stored automation is disabled
    // so the config read must not attempt a real backup file write.
    await sql`INSERT INTO settings (tenant_id, account_id, key, value) VALUES (${TENANT}, ${'a1'}, ${'backupAutomation'}, ${JSON.stringify({ enabled: false })})`.execute(db);
    process.env.APP_MODE = 'LOCAL_PILOT';
    const desktop = await createService(db).getBackupConfig(ACTOR);
    assert.equal((desktop.automation as any).schedulerAvailable, true, 'desktop must report schedulerAvailable true');
    assert.equal((desktop.automation as any).enabled, false, 'stored disabled flag must be honoured');

    // 3. Unset mode defaults to cloud: no scheduler.
    delete process.env.APP_MODE;
    const unset = await createService(db).getBackupConfig(ACTOR);
    assert.equal((unset.automation as any).schedulerAvailable, false, 'unset APP_MODE must default to schedulerAvailable false');

    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;

    console.log('auto-backup-ui-honesty backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
