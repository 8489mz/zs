import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 evaluation follow-up P1 — frontend lint (INV-PHASE1-EVAL-P1-FRONTEND-LINT).
 *
 * Antigravity's live evaluation of 4c44dec found 156 real frontend ESLint
 * errors in frontend/src (4,505 warnings) plus a VatDeclarationPage
 * timezone test bug, and that frontend lint runs NOWHERE in CI. The
 * second Muse account agreed the frontend lint gap is real. This package
 * fixes all of it:
 *
 * - The 156 errors (re-measured live at fd843ff with the repo's own
 *   eslint binary: ERRORS=156 WARNINGS=4505, 94 files):
 *   no-duplicate-imports 76, react-hooks/rules-of-hooks 47, prefer-const 8,
 *   no-extra-boolean-cast 8, @typescript-eslint/ban-ts-comment 6,
 *   no-irregular-whitespace 3, no-unused-expressions 2, prefer-spread 2,
 *   @typescript-eslint/no-empty-object-type 2.
 * - `eslint --fix` removes only 18 of them (prefer-const 8,
 *   no-regex-spaces 2, no-extra-boolean-cast 8) in 13 files; the 76
 *   duplicate imports are NOT auto-fixed (value+type pairs and repeated
 *   value imports from one module — the fixer does not merge those), so
 *   they were merged mechanically (script
 *   ~/workspace/audit/phase1-eval-p1-dup-imports.py + name-set
 *   verification ~/workspace/audit/phase1-eval-p1-dup-imports-verify.py:
 *   the merged statement imports EXACTLY the same names, with the same
 *   type-ness, as the statements it replaces; value+type pairs merge
 *   with inline `type` qualifiers). The 47 rules-of-hooks violations are
 *   ONE repeated pattern in 12 files — hooks called after an early
 *   return — fixed by hoisting all hooks above the return; where an
 *   effect/query must not run while closed, its body (or `enabled`) is
 *   guarded with the same condition. The 6 @ts-ignore lines guard REAL
 *   type errors (window.electronRuntime / window.electronAPI are exposed
 *   by frontend/electron/preload.cjs with no TS types anywhere, and
 *   vite-env.d.ts declares only __APP_VERSION__/__APP_BUILD_ID__), so
 *   they become @ts-expect-error. The 3 irregular-whitespace hits are
 *   stray BOM bytes (U+FEFF) at line 2 col 1, deleted. The 2
 *   unused-expression ternaries become if/else. The 2 empty interfaces
 *   become `type X = Partial<Y>;` (used only as parameter types).
 * - The one --fix change inside frontend/src/shared/utils/ai-background-removal.ts
 *   (1037 lines, over the cap) is a single `let` -> `const` on line 677:
 *   it adds NO lines, so the file-growth rule is not breached. The
 *   hands-off file background-knockout.ts is untouched (0 hunks).
 * - VatDeclarationPage.spec.tsx timezone bug: currentMonthRange() built
 *   `new Date(y, m, 1).toISOString().split('T')[0]` — a local-midnight
 *   Date rendered as UTC, so in Cairo (UTC+2) Nov 1 came out as Oct 31
 *   while the page (todayLocalDateKey, local parts) shows Nov 1. The
 *   page is correct; the SPEC is fixed to use todayLocalDateKey from
 *   @/lib/format exactly like the page does. CI runs in UTC and would
 *   pass either way, so CI does NOT prove this fix: the proof is the
 *   node TZ demonstration in the log (TZ=Africa/Cairo, faked Nov 1:
 *   old helper -> 2026-10-31, new helper -> 2026-11-01).
 * - frontend/android (generated Capacitor output, 38,947 errors when
 *   swept) is now ignored in frontend/eslint.config.js, so `npm run
 *   lint` (which lints `.`) can pass.
 * - `npm run lint` lints `.`, not just `src` — and the first `npm run
 *   lint` run after the src fixes still reported 635 errors OUTSIDE
 *   src (625 in electron/, 5 in e2e/, 5 in tests/), all pre-existing:
 *   the electron main-process subtree is Node/CommonJS by design
 *   (main.cjs, preload.cjs, backend migrations) but matched NO config
 *   block, so the base recommended set flagged `require`/`process`/
 *   `__dirname`/`exports` as undefined (482 no-undef) and `require()`
 *   calls as forbidden (94 no-require-imports). Fixed with an
 *   `electron/**` override in eslint.config.js — Node globals (+ Vitest
 *   globals for electron/__tests__), no-require-imports off, and the
 *   SAME relaxations src already has (unused vars warn with `_`
 *   ignored, empty `catch {}` off — all 33 are deliberate best-effort
 *   swallows in main-process code). The remaining real ones were fixed
 *   mechanically: 10 electron unused vars (unused catch bindings
 *   dropped to bare `catch {}`, `down(db)` -> `down(_db)`, one dead
 *   `args` array deleted — proven never read — and one unused Promise
 *   `reject` -> `_reject`, line-targeted so the two sibling executors
 *   that DO use `reject` are untouched), and 10 unused vars in the
 *   Playwright stub specs (unused `expect` import + unused `page`
 *   fixture + one unused `count` param). `eslint .` is now 0 errors /
 *   4505 warnings — the same warning count as the src-only baseline,
 *   i.e. the electron work added ZERO warnings.
 * - Frontend lint now runs in CI in BOTH workflows, mirroring the L8
 *   backend-lint precedent: "Frontend lint" (`npm run lint`,
 *   working-directory frontend) after typecheck in ci.yml frontend-fast
 *   and after Build in ci-full.yml frontend.
 *
 * PROOF LIMIT (stated plainly): this spec pins the guard statically
 * (CI steps, android ignore, Electron override, VAT helper, lint
 * script) — it CANNOT shell out to eslint, because the backend CI job
 * has no frontend/node_modules.
 * The 156 -> 0 (src) and 635 -> 0 (`eslint .`) clearances are proven
 * by the saved eslint runs
 * (~/workspace/audit/phase1-eval-followups-eslint-before.json /
 * -after.json — the -after file IS the `eslint .` run: 0 errors, 4505
 * warnings — plus -dot-before.json for the 635) and guarded live by
 * the two CI lint steps, which fail the build on any error. Frontend
 * Vitest/tsc/build are CI-only (never run locally — OOM). The 156 fixes
 * are behavior-identical by construction (import merges preserve the
 * exact imported-name set; hook hoisting preserves call order;
 * let->const, boolean-cast removal, ternary->if/else and type-alias
 * changes touch no runtime value); the electron/e2e fixes are likewise
 * behavior-identical (config override only; empty-catch binding drops;
 * one provably-dead array deleted; renames; stub-spec param drops).
 *
 * Wiring: both critical lists carry 403 specs in identical order,
 * this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
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
const F5L_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-repair-bundle-budget.spec.ts');
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const D_M3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m3-mail-nested.spec.ts');
const D_D10A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-d10a-serials-payload.spec.ts');
const DISCOUNT_FIX_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-discount-fix-line-amount.spec.ts');
const CLEANUP_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-cleanup-as-any-reduction.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const CI_FAST = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const CI_FULL = path.join(REPO_ROOT, '.github', 'workflows', 'ci-full.yml');
const ESLINT_CONFIG = path.join(FRONTEND, 'eslint.config.js');
const FRONTEND_PACKAGE_JSON = path.join(FRONTEND, 'package.json');
const VAT_SPEC = path.join(FRONTEND, 'src', 'features', 'sales', 'pages', 'VatDeclarationPage.spec.tsx');

