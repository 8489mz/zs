import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-require-imports -- the targets are untyped repo-root .cjs scripts (no .d.ts can live beside them from this checkout); the `as {...}` casts below give them their shapes. */
const { copyDirectoryFiltered, isExcludedPortablePath } = require('../../../scripts/customer-portable-release.cjs') as {
  copyDirectoryFiltered: (
    sourceDir: string,
    targetDir: string,
    options?: { exclude?: (relPath: string) => boolean },
  ) => void;
  isExcludedPortablePath: (relPath: string) => boolean;
};
const { verifyPortableRelease } = require('../../../scripts/verify-customer-portable-release.cjs') as {
  verifyPortableRelease: (releaseRoot: string) => { ok: boolean; root: string };
};
/* eslint-enable @typescript-eslint/no-require-imports */

function writeFile(root: string, relPath: string, content = 'x'): void {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function mkdir(root: string, relPath: string): void {
  fs.mkdirSync(path.join(root, relPath), { recursive: true });
}

function createValidReleaseTree(root: string): void {
  writeFile(root, 'app/backend/dist/main.js');
  writeFile(root, 'app/backend/package.json', '{}');
  writeFile(root, 'app/frontend/index.html');
  writeFile(root, 'config/.env.offline.template');
  writeFile(root, 'runtime/node/node.exe');
  writeFile(root, 'runtime/node/npm.cmd');
  writeFile(root, 'runtime/node/node_modules/npm/bin/npm-cli.js');
  writeFile(root, 'runtime/postgres/bin/postgres.exe');
  writeFile(root, 'runtime/postgres/bin/pg_ctl.exe');
  writeFile(root, 'runtime/postgres/bin/initdb.exe');
  writeFile(root, 'runtime/postgres/bin/psql.exe');
}

async function run(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-portable-release-'));
  try {
    const source = path.join(tempRoot, 'source');
    const copied = path.join(tempRoot, 'copied');
    writeFile(source, 'README.md');
    writeFile(source, 'config/.env.offline');
    writeFile(source, 'config/.env.offline.template');
    writeFile(source, 'runtime/node/node.exe');
    writeFile(source, 'runtime/postgres/bin/postgres.exe');
    writeFile(source, 'runtime/data/PG_VERSION');
    writeFile(source, 'runtime/logs/postgresql.log');
    writeFile(source, 'runtime/run/backend.pid');
    writeFile(source, 'app/backend/dist/main.js');

    copyDirectoryFiltered(source, copied, { exclude: isExcludedPortablePath });
    assert.equal(fs.existsSync(path.join(copied, 'README.md')), true);
    assert.equal(fs.existsSync(path.join(copied, 'config/.env.offline.template')), true);
    assert.equal(fs.existsSync(path.join(copied, 'runtime/node/node.exe')), true);
    assert.equal(fs.existsSync(path.join(copied, 'runtime/postgres/bin/postgres.exe')), true);
    assert.equal(fs.existsSync(path.join(copied, 'config/.env.offline')), false);
    assert.equal(fs.existsSync(path.join(copied, 'runtime/data')), false);
    assert.equal(fs.existsSync(path.join(copied, 'runtime/logs')), false);
    assert.equal(fs.existsSync(path.join(copied, 'runtime/run')), false);
    assert.equal(fs.existsSync(path.join(copied, 'app')), false);

    const releaseRoot = path.join(tempRoot, 'release');
    mkdir(releaseRoot, '.');
    createValidReleaseTree(releaseRoot);
    assert.equal(verifyPortableRelease(releaseRoot).ok, true);

    writeFile(releaseRoot, 'config/.env.offline');
    assert.throws(() => verifyPortableRelease(releaseRoot), /forbidden local\/generated files: config\/\.env\.offline/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('customer-portable-release.spec: ok');
}

void run();
