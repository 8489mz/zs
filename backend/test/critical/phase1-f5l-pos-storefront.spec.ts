import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5l — break the pos|storefront frontend circular pair, the
 * LAST pair (INV-PHASE1-F5L-POS-STOREFRONT-DECOUPLED).
 *
 * Grounding §7 row 12 / §8 F5l (phase1-f0-grounding.md), re-derived live
 * at fd67b46bb: pos|storefront, module-boundary counts 12/5, 7 deep
 * edges at grounding time; live: 5 storefront->pos statements (3 deep
 * + 2 public-index), 12 pos->storefront statements.
 * - storefront -> pos (5 statements — THE direction to break):
 *   storefront/components/StorefrontSettingsTab.tsx:20 imports
 *   TableQrPrintDialog from '@/features/pos' (public index) and renders
 *   it (:462); storefront/components/TableBillModal.tsx:5 imports
 *   restaurantAdvancedFnbApi from '@/features/pos' (public index) and
 *   calls recordTableRating (:95, :114); storefront/lib/
 *   storefront-pos-loader.ts:2 imports persistDraftSnapshot,
 *   loadPosWorkspaceStorage from '@/features/pos/lib/pos.persistence'
 *   (DEEP leg) and :3 imports type { PosItem } from
 *   '@/features/pos/types/pos.types' (DEEP leg); storefront/pages/
 *   merchant-online-orders/merchant-orders-pos-success-dialog.tsx:1
 *   imports PosSaleSuccessDialog from '@/features/pos/components/
 *   pos-workspace/PosSaleSuccessDialog' (DEEP leg).
 * - pos -> storefront (12 statements — STAYS except 1):
 *   pos/components/pos-workspace/PosOnlineOrdersModal.tsx:6 imports
 *   storefrontApi from '@/features/storefront/api/storefront.api', :7
 *   ConvertDeliveryModal, :8 loadOnlineOrderIntoPosCart from
 *   '@/features/storefront/lib/storefront-pos-loader' (kept via the
 *   loader shim), :9 type OnlineOrderRecord; pos/components/
 *   pos-workspace/PosWorkspaceHeader.tsx:6 imports storefrontApi;
 *   RestaurantDeliveryDispatcherModal.tsx:8 imports storefrontApi from
 *   '@/features/storefront'; TableQrPrintDialog.tsx:16 imports
 *   storefrontApi from '@/features/storefront' — GOES (the dialog moves
 *   to shared and its query becomes a shared hook; the only
 *   pos->storefront statement removed, 12 -> 11);
 *   pos-tables-floor-plan/PosFloorStatsBar.tsx:9 and PosTablesGrid.tsx:9
 *   import type OnlineOrderRecord from '@/features/storefront';
 *   PosTablesFloorPlanDialog.tsx:13 imports from '@/features/storefront';
 *   pos/hooks/pos-workspace-actions/createPosWorkspaceAsyncActions.ts:9
 *   imports storefrontApi; pos/hooks/useSelfOrderingKiosk.ts:3 imports
 *   storefrontApi. (The PosWorkspaceHeader.lazy-modals.spec.tsx:37
 *   import is a spec file — not counted by module-boundary, stays.)
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other storefront file imports from pos — no spec
 * file either — no other pos file imports from storefront, no relative
 * cross imports, no other dynamic imports).
 * No earlier spec pins the pos|storefront pair as staying except the
 * F5k spec §2 ('must stay pinned (the last pair, F5l owns it)') —
 * flipped to the gone-form in-package (F5f/F5h precedent).
 *
 * The break: the storefront -> pos direction goes to 0 via five seams
 * (F5f/F5h/F5i/F5j precedent — move ONLY what the legs require).
 * - The loader (2 deep legs) is the POS persistence/types loader — the
 *   shared seam named in the brief. frontend/src/features/storefront/
 *   lib/storefront-pos-loader.ts (108L, sha256 5057c154…) moves WHOLE
 *   via git mv to frontend/src/shared/lib/storefront-pos-loader.ts.
 *   ONE import re-point inside the moved file: its relative
 *   `import { storefrontApi } from '../api/storefront.api'` becomes
 *   `import { storefrontApi } from '@/features/storefront/api/
 *   storefront.api'` (the loader is a cross-feature bridge; it calls
 *   the storefront api client from shared, exactly as the sanctioned
 *   use-catalog-queries.ts shared hooks call feature api clients —
 *   F5b–F5g precedent). Its pos.persistence and pos.types imports stay
 *   as written (shared->pos bridge calls, invisible to the
 *   module-boundary scanner, which only walks features/*). Moving
 *   pos.persistence (183L, POS workspace draft storage) or pos.types
 *   (the pos feature's type home) or storefront.api (769L with 4
 *   storefront lib deps) into shared instead would drag feature-owned
 *   state into shared — the wrong home; the bridge moves. A shim at
 *   the old path re-exports loadOnlineOrderIntoPosCart from shared,
 *   mirroring the sales/products shim form. Every other importer keeps
 *   the old path and works unchanged via the shim (PosOnlineOrdersModal,
 *   MerchantOnlineOrdersPage relative import, storefront/index.ts
 *   re-export), so the pos->storefront count moves only by the dialog
 *   leg (12 -> 11).
 * - frontend/src/features/pos/lib/pos-floor-state.ts (231L, sha256
 *   acbc1634…, ZERO imports — pure) moves WHOLE via git mv to
 *   frontend/src/shared/lib/pos-floor-state.ts, byte-identical. Its
 *   colocated spec moves WITH it via git mv to frontend/src/shared/lib/
 *   pos-floor-state.spec.ts (sha256 8dc671f9…; relative import
 *   './pos-floor-state' still resolves — F5f precedent). A shim at the
 *   old path re-exports all 10 types + 3 functions explicitly,
 *   mirroring the hardware-bridge shim form. Every other importer keeps
 *   the old path (PosVisualFloorCanvas type + fn,
 *   PosTablesFloorPlanDialog, PosVisualFloorCanvas.spec).
 * - frontend/src/features/pos/components/pos-workspace/
 *   PosSaleSuccessDialog.tsx (453L, sha256 25f36003…) moves WHOLE via
 *   git mv to frontend/src/shared/components/PosSaleSuccessDialog.tsx.
 *   ONE import re-point inside the moved file: HardwareBridgeClient
 *   from '@/features/pos/lib/hardware-bridge-client' (the F5k shim
 *   path) becomes '@/shared/lib/hardware-bridge-client' (its F5k shared
 *   home — same class object); every other import is already
 *   shared/lib/domain, so the moved dialog has zero feature imports
 *   (pure shared util, F5h/F5i precedent). Its colocated spec moves
 *   WITH it via git mv to frontend/src/shared/components/
 *   PosSaleSuccessDialog.spec.tsx (sha256 ab0968b7…; relative import
 *   still resolves). The spec's hardware-bridge mock MUST re-point too:
 *   vi.mock('@/features/pos/lib/hardware-bridge-client') ->
 *   vi.mock('@/shared/lib/hardware-bridge-client') with the SAME
 *   factory — otherwise the mock stops intercepting (Vitest mocks are
 *   per-module-path; the F5h dialog-spec trap, fixed the same way by
 *   F5h-REPAIR-2). A shim at the old path re-exports
 *   PosSaleSuccessDialog from shared. The pos-internal importer
 *   (PosWorkspaceConfirmDialogsSection, deep path) keeps the old path
 *   via the shim; only the storefront page re-points to shared.
 * - frontend/src/features/pos/components/pos-workspace/
 *   TableQrPrintDialog.tsx (517L, sha256 4861bec2…) moves WHOLE via
 *   git mv to frontend/src/shared/components/TableQrPrintDialog.tsx.
 *   TWO import re-points inside the moved file: pos-floor-state ->
 *   '@/shared/lib/pos-floor-state', and its storefrontApi useQuery
 *   becomes the new shared hook useStorefrontAdminSettingsQuery({
 *   enabled: open }) — the query carried VERBATIM (same queryKey
 *   ['storefront-admin-settings'], same queryFn storefrontApi.
 *   getSettings, same enabled: open). The now-unused `import {
 *   useQuery } from '@tanstack/react-query'` and `import {
 *   storefrontApi } from '@/features/storefront'` lines are removed;
 *   the existing useSettingsQuery import line gains the new hook name.
 *   After the move the dialog has zero feature imports (pure shared).
 *   A shim at the old path re-exports TableQrPrintDialog from shared.
 *   The pos-internal importer (PosTablesFloorPlanDialog, relative
 *   './TableQrPrintDialog') keeps the old path via the shim; only
 *   StorefrontSettingsTab re-points to shared. The pos index is
 *   UNCHANGED (still re-exports TableQrPrintDialog from its own
 *   components path, i.e. the shim).
 * - frontend/src/features/pos/api/restaurant-advanced-fnb.api.ts (427L,
 *   sha256 cd0e380c…, imports ONLY http from '@/lib/http' — a pure api
 *   client) moves WHOLE via git mv to frontend/src/shared/api/
 *   restaurant-advanced-fnb.api.ts, byte-identical (F5h sales.api
 *   precedent). A shim at the old path re-exports
 *   restaurantAdvancedFnbApi + all 15 interfaces explicitly, mirroring
 *   the sales/products shim form. Every other importer keeps the old
 *   path and works unchanged via the shim (13 pos files incl.
 *   KitchenDailyPrepSheetModal, Pos86ItemsModal, PosVisualFloorCanvas
 *   type TableLayout, PosDriveThruModal type RestaurantDriveThruOrder,
 *   PosSmartUpsellModal type RestaurantUpsellRule, PosFloorZoneBar type
 *   RestaurantTableZone, pos/index.ts), so NO other edge's count moves;
 *   only TableBillModal re-points to shared.
 * The 3 storefront files re-point one line each to the shared homes —
 * same function object / same class / same call, call sites
 * byte-identical. Direct '@/shared/lib/', '@/shared/components/' and
 * '@/shared/api/' imports from features are established practice (F5f
 * receipt, F5h/F5i apis, F5j modal/utils, F5k bridge).
 * New shared hook (use-storefront-admin-settings-query.ts, 11L — well
 * under the cap; F5l-REPAIR moved it out of use-catalog-queries.ts:
 * the storefrontApi import in the startup-reachable catalog queries
 * dragged 14 files into the entry chunk — ci-full #323):
 * useStorefrontAdminSettingsQuery(options?: { enabled?: boolean }) —
 * the dialog's query carried VERBATIM; the hook imports storefrontApi
 * from '@/features/storefront/api/storefront.api'. The other three
 * users of the same queryKey (StorefrontPaymentGatewaysManager,
 * StorefrontSettingsTab, MerchantOnlineOrdersPage) keep their own
 * inline useQuery — out of scope (FIX SCOPE RULE: only the dialog's
 * query moves).
 *
 * Audits (both F5h lessons, done live before starting):
 * - Check scripts: git grep for each moved old path in frontend/
 *   scripts/ matches ONLY the feature-boundary baseline JSON (the 3
 *   strings, shrunk in-package). api-mutation-envelope-check.mjs
 *   hardcodes only 'src/features/purchases/api/purchases.api.ts' and
 *   'src/features/pos/api/pos.api.ts' (the sales entry already points
 *   at shared since F5h-REPAIR); restaurant-advanced-fnb.api.ts is NOT
 *   in the list.
 * - Mock audit: grep over ALL frontend specs for vi.mock / vi.spyOn of
 *   the moved modules' OLD import paths in EVERY form.
 *   restaurant-advanced-fnb.api: EIGHT specs mock the OLD path
 *   (PosManagerCompModal, PosTipPoolModal, PosVisualFloorCanvas,
 *   PosWorkspace.cold-entry, PosWorkspace.memo,
 *   useSelfOrderingKiosk.menu-scale, pos-table-transfer,
 *   KitchenDisplayPage). All components under test import the api from
 *   the OLD path directly, so the mocks still intercept the SHIM module
 *   after the move. The ONLY re-pointed importer is TableBillModal
 *   (storefront) — it has NO spec file. No exposure.
 *   PosSaleSuccessDialog.spec mocks the hardware-bridge-client OLD path
 *   (:13); the dialog re-points to shared, so the mock re-points too
 *   (done in-package, one line, same factory — the F5h-REPAIR-2
 *   precedent). No other spec mocks the dialog or the bridge path for
 *   this component. TableQrPrintDialog: NO spec mocks it; the dialog
 *   has NO spec file. storefront-pos-loader / pos-floor-state /
 *   pos.types / pos.persistence: NO spec mocks any of them. The
 *   floor-state spec and the success dialog spec move WITH their files
 *   (relative imports still resolve). Conclusion: F5l has NO
 *   stale-mock exposure beyond the one success-dialog mock re-pointed
 *   in-package (the F5h dialog-spec trap does not recur here —
 *   verified by grep, not assumed). Frontend vitest cannot run locally
 *   (OOM, CI-only) — any touched component spec's green is proven by
 *   CI, not locally; the mock-path alignment above is the local proof.
 *
 * Consequences, all re-pinned in this package:
 * - storefront -> pos: 5 -> 0 (edge gone); pos -> storefront: 12 -> 11
 *   (only the TableQrPrintDialog storefrontApi leg goes).
 * - Frontend edges 45 -> 44, statements 111 -> 105, pairs 1 -> 0
 *   (the LAST pair is gone). Backend pins unmoved (63 / 736, total
 *   738). FRONTEND_EDGE_FLOOR re-pinned deliberately 45 -> 44: the
 *   break drops edges below the old floor, so the floor itself must
 *   move — the floor check is NOT weakened or deleted, only re-pinned
 *   to the new live edge count.
 * - Feature-boundary baseline 60 -> 57 (exactly the 3 deep
 *   storefront->pos strings removed; the 2 index legs have NO baseline
 *   strings; the 6 pos->storefront strings stay, incl. the loader
 *   string). Import-layer baseline stays 152.
 * - Wiring: both critical lists carry 395 specs in identical order,
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
const SHARED = path.join(FRONTEND, 'src', 'shared');
const SHARED_LIB = path.join(SHARED, 'lib');
const SHARED_COMPONENTS = path.join(SHARED, 'components');
const SHARED_API = path.join(SHARED, 'api');
const SHARED_HOOKS = path.join(SHARED, 'hooks');
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
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const F5I_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5i-pos-settings.spec.ts');
const F5H_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-sales-envelope-check.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const F5K_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5k-pos-products.spec.ts');
const F5J_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-repair-expiry-spec-import.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const STOREFRONT_SETTINGS_TAB = path.join(FEATURES, 'storefront', 'components', 'StorefrontSettingsTab.tsx');
const TABLE_BILL_MODAL = path.join(FEATURES, 'storefront', 'components', 'TableBillModal.tsx');
const MERCHANT_SUCCESS_DIALOG = path.join(
  FEATURES,
  'storefront',
  'pages',
  'merchant-online-orders',
  'merchant-orders-pos-success-dialog.tsx',
);
const SHARED_LOADER = path.join(SHARED_LIB, 'storefront-pos-loader.ts');
const OLD_LOADER = path.join(FEATURES, 'storefront', 'lib', 'storefront-pos-loader.ts');
const SHARED_FLOOR_STATE = path.join(SHARED_LIB, 'pos-floor-state.ts');
const OLD_FLOOR_STATE = path.join(FEATURES, 'pos', 'lib', 'pos-floor-state.ts');
const SHARED_FLOOR_STATE_SPEC = path.join(SHARED_LIB, 'pos-floor-state.spec.ts');
const OLD_FLOOR_STATE_SPEC = path.join(FEATURES, 'pos', 'lib', 'pos-floor-state.spec.ts');
const SHARED_SUCCESS_DIALOG = path.join(SHARED_COMPONENTS, 'PosSaleSuccessDialog.tsx');
const OLD_SUCCESS_DIALOG = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosSaleSuccessDialog.tsx');
const SHARED_SUCCESS_DIALOG_SPEC = path.join(SHARED_COMPONENTS, 'PosSaleSuccessDialog.spec.tsx');
const OLD_SUCCESS_DIALOG_SPEC = path.join(
  FEATURES,
  'pos',
  'components',
  'pos-workspace',
  'PosSaleSuccessDialog.spec.tsx',
);
const SHARED_QR_DIALOG = path.join(SHARED_COMPONENTS, 'TableQrPrintDialog.tsx');
const OLD_QR_DIALOG = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'TableQrPrintDialog.tsx');
const SHARED_FNB_API = path.join(SHARED_API, 'restaurant-advanced-fnb.api.ts');
const OLD_FNB_API = path.join(FEATURES, 'pos', 'api', 'restaurant-advanced-fnb.api.ts');
const SHARED_STOREFRONT_ADMIN_SETTINGS_QUERY = path.join(SHARED_HOOKS, 'use-storefront-admin-settings-query.ts');
const POS_INDEX = path.join(FEATURES, 'pos', 'index.ts');
const STOREFRONT_INDEX = path.join(FEATURES, 'storefront', 'index.ts');
const POS_ONLINE_ORDERS_MODAL = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosOnlineOrdersModal.tsx');
const POS_WORKSPACE_HEADER = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosWorkspaceHeader.tsx');
const POS_ASYNC_ACTIONS = path.join(
  FEATURES,
  'pos',
  'hooks',
  'pos-workspace-actions',
  'createPosWorkspaceAsyncActions.ts',
);
const POS_FLOOR_PLAN_DIALOG = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosTablesFloorPlanDialog.tsx');
const POS_CONFIRM_DIALOGS = path.join(
  FEATURES,
  'pos',
  'components',
  'pos-workspace',
  'pos-workspace',
  'PosWorkspaceConfirmDialogsSection.tsx',
);

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The storefront -> pos direction is gone; the pos -> storefront
  // direction stays (11 statements). The five seams moved to shared;
  // the 3 storefront files re-point to the shared homes; the shims keep
  // every other importer working; both feature indices keep their public
  // surfaces unchanged.
  const storefrontFiles: string[] = [];
  walkTs(path.join(FEATURES, 'storefront'), storefrontFiles);
  const stillPos: string[] = [];
  for (const file of storefrontFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes("from '@/features/pos") || src.includes("import('@/features/pos")) {
      stillPos.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillPos, [], "no storefront file may still import from '@/features/pos'");
  const settingsTab = fs.readFileSync(STOREFRONT_SETTINGS_TAB, 'utf8');
  assert.ok(
    settingsTab.includes("import { TableQrPrintDialog } from '@/shared/components/TableQrPrintDialog';"),
    'StorefrontSettingsTab must import TableQrPrintDialog from the shared home (its new home)',
  );
  assert.ok(
    settingsTab.includes('open={isQrPrintOpen}'),
    'StorefrontSettingsTab must keep its TableQrPrintDialog open prop byte-identical',
  );
  assert.ok(
    settingsTab.includes('slug={storeSlug}'),
    'StorefrontSettingsTab must keep its TableQrPrintDialog slug prop byte-identical',
  );
  const tableBillModal = fs.readFileSync(TABLE_BILL_MODAL, 'utf8');
  assert.ok(
    tableBillModal.includes("import { restaurantAdvancedFnbApi } from '@/shared/api/restaurant-advanced-fnb.api';"),
    'TableBillModal must import restaurantAdvancedFnbApi from the shared api (its new home)',
  );
  assert.ok(
    tableBillModal.includes('restaurantAdvancedFnbApi.recordTableRating({'),
    'TableBillModal must keep its recordTableRating calls byte-identical',
  );
  const merchantDialog = fs.readFileSync(MERCHANT_SUCCESS_DIALOG, 'utf8');
  assert.ok(
    merchantDialog.includes("import { PosSaleSuccessDialog } from '@/shared/components/PosSaleSuccessDialog';"),
    'MerchantOrdersPosSuccessDialog must import PosSaleSuccessDialog from the shared home (its new home)',
  );
  assert.ok(
    merchantDialog.includes('<PosSaleSuccessDialog'),
    'MerchantOrdersPosSuccessDialog must keep rendering PosSaleSuccessDialog',
  );
  const sharedLoader = fs.readFileSync(SHARED_LOADER, 'utf8');
  assert.ok(
    sharedLoader.includes(
      'export async function loadOnlineOrderIntoPosCart(orderId: number, navigate?: (to: string) => void) {',
    ),
    'the shared loader must define loadOnlineOrderIntoPosCart',
  );
  assert.ok(
    sharedLoader.includes("import { storefrontApi } from '@/features/storefront/api/storefront.api';"),
    'the shared loader must call the storefront api client from its feature home (bridge call)',
  );
  assert.ok(
    sharedLoader.includes(
      "import { persistDraftSnapshot, loadPosWorkspaceStorage } from '@/features/pos/lib/pos.persistence';",
    ),
    'the shared loader must keep its pos.persistence bridge imports byte-identical',
  );
  assert.ok(
    sharedLoader.includes("import type { PosItem } from '@/features/pos/types/pos.types';"),
    'the shared loader must keep its pos.types bridge import byte-identical',
  );
  assert.ok(
    sharedLoader.includes('const data = await storefrontApi.preparePos(orderId);'),
    'the shared loader must keep its preparePos call byte-identical',
  );
  assert.ok(
    sharedLoader.includes('const posItems: PosItem[] = data.items.map((it) => ({'),
    'the shared loader must keep its PosItem mapping byte-identical',
  );
  assert.ok(
    sharedLoader.includes('persistDraftSnapshot({'),
    'the shared loader must keep its persistDraftSnapshot call byte-identical',
  );
  const oldLoader = fs.readFileSync(OLD_LOADER, 'utf8');
  assert.ok(
    oldLoader.includes("from '@/shared/lib/storefront-pos-loader';"),
    'the loader shim must re-export from the shared home',
  );
  assert.ok(
    oldLoader.includes('loadOnlineOrderIntoPosCart'),
    'the loader shim must re-export loadOnlineOrderIntoPosCart',
  );
  const sharedFloorState = fs.readFileSync(SHARED_FLOOR_STATE, 'utf8');
  assert.ok(
    sharedFloorState.includes('export function buildFloorState(input: BuildFloorStateInput): FloorState {'),
    'the shared floor-state must define buildFloorState',
  );
  assert.ok(
    sharedFloorState.includes(
      'export function buildQrRange(from: number, to: number, configuredCount: number): QrRange {',
    ),
    'the shared floor-state must define buildQrRange',
  );
  assert.ok(
    sharedFloorState.includes('export function isDefaultStorefrontSlug(slug: string | undefined | null): boolean {'),
    'the shared floor-state must define isDefaultStorefrontSlug',
  );
  assert.ok(
    !sharedFloorState.includes('@/features/'),
    'the shared floor-state must have zero feature imports (pure shared util)',
  );
  assert.ok(fs.existsSync(SHARED_FLOOR_STATE_SPEC), 'the floor-state spec must have moved with its file to shared/lib');
  assert.ok(!fs.existsSync(OLD_FLOOR_STATE_SPEC), 'the old floor-state spec path must be gone (moved, not copied)');
  const sharedFloorStateSpec = fs.readFileSync(SHARED_FLOOR_STATE_SPEC, 'utf8');
  assert.ok(
    sharedFloorStateSpec.includes("from './pos-floor-state';"),
    'the moved floor-state spec must keep its relative import (it moved with its file)',
  );
  const oldFloorState = fs.readFileSync(OLD_FLOOR_STATE, 'utf8');
  assert.ok(
    oldFloorState.includes("from '@/shared/lib/pos-floor-state';"),
    'the floor-state shim must re-export from the shared home',
  );
  assert.ok(oldFloorState.includes('buildFloorState'), 'the floor-state shim must re-export buildFloorState');
  assert.ok(oldFloorState.includes('buildQrRange'), 'the floor-state shim must re-export buildQrRange');
  assert.ok(
    oldFloorState.includes('isDefaultStorefrontSlug'),
    'the floor-state shim must re-export isDefaultStorefrontSlug',
  );
  assert.ok(oldFloorState.includes('FloorTableState'), 'the floor-state shim must re-export FloorTableState');
  const sharedSuccessDialog = fs.readFileSync(SHARED_SUCCESS_DIALOG, 'utf8');
  assert.ok(
    sharedSuccessDialog.includes('export function PosSaleSuccessDialog({'),
    'the shared success dialog must define PosSaleSuccessDialog',
  );
  assert.ok(
    sharedSuccessDialog.includes("import { HardwareBridgeClient } from '@/shared/lib/hardware-bridge-client';"),
    'the shared success dialog must import HardwareBridgeClient from the shared home (its F5k home)',
  );
  assert.ok(
    !sharedSuccessDialog.includes('@/features/'),
    'the shared success dialog must have zero feature imports (pure shared util)',
  );
  assert.ok(
    fs.existsSync(SHARED_SUCCESS_DIALOG_SPEC),
    'the success dialog spec must have moved with its file to shared/components',
  );
  assert.ok(
    !fs.existsSync(OLD_SUCCESS_DIALOG_SPEC),
    'the old success dialog spec path must be gone (moved, not copied)',
  );
  const sharedSuccessDialogSpec = fs.readFileSync(SHARED_SUCCESS_DIALOG_SPEC, 'utf8');
  assert.ok(
    sharedSuccessDialogSpec.includes("import { PosSaleSuccessDialog } from './PosSaleSuccessDialog';"),
    'the moved success dialog spec must keep its relative import (it moved with its file)',
  );
  assert.ok(
    sharedSuccessDialogSpec.includes("vi.mock('@/shared/lib/hardware-bridge-client', () => ({"),
    'the moved success dialog spec mock must re-point to the shared bridge client (same factory, else it stops intercepting)',
  );
  assert.ok(
    sharedSuccessDialogSpec.includes('mockIsAvailable'),
    'the moved success dialog spec mock must keep its mockIsAvailable factory byte-identical',
  );
  assert.ok(
    sharedSuccessDialogSpec.includes('mockKickDrawer'),
    'the moved success dialog spec mock must keep its mockKickDrawer factory byte-identical',
  );
  const oldSuccessDialog = fs.readFileSync(OLD_SUCCESS_DIALOG, 'utf8');
  assert.ok(
    oldSuccessDialog.includes("from '@/shared/components/PosSaleSuccessDialog';"),
    'the success dialog shim must re-export from the shared home',
  );
  assert.ok(
    oldSuccessDialog.includes('PosSaleSuccessDialog'),
    'the success dialog shim must re-export PosSaleSuccessDialog',
  );
  const sharedQrDialog = fs.readFileSync(SHARED_QR_DIALOG, 'utf8');
  assert.ok(
    sharedQrDialog.includes('export function TableQrPrintDialog({'),
    'the shared QR dialog must define TableQrPrintDialog',
  );
  assert.ok(
    sharedQrDialog.includes("import { buildQrRange, isDefaultStorefrontSlug } from '@/shared/lib/pos-floor-state';"),
    'the shared QR dialog must import the floor-state helpers from the shared home',
  );
  assert.ok(
    sharedQrDialog.includes('useStorefrontAdminSettingsQuery'),
    'the shared QR dialog must use the new shared storefront-settings hook',
  );
  assert.ok(
    sharedQrDialog.includes('useStorefrontAdminSettingsQuery({ enabled: open })'),
    'the shared QR dialog must pass its open flag to the hook (same enabled as the old useQuery)',
  );
  assert.ok(
    sharedQrDialog.includes('storefrontSettings?.slug'),
    'the shared QR dialog must keep its storefrontSettings slug use byte-identical',
  );
  assert.ok(
    sharedQrDialog.includes('storefrontSettings?.title'),
    'the shared QR dialog must keep its storefrontSettings title use byte-identical',
  );
  assert.ok(
    !sharedQrDialog.includes('@/features/'),
    'the shared QR dialog must have zero feature imports (pure shared util)',
  );
  assert.ok(
    !sharedQrDialog.includes("from '@tanstack/react-query'"),
    'the shared QR dialog must not keep the now-unused useQuery import',
  );
  const oldQrDialog = fs.readFileSync(OLD_QR_DIALOG, 'utf8');
  assert.ok(
    oldQrDialog.includes("from '@/shared/components/TableQrPrintDialog';"),
    'the QR dialog shim must re-export from the shared home',
  );
  assert.ok(oldQrDialog.includes('TableQrPrintDialog'), 'the QR dialog shim must re-export TableQrPrintDialog');
  const sharedFnbApi = fs.readFileSync(SHARED_FNB_API, 'utf8');
  assert.ok(
    sharedFnbApi.includes('export const restaurantAdvancedFnbApi = {'),
    'the shared fnb api must define restaurantAdvancedFnbApi',
  );
  assert.ok(
    sharedFnbApi.includes('export interface Restaurant86Item {'),
    'the shared fnb api must define Restaurant86Item',
  );
  assert.ok(
    sharedFnbApi.includes('export interface RestaurantTableZone {'),
    'the shared fnb api must define RestaurantTableZone',
  );
  assert.ok(
    sharedFnbApi.includes('export interface RestaurantDriveThruOrder {'),
    'the shared fnb api must define RestaurantDriveThruOrder',
  );
  assert.ok(
    sharedFnbApi.includes('export interface RestaurantUpsellRule {'),
    'the shared fnb api must define RestaurantUpsellRule',
  );
  assert.ok(sharedFnbApi.includes('export interface TableLayout {'), 'the shared fnb api must define TableLayout');
  assert.ok(
    sharedFnbApi.includes("import { http } from '@/lib/http';"),
    'the shared fnb api must keep its http import byte-identical',
  );
  assert.ok(
    !/^import .*@\/features\//m.test(sharedFnbApi),
    'the shared fnb api must have zero feature imports (pure api client — its one @/features/ mention is a comment, not an import)',
  );
  const oldFnbApi = fs.readFileSync(OLD_FNB_API, 'utf8');
  assert.ok(
    oldFnbApi.includes("from '@/shared/api/restaurant-advanced-fnb.api';"),
    'the fnb api shim must re-export from the shared home',
  );
  assert.ok(oldFnbApi.includes('restaurantAdvancedFnbApi'), 'the fnb api shim must re-export restaurantAdvancedFnbApi');
  assert.ok(oldFnbApi.includes('Restaurant86Item'), 'the fnb api shim must re-export Restaurant86Item');
  assert.ok(oldFnbApi.includes('RestaurantPrepSheetItem'), 'the fnb api shim must re-export RestaurantPrepSheetItem');
  assert.ok(oldFnbApi.includes('RestaurantTableZone'), 'the fnb api shim must re-export RestaurantTableZone');
  assert.ok(oldFnbApi.includes('RestaurantDriveThruOrder'), 'the fnb api shim must re-export RestaurantDriveThruOrder');
  assert.ok(oldFnbApi.includes('RestaurantUpsellRule'), 'the fnb api shim must re-export RestaurantUpsellRule');
  assert.ok(oldFnbApi.includes('TableLayout'), 'the fnb api shim must re-export TableLayout');
  // F5l-REPAIR: the hook moved OUT of use-catalog-queries.ts into its
  // own file (the storefrontApi import in the startup-reachable catalog
  // queries dragged 14 files into the entry chunk — ci-full #323).
  // Same strings, new home (F3-spec-flip precedent).
  const storefrontAdminSettingsQuery = fs.readFileSync(SHARED_STOREFRONT_ADMIN_SETTINGS_QUERY, 'utf8');
  assert.ok(
    storefrontAdminSettingsQuery.includes(
      'export function useStorefrontAdminSettingsQuery(options?: { enabled?: boolean }) {',
    ),
    'the new hook file must define useStorefrontAdminSettingsQuery with the enabled option',
  );
  assert.ok(
    storefrontAdminSettingsQuery.includes("queryKey: ['storefront-admin-settings'],"),
    'the moved hook must carry the dialog queryKey verbatim',
  );
  assert.ok(
    storefrontAdminSettingsQuery.includes('queryFn: storefrontApi.getSettings,'),
    'the moved hook must carry the dialog queryFn verbatim',
  );
  assert.ok(
    storefrontAdminSettingsQuery.includes("import { storefrontApi } from '@/features/storefront/api/storefront.api';"),
    'the moved hook must import storefrontApi from its feature home (the file’s established style)',
  );
  const posIndex = fs.readFileSync(POS_INDEX, 'utf8');
  assert.ok(
    posIndex.includes(
      "export { TableQrPrintDialog } from '@/features/pos/components/pos-workspace/TableQrPrintDialog';",
    ),
    'the pos index must still re-export TableQrPrintDialog from its own components path (public surface unchanged)',
  );
  assert.ok(
    posIndex.includes("export { restaurantAdvancedFnbApi } from '@/features/pos/api/restaurant-advanced-fnb.api';"),
    'the pos index must still re-export restaurantAdvancedFnbApi from its own api path (public surface unchanged)',
  );
  const storefrontIndex = fs.readFileSync(STOREFRONT_INDEX, 'utf8');
  assert.ok(
    storefrontIndex.includes("export { loadOnlineOrderIntoPosCart } from './lib/storefront-pos-loader';"),
    'the storefront index must still re-export loadOnlineOrderIntoPosCart from its own lib file (public surface unchanged)',
  );
  const posOnlineOrdersModal = fs.readFileSync(POS_ONLINE_ORDERS_MODAL, 'utf8');
  assert.ok(
    posOnlineOrdersModal.includes("import { storefrontApi } from '@/features/storefront/api/storefront.api';"),
    'PosOnlineOrdersModal must keep its storefrontApi import (the surviving direction)',
  );
  assert.ok(
    posOnlineOrdersModal.includes(
      "import { loadOnlineOrderIntoPosCart } from '@/features/storefront/lib/storefront-pos-loader';",
    ),
    'PosOnlineOrdersModal must keep its loader import via the shim (the surviving direction)',
  );
  assert.ok(
    posOnlineOrdersModal.includes(
      "import { ConvertDeliveryModal } from '@/features/storefront/components/ConvertDeliveryModal';",
    ),
    'PosOnlineOrdersModal must keep its ConvertDeliveryModal import (the surviving direction)',
  );
  const posWorkspaceHeader = fs.readFileSync(POS_WORKSPACE_HEADER, 'utf8');
  assert.ok(
    posWorkspaceHeader.includes("import { storefrontApi } from '@/features/storefront/api/storefront.api';"),
    'PosWorkspaceHeader must keep its storefrontApi import (the surviving direction)',
  );
  const posAsyncActions = fs.readFileSync(POS_ASYNC_ACTIONS, 'utf8');
  assert.ok(
    posAsyncActions.includes("import { storefrontApi } from '@/features/storefront/api/storefront.api';"),
    'createPosWorkspaceAsyncActions must keep its storefrontApi import (the surviving direction)',
  );
  const posFloorPlanDialog = fs.readFileSync(POS_FLOOR_PLAN_DIALOG, 'utf8');
  assert.ok(
    posFloorPlanDialog.includes("import { TableQrPrintDialog } from './TableQrPrintDialog';"),
    'PosTablesFloorPlanDialog must keep its TableQrPrintDialog import via the shim (the surviving direction)',
  );
  const posConfirmDialogs = fs.readFileSync(POS_CONFIRM_DIALOGS, 'utf8');
  assert.ok(
    posConfirmDialogs.includes(
      "import { PosSaleSuccessDialog } from '@/features/pos/components/pos-workspace/PosSaleSuccessDialog';",
    ),
    'PosWorkspaceConfirmDialogsSection must keep its PosSaleSuccessDialog import via the shim (the surviving direction)',
  );

  // 2. The module-boundary pins move: frontend edges 45 -> 44,
  // statements 111 -> 105, pairs 1 -> 0 (the LAST pair is gone);
  // the backend pins do not move. FRONTEND_EDGE_FLOOR re-pins
  // deliberately 45 -> 44: the break drops edges below the old floor,
  // so the floor itself must move — the floor check is NOT weakened
  // or deleted, only re-pinned to the new live edge count. The
  // feature-boundary baseline shrinks 60 -> 57 (exactly the 3 deep
  // storefront->pos strings removed); the import-layer baseline stays
  // 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5l',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5l',
  );
  assert.ok(
    boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
    'module-boundary must re-pin the frontend edge floor to 44 after F5l (the break drops edges below the old floor 45)',
  );
  assert.ok(
    !boundary.includes("'storefront->pos': 5,"),
    'the storefront->pos frontend edge (pinned at 5) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'pos->storefront': 11,"),
    'the pos->storefront edge must stay pinned at 11 (the surviving direction, minus the QR dialog leg)',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
    'the frontend bidirectional pair list must be empty after F5l (the last pair is gone)',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must shrink to exactly 57 after F5l');
  assert.ok(
    !featureBaseline.includes('storefront/lib/storefront-pos-loader.ts imports @/features/pos/lib/pos.persistence'),
    'feature-boundary baseline must not contain the removed loader pos.persistence string',
  );
  assert.ok(
    !featureBaseline.includes('storefront/lib/storefront-pos-loader.ts imports @/features/pos/types/pos.types'),
    'feature-boundary baseline must not contain the removed loader pos.types string',
  );
  assert.ok(
    !featureBaseline.includes(
      'storefront/pages/merchant-online-orders/merchant-orders-pos-success-dialog.tsx imports @/features/pos/components/pos-workspace/PosSaleSuccessDialog',
    ),
    'feature-boundary baseline must not contain the removed merchant success dialog string',
  );
  assert.ok(
    featureBaseline.includes(
      'pos/components/pos-workspace/PosOnlineOrdersModal.tsx imports @/features/storefront/lib/storefront-pos-loader',
    ),
    'feature-boundary baseline must keep the surviving PosOnlineOrdersModal loader string',
  );
  assert.ok(
    featureBaseline.includes(
      'pos/components/pos-workspace/PosWorkspaceHeader.tsx imports @/features/storefront/api/storefront.api',
    ),
    'feature-boundary baseline must keep the surviving PosWorkspaceHeader storefrontApi string',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5l');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5L-POS-STOREFRONT-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5l INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-MARITIME-AGENT-SETTLEMENT-IDEMPOTENCY/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5l INV exactly once');

  // 4. Wiring: both critical lists carry 395 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 408);
  assert.equal(chain.length, 408);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 395 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s2-maritime-settlement-idempotency.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s2-maritime-settlement-idempotency.spec.ts');
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
    ['F5h', F5H_SPEC],
    ['F5i', F5I_SPEC],
    ['F5h-REPAIR', F5H_REPAIR_SPEC],
    ['F5j', F5J_SPEC],
    ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
    ['F5k', F5K_SPEC],
    ['F5j-REPAIR', F5J_REPAIR_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 408);') && src.includes('assert.equal(chain.length, 408);'),
      `${label} spec wiring must re-pin to 395`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s2-maritime-settlement-idempotency.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5l spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5j-REPAIR spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~75 files asserting the count — the #264-fix /
  // D12 lesson. The F5k filename, the count literals, the FE pin
  // literals and the baseline literals are built by concatenation so
  // this block's own source never contains the patterns it scans for.
  // The scan covers all three variable forms: specs, chain, and
  // list.length; the last-entry scan covers BOTH forms (specs[...] and
  // chain[...] — the F5j lesson: the chain form was missed once); the
  // baseline check is line-scoped, F5e lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const prevName = 'phase1-f5j-repair-' + 'expiry-spec-import.spec.ts';
  const prevInv = 'INV-PHASE1-F5J-REPAIR' + '-EXPIRY-SPEC-IMPORT';
  const staleSpecs = 'specs.length, 39' + '4';
  const staleChain = 'chain.length, 39' + '4';
  const staleList = 'list.length, 39' + '4';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 11" + "1;'";
  const staleFeTotalAfter = "'module-boundary must pin the frontend total 11" + '1 after ';
  const staleFeTotalStill = "'module-boundary must still pin the frontend total 11" + "1'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 4" + "5,'";
  const staleFeEdgesAfter = "'module-boundary must pin 4" + '5 frontend edges after ';
  const staleFeEdgesStill = "'module-boundary must still pin 4" + "5 frontend edges'";
  const staleBaselineA = 'baseline.length, 6' + '0';
  const staleBaselineB = 'featureBaseline.length, 6' + '0';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
    if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
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
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (394)');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5j-REPAIR spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (F5j-REPAIR)');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so F5l re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR specs'
  // guard assertions to the F5l INV; their invariants-file assertions
  // still pin their own id (each line stays in
  // ARCHITECTURE_INVARIANTS.md exactly once).
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
    ['F5h', F5H_SPEC],
    ['F5i', F5I_SPEC],
    ['F5h-REPAIR', F5H_REPAIR_SPEC],
    ['F5j', F5J_SPEC],
    ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
    ['F5k', F5K_SPEC],
    ['F5j-REPAIR', F5J_REPAIR_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-MARITIME-AGENT-SETTLEMENT-IDEMPOTENCY/g)'),
      `${label} spec guard assertion must re-pin to the F5l INV`,
    );
  }

  console.log(
    'phase1 F5l pos|storefront checks passed (storefront->pos gone, pairs 1->0, edges 44 / statements 105, 395 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
