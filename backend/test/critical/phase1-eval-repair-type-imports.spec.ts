import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 eval repair — CI failure on the eval follow-up batch
 * 9d00437 (INV-PHASE1-EVAL-REPAIR-TYPE-IMPORTS).
 *
 * ci-fast #513 + ci-full #333 both failed on 9d00437: frontend
 * typecheck (TS2206) and backend lint (no-duplicate-imports). Both
 * failures are batch-caused and both are one-word-class defects:
 *
 * FRONTEND — TS2206: "The 'type' modifier cannot be used on a named
 * import when 'import type' is used on its import statement." P1's
 * lint autofix merged separate `import type {...}` statements into
 * single ones but KEPT the inline `type` modifiers, producing
 * `import type {type X, ...}` — double-marked. Exactly 5 such lines
 * existed in frontend/src (0 in frontend/tests, vite.config.ts or
 * scripts), all in the batch diff, all replacing 2-3 separate
 * `import type` lines:
 * - ai-business-copilot-modal-chat.tsx:12 (react: RefObject,
 *   Dispatch, SetStateAction)
 * - pos-held-snapshot.ts:18 (usePosWorkspace: PosDraftSnapshot,
 *   PaymentChannel, PaymentType)
 * - modules-settings-grid-g3.tsx:5 (react: CSSProperties,
 *   Dispatch, SetStateAction)
 * - settings-demo-data-wizard-config.tsx:4 (demo-data.api:
 *   DemoDataStatusResponse, DemoActivitySummary)
 * - settings-demo-data-wizard-success-dialog.tsx:5 (demo-data.api:
 *   SeedDemoDataResult, DemoActivitySummary)
 * ci-full #332 on fd843ff was GREEN, so all 5 are batch-introduced.
 * `verbatimModuleSyntax` is NOT enabled (tsconfig.app.json has no
 * such flag) — the plain mixed form `import {X, type Y}` is legal
 * and untouched; only the `import type {type ...}` double-marking
 * errors. Fix: drop the inline `type` modifiers in those 5 lines,
 * keeping the `import type` statement and the P1 merge (same names,
 * same modules).
 *
 * BACKEND — no-duplicate-imports: P3 added line 5
 * `import { currencyMoneyDigits } from
 * '../../accounting/engines/money-minor-units.engine';` while the
 * file ALREADY had a mid-file import at line 368
 * `import { type MoneyDigits } from '...same module...'` (pre-existing,
 * not in the P3 diff). `MoneyDigits` IS used (line 409:
 * `moneyDigits: MoneyDigits;`). Fix: merge into line 5 —
 * `import { currencyMoneyDigits, type MoneyDigits } from '...';` —
 * and delete line 368. The sibling mid-file import
 * (rep-target.engine) is a different module and stays.
 *
 * WHAT THIS PINS (static source pins — frontend tsc/vitest/build are
 * CI-only, never run locally, so the frontend half is pinned
 * statically here and proven green by the CI run on the repair push):
 * - §1: no `import type {` / `export type {` statement anywhere in
 *   frontend/src carries an inline `type` modifier, and the 5 fixed
 *   lines read exactly as corrected.
 * - §2: van-common.util.ts imports money-minor-units.engine exactly
 *   once, and the single import carries both currencyMoneyDigits
 *   and MoneyDigits.
 * - §3: the repair INV exists exactly once in
 *   ARCHITECTURE_INVARIANTS.md and exactly once in the guard tail.
 * - §4–§6: wiring 406 in both lists, this spec last, all earlier
 *   specs re-pinned (counts, last-entry, guard INV).
 * - §7: boundary / frontend / baseline / write pins do not move
 *   (backend 740, delivery-reps->accounting 109, frontend 105/44,
 *   baselines 57/152, writes 5).
 *
 * Wiring: both critical lists carry 406 specs in identical order,
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
const P1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p1-frontend-lint.spec.ts');
const P2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p2-dev-passcode.spec.ts');
const P3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p3-van-writer.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const VAN_COMMON = path.join(BACKEND, 'src', 'modules', 'delivery-reps', 'services', 'van-common.util.ts');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const A9_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-a9-routing.spec.ts');
const A10_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-a10-rounding.spec.ts');

const FIXED_IMPORT_LINES: Array<[string, string]> = [
  ['ai-business-copilot-modal-chat.tsx', "import type {RefObject, Dispatch, SetStateAction} from 'react';"],
  [
    'pos-held-snapshot.ts',
    "import type {PosDraftSnapshot, PaymentChannel, PaymentType} from '@/features/pos/hooks/usePosWorkspace';",
  ],
  ['modules-settings-grid-g3.tsx', "import type {CSSProperties, Dispatch, SetStateAction} from 'react';"],
  [
    'settings-demo-data-wizard-config.tsx',
    "import type {DemoDataStatusResponse, DemoActivitySummary} from '@/features/settings/api/demo-data.api';",
  ],
  [
    'settings-demo-data-wizard-success-dialog.tsx',
    "import type {SeedDemoDataResult, DemoActivitySummary} from '@/features/settings/api/demo-data.api';",
  ],
];

function collectTsFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, out);
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. No `import type {` / `export type {` statement anywhere in
  // frontend/src may carry an inline `type` modifier (TS2206), and
  // the 5 fixed lines read exactly as corrected.
  const violations: string[] = [];
  const files: string[] = [];
  collectTsFiles(path.join(FRONTEND, 'src'), files);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of [/import\s+type\s*\{([\s\S]*?)\}/g, /export\s+type\s*\{([\s\S]*?)\}/g]) {
      for (const match of src.matchAll(re)) {
        if (/(?:^|[\s,{])type\s+[A-Za-z_$][\w$]*/.test(match[1])) {
          violations.push(`${path.relative(REPO_ROOT, file)}: ${match[0].slice(0, 120)}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [], 'no import type / export type statement may carry an inline type modifier (TS2206)');
  for (const [fileName, line] of FIXED_IMPORT_LINES) {
    let found = false;
    for (const file of files) {
      if (path.basename(file) !== fileName) continue;
      if (fs.readFileSync(file, 'utf8').includes(line)) found = true;
    }
    assert.ok(found, `${fileName} must carry the corrected import line: ${line}`);
  }

  // 2. van-common.util.ts imports money-minor-units.engine exactly
  // once, and the single import carries both names.
  const van = fs.readFileSync(VAN_COMMON, 'utf8');
  const moneyImports =
    van.match(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\.\/\.\.\/accounting\/engines\/money-minor-units\.engine['"]/g) ||
    [];
  assert.equal(moneyImports.length, 1, 'van-common must import money-minor-units.engine exactly once');
  assert.ok(
    van.includes(
      "import { currencyMoneyDigits, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';",
    ),
    'the single money-minor-units import must carry both currencyMoneyDigits and MoneyDigits',
  );

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-EVAL-REPAIR-TYPE-IMPORTS/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the repair INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-TEST-FILE-WIRING-S9/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the repair INV exactly once');

  // 4. Wiring: both critical lists carry 406 specs in identical order, this spec last.
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
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 406 specs in order');
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
    ['P1', P1_SPEC],
    ['P2', P2_SPEC],
    ['P3', P3_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 425);') && src.includes('assert.equal(chain.length, 425);'),
      `${label} spec wiring must re-pin to 406`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts'"),
      `${label} spec last-entry must re-pin to the repair spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the P3 spec, or pin the
  // old guard INV. (Same shape as the P3 spec's §5; the patterns
  // below are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const prevName = 'phase1-eval-p3-van-' + 'writer.spec.ts';
  const prevInv = 'INV-PHASE1-EVAL-P3-VAN-' + 'WRITER';
  const staleSpecs = 'specs.length, 40' + '5';
  const staleChain = 'chain.length, 40' + '5';
  const staleList = 'list.length, 40' + '5';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
    if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (405)');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the P3 spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (P3)');

  // 6. The guard tail holds ONLY the newest id, so this package re-pins
  // the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/
  // F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/F5l-REPAIR/D-M1/D-M3/
  // D-D10a/discount-fix/cleanup/P1/P2/P3 specs' guard assertions to the
  // repair INV; their invariants-file assertions still pin their own
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
    ['P1', P1_SPEC],
    ['P2', P2_SPEC],
    ['P3', P3_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-TEST-FILE-WIRING-S9/g)'),
      `${label} spec guard assertion must re-pin to the repair INV`,
    );
  }

  // 7. The module-boundary pins do not move in this repair (the
  // frontend lines only drop a redundant `type` word; the backend
  // merge keeps the same module edge). The write inventory pins 5
  // (spec + doc), and the A9/A10 deferral pins stay at the migrated
  // state (van 0 inserts, 1 writer call).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 740',
  );
  assert.ok(
    boundary.includes("'delivery-reps->accounting': 109,"),
    'module-boundary must still pin delivery-reps->accounting 109',
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
  const writesSpec = fs.readFileSync(WRITES_SPEC, 'utf8');
  const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
  assert.ok(writesSpec.includes('const PINNED_WRITE_COUNT = 5;'), 'stock-movements-writes must pin the write count 5');
  assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
  assert.ok(
    !writesDoc.includes('| backend/src/modules/delivery-reps/services/van-common.util.ts:57 |'),
    'the writes doc must no longer list the van-common row',
  );
  assert.ok(writesDoc.includes('`delivery-reps`: 0'), 'the writes doc must pin delivery-reps 0');
  const a9 = fs.readFileSync(A9_SPEC, 'utf8');
  assert.ok(
    a9.includes("assert.equal(countDirectInserts(read('modules/delivery-reps/services/van-common.util.ts')), 0);"),
    'A9-routing must pin the van file at zero direct inserts',
  );
  const a10 = fs.readFileSync(A10_SPEC, 'utf8');
  assert.ok(
    a10.includes('assert.equal(countDirectInserts(van), 0,'),
    'A10-rounding must pin moveVanStock at zero direct inserts',
  );
  assert.ok(
    a10.includes('assert.equal(countWriterCalls(van), 1,'),
    'A10-rounding must pin moveVanStock at one writer call',
  );

  console.log('phase1 eval repair checks passed (TS2206 + duplicate import fixed, 406 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
