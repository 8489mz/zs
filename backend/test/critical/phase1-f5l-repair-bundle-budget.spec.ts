import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5l-REPAIR — ci-full #323 frontend failed on the bundle budget:
 * entry chunk 760KB vs the 650KB budget (INV-PHASE1-F5L-REPAIR-BUNDLE-BUDGET).
 *
 * The failure: ci-full #323 on 949ecce6e (F5l), frontend job FAILED (9m 23s)
 * at "Frontend bundle budget on the built output (qa:perf:dist)": "[dist]
 * entry chunk is 760KB (budget 650KB). Lazy-load what the first screen
 * does not need." Tests all passed (307 files / 2109 tests) and
 * typecheck+build passed — the budget is the ONLY red. Backend SUCCEEDED.
 * ci-fast #503 on the same commit was GREEN (ci-fast does not run the
 * budget step). The previous green ci-full #322 (421b43363, F5j-REPAIR)
 * PASSED the budget — so the budget broke in F5l.
 *
 * DIAGNOSIS (verified live by an entry-graph walk, phase1-f5l-repair-log.md
 * §2 — not guessed): F5l added exactly ONE new import to the
 * startup-reachable module frontend/src/shared/hooks/use-catalog-queries.ts:
 * `import { storefrontApi } from '@/features/storefront/api/storefront.api';`
 * (for the new useStorefrontAdminSettingsQuery hook). app/providers.tsx:8
 * statically imports useSettingsQuery from that module at startup, so the
 * whole module — and everything it imports — is in the entry chunk BY
 * DESIGN. storefront.api.ts pulls, by VALUE, storefront-media-url,
 * storefront-demo-data and storefront-photo-matcher, which transitively
 * pull the photo-matcher engine/rules/shared/svg, the product-photos
 * registry + p1–p4, and storefront.types: exactly 14 files, 289,337
 * source bytes (~120–145KB minified — the 110KB overage). Every other
 * F5l re-point resolves to the SAME module as before, so the graph is
 * unchanged by them; none of the five moved seams is itself in the entry
 * graph. Removing that ONE edge removes all 14 (proven by the walk).
 *
 * THE FIX: move useStorefrontAdminSettingsQuery OUT of
 * use-catalog-queries.ts into its own module
 * frontend/src/shared/hooks/use-storefront-admin-settings-query.ts
 * (hook carried VERBATIM — same queryKey
 * ['storefront-admin-settings'], same queryFn storefrontApi.getSettings,
 * same enabled option). TableQrPrintDialog re-points ONE import line to
 * the new file; its call site is byte-identical. The dialog is a
 * lazy-route component, so the hook + storefrontApi + the 14-file
 * subtree move to the dialog's lazy chunk and leave the entry chunk.
 * The 650KB budget is NOT raised and the qa:perf:dist check is NOT
 * weakened, skipped, or deleted (ARCHITECTURE_INVARIANTS.md §2.6 PERF
 * invariants; the F5h-REPAIR envelope precedent).
 *
 * WHAT THIS PINS:
 * - use-catalog-queries.ts carries NO storefront import at all (the
 *   edge is gone) and no longer defines the hook;
 * - the new hook file defines the hook VERBATIM (signature, queryKey,
 *   queryFn, enabled) and imports storefrontApi from its feature home;
 * - the dialog imports the hook from the new file and still calls it
 *   with { enabled: open }; its useSettingsQuery import is unchanged;
 * - the entry graph (static-import walk from src/main.tsx, same
 *   resolver as frontend/scripts/perf-budget-check.mjs Rule 1) contains
 *   NONE of the 14 delta files — the property the CI budget step
 *   measures. The walk is also asserted non-vacuous (use-catalog-queries
 *   IS reachable — the fix is about the edge, not the file).
 *
 * PROOF LIMIT (stated plainly): the entry-chunk size itself is proven
 * by CI, not locally — the frontend build cannot run locally (OOM,
 * CI-only). Local proof is the entry-graph walk (the 14-file delta)
 * plus this spec passing locally. No local build or vitest run is
 * claimed.
 *
 * Wiring: both critical lists carry 398 specs in identical order,
 * this spec last.
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
const FRONTEND_SRC = path.join(FRONTEND, 'src');
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
const F5L_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-pos-storefront.spec.ts');
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const D_M3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m3-mail-nested.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const CATALOG_QUERIES = path.join(FRONTEND_SRC, 'shared', 'hooks', 'use-catalog-queries.ts');
const HOOK_FILE = path.join(FRONTEND_SRC, 'shared', 'hooks', 'use-storefront-admin-settings-query.ts');
const QR_DIALOG = path.join(FRONTEND_SRC, 'shared', 'components', 'TableQrPrintDialog.tsx');
const MAIN_TSX = path.join(FRONTEND_SRC, 'main.tsx');

