#!/usr/bin/env node
/**
 * Unit/filesystem verification for PostgresManager storing .postgres-auth.json
 * inside runtime/data/ with backward-compatible migration from legacy runtime/.postgres-auth.json.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PostgresManager = require('../frontend/electron/postgres-manager.cjs');

async function withRuntime(run) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-pg-auth-'));
  try {
    return await run(runtimeDir);
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
}

test('stores credentials inside data/.postgres-auth.json atomically', () =>
  withRuntime((runtimeDir) => {
    const manager = new PostgresManager('', false, runtimeDir);
    const expectedPass = 'a'.repeat(48);
    manager.saveDatabaseCredentials({ password: expectedPass });

    const dataAuth = path.join(runtimeDir, 'data', '.postgres-auth.json');
    const legacyAuth = path.join(runtimeDir, '.postgres-auth.json');
    assert.equal(fs.existsSync(dataAuth), true);
    assert.equal(fs.existsSync(dataAuth + '.tmp'), false);
    assert.equal(fs.existsSync(legacyAuth), false);

    const reloaded = new PostgresManager('', false, runtimeDir);
    assert.equal(reloaded.dbPass, expectedPass);
  }));

test('prefers data/.postgres-auth.json over stale runtime/.postgres-auth.json when data folder is swapped', () =>
  withRuntime((runtimeDir) => {
    const dataDir = path.join(runtimeDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const dataPass = 'b'.repeat(48);
    const staleLegacyPass = 'c'.repeat(48);
    fs.writeFileSync(path.join(dataDir, '.postgres-auth.json'), JSON.stringify({ password: dataPass }), 'utf8');
    fs.writeFileSync(path.join(runtimeDir, '.postgres-auth.json'), JSON.stringify({ password: staleLegacyPass }), 'utf8');

    const manager = new PostgresManager('', false, runtimeDir);
    assert.equal(manager.dbPass, dataPass);
  }));

test('migrates legacy runtime/.postgres-auth.json into data/ on setupAndStart for upgraded customers', async () => {
  await withRuntime(async (runtimeDir) => {
    const dataDir = path.join(runtimeDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '16\n', 'utf8');

    const legacyPass = 'd'.repeat(48);
    const legacyAuth = path.join(runtimeDir, '.postgres-auth.json');
    fs.writeFileSync(legacyAuth, JSON.stringify({ password: legacyPass }), 'utf8');

    const manager = new PostgresManager('', false, runtimeDir);
    assert.equal(manager.dbPass, legacyPass);

    // Stub external PostgreSQL process steps; this unit test verifies auth placement/migration only.
    manager.applyPerformanceTuning = () => {};
    manager.startServer = async () => {};
    manager.waitForReady = async () => true;
    manager.ensureDatabaseExists = async () => {};

    await manager.setupAndStart();

    const dataAuth = path.join(dataDir, '.postgres-auth.json');
    assert.equal(fs.existsSync(dataAuth), true);
    assert.equal(JSON.parse(fs.readFileSync(dataAuth, 'utf8')).password, legacyPass);
    assert.equal(fs.existsSync(legacyAuth), false);
  });
});

test('initializeDatabase keeps data/ empty while initdb runs and rejects if initdb fails', async () => {
  await withRuntime(async (runtimeDir) => {
    const manager = new PostgresManager('', false, runtimeDir);
    manager.ensureDirectories();
    // No initdb.exe exists inside temp runtimeDir, so spawn emits error and cleans postgres.pw without writing auth inside data/.
    await assert.rejects(() => manager.initializeDatabase());
    assert.equal(fs.existsSync(path.join(runtimeDir, 'postgres.pw')), false);
    assert.equal(fs.existsSync(path.join(runtimeDir, 'data', '.postgres-auth.json')), false);
    assert.deepEqual(fs.readdirSync(path.join(runtimeDir, 'data')), []);
  });
});
