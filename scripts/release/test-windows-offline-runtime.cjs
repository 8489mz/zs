#!/usr/bin/env node
// Windows-only packaged PostgreSQL/backend smoke: disposable store, never customer data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const http = require('node:http');
const { setTimeout: sleep } = require('node:timers/promises');
const PostgresManager = require('../../frontend/electron/postgres-manager.cjs');

function exec(file, args, env = {}) {
  return cp.execFileSync(file, args, {
    encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...process.env, ...env },
  }).trim();
}
function isLive(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health/live', timeout: 1500 },
      res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}
async function run() {
  assert.equal(process.platform, 'win32', 'Requires actual Windows runner');
  assert.ok(process.argv[2], 'Usage: node test-windows-offline-runtime.cjs <release-dir>');
  const buildOutput = path.resolve(process.argv[2]);
  // Windows runner D:\\a is a CI checkout mount; PostgreSQL initdb must change the
  // data directory ACL. Check real portable runtime in a user-owned installation
  // directory, not in the restricted checkout mount. The original artifact stays clean.
  const testInstallRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-windows-offline-'));
  const release = path.join(testInstallRoot, 'Z-ERP-Offline');
  console.log('Copying complete candidate into disposable user-writable Windows installation path:', release);
  fs.cpSync(buildOutput, release, { recursive: true });
  const runtime = path.join(release, 'runtime');
  for (const relative of [
    'ZSystems POS.exe',
    'resources/app.asar.unpacked/electron/backend/dist/main.js',
    'resources/app.asar.unpacked/dist/index.html',
    'tools/launcher/scripts/ApplyAndRestart.ps1',
  ]) assert.ok(fs.existsSync(path.join(release, relative)), 'Packaged file missing: ' + relative);
  const manifestFile = path.join(runtime, 'runtime-manifest.sha256');
  const manifest = fs.readFileSync(manifestFile, 'utf8').trim().split(/\r?\n/);
  for (const line of manifest) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match, 'Invalid manifest line');
    const absolute = path.resolve(runtime, ...match[2].split('/'));
    assert.ok(absolute.startsWith(runtime + path.sep), 'Manifest traversal rejected');
    const actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    assert.equal(actual, match[1], 'Packaged runtime SHA256 mismatch: ' + match[2]);
  }
  const data = path.join(runtime, 'data');
  assert.ok(!fs.existsSync(data), 'Release must never ship database data');
  assert.ok(!fs.existsSync(path.join(runtime, '.postgres-auth.json')), 'Release must not ship database credentials');
  assert.ok(!fs.existsSync(path.join(data, '.postgres-auth.json')), 'Release must not ship database credentials inside data');
  const node = path.join(runtime, 'node/node.exe');
  assert.match(exec(node, ['--version']), /^v22\./);
  const manager = new PostgresManager('', false, runtime);
  const psql = path.join(manager.postgresBinDir, 'psql.exe');
  const query = sql => exec(psql, [
    '-h', '127.0.0.1', '-p', manager.dbPort, '-U', manager.dbUser,
    '-d', manager.dbName, '-v', 'ON_ERROR_STOP=1', '-tAc', sql,
  ], { PGPASSWORD: manager.dbPass });
  let backend = null;
  try {
    await manager.setupAndStart();
    assert.match(manager.dbPass, /^[a-f0-9]{48}$/, 'Per-installation password required');
    assert.ok(fs.existsSync(path.join(data, '.postgres-auth.json')), 'Database credentials must be persisted inside data/');
    assert.ok(!fs.existsSync(path.join(runtime, '.postgres-auth.json')), 'Database credentials must not remain outside data/');
    assert.equal(query('SELECT 1'), '1', 'PostgreSQL did not start');
    query('CREATE TABLE IF NOT EXISTS offline_ci_probe (id integer PRIMARY KEY, value text NOT NULL)');
    query("INSERT INTO offline_ci_probe VALUES (1, 'durable') ON CONFLICT (id) DO NOTHING");
    manager.stopServer();

    // Same installer data and credentials, fresh process and new manager instance.
    const restarted = new PostgresManager('', false, runtime);
    assert.equal(restarted.dbPass, manager.dbPass, 'Restarted manager must reload persisted authentication');
    await restarted.setupAndStart();
    manager.dbPass = restarted.dbPass;
    assert.equal(query('SELECT value FROM offline_ci_probe WHERE id = 1'), 'durable');

    const backendRoot = path.join(release, 'resources/app.asar.unpacked/electron/backend');
    const backendEntry = path.join(backendRoot, 'dist/main.js');
    const port = 31041;
    const env = {
      ...process.env, ...manager.getEnvironmentVariables(),
      APP_MODE: 'SELF_CONTAINED', IS_ELECTRON: 'true', PORTABLE_MODE: 'false',
      NODE_ENV: 'production', TENANT_ID: 'default', ACCOUNT_ID: 'default',
      APP_HOST: '127.0.0.1', APP_PORT: String(port), SKIP_MIGRATIONS: 'false',
      Z_DATA_DIR: data,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      SESSION_CSRF_SECRET: crypto.randomBytes(32).toString('hex'),
      CORS_ORIGINS: 'http://127.0.0.1:' + port,
      ALLOW_SESSION_ID_HEADER: 'true',
      DEVELOPER_MASTER_PASSWORD: crypto.randomBytes(24).toString('hex'),
    };
    const backendLog = path.join(runtime, 'logs/backend-smoke.log');
    const fd = fs.openSync(backendLog, 'w');
    backend = cp.spawn(node, [backendEntry], {
      cwd: backendRoot, env, stdio: ['ignore', fd, fd], windowsHide: true,
    });
    fs.closeSync(fd);
    let started = false;
    for (let i = 0; i < 100; i++) {
      if (backend.exitCode !== null) break;
      if (await isLive(port)) { started = true; break; }
      await sleep(1200);
    }
    if (!started) throw new Error('Packaged backend/migrations did not become healthy:\n' +
      fs.readFileSync(backendLog, 'utf8').slice(-10000));
    assert.equal(query('SELECT value FROM offline_ci_probe WHERE id = 1'), 'durable');
    console.log('REAL WINDOWS RUNTIME PASS: packaged postgres/initdb/start/stop/restart, durable row, packaged Node and Nest backend health/migrations.');
    console.log('LIMIT: no offline network isolation, no Electron GUI interaction, no customer hardware or updater install test.');
  } finally {
    if (backend && backend.exitCode === null) {
      backend.kill();
      await sleep(2500);
    }
    try { manager.stopServer(); } catch (err) { console.error(err.message); }
    for (const file of ['data', 'logs', '.postgres-auth.json', '.postgres-auth.json.tmp', 'postgres.pw']) {
      fs.rmSync(path.join(runtime, file), { recursive: true, force: true });
    }
    fs.rmSync(testInstallRoot, { recursive: true, force: true });
  }
}
run().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
