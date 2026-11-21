/*
 * INV-MODULE-BOUNDARY-BASELINE: module-boundary ratchet spec.
 *
 * This spec pins the cross-module / cross-feature coupling measured at
 * HEAD fc3334c46 (file #20 repair) and fails on any NEW coupling of the same
 * kind. It is a ratchet, not a zero-tolerance gate: existing edges may
 * shrink (a smaller count still passes), but no new edge may appear
 * and no existing edge may grow.
 *
 * Method (identical to the grounding scan that produced the pin):
 * every static import statement in a non-spec source file counts once
 * (`from '...'` including re-exports, side-effect `import '...'`,
 * and dynamic `import('...')`); comments are stripped first with a
 * string-aware state machine. Backend edges resolve relative imports
 * and the `src/modules/` alias to their owning module; frontend edges
 * resolve relative imports and the `@/features/` / `src/features/`
 * aliases to their owning feature. `src/common`, `src/shared` and
 * intra-module imports are not edges.
 *
 * Pinned baseline (fc3334c46): backend 71 edges / 652 statements
 * (re-pinned from 650 by the van-transfer-loaded-amount-3dp
 * package: two new delivery-reps->accounting statements — the
 * tenant base-currency lookup and the roundMoney import the
 * inter-van transfer accept path resolves on; the 650 pin itself
 * came from the residual-rounding-deposits package, one new
 * import-sales->accounting statement), frontend 57 edges / 135
 * statements, 7 backend + 12 frontend bidirectional pairs, 80
 * external imports into `accounting-posting.service` and 15 into
 * `accounting-tenant-foundation.service` (callers outside accounting).
 * Pos->storefront re-pin 10 -> 12 and posting external 79 -> 80:
 * the PosTablesGrid + PosFloorStatsBar slice splits each restate the
 * facade's `OnlineOrderRecord` type import from storefront (+2), and
 * file #32's S7 manager-comp slice restates the facade's
 * `AccountingPostingService` import for its ctor (+1). Pure-move
 * duplication, no new coupling: no new edge, no new pair, every
 * added statement is an import the pre-split facade already had.
 * File #32 (restaurant-advanced-fnb split) re-pins sales->accounting
 * 52 -> 58: the split moves the facade's accounting imports into the
 * slices that use them (tips-create 3, prep 1, stamps-costing 2,
 * manager-comp 2 engine statements + the AccountingPostingService
 * type for its ctor = 9 statements where the facade had 4 — 3 engine
 * imports + the posting-service import, which stays on the facade),
 * so the same imports are now stated once per slice instead of once
 * for the whole file. Pure-move consequence, no new coupling: every
 * added statement is an import the pre-split facade already had.
 * Backend total re-pinned 652 -> 658 in the same repair (the spec
 * reports exactly 658: pristine total was exactly 652, +6 = the
 * edge delta, no other growth).
 *
 * File #69 (rep-target.engine.ts split, 1,020L -> barrel 72L + 7 slices):
 * delivery-reps->accounting 101 -> 103: the engine's single money-engine
 * import is now stated once per money slice (S-target, S-commission,
 * S-balances) instead of once for the whole file. Backend total 732 -> 734
 * (= the edge delta, no other growth); posting 94 / foundation 18 unchanged.
 * Pure-move consequence, no new coupling: every added statement is an import
 * the pre-split engine already had.
 *
 * Floors: the scan must still find >= 600 backend / >= 100 frontend
 * statements and >= 60 / >= 45 edges. A floor exists so a broken
 * scanner fails loudly instead of passing vacuously; a phase that
 * legitimately shrinks below a floor re-pins the table AND the floors
 * in that same package, deliberately.
 *
 * Fail-first: the matcher self-checks below were proven against a
 * synthetic violating sample (a sales file importing from inventory
 * resolves to an `inventory` edge) and clean samples. The ratchet
 * itself was proven by adding one temporary cross-module import
 * (a new `sales -> inventory` edge, which is 0 today) and watching
 * this spec fail, then removing it and watching it go green again.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_MODULES = path.join(REPO_ROOT, 'backend', 'src', 'modules');
const FRONTEND_FEATURES = path.join(REPO_ROOT, 'frontend', 'src', 'features');

const PINNED_BACKEND_EDGES: Record<string, number> = {
  'accounting->hr': 2,
  'accounting->manufacturing': 2,
  'accounting->purchases': 2,
  'ai-copilot->storefront': 1,
  'approvals->settings': 2,
  'cash-drawer->accounting': 12,
  'cash-drawer->settings': 3,
  'catalog->accounting': 15,
  'catalog->inventory': 7,
  'catalog->storefront': 9,
  'contracting->accounting': 21,
  'delivery-reps->accounting': 103,
  'delivery-reps->cash-drawer': 6,
  'delivery-reps->reports': 1,
  'delivery-reps->sales': 11,
  'delivery-reps->settings': 2,
  'hr->accounting': 29,
  'hr->cash-drawer': 4,
  'import-sales->accounting': 58,
  'import-sales->delivery-reps': 1,
  'import-sales->purchases': 1,
  'inventory->accounting': 15,
  'inventory->import-sales': 3,
  'maintenance->accounting': 26,
  'manufacturing->accounting': 6,
  'manufacturing->inventory': 1,
  'maritime-freight->accounting': 52,
  'maritime-freight->sales': 3,
  'maritime-freight->settings': 5,
  'partners->accounting': 11,
  'partners->delivery-reps': 2,
  'pharmacy->accounting': 11,
  'pharmacy->purchases': 2,
  'public->saas-admin': 4,
  'public->tenant-subscription': 2,
  'purchases->accounting': 70,
  'purchases->approvals': 2,
  'purchases->catalog': 1,
  'purchases->delivery-reps': 1,
  'purchases->inventory': 1,
  'purchases->settings': 2,
  'reports->accounting': 18,
  'returns->accounting': 26,
  'returns->import-sales': 1,
  'returns->sales': 5,
  'returns->settings': 3,
  'saas-admin->settings': 3,
  'saas-admin->storefront': 2,
  'sales->accounting': 67,
  'sales->cash-drawer': 5,
  'sales->delivery-reps': 5,
  'sales->import-sales': 4,
  'sales->manufacturing': 1,
  'sales->reports': 1,
  'sales->returns': 4,
  'sales->settings': 4,
  'sales->storefront': 1,
  'sales->tax-integration': 3,
  'services->accounting': 4,
  'sessions->activation': 2,
  'settings->accounting': 9,
  'settings->ai-copilot': 2,
  'settings->catalog': 1,
  'settings->sales': 1,
  'storefront->accounting': 23,
  'storefront->sales': 7,
  'storefront->settings': 8,
  'tax-integration->accounting': 5,
  'tenant-subscription->storefront': 2,
  'tradein->accounting': 5,
  'treasury->accounting': 5,
};

const PINNED_FRONTEND_EDGES: Record<string, number> = {
  'accounting->treasury': 2,
  'accounts->customers': 2,
  'accounts->maritime-freight': 1,
  'accounts->purchases': 1,
  'accounts->sales': 1,
  'activation->dashboard': 1,
  'activation->pos': 1,
  'activation->settings': 8,
  'apps-store->settings': 5,
  'audit->settings': 1,
  'cash-drawer->accounting': 1,
  'cash-drawer->pos': 2,
  'contracting->settings': 1,
  'customers->sales': 2,
  'delivery-reps->customers': 1,
  'delivery-reps->products': 1,
  'delivery-reps->sales': 2,
  'delivery-reps->settings': 1,
  'import-sales->accounting': 4,
  'inventory->pharmacy': 2,
  'inventory->products': 6,
  'maintenance->products': 1,
  'manufacturing->products': 2,
  'maritime-freight->customers': 1,
  'maritime-freight->settings': 1,
  'pos->cash-drawer': 1,
  'pos->products': 5,
  'pos->sales': 3,
  'pos->settings': 3,
  'pos->storefront': 12,
  'products->inventory': 2,
  'products->maintenance': 2,
  'products->pos': 5,
  'products->settings': 1,
  'products->tradein': 1,
  'purchases->accounts': 1,
  'purchases->products': 3,
  'reports->audit': 1,
  'reports->purchases': 1,
  'reports->sales': 2,
  'saas-admin->settings': 1,
  'sales->customers': 2,
  'sales->manufacturing': 1,
  'sales->pos': 3,
  'sales->storefront': 1,
  'settings->audit': 1,
  'settings->hr': 1,
  'settings->maintenance': 1,
  'settings->pos': 3,
  'settings->products': 1,
  'settings->storefront': 13,
  'storefront->pos': 5,
  'suppliers->accounting': 2,
  'suppliers->accounts': 2,
  'tradein->maintenance': 2,
  'treasury->accounting': 1,
  'updates->settings': 1,
};

const PINNED_BACKEND_BIDIRECTIONAL_PAIRS: string[] = ['accounting|hr', 'accounting|manufacturing', 'accounting|purchases', 'delivery-reps|sales', 'returns|sales', 'sales|settings', 'sales|storefront'];
const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = ['accounting|treasury', 'accounts|purchases', 'audit|settings', 'cash-drawer|pos', 'customers|sales', 'inventory|products', 'maintenance|products', 'pos|products', 'pos|sales', 'pos|settings', 'pos|storefront', 'products|settings'];
const PINNED_POSTING_EXTERNAL = 94;
const PINNED_FOUNDATION_EXTERNAL = 18;
const PINNED_BACKEND_TOTAL = 734;
const PINNED_FRONTEND_TOTAL = 135;
const BACKEND_TOTAL_FLOOR = 600;
const FRONTEND_TOTAL_FLOOR = 100;
const BACKEND_EDGE_FLOOR = 60;
const FRONTEND_EDGE_FLOOR = 45;

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
  const sideRe = /^\s*import\s+['"]([^'"]+)['"]/gm;
  const dynRe = /import\(\s*['"]([^'"]+)['"]\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(clean)) !== null) found.push(m[1]);
  while ((m = sideRe.exec(clean)) !== null) found.push(m[1]);
  while ((m = dynRe.exec(clean)) !== null) found.push(m[1]);
  return found;
}

function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkFiles(full, exts, out);
    } else if (
      entry.isFile() &&
      exts.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.spec.tsx') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripExt(p: string): string {
  return p.replace(/\.(ts|tsx|js|jsx)$/, '');
}

function resolveBackendModule(spec: string, srcRelPosix: string): string | null {
  let target: string | null = null;
  if (spec.startsWith('.')) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(srcRelPosix), spec));
  } else if (spec.startsWith('src/modules/')) {
    target = path.posix.normalize('backend/' + spec);
  }
  if (target === null) return null;
  const m = target.match(/^backend\/src\/modules\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

function resolveBackendFile(spec: string, srcRelPosix: string): string | null {
  if (spec.startsWith('.')) {
    return stripExt(path.posix.normalize(path.posix.join(path.posix.dirname(srcRelPosix), spec)));
  }
  if (spec.startsWith('src/')) {
    return stripExt(path.posix.normalize('backend/' + spec));
  }
  return null;
}

function resolveFrontendFeature(spec: string, srcRelPosix: string): string | null {
  let target: string | null = null;
  if (spec.startsWith('.')) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(srcRelPosix), spec));
  } else if (spec.startsWith('@/features/')) {
    target = path.posix.normalize('frontend/src/' + spec.slice(2));
  } else if (spec.startsWith('src/features/')) {
    target = path.posix.normalize('frontend/' + spec);
  }
  if (target === null) return null;
  const m = target.match(/^frontend\/src\/features\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

interface ScanResult {
  edges: Map<string, number>;
  total: number;
  postingExternal: number;
  foundationExternal: number;
}

function scanBackend(): ScanResult {
  const edges = new Map<string, number>();
  let total = 0;
  let postingExternal = 0;
  let foundationExternal = 0;
  for (const mod of fs.readdirSync(BACKEND_MODULES)) {
    const modDir = path.join(BACKEND_MODULES, mod);
    if (!fs.statSync(modDir).isDirectory()) continue;
    for (const file of walkFiles(modDir, ['.ts'])) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      for (const spec of specifiers(src)) {
        const target = resolveBackendModule(spec, rel);
        if (target !== null && target !== mod) {
          const key = `${mod}->${target}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
          total += 1;
        }
        const targetFile = resolveBackendFile(spec, rel);
        if (mod !== 'accounting' && targetFile === 'backend/src/modules/accounting/accounting-posting.service') {
          postingExternal += 1;
        }
        if (mod !== 'accounting' && targetFile === 'backend/src/modules/accounting/accounting-tenant-foundation.service') {
          foundationExternal += 1;
        }
      }
    }
  }
  return { edges, total, postingExternal, foundationExternal };
}

function scanFrontend(): ScanResult {
  const edges = new Map<string, number>();
  let total = 0;
  for (const feat of fs.readdirSync(FRONTEND_FEATURES)) {
    const featDir = path.join(FRONTEND_FEATURES, feat);
    if (!fs.statSync(featDir).isDirectory()) continue;
    for (const file of walkFiles(featDir, ['.ts', '.tsx'])) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      const src = fs.readFileSync(file, 'utf8');
      for (const spec of specifiers(src)) {
        const target = resolveFrontendFeature(spec, rel);
        if (target !== null && target !== feat) {
          const key = `${feat}->${target}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
          total += 1;
        }
      }
    }
  }
  return { edges, total, postingExternal: 0, foundationExternal: 0 };
}

function bidirectionalPairs(edges: Map<string, number>): string[] {
  const pairs: string[] = [];
  for (const key of edges.keys()) {
    const [a, b] = key.split('->');
    if (a < b && edges.has(`${b}->${a}`)) pairs.push(`${a}|${b}`);
  }
  return pairs.sort();
}

async function main(): Promise<void> {
  // 0. Matcher self-checks (fail-first: the parser must resolve the
  //    forms the repo actually uses, and must not count commented-out
  //    imports).
  const commented = stripComments(
    "import { a } from './real';\n// import { b } from '../inventory/x';\n/* import { c } from '../sales/y'; */\n",
  );
  assert.deepEqual(specifiers(commented), ['./real'], 'commented-out imports must not count');
  assert.equal(
    resolveBackendModule('../inventory/inventory.service', 'backend/src/modules/sales/foo.service.ts'),
    'inventory',
    'a sales file importing ../inventory must resolve to the inventory edge',
  );
  assert.equal(
    resolveBackendModule('../sales/bar', 'backend/src/modules/sales/foo.service.ts'),
    'sales',
    'same-module relative imports are not edges',
  );
  assert.equal(
    resolveBackendModule('src/modules/accounting/accounting-currency', 'backend/src/modules/sales/foo.service.ts'),
    'accounting',
    'the src/modules/ alias must resolve',
  );
  assert.equal(
    resolveFrontendFeature('@/features/pos/x', 'frontend/src/features/sales/foo.ts'),
    'pos',
    'the @/features/ alias must resolve',
  );
  assert.equal(
    resolveBackendFile('../accounting/accounting-posting.service', 'backend/src/modules/sales/foo.service.ts'),
    'backend/src/modules/accounting/accounting-posting.service',
    'deep posting-service imports must resolve to the exact file',
  );

  // 1. Backend ratchet: no new edge, no edge may grow, totals pinned.
  assert.equal(Object.keys(PINNED_BACKEND_EDGES).length, 71, 'pinned backend edge table must list 71 edges');
  const backend = scanBackend();
  assert.ok(backend.total >= BACKEND_TOTAL_FLOOR, `backend scan found only ${backend.total} statements (floor ${BACKEND_TOTAL_FLOOR}): the scanner is broken or the baseline needs re-pinning`);
  assert.ok(backend.edges.size >= BACKEND_EDGE_FLOOR, `backend scan found only ${backend.edges.size} edges (floor ${BACKEND_EDGE_FLOOR})`);
  for (const [key, count] of backend.edges) {
    assert.ok(key in PINNED_BACKEND_EDGES, `new backend edge ${key} (${count} statements): add it to the pinned table deliberately or route it through a public door`);
    assert.ok(
      count <= PINNED_BACKEND_EDGES[key],
      `backend edge ${key} grew to ${count} statements (pinned ${PINNED_BACKEND_EDGES[key]})`,
    );
  }
  assert.ok(backend.total <= PINNED_BACKEND_TOTAL, `backend cross-module statements grew to ${backend.total} (pinned ${PINNED_BACKEND_TOTAL}): shrink the coupling or re-pin deliberately`);

  // 2. Frontend ratchet: same rules.
  assert.equal(Object.keys(PINNED_FRONTEND_EDGES).length, 57, 'pinned frontend edge table must list 57 edges');
  const frontend = scanFrontend();
  assert.ok(frontend.total >= FRONTEND_TOTAL_FLOOR, `frontend scan found only ${frontend.total} statements (floor ${FRONTEND_TOTAL_FLOOR})`);
  assert.ok(frontend.edges.size >= FRONTEND_EDGE_FLOOR, `frontend scan found only ${frontend.edges.size} edges (floor ${FRONTEND_EDGE_FLOOR})`);
  for (const [key, count] of frontend.edges) {
    assert.ok(key in PINNED_FRONTEND_EDGES, `new frontend edge ${key} (${count} statements): add it to the pinned table deliberately or route it through the feature index.ts`);
    assert.ok(
      count <= PINNED_FRONTEND_EDGES[key],
      `frontend edge ${key} grew to ${count} statements (pinned ${PINNED_FRONTEND_EDGES[key]})`,
    );
  }
  assert.ok(frontend.total <= PINNED_FRONTEND_TOTAL, `frontend cross-feature statements grew to ${frontend.total} (pinned ${PINNED_FRONTEND_TOTAL})`);

  // 3. Deep-import caps on the two accounting facade files.
  assert.ok(
    backend.postingExternal <= PINNED_POSTING_EXTERNAL,
    `external imports into accounting-posting.service grew to ${backend.postingExternal} (pinned ${PINNED_POSTING_EXTERNAL})`,
  );
  assert.ok(
    backend.foundationExternal <= PINNED_FOUNDATION_EXTERNAL,
    `external imports into accounting-tenant-foundation.service grew to ${backend.foundationExternal} (pinned ${PINNED_FOUNDATION_EXTERNAL})`,
  );

  // 4. No new bidirectional pairs (a pair means two modules depend on
  //    each other, so a change in either can break the other).
  assert.deepEqual(
    bidirectionalPairs(backend.edges),
    [...PINNED_BACKEND_BIDIRECTIONAL_PAIRS].sort(),
    'backend bidirectional pairs changed: a new pair appeared or a pinned pair vanished',
  );
  assert.deepEqual(
    bidirectionalPairs(frontend.edges),
    [...PINNED_FRONTEND_BIDIRECTIONAL_PAIRS].sort(),
    'frontend bidirectional pairs changed: a new pair appeared or a pinned pair vanished',
  );

  console.log(
    `module boundary checks passed (backend ${backend.edges.size} edges / ${backend.total} statements, ` +
      `frontend ${frontend.edges.size} edges / ${frontend.total} statements, ` +
      `posting ${backend.postingExternal} / foundation ${backend.foundationExternal} external imports)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
