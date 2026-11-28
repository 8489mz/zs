import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5h — break the pos|sales frontend circular pair
 * (INV-PHASE1-F5H-POS-SALES-DECOUPLED).
 *
 * Grounding §7 row 8 / §8 F5h (phase1-f0-grounding.md), re-derived live
 * at 76e70e899: pos|sales, module-boundary counts 3/3; the deep legs
 * were already routed by F3, so the remaining direction is broken here:
 * - pos -> sales (3, all bare public-index imports of salesApi):
 *   pos/components/PosWorkspace.tsx:12,
 *   pos/components/pos-workspace/PosRecentSalesReprintModal.tsx:9,
 *   pos/components/pos-workspace/PosInstantExchangeDialog.tsx:10.
 *   PLUS the spec file PosRecentSalesReprintModal.spec.tsx:6 imports
 *   salesApi (vi.spyOn listPage) — feature-boundary surface, not
 *   module-boundary.
 * - sales -> pos (3, STAYS): sales/components/CreateSalesOrderModal.tsx:18
 *   imports getProductPrice, sales/components/SalesWorkspace.tsx:22
 *   imports isPosAvailable, sales/routes.tsx:20 dynamically imports
 *   DisplaysPortalPage from '@/features/pos/pages/DisplaysPortalPage'.
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other pos file imports from sales — no spec file
 * either — no other sales file imports from pos, no relative cross
 * imports, no other dynamic imports).
 * The F3 spec's block 3 asserted the pos|sales pair "must stay pinned"
 * (F5h not done) — flipped to the gone-form with a short F5h note
 * in-package (F5f precedent).
 *
 * The break: the pos -> sales direction goes to 0 by moving the
 * salesApi client WHOLE to shared (F5f precedent — the F5g "move to
 * shared" break, where the api client already lived in shared; here
 * the move itself creates the shared home).
 * - frontend/src/features/sales/api/sales.api.ts (98L) moves via git mv
 *   to frontend/src/shared/api/sales.api.ts, byte-identical. Its own
 *   imports are all non-feature (@/lib/http, @/lib/api/contracts,
 *   @/types/domain, @/lib/query-string), so the moved file has zero
 *   feature dependencies and is a pure shared util.
 * - A shim at the old path re-exports salesApi + the three types
 *   (SalesListSummary, SalesListFilter, SalesListParams) from
 *   '@/shared/api/sales.api' — mirrors the customers.api shim exactly.
 *   Every other importer (sales-internal hooks x4, delivery-reps x2,
 *   accounts, reports dynamic import, app/router route-prefetch,
 *   shared x3, the sales index) keeps working unchanged via the shim,
 *   so NO other edge's count moves.
 * - The 3 pos files re-point one line each to
 *   '@/shared/api/sales.api' — same function object, call sites
 *   byte-identical (same listPage params). The reprint spec re-points
 *   the same way (same object, vi.spyOn still intercepts listPage).
 * - The sales index is UNCHANGED (still re-exports salesApi from its
 *   own api file = the shim; public surface unchanged).
 * Why this direction, not sales -> pos: the three pos legs share ONE
 * seam (the salesApi client); the sales -> pos direction has three
 * heterogeneous seams (a pure pricing helper, a settings availability
 * check, a route registration) — breaking it would be three moves
 * including a route move. Direct '@/shared/api/' imports from features
 * are established practice (delivery-reps hooks/pages, F5g modal).
 * The sales -> pos direction stays — breaking ONE direction is enough
 * for the pair to be gone.
 *
 * Consequences, all re-pinned in this package:
 * - pos -> sales: 3 -> 0; sales -> pos stays 3.
 * - Frontend edges 49 -> 48, statements 128 -> 125, pairs 5 -> 4
 *   ('pos|sales' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline stays 65 (the 3 pos -> sales strings
 *   are bare-index imports — no baseline string moves; the spec string
 *   was never in the baseline) and import-layer baseline stays 152.
 * - Wiring: both critical lists carry 388 specs in identical order,
 *   this spec last.
 *
 * Notes: the stale cosmetic string in the F2 spec ("379 specs wired"
 * in its console.log) is pre-existing since F3 and is NOT an
 * assertion — left as-is per the parent brief. docs/MODULE_DOORS.md
 * §4 coupling line ('57 edges / 133 statements') is a stale
 * historical note (already wrong about the live pins before F5a)
 * that no package maintains — left as-is.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const FEATURES = path.join(FRONTEND, 'src', 'features');
const SHARED_API = path.join(FRONTEND, 'src', 'shared', 'api');
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
const F5D_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5d-maintenance-products.spec.ts');
const F5E_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5e-accounting-treasury.spec.ts');
const F5F_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5f-cash-drawer-pos.spec.ts');
const F5G_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5g-customers-sales.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const POS_WORKSPACE = path.join(FEATURES, 'pos', 'components', 'PosWorkspace.tsx');
const REPRINT_MODAL = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosRecentSalesReprintModal.tsx');
const REPRINT_SPEC = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosRecentSalesReprintModal.spec.tsx');
const EXCHANGE_DIALOG = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosInstantExchangeDialog.tsx');
const SHARED_SALES_API = path.join(SHARED_API, 'sales.api.ts');
const SALES_API_SHIM = path.join(FEATURES, 'sales', 'api', 'sales.api.ts');
const SALES_INDEX = path.join(FEATURES, 'sales', 'index.ts');
const CREATE_ORDER_MODAL = path.join(FEATURES, 'sales', 'components', 'CreateSalesOrderModal.tsx');
const SALES_WORKSPACE = path.join(FEATURES, 'sales', 'components', 'SalesWorkspace.tsx');
const SALES_ROUTES = path.join(FEATURES, 'sales', 'routes.tsx');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The pos -> sales direction is gone; the sales -> pos direction
  // stays. The salesApi client moved whole to shared; the 3 pos files
  // + the reprint spec re-point to the shared home; the shim keeps
  // every other importer working; the sales index surface is unchanged.
  const posFiles: string[] = [];
  walkTs(path.join(FEATURES, 'pos'), posFiles);
  const stillSales: string[] = [];
  for (const file of posFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes("from '@/features/sales") || src.includes("import('@/features/sales")) {
      stillSales.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillSales, [], "no pos file may still import from '@/features/sales'");
  const workspace = fs.readFileSync(POS_WORKSPACE, 'utf8');
  assert.ok(
    workspace.includes("import { salesApi } from '@/shared/api/sales.api';"),
    'PosWorkspace must import salesApi from the shared api client (its new home)',
  );
  assert.ok(
    workspace.includes('const salesResult = await salesApi.listPage({ search: primaryTerm, pageSize: 5 });'),
    'PosWorkspace must keep its primary-term listPage call byte-identical',
  );
  assert.ok(
    workspace.includes('remainingTerms.map((term) => salesApi.listPage({ search: term, pageSize: 5 }))'),
    'PosWorkspace must keep its remaining-terms listPage call byte-identical',
  );
  const reprint = fs.readFileSync(REPRINT_MODAL, 'utf8');
  assert.ok(
    reprint.includes("import { salesApi } from '@/shared/api/sales.api';"),
    'PosRecentSalesReprintModal must import salesApi from the shared api client (its new home)',
  );
  assert.ok(
    reprint.includes('const res = await salesApi.listPage({ pageSize: 5 });'),
    'PosRecentSalesReprintModal must keep its listPage call byte-identical',
  );
  const exchange = fs.readFileSync(EXCHANGE_DIALOG, 'utf8');
  assert.ok(
    exchange.includes("import { salesApi } from '@/shared/api/sales.api';"),
    'PosInstantExchangeDialog must import salesApi from the shared api client (its new home)',
  );
  assert.ok(
    exchange.includes('const page = await salesApi.listPage({ search: searchTerm, pageSize: 10 });'),
    'PosInstantExchangeDialog must keep its listPage call byte-identical',
  );
  const reprintSpec = fs.readFileSync(REPRINT_SPEC, 'utf8');
  assert.ok(
    reprintSpec.includes("import { salesApi } from '@/shared/api/sales.api';"),
    'PosRecentSalesReprintModal.spec must import salesApi from the shared api client (same object, spy still intercepts)',
  );
  assert.ok(
    reprintSpec.includes("vi.spyOn(salesApi, 'listPage')"),
    'PosRecentSalesReprintModal.spec must keep spying on salesApi.listPage',
  );
  const sharedApi = fs.readFileSync(SHARED_SALES_API, 'utf8');
  assert.ok(sharedApi.includes('export const salesApi = {'), 'the shared sales.api must define salesApi');
  assert.ok(
    sharedApi.includes('export interface SalesListSummary {'),
    'the shared sales.api must define SalesListSummary',
  );
  assert.ok(sharedApi.includes('export type SalesListFilter ='), 'the shared sales.api must define SalesListFilter');
  assert.ok(
    sharedApi.includes('export interface SalesListParams {'),
    'the shared sales.api must define SalesListParams',
  );
  assert.ok(
    !sharedApi.includes('@/features/'),
    'the shared sales.api must have zero feature imports (pure shared util)',
  );
  const shim = fs.readFileSync(SALES_API_SHIM, 'utf8');
  assert.ok(shim.includes("from '@/shared/api/sales.api';"), 'the sales api shim must re-export from the shared home');
  assert.ok(shim.includes('salesApi'), 'the sales api shim must re-export salesApi');
  assert.ok(shim.includes('SalesListSummary'), 'the sales api shim must re-export SalesListSummary');
  assert.ok(shim.includes('SalesListFilter'), 'the sales api shim must re-export SalesListFilter');
  assert.ok(shim.includes('SalesListParams'), 'the sales api shim must re-export SalesListParams');
  const salesIndex = fs.readFileSync(SALES_INDEX, 'utf8');
  assert.ok(
    salesIndex.includes("export { salesApi } from '@/features/sales/api/sales.api';"),
    'the sales index must still re-export salesApi from its own api file (public surface unchanged)',
  );
  assert.ok(
    salesIndex.includes("export { priceListsApi } from '@/features/sales/api/price-lists.api';"),
    'the sales index must still re-export priceListsApi (public surface unchanged)',
  );
  assert.ok(
    salesIndex.includes("export { SalesPage } from '@/features/sales/pages/SalesPage';"),
    'the sales index must still re-export SalesPage (public surface unchanged)',
  );
  assert.ok(
    salesIndex.includes("export { salesRouteModule } from '@/features/sales/routes';"),
    'the sales index must still re-export salesRouteModule (public surface unchanged)',
  );
  const orderModal = fs.readFileSync(CREATE_ORDER_MODAL, 'utf8');
  assert.ok(
    orderModal.includes("import { getProductPrice } from '@/features/pos';"),
    'CreateSalesOrderModal must keep its getProductPrice import (the surviving direction)',
  );
  assert.ok(
    orderModal.includes(
      "getProductPrice(foundProd, 'retail', qty || 1, 1, currencyMoneyDigits(getGlobalSystemCurrency()))",
    ),
    'CreateSalesOrderModal must keep its first promo-price call byte-identical',
  );
  const salesWorkspace = fs.readFileSync(SALES_WORKSPACE, 'utf8');
  assert.ok(
    salesWorkspace.includes("import { isPosAvailable } from '@/features/pos';"),
    'SalesWorkspace must keep its isPosAvailable import (the surviving direction)',
  );
  assert.ok(
    salesWorkspace.includes('showPosButton={Boolean(settingsQuery.data) && isPosAvailable(settingsQuery.data)}'),
    'SalesWorkspace must keep its showPosButton call byte-identical',
  );
  const salesRoutes = fs.readFileSync(SALES_ROUTES, 'utf8');
  assert.ok(
    salesRoutes.includes("import('@/features/pos/pages/DisplaysPortalPage')"),
    'sales routes must keep the displays dynamic import (the surviving direction)',
  );

  // 2. The module-boundary pins move: frontend edges 49 -> 48,
  // statements 128 -> 125, pairs 5 -> 4 ('pos|sales' gone);
  // the backend pins do not move. Both baselines stay (65 / 152).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5h',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5h',
  );
  assert.ok(
    !boundary.includes("'pos->sales': 3,"),
    'the pos->sales frontend edge (pinned at 3) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'sales->pos': 3,"),
    'the sales->pos edge must stay pinned at 3 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'pos|sales'"), 'the pos|sales pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57 after F5h');
  assert.ok(
    featureBaseline.includes(
      'accounts/components/CustomerBalanceInvoicesCard.tsx imports @/features/sales/api/sales.api',
    ),
    'feature-boundary baseline must keep the out-of-scope CustomerBalanceInvoicesCard string',
  );
  assert.ok(
    featureBaseline.includes(
      'delivery-reps/components/DeliveryRepSettlements.tsx imports @/features/sales/api/sales.api',
    ),
    'feature-boundary baseline must keep the out-of-scope DeliveryRepSettlements string',
  );
  assert.ok(
    featureBaseline.includes(
      'delivery-reps/components/VanSaleNewInvoiceModal.tsx imports @/features/sales/api/sales.api',
    ),
    'feature-boundary baseline must keep the out-of-scope VanSaleNewInvoiceModal string',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5h');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5H-POS-SALES-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5h INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-IMPORT-FX-PAYOUT-IDEMPOTENCY/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5h INV exactly once');

  // 4. Wiring: both critical lists carry 388 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 412);
  assert.equal(chain.length, 412);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 388 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s6-import-fx-payout-idempotency.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s6-import-fx-payout-idempotency.spec.ts');
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
    ['F5d', F5D_SPEC],
    ['F5e', F5E_SPEC],
    ['F5f', F5F_SPEC],
    ['F5g', F5G_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 412);') && src.includes('assert.equal(chain.length, 412);'),
      `${label} spec wiring must re-pin to 388`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s6-import-fx-payout-idempotency.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5h spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5g spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~71 files asserting the count — the #264-fix /
  // D12 lesson. The F5g filename, the count literals, the FE pin
  // literals and the baseline literals are built by concatenation so
  // this block's own source never contains the patterns it scans for.
  // The scan covers all three variable forms: specs, chain, and
  // list.length; the baseline check is line-scoped, F5e lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const f5gName = 'phase1-f5g' + '-customers-sales.spec.ts';
  const f5gInv = 'INV-PHASE1-F5G' + '-CUSTOMERS-SALES-DECOUPLED';
  const staleSpecs = 'specs.length, 38' + '7';
  const staleChain = 'chain.length, 38' + '7';
  const staleList = 'list.length, 38' + '7';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 12" + "8;'";
  const staleFeTotalAfter = "'module-boundary must pin the frontend total 12" + '8 after ';
  const staleFeTotalStill = "'module-boundary must still pin the frontend total 12" + "8'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 4" + "9,'";
  const staleFeEdgesAfter = "'module-boundary must pin 4" + '9 frontend edges after ';
  const staleFeEdgesStill = "'module-boundary must still pin 4" + "9 frontend edges'";
  const staleBaselineA = 'baseline.length, 6' + '6';
  const staleBaselineB = 'featureBaseline.length, 6' + '6';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5gName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${f5gInv}/g)`)) staleGuard.push(file);
    if (
      src.includes(staleFeTotal) ||
      src.includes(staleFeTotalAfter) ||
      src.includes(staleFeTotalStill) ||
      src.includes(staleFeEdges) ||
      src.includes(staleFeEdgesAfter) ||
      src.includes(staleFeEdgesStill)
    ) {
      staleFePins.push(file);
    }
    for (const line of src.split('\n')) {
      if (line.includes(staleBaselineA) || line.includes(staleBaselineB)) {
        staleBaseline.push(`${file}: ${line.trim().slice(0, 100)}`);
      }
    }
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5g spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so F5h re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g specs' guard
  // assertions to the F5h INV; their invariants-file assertions still
  // pin their own id (each line stays in ARCHITECTURE_INVARIANTS.md
  // exactly once).
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
    ['F5d', F5D_SPEC],
    ['F5e', F5E_SPEC],
    ['F5f', F5F_SPEC],
    ['F5g', F5G_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-IMPORT-FX-PAYOUT-IDEMPOTENCY/g)'),
      `${label} spec guard assertion must re-pin to the F5h INV`,
    );
  }

  console.log(
    'phase1 F5h pos|sales checks passed (pos->sales gone, pairs 5->4, edges 48 / statements 125, 388 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
