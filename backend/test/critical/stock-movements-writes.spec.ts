/*
 * INV-STOCK-MOVEMENTS-WRITE-INVENTORY: stock-movements writes spec.
 *
 * This spec pins docs/STOCK_MOVEMENTS_WRITES.md: the line-based scan
 * of backend/src must find exactly 65 direct stock_movements writes,
 * and every one must be listed in the document by file:line. Any new
 * direct write (or a removed one) fails this spec, so the inventory
 * can only change deliberately, with the document updated in the same
 * package. That is the precondition for Phase 1 (single writer):
 * you cannot route writes through one place until you know all of
 * them.
 *
 * Classifier (identical to the grounding scan that produced the
 * inventory): a line containing 'stock_movements' is a business
 * WRITE iff the line itself calls insertInto('stock_movements'),
 * deleteFrom('stock_movements'), or .from('stock_movements').update,
 * or an insertInto( call on the line names the table on the next
 * line. Comments, type declarations, backup table-name lists and
 * reads (selectFrom / .from().select) are not writes. Spec/test
 * files and database/migrations + database/legacy-migration are
 * excluded (schema/migration code, not business writes).
 *
 * Fail-first: the classifier self-checks below were proven against
 * synthetic violating and clean samples, and the count assertion was
 * proven by temporarily adding one extra insertInto call in a scratch
 * file and watching this spec fail, then removing it and watching it
 * go green again.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend', 'src');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const PINNED_WRITE_COUNT = 37;

type Kind = 'WRITE-insert' | 'WRITE-delete' | 'WRITE-update' | 'READ' | 'OTHER';

function classify(lines: string[], idx: number): Kind {
  const line = lines[idx];
  const stripped = line.trim();
  if (stripped.startsWith('//') || stripped.startsWith('*')) return 'OTHER';
  if (/insertInto\(\s*['"]stock_movements['"]/.test(line)) return 'WRITE-insert';
  if (/deleteFrom\(\s*['"]stock_movements['"]/.test(line)) return 'WRITE-delete';
  if (/insertInto\(\s*$/.test(line)) {
    const nxt = idx + 1 < lines.length ? lines[idx + 1] : '';
    if (/['"]stock_movements['"]/.test(nxt)) return 'WRITE-insert';
  }
  if (/\.from\(\s*['"]stock_movements['"]/.test(line)) {
    const window = lines.slice(idx, idx + 4).join('\n');
    if (/\.update\(/.test(window)) return 'WRITE-update';
    return 'READ';
  }
  if (/selectFrom\(\s*['"]stock_movements/.test(line)) return 'READ';
  if (/stock_movements\s*:/.test(line)) return 'OTHER';
  return 'OTHER';
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkTsFiles(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

interface WriteSite {
  file: string;
  line: number;
  kind: Kind;
}

function scanWrites(): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const file of walkTsFiles(BACKEND_SRC)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (
      rel.startsWith('backend/src/database/migrations/') ||
      rel.startsWith('backend/src/database/legacy-migration/')
    ) {
      continue;
    }
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let idx = 0; idx < lines.length; idx += 1) {
      if (!lines[idx].includes('stock_movements')) continue;
      const kind = classify(lines, idx);
      if (kind.startsWith('WRITE')) {
        sites.push({ file: rel, line: idx + 1, kind });
      }
    }
  }
  return sites;
}

async function main(): Promise<void> {
  // 0. Classifier self-checks (fail-first: synthetic samples).
  assert.equal(
    classify(["  await trx.insertInto('stock_movements').values({"], 0),
    'WRITE-insert',
    'insertInto on the line is a write',
  );
  assert.equal(
    classify(["  await trx.deleteFrom('stock_movements').where('id', '=', 1).execute();"], 0),
    'WRITE-delete',
    'deleteFrom on the line is a write',
  );
  assert.equal(
    classify(["  const rows = await trx.selectFrom('stock_movements').selectAll().execute();"], 0),
    'READ',
    'selectFrom is a read, not a write',
  );
  assert.equal(
    classify(['  // stock_movements rows whose before/after balances were hardcoded 0'], 0),
    'OTHER',
    'a comment mentioning the table is not a write',
  );
  assert.equal(classify(['  stock_movements: StockMovementTable;'], 0), 'OTHER', 'a type declaration is not a write');
  assert.equal(
    classify(['    .insertInto(', "      'stock_movements')"], 0),
    'WRITE-insert',
    'insertInto split across two lines is a write',
  );
  assert.equal(
    classify(["    .from('stock_movements')", '      .update({ qty: 0 })'], 0),
    'WRITE-update',
    '.from().update is a write',
  );
  assert.equal(
    classify(["    .from('stock_movements')", "      .select('id')"], 0),
    'READ',
    '.from().select is a read',
  );

  // 1. The scanned write count must equal the pinned inventory.
  const sites = scanWrites();
  assert.equal(
    sites.length,
    PINNED_WRITE_COUNT,
    `direct stock_movements writes: scanned ${sites.length}, pinned ${PINNED_WRITE_COUNT} — a new write appeared or one was removed; update docs/STOCK_MOVEMENTS_WRITES.md in the same package`,
  );

  // 2. Every scanned write must be listed in the document by file:line.
  assert.ok(fs.existsSync(DOC_PATH), 'docs/STOCK_MOVEMENTS_WRITES.md must exist');
  const doc = fs.readFileSync(DOC_PATH, 'utf8');
  assert.ok(
    doc.includes('Total business writes: **37**'),
    'docs/STOCK_MOVEMENTS_WRITES.md must state the pinned total of 37',
  );
  for (const site of sites) {
    assert.ok(
      doc.includes(`${site.file}:${site.line}`),
      `docs/STOCK_MOVEMENTS_WRITES.md is missing the write at ${site.file}:${site.line}`,
    );
  }

  // 3. The document must not list writes the scan no longer finds
  //    (a stale row would hide that a write moved or was removed).
  const docRows = doc
    .split('\n')
    .filter((line) => line.startsWith('| backend/src/'))
    .map((line) => line.split('|')[1].trim());
  assert.equal(
    docRows.length,
    PINNED_WRITE_COUNT,
    `docs/STOCK_MOVEMENTS_WRITES.md lists ${docRows.length} rows, pinned ${PINNED_WRITE_COUNT}`,
  );
  const scannedKeys = new Set(sites.map((s) => `${s.file}:${s.line}`));
  for (const row of docRows) {
    assert.ok(
      scannedKeys.has(row),
      `docs/STOCK_MOVEMENTS_WRITES.md lists ${row}, which the scan no longer finds as a write`,
    );
  }

  console.log(
    `stock movements writes checks passed (${sites.length} direct writes, all listed in docs/STOCK_MOVEMENTS_WRITES.md)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