// The 14 files F5l's storefrontApi import dragged into the entry chunk
// (entry-graph walk, phase1-f5l-repair-log.md §2c). Removing the one
// edge removes all 14 — no other entry-graph file imports them.
const ENTRY_DELTA_FILES = [
  'features/storefront/api/storefront.api.ts',
  'features/storefront/lib/product-photos-p1.ts',
  'features/storefront/lib/product-photos-p2.ts',
  'features/storefront/lib/product-photos-p3.ts',
  'features/storefront/lib/product-photos-p4.ts',
  'features/storefront/lib/product-photos-registry.ts',
  'features/storefront/lib/storefront-demo-data.ts',
  'features/storefront/lib/storefront-media-url.ts',
  'features/storefront/lib/storefront-photo-matcher.ts',
  'features/storefront/lib/storefront-photo-matcher/storefront-photo-matcher-engine.ts',
  'features/storefront/lib/storefront-photo-matcher/storefront-photo-matcher-rules.ts',
  'features/storefront/lib/storefront-photo-matcher/storefront-photo-matcher-shared.ts',
  'features/storefront/lib/storefront-photo-matcher/storefront-photo-matcher-svg.ts',
  'features/storefront/types/storefront.types.ts',
];

// Static-import walk from the entry point — the SAME resolver as
// frontend/scripts/perf-budget-check.mjs Rule 1 (same regex, same
// candidate list). The loose regex over-approximates (it can also match
// a bare dynamic import at line start), so a "not reachable" verdict
// here also holds under the strict model — the assertion is sound.
const STATIC_IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm;

function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(FRONTEND_SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walkEntryGraph(): Set<string> {
  const visited = new Set<string>();
  const queue = [MAIN_TSX];
  visited.add(path.relative(FRONTEND_SRC, MAIN_TSX));
  while (queue.length) {
    const file = queue.shift() as string;
    if (!/\.(tsx?|jsx?)$/.test(file)) continue;
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of code.matchAll(STATIC_IMPORT_RE)) {
      const spec = match[1];
      const local = resolveLocal(file, spec);
      if (local) {
        const rel = path.relative(FRONTEND_SRC, local);
        if (!visited.has(rel)) {
          visited.add(rel);
          queue.push(local);
        }
      }
    }
  }
  return visited;
}

