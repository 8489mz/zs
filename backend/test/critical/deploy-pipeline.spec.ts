import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guard for the production deploy and backup invariants DEPLOY-1..DEPLOY-12
// (ARCHITECTURE_INVARIANTS.md §2.7, docs/DEPLOYMENT_PIPELINE.md).
// DEPLOY-9 is the Item 5 migration-auto-revert package, now live on main (691f45ab6);
// DEPLOY-10 is the Item 7 Sentry package, now live on main (ef3a365fe);
// DEPLOY-11 is the repo Telegram-bot check script, now live on main (ef3a365fe);
// DEPLOY-12 is the auto-deploy package in this commit.
// Each of these was a real production incident on 2026-09-22: the old flow deleted dist and rebuilt
// on the 1-OCPU server (1754 failed PM2 restarts), and the nightly backup had silently not run for
// three weeks. Nothing fails functionally when these regress — production just goes down during
// every deploy or loses its backups. If one of these fails, the test is almost always right.

const ROOT = join(__dirname, '..', '..', '..');
// Normalised to LF: Windows checkouts get CRLF (core.autocrlf) and the regexes below match on \n.
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

const workflow = read('.github/workflows/deploy-oracle.yml');
const ciFull = read('.github/workflows/ci-full.yml');
const ciFast = read('.github/workflows/ci.yml');
const deployDoc = read('docs/DEPLOYMENT_PIPELINE.md');
const invariants = read('ARCHITECTURE_INVARIANTS.md');
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
  assert.ok(
    /working-directory: backend[\s\S]*?npm run build/.test(runnerPart),
    'backend must be built on the GitHub runner',
  );
  assert.ok(
    /working-directory: frontend[\s\S]*?npm run build/.test(runnerPart),
    'frontend must be built on the GitHub runner',
  );
  assert.ok(
    /tar -czf release\.tgz backend\/dist frontend\/dist/.test(runnerPart),
    'the prebuilt dist folders are shipped as release.tgz',
  );
}

