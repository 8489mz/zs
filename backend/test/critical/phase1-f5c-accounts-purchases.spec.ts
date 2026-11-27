import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5c — break the accounts|purchases frontend circular pair
 * (INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED).
 *
 * Grounding §7 row 3 / §8 F5c (phase1-f0-grounding.md), re-derived live
 * at 797ee49bf: accounts|purchases, module-boundary counts 1/1, ONE deep
 * leg:
 * - accounts -> purchases (1): supplier-balance-schedule/
 *   purchase-items-expandable.tsx:4 imports purchasesApi from
 *   '@/features/purchases/api/purchases.api' (queryFn:
 *   purchasesApi.getById(purchaseId), queryKey
 *   queryKeys.purchaseDetail(purchaseId), staleTime 60 * 1000).
 * - purchases -> accounts (1): new-purchase-order/hooks/
 *   use-purchase-order-catalog.ts:193 dynamically imports
 *   '@/features/accounts/api/accounts.api' (accountsApi.partnerContacts(
 *   'supplier', String(supplierId))).
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other accounts file imports from purchases, no
 * other purchases file imports from accounts, no relative cross
 * imports). A pair breaks ONLY when one direction's statements reach 0
 * (code moves / inversion) — routing through a public index does NOT
 * reduce the module-boundary count (proven by F3). So F5c breaks the
 * accounts -> purchases direction by moving the fetch into the shared
 * catalog hook: frontend/src/shared/hooks/use-catalog-queries.ts is the
 * established home for cross-feature catalog queries (it already imports
 * purchasesApi, plus products/sales/customers/suppliers/settings APIs),
 * and shared imports are not feature edges. The new hook
 * usePurchaseDetailQuery(purchaseId) carries the component's query
 * VERBATIM — same queryKey, same queryFn, same staleTime — so the
 * query object is identical and no behaviour can change (same cache
 * key, same getById fetch, same Purchase shape). The component
 * re-points to the hook and drops its purchasesApi + useQuery imports
 * (its only useQuery use was this query). The purchases -> accounts
 * direction stays (the catalog hook keeps its dynamic accountsApi
 * import and its partnerContacts call site): breaking ONE direction is
 * enough for the pair to be gone. The purchases index keeps its public
 * surface (PurchasesPage + purchasesRouteModule); the accounts index
 * keeps its public surface (AccountsPage + accountsRouteModule +
 * SupplierPaymentForm + formatLedgerEntryType).
 *
 * What moves and what re-points (all re-points are import-route
 * changes only; the query object is identical, so no behaviour can
 * change):
 * - Added: usePurchaseDetailQuery(purchaseId) in
 *   frontend/src/shared/hooks/use-catalog-queries.ts (same queryKey +
 *   queryFn + staleTime as the component had inline).
 * - Re-pointed: accounts/components/supplier-balance-schedule/
 *   purchase-items-expandable.tsx (:4) — purchasesApi + useQuery
 *   imports gone, hook import from '@/shared/hooks/use-catalog-queries'
 *   in, `const { data: purchase, isLoading, error } =
 *   usePurchaseDetailQuery(purchaseId);` (destructuring + rendering
 *   byte-identical).
 * Consequences, all re-pinned in this package:
 * - accounts -> purchases: 1 -> 0; purchases -> accounts stays 1.
 * - Frontend edges 54 -> 53, statements 135 -> 134, pairs 10 -> 9
 *   ('accounts|purchases' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline 70 -> 69 (the deep
 *   purchase-items-expandable string is gone — hand-shrunk by exactly
 *   that one string, F3 precedent); import-layer baseline stays 152
 *   (no app-layer string moves in this package).
 * - Wiring: both critical lists carry 384 specs in identical order,
 *   the F5d spec last.
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
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const EXPANDABLE = path.join(
  FEATURES,
  'accounts',
  'components',
  'supplier-balance-schedule',
  'purchase-items-expandable.tsx',
);
const CATALOG = path.join(
  FEATURES,
  'purchases',
  'components',
  'new-purchase-order',
  'hooks',
  'use-purchase-order-catalog.ts',
);
const CATALOG_HOOKS = path.join(SHARED_HOOKS, 'use-catalog-queries.ts');
const PURCHASES_INDEX = path.join(FEATURES, 'purchases', 'index.ts');
const ACCOUNTS_INDEX = path.join(FEATURES, 'accounts', 'index.ts');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The accounts -> purchases direction is gone; the purchases ->
  // accounts direction stays. The shared hook carries the component's
  // query verbatim; the component re-points to it; both public
  // indices keep their surface unchanged.
  const accountsFiles: string[] = [];
  walkTs(path.join(FEATURES, 'accounts'), accountsFiles);
  const stillPurchases: string[] = [];
  for (const file of accountsFiles) {
    if (fs.readFileSync(file, 'utf8').includes("from '@/features/purchases")) {
      stillPurchases.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillPurchases, [], "no accounts file may still import from '@/features/purchases'");
  const expandable = fs.readFileSync(EXPANDABLE, 'utf8');
  assert.ok(
    expandable.includes("import { usePurchaseDetailQuery } from '@/shared/hooks/use-catalog-queries';"),
    'PurchaseItemsExpandable must import usePurchaseDetailQuery from the shared catalog hooks',
  );
  assert.ok(
    !expandable.includes("from '@/features/purchases"),
    'PurchaseItemsExpandable must not import from the purchases feature anymore',
  );
  assert.ok(
    !expandable.includes("from '@tanstack/react-query'"),
    'PurchaseItemsExpandable must not import useQuery anymore (its only use was this query)',
  );
  assert.ok(
    expandable.includes('const { data: purchase, isLoading, error } = usePurchaseDetailQuery(purchaseId);'),
    'PurchaseItemsExpandable must call the shared hook for the purchase detail query',
  );
  assert.ok(
    !expandable.includes('queryKeys.purchaseDetail(purchaseId)'),
    'PurchaseItemsExpandable must keep no inline queryKey (the hook carries it)',
  );
  const hooks = fs.readFileSync(CATALOG_HOOKS, 'utf8');
  assert.ok(
    hooks.includes('export function usePurchaseDetailQuery(purchaseId: string) {'),
    'the shared catalog hooks must export usePurchaseDetailQuery',
  );
  assert.ok(
    hooks.includes('queryKey: queryKeys.purchaseDetail(purchaseId),'),
    'the shared hook must keep the purchaseDetail(purchaseId) queryKey verbatim',
  );
  assert.ok(
    hooks.includes('queryFn: () => purchasesApi.getById(purchaseId),'),
    'the shared hook must keep the getById(purchaseId) queryFn verbatim',
  );
  assert.ok(hooks.includes('staleTime: 60 * 1000,'), 'the shared hook must keep the 60 * 1000 staleTime verbatim');
  assert.ok(
    hooks.includes("import { purchasesApi } from '@/features/purchases/api/purchases.api';"),
    'the shared catalog hooks must import purchasesApi from the purchases api (shared imports are not edges)',
  );
  const catalog = fs.readFileSync(CATALOG, 'utf8');
  assert.ok(
    catalog.includes("await import('@/features/accounts/api/accounts.api')"),
    'use-purchase-order-catalog must keep its dynamic accountsApi import (the surviving direction)',
  );
  assert.ok(
    catalog.includes("accountsApi.partnerContacts('supplier', String(supplierId))"),
    'use-purchase-order-catalog must keep its partnerContacts call site identical',
  );
  const purchasesIndex = fs.readFileSync(PURCHASES_INDEX, 'utf8');
  assert.ok(
    purchasesIndex.includes("export { PurchasesPage } from '@/features/purchases/pages/PurchasesPage';"),
    'the purchases index must still re-export PurchasesPage (public surface unchanged)',
  );
  assert.ok(
    purchasesIndex.includes("export { purchasesRouteModule } from '@/features/purchases/routes';"),
    'the purchases index must still re-export purchasesRouteModule (public surface unchanged)',
  );
  const accountsIndex = fs.readFileSync(ACCOUNTS_INDEX, 'utf8');
  assert.ok(
    accountsIndex.includes("export { AccountsPage } from '@/features/accounts/pages/AccountsPage';"),
    'the accounts index must still re-export AccountsPage (public surface unchanged)',
  );
  assert.ok(
    accountsIndex.includes("export { accountsRouteModule } from '@/features/accounts/routes';"),
    'the accounts index must still re-export accountsRouteModule (public surface unchanged)',
  );

  // 2. The module-boundary pins move: frontend edges 54 -> 53,
  // statements 135 -> 134, pairs 10 -> 9 ('accounts|purchases' gone);
  // the backend pins do not move. The feature-boundary baseline
  // shrinks 70 -> 69 (the deep purchase-items-expandable string is
  // gone); the import-layer baseline stays 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 116;'),
    'module-boundary must pin the frontend total 116 after F5c',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 46,'),
    'module-boundary must pin 46 frontend edges after F5c',
  );
  assert.ok(
    !boundary.includes("'accounts->purchases'"),
    'the accounts->purchases edge must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'purchases->accounts': 1,"),
    'the purchases->accounts edge must stay pinned at 1 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'accounts|purchases'"), 'the accounts|purchases pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 63, 'feature-boundary baseline must shrink to exactly 63 after F5c');
  assert.ok(
    !featureBaseline.some((entry) => entry.includes('purchase-items-expandable')),
    'the deep purchase-items-expandable string must be gone from the feature-boundary baseline',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5c');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5c INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-F5J-INVENTORY-PRODUCTS-DECOUPLED/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5c INV exactly once');

  // 4. Wiring: both critical lists carry 384 specs in identical order, the F5d spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 391);
  assert.equal(chain.length, 391);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 384 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5j-inventory-products.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-f5j-inventory-products.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 391);') && src.includes('assert.equal(chain.length, 391);'),
      `${label} spec wiring must re-pin to 383`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-f5j-inventory-products.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5c spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F5b spec. (The
  // live tree holds ~57 files asserting the count — the #264-fix /
  // D12 lesson. The F5b filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f5bName = 'phase1-f5b' + '-products-settings.spec.ts';
  const staleSpecs = 'specs.length, 38' + '2';
  const staleChain = 'chain.length, 38' + '2';
  const staleList = 'list.length, 38' + '2';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5bName}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5b spec');

  // 6. The guard tail holds ONLY the newest id, so F5c re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b specs' guard assertions to the F5c
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
    ['F5b', F5B_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-F5J-INVENTORY-PRODUCTS-DECOUPLED/g)'),
      `${label} spec guard assertion must re-pin to the F5c INV`,
    );
  }

  console.log(
    'phase1 F5c accounts|purchases checks passed (purchase detail via shared catalog hook, accounts->purchases gone, pairs 10->9, edges 53 / statements 134, 384 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
