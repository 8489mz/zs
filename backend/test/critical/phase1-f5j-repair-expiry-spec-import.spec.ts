import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5j-REPAIR — the F5j commit's frontend typecheck failure
 * (INV-PHASE1-F5J-REPAIR-EXPIRY-SPEC-IMPORT).
 *
 * ci-fast #499 on f8c5983fd (F5j) failed in job frontend-fast, step
 * "Frontend typecheck" (1m 53s):
 *   src/features/products/utils/product-expiry.utils.spec.ts(13,8):
 *   error TS2307: Cannot find module './product-expiry.utils' or its
 *   corresponding type declarations.
 * It was the ONLY error in the log; the guards step was skipped (0s).
 * ci-full #319's frontend failed the same error. Documentation
 * integrity #422 on the same commit was SUCCESS.
 *
 * Root cause, verified live at f8c5983fd: F5j moved
 * frontend/src/features/products/utils/product-expiry.utils.ts WHOLE
 * (git mv, byte-identical) to frontend/src/shared/utils/
 * product-expiry.utils.ts, but left its colocated spec behind at
 * frontend/src/features/products/utils/product-expiry.utils.spec.ts
 * with NO shim at the old path — the old directory holds the spec
 * and no product-expiry.utils.ts. The spec imports the four names
 * (PRODUCT_EXPIRY_ALERT_DAYS, evaluateProductExpiryStatus,
 * getProductExpiryDate, productExpiryAlertLabel) from
 * './product-expiry.utils' (:13), so the module does not exist at
 * that path and tsc fails with TS2307. F5j DID create a shim for
 * products.api.ts at its old path — only the expiry-utils move
 * lacks one. The F5f precedent was to move a module WHOLE with its
 * colocated spec; F5j broke that precedent for this file. The spec
 * is the ONLY importer of the old path (verified live: git grep for
 * product-expiry.utils across frontend/src finds only the spec
 * itself plus ProductCardModal, which already imports from
 * '@/shared/utils/product-expiry.utils'). WHY IT WAS MISSED:
 * frontend typecheck is CI-only (never runs locally — OOM), so no
 * local gate executes it; F5j's regression loop runs backend specs
 * only.
 *
 * The fix: complete the F5j move — git mv the spec to
 * frontend/src/shared/utils/product-expiry.utils.spec.ts, alongside
 * the implementation. The spec stays byte-identical; its relative
 * import resolves unchanged in the new directory. Why this option,
 * not the other two: (a) a shim at the old path would exist only
 * to serve the spec (the spec is the only importer of the old
 * path); (b) re-pointing the spec's import to the shared path
 * edits the spec while leaving it in the products feature testing
 * shared code. Moving the spec is the F5f precedent (the module
 * moves WHOLE with its colocated spec), needs zero content edits,
 * and shared/utils already holds colocated specs
 * (audit-activity-presenter.spec.ts, cash-drawer-receipt.spec.ts).
 * No production code changes; no other spec is touched.
 *
 * Consequences, all re-pinned in this package:
 * - The typecheck error is gone: the spec's relative import
 *   resolves to the shared implementation.
 * - Frontend edges 45 / statements 111, pairs 1, backend pins
 *   (63 / 736, total 738) unmoved. Feature-boundary baseline 60
 *   and import-layer baseline stays 152 (F5k moved the frontend
 *   pins: edges 46 -> 45, statements 116 -> 111, pairs 2 -> 1,
 *   baseline 63 -> 60).
 * - Wiring: both critical lists carry 394 specs in identical order,
 *   this spec last. Rebased twice: F5h-REPAIR-2 landed first as the
 *   392nd spec, then F5k as the 393rd, so this spec is the 394th.
 *
 * Notes: the stale cosmetic string in the F2 spec ("379 specs wired"
 * in its console.log) is pre-existing since F3 and is NOT an
 * assertion — left as-is per the parent brief. docs/MODULE_DOORS.md
 * §4 coupling line ('57 edges / 133 statements') is a stale
 * historical note (already wrong about the live pins before F5a)
 * that no package maintains — left as-is. Frontend vitest and
 * typecheck cannot run locally (OOM — CI-only); the expiry spec's
 * green is proven by CI, not locally — the local proof here is
 * import resolution verified by code inspection (this spec) plus the
 * guard spec passing locally.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const SHARED_UTILS = path.join(FRONTEND, 'src', 'shared', 'utils');
