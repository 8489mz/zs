import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5i — break the pos|settings frontend circular pair
 * (INV-PHASE1-F5I-POS-SETTINGS-DECOUPLED).
 *
 * Grounding §7 row 9 / §8 F5i (phase1-f0-grounding.md), re-derived live
 * at 47eba1b6a: pos|settings, module-boundary counts 3/3; 1 deep leg.
 * - pos -> settings (3, all three import the SAME seam, settingsApi):
 *   pos/components/pos-workspace/PosTablesFloorPlanDialog.tsx:8
 *   imports settingsApi from '@/features/settings/api/settings.api'
 *   (DEEP leg) and calls settingsApi.update({ restaurantTablesCount })
 *   (:492); pos/hooks/usePosUiCustomization.ts:3 imports settingsApi
 *   from '@/features/settings' (public index) and calls
 *   settingsApi.update(payload) (:192); pos/hooks/useWaiterStation.ts:4
 *   imports settingsApi from '@/features/settings' (public index) and
 *   calls settingsApi.settings() in a useQuery queryFn (:41).
 * - settings -> pos (3, STAYS): settings/components/forms/tabs/
 *   PrintingSettingsTab.tsx:9 imports HardwareBridgeClient from
 *   '@/features/pos' (listPrinters :154/:167);
 *   settings/components/forms/tabs/sales-inventory/
 *   use-sales-inventory-terminals.ts:7 imports posApi +
 *   HardwareBridgeClient from '@/features/pos'
 *   (isAvailable :155, testTerminal :160, testTerminalConnection
 *   :196); settings/components/workspace-sections/
 *   SettingsDemoDataWizardSection.tsx:6 imports clearCatalogStorage +
 *   clearPosWorkspaceStorage from '@/features/pos' (:95/:96).
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other pos file imports from settings — no spec
 * file either — no other settings file imports from pos, no relative
 * cross imports, no other dynamic imports).
 * No earlier spec pins the pos|settings pair as staying (unlike F5f /
 * F5h, no flip is needed).
 *
 * The break: the pos -> settings direction goes to 0 by moving the
 * settingsApi client WHOLE to shared (F5f/F5h precedent).
 * - frontend/src/features/settings/api/settings.api.ts (317L) moves via
 *   git mv to frontend/src/shared/api/settings.api.ts, byte-identical.
 *   Its own imports are all non-feature (@/lib/http,
 *   @/lib/api/contracts, @/types/domain, @/lib/query-string), so the
 *   moved file has zero feature dependencies and is a pure shared util.
 * - A shim at the old path re-exports settingsApi + the eleven types
 *   (ManagedUserRecord, ManagedUsersSummary, BulkDisableUsersResponse,
 *   ManagedUsersQueryParams, BackupSnapshotRecord,
 *   BackupAutomationConfig, TenantImportReport, TenantPickOption,
 *   BackupConfigResponse, PlanLimitInfo, OfflineRelease) from
 *   '@/shared/api/settings.api' — mirrors the sales.api shim exactly.
 *   Every other importer (settings-internal files x~30, activation,
 *   apps-store, contracting, maritime, delivery-reps, audit, products,
 *   shared x5, the settings index, the two relative importers
 *   TenantSubscriptionPage + SettingsBackupRestore.contract.test) keeps
 *   working unchanged via the shim, so NO other edge's count moves.
 * - The 3 pos files re-point one line each to
 *   '@/shared/api/settings.api' — same function object, call sites
 *   byte-identical. Direct '@/shared/api/' imports from features are
 *   established practice (delivery-reps hooks/pages, F5g modal, F5h).
 * - The settings index is UNCHANGED (still re-exports settingsApi from
 *   its own api file = the shim; public surface unchanged).
 * Why this direction, not settings -> pos: the three pos legs share ONE
 * seam (the settingsApi client); the settings -> pos direction has
 * three heterogeneous seams (a hardware bridge client, a terminal
 * tester + bridge check, storage clearers) — breaking it would be
 * three moves. The settings -> pos direction stays — breaking ONE
 * direction is enough for the pair to be gone.
 *
 * Consequences, all re-pinned in this package:
 * - pos -> settings: 3 -> 0; settings -> pos stays 3.
 * - Frontend edges 48 -> 47, statements 125 -> 122, pairs 4 -> 3
 *   ('pos|settings' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline 65 -> 64 (exactly the one deep
 *   PosTablesFloorPlanDialog string removed; the other four
 *   settings.api deep strings stay — activation, apps-store,
 *   contracting, maritime — out of scope, still importing via the
 *   shim). Import-layer baseline stays 152.
 * - Wiring: both critical lists carry 389 specs in identical order,
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
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const TABLES_DIALOG = path.join(FEATURES, 'pos', 'components', 'pos-workspace', 'PosTablesFloorPlanDialog.tsx');
const UI_CUSTOM = path.join(FEATURES, 'pos', 'hooks', 'usePosUiCustomization.ts');
const WAITER_STATION = path.join(FEATURES, 'pos', 'hooks', 'useWaiterStation.ts');
const SHARED_SETTINGS_API = path.join(SHARED_API, 'settings.api.ts');
const SETTINGS_API_SHIM = path.join(FEATURES, 'settings', 'api', 'settings.api.ts');
const SETTINGS_INDEX = path.join(FEATURES, 'settings', 'index.ts');
const PRINTING_TAB = path.join(FEATURES, 'settings', 'components', 'forms', 'tabs', 'PrintingSettingsTab.tsx');
const TERMINALS_HOOK = path.join(
  FEATURES,
  'settings',
  'components',
  'forms',
  'tabs',
  'sales-inventory',
  'use-sales-inventory-terminals.ts',
);
const DEMO_WIZARD = path.join(
  FEATURES,
  'settings',
  'components',
  'workspace-sections',
  'SettingsDemoDataWizardSection.tsx',
);

const SETTINGS_API_TYPES = [
  'ManagedUserRecord',
  'ManagedUsersSummary',
  'BulkDisableUsersResponse',
  'ManagedUsersQueryParams',
  'BackupSnapshotRecord',
  'BackupAutomationConfig',
  'TenantImportReport',
  'TenantPickOption',
  'BackupConfigResponse',
  'PlanLimitInfo',
  'OfflineRelease',
];

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The pos -> settings direction is gone; the settings -> pos
  // direction stays. The settingsApi client moved whole to shared; the
  // 3 pos files re-point to the shared home; the shim keeps every other
  // importer working; the settings index surface is unchanged.
  const posFiles: string[] = [];
  walkTs(path.join(FEATURES, 'pos'), posFiles);
  const stillSettings: string[] = [];
  for (const file of posFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes("from '@/features/settings") || src.includes("import('@/features/settings")) {
      stillSettings.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillSettings, [], "no pos file may still import from '@/features/settings'");
  const tablesDialog = fs.readFileSync(TABLES_DIALOG, 'utf8');
  assert.ok(
    tablesDialog.includes("import { settingsApi } from '@/shared/api/settings.api';"),
    'PosTablesFloorPlanDialog must import settingsApi from the shared api client (its new home)',
  );
  assert.ok(
    tablesDialog.includes('await settingsApi.update({ restaurantTablesCount: count });'),
    'PosTablesFloorPlanDialog must keep its tables-count update call byte-identical',
  );
  const uiCustom = fs.readFileSync(UI_CUSTOM, 'utf8');
  assert.ok(
    uiCustom.includes("import { settingsApi } from '@/shared/api/settings.api';"),
    'usePosUiCustomization must import settingsApi from the shared api client (its new home)',
  );
  assert.ok(
    uiCustom.includes('await settingsApi.update(payload);'),
    'usePosUiCustomization must keep its payload update call byte-identical',
  );
  const waiterStation = fs.readFileSync(WAITER_STATION, 'utf8');
  assert.ok(
    waiterStation.includes("import { settingsApi } from '@/shared/api/settings.api';"),
    'useWaiterStation must import settingsApi from the shared api client (its new home)',
  );
  assert.ok(
    waiterStation.includes("queryKey: ['waiter-settings'],"),
    'useWaiterStation must keep its waiter-settings queryKey byte-identical',
  );
  assert.ok(
    waiterStation.includes('queryFn: () => settingsApi.settings(),'),
    'useWaiterStation must keep its settings() queryFn byte-identical',
  );
  const sharedApi = fs.readFileSync(SHARED_SETTINGS_API, 'utf8');
  assert.ok(sharedApi.includes('export const settingsApi = {'), 'the shared settings.api must define settingsApi');
  assert.ok(
    sharedApi.includes('settings: async () => unwrapByKey<AppSettings>'),
    'the shared settings.api must define the settings() reader',
  );
  assert.ok(
    sharedApi.includes('update: async (payload: unknown) => {'),
    'the shared settings.api must define the update() writer',
  );
  for (const typeName of SETTINGS_API_TYPES) {
    assert.ok(sharedApi.includes(`export interface ${typeName} {`), `the shared settings.api must define ${typeName}`);
  }
  assert.ok(
    !sharedApi.includes('@/features/'),
    'the shared settings.api must have zero feature imports (pure shared util)',
  );
  const shim = fs.readFileSync(SETTINGS_API_SHIM, 'utf8');
  assert.ok(
    shim.includes("from '@/shared/api/settings.api';"),
    'the settings api shim must re-export from the shared home',
  );
  assert.ok(shim.includes('settingsApi'), 'the settings api shim must re-export settingsApi');
  for (const typeName of SETTINGS_API_TYPES) {
    assert.ok(shim.includes(typeName), `the settings api shim must re-export ${typeName}`);
  }
  const settingsIndex = fs.readFileSync(SETTINGS_INDEX, 'utf8');
  assert.ok(
    settingsIndex.includes("export { settingsApi } from '@/features/settings/api/settings.api';"),
    'the settings index must still re-export settingsApi from its own api file (public surface unchanged)',
  );
  assert.ok(
    settingsIndex.includes("export { SettingsPage } from '@/features/settings/pages/SettingsPage';"),
    'the settings index must still re-export SettingsPage (public surface unchanged)',
  );
  assert.ok(
    settingsIndex.includes("export { settingsRouteModule } from '@/features/settings/routes';"),
    'the settings index must still re-export settingsRouteModule (public surface unchanged)',
  );
  const printingTab = fs.readFileSync(PRINTING_TAB, 'utf8');
  assert.ok(
    printingTab.includes("import { HardwareBridgeClient } from '@/features/pos';"),
    'PrintingSettingsTab must keep its HardwareBridgeClient import (the surviving direction)',
  );
  assert.ok(
    printingTab.includes('HardwareBridgeClient.listPrinters()'),
    'PrintingSettingsTab must keep its listPrinters call byte-identical',
  );
  const terminalsHook = fs.readFileSync(TERMINALS_HOOK, 'utf8');
  assert.ok(
    terminalsHook.includes("import { posApi, HardwareBridgeClient } from '@/features/pos';"),
    'use-sales-inventory-terminals must keep its posApi + HardwareBridgeClient import (the surviving direction)',
  );
  assert.ok(
    terminalsHook.includes('HardwareBridgeClient.isAvailable()'),
    'use-sales-inventory-terminals must keep its isAvailable call byte-identical',
  );
  assert.ok(
    terminalsHook.includes('posApi.testTerminalConnection({'),
    'use-sales-inventory-terminals must keep its testTerminalConnection call byte-identical',
  );
  const demoWizard = fs.readFileSync(DEMO_WIZARD, 'utf8');
  assert.ok(
    demoWizard.includes("import { clearCatalogStorage, clearPosWorkspaceStorage } from '@/features/pos';"),
    'SettingsDemoDataWizardSection must keep its storage-clearer import (the surviving direction)',
  );
  assert.ok(
    demoWizard.includes('clearPosWorkspaceStorage();'),
    'SettingsDemoDataWizardSection must keep its clearPosWorkspaceStorage call byte-identical',
  );
  assert.ok(
    demoWizard.includes('void clearCatalogStorage();'),
    'SettingsDemoDataWizardSection must keep its clearCatalogStorage call byte-identical',
  );

  // 2. The module-boundary pins move: frontend edges 48 -> 47,
  // statements 125 -> 122, pairs 4 -> 3 ('pos|settings' gone);
  // the backend pins do not move. The feature-boundary baseline
  // shrinks 65 -> 64 (exactly the one deep PosTablesFloorPlanDialog
  // string removed); the import-layer baseline stays 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5i',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5i',
  );
  assert.ok(
    !boundary.includes("'pos->settings': 3,"),
    'the pos->settings frontend edge (pinned at 3) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'settings->pos': 3,"),
    'the settings->pos edge must stay pinned at 3 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'pos|settings'"), 'the pos|settings pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must shrink to exactly 57 after F5i');
  assert.ok(
    !featureBaseline.includes(
      'pos/components/pos-workspace/PosTablesFloorPlanDialog.tsx imports @/features/settings/api/settings.api',
    ),
    'feature-boundary baseline must not contain the removed PosTablesFloorPlanDialog string',
  );
  assert.ok(
    featureBaseline.includes('activation/pages/SaaSOnboardingPage.tsx imports @/features/settings/api/settings.api'),
    'feature-boundary baseline must keep the out-of-scope SaaSOnboardingPage string',
  );
  assert.ok(
    featureBaseline.includes('apps-store/pages/AppsStorePage.tsx imports @/features/settings/api/settings.api'),
    'feature-boundary baseline must keep the out-of-scope AppsStorePage string',
  );
  assert.ok(
    featureBaseline.includes(
      'contracting/components/ClientQuotationModal.tsx imports @/features/settings/api/settings.api',
    ),
    'feature-boundary baseline must keep the out-of-scope ClientQuotationModal string',
  );
  assert.ok(
    featureBaseline.includes(
      'maritime-freight/components/MaritimeSettingsTab.tsx imports @/features/settings/api/settings.api',
    ),
    'feature-boundary baseline must keep the out-of-scope MaritimeSettingsTab string',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5i');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5I-POS-SETTINGS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5i INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-D-D10A-SERIALS-PAYLOAD/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5i INV exactly once');

  // 4. Wiring: both critical lists carry 389 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 399);
  assert.equal(chain.length, 399);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 389 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-d-d10a-serials-payload.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-d-d10a-serials-payload.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 399);') && src.includes('assert.equal(chain.length, 399);'),
      `${label} spec wiring must re-pin to 389`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-d-d10a-serials-payload.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5i spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5h spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~73 files asserting the count — the #264-fix /
  // D12 lesson. The F5h filename, the count literals, the FE pin
  // literals and the baseline literals are built by concatenation so
  // this block's own source never contains the patterns it scans for.
  // The scan covers all three variable forms: specs, chain, and
  // list.length; the baseline check is line-scoped, F5e lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const f5hName = 'phase1-f5h' + '-pos-sales.spec.ts';
  const f5hInv = 'INV-PHASE1-F5H' + '-POS-SALES-DECOUPLED';
  const staleSpecs = 'specs.length, 38' + '8';
  const staleChain = 'chain.length, 38' + '8';
  const staleList = 'list.length, 38' + '8';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 12" + "5;'";
  const staleFeTotalAfter = "'module-boundary must pin the frontend total 12" + '5 after ';
  const staleFeTotalStill = "'module-boundary must still pin the frontend total 12" + "5'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 4" + "8,'";
  const staleFeEdgesAfter = "'module-boundary must pin 4" + '8 frontend edges after ';
  const staleFeEdgesStill = "'module-boundary must still pin 4" + "8 frontend edges'";
  const staleBaselineA = 'baseline.length, 6' + '5';
  const staleBaselineB = 'featureBaseline.length, 6' + '5';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5hName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${f5hInv}/g)`)) staleGuard.push(file);
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
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5h spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so F5i re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h specs'
  // guard assertions to the F5i INV; their invariants-file assertions
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-D-D10A-SERIALS-PAYLOAD/g)'),
      `${label} spec guard assertion must re-pin to the F5i INV`,
    );
  }

  console.log(
    'phase1 F5i pos|settings checks passed (pos->settings gone, pairs 4->3, edges 47 / statements 122, 389 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
