/**
 * File-size cap guard (backend half) — ratchet, not cliff.
 *
 * Rule (INV-FILE-SIZE-CAP-RATCHET, proposed at merge): no production source
 * file under backend/src may exceed 1000 lines, EXCEPT files recorded in
 * the ratchet baseline (scripts/baselines/file-size.json) at their recorded
 * line count. A baseline file may SHRINK (partial splits pass) but must
 * never GROW past its recorded count. A file over the cap that is not in
 * the baseline fails. Remove a baseline entry when its file drops to
 * <= 1000 lines (each split package does this for its own file).
 *
 * Counting matches `wc -l`: a trailing newline does not create an extra
 * line (the old guardrails counting read one line high, effective cap
 * 999 — fixed here; see countLines).
 *
 * Twin: frontend/scripts/file-size-check.mjs implements the same semantics
 * for frontend/src. Keep the two in sync when the rule changes.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE_SIZE_CAP = 1000;

// Source extensions under the cap (sweep scope: .ts/.tsx, plus .js-family
// for completeness — backend/src has one .js file, test-api.js).
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

function countLines(source) {
  const parts = source.split(/\r?\n/);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

function isSpecFile(relPosix) {
  return /\.spec\.[^.]+$/.test(relPosix) || /\.test\.[^.]+$/.test(relPosix);
}

function walkSourceFiles(srcRoot) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      out.push(full);
    }
  }
  walk(srcRoot);
  return out.sort();
}

function toSrcRel(srcRoot, fullPath) {
  return `src/${path.relative(srcRoot, fullPath).split(path.sep).join('/')}`;
}

function loadBaseline(baselineFile) {
  if (!fs.existsSync(baselineFile)) return { cap: FILE_SIZE_CAP, entries: {} };
  const parsed = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  return { cap: parsed.cap || FILE_SIZE_CAP, entries: parsed.entries || {} };
}

/**
 * Enforce the cap. Options:
 *   srcRoot (required), baselineFile (required),
 *   allowlist: Set of `src/...` paths never counted (generated / master
 *     data / hands-off files),
 *   skipPrefixes: string[] of `src/...` prefixes never walked (migrations),
 *   cap (default 1000), updateBaseline (rewrite the baseline from the
 *     current tree instead of failing).
 * Returns { checked, overCap, baselineEntries, shrunk, violations }.
 * Throws Error listing every violation when violations exist and
 * updateBaseline is false.
 */
function enforceFileSizeCap(options) {
  const {
    srcRoot,
    baselineFile,
    allowlist = new Set(),
    skipPrefixes = [],
    cap = FILE_SIZE_CAP,
    updateBaseline = false,
  } = options;
  const baseline = loadBaseline(baselineFile);
  const entries = baseline.entries;
  const effectiveCap = baseline.cap || cap;

  const checked = [];
  const overCap = []; // { rel, lines }
  const violations = [];
  const shrunk = [];

  for (const full of walkSourceFiles(srcRoot)) {
    const rel = toSrcRel(srcRoot, full);
    if (skipPrefixes.some((prefix) => rel.startsWith(prefix))) continue;
    if (isSpecFile(rel)) continue;
    if (allowlist.has(rel)) continue;
    const lines = countLines(fs.readFileSync(full, 'utf8'));
    checked.push(rel);
    if (lines <= effectiveCap) continue;
    overCap.push({ rel, lines });
    if (!(rel in entries)) {
      violations.push(`${rel} (${lines} lines, not in baseline)`);
      continue;
    }
    if (lines > entries[rel]) {
      violations.push(`${rel} (${lines} lines, grew from baseline ${entries[rel]})`);
    } else if (lines < entries[rel]) {
      shrunk.push({ file: rel, from: entries[rel], to: lines });
    }
  }

  if (updateBaseline) {
    const next = {};
    for (const { rel, lines } of overCap) next[rel] = lines;
    const sorted = {};
    for (const key of Object.keys(next).sort()) sorted[key] = next[key];
    const doc = {
      cap: effectiveCap,
      generatedAt: new Date().toISOString().slice(0, 10),
      base: 'regenerated with --update-baseline (review before committing)',
      note: 'Ratchet baseline: files over the 1000-line cap. A file fails the check only if it is over the cap and NOT listed here, or if it GREW past its recorded line count. Shrinkage (including partial splits) passes. Remove an entry when its file drops to <= 1000 lines.',
      entries: sorted,
    };
    fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
    fs.writeFileSync(baselineFile, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    return { checked: checked.length, overCap: overCap.length, baselineEntries: Object.keys(sorted).length, shrunk, violations: [] };
  }

  if (violations.length) {
    throw new Error(
      `File-size cap (${effectiveCap} lines) violated by ${violations.length} file(s):\n- ${violations.join('\n- ')}\n` +
        'Split the file (a partial split that shrinks it passes), or — only for a deliberate, reviewed exception — add it to the baseline.',
    );
  }

  return {
    checked: checked.length,
    overCap: overCap.length,
    baselineEntries: Object.keys(entries).length,
    shrunk,
    violations: [],
  };
}

module.exports = { FILE_SIZE_CAP, countLines, enforceFileSizeCap, loadBaseline };