const SHARED_SPEC = path.join(SHARED_UTILS, 'product-expiry.utils.spec.ts');
const OLD_SPEC = path.join(FRONTEND, 'src', 'features', 'products', 'utils', 'product-expiry.utils.spec.ts');
const OLD_UTILS = path.join(FRONTEND, 'src', 'features', 'products', 'utils', 'product-expiry.utils.ts');
const SHARED_UTILS_FILE = path.join(SHARED_UTILS, 'product-expiry.utils.ts');
const SHARED_MODAL = path.join(FRONTEND, 'src', 'shared', 'components', 'ProductCardModal.tsx');
const PRODUCTS_API_SHIM = path.join(FRONTEND, 'src', 'features', 'products', 'api', 'products.api.ts');
const ENVELOPE_CHECK = path.join(FRONTEND, 'scripts', 'api-mutation-envelope-check.mjs');
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
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5K_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5k-pos-products.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The spec moved whole with its module: it lives at the shared
  // home, byte-identical; its relative import resolves to the shared
  // implementation; the shared utils still define the four names; no
  // file imports the old path anymore; the envelope check still runs
  // green; the products api shim is untouched.
  assert.ok(fs.existsSync(SHARED_SPEC), 'the expiry spec must live at the shared home with its module');
  assert.ok(!fs.existsSync(OLD_SPEC), 'the expiry spec must no longer live at the old products path');
  assert.ok(!fs.existsSync(OLD_UTILS), 'the old products path must hold no expiry utils implementation');
  const specSrc = fs.readFileSync(SHARED_SPEC, 'utf8');
  assert.ok(
    specSrc.includes("} from './product-expiry.utils';"),
    'the moved spec must keep its relative import byte-identical',
  );
  assert.ok(
    specSrc.includes('PRODUCT_EXPIRY_ALERT_DAYS,'),
    'the moved spec must still import PRODUCT_EXPIRY_ALERT_DAYS',
  );
  assert.ok(
    specSrc.includes('evaluateProductExpiryStatus,'),
    'the moved spec must still import evaluateProductExpiryStatus',
  );
  assert.ok(specSrc.includes('getProductExpiryDate,'), 'the moved spec must still import getProductExpiryDate');
  assert.ok(specSrc.includes('productExpiryAlertLabel,'), 'the moved spec must still import productExpiryAlertLabel');
  const resolved = path.join(path.dirname(SHARED_SPEC), 'product-expiry.utils.ts');
  assert.ok(fs.existsSync(resolved), 'the spec relative import must resolve to an existing module');
  assert.equal(resolved, SHARED_UTILS_FILE, 'the resolved module must be the shared implementation');
  assert.ok(
    specSrc.includes('expect(result.daysRemaining).toBe(29);'),
    'the moved spec must keep its 60-day rule pin (29 days remaining)',
  );
  assert.ok(
    specSrc.includes("expect(result.earliestExpiryDate).toBe('2026-12-05');"),
    'the moved spec must keep its live-item expiry pin (2026-12-05)',
  );
  const utilsSrc = fs.readFileSync(SHARED_UTILS_FILE, 'utf8');
  assert.ok(
    utilsSrc.includes('export const PRODUCT_EXPIRY_ALERT_DAYS = 60;'),
    'the shared expiry utils must define PRODUCT_EXPIRY_ALERT_DAYS',
  );
  assert.ok(
    utilsSrc.includes('export function evaluateProductExpiryStatus('),
    'the shared expiry utils must define evaluateProductExpiryStatus',
  );
  assert.ok(
    utilsSrc.includes('export function getProductExpiryDate('),
    'the shared expiry utils must define getProductExpiryDate',
  );
  assert.ok(
    utilsSrc.includes('export function productExpiryAlertLabel('),
    'the shared expiry utils must define productExpiryAlertLabel',
  );
  const referencing: string[] = [];
  const frontendFiles: string[] = [];
  walkTs(path.join(FRONTEND, 'src'), frontendFiles);
  for (const file of frontendFiles) {
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes('product-expiry.utils')) referencing.push(path.relative(FRONTEND, file));
    assert.ok(
      !src.includes('@/features/products/utils/product-expiry.utils'),
      `${path.relative(FRONTEND, file)} must not import the expiry utils from the old products path`,
    );
  }
  assert.deepEqual(
    referencing.sort(),
    ['src/shared/components/ProductCardModal.tsx', 'src/shared/utils/product-expiry.utils.spec.ts'],
    'only the moved spec and the shared modal may reference the expiry utils',
  );
  const modalSrc = fs.readFileSync(SHARED_MODAL, 'utf8');
  assert.ok(
    modalSrc.includes("from '@/shared/utils/product-expiry.utils';"),
    'the shared ProductCardModal must keep importing the expiry utils from the shared home',
  );
  const shim = fs.readFileSync(PRODUCTS_API_SHIM, 'utf8');
  assert.ok(
    shim.includes("from '@/shared/api/products.api';"),
    'the products api shim must still re-export from the shared home (untouched by this repair)',
  );
  const run = spawnSync('node', [ENVELOPE_CHECK], {
    cwd: FRONTEND,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `the Phase23 API envelope check must exit 0 (stderr: ${(run.stderr || '').trim()})`);
  assert.ok(
    (run.stdout || '').includes('Phase23 API envelope checks passed.'),
    'the Phase23 API envelope check must report passed',
  );

  // 2. The module-boundary pins move with F5k (rebased onto
  // fd67b46bb): frontend edges 46 -> 45, statements 116 -> 111,
  // pairs 2 -> 1; the backend pins do not move. Feature-boundary
  // baseline 63 -> 60; import-layer baseline stays 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5k',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5k',
  );
  assert.ok(
    boundary.includes("'products->inventory': 3,"),
    'the products->inventory edge must stay pinned at 3 (the surviving direction)',
  );
  assert.ok(
    !boundary.includes("'inventory|products'"),
    'the inventory|products pair must stay gone from the pair list',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must be exactly 57 after F5k');
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5J-REPAIR-EXPIRY-SPEC-IMPORT/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5j-REPAIR INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-PHASE1-D-M3-MAIL-NESTED/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5j-REPAIR INV exactly once');

  // 4. Wiring: both critical lists carry 394 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 397);
  assert.equal(chain.length, 397);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 394 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-d-m3-mail-nested.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-d-m3-mail-nested.spec.ts');
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
    ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
    ['F5j', F5J_SPEC],
    ['F5k', F5K_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 397);') && src.includes('assert.equal(chain.length, 397);'),
      `${label} spec wiring must re-pin to 394`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-d-m3-mail-nested.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5j-REPAIR spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5k spec, or pin
  // the old guard INV. (The live tree holds ~75 files asserting the
  // count — the #264-fix / D12 lesson. The F5k filename, the count
  // literals, the FE pin literals, the baseline literals and the old
  // INV id are built by concatenation so this block's own source
  // never contains the patterns it scans for. The scan covers all
  // three variable forms: specs, chain, and list.length; the
  // last-entry scan covers BOTH forms (specs[...] and chain[...] —
  // the F5j lesson: a specs-only pattern missed the chain form);
  // the baseline check is line-scoped, F5e lesson. The frontend
  // pins and baselines do NOT move in this repair, so the stale-pin
  // scan still targets the pre-F5j values (122/47, 64).)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const staleFePins: string[] = [];
  const staleBaseline: string[] = [];
  const prevName = 'phase1-f5k' + '-pos-products.spec.ts';
  const prevInv = 'INV-PHASE1-F5K' + '-POS-PRODUCTS-DECOUPLED';
  const staleSpecs = 'specs.length, 39' + '3';
  const staleChain = 'chain.length, 39' + '3';
  const staleList = 'list.length, 39' + '3';
  const staleFeTotal = "'const PINNED_FRONTEND_TOTAL = 12" + "2;'";
  const staleFeTotalAfter = "'module-boundary must pin the frontend total 12" + '2 after ';
  const staleFeTotalStill = "'module-boundary must still pin the frontend total 12" + "2'";
  const staleFeEdges = "'Object.keys(PINNED_FRONTEND_EDGES).length, 4" + "7,'";
  const staleFeEdgesAfter = "'module-boundary must pin 4" + '7 frontend edges after ';
  const staleFeEdgesStill = "'module-boundary must still pin 4" + "7 frontend edges'";
  const staleBaselineA = 'baseline.length, 6' + '4';
  const staleBaselineB = 'featureBaseline.length, 6' + '4';
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
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5k spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so F5j-REPAIR re-pins
  // the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/
  // F5i/F5h-REPAIR/F5h-REPAIR-2/F5j/F5k specs' guard assertions to the F5j-REPAIR
  // INV; their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
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
    ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
    ['F5j', F5J_SPEC],
    ['F5k', F5K_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-PHASE1-D-M3-MAIL-NESTED/g)'),
      `${label} spec guard assertion must re-pin to the F5j-REPAIR INV`,
    );
  }

  console.log(
    'phase1 F5j-REPAIR expiry spec checks passed (spec moved whole with its module, import resolves, 394 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
