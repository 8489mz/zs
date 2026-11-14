#!/usr/bin/env node
/**
 * File-size cap guard (frontend half) — ratchet, not cliff.
 *
 * Rule (INV-FILE-SIZE-CAP-RATCHET, proposed at merge): no production source
 * file under frontend/src may exceed 1000 lines, EXCEPT files recorded in
 * the ratchet baseline (scripts/baselines/file-size.json) at their recorded
 * line count. A baseline file may SHRINK (partial splits pass) but must
 * never GROW past its recorded count. A file over the cap that is not in
 * the baseline fails. Remove a baseline entry when its file drops to
 * <= 1000 lines (each split package does this for its own file).
 *
 * Counting matches `wc -l`: a trailing newline does not create an extra
 * line (see countLines).
 *
 * Why not the shared enforceWithBaseline helper: it compares violation
 * STRINGS, so a file shrinking 7460 -> 5000 lines would read as a NEW
 * violation and fail CI mid-split. This check is count-aware instead.
 *
 * Twin: backend/scripts/file-size-guard.cjs implements the same semantics
 * for backend/src. Keep the two in sync when the rule changes.
 *
 * CLI (test/maintenance hooks; defaults cover the real tree):
 *   --root <dir>       src root to check (default: <cwd>/src)
 *   --baseline <file>  baseline JSON (default: scripts/baselines/file-size.json)
 *   --update-baseline  rewrite the baseline from the current tree instead
 *                      of failing (also via UPDATE_ARCH_BASELINE=1)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_SIZE_CAP = 1000;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

// Permanent allowlist (sweep §1 + hands-off). Never counted.
const ALLOWLIST = new Set([
  'src/features/contracting/utils/engineeringMasterPricingCore.ts', // MASTER-DATA-ADJACENT
  'src/features/storefront/lib/storefront-demo-data.ts', // DEMO DATA
  'src/shared/components/icons/AppIcons.tsx', // ICON CATALOG
  'src/features/storefront/lib/storefront-translations.ts', // TRANSLATION DATA
  'src/shared/components/icons/product-svg-catalog.tsx', // ICON CATALOG
  'src/features/settings/components/modular-configurator/modular-presets.ts', // PRESET DATA
  'src/shared/utils/ai-background-removal.ts', // HANDS-OFF — never split, never counted
]);

export function countLines(source) {
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

export function enforceFileSizeCap({ srcRoot, baselineFile, allowlist = ALLOWLIST, cap = FILE_SIZE_CAP, updateBaseline = false }) {
  const baseline = loadBaseline(baselineFile);
  const entries = baseline.entries;
  const effectiveCap = baseline.cap || cap;

  const checked = [];
  const overCap = [];
  const violations = [];
  const shrunk = [];

  for (const full of walkSourceFiles(srcRoot)) {
    const rel = toSrcRel(srcRoot, full);
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

// CLI entrypoint — skipped when imported (specs import the functions above).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const argValue = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = argValue('--root') || path.join(process.cwd(), 'src');
  const baselineFile = argValue('--baseline') || path.join(scriptDir, 'baselines', 'file-size.json');
  const updateBaseline = argv.includes('--update-baseline') || process.env.UPDATE_ARCH_BASELINE === '1';
  try {
    const result = enforceFileSizeCap({ srcRoot, baselineFile, updateBaseline });
    if (updateBaseline) {
      console.log(`\nFrontend file-size cap: baseline updated with ${result.baselineEntries} accepted oversized file(s).`);
    } else {
      if (result.shrunk.length) {
        console.log(
          `\nFrontend file-size cap: ${result.shrunk.length} baseline file(s) shrank below their recorded count — remove them from the baseline when they reach <= ${FILE_SIZE_CAP} lines.`,
        );
      }
      console.log(
        `\nFrontend file-size cap passed (${result.checked} files checked, ${result.overCap} over ${FILE_SIZE_CAP} lines, ${result.baselineEntries} baseline entries).`,
      );
    }
  } catch (error) {
    console.error(`\nFrontend file-size cap failed:\n${error.message}`);
    process.exit(1);
  }
}
