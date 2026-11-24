/*
 * INV-DELETE-PAGINATE-ROWS: the deleted in-memory pagination helper must
 * never come back. This spec walks backend/src and asserts that no file
 * contains the helper's name, and that the shared util file itself is
 * gone.
 *
 * WHY THIS SHAPE: the repo-wide grep for the helper's name must return
 * zero hits, and this spec is the living proof of that. The needle is built
 * by joining two halves so this file itself never contains the literal
 * name — otherwise the spec would be its own first violation. The walk
 * covers backend/src only, so the spec's own directory can never
 * self-match (the same technique as architecture-guard.spec.ts).
 *
 * Fail-first: on the pre-deletion tree this spec exits 1 listing the
 * offending files (the shared util, the dead sales copy, the dead
 * imports and the "semantics preserved" comments); after the deletion
 * it exits 0.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_SRC = path.resolve(__dirname, '../../src');
// Built from halves so this file never contains the literal name.
const NEEDLE = ['paginate', 'Rows'].join('');

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function main(): void {
  assert.ok(fs.existsSync(BACKEND_SRC), `backend/src must exist at ${BACKEND_SRC}`);
  assert.ok(
    !fs.existsSync(path.join(BACKEND_SRC, 'common', 'utils', 'pagination.ts')),
    'the shared in-memory pagination util must be deleted',
  );
  const files: string[] = [];
  walk(BACKEND_SRC, files);
  assert.ok(files.length > 0, 'backend/src walk must find files');
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(NEEDLE)) offenders.push(path.relative(BACKEND_SRC, file));
  }
  assert.equal(
    offenders.length,
    0,
    `the deleted in-memory pagination helper must not appear in backend/src; ` +
      `found in ${offenders.length} file(s): ${offenders.join(', ') || 'none'}`,
  );
  console.log(`no-paginate-rows check passed (${files.length} files scanned)`);
}

main();
