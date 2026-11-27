/*
 * Phase 1 B1 — reports|sales circular pair broken (INV-PHASE1-B1-REPORTS-SALES-DECOUPLED).
 *
 * The pair was reports->sales 1 + sales->reports 1 (grounding Pair 5):
 * - reports->sales: reports-query.helper.ts imported discountedSaleSql /
 *   discountedReturnInvoiceSql from the SALES discount-filter helper
 *   (F13 deliberate coupling: one discounted-invoice predicate, shared
 *   by listOrders / listDriverSales / the rep lifetime report instead
 *   of three copies that could drift).
 * - sales->reports: sales-query.service.ts imports resolveTenantDayRange
 *   from the reports range helper (the tenant-day date filter).
 *
 * The break moves the discount-filter helper — the whole file, both
 * functions, byte-identical SQL — to the shared layer
 * (backend/src/common/utils/sales-discount-filter.helper.ts), the same
 * home as the stock-movement writer. MOVE, never duplicate: the F13
 * single-source property is preserved — all three consumers
 * (reports-query.helper, delivery-reps-reads, list-driver-sales) read
 * the ONE predicate from the shared home. The sales->reports leg
 * STAYS: the pair becomes one-way (sales reads the reports range
 * helper; reports no longer reads sales), which is not a cycle.
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: reports->sales 1 -> 0 (edge gone),
 *   delivery-reps->sales 11 -> 9 (its two discountedSaleSql imports
 *   now point at shared, which the scanner does not count as an edge),
 *   sales->reports stays 1; backend total 764 -> 760; backend edges
 *   73 -> 71; the reports|sales pair leaves the bidirectional list.
 *   (The −4 total is B1's −3 plus a stale-pin repair found by the
 *   live re-derivation: purchases->catalog was pinned 1 but is 0
 *   live — the word catalog occurs nowhere in the purchases module,
 *   and it was already 0 at A9 — so the dead edge leaves the table.
 *   B8's delivery-reps|sales grounding numbers shift by the same 2
 *   statements — re-derive live there, do not trust the grounding.)
 * - module-doors: the sales-discount-filter.helper door is RETIRED —
 *   the file no longer lives in a module, so it is no longer a
 *   cross-module door. docs/MODULE_DOORS.md drops its rows (sales
 *   door table 14 -> 13 files; section 4 8 -> 7 doors) and
 *   module-doors.spec.ts drops it from the resolved-doors list.
 *   (Doc note: the §4 row listed only delivery-reps (2) importers —
 *   the F13 reports import was never recorded there; the row is gone
 *   now, so the staleness retires with it.)
 * - Wiring: both critical lists carry 375 specs in identical order,
 *   the F5a spec last.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const OLD_HELPER = path.join(BACKEND, 'src', 'modules', 'sales', 'helpers', 'sales-discount-filter.helper.ts');
const NEW_HELPER = path.join(BACKEND, 'src', 'common', 'utils', 'sales-discount-filter.helper.ts');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');

// Exact compiled SQL of the two predicates, captured from the OLD home
// before the move (phase1-b1-sql-capture.ts, DummyDriver, zero params).
// The move must preserve the predicate text byte-for-byte.
const EXPECTED_SALE_SQL =
  'select * from "sales" where ("sales"."discount" > 0 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = "sales"."id" AND si.tenant_id = "sales"."tenant_id" AND si.line_discount > 0))';
const EXPECTED_RETURN_SQL =
  'select * from "return_documents" where EXISTS (SELECT 1 FROM sales s2 WHERE s2.id = "return_documents"."invoice_id" AND s2.tenant_id = "return_documents"."tenant_id" AND (s2.discount > 0 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s2.id AND si.tenant_id = s2.tenant_id AND si.line_discount > 0)))';

function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let state: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  while (i < n) {
    const c = source[i];
    const nxt = i + 1 < n ? source[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && nxt === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && nxt === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c;
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
    } else if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
    } else if (state === 'block') {
      if (c === '*' && nxt === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (c === '\n') out += c;
      i += 1;
    } else {
      out += c;
      if (c === '\\') {
        if (i + 1 < n) {
          out += source[i + 1];
          i += 2;
          continue;
        }
      } else if (c === state) {
        state = 'code';
      }
      i += 1;
    }
  }
  return out;
}

function specifiers(source: string): string[] {
  const clean = stripComments(source);
  const found: string[] = [];
  const fromRe = /from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(clean)) !== null) found.push(m[1]);
  return found;
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkTs(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function resolvesUnderModule(spec: string, fromFile: string, module: string): boolean {
  if (!spec.startsWith('.')) return false;
  const rel = path.relative(REPO_ROOT, fromFile).split(path.sep).join('/');
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
  return target.startsWith(`backend/src/modules/${module}/`);
}

async function main(): Promise<void> {
  // 1. The old home is gone: the helper no longer lives in sales.
  assert.ok(!fs.existsSync(OLD_HELPER), 'the sales discount-filter helper must be moved out of the sales module');

  // 2. The new shared home exists and exports both predicates.
  // The import path is a variable (not a literal) so the spec still
  // compiles on the base, where the file does not exist yet: RED-1
  // then fails on the structural blocks below (the circular import
  // still exists), not at load time. No @ts-ignore here — the linter
  // forbids it on an error-free line.
  assert.ok(fs.existsSync(NEW_HELPER), 'the discount-filter helper must exist in src/common/utils');
  const helperPath = '../../src/common/utils/sales-discount-filter.helper';
  const shared = await import(helperPath);
  assert.equal(typeof shared.discountedSaleSql, 'function', 'shared helper must export discountedSaleSql');
  assert.equal(
    typeof shared.discountedReturnInvoiceSql,
    'function',
    'shared helper must export discountedReturnInvoiceSql',
  );

  // 3. No reports file imports from sales any more (the broken leg).
  const reportsFiles = walkTs(path.join(BACKEND, 'src', 'modules', 'reports'));
  const reportsToSales: string[] = [];
  for (const file of reportsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (resolvesUnderModule(spec, file, 'sales')) reportsToSales.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(reportsToSales, [], 'no reports source file may import from the sales module');

  // 4. The remaining leg is exactly one file: sales-query.service.ts
  // reads resolveTenantDayRange from reports. One-way, not a cycle.
  const salesFiles = walkTs(path.join(BACKEND, 'src', 'modules', 'sales'));
  const salesToReports: string[] = [];
  for (const file of salesFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (resolvesUnderModule(spec, file, 'reports')) {
        salesToReports.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
        break;
      }
    }
  }
  assert.deepEqual(
    salesToReports,
    ['backend/src/modules/sales/services/sales-query.service.ts'],
    'the only sales->reports import must be sales-query.service.ts (resolveTenantDayRange)',
  );

  // 5. The boundary pins record the break. (Pin-table forms only,
  // scoped to the BACKEND table: the frontend table still pins its
  // own reports->sales edge (2 statements), and the header prose
  // still narrates the F13 edge and its B1 reversal.)
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  const backendTable = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_EDGES'),
    boundary.indexOf('PINNED_FRONTEND_EDGES'),
  );
  const backendPairs = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_BIDIRECTIONAL_PAIRS'),
    boundary.indexOf('PINNED_FRONTEND_BIDIRECTIONAL_PAIRS'),
  );
  assert.ok(!backendTable.includes("'reports->sales':"), 'module-boundary must no longer pin a reports->sales edge');
  assert.ok(!backendPairs.includes("'reports|sales',"), 'module-boundary must no longer list the reports|sales pair');
  assert.ok(
    boundary.includes("'delivery-reps->sales': 9,"),
    'module-boundary must re-pin delivery-reps->sales 11 -> 9',
  );
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary backend total is now 746 (B1 pinned 760; B2 re-pinned 760 -> 759; B3 re-pinned 759 -> 758; B4 re-pinned 758 -> 756; B5 re-pins 756 -> 752; B6 re-pins 752 -> 750; B7 re-pins 750 -> 746; B8 re-pins 746 -> 738)',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary backend edge table is now 64 (B1 pinned 71; B2 re-pinned 71 -> 70; B3 re-pinned 70 -> 69; B4 re-pinned 69 -> 68; B5 re-pins 68 -> 66; B6 re-pins 66 -> 65; B7 re-pins 65 -> 64; B8 re-pins 64 -> 63)',
  );
  assert.ok(
    !boundary.includes("'purchases->catalog':"),
    'module-boundary must drop the dead purchases->catalog pin (0 live since A9)',
  );

  // 6. All three consumers read the predicate from the shared home.
  const consumers: Array<{ file: string; sharedImport: string; oldImport: string }> = [
    {
      file: 'src/modules/reports/helpers/reports-query.helper.ts',
      sharedImport: "'../../../common/utils/sales-discount-filter.helper'",
      oldImport: "'../../sales/helpers/sales-discount-filter.helper'",
    },
    {
      file: 'src/modules/delivery-reps/delivery-reps-reads.service.ts',
      sharedImport: "'../../common/utils/sales-discount-filter.helper'",
      oldImport: "'../sales/helpers/sales-discount-filter.helper'",
    },
    {
      file: 'src/modules/delivery-reps/services/van-field-sales/list-driver-sales.ts',
      sharedImport: "'../../../../common/utils/sales-discount-filter.helper'",
      oldImport: "'../../../sales/helpers/sales-discount-filter.helper'",
    },
  ];
  for (const consumer of consumers) {
    const src = fs.readFileSync(path.join(BACKEND, consumer.file), 'utf8');
    assert.ok(src.includes(consumer.sharedImport), `${consumer.file} must import the predicate from shared`);
    assert.ok(!src.includes(consumer.oldImport), `${consumer.file} must no longer import the predicate from sales`);
  }

  // 7. The predicates compile to the identical SQL from the new home.
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const saleCompiled = db.selectFrom('sales').selectAll().where(shared.discountedSaleSql('sales')).compile();
  assert.equal(saleCompiled.sql, EXPECTED_SALE_SQL, 'discountedSaleSql must compile identically after the move');
  assert.deepEqual(saleCompiled.parameters, [], 'discountedSaleSql must take no parameters');
  const returnCompiled = db
    .selectFrom('return_documents')
    .selectAll()
    .where(shared.discountedReturnInvoiceSql('return_documents'))
    .compile();
  assert.equal(
    returnCompiled.sql,
    EXPECTED_RETURN_SQL,
    'discountedReturnInvoiceSql must compile identically after the move',
  );
  assert.deepEqual(returnCompiled.parameters, [], 'discountedReturnInvoiceSql must take no parameters');

  // 8. Wiring: both critical lists carry 375 specs in identical order,
  // the F5a spec last.
  const specsJson = JSON.parse(fs.readFileSync(path.join(BACKEND, 'scripts', 'critical-specs.json'), 'utf8'));
  const specs: string[] = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  const chain: string[] = (pkg.scripts['test:critical:serial'] as string)
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 401);
  assert.equal(chain.length, 401);
  assert.deepEqual(chain, specs, 'critical lists must agree in identical order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  assert.ok(specs.includes('test/critical/phase1-b1-reports-sales.spec.ts'));

  console.log('phase1 B1 reports|sales decoupling checks passed (375 specs wired, pair gone, SQL identical)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
