/*
 * INV-BACKUP-FIRE-DRILL-PLAYBOOK: backup / fire-drill playbook completeness spec.
 *
 * This spec pins docs/FIRE_DRILL_PLAYBOOK.md against the repo it describes,
 * so the runbook cannot silently drift from the backup scripts, the restore
 * scripts, the deploy workflow, or the health endpoints:
 *  - the six steps appear in order (1 confirm, 2 locate, 3 restore,
 *    4 migrations, 5 health checks, 6 notify);
 *  - every retention figure in the playbook's backup table equals the
 *    constant in deploy/scripts/zsystems-backup.sh (hourly local 3 days,
 *    hourly GDrive 7 days, daily local 14 days, daily GDrive 90 days),
 *    and the hourly-to-Oracle exclusion is stated;
 *  - the zsystems-restore.sh `full` refusal trap is named (it refuses a
 *    non-empty database, so it is NOT the live-DB restore path);
 *  - the live-DB restore recipe the playbook gives (openssl decrypt of the
 *    hourly dump, zs-backup-tool extract of the daily bundle, DROP + CREATE,
 *    psql restore with an ERROR count) matches the recipe in
 *    deploy/scripts/zsystems-restore-drill.sh;
 *  - the health endpoints the playbook probes exist
 *    (backend/src/core/health/health.controller.ts serves live + ready
 *    under api/health) and the deploy workflow probes both;
 *  - the passphrase requirement is named, not assumed;
 *  - the playbook states the CURRENT deploy-failure DB behaviour and cites
 *    deploy-oracle.yml as its source, so a change to that behaviour must
 *    update the playbook in the same package — since INV-MIGRATION-AUTO-REVERT
 *    went live, the playbook states the automatic revert-or-restore IS live;
 *  - the playbook is reachable from docs/DISASTER_RECOVERY.md.
 *
 * Fail-first: the row matcher is self-checked against a sample table below,
 * and the spec fails on a deliberately wrong retention figure in the
 * playbook (proven by mutating one figure and re-running).
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PLAYBOOK = path.join(REPO_ROOT, 'docs', 'FIRE_DRILL_PLAYBOOK.md');
const DISASTER_RECOVERY = path.join(REPO_ROOT, 'docs', 'DISASTER_RECOVERY.md');
const BACKUP_SCRIPT = path.join(REPO_ROOT, 'deploy', 'scripts', 'zsystems-backup.sh');
const RESTORE_SCRIPT = path.join(REPO_ROOT, 'deploy', 'scripts', 'zsystems-restore.sh');
const DRILL_SCRIPT = path.join(REPO_ROOT, 'deploy', 'scripts', 'zsystems-restore-drill.sh');
const DEPLOY_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'deploy-oracle.yml');
const HEALTH_CONTROLLER = path.join(REPO_ROOT, 'backend', 'src', 'core', 'health', 'health.controller.ts');

function scriptConstant(script: string, name: string): number {
  const match = script.match(new RegExp(`^${name}=(\\d+)`, 'm'));
  assert.ok(match, `backup script must define ${name}`);
  return Number(match[1]);
}

function tableRow(doc: string, firstCell: string): string {
  const row = doc.split('\n').find((line) => line.startsWith(`| ${firstCell} `));
  assert.ok(row, `playbook backup table must have a ${firstCell} row`);
  return row as string;
}

async function main(): Promise<void> {
  // 0. Row-matcher self-check (fail-first for the matcher itself).
  const sample =
    '| الساعية `hourly` | x | **3 أيام** | **7 أيام** |\n| اليومية `daily` | x | **14 يوماً** | **90 يوماً** |';
  assert.ok(tableRow(sample, 'الساعية').includes('3 أيام'), 'sample hourly row must carry 3 days');
  assert.ok(!tableRow(sample, 'الساعية').includes('30 أيام'), 'sample hourly row must not carry 30 days');
  assert.ok(tableRow(sample, 'اليومية').includes('90 يوماً'), 'sample daily row must carry 90 days');

  for (const file of [
    PLAYBOOK,
    DISASTER_RECOVERY,
    BACKUP_SCRIPT,
    RESTORE_SCRIPT,
    DRILL_SCRIPT,
    DEPLOY_WORKFLOW,
    HEALTH_CONTROLLER,
  ]) {
    assert.ok(fs.existsSync(file), `required file must exist: ${path.relative(REPO_ROOT, file)}`);
  }
  const playbook = fs.readFileSync(PLAYBOOK, 'utf8');
  const backupScript = fs.readFileSync(BACKUP_SCRIPT, 'utf8');
  const restoreScript = fs.readFileSync(RESTORE_SCRIPT, 'utf8');
  const drillScript = fs.readFileSync(DRILL_SCRIPT, 'utf8');
  const deployWorkflow = fs.readFileSync(DEPLOY_WORKFLOW, 'utf8');
  const healthController = fs.readFileSync(HEALTH_CONTROLLER, 'utf8');
  const disasterRecovery = fs.readFileSync(DISASTER_RECOVERY, 'utf8');

  // 1. The six steps appear in order, each exactly once.
  const stepHeadings = ['الخطوة 1', 'الخطوة 2', 'الخطوة 3', 'الخطوة 4', 'الخطوة 5', 'الخطوة 6'];
  let lastIndex = -1;
  for (const heading of stepHeadings) {
    const index = playbook.indexOf(`## ${heading}`);
    assert.ok(index > lastIndex, `playbook must contain ${heading} after the previous step`);
    assert.equal(playbook.indexOf(`## ${heading}`, index + 1), -1, `playbook must contain ${heading} exactly once`);
    lastIndex = index;
  }
  assert.ok(playbook.includes('تأكد من العطل'), 'step 1 must be confirming the outage');
  assert.ok(playbook.includes('أحدث نسخة احتياطية'), 'step 2 must be locating the latest backup');
  assert.ok(playbook.includes('استرجع في قاعدة البيانات الحية'), 'step 3 must be the live-DB restore');
  assert.ok(playbook.includes('أعد تشغيل الهجرات'), 'step 4 must be re-running migrations');
  assert.ok(playbook.includes('فحوصات الصحة'), 'step 5 must be the health checks');
  assert.ok(playbook.includes('أبلغ المنشآت المتأثرة'), 'step 6 must be notifying affected tenants');

  // 2. Retention figures equal the backup script's constants.
  const hourlyLocal = scriptConstant(backupScript, 'HOURLY_KEEP_DAYS');
  const hourlyGdrive = scriptConstant(backupScript, 'GDRIVE_HOURLY_KEEP_DAYS');
  const dailyLocal = scriptConstant(backupScript, 'KEEP_DAYS');
  const dailyGdrive = scriptConstant(backupScript, 'GDRIVE_KEEP_DAYS');
  const hourlyRow = tableRow(playbook, 'الساعية');
  const dailyRow = tableRow(playbook, 'اليومية');
  assert.equal(hourlyLocal, 3, 'backup script hourly local retention must be 3 days');
  assert.equal(hourlyGdrive, 7, 'backup script hourly GDrive retention must be 7 days');
  assert.equal(dailyLocal, 14, 'backup script daily local retention must be 14 days');
  assert.equal(dailyGdrive, 90, 'backup script daily GDrive retention must be 90 days');
  assert.ok(hourlyRow.includes(`${hourlyLocal} أيام`), `playbook hourly row must state local ${hourlyLocal} days`);
  assert.ok(hourlyRow.includes(`${hourlyGdrive} أيام`), `playbook hourly row must state GDrive ${hourlyGdrive} days`);
  assert.ok(dailyRow.includes(`${dailyLocal} يوماً`), `playbook daily row must state local ${dailyLocal} days`);
  assert.ok(dailyRow.includes(`${dailyGdrive} يوماً`), `playbook daily row must state GDrive ${dailyGdrive} days`);
  assert.ok(
    hourlyRow.includes('لا تُرفع عمداً'),
    'playbook must state the hourly backup is deliberately NOT uploaded to Oracle',
  );
  assert.ok(dailyRow.includes('نعم'), 'playbook must state the daily bundle IS uploaded to Oracle Object Storage');
  assert.ok(playbook.includes('zsystems_hourly_'), 'playbook must name the hourly file pattern');
  assert.ok(playbook.includes('zsystems_backup_'), 'playbook must name the daily bundle file pattern');

  // 3. The restore.sh `full` refusal trap is named, not papered over.
  assert.ok(
    restoreScript.includes('The database already has $TABLES tables'),
    'restore script must refuse a non-empty database',
  );
  assert.ok(playbook.includes('zsystems-restore.sh full'), 'playbook must name zsystems-restore.sh full');
  assert.ok(
    playbook.includes('يرفض العمل على قاعدة بيانات غير فاضية'),
    'playbook must state that full refuses a non-empty database',
  );
  assert.ok(playbook.includes('لسيرفر جديد فقط'), 'playbook must state that full is for a new server only');

  // 4. The live-DB restore recipe matches the drill script's recipe.
  assert.ok(
    drillScript.includes('openssl enc -d -aes-256-cbc -pbkdf2'),
    'drill script must decrypt with openssl aes-256-cbc pbkdf2',
  );
  assert.ok(
    playbook.includes('openssl enc -d -aes-256-cbc -pbkdf2'),
    'playbook must give the same openssl decrypt command',
  );
  assert.ok(drillScript.includes('DROP DATABASE IF EXISTS $DRILL_DB'), 'drill script must drop before creating its DB');
  assert.ok(
    playbook.includes('DROP DATABASE zsystems_db WITH (FORCE)'),
    'playbook must include the DROP of the live DB',
  );
  assert.ok(playbook.includes('CREATE DATABASE zsystems_db'), 'playbook must include the CREATE of the live DB');
  assert.ok(
    playbook.includes('grep -c "^ERROR" /tmp/restore.log'),
    'playbook must count ERROR lines after the restore',
  );
  assert.ok(
    playbook.includes('zs-backup-tool.js extract'),
    'playbook must extract the full dump from a daily bundle with zs-backup-tool',
  );
  assert.ok(playbook.includes('full/zsystems_db.sql.gz'), 'playbook must name the bundle entry holding the full dump');
  assert.ok(playbook.includes('pm2 stop zsystems-backend'), 'playbook must stop the backend before restoring');
  assert.ok(
    playbook.includes('pre-restore-'),
    'playbook must take a safety dump before dropping a live DB that still answers',
  );

  // 5. The health endpoints exist and the deploy workflow probes both.
  assert.ok(
    healthController.includes("@Controller(['health', 'api/health'])"),
    'health controller must serve health + api/health',
  );
  assert.ok(healthController.includes("@Get('live')"), 'health controller must define a live endpoint');
  assert.ok(healthController.includes("@Get('ready')"), 'health controller must define a ready endpoint');
  assert.ok(playbook.includes('/api/health/live'), 'playbook must probe /api/health/live');
  assert.ok(playbook.includes('/api/health/ready'), 'playbook must probe /api/health/ready');
  assert.ok(
    deployWorkflow.includes('http://127.0.0.1:3000/api/health/live'),
    'deploy workflow must probe /api/health/live',
  );
  assert.ok(
    deployWorkflow.includes('http://127.0.0.1:3000/api/health/ready'),
    'deploy workflow must probe /api/health/ready',
  );
  assert.ok(playbook.includes('npm run migration:list'), 'playbook must check the applied migrations');
  assert.ok(playbook.includes('npm run migration:run'), 'playbook must re-run migrations when behind');

  // 6. The passphrase requirement is named, not assumed.
  assert.ok(backupScript.includes('/etc/zsystems/backup-passphrase'), 'backup script must use the passphrase file');
  assert.ok(playbook.includes('/etc/zsystems/backup-passphrase'), 'playbook must name the passphrase file');
  assert.ok(
    playbook.includes('من غيرها لا توجد نسخة واحدة تُفتح'),
    'playbook must state that no backup opens without the passphrase',
  );

  // 7. The playbook states the CURRENT deploy-failure DB behaviour and cites its source.
  assert.ok(
    playbook.includes('deploy-oracle.yml'),
    'playbook must cite the deploy workflow as the source of the failure-path behaviour',
  );
  assert.ok(
    playbook.includes('INV-MIGRATION-AUTO-REVERT'),
    'playbook must name the automatic revert-or-restore invariant',
  );
  assert.ok(playbook.includes('حي على `main`'), 'playbook must state that automatic revert-or-restore is live on main');
  assert.ok(
    !playbook.includes('ليس حياً بعد'),
    'playbook must not still claim automatic revert-or-restore is not live yet',
  );

  // 8. The playbook is reachable from the disaster-recovery doc, and vice versa.
  assert.ok(
    disasterRecovery.includes('FIRE_DRILL_PLAYBOOK.md'),
    'DISASTER_RECOVERY.md must link to the fire-drill playbook',
  );
  assert.ok(
    playbook.includes('DISASTER_RECOVERY.md'),
    'the playbook must link back to DISASTER_RECOVERY.md for a new-server rebuild',
  );

  console.log(
    `backup fire-drill playbook checks passed (6 steps in order; retentions hourly ${hourlyLocal}d/${hourlyGdrive}d GDrive, daily ${dailyLocal}d/${dailyGdrive}d GDrive)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
