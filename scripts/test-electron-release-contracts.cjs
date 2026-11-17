#!/usr/bin/env node
/**
 * Fast Electron release contract suite (runs via `node --test`).
 * Catches packaging, IPC preload<->main drift, version drift, security flags,
 * and Vite desktop relative-base regressions BEFORE running a full .exe build.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function uniqueMatches(source, regex) {
  const results = new Set();
  for (const match of source.matchAll(regex)) {
    if (match[1]) results.add(match[1]);
  }
  return [...results].sort();
}

test('package.json versions stay synchronized across root, frontend, and backend', () => {
  const rootPkg = readJson('package.json');
  const frontendPkg = readJson('frontend/package.json');
  const backendPkg = readJson('backend/package.json');

  assert.match(String(rootPkg.version || ''), /^\d+\.\d+\.\d+$/);
  assert.equal(
    frontendPkg.version,
    rootPkg.version,
    `frontend/package.json version (${frontendPkg.version}) drifted from root (${rootPkg.version})`,
  );
  assert.equal(
    backendPkg.version,
    rootPkg.version,
    `backend/package.json version (${backendPkg.version}) drifted from root (${rootPkg.version})`,
  );
});

test('Electron preload.cjs IPC channels and event listeners match main.cjs handlers', () => {
  const preload = readText('frontend/electron/preload.cjs');
  const main = readText('frontend/electron/main.cjs');

  const invokedChannels = uniqueMatches(preload, /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g);
  const sentChannels = uniqueMatches(preload, /ipcRenderer\.send\(\s*['"]([^'"]+)['"]/g);
  const subscribedEvents = uniqueMatches(preload, /ipcRenderer\.on\(\s*['"]([^'"]+)['"]/g);

  assert.ok(invokedChannels.length >= 10, 'Expected preload.cjs to expose Electron IPC handlers');

  for (const channel of invokedChannels) {
    assert.ok(
      main.includes(`ipcMain.handle('${channel}'`) || main.includes(`ipcMain.handle("${channel}"`),
      `preload.cjs invokes '${channel}', but main.cjs has no matching ipcMain.handle('${channel}')`,
    );
  }

  for (const channel of sentChannels) {
    assert.ok(
      main.includes(`ipcMain.on('${channel}'`) || main.includes(`ipcMain.on("${channel}"`),
      `preload.cjs sends '${channel}', but main.cjs has no matching ipcMain.on('${channel}')`,
    );
  }

  for (const eventName of subscribedEvents) {
    assert.ok(
      main.includes(`webContents.send('${eventName}'`) || main.includes(`webContents.send("${eventName}"`),
      `preload.cjs listens to '${eventName}', but main.cjs never emits webContents.send('${eventName}')`,
    );
  }

  assert.match(preload, /exposeInMainWorld\(\s*'electronPrinter'/);
  assert.match(preload, /getPrinters\s*:/);
  assert.match(preload, /printHtmlSilent\s*:/);
  assert.match(preload, /kickCashDrawer\s*:/);
});

test('Electron BrowserWindows enforce contextIsolation and disable nodeIntegration', () => {
  const main = readText('frontend/electron/main.cjs');

  const nodeIntegrationFlags = uniqueMatches(main, /nodeIntegration\s*:\s*(true|false)/g);
  const contextIsolationFlags = uniqueMatches(main, /contextIsolation\s*:\s*(true|false)/g);

  assert.deepEqual(nodeIntegrationFlags, ['false'], 'All Electron windows must set nodeIntegration: false');
  assert.deepEqual(contextIsolationFlags, ['true'], 'All Electron windows must set contextIsolation: true');
});

test('All Electron bootstrap, printing, maintenance, and packaging assets exist on disk', () => {
  const requiredFiles = [
    'frontend/electron/main.cjs',
    'frontend/electron/preload.cjs',
    'frontend/electron/postgres-manager.cjs',
    'frontend/electron/runtime-config.cjs',
    'frontend/electron/loading.html',
    'frontend/electron/config-error.html',
    'frontend/electron/server-offline.html',
    'frontend/electron/kick-drawer.ps1',
    'frontend/public/logo_cropped.png',
    'portable/tools/launcher/scripts/ApplyAndRestart.ps1',
    'zmt.bat',
    'scripts/zmt.cjs',
    'scripts/zmt.ps1',
    'scripts/sync-electron-backend.cjs',
    'scripts/build-electron-release.cjs',
  ];

  for (const relPath of requiredFiles) {
    assert.equal(
      fs.existsSync(path.join(ROOT, relPath)),
      true,
      `Missing Electron runtime/packaging file: ${relPath}`,
    );
  }
});

test('Electron build config and Vite desktop mode preserve relative paths and unpacked backend', () => {
  const frontendPkg = readJson('frontend/package.json');
  const viteConfig = readText('frontend/vite.config.ts');
  const main = readText('frontend/electron/main.cjs');

  assert.equal(frontendPkg.main, 'electron/main.cjs');
  assert.match(frontendPkg.scripts?.['build:electron-frontend'] || '', /tsc\.js -b/);
  assert.match(frontendPkg.scripts?.['build:electron-frontend'] || '', /vite\.js build --mode electron/);
  assert.match(frontendPkg.scripts?.['build:exe'] || '', /build:electron-frontend/);
  assert.match(frontendPkg.scripts?.['build:exe'] || '', /sync-electron-backend\.cjs/);
  assert.match(frontendPkg.scripts?.['build:exe'] || '', /build-electron-release\.cjs/);

  const buildCfg = frontendPkg.build || {};
  assert.ok(Array.isArray(buildCfg.asarUnpack), 'frontend build.asarUnpack must be configured');
  assert.ok(buildCfg.asarUnpack.includes('electron/backend/**/*'), 'electron/backend/**/* must stay unpacked');
  assert.ok(buildCfg.asarUnpack.includes('dist/**/*'), 'dist/**/* must stay unpacked for OTA patching');
  assert.ok(Array.isArray(buildCfg.files) && buildCfg.files.includes('dist/**/*'));
  assert.ok(buildCfg.files.includes('electron/**/*'));
  assert.equal(buildCfg.directories?.output, '../release');

  assert.match(viteConfig, /mode === 'electron'/);
  assert.match(viteConfig, /base:\s*isDesktop\s*\?\s*'\.\/'\s*:\s*'\/'/);

  // Guard silent print custom label geometry + clean print window teardown
  assert.ok(/pageSizeMm/.test(main), 'main.cjs print-html-silent must support custom pageSizeMm');
  assert.ok(
    /orientation === 'landscape'[\s\S]*landscape:\s*true/.test(main),
    'main.cjs print-html-silent must support landscape orientation',
  );
  assert.ok(/printWin\.destroy\(\)/.test(main), 'main.cjs print-html-silent must destroy hidden print window on finish');
});

if (process.env.ZS_VERIFY_ELECTRON_RUNTIME === '1') {
  test('Bundled portable runtime executables are present when ZS_VERIFY_ELECTRON_RUNTIME=1', () => {
    const runtimeDir = path.join(ROOT, 'portable/runtime');
    const requiredRuntime = [
      'postgres/bin/postgres.exe',
      'postgres/bin/pg_ctl.exe',
      'postgres/bin/initdb.exe',
      'postgres/bin/psql.exe',
      'postgres/bin/pg_dump.exe',
      'postgres/bin/pg_isready.exe',
      'postgres/bin/createdb.exe',
      'node/node.exe',
      'node/npm.cmd',
      'node/node_modules/npm/bin/npm-cli.js',
      'runtime-manifest.sha256',
    ];
    for (const relPath of requiredRuntime) {
      assert.equal(
        fs.existsSync(path.join(runtimeDir, relPath)),
        true,
        `Missing portable/runtime file required for EXE packaging: ${relPath}`,
      );
    }
  });
}
