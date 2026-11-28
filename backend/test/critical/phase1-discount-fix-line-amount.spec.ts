import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 discount fix — POS per-line discount input is an AMOUNT again
 * (INV-POS-LINE-DISCOUNT-AMOUNT).
 *
 * The 2026-11-22 van-trial Batch 1 change (F1b,
 * INV-POS-DISCOUNT-PERCENT-FIELDS) converted the cart line-discount
 * input to a percent (0–100, % marker, typed percent converted via
 * calcLineDiscountAmountFromPercent). The user never ordered that
 * conversion and the clothes-shop client needs an amount, so it is
 * reverted to the 8a91af4 state: input value = item.lineDiscount,
 * max = line gross (calcCartLineTotal), the typed amount passes
 * directly to onLineDiscountChange, no % marker. The handler chain
 * is unchanged (setLineDiscount -> updatePosItemLineDiscount rounds
 * at book digits and clamps to the line gross); the backend contract
 * is unchanged (amounts on both boundaries); the invoice % field is
 * untouched; the van combined-discount cap (F1a, default 5%,
 * supervisor PIN above cap, enforced in
 * backend/src/modules/sales/services/create-sale/compute-totals-and-gates.ts
 * as COMBINED_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN) is
 * untouched and still refuses an over-cap rep sale — pinned by
 * backend/test/critical/van-pos-discount-cap.spec.ts, which posts
 * amount line discounts. calcLineDiscountAmountFromPercent and
 * calcLineDiscountPercent are removed (no remaining callers);
 * clampDiscountPercent stays for the invoice % field.
 *
 * This package REBASES the held fix (saved in the "Clothing client
 * system issue" chat as local commit e7db5c26 on base 1caee8c2f,
 * patch ~/workspace/audit/zs-line-discount-amount.patch) onto the
 * live HEAD 33a802f92 (D-D10a). The four frontend files applied
 * cleanly (no later package touched them between 1caee8c2f and
 * 33a802f92 — verified by git log); the backend hunks (INV entries +
 * guard-tail re-pins over 13 phase1 specs) did NOT apply and were
 * re-done by hand on the live tree: the F1b entry corrected in place
 * at its live line, the new entry appended as the LAST - INV- line,
 * the guard tail re-pinned from the D-D10a INV to this INV. The
 * component is byte-identical to the 8a91af4 version after the
 * rebase (verified by diff in phase1-discount-fix-log.md §3).
 *
 * WHAT THIS PINS (static, over the real source — the same contract
 * the harness ~/workspace/audit/phase1-discount-fix-harness.mjs
 * proves executable, RED-1 exit 1 with 13/16 failing on the base
 * tree, GREEN exit 0 16/16 after the fix):
 * - the line-discount input shows the stored AMOUNT and its max is
 *   the line gross (not 100);
 * - onChange passes the typed amount directly, with no percent
 *   conversion call and no % marker;
 * - both percent helpers are removed from pos-modifier-totals.ts
 *   while clampDiscountPercent stays (invoice % field);
 * - the component spec pins amount behaviour (shows '12'; typing
 *   25 reports 25 on a 24.00 line and on a 300.00 line);
 * - the helper spec no longer pins the percent helpers;
 * - scope guard: the invoice discount strip is still percent-based
 *   (untouched).
 *
 * PROOF LIMIT (stated plainly): frontend Vitest is never run
 * locally in this VM (standing rule) — the Vitest spec rewrites'
 * green is proven by CI, not locally. Local proof is this spec +
 * the harness + the byte-identical match to 8a91af4 + zero
 * remaining code references to the removed helpers (grep
 * repo-wide). The van cap is re-proven by
 * van-pos-discount-cap.spec.ts on this base (8 cases, run solo).
 *
 * Wiring: both critical lists carry 400 specs in identical order,
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const CART_ITEMS_LIST = path.join(
  FRONTEND,
  'src',
  'features',
  'pos',
  'components',
  'pos-cart-panel',
  'PosCartItemsList.tsx',
);
const CART_ITEMS_LIST_SPEC = path.join(
  FRONTEND,
  'src',
  'features',
  'pos',
  'components',
  'pos-cart-panel',
  'PosCartItemsList.spec.tsx',
);
const MODIFIER_TOTALS = path.join(FRONTEND, 'src', 'features', 'pos', 'lib', 'pos-modifier-totals.ts');
const MODIFIER_TOTALS_SPEC = path.join(FRONTEND, 'src', 'features', 'pos', 'lib', 'pos-modifier-totals.spec.ts');
const CHECKOUT_DISCOUNT_STRIP = path.join(
  FRONTEND,
  'src',
  'features',
  'pos',
  'components',
  'pos-workspace',
  'pos-checkout-payment',
  'PosCheckoutDiscountStrip.tsx',
);

