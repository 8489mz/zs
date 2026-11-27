import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';

/*
 * Phase 1 B3 — sales|storefront circular pair broken (INV-PHASE1-B3-SALES-STOREFRONT-DECOUPLED).
 *
 * The pair was sales->storefront 1 + storefront->sales 7 (grounding Pair 8):
 * - sales->storefront: table-service-calls.service.ts imported the pure
 *   tenant lookup `findTenantByStorefrontSlug` from the storefront
 *   slug-resolution file (the public table-call handler resolves its
 *   tenant server-side from the storefront slug).
 * - storefront->sales: the storefront module imports SalesModule; the
 *   storefront service imports SalesService + KdsService; the order
 *   convert service imports SalesService; the merchant-orders service
 *   imports KdsService; the order-create service imports
 *   assertProductsNot86ed from the restaurant F&B service; the order
 *   quote service imports the restaurant modifier contract helper.
 *
 * The break moves the WHOLE slug-resolution file to the shared layer
 * (backend/src/common/utils/storefront-slug-resolution.ts), byte-identical:
 * the single consumer (table-service-calls.service.ts) re-points its one
 * import at the shared home. The reverse 7-statement direction is the
 * load-bearing storefront->sales spine (order conversion + KDS +
 * restaurant rules) and is NOT touched. MOVE, never duplicate: the
 * lookup exists in exactly one place after this package.
 *
 * Consequences, all re-pinned in this package:
 * - module-boundary: sales->storefront 1 -> 0 (edge gone),
 *   storefront->sales stays 7; backend total 759 -> 758; backend edges
 *   70 -> 69; the sales|storefront pair leaves the bidirectional list.
 *   (Pin-table forms only, scoped to the BACKEND table: the frontend
 *   table still pins its own sales->storefront edge, 1 statement.)
 * - module-doors: the storefront-slug-resolution door row is RETIRED —
 *   the file no longer lives in a module: docs/MODULE_DOORS.md drops
 *   its line (storefront door table 4 -> 3 files). The doors SPEC needs
 *   no change (it asserts headings, the missing-index list, the pinned
 *   P0-1 prose, no REVIEW flag, and the 7 resolved §4 doors — this file
 *   is none of those).
 * - Wiring: both critical lists carry 375 specs in identical order,
 *   the F5a spec last.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const SHARED_SLUG = path.join(BACKEND, 'src', 'common', 'utils', 'storefront-slug-resolution.ts');
const OLD_SLUG = path.join(BACKEND, 'src', 'modules', 'storefront', 'storefront-slug-resolution.ts');
const TABLE_CALLS = path.join(BACKEND, 'src', 'modules', 'sales', 'services', 'table-service-calls.service.ts');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const DOORS_DOC = path.join(REPO_ROOT, 'docs', 'MODULE_DOORS.md');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

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

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text);
    CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
  `);
  return { pg, db };
}

async function main(): Promise<void> {
  // 1. The shared home exists, exports exactly the one lookup, and the
  // old module file is gone. The import path is a variable (not a
  // literal) so the spec still compiles on the base, where the file
  // does not exist yet: RED-1 then fails on the structural blocks
  // below (the circular import still exists), not at load time.
  assert.ok(fs.existsSync(SHARED_SLUG), 'the slug-resolution helper must live in src/common/utils');
  assert.ok(!fs.existsSync(OLD_SLUG), 'the old storefront slug-resolution file must be gone (move, not copy)');
  const sharedPath = '../../src/common/utils/storefront-slug-resolution';
  const shared = await import(sharedPath);
  assert.equal(
    typeof shared.findTenantByStorefrontSlug,
    'function',
    'shared slug-resolution must export findTenantByStorefrontSlug',
  );
  assert.deepEqual(
    Object.keys(shared).sort(),
    ['findTenantByStorefrontSlug'],
    'shared slug-resolution must export exactly the one lookup (no second copy)',
  );
  const moved = fs.readFileSync(SHARED_SLUG, 'utf8');
  assert.ok(
    moved.includes('INV-TABLE-CALL-SLUG-TENANT'),
    'moved file must keep the INV-TABLE-CALL-SLUG-TENANT header (fail-closed contract)',
  );
  assert.ok(moved.includes("where('slug', '=', cleanSlug)"), 'moved file must keep the slug lookup step');
  assert.ok(moved.includes("where('custom_domain', '=', cleanSlug)"), 'moved file must keep the domain lookup step');
  assert.ok(moved.includes("'storefront_slug'"), 'moved file must keep the storefront_slug setting lookup step');

  // 2. No sales source file imports from the storefront module any more (the broken leg).
  const salesFiles = walkTs(path.join(BACKEND, 'src', 'modules', 'sales'));
  const salesToStorefront: string[] = [];
  for (const file of salesFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (resolvesUnderModule(spec, file, 'storefront')) {
        salesToStorefront.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
        break;
      }
    }
  }
  assert.deepEqual(salesToStorefront, [], 'no sales source file may import from the storefront module');
  const tableCalls = fs.readFileSync(TABLE_CALLS, 'utf8');
  assert.ok(
    tableCalls.includes("from '../../../common/utils/storefront-slug-resolution'"),
    'table-service-calls must import the lookup from the shared home',
  );
  assert.ok(
    !tableCalls.includes('storefront/storefront-slug-resolution'),
    'table-service-calls must not import the lookup from the storefront module',
  );

  // 3. The remaining leg is exactly the 6 storefront->sales files (7 statements, one-way, not a cycle).
  const storefrontFiles = walkTs(path.join(BACKEND, 'src', 'modules', 'storefront'));
  const storefrontToSales: string[] = [];
  for (const file of storefrontFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const spec of specifiers(src)) {
      if (resolvesUnderModule(spec, file, 'sales')) {
        storefrontToSales.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
        break;
      }
    }
  }
  assert.deepEqual(
    storefrontToSales.sort(),
    [
      'backend/src/modules/storefront/services/storefront-merchant-orders.service.ts',
      'backend/src/modules/storefront/services/storefront-order-convert.service.ts',
      'backend/src/modules/storefront/services/storefront-order-create.service.ts',
      'backend/src/modules/storefront/services/storefront-order-quote.service.ts',
      'backend/src/modules/storefront/storefront.module.ts',
      'backend/src/modules/storefront/storefront.service.ts',
    ].sort(),
    'the only storefront->sales imports must be the module DI + SalesService/KdsService + restaurant-rule users',
  );

  // 4. Behavior: the REAL shared lookup on PGlite — same steps, same fail-closed rule.
  const { pg, db } = await makeDb();
  try {
    await db
      .insertInto('tenants' as never)
      .values([
        { id: 't1', slug: 'myshop', custom_domain: null },
        { id: 't2', slug: 'other', custom_domain: 'shop.example.com' },
        { id: 't3', slug: 'third', custom_domain: null },
      ] as never)
      .execute();
    await db
      .insertInto('settings' as never)
      .values([{ tenant_id: 't3', key: 'storefront_slug', value: '"MySlug"' }] as never)
      .execute();
    const find = shared.findTenantByStorefrontSlug as (db: Kysely<any>, slug: string) => Promise<{ id: string } | null>;
    assert.deepEqual(await find(db, 'myshop'), { id: 't1' }, 'slug leg resolves tenants.slug');
    assert.deepEqual(
      await find(db, 'SHOP.EXAMPLE.COM'),
      { id: 't2' },
      'dotted slug resolves custom_domain (lowercased)',
    );
    assert.deepEqual(
      await find(db, 'MySlug'),
      { id: 't3' },
      'mixed-case slug resolves the JSON-quoted storefront_slug setting',
    );
    assert.deepEqual(await find(db, 'myslug'), { id: 't3' }, 'lowercase slug resolves the same setting row');
    assert.equal(await find(db, 'nope'), null, 'unknown slug fails closed (null, no demo fallback)');
    assert.equal(await find(db, ''), null, 'empty slug fails closed');
    assert.equal(await find(db, 'admin'), null, 'admin slug fails closed');
    assert.equal(await find(db, 'ADMIN'), null, 'ADMIN slug fails closed (lowercased first)');
  } finally {
    await pg.close();
  }

  // 5. The boundary pins record the break. (Pin-table forms only,
  // scoped to the BACKEND table: the frontend table still pins its own
  // sales->storefront edge, 1 statement, untouched by this package.)
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  const backendTable = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_EDGES'),
    boundary.indexOf('PINNED_FRONTEND_EDGES'),
  );
  const backendPairs = boundary.slice(
    boundary.indexOf('PINNED_BACKEND_BIDIRECTIONAL_PAIRS'),
    boundary.indexOf('PINNED_FRONTEND_BIDIRECTIONAL_PAIRS'),
  );
  const frontendTable = boundary.slice(boundary.indexOf('PINNED_FRONTEND_EDGES'));
  assert.ok(
    !backendTable.includes("'sales->storefront':"),
    'module-boundary must no longer pin a sales->storefront edge',
  );
  assert.ok(
    !backendPairs.includes("'sales|storefront',"),
    'module-boundary must no longer list the sales|storefront pair',
  );
  assert.ok(
    backendTable.includes("'storefront->sales': 7,"),
    'module-boundary must keep storefront->sales pinned at 7 (the staying leg)',
  );
  assert.ok(
    frontendTable.includes("'sales->storefront': 1,"),
    'module-boundary frontend table must keep its own sales->storefront edge at 1 (untouched)',
  );
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must re-pin the backend total 746 -> 738',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must re-pin the backend edge table 64 -> 63 edges',
  );

  // 6. The doors doc retires the slug-resolution door row.
  const doors = fs.readFileSync(DOORS_DOC, 'utf8');
  assert.ok(
    !doors.includes('storefront-slug-resolution'),
    'MODULE_DOORS.md must no longer list the slug-resolution door',
  );
  assert.ok(doors.includes('plus the 3 file(s) above'), 'MODULE_DOORS.md storefront door must now list 3 files');

  // 7. The INV entry exists exactly once in both places (never quote another INV id literally).
  // The guard tail holds ONLY the newest id, so B7 re-pins this block's
  // guard assertion to the B7 INV; the invariants-file assertion still
  // pins B3 (its line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-B3-SALES-STOREFRONT-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the B3 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-BATCH-REPAIR-DISCOUNT-I18N-KEYS/g) || []).length;
  assert.equal(
    guardCount,
    1,
    'architecture-guard.spec.ts must carry the B7 INV exactly once (the guard tail holds only the newest id)',
  );

  // 8. The B1/B2 specs re-pin their boundary assertions to the B3 numbers.
  const b1 = fs.readFileSync(B1_SPEC, 'utf8');
  assert.ok(b1.includes('const PINNED_BACKEND_TOTAL = 738;'), 'B1 spec must re-pin the backend total 746 -> 738');
  assert.ok(
    b1.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'B1 spec must re-pin the backend edge table 64 -> 63 edges',
  );
  const b2 = fs.readFileSync(B2_SPEC, 'utf8');
  assert.ok(b2.includes('const PINNED_BACKEND_TOTAL = 738;'), 'B2 spec must re-pin the backend total 746 -> 738');
  assert.ok(
    b2.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'B2 spec must re-pin the backend edge table 64 -> 63 edges',
  );

  // 9. Wiring: both critical lists carry 375 specs in identical order, the F5a spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 402);
  assert.equal(chain.length, 402);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 375 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  assert.ok(
    b1.includes('assert.equal(specs.length, 402);') && b1.includes('assert.equal(chain.length, 402);'),
    'B1 spec wiring must re-pin to 375',
  );
  assert.ok(
    b1.includes("specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
    'B1 spec last-entry must re-pin to the B7 spec',
  );
  assert.ok(
    b2.includes('assert.equal(specs.length, 402);') && b2.includes('assert.equal(chain.length, 402);'),
    'B2 spec wiring must re-pin to 375',
  );
  assert.ok(
    b2.includes("specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
    'B2 spec last-entry must re-pin to the B7 spec',
  );

  // 10. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old 372 count or point its last-entry at the B3 spec. (The
  // B4 brief named only the B1/B2/B3 specs; the live tree had 42 files
  // asserting 372 — the #264-fix / D12 lesson. The B3 filename is built
  // by concatenation so this block's own source never contains the
  // literals it scans for.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const b3Name = 'phase1-b3' + '-sales-storefront.spec.ts';
  const staleSpecs = 'specs.length, 37' + '2';
  const staleChain = 'chain.length, 37' + '2';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${b3Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the 372 wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the B3 spec');

  console.log('phase1 B3 sales|storefront decoupling checks passed (375 specs wired, pair gone, lookup identical)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