const LINT_STEP = '      - name: Frontend lint\n        run: npm run lint\n        working-directory: frontend\n';

function main(): void {
  // 1. The guard exists in both CI workflows, the generated android
  // folder is ignored, the VAT spec keys dates locally, and the lint
  // script exists. (The 156 -> 0 clearance itself is proven by the
  // saved eslint runs + the CI lint steps, which fail the build on any
  // error — this spec cannot run eslint: the backend CI job has no
  // frontend/node_modules.)
  const ciFast = fs.readFileSync(CI_FAST, 'utf8');
  assert.ok(ciFast.includes(LINT_STEP), 'ci.yml must carry the Frontend lint step');
  assert.ok(
    ciFast.indexOf(LINT_STEP) > ciFast.indexOf('- name: Frontend typecheck'),
    'ci.yml Frontend lint must run after Frontend typecheck',
  );
  const ciFull = fs.readFileSync(CI_FULL, 'utf8');
  assert.ok(ciFull.includes(LINT_STEP), 'ci-full.yml must carry the Frontend lint step');
  assert.ok(
    ciFull.indexOf(LINT_STEP) > ciFull.indexOf('- name: Build frontend (type-check + bundle)'),
    'ci-full.yml Frontend lint must run after Build frontend',
  );
  const eslintConfig = fs.readFileSync(ESLINT_CONFIG, 'utf8');
  assert.ok(eslintConfig.includes("'android/**'"), 'eslint.config.js must ignore the generated android folder');
  assert.ok(
    eslintConfig.includes("'electron/**/*.{js,cjs}'"),
    'eslint.config.js must carry an Electron override block',
  );
  assert.ok(eslintConfig.includes('...globals.node'), 'the Electron override must provide Node globals');
  assert.ok(
    eslintConfig.includes("'@typescript-eslint/no-require-imports': 'off'"),
    'the Electron override must switch off no-require-imports (CommonJS by design)',
  );
  assert.ok(
    eslintConfig.includes("'electron/__tests__/**/*.{js,cjs}'"),
    'eslint.config.js must carry a Vitest-globals block for the Electron tests',
  );
  const frontendPkg = JSON.parse(fs.readFileSync(FRONTEND_PACKAGE_JSON, 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.ok(
    typeof frontendPkg.scripts?.lint === 'string' && frontendPkg.scripts.lint.includes('eslint'),
    'frontend/package.json must define a lint script running eslint',
  );
  const vatSpec = fs.readFileSync(VAT_SPEC, 'utf8');
  assert.ok(
    vatSpec.includes("import { todayLocalDateKey } from '@/lib/format';"),
    'the VAT spec must use todayLocalDateKey',
  );
  assert.ok(!vatSpec.includes('toISOString'), 'the VAT spec must not build dates from toISOString (UTC day shift)');

  // 2. The module-boundary pins do not move (frontend-only lint fixes + config + CI steps).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 740',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must still pin the frontend total 105',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must still pin 44 frontend edges',
  );
  assert.ok(
    boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
    'module-boundary must still pin the frontend edge floor 44',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
    'the frontend bidirectional pair list must stay empty',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-EVAL-P1-FRONTEND-LINT/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the P1 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-TEST-FILE-WIRING-S9/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the P1 INV exactly once');

  // 4. Wiring: both critical lists carry 403 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 425);
  assert.equal(chain.length, 425);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 403 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts');
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
    ['F5l-REPAIR', F5L_REPAIR_SPEC],
    ['D-M1', D_M1_SPEC],
    ['D-M3', D_M3_SPEC],
    ['D-D10a', D_D10A_SPEC],
    ['discount-fix', DISCOUNT_FIX_SPEC],
    ['cleanup', CLEANUP_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 425);') && src.includes('assert.equal(chain.length, 425);'),
      `${label} spec wiring must re-pin to 403`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts'"),
      `${label} spec last-entry must re-pin to the P1 spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the cleanup spec, pin the
  // old guard INV, pin the old frontend pins, or pin the old baseline
  // size. (Same shape as the cleanup spec's §5; the patterns below are
  // built by concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length; the last-entry scan covers BOTH forms
  // (specs[...] and chain[...] — the F5j lesson); the baseline check is
  // line-scoped, F5e lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const prevName = 'phase1-cleanup-as-any-' + 'reduction.spec.ts';
  const prevInv = 'INV-PHASE1-BATCH-REPAIR-DISCOUNT-' + 'I18N-KEYS';
  const staleSpecs = 'specs.length, 40' + '2';
  const staleChain = 'chain.length, 40' + '2';
  const staleList = 'list.length, 40' + '2';
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
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (402)');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the cleanup spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (batch-repair)');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so this package re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup specs'
  // guard assertions to the P1 INV; their invariants-file assertions
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
    ['F5l-REPAIR', F5L_REPAIR_SPEC],
    ['D-M1', D_M1_SPEC],
    ['D-M3', D_M3_SPEC],
    ['D-D10a', D_D10A_SPEC],
    ['discount-fix', DISCOUNT_FIX_SPEC],
    ['cleanup', CLEANUP_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-TEST-FILE-WIRING-S9/g)'),
      `${label} spec guard assertion must re-pin to the P1 INV`,
    );
  }

  console.log('phase1 eval P1 frontend-lint checks passed (CI lint steps pinned, 403 specs wired)');
}

main();
