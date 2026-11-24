#!/usr/bin/env node
// Cheap release gate for the exact regression that left customer Electron running
// while a detached updater attempted to replace its ASAR-unpacked files.
// This is an invariant/source contract, NOT a substitute for a Windows EXE E2E test.
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const electron = readFileSync(path.join(root, 'frontend/electron/main.cjs'), 'utf8');
const updater = readFileSync(path.join(root, 'portable/tools/launcher/scripts/ApplyAndRestart.ps1'), 'utf8');
const service = readFileSync(path.join(root, 'backend/src/modules/settings/services/offline-releases/offline-releases-apply.ts'), 'utf8')
  + readFileSync(path.join(root, 'backend/src/modules/settings/services/offline-releases/offline-releases-zip-version.ts'), 'utf8');

const updateHandler = electron.match(/backendProcess\.on\('exit',[\s\S]*?\n\s*}\);/)?.[0];
assert.ok(updateHandler, 'Electron backend exit event missing');
assert.match(updateHandler, /code === 0[\s\S]*?isForceClosing = true;\s*app\.quit\(\)/,
  'Controlled update exit must bypass the normal customer confirmation dialog');
assert.doesNotMatch(updateHandler, /code === 0[\s\S]*?isQuitting = true;\s*app\.quit\(\)/,
  'Setting isQuitting before before-quit skips PostgreSQL clean shutdown');
assert.match(electron, /app\.on\('before-quit', cleanShutdown\)/,
  'Before quit must release bundled database');
assert.match(electron, /ELECTRON_MAIN_PID: String\(process\.pid\)/,
  'Backend must get the Electron PID for exact process exit coordination');

assert.doesNotMatch(service, /const psCommand = 'cmd\.exe'/,
  'Offline updater must not use cmd.exe /c start quoting and asynchronous shell handoff');
assert.match(service, /const psCommand = 'powershell\.exe'/,
  'Offline updater should start powershell.exe detached and check process creation');

const pidCount = (service.match(/electronMainPid: Number\(process\.env\.ELECTRON_MAIN_PID/g) || []).length;
assert.equal(pidCount, 3, 'All three update entry points must hand off parent Electron PID');
assert.match(updater, /Wait-Process -Id \$previousElectronPid -Timeout/,
  'Updater must wait for old Electron process exit, not assume fixed delay suffices');
assert.match(updater, /if \(Get-Process -Id \$previousElectronPid/,
  'Updater must abort rather than replacing locked executable files');
assert.match(updater, /Complete PostgreSQL cluster and authentication backup verified/,
  'Database credentials must be snapshotted with PostgreSQL cluster');
assert.match(updater, /Restored complete pre-update PostgreSQL cluster and credentials/,
  'Rollback must restore database credentials');
assert.match(updater, /New Electron release did not become healthy/,
  'Update should rollback after failed health check');
assert.match(updater, /Get-FileHash -Path \$zipPath -Algorithm SHA256/,
  'Downloaded patch must be authenticated before unpacking');
console.log('Electron update lifecycle regression contracts passed.');
