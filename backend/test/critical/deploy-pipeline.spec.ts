import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guard for the production deploy and backup invariants DEPLOY-1..DEPLOY-8
// (ARCHITECTURE_INVARIANTS.md §2.7, docs/DEPLOYMENT_PIPELINE.md).
// Each of these was a real production incident on 2026-09-22: the old flow deleted dist and rebuilt
// on the 1-OCPU server (1754 failed PM2 restarts), and the nightly backup had silently not run for
// three weeks. Nothing fails functionally when these regress — production just goes down during
// every deploy or loses its backups. If one of these fails, the test is almost always right.

const ROOT = join(__dirname, '..', '..', '..');
// Normalised to LF: Windows checkouts get CRLF (core.autocrlf) and the regexes below match on \n.
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

const workflow = read('.github/workflows/deploy-oracle.yml');
const backupScript = read('deploy/scripts/zsystems-backup.sh');
const drillScript = read('deploy/scripts/zsystems-restore-drill.sh');
const watchScript = read('deploy/scripts/zsystems-watch.sh');

function remoteScript(): string {
  const match = workflow.match(/<< 'REMOTE'\n([\s\S]*?)\n\s*REMOTE\n/);
  assert.ok(match, "deploy-oracle.yml must run its server steps in a single << 'REMOTE' heredoc");
  return match[1];
}

// DEPLOY-1: nothing is built on the production server.
function testNoBuildOnServer(): void {
  const remote = remoteScript();
  for (const forbidden of [/npm run build/, /vite(\.js)? build/, /nest build/, /tsc\b/]) {
    assert.ok(!forbidden.test(remote), `the server step must not build (found ${forbidden}) — build on the runner`);
  }
  const runnerPart = workflow.replace(remote, '');
  assert.ok(/working-directory: backend[\s\S]*?npm run build/.test(runnerPart), 'backend must be built on the GitHub runner');
  assert.ok(/working-directory: frontend[\s\S]*?npm run build/.test(runnerPart), 'frontend must be built on the GitHub runner');
  assert.ok(/tar -czf release\.tgz backend\/dist frontend\/dist/.test(runnerPart), 'the prebuilt dist folders are shipped as release.tgz');
}

