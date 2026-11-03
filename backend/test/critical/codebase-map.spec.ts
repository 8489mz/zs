/*
 * INV-CODEBASE-MAP: codebase map guard spec.
 *
 * This spec guards docs/CODEBASE_MAP.md, the static text map for AI
 * agents and human developers. It pins only structure that must stay
 * true on every regeneration: the map exists, it carries the required
 * sections, it names every backend module directory and every frontend
 * feature directory present in the tree, and it points at
 * docs/ENGINE_MAP.md as the source of truth for money engines.
 *
 * It deliberately does not assert exact file counts: counts rot on
 * every commit, and the map's freshness rule requires regeneration
 * (not hand-edits) when directories are added, removed, or renamed.
 * Directory presence is the stable contract; counts are informational.
 *
 * Style follows backend/test/critical/architecture-guard.spec.ts:
 * plain node:assert checks run by ts-node, no test runner. The spec
 * reads the repository on disk. It imports no production code and
 * needs no database.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function listDirectories(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main(): Promise<void> {
  // 1. The map exists and names the HEAD it was grounded at.
  const mapPath = path.join(REPO_ROOT, 'docs/CODEBASE_MAP.md');
  assert.ok(fs.existsSync(mapPath), 'docs/CODEBASE_MAP.md must exist');
  const map = fs.readFileSync(mapPath, 'utf8');
  assert.ok(map.includes('Base HEAD:'), 'map must name the HEAD it was grounded at');
  assert.ok(/[0-9a-f]{40}/.test(map), 'map must record a full 40-hex base HEAD');

  // 2. Required sections are present.
  const sections = [
    '## Grounded at',
    '## Freshness rule',
    '## Stack',
    '## Entry points',
    '## Backend modules',
    '## Frontend features',
    '## Source of truth',
    '## Not covered',
    '## Navigation recipes',
  ];
  for (const section of sections) {
    assert.ok(map.includes(section), `map must contain section ${section}`);
  }

  // 3. Every backend module directory is named in the map.
  const modulesDir = path.join(REPO_ROOT, 'backend/src/modules');
  const modules = listDirectories(modulesDir);
  assert.ok(modules.length > 0, 'backend/src/modules must contain module directories');
  for (const mod of modules) {
    assert.ok(
      map.includes(`backend/src/modules/${mod}/`),
      `map must name backend module directory ${mod}`,
    );
  }

  // 4. Every frontend feature directory is named in the map.
  const featuresDir = path.join(REPO_ROOT, 'frontend/src/features');
  const features = listDirectories(featuresDir);
  assert.ok(features.length > 0, 'frontend/src/features must contain feature directories');
  for (const feature of features) {
    assert.ok(
      map.includes(`frontend/src/features/${feature}/`),
      `map must name frontend feature directory ${feature}`,
    );
  }

  // 5. ENGINE_MAP is the referenced source of truth for money engines.
  const engineMapPath = path.join(REPO_ROOT, 'docs/ENGINE_MAP.md');
  assert.ok(fs.existsSync(engineMapPath), 'docs/ENGINE_MAP.md must exist');
  assert.ok(
    map.includes('docs/ENGINE_MAP.md'),
    'map must reference docs/ENGINE_MAP.md as the source of truth for money engines',
  );
  assert.ok(
    map.includes('ARCHITECTURE_INVARIANTS.md'),
    'map must reference ARCHITECTURE_INVARIANTS.md for accounting rules',
  );

  // 6. Entry points named in the map exist in the tree.
  for (const entry of [
    'backend/src/main.ts',
    'backend/src/app.module.ts',
    'frontend/src/main.tsx',
    'frontend/electron/main.cjs',
  ]) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, entry)), `entry point ${entry} must exist`);
    assert.ok(map.includes(entry), `map must name entry point ${entry}`);
  }

  console.log('codebase map checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
