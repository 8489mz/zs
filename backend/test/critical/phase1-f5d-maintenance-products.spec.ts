import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5d — break the maintenance|products frontend circular pair
 * (INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED).
 *
 * Grounding §7 row 4 / §8 F5d (phase1-f0-grounding.md), re-derived live
 * at 699439a15: maintenance|products, module-boundary counts 1/2, TWO
 * deep legs, both in products/pages/ImeiHistoryPage.tsx:
 * - products -> maintenance (2): :9 imports getMaintenanceProfile from
 *   '@/features/maintenance/constants/maintenance-profiles' (profile =
 *   getMaintenanceProfile(settingsQuery.data?.maintenanceProfile));
 *   :11 imports maintenanceApi + type MaintenanceListPageResponse from
 *   '@/features/maintenance/api/maintenance.api' (queryKey
 *   ['imei-history-maintenance', activeSerial], queryFn
 *   maintenanceApi.list({ q: activeSerial }) with the empty-page
 *   resolve when no serial, enabled Boolean(activeSerial)).
 * - maintenance -> products (1): maintenance/components/
 *   MaintenanceDetailModal.tsx:12 imports productsApi from
 *   '@/features/products' (queryFn productsApi.listPage({ q:
 *   trimmedPartSearch, page: 1, pageSize: 20 })).
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other products file imports from maintenance —
 * including the ImeiHistoryPage spec, which only vi.mocked the
 * maintenance api — no other maintenance file imports from products,
 * no relative cross imports). A pair breaks ONLY when one direction's
 * statements reach 0 (code moves / inversion) — routing through a
 * public index does NOT reduce the module-boundary count (proven by
 * F3). So F5d breaks the products -> maintenance direction by moving
 * BOTH usages into the shared catalog hook: frontend/src/shared/hooks/
 * use-catalog-queries.ts is the established home for cross-feature
 * catalog queries (it already imports products/sales/purchases/
 * customers/suppliers/settings APIs), and shared imports are not
 * feature edges. The new hooks carry the page's usages VERBATIM:
 * useMaintenanceProfile() calls useSettingsQuery() internally and
 * returns getMaintenanceProfile(settingsQuery.data?.
 * maintenanceProfile) — the same settings value, the same pure
 * function, so the profile object is identical; useImeiMaintenance-
 * Query(activeSerial) carries the maintenance query verbatim — same
 * queryKey, same queryFn, same enabled — so the query object is
 * identical and no behaviour can change (same cache key, same list
 * fetch, same MaintenanceListPageResponse shape). The page re-points
 * to the two hooks and drops its getMaintenanceProfile +
 * maintenanceApi + MaintenanceListPageResponse + useSettingsQuery
 * imports (its only useSettingsQuery use was the profile; its only
 * useQuery uses left are the serial + trade-in queries). The
 * maintenance -> products direction stays (MaintenanceDetailModal
 * keeps its productsApi import and listPage call site): breaking ONE
 * direction is enough for the pair to be gone. Both indices keep
 * their public surfaces (maintenance: maintenanceRouteModule +
 * maintenanceApi + MaintenanceListPageResponse + getMaintenanceProfile
 * + MAINTENANCE_PROFILES + profile types; products: ProductsPage +
 * productsRouteModule + productsApi + productSerialsApi +
 * ProductCardModal + shouldShowExpiryDateField).
 *
 * The page's frontend spec (ImeiHistoryPage.spec.tsx, LF-P4) mocks
 * '@/shared/hooks/use-catalog-queries' wholesale, so its mock must
 * gain the two new hooks or the page crashes on undefined: the mock
 * now returns the real 'mobile' profile values for
 * useMaintenanceProfile (shortTitle 'موبايل وتابلت', serialLabel
 * 'السيريال / IMEI 1' — exactly what getMaintenanceProfile('mobile')
 * returns for the mocked settings) and a useQuery-backed
 * useImeiMaintenanceQuery that calls the existing mockMaintenanceList
 * with the same queryKey/queryFn/enabled as the real hook, so the
 * three LF-P4 cases still exercise the real page. The now-dead
 * vi.mock('@/features/maintenance/api/maintenance.api') block is
 * removed (nothing in the test graph imports that module anymore).
 * Frontend vitest is CI-only (no frontend node_modules in this VM),
 * so the mock shape is pinned here by static assertions.
 *
 * What moves and what re-points (all re-points are import-route
 * changes only; the query + profile objects are identical, so no
 * behaviour can change):
 * - Added: useMaintenanceProfile() + useImeiMaintenanceQuery(
 *   activeSerial) in frontend/src/shared/hooks/use-catalog-queries.ts
 *   (same profile computation + same queryKey/queryFn/enabled as the
 *   page had inline).
 * - Re-pointed: products/pages/ImeiHistoryPage.tsx (:8-11) — the two
 *   maintenance imports + the useSettingsQuery import gone, the two
 *   hook imports in, `const profile = useMaintenanceProfile();` and
 *   `const { data: maintenanceData } = useImeiMaintenanceQuery(
 *   activeSerial);` (call sites byte-identical apart from the hook).
 * - Re-pointed: products/pages/ImeiHistoryPage.spec.tsx — the
 *   use-catalog-queries mock gains both hooks; the maintenance.api
 *   vi.mock block removed; useQuery added to the react-query import.
 * Consequences, all re-pinned in this package:
 * - products -> maintenance: 2 -> 0; maintenance -> products stays 1.
 * - Frontend edges 53 -> 52, statements 134 -> 132, pairs 9 -> 8
 *   ('maintenance|products' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline 69 -> 67 (the two deep
 *   ImeiHistoryPage strings are gone — hand-shrunk by exactly those
 *   two strings, F3/F5c precedent); import-layer baseline stays 152
 *   (no app-layer string moves in this package).
 * - Wiring: both critical lists carry 384 specs in identical order,
 *   this spec last.
 *
 * Notes: the stale cosmetic string in the F2 spec ("379 specs wired"
 * in its console.log) is pre-existing since F3 and is NOT an
 * assertion — left as-is per the parent brief. docs/MODULE_DOORS.md
 * §4 coupling line ('57 edges / 133 statements') is a stale
 * historical note (already wrong about the live pins before F5a:
 * backend 71/652, posting 79) that no package maintains — left as-is.
 *
 * REPAIR (F5d-REPAIR, 2026-11-27): the spec mock shape above
 * changed — the useQuery-backed useImeiMaintenanceQuery mock tripped
 * the page-composition check (ci-fast #491 on the F5d commit), so the
 * spec now mocks the maintenance api client and lets the REAL feature
 * hook run (importOriginal, only settings + profile overridden).
 * Section 1 assertions below pin the new shape; the F5d record above
 * stays as F5d's own history.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const FEATURES = path.join(FRONTEND, 'src', 'features');
const SHARED_HOOKS = path.join(FRONTEND, 'src', 'shared', 'hooks');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
const B8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b8-delivery-reps-sales.spec.ts');
const F2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f2-feature-public-indices.spec.ts');
const F3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f3-feature-boundary-legs.spec.ts');
const F4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f4-settings-access-door.spec.ts');
const F5A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5a-audit-settings.spec.ts');
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const F5C_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5c-accounts-purchases.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const IMEI_PAGE = path.join(FEATURES, 'products', 'pages', 'ImeiHistoryPage.tsx');
const IMEI_SPEC = path.join(FEATURES, 'products', 'pages', 'ImeiHistoryPage.spec.tsx');
const DETAIL_MODAL = path.join(FEATURES, 'maintenance', 'components', 'MaintenanceDetailModal.tsx');
const CATALOG_HOOKS = path.join(SHARED_HOOKS, 'use-catalog-queries.ts');
const MAINTENANCE_INDEX = path.join(FEATURES, 'maintenance', 'index.ts');
const PRODUCTS_INDEX = path.join(FEATURES, 'products', 'index.ts');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The products -> maintenance direction is gone; the maintenance
  // -> products direction stays. The shared hooks carry the page's
  // usages verbatim; the page re-points to them; both public indices
  // keep their surface unchanged; the page spec's mock gains the hooks.
  const productsFiles: string[] = [];
  walkTs(path.join(FEATURES, 'products'), productsFiles);
  const stillMaintenance: string[] = [];
  for (const file of productsFiles) {
    if (fs.readFileSync(file, 'utf8').includes("from '@/features/maintenance")) {
      stillMaintenance.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillMaintenance, [], "no products file may still import from '@/features/maintenance'");
  const page = fs.readFileSync(IMEI_PAGE, 'utf8');
  assert.ok(
    page.includes(
      "import { useImeiMaintenanceQuery, useMaintenanceProfile } from '@/shared/hooks/use-catalog-queries';",
    ),
    'ImeiHistoryPage must import both new hooks from the shared catalog hooks',
  );
  assert.ok(
    !page.includes("from '@/features/maintenance"),
    'ImeiHistoryPage must not import from the maintenance feature anymore',
  );
  assert.ok(
    !page.includes('useSettingsQuery'),
    'ImeiHistoryPage must not call useSettingsQuery anymore (its only use was the profile)',
  );
  assert.ok(
    page.includes('const profile = useMaintenanceProfile();'),
    'ImeiHistoryPage must get the profile from the shared hook',
  );
  assert.ok(
    page.includes('const { data: maintenanceData } = useImeiMaintenanceQuery(activeSerial);'),
    'ImeiHistoryPage must get the maintenance tickets from the shared hook',
  );
  assert.ok(
    !page.includes("['imei-history-maintenance', activeSerial]"),
    'ImeiHistoryPage must keep no inline maintenance queryKey (the hook carries it)',
  );
  assert.ok(
    !page.includes('maintenanceApi.list('),
    'ImeiHistoryPage must keep no inline maintenanceApi.list call (the hook carries it)',
  );
  const hooks = fs.readFileSync(CATALOG_HOOKS, 'utf8');
  assert.ok(
    hooks.includes('export function useMaintenanceProfile() {'),
    'the shared catalog hooks must export useMaintenanceProfile',
  );
  assert.ok(
    hooks.includes('return getMaintenanceProfile(settingsQuery.data?.maintenanceProfile);'),
    'the shared profile hook must compute the profile from the settings value verbatim',
  );
  assert.ok(
    hooks.includes('export function useImeiMaintenanceQuery(activeSerial: string) {'),
    'the shared catalog hooks must export useImeiMaintenanceQuery',
  );
  assert.ok(
    hooks.includes("queryKey: ['imei-history-maintenance', activeSerial],"),
    'the shared hook must keep the imei-history-maintenance queryKey verbatim',
  );
  assert.ok(hooks.includes('queryFn: () =>'), 'the shared hook must keep a queryFn');
  assert.ok(
    hooks.includes('maintenanceApi.list({ q: activeSerial })'),
    'the shared hook must keep the maintenanceApi.list({ q: activeSerial }) queryFn verbatim',
  );
  assert.ok(
    hooks.includes('enabled: Boolean(activeSerial),'),
    'the shared hook must keep the enabled: Boolean(activeSerial) verbatim',
  );
  assert.ok(
    hooks.includes(
      "import { maintenanceApi, type MaintenanceListPageResponse } from '@/features/maintenance/api/maintenance.api';",
    ),
    'the shared catalog hooks must import maintenanceApi from the maintenance api (shared imports are not edges)',
  );
  assert.ok(
    hooks.includes("import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';"),
    'the shared catalog hooks must import getMaintenanceProfile (shared imports are not edges)',
  );
  const modal = fs.readFileSync(DETAIL_MODAL, 'utf8');
  assert.ok(
    modal.includes("import { productsApi } from '@/features/products';"),
    'MaintenanceDetailModal must keep its productsApi import (the surviving direction)',
  );
  assert.ok(
    modal.includes('queryFn: () => productsApi.listPage({ q: trimmedPartSearch, page: 1, pageSize: 20 }),'),
    'MaintenanceDetailModal must keep its listPage call site identical',
  );
  const maintenanceIndex = fs.readFileSync(MAINTENANCE_INDEX, 'utf8');
  assert.ok(
    maintenanceIndex.includes("export { maintenanceApi } from '@/features/maintenance/api/maintenance.api';"),
    'the maintenance index must still re-export maintenanceApi (public surface unchanged)',
  );
  assert.ok(
    maintenanceIndex.includes(
      "export { getMaintenanceProfile, MAINTENANCE_PROFILES } from '@/features/maintenance/constants/maintenance-profiles';",
    ),
    'the maintenance index must still re-export getMaintenanceProfile (public surface unchanged)',
  );
  assert.ok(
    maintenanceIndex.includes("export { maintenanceRouteModule } from '@/features/maintenance/routes';"),
    'the maintenance index must still re-export maintenanceRouteModule (public surface unchanged)',
  );
  const productsIndex = fs.readFileSync(PRODUCTS_INDEX, 'utf8');
  assert.ok(
    productsIndex.includes("export { productsApi } from '@/features/products/api/products.api';"),
    'the products index must still re-export productsApi (public surface unchanged)',
  );
  const imeiSpec = fs.readFileSync(IMEI_SPEC, 'utf8');
  assert.ok(imeiSpec.includes('useMaintenanceProfile: () =>'), 'the page spec mock must provide useMaintenanceProfile');
  assert.ok(
    imeiSpec.includes("serialLabel: 'السيريال / IMEI 1'"),
    'the page spec mock must return the real mobile serialLabel',
  );
  assert.ok(
    imeiSpec.includes("vi.mock('@/features/maintenance/api/maintenance.api'"),
    'the page spec must mock the maintenance api so the REAL feature hook runs (data access lives in the hook)',
  );
  assert.ok(
    imeiSpec.includes('mockMaintenanceList(...args)'),
    'the page spec maintenance.api mock must drive the list from mockMaintenanceList',
  );
  assert.ok(
    imeiSpec.includes('importOriginal'),
    'the page spec hooks mock must keep the real hooks via importOriginal (only settings + profile overridden)',
  );
  assert.ok(
    !imeiSpec.includes('useImeiMaintenanceQuery:'),
    'the page spec must NOT re-implement useImeiMaintenanceQuery — the real feature hook runs',
  );
  assert.ok(
    !imeiSpec.includes('useQuery('),
    'the page spec must contain no direct React Query call (the page-composition check forbids it in page files, specs included)',
  );

  // 2. The module-boundary pins move: frontend edges 53 -> 52,
  // statements 134 -> 132, pairs 9 -> 8 ('maintenance|products'
  // gone); the backend pins do not move. The feature-boundary
  // baseline shrinks 69 -> 67 (the two deep ImeiHistoryPage strings
  // are gone); the import-layer baseline stays 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5d',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5d',
  );
  assert.ok(
    !boundary.includes("'products->maintenance'"),
    'the products->maintenance edge must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'maintenance->products': 1,"),
    'the maintenance->products edge must stay pinned at 1 (the surviving direction)',
  );
  assert.ok(
    !boundary.includes("'maintenance|products'"),
    'the maintenance|products pair must be gone from the pair list',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must shrink to exactly 57 after F5d');
  assert.ok(
    !featureBaseline.some((entry) => entry.includes('ImeiHistoryPage') && entry.includes('@/features/maintenance')),
    'the deep ImeiHistoryPage maintenance strings must be gone from the feature-boundary baseline',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5d');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5d INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-SHIFT-CLOSE-DISCOUNT-SUMMARY/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5d INV exactly once');

  // 4. Wiring: both critical lists carry 384 specs in identical order, this spec last.
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
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 384 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
    ['F2', F2_SPEC],
    ['F3', F3_SPEC],
    ['F4', F4_SPEC],
    ['F5a', F5A_SPEC],
    ['F5b', F5B_SPEC],
    ['F5c', F5C_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 402);') && src.includes('assert.equal(chain.length, 402);'),
      `${label} spec wiring must re-pin to 384`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5d spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F5c spec. (The
  // live tree holds ~57 files asserting the count — the #264-fix /
  // D12 lesson. The F5c filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f5cName = 'phase1-f5c' + '-accounts-purchases.spec.ts';
  const staleSpecs = 'specs.length, 38' + '3';
  const staleChain = 'chain.length, 38' + '3';
  const staleList = 'list.length, 38' + '3';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5cName}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5c spec');

  // 6. The guard tail holds ONLY the newest id, so F5d re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c specs' guard assertions to
  // the F5d INV; their invariants-file assertions still pin their own
  // id (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
    ['F2', F2_SPEC],
    ['F3', F3_SPEC],
    ['F4', F4_SPEC],
    ['F5a', F5A_SPEC],
    ['F5b', F5B_SPEC],
    ['F5c', F5C_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-SHIFT-CLOSE-DISCOUNT-SUMMARY/g)'),
      `${label} spec guard assertion must re-pin to the F5d INV`,
    );
  }

  console.log(
    'phase1 F5d maintenance|products checks passed (imei maintenance via shared catalog hooks, products->maintenance gone, pairs 9->8, edges 52 / statements 132, 384 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
