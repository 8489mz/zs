import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5e — break the accounting|treasury frontend circular pair
 * (INV-PHASE1-F5E-ACCOUNTING-TREASURY-DECOUPLED).
 *
 * Grounding §7 row 5 / §8 F5e (phase1-f0-grounding.md), re-derived live
 * at 1caee8c2f: accounting|treasury, module-boundary counts 2/1, ONE
 * deep leg:
 * - treasury -> accounting (1): treasury/components/
 *   TreasuryExpenseEntryCard.tsx:16 imports costCentersApi from
 *   '@/features/accounting/api/cost-centers.api' (queryKey
 *   ['accounting-cost-centers'], queryFn costCentersApi.list — the
 *   card's ONLY useQuery use; the fetched list feeds the cost-center
 *   dropdown, filtered to active centres, labelled
 *   `${center.code} - ${center.name}`).
 * - accounting -> treasury (2): accounting/pages/
 *   BankReconciliationPage.tsx:17 and PdcChequesPage.tsx:25 import
 *   TreasuryNavTabs from '@/features/treasury' (public index).
 * These are the ONLY cross imports in either direction, in ANY form
 * (verified live: no other treasury file imports from accounting — no
 * spec file either — no other accounting file imports from treasury,
 * no relative cross imports).
 *
 * NOTE on the brief's suggested mechanism: the brief says "break
 * treasury -> accounting by routing the deep import through the
 * accounting public index". That does NOT break the pair: F3 proved
 * routing through a public index does NOT reduce the module-boundary
 * count (the statement stays on the same edge), and a pair breaks
 * ONLY when one direction's statements reach 0 (grounding §7 note,
 * applied in F5d). The brief itself allows the fallback ("if
 * re-routing alone leaves the statement, move the code or invert
 * instead"). F5e therefore follows the F5b/F5c/F5d precedent and
 * moves the usage into the shared catalog hook:
 * frontend/src/shared/hooks/use-catalog-queries.ts is the established
 * home for cross-feature catalog queries (it already imports
 * products/sales/purchases/customers/suppliers/settings/maintenance
 * APIs), and shared imports are not feature edges. The new hook
 * useCostCentersQuery() carries the card's query VERBATIM — same
 * queryKey ['accounting-cost-centers'], same queryFn
 * costCentersApi.list — so the query object is identical and no
 * behaviour can change (same cache key, same list fetch, same
 * CostCenterRecord[] shape; the card's costCenterOptions
 * construction is byte-identical apart from the hook). The card
 * re-points to the hook and drops its costCentersApi + useQuery
 * imports (its only useQuery use was this query). (The accounting
 * public index does NOT export costCentersApi, so the brief's route
 * would also have needed an index change; the shared hook needs
 * none.) The accounting -> treasury direction stays
 * (BankReconciliationPage + PdcChequesPage keep their TreasuryNavTabs
 * imports) — breaking ONE direction is enough for the pair to be
 * gone. Both indices keep their public surfaces (accounting:
 * accountingRouteModule + isCashBankAccount + accountingApi;
 * treasury: TreasuryPage + treasuryRouteModule + TreasuryNavTabs).
 * No frontend spec renders the card (no TreasuryExpenseEntryCard
 * spec exists), so no mock needs the new hook. Frontend vitest is
 * CI-only (no frontend node_modules in this VM), so the hook shape
 * is pinned here by static assertions.
 *
 * Consequences, all re-pinned in this package:
 * - treasury -> accounting: 1 -> 0; accounting -> treasury stays 2.
 * - Frontend edges 52 -> 51, statements 132 -> 131, pairs 8 -> 7
 *   ('accounting|treasury' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline 67 -> 66 (the one deep
 *   TreasuryExpenseEntryCard string is gone — hand-shrunk by exactly
 *   that one string, F3/F5c/F5d precedent); import-layer baseline
 *   stays 152 (no app-layer string moves in this package).
 * - Wiring: both critical lists carry 385 specs in identical order,
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
const SHARED_HOOKS = path.join(FRONTEND, 'src', 'shared', 'hooks');
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const EXPENSE_CARD = path.join(FEATURES, 'treasury', 'components', 'TreasuryExpenseEntryCard.tsx');
const BANK_REC_PAGE = path.join(FEATURES, 'accounting', 'pages', 'BankReconciliationPage.tsx');
const PDC_PAGE = path.join(FEATURES, 'accounting', 'pages', 'PdcChequesPage.tsx');
const CATALOG_HOOKS = path.join(SHARED_HOOKS, 'use-catalog-queries.ts');
const ACCOUNTING_INDEX = path.join(FEATURES, 'accounting', 'index.ts');
const TREASURY_INDEX = path.join(FEATURES, 'treasury', 'index.ts');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The treasury -> accounting direction is gone; the accounting
  // -> treasury direction stays. The shared hook carries the card's
  // query verbatim; the card re-points to it; both public indices
  // keep their surface unchanged.
  const treasuryFiles: string[] = [];
  walkTs(path.join(FEATURES, 'treasury'), treasuryFiles);
  const stillAccounting: string[] = [];
  for (const file of treasuryFiles) {
    if (fs.readFileSync(file, 'utf8').includes("from '@/features/accounting")) {
      stillAccounting.push(path.relative(FEATURES, file));
    }
  }
  assert.deepEqual(stillAccounting, [], "no treasury file may still import from '@/features/accounting'");
  const card = fs.readFileSync(EXPENSE_CARD, 'utf8');
  assert.ok(
    card.includes("import { useCostCentersQuery } from '@/shared/hooks/use-catalog-queries';"),
    'TreasuryExpenseEntryCard must import useCostCentersQuery from the shared catalog hooks',
  );
  assert.ok(
    !card.includes("from '@/features/accounting"),
    'TreasuryExpenseEntryCard must not import from the accounting feature anymore',
  );
  assert.ok(
    !card.includes('useQuery'),
    'TreasuryExpenseEntryCard must not call useQuery anymore (its only use was the cost-centers query)',
  );
  assert.ok(
    card.includes('const { data: costCenters = [] } = useCostCentersQuery();'),
    'TreasuryExpenseEntryCard must get the cost centers from the shared hook',
  );
  assert.ok(
    !card.includes("['accounting-cost-centers']"),
    'TreasuryExpenseEntryCard must keep no inline accounting-cost-centers queryKey (the hook carries it)',
  );
  assert.ok(
    !card.includes('costCentersApi.list'),
    'TreasuryExpenseEntryCard must keep no inline costCentersApi.list call (the hook carries it)',
  );
  assert.ok(
    card.includes('.filter((c) => c.isActive)'),
    'TreasuryExpenseEntryCard must keep filtering the cost centers to active ones',
  );
  assert.ok(
    card.includes('label: `${center.code} - ${center.name}`'),
    'TreasuryExpenseEntryCard must keep the cost-center option label identical',
  );
  const hooks = fs.readFileSync(CATALOG_HOOKS, 'utf8');
  assert.ok(
    hooks.includes('export function useCostCentersQuery() {'),
    'the shared catalog hooks must export useCostCentersQuery',
  );
  assert.ok(
    hooks.includes("queryKey: ['accounting-cost-centers'],"),
    'the shared hook must keep the accounting-cost-centers queryKey verbatim',
  );
  assert.ok(
    hooks.includes('queryFn: costCentersApi.list'),
    'the shared hook must keep the costCentersApi.list queryFn verbatim',
  );
  assert.ok(
    hooks.includes("import { costCentersApi } from '@/features/accounting/api/cost-centers.api';"),
    'the shared catalog hooks must import costCentersApi from the accounting api (shared imports are not edges)',
  );
  const bankRec = fs.readFileSync(BANK_REC_PAGE, 'utf8');
  assert.ok(
    bankRec.includes("import { TreasuryNavTabs } from '@/features/treasury';"),
    'BankReconciliationPage must keep its TreasuryNavTabs import (the surviving direction)',
  );
  const pdc = fs.readFileSync(PDC_PAGE, 'utf8');
  assert.ok(
    pdc.includes("import { TreasuryNavTabs } from '@/features/treasury';"),
    'PdcChequesPage must keep its TreasuryNavTabs import (the surviving direction)',
  );
  const accountingIndex = fs.readFileSync(ACCOUNTING_INDEX, 'utf8');
  assert.ok(
    accountingIndex.includes("export { accountingApi } from '@/features/accounting/api/accounting.api';"),
    'the accounting index must still re-export accountingApi (public surface unchanged)',
  );
  assert.ok(
    accountingIndex.includes("export { isCashBankAccount } from '@/features/accounting/api/accounting.api';"),
    'the accounting index must still re-export isCashBankAccount (public surface unchanged)',
  );
  assert.ok(
    accountingIndex.includes("export { accountingRouteModule } from '@/features/accounting/routes';"),
    'the accounting index must still re-export accountingRouteModule (public surface unchanged)',
  );
  const treasuryIndex = fs.readFileSync(TREASURY_INDEX, 'utf8');
  assert.ok(
    treasuryIndex.includes("export { TreasuryNavTabs } from '@/features/treasury/components/TreasuryNavTabs';"),
    'the treasury index must still re-export TreasuryNavTabs (public surface unchanged)',
  );
  assert.ok(
    treasuryIndex.includes("export { treasuryRouteModule } from '@/features/treasury/routes';"),
    'the treasury index must still re-export treasuryRouteModule (public surface unchanged)',
  );

  // 2. The module-boundary pins move: frontend edges 52 -> 51,
  // statements 132 -> 131, pairs 8 -> 7 ('accounting|treasury'
  // gone); the backend pins do not move. The feature-boundary
  // baseline shrinks 67 -> 66 (the one deep TreasuryExpenseEntryCard
  // string is gone); the import-layer baseline stays 152.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5e',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5e',
  );
  assert.ok(
    !boundary.includes("'treasury->accounting': 1,"),
    'the treasury->accounting frontend edge (pinned at 1) must be gone from the edge table',
  );
  assert.ok(
    boundary.includes("'treasury->accounting': 5,"),
    'the treasury->accounting BACKEND edge must stay pinned at 5 (backend pins do not move)',
  );
  assert.ok(
    boundary.includes("'accounting->treasury': 2,"),
    'the accounting->treasury edge must stay pinned at 2 (the surviving direction)',
  );
  assert.ok(
    !boundary.includes("'accounting|treasury'"),
    'the accounting|treasury pair must be gone from the pair list',
  );
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must shrink to exactly 57 after F5e');
  assert.ok(
    !featureBaseline.some(
      (entry) => entry.includes('TreasuryExpenseEntryCard') && entry.includes('@/features/accounting'),
    ),
    'the deep TreasuryExpenseEntryCard string must be gone from the feature-boundary baseline',
  );
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5e');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5E-ACCOUNTING-TREASURY-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5e INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-MFA-BEGIN-SETUP-ON-CONFLICT-42702/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5e INV exactly once');

  // 4. Wiring: both critical lists carry 385 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 436);
  assert.equal(chain.length, 436);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 385 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 436);') && src.includes('assert.equal(chain.length, 436);'),
      `${label} spec wiring must re-pin to 385`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5e spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F5d spec. (The
  // live tree holds ~57 files asserting the count — the #264-fix /
  // D12 lesson. The F5d filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f5dName = 'phase1-f5d' + '-maintenance-products.spec.ts';
  const staleSpecs = 'specs.length, 38' + '4';
  const staleChain = 'chain.length, 38' + '4';
  const staleList = 'list.length, 38' + '4';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5dName}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5d spec');

  // 6. The guard tail holds ONLY the newest id, so F5e re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d specs' guard assertions to
  // the F5e INV; their invariants-file assertions still pin their own
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-MFA-BEGIN-SETUP-ON-CONFLICT-42702/g)'),
      `${label} spec guard assertion must re-pin to the F5e INV`,
    );
  }

  console.log(
    'phase1 F5e accounting|treasury checks passed (cost centers via shared catalog hook, treasury->accounting gone, pairs 8->7, edges 51 / statements 131, 385 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