async function main(): Promise<void> {
  // 1. The fix: the storefrontApi edge is gone from the startup-reachable
  // catalog queries, and the hook lives in its own file, verbatim.
  const catalogQueries = fs.readFileSync(CATALOG_QUERIES, 'utf8');
  assert.ok(
    !catalogQueries.includes("import { storefrontApi } from '@/features/storefront/api/storefront.api';"),
    'use-catalog-queries must NOT import storefrontApi (the edge that dragged 14 files into the entry chunk)',
  );
  assert.ok(
    !catalogQueries.includes('features/storefront'),
    'use-catalog-queries must NOT import anything from features/storefront at all',
  );
  assert.ok(
    !catalogQueries.includes('useStorefrontAdminSettingsQuery'),
    'use-catalog-queries must no longer define useStorefrontAdminSettingsQuery',
  );
  const hook = fs.readFileSync(HOOK_FILE, 'utf8');
  assert.ok(
    hook.includes('export function useStorefrontAdminSettingsQuery(options?: { enabled?: boolean }) {'),
    'the new hook file must define useStorefrontAdminSettingsQuery with the enabled option',
  );
  assert.ok(
    hook.includes("queryKey: ['storefront-admin-settings'],"),
    'the moved hook must carry the dialog queryKey verbatim',
  );
  assert.ok(
    hook.includes('queryFn: storefrontApi.getSettings,'),
    'the moved hook must carry the dialog queryFn verbatim',
  );
  assert.ok(
    hook.includes("import { storefrontApi } from '@/features/storefront/api/storefront.api';"),
    'the moved hook must import storefrontApi from its feature home (the file’s established style)',
  );
  const dialog = fs.readFileSync(QR_DIALOG, 'utf8');
  assert.ok(
    dialog.includes(
      "import { useStorefrontAdminSettingsQuery } from '@/shared/hooks/use-storefront-admin-settings-query';",
    ),
    'the QR dialog must import the hook from its new file',
  );
  assert.ok(
    dialog.includes("import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';"),
    'the QR dialog must keep its useSettingsQuery import from the catalog queries',
  );
  assert.ok(
    dialog.includes('useStorefrontAdminSettingsQuery({ enabled: open })'),
    'the QR dialog must still call the hook with { enabled: open }',
  );

  // 2. The entry graph (the property the CI budget step measures):
  // NONE of the 14 delta files may be reachable from src/main.tsx.
  // The walk is asserted non-vacuous: the catalog queries ARE reachable
  // (providers.tsx imports useSettingsQuery at startup) — the fix is
  // about the edge, not the file.
  const visited = walkEntryGraph();
  assert.ok(visited.size > 100, 'the entry-graph walk must reach the real startup graph (non-vacuous)');
  assert.ok(
    visited.has(path.join('shared', 'hooks', 'use-catalog-queries.ts')),
    'use-catalog-queries must still be reachable from the entry (providers.tsx imports it at startup)',
  );
  for (const file of ENTRY_DELTA_FILES) {
    assert.ok(
      !visited.has(file),
      `the entry graph must NOT reach ${file} (F5l dragged it in via the storefrontApi edge)`,
    );
  }

  // 3. Pins: all unmoved (FE 44/105 + floor 44, baselines 57/152,
  // backend 63/736 + total 738, write pin 6, pairs []).
  const boundarySpec = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundarySpec.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundarySpec.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must still pin the frontend total 105',
  );
  assert.ok(
    boundarySpec.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundarySpec.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must still pin 44 frontend edges',
  );
  assert.ok(
    boundarySpec.includes('const FRONTEND_EDGE_FLOOR = 44;'),
    'module-boundary must still pin the frontend edge floor 44',
  );
  assert.ok(
    boundarySpec.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
    'the frontend bidirectional pair list must stay empty',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
  const importLayer = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importLayer.length, 152, 'import-layer baseline must stay exactly 152');

  // 4. INV-PHASE1-F5L-REPAIR-BUNDLE-BUDGET exactly once in both places.
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5L-REPAIR-BUNDLE-BUDGET/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5l-REPAIR INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-CLEANUP-AS-ANY-REDUCTION/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5l-REPAIR INV exactly once');

  // 5. Wiring: both critical lists carry 398 specs in identical order,
  // this spec last.
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
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 398 specs in order');
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
    ['F5l', F5L_SPEC],
    ['D-M1', D_M1_SPEC],
    ['D-M3', D_M3_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 402);') && src.includes('assert.equal(chain.length, 402);'),
      `${label} spec wiring must re-pin to 398`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5l-REPAIR spec`,
    );
    // B1/B2 never carry a chain-form last-entry (they predate the chain
    // form — the chain form is covered by the direct chain assertion +
    // the §6 stale-scan); every later spec must re-pin it too.
    if (label !== 'B1' && label !== 'B2') {
      assert.ok(
        src.includes("chain[chain.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
        `${label} spec last-entry must re-pin to the F5l-REPAIR spec (chain form)`,
      );
    }
  }

  // 6. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the D-M3 spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~75 files asserting the count — the #264-fix /
  // D12 lesson. The D-M3 filename, the count literals, the FE pin
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
  const prevName = 'phase1-d-m3-mail-' + 'nested.spec.ts';
  const prevInv = 'INV-PHASE1-D-M3-' + 'MAIL-NESTED';
  const staleSpecs = 'specs.length, 39' + '7';
  const staleChain = 'chain.length, 39' + '7';
  const staleList = 'list.length, 39' + '7';
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
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (397)');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the D-M3 spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (D-M3)');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 7. The guard tail holds ONLY the newest id, so F5l-REPAIR re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/D-M1/D-M3 specs'
  // guard assertions to the F5l-REPAIR INV; their invariants-file assertions
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
    ['F5l', F5L_SPEC],
    ['D-M1', D_M1_SPEC],
    ['D-M3', D_M3_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-CLEANUP-AS-ANY-REDUCTION/g)'),
      `${label} spec guard assertion must re-pin to the F5l-REPAIR INV`,
    );
  }

  console.log(
    'phase1 F5l-REPAIR bundle budget checks passed (storefrontApi edge gone from the entry graph, 398 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
