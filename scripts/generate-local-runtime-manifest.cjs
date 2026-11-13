#!/usr/bin/env node
/**
 * Generates portable/runtime/runtime-manifest.sha256 from the local bundled
 * PostgreSQL (bin/lib/share) and Node 22 runtime directories without altering
 * the installed PostgreSQL version or bundling local data/logs/credentials.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(REPO_ROOT, 'portable', 'runtime');
const MANIFEST_PATH = path.join(RUNTIME_DIR, 'runtime-manifest.sha256');

const REQUIRED_RUNTIME_PATHS = [
  'postgres/bin/postgres.exe',
  'postgres/bin/pg_ctl.exe',
  'postgres/bin/initdb.exe',
  'postgres/bin/psql.exe',
  'postgres/bin/pg_dump.exe',
  'postgres/bin/pg_isready.exe',
  'postgres/bin/createdb.exe',
  'postgres/lib',
  'postgres/share',
  'node/node.exe',
  'node/npm.cmd',
  'node/node_modules/npm/bin/npm-cli.js',
];

// Matches stage-windows-offline-runtime.ps1 scope: Node runtime + PostgreSQL bin/lib/share
// (excludes local pgAdmin 4, doc, include, StackBuilder, data, logs).
const RUNTIME_SUBDIRS = ['node', 'postgres/bin', 'postgres/lib', 'postgres/share'];

function collectFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function sha256File(filePath) {
  const data = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function main() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    throw new Error(`Runtime directory missing: ${RUNTIME_DIR}`);
  }

  for (const relative of REQUIRED_RUNTIME_PATHS) {
    const full = path.join(RUNTIME_DIR, relative);
    if (!fs.existsSync(full)) {
      throw new Error(`Required local runtime path missing: ${relative}`);
    }
  }

  const allFiles = [];
  for (const subdir of RUNTIME_SUBDIRS) {
    collectFiles(path.join(RUNTIME_DIR, subdir), allFiles);
  }

  const entries = await mapWithConcurrency(allFiles, 16, async (filePath) => {
    const relative = path.relative(RUNTIME_DIR, filePath).replace(/\\/g, '/');
    return { relative, hash: await sha256File(filePath) };
  });

  const lines = entries
    .sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0))
    .map(({ relative, hash }) => `${hash}  ${relative}`);

  fs.writeFileSync(MANIFEST_PATH, lines.join('\n') + '\n', 'utf8');
  console.log(`[generate-local-runtime-manifest] Wrote ${lines.length} SHA-256 entries to ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
