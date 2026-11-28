import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5f — break the cash-drawer|pos frontend circular pair
 * (INV-PHASE1-F5F-CASH-DRAWER-POS-DECOUPLED).
 *
 * Grounding §7 row 6 / §8 F5f (phase1-f0-grounding.md), re-derived live
 * at df503d347: cash-drawer|pos, module-boundary counts 2/1, ONE deep
 * leg (already removed by F3):
 * - cash-drawer -> pos (2): cash-drawer/components/
 *   CashDrawerFormsPanel.tsx:10 imports getOfflineSalesQueue from
 *   '@/features/pos' (public index — the F3 leg, now index-routed);
 *   cash-drawer/hooks/useCashDrawerMutations.ts:12 imports
 *   getPosTerminalCode from '@/features/pos' (public index).
 * - pos -> cash-drawer (1): pos/components/pos-workspace/
 *   pos-workspace-header/PosWorkspaceHeaderShiftControls.tsx:10
 *   imports printXReport from '@/features/cash-drawer' (public index).
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other pos file imports from cash-drawer — no spec
 * file either — no other cash-drawer file imports from pos, no
 * relative cross imports).
 *
 * The break: move the shift-receipt module WHOLE (git mv) to shared.
 * frontend/src/features/cash-drawer/utils/cash-drawer-receipt.ts
 * (388L) is receipt HTML generation + printing — used by BOTH
 * features, and its own imports are all non-feature
 * (@/lib/browser, @/lib/format, @/lib/currencies, @/types/domain),
 * so the moved file has zero feature dependencies and is a pure
 * shared util. Its colocated spec moves with it (relative import
 * './cash-drawer-receipt' keeps resolving). The pos header re-points
 * to '@/shared/utils/cash-drawer-receipt'; the three cash-drawer
 * internal importers re-point to the same shared path; the
 * cash-drawer index keeps re-exporting printXReport + printZReport
 * from the shared path (public surface unchanged, F5a precedent).
 * The function bodies move byte-identical — the X-report call sites
 * in the header are byte-identical, and the money-strict I25
 * components (customerCollections + cancelledSaleCash in the
 * expected-cash formula) are pinned here so the move cannot silently
 * drop them. Carbon's print/system speed-up code is untouched: the
 * receipt module still calls the same printHtmlDocument from
 * '@/lib/browser'; no print path, bridge, or PERF logic changes.
 * The cash-drawer -> pos direction stays (both index imports) —
 * breaking ONE direction is enough for the pair to be gone.
 *
 * Consequences, all re-pinned in this package:
 * - pos -> cash-drawer: 1 -> 0; cash-drawer -> pos stays 2.
 * - Frontend edges 51 -> 50, statements 131 -> 130, pairs 7 -> 6
 *   ('cash-drawer|pos' gone). Backend pins unmoved (63 / 736, total 738).
 * - Baselines unmoved: feature-boundary stays 66 and import-layer
 *   stays 152 (both cross imports are bare public-index imports, so
 *   no baseline string moves in this package).
 * - Wiring: both critical lists carry 386 specs in identical order,
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
const SHARED_UTILS = path.join(FRONTEND, 'src', 'shared', 'utils');
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const HEADER = path.join(
  FEATURES,
  'pos',
  'components',
  'pos-workspace',
  'pos-workspace-header',
  'PosWorkspaceHeaderShiftControls.tsx',
);
const RECEIPT_OLD = path.join(FEATURES, 'cash-drawer', 'utils', 'cash-drawer-receipt.ts');
const RECEIPT_NEW = path.join(SHARED_UTILS, 'cash-drawer-receipt.ts');
const RECEIPT_SPEC_OLD = path.join(FEATURES, 'cash-drawer', 'utils', 'cash-drawer-receipt.spec.ts');
const RECEIPT_SPEC_NEW = path.join(SHARED_UTILS, 'cash-drawer-receipt.spec.ts');
const CASH_DRAWER_INDEX = path.join(FEATURES, 'cash-drawer', 'index.ts');
const POS_INDEX = path.join(FEATURES, 'pos', 'index.ts');
const CLOSE_FORM = path.join(FEATURES, 'cash-drawer', 'components', 'cash-drawer-forms', 'CashDrawerCloseForm.tsx');
const REVIEW_DIALOG = path.join(FEATURES, 'cash-drawer', 'components', 'CashDrawerReviewDialog.tsx');
const SHIFTS_CARD = path.join(FEATURES, 'cash-drawer', 'components', 'CashDrawerShiftsCard.tsx');
const FORMS_PANEL = path.join(FEATURES, 'cash-drawer', 'components', 'CashDrawerFormsPanel.tsx');
const MUTATIONS = path.join(FEATURES, 'cash-drawer', 'hooks', 'useCashDrawerMutations.ts');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The pos -> cash-drawer direction is gone; the cash-drawer ->
  // pos direction stays. The receipt module moved whole to shared;
  // the header re-points to it; the cash-drawer internal importers
  // re-point to it; both public indices keep their surface.
  const posFiles: string[] = [];
  walkTs(path.join(FEATURES, 'pos'), posFiles);
  const stillCashDrawer: string[] = [];
  for (const file of posFiles) {
    if (fs.readFileSync(file, 'utf8').includes("from '@/features/cash-drawer")) {
      stillCashDrawer.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillCashDrawer, [], "no pos file may still import from '@/features/cash-drawer'");
  const header = fs.readFileSync(HEADER, 'utf8');
  assert.ok(
    header.includes("import { printXReport } from '@/shared/utils/cash-drawer-receipt';"),
    'PosWorkspaceHeaderShiftControls must import printXReport from the shared receipt module',
  );
  assert.ok(
    !header.includes("from '@/features/cash-drawer"),
    'PosWorkspaceHeaderShiftControls must not import from the cash-drawer feature anymore',
  );
  assert.ok(
    header.includes('printXReport((fresh || pos.ownOpenShift) as any, settings?.storeName);'),
    'the X-report call site with the fresh shift must stay byte-identical',
  );
  assert.ok(
    header.includes('printXReport(pos.ownOpenShift as any, settings?.storeName);'),
    'the X-report fallback call site must stay byte-identical',
  );
  assert.ok(fs.existsSync(RECEIPT_NEW), 'the receipt module must exist at the shared path');
  assert.ok(
    !fs.existsSync(RECEIPT_OLD),
    'the receipt module must be gone from the cash-drawer feature (moved, not copied)',
  );
  const receipt = fs.readFileSync(RECEIPT_NEW, 'utf8');
  assert.ok(
    receipt.includes('export function printXReport(shift: CashierShift, storeName?: string): void {'),
    'the shared receipt module must export printXReport with the identical signature',
  );
  assert.ok(
    receipt.includes("printCashDrawerShiftReceipt(shift, storeName, { reportType: 'X' });"),
    'printXReport must still delegate to printCashDrawerShiftReceipt with reportType X',
  );
  assert.ok(
    receipt.includes('export function printZReport(shift: CashierShift, storeName?: string): void {'),
    'the shared receipt module must export printZReport with the identical signature',
  );
  assert.ok(
    receipt.includes("printCashDrawerShiftReceipt(shift, storeName, { reportType: 'Z' });"),
    'printZReport must still delegate to printCashDrawerShiftReceipt with reportType Z',
  );
  assert.ok(
    receipt.includes('export function generateCashDrawerSettlementReceiptHtml('),
    'the shared receipt module must still export generateCashDrawerSettlementReceiptHtml',
  );
  assert.ok(
    receipt.includes('export function printCashDrawerShiftReceipt('),
    'the shared receipt module must still export printCashDrawerShiftReceipt',
  );
  assert.ok(
    receipt.includes('export interface ShiftReceiptOptions'),
    'the shared receipt module must still export ShiftReceiptOptions',
  );
  assert.ok(
    receipt.includes('const customerCollections = Number(shift.customerCollectionsTotal || 0);'),
    'the shared receipt module must keep the I25 customer-collections component (money-strict)',
  );
  assert.ok(
    receipt.includes('const cancelledSaleCash = Number(shift.cancelledSaleCashTotal || 0);'),
    'the shared receipt module must keep the I25 cancelled-sale-cash component (money-strict)',
  );
  assert.ok(
    receipt.includes('INV-REST-SHIFT-CLOSE-CONTROL'),
    'the shared receipt module must keep the I25 invariant comment',
  );
  assert.ok(
    receipt.includes("import { escapeHtml, printHtmlDocument } from '@/lib/browser';"),
    'the shared receipt module must keep the same print call (Carbon print path untouched)',
  );
  assert.ok(
    !receipt.includes('@/features/'),
    'the shared receipt module must import nothing from any feature (pure shared util)',
  );
  assert.ok(fs.existsSync(RECEIPT_SPEC_NEW), 'the receipt spec must move with the code to shared');
  assert.ok(!fs.existsSync(RECEIPT_SPEC_OLD), 'the receipt spec must be gone from the cash-drawer feature');
  const receiptSpec = fs.readFileSync(RECEIPT_SPEC_NEW, 'utf8');
  assert.ok(
    receiptSpec.includes("import { generateCashDrawerSettlementReceiptHtml } from './cash-drawer-receipt';"),
    'the moved receipt spec must keep its relative import of the moved module',
  );
  const cashDrawerIndex = fs.readFileSync(CASH_DRAWER_INDEX, 'utf8');
  assert.ok(
    cashDrawerIndex.includes("export { printXReport, printZReport } from '@/shared/utils/cash-drawer-receipt';"),
    'the cash-drawer index must still re-export printXReport + printZReport, now from shared',
  );
  assert.ok(
    cashDrawerIndex.includes("export { CashDrawerPage } from '@/features/cash-drawer/pages/CashDrawerPage';"),
    'the cash-drawer index must still re-export CashDrawerPage (public surface unchanged)',
  );
  assert.ok(
    cashDrawerIndex.includes("export { cashDrawerRouteModule } from '@/features/cash-drawer/routes';"),
    'the cash-drawer index must still re-export cashDrawerRouteModule (public surface unchanged)',
  );
  const closeForm = fs.readFileSync(CLOSE_FORM, 'utf8');
  assert.ok(
    closeForm.includes("import { printZReport } from '@/shared/utils/cash-drawer-receipt';"),
    'CashDrawerCloseForm must import printZReport from the shared receipt module',
  );
  assert.ok(
    closeForm.includes('printZReport(selectedCloseShift)'),
    'CashDrawerCloseForm must keep its printZReport call site',
  );
  const reviewDialog = fs.readFileSync(REVIEW_DIALOG, 'utf8');
  assert.ok(
    reviewDialog.includes("import { printCashDrawerShiftReceipt } from '@/shared/utils/cash-drawer-receipt';"),
    'CashDrawerReviewDialog must import printCashDrawerShiftReceipt from the shared receipt module',
  );
  const shiftsCard = fs.readFileSync(SHIFTS_CARD, 'utf8');
  assert.ok(
    shiftsCard.includes("import { printCashDrawerShiftReceipt } from '@/shared/utils/cash-drawer-receipt';"),
    'CashDrawerShiftsCard must import printCashDrawerShiftReceipt from the shared receipt module',
  );
  const formsPanel = fs.readFileSync(FORMS_PANEL, 'utf8');
  assert.ok(
    formsPanel.includes("import { getOfflineSalesQueue } from '@/features/pos';"),
    'CashDrawerFormsPanel must keep its getOfflineSalesQueue import (the surviving direction)',
  );
  const mutations = fs.readFileSync(MUTATIONS, 'utf8');
  assert.ok(
    mutations.includes("import { getPosTerminalCode } from '@/features/pos';"),
    'useCashDrawerMutations must keep its getPosTerminalCode import (the surviving direction)',
  );
  const posIndex = fs.readFileSync(POS_INDEX, 'utf8');
  assert.ok(
    posIndex.includes("export { getPosTerminalCode } from '@/features/pos/lib/pos-offline-sync';"),
    'the pos index must still re-export getPosTerminalCode (public surface unchanged)',
  );
  assert.ok(
    posIndex.includes("export { getOfflineSalesQueue } from '@/features/pos/lib/pos-offline-sync';"),
    'the pos index must still re-export getOfflineSalesQueue (public surface unchanged)',
  );

  // 2. The module-boundary pins move: frontend edges 51 -> 50,
  // statements 131 -> 130, pairs 7 -> 6 ('cash-drawer|pos' gone);
  // the backend pins do not move. Both baselines stay (66 / 152).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5f',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5f',
  );
  assert.ok(
    !boundary.includes("'pos->cash-drawer': 1,"),
    'the pos->cash-drawer frontend edge (pinned at 1) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'cash-drawer->pos': 2,"),
    'the cash-drawer->pos edge must stay pinned at 2 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'cash-drawer|pos'"), 'the cash-drawer|pos pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57 after F5f');
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5f');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5F-CASH-DRAWER-POS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5f INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-TEST-FILE-WIRING-S9/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5f INV exactly once');

  // 4. Wiring: both critical lists carry 386 specs in identical order, this spec last.
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
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 386 specs in order');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 425);') && src.includes('assert.equal(chain.length, 425);'),
      `${label} spec wiring must re-pin to 386`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5f spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F5e spec. (The
  // live tree holds ~67 files asserting the count — the #264-fix /
  // D12 lesson. The F5e filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f5eName = 'phase1-f5e' + '-accounting-treasury.spec.ts';
  const staleSpecs = 'specs.length, 38' + '5';
  const staleChain = 'chain.length, 38' + '5';
  const staleList = 'list.length, 38' + '5';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5eName}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5e spec');

  // 6. The guard tail holds ONLY the newest id, so F5f re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e specs' guard assertions to
  // the F5f INV; their invariants-file assertions still pin their own
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-TEST-FILE-WIRING-S9/g)'),
      `${label} spec guard assertion must re-pin to the F5f INV`,
    );
  }

  console.log(
    'phase1 F5f cash-drawer|pos checks passed (shift receipt to shared, pos->cash-drawer gone, pairs 7->6, edges 50 / statements 130, 386 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
