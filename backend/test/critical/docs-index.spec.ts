/*
 * Docs-index spec.
 *
 * This spec pins docs/README.md, the single index over the scattered docs
 * in docs/: every top-level docs/*.md file and every subdirectory under docs/
 * on disk must be linked from it with a one-line purpose, the central
 * index must point at it, and the real documentation-integrity check
 * (scripts/validate-capabilities-docs.mjs) must pass when driven here.
 * Adding a doc without indexing it fails this spec and the check on
 * purpose. Grounded at this HEAD: 21 top-level docs (20 at the original
 * grounding plus sentry-live-check.md, added by the final-3 Package 2;
 * 19 at the original grounding plus FIRE_DRILL_PLAYBOOK.md, added by the backup/fire-drill
 * playbook package; the plan's 17 was counted before the fire-drill
 * playbook era and missed files) and 8
 * subdirectories; 16 of the 20 were linked from no index at all — only
 * the engine map (central index), the Claude brain (blueprint), the
 * product readiness status (root README) and the fire-drill playbook
 * (via DISASTER_RECOVERY.md) were reachable.
 *
 * The index itself never names an invariant id: the guard counts ids in
 * ARCHITECTURE_INVARIANTS.md, and an id in index prose would break the
 * exactly-once count. This spec pins that the new entry appears exactly
 * once in the invariants file; the architecture-guard spec owns the
 * tail assertion.
 *
 * Known staleness NOT fixed here, owned by the auto-deploy package:
 * docs/DEPLOYMENT_PIPELINE.md still claims push-to-main auto-deploys.
 * This spec pins only that the index does not repeat that claim.
 *
 * Fail-first: the link matcher is self-checked against a sample index
 * below (present file found, absent file not found), and the whole spec
 * fails exit 1 on the unpatched tree (no index file, unextended check).
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const INDEX_PATH = path.join(DOCS_DIR, 'README.md');
const CENTRAL_INDEX_PATH = path.join(REPO_ROOT, 'SYSTEM_CAPABILITIES.md');
const INVARIANTS_PATH = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const CHECK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'validate-capabilities-docs.mjs');

function topLevelDocs(): string[] {
  return fs
    .readdirSync(DOCS_DIR)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();
}

function subdirs(): string[] {
  return fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function isLinked(indexText: string, file: string): boolean {
  return indexText.includes(`](${file})`);
}

function isSubdirLinked(indexText: string, dir: string): boolean {
  return indexText.includes(`](${dir}/README.md)`) || indexText.includes(`](${dir}/)`);
}

async function main(): Promise<void> {
  // 0. Matcher self-check: the same functions the spec uses below.
  const sample =
    '# docs/ Index\n\n| [ENGINE_MAP.md](ENGINE_MAP.md) | Canonical money engines. |\n| [archive/](archive/) | Old docs. |\n';
  assert.equal(isLinked(sample, 'ENGINE_MAP.md'), true, 'link matcher must find a linked file');
  assert.equal(isLinked(sample, 'LOAD_TESTING.md'), false, 'link matcher must not find an unlinked file');
  assert.equal(isSubdirLinked(sample, 'archive'), true, 'subdir matcher must find a linked directory');
  assert.equal(isSubdirLinked(sample, 'hr'), false, 'subdir matcher must not find an unlinked directory');

  // 1. The index exists and is not a stub.
  assert.ok(fs.existsSync(INDEX_PATH), 'docs/README.md must exist: it is the single index over docs/');
  const indexText = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(indexText.length > 1000, 'docs/README.md must not be a stub');

  // 2. Every top-level docs/*.md file on disk is linked with a purpose.
  const files = topLevelDocs();
  assert.equal(
    files.length,
    21,
    'docs/ must hold 21 top-level .md files (re-pin this spec + the index if a doc is added or removed)',
  );
  for (const file of files) {
    assert.ok(isLinked(indexText, file), `docs/README.md is missing the link for docs/${file}`);
    const row = indexText.split('\n').find((line) => line.includes(`](${file})`));
    assert.ok(row, `docs/README.md must have a table row for docs/${file}`);
    const cells = row
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    assert.ok(
      cells.length >= 2 && cells[1].length > 10,
      `docs/README.md row for docs/${file} must carry a one-line purpose`,
    );
  }

  // 3. Every docs/*/ subdirectory is linked.
  const dirs = subdirs();
  assert.equal(
    dirs.length,
    8,
    'docs/ must hold 8 subdirectories (re-pin this spec + the index if one is added or removed)',
  );
  for (const dir of dirs) {
    assert.ok(isSubdirLinked(indexText, dir), `docs/README.md is missing the link for docs/${dir}/`);
  }

  // 4. The central index points at the docs index (single discovery path).
  const centralIndex = fs.readFileSync(CENTRAL_INDEX_PATH, 'utf8');
  assert.ok(centralIndex.includes('](docs/README.md)'), 'SYSTEM_CAPABILITIES.md must link docs/README.md');

  // 5. The index does not repeat the stale auto-deploy claim (owned by
  // the auto-deploy package, which fixes docs/DEPLOYMENT_PIPELINE.md).
  assert.ok(!/auto-deploy/i.test(indexText), 'docs/README.md must not claim auto-deploy');
  assert.ok(!/automatically/i.test(indexText), 'docs/README.md must not claim anything deploys automatically');

  // 6. The new invariant entry appears exactly once in the invariants
  // file (the guard counts occurrences; index prose never names it).
  const invariants = fs.readFileSync(INVARIANTS_PATH, 'utf8');
  const occurrences = invariants.split('INV-DOCS-INDEX').length - 1;
  assert.equal(occurrences, 1, 'INV-DOCS-INDEX must appear exactly once in ARCHITECTURE_INVARIANTS.md');

  // 7. Drive the REAL documentation-integrity check and require it green.
  assert.ok(fs.existsSync(CHECK_SCRIPT), 'scripts/validate-capabilities-docs.mjs must exist');
  let output = '';
  try {
    output = execFileSync('node', [CHECK_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; status?: number };
    assert.fail(
      `scripts/validate-capabilities-docs.mjs must exit 0 (got ${failed.status}): ${failed.stdout || ''}${failed.stderr || ''}`,
    );
  }
  assert.ok(output.includes('Capability docs OK'), 'integrity check must print its OK verdict');

  console.log('docs index checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
