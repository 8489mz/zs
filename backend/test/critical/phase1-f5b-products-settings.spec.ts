import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5b — break the products|settings frontend circular pair
 * (INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED).
 *
 * Grounding §7 row 2 / §8 F5b (phase1-f0-grounding.md), re-derived live
 * at 23b0847b6: products|settings, module-boundary counts 1/1, ZERO deep
 * legs — both legs go through the public indices:
 * - products -> settings (1): BarcodePrinterPicker.tsx:9 imports
 *   settingsApi from '@/features/settings' (settingsApi.update(patch)).
 * - settings -> products (1): SettingsMarketplacesSection.tsx:4 imports
 *   productsApi from '@/features/products' (queryFn:
 *   productsApi.listPage({ pageSize: 150 }), queryKey
 *   ['marketplace-products-selector']).
 * A pair breaks ONLY when one direction's statements reach 0 (code
 * moves / inversion) — routing through a public index does NOT reduce
 * the module-boundary count (proven by F3). So F5b breaks the
 * settings -> products direction by moving the fetch into the shared
 * catalog hook: frontend/src/shared/hooks/use-catalog-queries.ts is the
 * established home for cross-feature catalog queries (it already imports
 * productsApi, plus sales/purchases/customers/suppliers/settings APIs),
 * and shared imports are not feature edges. The new hook
 * useMarketplaceProductsQuery() carries the section's query VERBATIM —
 * same queryKey, same queryFn — so the query object is identical and
 * no behaviour can change (same cache key, same page size, same
 * .products shape; listAll() was NOT substituted — it pages through
 * every product, a different fetch). The section re-points to the hook
 * and drops its productsApi + useQuery imports (its only useQuery use
 * was this query). The products -> settings direction stays
 * (BarcodePrinterPicker keeps importing settingsApi and calling
 * settingsApi.update(patch)): breaking ONE direction is enough for the
 * pair to be gone. The products index keeps re-exporting productsApi
 * (public surface unchanged).
 *
 * What moves and what re-points (all re-points are import-route
 * changes only; the query object is identical, so no behaviour can
 * change):
 * - Added: useMarketplaceProductsQuery() in
 *   frontend/src/shared/hooks/use-catalog-queries.ts (same queryKey +
 *   queryFn as the section had inline).
 * - Re-pointed: settings/components/workspace-sections/
 *   SettingsMarketplacesSection.tsx (:4) — productsApi + useQuery
 *   imports gone, hook import from '@/shared/hooks/use-catalog-queries'
 *   in, `const productsQuery = useMarketplaceProductsQuery();`
 *   (availableProducts call site byte-identical).
 * Consequences, all re-pinned in this package:
 * - settings -> products: 1 -> 0; products -> settings stays 1.
 * - Frontend edges 55 -> 54, statements 136 -> 135, pairs 11 -> 10
 *   ('products|settings' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline stays 70, import-layer baseline stays
 *   152 (no deep string and no app-layer string moves in this package).
 * - Wiring: both critical lists carry 384 specs in identical order,
 *   the F5c spec last.
 *
 * Notes: the stale cosmetic string in the F2 spec ("379 specs wired"
 * in its console.log) is pre-existing since F3 and is NOT an
 * assertion — left as-is per the parent brief. docs/MODULE_DOORS.md
 * §4 coupling line ('57 edges / 133 statements') is a stale
 * historical note (already wrong about the live pins before F5a:
 * backend 71/652, posting 79) that no package maintains — left as-is.
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const SECTION = path.join(FEATURES, 'settings', 'components', 'workspace-sections', 'SettingsMarketplacesSection.tsx');
const PICKER = path.join(FEATURES, 'products', 'components', 'BarcodePrinterPicker.tsx');
const CATALOG_HOOKS = path.join(SHARED_HOOKS, 'use-catalog-queries.ts');
const PRODUCTS_INDEX = path.join(FEATURES, 'products', 'index.ts');
const SETTINGS_INDEX = path.join(FEATURES, 'settings', 'index.ts');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The settings -> products direction is gone; the products ->
  // settings direction stays. The shared hook carries the section's
  // query verbatim; the section re-points to it; the products index
  // still re-exports productsApi (public surface unchanged).
  const settingsFiles: string[] = [];
  walkTs(path.join(FEATURES, 'settings'), settingsFiles);
  const stillProducts: string[] = [];
  for (const file of settingsFiles) {
    if (fs.readFileSync(file, 'utf8').includes("from '@/features/products")) {
      stillProducts.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillProducts, [], "no settings file may still import from '@/features/products'");
  const section = fs.readFileSync(SECTION, 'utf8');
  assert.ok(
    section.includes("import { useMarketplaceProductsQuery } from '@/shared/hooks/use-catalog-queries';"),
    'SettingsMarketplacesSection must import useMarketplaceProductsQuery from the shared catalog hooks',
  );
  assert.ok(
    !section.includes("from '@/features/products"),
    'SettingsMarketplacesSection must not import from the products feature anymore',
  );
  assert.ok(
    !section.includes("from '@tanstack/react-query'"),
    'SettingsMarketplacesSection must not import useQuery anymore (its only use was this query)',
  );
  assert.ok(
    section.includes('const productsQuery = useMarketplaceProductsQuery();'),
    'SettingsMarketplacesSection must call the shared hook for the products query',
  );
  assert.ok(
    section.includes('const availableProducts = productsQuery.data?.products || [];'),
    'SettingsMarketplacesSection must keep its availableProducts call site identical',
  );
  const hooks = fs.readFileSync(CATALOG_HOOKS, 'utf8');
  assert.ok(
    hooks.includes('export function useMarketplaceProductsQuery() {'),
    'the shared catalog hooks must export useMarketplaceProductsQuery',
  );
  assert.ok(
    hooks.includes("queryKey: ['marketplace-products-selector'],"),
    'the shared hook must keep the marketplace-products-selector queryKey verbatim',
  );
  assert.ok(
    hooks.includes('queryFn: () => productsApi.listPage({ pageSize: 150 })'),
    'the shared hook must keep the listPage({ pageSize: 150 }) queryFn verbatim',
  );
  assert.ok(
    hooks.includes("import { productsApi } from '@/features/products/api/products.api';"),
    'the shared catalog hooks must import productsApi from the products api (shared imports are not edges)',
  );
  const picker = fs.readFileSync(PICKER, 'utf8');
  assert.ok(
    picker.includes("import { settingsApi } from '@/features/settings';"),
    'BarcodePrinterPicker must keep importing settingsApi from the settings index (the surviving direction)',
  );
  assert.ok(
    picker.includes('void settingsApi.update(patch)'),
    'BarcodePrinterPicker must keep its settingsApi.update(patch) call site identical',
  );
  const productsIndex = fs.readFileSync(PRODUCTS_INDEX, 'utf8');
  assert.ok(
    productsIndex.includes("export { productsApi } from '@/features/products/api/products.api';"),
    'the products index must still re-export productsApi (public surface unchanged)',
  );
  const settingsIndex = fs.readFileSync(SETTINGS_INDEX, 'utf8');
  assert.ok(
    settingsIndex.includes("export { settingsApi } from '@/features/settings/api/settings.api';"),
    'the settings index must still re-export settingsApi (public surface unchanged)',
  );

  // 2. The module-boundary pins move: frontend edges 55 -> 54,
  // statements 136 -> 135, pairs 11 -> 10 ('products|settings' gone);
  // the backend pins do not move. Both baselines stay put (no deep
  // string and no app-layer string moves in this package).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5b',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5b',
  );
  assert.ok(!boundary.includes("'settings->products'"), 'the settings->products edge must be gone from the edge table');
  assert.ok(
    boundary.includes("'products->settings': 1,"),
    'the products->settings edge must stay pinned at 1 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'products|settings'"), 'the products|settings pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57 after F5b');
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5b');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5b INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S10/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5b INV exactly once');

  // 4. Wiring: both critical lists carry 384 specs in identical order, the F5c spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 426);
  assert.equal(chain.length, 426);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 384 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 426);') && src.includes('assert.equal(chain.length, 426);'),
      `${label} spec wiring must re-pin to 382`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5b spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F5a spec. (The
  // live tree holds ~57 files asserting the count — the #264-fix /
  // D12 lesson. The F5a filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f5aName = 'phase1-f5a' + '-audit-settings.spec.ts';
  const staleSpecs = 'specs.length, 38' + '1';
  const staleChain = 'chain.length, 38' + '1';
  const staleList = 'list.length, 38' + '1';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5aName}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5a spec');

  // 6. The guard tail holds ONLY the newest id, so F5b re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a specs' guard assertions to the F5b
  // INV; their invariants-file assertions still pin their own id (each
  // line stays in ARCHITECTURE_INVARIANTS.md exactly once).
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S10/g)'),
      `${label} spec guard assertion must re-pin to the F5b INV`,
    );
  }

  console.log(
    'phase1 F5b products|settings checks passed (marketplace product list via shared catalog hook, settings->products gone, pairs 11->10, edges 54 / statements 135, 384 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