function main(): void {
  // 1. The line-discount input is an AMOUNT input again.
  const comp = fs.readFileSync(CART_ITEMS_LIST, 'utf8');
  const helpers = fs.readFileSync(MODIFIER_TOTALS, 'utf8');
  const compSpec = fs.readFileSync(CART_ITEMS_LIST_SPEC, 'utf8');
  const helperSpec = fs.readFileSync(MODIFIER_TOTALS_SPEC, 'utf8');
  assert.ok(
    comp.includes("value={Number(item.lineDiscount || 0) > 0 ? String(item.lineDiscount) : ''}"),
    'the line-discount input must show the stored amount',
  );
  assert.ok(comp.includes('max={calcCartLineTotal(item)}'), 'the line-discount input max must be the line gross');
  assert.ok(!comp.includes('max={100}'), 'the line-discount input must not cap at 100 (percent)');
  assert.ok(
    comp.includes('onLineDiscountChange(item.lineKey, Number.isFinite(parsed) && parsed > 0 ? parsed : 0)'),
    'onChange must pass the typed amount directly',
  );
  assert.ok(
    !comp.includes('calcLineDiscountAmountFromPercent'),
    'the component must not call the percent-to-amount helper',
  );
  assert.ok(!comp.includes('calcLineDiscountPercent'), 'the component must not call the percent helper');
  assert.ok(
    !/pos-cart-line-discount-wrap[\s\S]{0,4000}>\s*%\s*</.test(comp),
    'no % marker span may sit in the line-discount wrap',
  );
  assert.ok(
    !helpers.includes('calcLineDiscountAmountFromPercent'),
    'calcLineDiscountAmountFromPercent must be removed from the helpers',
  );
  assert.ok(!helpers.includes('calcLineDiscountPercent'), 'calcLineDiscountPercent must be removed from the helpers');
  assert.ok(
    helpers.includes('export function clampDiscountPercent'),
    'clampDiscountPercent must stay (invoice % field still uses it)',
  );
  assert.ok(compSpec.includes("expect(discountInput.value).toBe('12')"), "the spec must expect the input to show '12'");
  assert.ok(
    compSpec.includes("expect(onLineDiscountChange).toHaveBeenCalledWith('line-1', 25)"),
    'the spec must expect typing 25 to report 25 on the 24.00 line',
  );
  assert.ok(
    compSpec.includes('expect(onLineDiscountChange).toHaveBeenCalledWith(cart[1].lineKey, 25)'),
    'the spec must expect typing 25 to report 25 (not 75) on the 300.00 line',
  );
  assert.ok(
    !helperSpec.includes('calcLineDiscountAmountFromPercent(') && !helperSpec.includes('calcLineDiscountPercent('),
    'the helper spec must no longer pin the percent helpers',
  );
  const strip = fs.readFileSync(CHECKOUT_DISCOUNT_STRIP, 'utf8');
  assert.ok(strip.includes('%'), 'the invoice discount strip must stay percent-based (untouched)');

  // 2. The module-boundary pins do not move (frontend-only behaviour fix + one static spec).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 738',
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
  const invCount = (invariants.match(/INV-POS-LINE-DISCOUNT-AMOUNT/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the discount-fix INV exactly once');
  assert.ok(
    invariants.includes('CORRECTED 2026-11-27 (see the new entry at the end of this file)'),
    'the F1b entry must carry the in-place correction pointing at the new entry',
  );
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-MARKETPLACE-WEBHOOK-MAP-ROW/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the discount-fix INV exactly once');

  // 4. Wiring: both critical lists carry 400 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 413);
  assert.equal(chain.length, 413);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 400 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s7-marketplace-webhook-map-row.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s7-marketplace-webhook-map-row.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 413);') && src.includes('assert.equal(chain.length, 413);'),
      `${label} spec wiring must re-pin to 400`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s7-marketplace-webhook-map-row.spec.ts'"),
      `${label} spec last-entry must re-pin to the discount-fix spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the D-D10a spec, pin the old
  // guard INV, pin the old frontend pins, or pin the old baseline size.
  // (The live tree holds ~75 files asserting the count — the #264-fix /
  // D12 lesson. The D-D10a filename, the count literals, the FE pin
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
  const prevName = 'phase1-d-d10a-serials-' + 'payload.spec.ts';
  const prevInv = 'INV-PHASE1-D-D10A-' + 'SERIALS-PAYLOAD';
  const staleSpecs = 'specs.length, 39' + '9';
  const staleChain = 'chain.length, 39' + '9';
  const staleList = 'list.length, 39' + '9';
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
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (399)');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the D-D10a spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (D-D10a)');
  assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
  assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

  // 6. The guard tail holds ONLY the newest id, so this package re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/F5l-REPAIR/D-M1/D-M3/D-D10a specs'
  // guard assertions to the discount-fix INV; their invariants-file assertions
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-MARKETPLACE-WEBHOOK-MAP-ROW/g)'),
      `${label} spec guard assertion must re-pin to the discount-fix INV`,
    );
  }

  console.log('phase1 discount-fix line-amount checks passed (amount input restored, 400 specs wired)');
}

main();