// DEPLOY-2: the live dist folders are never deleted before the new build is in place.
function testNoLiveDistDeletion(): void {
  const remote = remoteScript();
  assert.ok(
    !/rm -rf ("?\$TARGET_DIR\/)?(backend\/|frontend\/)?dist"?\s*$/m.test(remote),
    'never rm -rf a live dist folder',
  );
  assert.ok(
    /swap_in "\$TARGET_DIR\/backend\/dist"/.test(remote),
    'backend/dist is replaced by swap_in (mv), not rebuilt in place',
  );
  assert.ok(
    /swap_in "\$TARGET_DIR\/frontend\/dist"/.test(remote),
    'frontend/dist is replaced by swap_in (mv), not rebuilt in place',
  );
}

// DEPLOY-3: migrations run before the new code goes live; a failed health check rolls back.
function testMigrationOrderAndRollback(): void {
  const remote = remoteScript();
  const migrateAt = remote.indexOf('npm run migration:run');
  const backupAt = remote.indexOf('zsystems-backup.sh" hourly');
  const swapAt = remote.indexOf('swap_in "$TARGET_DIR/backend/dist"');
  const reloadAt = remote.indexOf('pm2 reload zsystems-backend');
  assert.ok(
    backupAt > -1 && migrateAt > -1 && swapAt > -1 && reloadAt > -1,
    'backup, migrate, swap and reload must all be present',
  );
  assert.ok(
    backupAt < migrateAt && migrateAt < swapAt && swapAt < reloadAt,
    'order must be: encrypted backup -> migrate -> swap -> reload',
  );
  assert.ok(
    /if ! check_health; then[\s\S]*?swap_back "\$TARGET_DIR\/backend\/dist"[\s\S]*?exit 1/.test(remote),
    'an unhealthy deploy must swap the previous build back and fail the job',
  );
  assert.ok(/set -euo pipefail/.test(remote), 'the server step must stop on the first error');
}

// DEPLOY-9: a failed deploy leaves the DATABASE at the pre-deploy schema, not
// just the folders. Before the fix the remote script rolled only the folders
// back: a failed migration left already-applied migrations in place, and a
// health-check failure left the new schema under the old code.
function testMigrationAutoRevert(): void {
  const remote = remoteScript();
  // The pre-deploy schema is recorded BEFORE the migrate step, fail-closed.
  const listAt = remote.indexOf('npm run --silent migration:list');
  const migrateAt = remote.indexOf('npm run migration:run');
  assert.ok(
    listAt > -1 && migrateAt > -1 && listAt < migrateAt,
    'the pre-deploy migration list must be captured before migration:run',
  );
  assert.ok(
    /PRE_MIGRATION_COUNT/.test(remote) && /refusing to deploy/.test(remote),
    'a missing or empty pre-deploy migration list must refuse the deploy, not migrate blind',
  );
  // Migration failure traps into the DB decision instead of aborting with the schema half-applied.
  assert.ok(
    /if ! npm run migration:run; then[\s\S]*?restore_db_to_pre_deploy[\s\S]*?exit 1/.test(remote),
    'a failed migration:run must restore the database to the pre-deploy schema and fail the job',
  );
  // The revert loop uses one `down` per migration and verifies the count drops:
  // Kysely's migrateDown silently skips a migration with no `down` and still
  // exits 0, so an exit code alone proves nothing.
  assert.ok(/npm run migration:revert/.test(remote), 'the revert loop must call migration:revert');
  assert.ok(
    /did not reduce the applied count/.test(remote),
    'a revert that does not reduce the applied count must fall through to the backup restore',
  );
  // Last resort: the step-4 hourly backup. zsystems-restore.sh cannot do this
  // (daily bundles only, and `full` refuses a non-empty database), so the
  // script restores the encrypted hourly pg_dump itself, with the drill's recipe.
  assert.ok(/zsystems_hourly_\*\.sql\.gz\.enc/.test(remote), 'the restore source must be the step-4 hourly backup');
  assert.ok(
    /openssl enc -d -aes-256-cbc -pbkdf2/.test(remote),
    'the hourly backup must be decrypted with the drill recipe',
  );
  assert.ok(
    /DROP DATABASE IF EXISTS zsystems_db WITH \(FORCE\)/.test(remote),
    'the live database must be dropped before the dump is restored into it',
  );
  assert.ok(
    /CREATE DATABASE zsystems_db/.test(remote),
    'the live database must be recreated before the dump is restored into it',
  );
  assert.ok(/grep -c "\^ERROR"/.test(remote), 'errors during the restore must be counted, not ignored');
  // Health-check failure applies the same DB decision instead of folder-only rollback, then re-checks.
  assert.ok(
    /if ! check_health; then[\s\S]*?swap_back "\$TARGET_DIR\/backend\/dist"[\s\S]*?restore_db_to_pre_deploy[\s\S]*?check_health[\s\S]*?exit 1/.test(
      remote,
    ),
    'an unhealthy deploy must restore the database to the pre-deploy schema, re-check health, and fail the job',
  );
  // The failure alert still fires: the Telegram step runs on job failure.
  assert.ok(
    /if: failure\(\)/.test(workflow) && /TELEGRAM_BOT_TOKEN/.test(workflow),
    'a failed or rolled-back deploy must still send the Telegram failure alert',
  );
}

// DEPLOY-4: the commit that passed CI is the one deployed.
function testDeploysTestedCommit(): void {
  // A production deploy requires a verified green main SHA (workflow_run on successful CI or workflow_dispatch).
  assert.ok(
    /workflow_run:[\s\S]*?workflows:\s*\["ci-full"\][\s\S]*?branches:[\s\S]*?-\s*main/.test(workflow),
    'production deployment must automatically trigger on ci-full completion for main',
  );
  assert.ok(/workflow_dispatch:/.test(workflow), 'production deployment must support workflow_dispatch');
  assert.ok(
    /github\.ref == 'refs\/heads\/main'/.test(workflow) ||
      /github\.event\.workflow_run\.head_branch == 'main'/.test(workflow),
    'deployment must be authorized from main',
  );
  assert.ok(/DEPLOY_SHA:/.test(workflow), 'deployment must lock an exact main SHA');
  assert.ok(
    /actions: read/.test(workflow) &&
      /actions\/workflows\/ci-full\.yml\/runs\?head_sha=\$DEPLOY_SHA&per_page=100/.test(workflow) &&
      !/actions\/workflows\/ci-full\.yml\/runs\?head_sha=\$DEPLOY_SHA&event=/.test(workflow) &&
      /\(\.event == \\?"workflow_dispatch\\?" or \.event == \\?"push\\?"\)/.test(workflow) &&
      /test "\$PASSED" -ge 1/.test(workflow) &&
      /CURRENT_MAIN/.test(workflow),
    'current main SHA must already have a successful full-CI (push or workflow_dispatch) run verified before deploy',
  );
  assert.ok(/git reset --hard "\$DEPLOY_SHA"/.test(remoteScript()), 'server must reset to the exact CI-verified SHA');
  assert.ok(/cancel-in-progress: false/.test(workflow), 'an active deployment must not be cancelled mid-swap');
  assert.ok(
    /secrets\.ORACLE_SSH_KNOWN_HOSTS/.test(workflow) &&
      !/StrictHostKeyChecking=no/.test(workflow) &&
      (workflow.match(/StrictHostKeyChecking=yes/g) || []).length === 2,
    'both SSH operations must verify the pinned production host key',
  );
}

// DEPLOY-5: the backup produces a valid dump.
function testBackupScript(): void {
  assert.ok(!/docker exec[^\n|]*\s-t\b/.test(backupScript), 'docker exec -t injects \\r into the SQL dump');
  assert.ok(/set -euo pipefail/.test(backupScript), 'a failed pg_dump must fail the backup, not write an empty file');
  assert.ok(
    /PostgreSQL database dump complete/.test(backupScript),
    'the dump must be verified complete before it is kept',
  );
  assert.ok(
    /\/etc\/zsystems\/backup-par-url/.test(backupScript),
    'the off-site upload URL is read from the server, not the repo',
  );
  assert.ok(
    /refusing to create or upload an unencrypted backup/.test(backupScript),
    'backups must fail closed when the encryption passphrase is missing',
  );
  assert.ok(
    /encrypted full-database fallback/.test(backupScript),
    'a failed bundle must fall back to an encrypted dump, never a raw dump',
  );
  assert.ok(
    !/uploading the plain database dump instead/.test(backupScript),
    'raw database dumps must never be uploaded',
  );
}

// DEPLOY-6: no Object Storage pre-authenticated URL is ever committed (the repo is public).
function testNoCommittedParUrl(): void {
  const par = /objectstorage\.[a-z0-9-]+\.oraclecloud\.com\/p\//;
  for (const [name, text] of [
    ['deploy-oracle.yml', workflow],
    ['zsystems-backup.sh', backupScript],
  ] as const) {
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
  assert.ok(
    /zsystems_hourly_/.test(backupScript),
    'the hourly copy needs its own filename prefix so retention can target it',
  );
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
    assert.ok(
      /^live_q "select /i.test(query),
      `every production query in the drill must be read-only (found ${query})`,
    );
  }

  // What it actually verifies: a restore that "succeeds" into an empty database proves nothing.
  assert.ok(
    /PostgreSQL database dump complete/.test(drillScript),
    'the drill must reject a truncated dump before restoring it',
  );
  assert.ok(/grep -c "\^ERROR"/.test(drillScript), 'errors during the restore must be counted, not ignored');
  assert.ok(
    /pg_constraint where contype='f'/.test(drillScript),
    'the drill must compare foreign keys (the O65 failure mode)',
  );
  // The first real run reported "a constraint was dropped" with no name, and identifying it took a
  // full manual diagnosis. An alert that cannot be acted on without a second investigation is half
  // an alert, so the drill must name the constraint and quote the error.
  assert.ok(/MISSING_FK=/.test(drillScript), 'a dropped foreign key must be named in the alert');
  assert.ok(/FIRST_ERROR=/.test(drillScript), 'the first restore error must be quoted in the alert');
  assert.ok(/kysely_migration/.test(drillScript), 'the drill must reject a copy older than the live schema');
  assert.ok(/RESTORE DRILL OK/.test(drillScript), 'a successful drill must leave a line the watchdog can look for');
  assert.ok(/RESTORE DRILL OK/.test(watchScript), 'the watchdog must notice a failed or missing drill');
}

// DEPLOY-10: the live frontend build must be able to carry the Sentry DSN.
// Vite inlines import.meta.env at BUILD time (frontend/src/lib/error-tracking.ts reads
// VITE_ERROR_TRACKING_ENABLED / VITE_SENTRY_DSN from import.meta.env), so a DSN added later
// on the server can never reach the shipped bundle. Before this fix the "Build frontend"
// step passed only four VITE_ vars and dropped the DSN entirely: the frontend half of
// Sentry was unreachable by configuration alone, no matter what was set in GitHub or on
// the server. The backend half needs no workflow change — its env comes from the
// server-side .env file (deploy-oracle.yml step 6), which the repo never writes; whether
// ERROR_TRACKING_ENABLED / SENTRY_DSN are set there is a live-server check, recorded in
// docs (sentry-live-check.md), not something this guard can prove from the repo.
function testSentryFrontendBuildEnv(): void {
  const frontendBuild = workflow.match(/- name: Build frontend\n([\s\S]*?)\n\s*- name: Package release/);
  assert.ok(frontendBuild, 'the "Build frontend" step must exist before "Package release"');
  const env = frontendBuild[1];
  assert.ok(
    /VITE_ERROR_TRACKING_ENABLED: \$\{\{ vars\.VITE_ERROR_TRACKING_ENABLED \|\| 'false' \}\}/.test(env),
    'the frontend build must pass VITE_ERROR_TRACKING_ENABLED from vars, defaulting to false (tracking off until enabled)',
  );
  assert.ok(
    /VITE_SENTRY_DSN: \$\{\{ secrets\.VITE_SENTRY_DSN \|\| '' \}\}/.test(env),
    'the frontend build must pass VITE_SENTRY_DSN from secrets, defaulting to empty (no DSN baked in by accident)',
  );
  assert.ok(
    !/ingest\.sentry\.io/.test(workflow),
    'no literal Sentry DSN may ever be committed — the DSN comes from the secret, never from the repo',
  );
}

// DEPLOY-11: the repo's own Telegram bot must be provably postable, and the
// existing Telegram alert paths must stay wired. Three places already alert
// through the same Bot API call (POST api.telegram.org/bot<token>/sendMessage):
// deploy-oracle.yml (deploy failure / rollback), uptime-watch.yml (up/down
// state change), and TelegramAlertsService via the health controller (DB-down
// incident + the super-admin POST /api/health/telegram-test endpoint). All
// three read TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID from the environment only.
// backend/scripts/check-telegram-alerts.cjs proves that half of the chain:
// presence, token validity (getMe) and chat reachability (getChat), plus an
// opt-in --send-test message — and it fails closed (exit 1, naming the
// missing var) when the secrets are absent, without ever printing a value.
// Sentry alerts are NOT covered here and must not be confused with this
// bot: they travel via Sentry's own Telegram Alerts Bot, a dashboard
// integration with no repo code (sentry-live-check.md §7). The live
// getMe/getChat success path cannot run from a machine without a route to
// api.telegram.org — it is proven on the server, where the secrets live;
// this guard pins the fail-closed behaviour and the --check-only green path,
// which need no network.
function testTelegramAlertsCheck(): void {
  const scriptPath = join(ROOT, 'backend', 'scripts', 'check-telegram-alerts.cjs');
  const script = read('backend/scripts/check-telegram-alerts.cjs');
  assert.ok(
    /process\.env\.TELEGRAM_BOT_TOKEN/.test(script),
    'the Telegram check script must read the bot token from the environment, never from the repo',
  );
  assert.ok(
    /process\.env\.TELEGRAM_CHAT_ID/.test(script),
    'the Telegram check script must read the chat id from the environment, never from the repo',
  );
  assert.ok(
    !/bot\d{6,}:/.test(script),
    'no literal Telegram bot token may ever be committed — the token comes from the secret, never from the repo',
  );
  for (const line of script.split('\n')) {
    if (/console\.(log|error|warn)\(/.test(line)) {
      assert.ok(
        !/\b(botToken|chatId)\b/.test(line),
        `no console line in the Telegram check script may log a secret value (${line.trim().slice(0, 80)})`,
      );
    }
  }
  // The existing alert paths must stay wired: deploy failure alert and the
  // uptime state-change alert both still call sendMessage with the secrets.
  assert.ok(
    /Send Telegram Deployment Notification/.test(workflow) && /if: failure\(\)/.test(workflow),
    'the deploy workflow must keep its failure-only Telegram notification step',
  );
  const uptimeWorkflow = read('.github/workflows/uptime-watch.yml');
  assert.ok(
    /TELEGRAM_BOT_TOKEN/.test(uptimeWorkflow) && /sendMessage/.test(uptimeWorkflow),
    'the uptime-watch workflow must keep its Telegram state-change alert',
  );

  const scrubbedEnv: Record<string, string | undefined> = { ...process.env };
  delete scrubbedEnv.TELEGRAM_BOT_TOKEN;
  delete scrubbedEnv.TELEGRAM_CHAT_ID;
  const runScript = (args: string[], env: Record<string, string | undefined>) =>
    spawnSync(process.execPath, [scriptPath, ...args], { env, encoding: 'utf8', timeout: 30000 });

  // No secrets at all: exit 1, naming the missing token first.
  const noEnv = runScript([], scrubbedEnv);
  assert.equal(noEnv.status, 1, 'the Telegram check must fail closed with no secrets set');
  assert.ok(/TELEGRAM_BOT_TOKEN/.test(noEnv.stderr), 'the failure must name the missing TELEGRAM_BOT_TOKEN');
  // Token only: exit 1, naming the missing chat id.
  const tokenOnly = runScript([], { ...scrubbedEnv, TELEGRAM_BOT_TOKEN: 'dummy-token-for-test' });
  assert.equal(tokenOnly.status, 1, 'the Telegram check must fail closed with only the token set');
  assert.ok(/TELEGRAM_CHAT_ID/.test(tokenOnly.stderr), 'the failure must name the missing TELEGRAM_CHAT_ID');
  assert.ok(
    !/dummy-token-for-test/.test(tokenOnly.stdout + tokenOnly.stderr),
    'the Telegram check must never echo a secret value',
  );
  // Both set, presence only: exit 0 with no network involved.
  const checkOnly = runScript(['--check-only'], {
    ...scrubbedEnv,
    TELEGRAM_BOT_TOKEN: 'dummy-token-for-test',
    TELEGRAM_CHAT_ID: 'dummy-chat-for-test',
  });
  assert.equal(checkOnly.status, 0, 'the Telegram check --check-only must pass when both vars are set');
  assert.ok(
    !/dummy-token-for-test|dummy-chat-for-test/.test(checkOnly.stdout + checkOnly.stderr),
    'the Telegram check must never echo a secret value',
  );
  // Both dummy, live verification: exit 1 — a dummy token is rejected by
  // Telegram, and a machine with no route to api.telegram.org fails the
  // same way. Either way the script must fail closed and leak nothing.
  const live = runScript([], {
    ...scrubbedEnv,
    TELEGRAM_BOT_TOKEN: 'dummy-token-for-test',
    TELEGRAM_CHAT_ID: 'dummy-chat-for-test',
  });
  assert.equal(live.status, 1, 'the Telegram check must fail closed for an invalid token');
  assert.ok(
    !/dummy-token-for-test|dummy-chat-for-test/.test(live.stdout + live.stderr),
    'the Telegram check must never echo a secret value',
  );
}

// DEPLOY-12: a push to main runs the full suite and deploys itself when green.
// ci-full runs on every push to main (path-filtered, in parallel with the fast
// stage); the deploy job accepts a green ci-full run triggered by a push or by
// a manual dispatch, on the exact SHA, on main, in this repo. A red ci-full
// never deploys, and ci-fast alone never deploys (deploy watches ci-full
// only). DEPLOY-9 (migration auto-revert, Item 5), DEPLOY-10 (Sentry
// frontend build env, Item 7) and DEPLOY-11 (Telegram bot check) are all
// live on main; this number follows them.
function testAutoDeploy(): void {
  // ci-full triggers on push to main — and still on dispatch and PRs.
  assert.ok(/on:\n\s+push:\n\s+branches:\n\s+-\s*main/.test(ciFull), 'ci-full must run on every push to main');
  assert.ok(/workflow_dispatch:/.test(ciFull), 'ci-full must keep its manual dispatch trigger');
  assert.ok(/pull_request:/.test(ciFull), 'ci-full must keep its pull-request trigger');
  // The fast stage's header must no longer claim the full suite is dispatch-only.
  assert.ok(
    !/runs only on workflow_dispatch/.test(ciFast),
    'ci.yml must not claim ci-full runs only on workflow_dispatch',
  );
  assert.ok(/runs on every push to main/.test(ciFast), 'ci.yml must say the full suite runs on every push to main');

  // The deploy gate accepts a push-triggered green ci-full run — and still
  // requires success, main, this repo, and the exact SHA.
  assert.ok(/workflows:\s*\["ci-full"\]/.test(workflow), 'deploy must watch ci-full only, never ci-fast');
  assert.ok(
    /github\.event\.workflow_run\.event == 'push'/.test(workflow),
    'the deploy gate must accept push-triggered ci-full runs',
  );
  assert.ok(
    /github\.event\.workflow_run\.event == 'workflow_dispatch'/.test(workflow),
    'the deploy gate must keep accepting dispatch-triggered ci-full runs',
  );
  assert.ok(
    /github\.event\.workflow_run\.conclusion == 'success'/.test(workflow),
    'a red ci-full must still block deploy',
  );
  assert.ok(
    /github\.event\.workflow_run\.head_branch == 'main'/.test(workflow),
    'deploy must still require the run to be on main',
  );
  assert.ok(
    /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/.test(workflow),
    'deploy must still require the run to be in this repo',
  );
  assert.ok(
    /DEPLOY_SHA:/.test(workflow) && /github\.event\.workflow_run\.head_sha/.test(workflow),
    'deploy must still lock the exact SHA of the green run',
  );

  // The pipeline doc describes the real pipeline: push -> ci-fast + ci-full
  // -> auto-deploy on green ci-full. The old claim (push -> ci -> deploy)
  // must be gone from both places it appeared.
  assert.ok(
    /تُطلق `ci\.yml` \(الفحص السريع\) و`ci-full\.yml` \(المجموعة الكاملة\)/.test(deployDoc),
    'the pipeline doc must say a push triggers ci-fast and ci-full',
  );
  assert.ok(/بعد اكتمال `ci-full` بنجاح/.test(deployDoc), 'the pipeline doc must say deploy follows a green ci-full');
  assert.ok(
    /نجاح `ci\.yml` وحده لا ينشر شيئاً/.test(deployDoc),
    'the pipeline doc must say a fast-green push alone never deploys',
  );
  assert.ok(!/بعد اكتمال `ci` بنجاح/.test(deployDoc), 'the pipeline doc must not claim deploy follows a green ci run');

  // The invariant entry exists exactly once (presence-pinned; the guard spec
  // owns the last-line order assertion).
  assert.equal(invariants.split('INV-AUTO-DEPLOY').length - 1, 1, 'the invariant entry must exist exactly once');
}

function run(): void {
  testNoBuildOnServer();
  testNoLiveDistDeletion();
  testMigrationOrderAndRollback();
  testMigrationAutoRevert();
  testDeploysTestedCommit();
  testBackupScript();
  testNoCommittedParUrl();
  testHourlyBackupMode();
  testRestoreDrill();
  testSentryFrontendBuildEnv();
  testTelegramAlertsCheck();
  testAutoDeploy();
  console.log('deploy-pipeline.spec: all deploy and backup invariants hold (DEPLOY-1..DEPLOY-12)');
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