// DEPLOY-2: the live dist folders are never deleted before the new build is in place.
function testNoLiveDistDeletion(): void {
  const remote = remoteScript();
  assert.ok(!/rm -rf ("?\$TARGET_DIR\/)?(backend\/|frontend\/)?dist"?\s*$/m.test(remote), 'never rm -rf a live dist folder');
  assert.ok(/swap_in "\$TARGET_DIR\/backend\/dist"/.test(remote), 'backend/dist is replaced by swap_in (mv), not rebuilt in place');
  assert.ok(/swap_in "\$TARGET_DIR\/frontend\/dist"/.test(remote), 'frontend/dist is replaced by swap_in (mv), not rebuilt in place');
}

// DEPLOY-3: migrations run before the new code goes live; a failed health check rolls back.
function testMigrationOrderAndRollback(): void {
  const remote = remoteScript();
  const migrateAt = remote.indexOf('npm run migration:run');
  const backupAt = remote.indexOf('zsystems-backup.sh" hourly');
  const swapAt = remote.indexOf('swap_in "$TARGET_DIR/backend/dist"');
  const reloadAt = remote.indexOf('pm2 reload zsystems-backend');
  assert.ok(backupAt > -1 && migrateAt > -1 && swapAt > -1 && reloadAt > -1, 'backup, migrate, swap and reload must all be present');
  assert.ok(backupAt < migrateAt && migrateAt < swapAt && swapAt < reloadAt, 'order must be: encrypted backup -> migrate -> swap -> reload');
  assert.ok(/if ! check_health; then[\s\S]*?swap_back "\$TARGET_DIR\/backend\/dist"[\s\S]*?exit 1/.test(remote),
    'an unhealthy deploy must swap the previous build back and fail the job');
  assert.ok(/set -euo pipefail/.test(remote), 'the server step must stop on the first error');
}

// DEPLOY-4: the commit that passed CI is the one deployed.
function testDeploysTestedCommit(): void {
  // A production deploy requires a verified green main SHA (workflow_run on successful CI or workflow_dispatch).
  assert.ok(/workflow_run:[\s\S]*?workflows:\s*\["ci-full"\][\s\S]*?branches:[\s\S]*?-\s*main/.test(workflow),
    'production deployment must automatically trigger on ci-full completion for main');
  assert.ok(/workflow_dispatch:/.test(workflow),
    'production deployment must support workflow_dispatch');
  assert.ok(/github\.ref == 'refs\/heads\/main'/.test(workflow) || /github\.event\.workflow_run\.head_branch == 'main'/.test(workflow),
    'deployment must be authorized from main');
  assert.ok(/DEPLOY_SHA:/.test(workflow),
    'deployment must lock an exact main SHA');
  assert.ok(/actions: read/.test(workflow)
    && /actions\/workflows\/ci-full\.yml\/runs\?head_sha=\$DEPLOY_SHA/.test(workflow)
    && /test "\$PASSED" -ge 1/.test(workflow)
    && /CURRENT_MAIN/.test(workflow),
    'current main SHA must already have a successful full-CI (workflow_dispatch) run verified before deploy');
  assert.ok(/git reset --hard "\$DEPLOY_SHA"/.test(remoteScript()),
    'server must reset to the exact CI-verified SHA');
  assert.ok(/cancel-in-progress: false/.test(workflow),
    'an active deployment must not be cancelled mid-swap');
  assert.ok(/secrets\.ORACLE_SSH_KNOWN_HOSTS/.test(workflow) && !/StrictHostKeyChecking=no/.test(workflow)
    && (workflow.match(/StrictHostKeyChecking=yes/g) || []).length === 2,
    'both SSH operations must verify the pinned production host key');
}

// DEPLOY-5: the backup produces a valid dump.
function testBackupScript(): void {
  assert.ok(!/docker exec[^\n|]*\s-t\b/.test(backupScript), 'docker exec -t injects \\r into the SQL dump');
  assert.ok(/set -euo pipefail/.test(backupScript), 'a failed pg_dump must fail the backup, not write an empty file');
  assert.ok(/PostgreSQL database dump complete/.test(backupScript), 'the dump must be verified complete before it is kept');
  assert.ok(/\/etc\/zsystems\/backup-par-url/.test(backupScript), 'the off-site upload URL is read from the server, not the repo');
  assert.ok(/refusing to create or upload an unencrypted backup/.test(backupScript), 'backups must fail closed when the encryption passphrase is missing');
  assert.ok(/encrypted full-database fallback/.test(backupScript), 'a failed bundle must fall back to an encrypted dump, never a raw dump');
  assert.ok(!/uploading the plain database dump instead/.test(backupScript), 'raw database dumps must never be uploaded');
}

// DEPLOY-6: no Object Storage pre-authenticated URL is ever committed (the repo is public).
function testNoCommittedParUrl(): void {
  const par = /objectstorage\.[a-z0-9-]+\.oraclecloud\.com\/p\//;
  for (const [name, text] of [['deploy-oracle.yml', workflow], ['zsystems-backup.sh', backupScript]] as const) {
    assert.ok(!par.test(text), `${name} must not contain a pre-authenticated request URL`);
  }
}

// DEPLOY-7: the hourly copy exists, is encrypted, and cleans up after itself.
// A daily-only backup means an outage at 5pm loses a full working day (RPO = 24h). The hourly mode
// cuts that to one hour. Two things make it safe rather than merely frequent: it must be encrypted
// before it leaves the server, and it must delete its own old copies — 24 files a day with no
// retention fills both the disk and a Free Tier bucket.
function testHourlyBackupMode(): void {
  assert.ok(/MODE="\$\{1:-daily\}"/.test(backupScript), 'the backup script must take a daily|hourly mode');
  assert.ok(/daily\|hourly\)/.test(backupScript), 'an unknown mode must be rejected, not silently treated as daily');
  assert.ok(/zsystems_hourly_/.test(backupScript), 'the hourly copy needs its own filename prefix so retention can target it');
  assert.ok(
    /openssl enc -aes-256-cbc -pbkdf2[^\n]*-pass "file:\$PASSPHRASE_FILE"/.test(backupScript),
    'the hourly copy must be encrypted with the same scheme as the bundle before it is uploaded',
  );
  assert.ok(
    /name "zsystems_hourly_\*" -mtime \+"\$HOURLY_KEEP_DAYS" -delete/.test(backupScript),
    'hourly copies must expire locally',
  );
  assert.ok(
    /--min-age "\$\{GDRIVE_HOURLY_KEEP_DAYS\}d"[\s\S]{0,120}zsystems_hourly_/.test(backupScript),
    'hourly copies must expire off-site too',
  );
  assert.ok(/zsystems_hourly_\*' -mmin/.test(watchScript), 'the watchdog must notice when hourly backups stop');
}

// DEPLOY-8: the weekly restore drill exists and can never touch the live database.
// A backup that has never been restored is a file, not a backup. The drill restores the newest copy
// into a throwaway database and compares it with production — but the only thing worse than an
// unverified backup is a verification that damages what it was meant to protect, so most of this
// guard is about what the drill is forbidden to do.
function testRestoreDrill(): void {
  assert.ok(/DRILL_DB="zsystems_restore_drill"/.test(drillScript), 'the drill must restore into its own database');
  assert.ok(/CREATE DATABASE \$DRILL_DB/.test(drillScript), 'the drill creates its scratch database');
  assert.ok(/DROP DATABASE IF EXISTS \$DRILL_DB/.test(drillScript), 'the drill drops its scratch database');
  assert.ok(/trap cleanup EXIT/.test(drillScript), 'the scratch database must be dropped even when the drill fails');

  // Nothing in the drill may drop, truncate, delete from or write to the production database.
  const forbidden: RegExp[] = [
    /DROP DATABASE[^\n]*\$DB_NAME/,
    /DROP DATABASE[^\n]*zsystems_db\b/,
    /TRUNCATE/i,
    /DELETE FROM/i,
    /UPDATE\s+\w+\s+SET/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(drillScript), `the restore drill must never write to production (found ${pattern})`);
  }
  const liveQueries = drillScript.match(/live_q "[^"]+"/g) || [];
  assert.ok(liveQueries.length > 0, 'the drill must compare the restored copy against production');
  for (const query of liveQueries) {
    assert.ok(/^live_q "select /i.test(query), `every production query in the drill must be read-only (found ${query})`);
  }

  // What it actually verifies: a restore that "succeeds" into an empty database proves nothing.
  assert.ok(/PostgreSQL database dump complete/.test(drillScript), 'the drill must reject a truncated dump before restoring it');
  assert.ok(/grep -c "\^ERROR"/.test(drillScript), 'errors during the restore must be counted, not ignored');
  assert.ok(/pg_constraint where contype='f'/.test(drillScript), 'the drill must compare foreign keys (the O65 failure mode)');
  // The first real run reported "a constraint was dropped" with no name, and identifying it took a
  // full manual diagnosis. An alert that cannot be acted on without a second investigation is half
  // an alert, so the drill must name the constraint and quote the error.
  assert.ok(/MISSING_FK=/.test(drillScript), 'a dropped foreign key must be named in the alert');
  assert.ok(/FIRST_ERROR=/.test(drillScript), 'the first restore error must be quoted in the alert');
  assert.ok(/kysely_migration/.test(drillScript), 'the drill must reject a copy older than the live schema');
  assert.ok(/RESTORE DRILL OK/.test(drillScript), 'a successful drill must leave a line the watchdog can look for');
  assert.ok(/RESTORE DRILL OK/.test(watchScript), 'the watchdog must notice a failed or missing drill');
}

function run(): void {
  testNoBuildOnServer();
  testNoLiveDistDeletion();
  testMigrationOrderAndRollback();
  testDeploysTestedCommit();
  testBackupScript();
  testNoCommittedParUrl();
  testHourlyBackupMode();
  testRestoreDrill();
  // eslint-disable-next-line no-console
  console.log('deploy-pipeline.spec: all deploy and backup invariants hold (DEPLOY-1..DEPLOY-8)');
}

try {
  run();
  process.exit(0);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
}
