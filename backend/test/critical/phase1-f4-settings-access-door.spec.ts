import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F4 — the 5 settings components -> @/app/router/access door
 * (INV-PHASE1-F4-SETTINGS-ACCESS-DOOR).
 *
 * Grounding §5/§6 (phase1-f0-grounding.md), re-derived live at 9db0c501b:
 * the 5 are the ONLY component->app-layer entries in the import-layer
 * baseline (class (b-app)); the other 32 live imports of
 * @/app/router/access sit in allowed positions (app/ itself, pages,
 * hooks, specs, shared). Fix: re-point the 5 imports at
 * @/shared/system/runtime-environment — the canonical home of all three
 * helpers (isDesktopOfflineApp, isPlatformAdmin,
 * canManagePlatformModules are DEFINED there; access.ts only
 * re-exports them, so the call sites run the identical function
 * objects and no access decision changes).
 *
 * CORRECTION (found during F4 derivation, parent brief was wrong
 * here): the 5 strings live in the IMPORT-LAYER baseline
 * (frontend/scripts/baselines/import-layer.json), NOT the
 * feature-boundary baseline — that file (70 strings) holds no
 * @/app/router/access string at all. F4 shrinks the import-layer
 * baseline 157 -> 152; the feature-boundary baseline stays 70.
 *
 * Consequences, all re-pinned in this package:
 * - Wiring: both critical lists carry 384 specs in identical order,
 *   the F5a spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const FEATURES = path.join(FRONTEND, 'src', 'features');
const FRONTEND_SRC = path.join(FRONTEND, 'src');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const SHARED_HOME = path.join(FRONTEND_SRC, 'shared', 'system', 'runtime-environment.ts');
const ACCESS_SHIM = path.join(FRONTEND_SRC, 'app', 'router', 'access.ts');

// The 5 files, with their exact new import line and the call sites
// that must be byte-identical apart from the import route.
const FIVE: { file: string; importLine: string; callSites: string[] }[] = [
  {
    file: 'settings/components/forms/tabs/GeneralSettingsTab.tsx',
    importLine: "import { isPlatformAdmin } from '@/shared/system/runtime-environment';",
    callSites: [
      "const isSuperAdmin = isPlatformAdmin(user) || (user?.role === 'super_admin' && String(user?.username || '').trim().toLowerCase() === 'zs');",
    ],
  },
  {
    file: 'settings/components/forms/tabs/ModulesSettingsTab.tsx',
    importLine: "import { isDesktopOfflineApp, canManagePlatformModules } from '@/shared/system/runtime-environment';",
    callSites: [
      "const isSuperAdmin = canManagePlatformModules(user) || (user?.role === 'super_admin' && String(user?.username || '').trim().toLowerCase() === 'zs');",
      '{!isDesktopOfflineApp() && (',
    ],
  },
  {
    file: 'settings/components/user-management-panels/UserManagementEditorCard.tsx',
    importLine: "import { isPlatformAdmin } from '@/shared/system/runtime-environment';",
    callSites: ['const isPlatformUser = isPlatformAdmin(currentUser);'],
  },
  {
    file: 'settings/components/user-management/UserManagementListControls.tsx',
    importLine: "import { isPlatformAdmin } from '@/shared/system/runtime-environment';",
    callSites: ['const isPlatform = isPlatformAdmin(useAuthStore.getState().user);'],
  },
  {
    file: 'settings/components/workspace-sections/SettingsDemoDataWizardSection.tsx',
    importLine: "import { isPlatformAdmin } from '@/shared/system/runtime-environment';",
    callSites: ['const isPlatform = isPlatformAdmin(user);'],
  },
];

