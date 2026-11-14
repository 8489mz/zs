/*
 * File-size cap guard spec (INV-FILE-SIZE-CAP-RATCHET, proposed at merge).
 *
 * WHAT THIS PINS: the 1000-line cap is enforced as a RATCHET, not a cliff.
 * The current tree still has ~134 files over the cap (recorded in the two
 * per-side baselines), so a guard that failed on every one of them would
 * turn CI permanently red. Instead the check fails only when a file over
 * the cap is NOT in the baseline, or when a baseline file GREW past its
 * recorded line count. A baseline file may SHRINK (partial splits pass).
 *
 * WHAT IS DRIVEN (real code, temp fixtures — no mocks):
 * (a) the backend guard module (backend/scripts/file-size-guard.cjs, the
 *     same module check-architecture-guardrails.cjs calls) against temp
 *     src trees: unlisted oversized file throws naming it; a baseline
 *     file grown past its recorded count throws; a baseline file at its
 *     recorded count passes; a baseline file shrunk (still over the cap)
 *     passes; a file at exactly 1000 lines passes.
 * (b) the frontend check (frontend/scripts/file-size-check.mjs) as a
 *     child process against a temp tree with --root/--baseline: unlisted
 *     oversized file exits 1; --update-baseline records it; the same
 *     tree then exits 0.
 * (c) countLines matches `wc -l` for files ending with a newline
 *     (the old guardrails counting read one line high, effective cap
 *     999 — a 1000-line file failed; the fix is pinned by (a)'s
 *     exactly-1000 case).
 * (d) wiring pins: the backend guardrails script requires the guard
 *     module and calls enforceFileSizeCap; frontend package.json
 *     qa:architecture runs file-size-check.mjs; both real checks pass
 *     on the current tree (spawned, not stubbed).
 *
 * Fail-first: RED was proven by running the wired checks against a
 * scratch 1001-line file (backend exit 1 naming it; frontend exit 1
 * naming it) and restoring green afterwards — see the guard package log.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';

const guard = require('../../scripts/file-size-guard.cjs');

const repoRoot = path.resolve(__dirname, '../../..');
const backendRoot = path.join(repoRoot, 'backend');
const frontendRoot = path.join(repoRoot, 'frontend');

function writeFile(root: string, rel: string, lines: number): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  // Every line terminated by \n, so wc -l == content lines == `lines`.
  fs.writeFileSync(full, Array(lines).fill('// fixture line\n').join(''), 'utf8');
}

function makeFixture(): { root: string; src: string; baseline: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-size-cap-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  return { root, src, baseline: path.join(root, 'baseline.json') };
}

function writeBaseline(baselineFile: string, entries: Record<string, number>): void {
  fs.writeFileSync(
    baselineFile,
    JSON.stringify({ cap: 1000, generatedAt: '2026-11-14', base: 'spec-fixture', entries }, null, 2),
    'utf8',
  );
}

async function main(): Promise<void> {
  // (c) countLines matches wc -l on newline-terminated files.
  assert.equal(guard.countLines(''), 0, 'empty file has 0 lines');
  assert.equal(guard.countLines('one\n'), 1, 'one newline-terminated line counts 1');
  assert.equal(guard.countLines('a\nb\n'), 2, 'two lines count 2');
  assert.equal(guard.countLines('a\nb'), 2, 'a file without a trailing newline still has 2 content lines');
  assert.equal(guard.countLines(Array(1001).join('x\n')), 1000, 'exactly 1000 lines count 1000, not 1001');
  console.log('  countLines boundary cases passed');

  // (a) Backend module against temp fixtures.
  {
    const { src, baseline } = makeFixture();
    writeFile(src, 'small.ts', 10);
    writeFile(src, 'at-cap.ts', 1000);
    writeFile(src, 'oversized.ts', 1001);
    writeBaseline(baseline, {});
    assert.throws(
      () => guard.enforceFileSizeCap({ srcRoot: src, baselineFile: baseline }),
      (err: any) => err.message.includes('src/oversized.ts (1001 lines, not in baseline)'),
      'unlisted oversized file must fail naming it',
    );
    console.log('  backend RED: unlisted oversized file throws passed');
  }
  {
    const { src, baseline } = makeFixture();
    writeFile(src, 'grown.ts', 1500);
    writeBaseline(baseline, { 'src/grown.ts': 1200 });
    assert.throws(
      () => guard.enforceFileSizeCap({ srcRoot: src, baselineFile: baseline }),
      (err: any) => err.message.includes('src/grown.ts (1500 lines, grew from baseline 1200)'),
      'a baseline file grown past its recorded count must fail',
    );
    console.log('  backend RED: grown baseline file throws passed');
  }
  {
    const { src, baseline } = makeFixture();
    writeFile(src, 'listed.ts', 1200);
    writeFile(src, 'shrunk.ts', 1100);
    writeFile(src, 'at-cap.ts', 1000);
    writeBaseline(baseline, { 'src/listed.ts': 1200, 'src/shrunk.ts': 1500 });
    const result = guard.enforceFileSizeCap({ srcRoot: src, baselineFile: baseline });
    assert.equal(result.violations.length, 0, 'listed, shrunk and at-cap files must pass');
    assert.equal(result.shrunk.length, 1, 'the shrunk file is reported');
    assert.equal(result.shrunk[0].file, 'src/shrunk.ts', 'the shrunk file is named');
    console.log('  backend GREEN: listed + shrunk + at-cap pass passed');
  }

  // (b) Frontend check as a child process against a temp tree.
  {
    const { src, baseline } = makeFixture();
    writeFile(src, 'oversized.ts', 1001);
    writeBaseline(baseline, {});
    const checkScript = path.join(frontendRoot, 'scripts', 'file-size-check.mjs');
    const red = spawnSync(process.execPath, [checkScript, '--root', src, '--baseline', baseline], { encoding: 'utf8' });
    assert.equal(red.status, 1, 'frontend check must exit 1 on an unlisted oversized file');
    assert.ok(red.stderr.includes('src/oversized.ts (1001 lines, not in baseline)'), 'frontend failure names the file');
    console.log('  frontend RED: unlisted oversized file exits 1 passed');
    const update = spawnSync(process.execPath, [checkScript, '--root', src, '--baseline', baseline, '--update-baseline'], {
      encoding: 'utf8',
    });
    assert.equal(update.status, 0, '--update-baseline must exit 0');
    const green = spawnSync(process.execPath, [checkScript, '--root', src, '--baseline', baseline], { encoding: 'utf8' });
    assert.equal(green.status, 0, 'frontend check must exit 0 once the file is baselined');
    console.log('  frontend GREEN: --update-baseline then pass passed');
  }

  // (d) Wiring pins.
  {
    const guardrails = fs.readFileSync(path.join(backendRoot, 'scripts', 'check-architecture-guardrails.cjs'), 'utf8');
    assert.ok(guardrails.includes("require('./file-size-guard.cjs')"), 'guardrails script requires the file-size guard module');
    assert.ok(guardrails.includes('enforceFileSizeCap('), 'guardrails script calls enforceFileSizeCap');
    assert.ok(guardrails.includes('baselines/file-size.json'), 'guardrails script reads the backend baseline');
    const frontendPkg = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
    assert.ok(
      String(frontendPkg.scripts['qa:architecture']).includes('node scripts/file-size-check.mjs'),
      'qa:architecture runs the frontend file-size check',
    );
    for (const [side, file] of [
      ['backend', path.join(backendRoot, 'scripts', 'baselines', 'file-size.json')],
      ['frontend', path.join(frontendRoot, 'scripts', 'baselines', 'file-size.json')],
    ] as const) {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(doc.cap, 1000, `${side} baseline cap is 1000`);
      assert.ok(Object.keys(doc.entries).length > 0, `${side} baseline has entries`);
      assert.ok(!('src/shared/utils/ai-background-removal.ts' in doc.entries), 'hands-off file is never baselined');
    }
    console.log('  wiring pins passed');
  }

  // (d) Both real checks pass on the current tree (spawned, not stubbed).
  {
    const backendCheck = spawnSync(process.execPath, [path.join(backendRoot, 'scripts', 'check-architecture-guardrails.cjs')], {
      cwd: backendRoot,
      encoding: 'utf8',
    });
    assert.equal(backendCheck.status, 0, `backend guardrails check must pass on the current tree: ${backendCheck.stderr}`);
    const frontendCheck = spawnSync(process.execPath, [path.join(frontendRoot, 'scripts', 'file-size-check.mjs')], {
      cwd: frontendRoot,
      encoding: 'utf8',
    });
    assert.equal(frontendCheck.status, 0, `frontend file-size check must pass on the current tree: ${frontendCheck.stderr}`);
    console.log('  real-tree checks pass passed');
  }

  console.log('file-size-cap-guard: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