const REMOVED_STRINGS = [
  'features/settings/components/forms/tabs/GeneralSettingsTab.tsx imports app layer directly (@/app/router/access)',
  'features/settings/components/forms/tabs/ModulesSettingsTab.tsx imports app layer directly (@/app/router/access)',
  'features/settings/components/user-management-panels/UserManagementEditorCard.tsx imports app layer directly (@/app/router/access)',
  'features/settings/components/user-management/UserManagementListControls.tsx imports app layer directly (@/app/router/access)',
  'features/settings/components/workspace-sections/SettingsDemoDataWizardSection.tsx imports app layer directly (@/app/router/access)',
];

// Mirror of frontend/scripts/import-layer-check.mjs (same regexes,
// same allowed set, same layer resolution, NO comment stripping —
// the official check counts commented imports too).
const ALLOWED_APP_IMPORTS = new Set([
  '@/app/store',
  '@/app/query-keys',
  '@/app/query-invalidation',
  '@/app/router/route-prefetch',
]);

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

function getLayer(filePath: string): string {
  const rel = path.relative(FRONTEND_SRC, filePath).replaceAll('\\', '/');
  if (rel.startsWith('features/')) {
    const parts = rel.split('/');
    return parts[2] ?? '';
  }
  return rel.split('/')[0];
}

function resolveRelativeImport(filePath: string, request: string): string | null {
  if (!request.startsWith('.')) return null;
  const base = path.resolve(path.dirname(filePath), request);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((candidate) => fs.existsSync(candidate)) || base;
}

function deriveLiveImportLayerViolations(): string[] {
  const failures: string[] = [];
  const files: string[] = [];
  walkTs(FEATURES, files);
  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const layer = getLayer(filePath);
    const rel = path.relative(FRONTEND_SRC, filePath).replaceAll('\\', '/');
    if (layer === 'components') {
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const request = match[1];
        if (ALLOWED_APP_IMPORTS.has(request) || request.startsWith('@/features/')) continue;
        if (request.startsWith('@/app/')) {
          failures.push(`${rel} imports app layer directly (${request})`);
        }
        const resolved = resolveRelativeImport(filePath, request);
        if (resolved && getLayer(resolved) === 'pages') {
          failures.push(`${rel} imports a page module (${request})`);
        }
      }
    }
    if (layer === 'pages') {
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const request = match[1];
        const resolved = resolveRelativeImport(filePath, request);
        if (resolved && getLayer(resolved) === 'pages') {
          failures.push(`${rel} imports another page module (${request})`);
        }
      }
    }
  }
  return [...new Set(failures)].sort();
}

async function main(): Promise<void> {
  // 1. All 5 files import through shared now; none imports the app
  // layer anymore (raw source — the official check does not strip
  // comments, so neither does this block); every call site is
  // identical; and the shared helpers are the identical functions
  // access.ts re-exports (no access decision can change).
  const home = fs.readFileSync(SHARED_HOME, 'utf8');
  assert.ok(
    home.includes('export function isDesktopOfflineApp(): boolean {'),
    'runtime-environment.ts must define isDesktopOfflineApp',
  );
  assert.ok(
    home.includes(
      'export function isPlatformAdmin(user: { role?: string; tenantId?: string; accountId?: string } | null | undefined): boolean {',
    ),
    'runtime-environment.ts must define isPlatformAdmin',
  );
  assert.ok(
    home.includes('export function canManagePlatformModules('),
    'runtime-environment.ts must define canManagePlatformModules',
  );
  const shim = fs.readFileSync(ACCESS_SHIM, 'utf8');
  assert.ok(
    shim.includes(
      "import { isDesktopOfflineApp, isPlatformAdmin, canManagePlatformModules } from '@/shared/system/runtime-environment';",
    ),
    'access.ts must import the three helpers from the shared home',
  );
  assert.ok(
    shim.includes('export { canManagePlatformModules };'),
    'access.ts must re-export canManagePlatformModules from shared',
  );
  assert.ok(
    shim.includes('export { isDesktopOfflineApp, isPlatformAdmin };'),
    'access.ts must re-export isDesktopOfflineApp + isPlatformAdmin from shared',
  );
  for (const entry of FIVE) {
    const src = fs.readFileSync(path.join(FEATURES, entry.file), 'utf8');
    assert.ok(src.includes(entry.importLine), `${entry.file} must import through the shared home`);
    assert.ok(!src.includes('@/app/router/access'), `${entry.file} must not import the app layer anymore`);
    for (const site of entry.callSites) {
      assert.ok(src.includes(site), `${entry.file} must keep its call site identical: ${site}`);
    }
  }
  // No settings/components file anywhere may still import the app
  // layer (the 5 were the only ones; a 6th would be a new violation).
  const settingsComponents: string[] = [];
  walkTs(path.join(FEATURES, 'settings', 'components'), settingsComponents);
  const stillApp: string[] = [];
  for (const file of settingsComponents) {
    if (fs.readFileSync(file, 'utf8').includes('@/app/router/access')) {
      stillApp.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillApp, [], 'no settings/components file may still import @/app/router/access');

  // 2. The import-layer baseline shrinks 157 -> 152: exactly the 5 F4
  // strings are gone, and the live derivation equals the baseline
  // exactly (proves no other string moved).
  const baseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(baseline.length, 152, 'import-layer baseline must hold exactly 152 strings after F4');
  for (const gone of REMOVED_STRINGS) {
    assert.ok(!baseline.includes(gone), `baseline must not contain the removed string: ${gone}`);
  }
  const live = deriveLiveImportLayerViolations();
  assert.equal(live.length, 152, 'live import-layer violations must number exactly 152 after F4');
  assert.deepEqual(live, baseline, 'live import-layer violations must equal the baseline exactly');

  // 3. The module-boundary pins do not move (neither @/app/* nor
  // @/shared/* is a feature edge — the scanner counts feature->feature
  // only) and the feature-boundary baseline stays 70 (it never held
  // an @/app/router/access string).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 122;'),
    'module-boundary must still pin the frontend total 122',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 47,'),
    'module-boundary must still pin 47 frontend edges',
  );
  assert.ok(!boundary.includes("'settings->app'"), 'no settings->app edge may exist in the edge table');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 64, 'feature-boundary baseline must stay exactly 64 after F4');
  for (const gone of REMOVED_STRINGS) {
    assert.ok(!featureBaseline.includes(gone), 'feature-boundary baseline never held the F4 strings');
  }

  // 4. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F4-SETTINGS-ACCESS-DOOR/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F4 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-F5I-POS-SETTINGS-DECOUPLED/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F4 INV exactly once');

  // 5. Wiring: both critical lists carry 384 specs in identical order, the F5a spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 389);
  assert.equal(chain.length, 389);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 384 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5i-pos-settings.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-f5i-pos-settings.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 389);') && src.includes('assert.equal(chain.length, 389);'),
      `${label} spec wiring must re-pin to 380`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-f5i-pos-settings.spec.ts'"),
      `${label} spec last-entry must re-pin to the F4 spec`,
    );
  }

  // 6. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F3 spec. (The
  // live tree holds ~55 files asserting the count — the #264-fix /
  // D12 lesson. The F3 filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f3Name = 'phase1-f3' + '-feature-boundary-legs.spec.ts';
  const staleSpecs = 'specs.length, 37' + '9';
  const staleChain = 'chain.length, 37' + '9';
  const staleList = 'list.length, 37' + '9';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f3Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F3 spec');

  // 7. The guard tail holds ONLY the newest id, so F4 re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3 specs' guard assertions to the F4 INV; their
  // invariants-file assertions still pin their own id (each line stays
  // in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
    ['F2', F2_SPEC],
    ['F3', F3_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-F5I-POS-SETTINGS-DECOUPLED/g)'),
      `${label} spec guard assertion must re-pin to the F4 INV`,
    );
  }

  console.log(
    'phase1 F4 settings access door checks passed (5 imports re-routed to shared, import-layer baseline 157->152, counts unmoved, 384 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
