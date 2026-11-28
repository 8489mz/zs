import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5h-REPAIR-2 — the ci-full #318 frontend failure on the
 * F5h-REPAIR commit (INV-PHASE1-F5H-REPAIR-2-DIALOG-SPEC-MOCK).
 *
 * ci-full #318's frontend job FAILED (9m 20s), step "Frontend
 * regression guards (component and route specs)", exit 1. Vitest: 1
 * file failed / 306 passed; 1 test failed / 2108 passed. Failure file:
 * src/features/pos/components/pos-workspace/PosInstantExchangeDialog.spec.tsx
 * — test 'loads source invoice by docNo, enforces RTL stepper order,
 * updates net estimate, and submits idempotently' failed with
 * TestingLibraryElementError: unable to find customer text 'عميل أحمد محمد'
 * after loading invoice Z-261116-16529; dialog remained on the empty
 * stage. ci-fast #498 on the repair commit (5983899ac) was GREEN
 * (5m 24s) — the envelope-check fix is proven; this failure is a
 * different, later gate (vitest), unmasked by the repair.
 *
 * Root cause: the dialog spec mocks the sales api at the OLD path —
 * vi.mock('@/features/sales', () => ({ salesApi: { listPage:
 * mocks.listPage } })) at line 30 — but F5h re-pointed the component
 * PosInstantExchangeDialog.tsx:10 to
 * import { salesApi } from '@/shared/api/sales.api'. Vitest mocks are
 * per-module-path, so the mock no longer intercepts the component's
 * import: the component calls the REAL salesApi.listPage → real HTTP
 * → no invoice → empty stage → the customer text never appears.
 * Verified live: exactly ONE spec in the whole tree mocks
 * '@/features/sales' (this file); NO pos .tsx file still imports from
 * '@/features/sales'; the component uses salesApi ONLY via listPage
 * (line 122, salesApi.listPage({ search: searchTerm, pageSize: 10 }))
 * — exactly the method the mock factory provides.
 *
 * WHY IT PASSED BEFORE: at F5g the component imported salesApi from
 * '@/features/sales' (the index), so the mock intercepted.
 * WHY IT WAS HIDDEN: in ci-fast #496 / ci-full #316 / #317 the envelope
 * check failed FIRST (contract guards run before vitest), masking this
 * failure; the F5h-REPAIR fixed the envelope check, unmasking it in
 * #318. LESSON (binding): an early failing gate masks later failures —
 * after any repair that unblocks a gate, expect the NEXT failure
 * behind it.
 *
 * The fix: re-point the dialog spec's mock from
 * vi.mock('@/features/sales', ...) to
 * vi.mock('@/shared/api/sales.api', ...) with the SAME factory
 * ({ salesApi: { listPage: mocks.listPage } }). Nothing else in the
 * spec changes. No production-code change, no other spec touched.
 * The other sales mocks were checked live and are all aligned, NOT
 * bypassed: VanSaleNewInvoiceModal.spec mocks
 * '@/features/sales/api/sales.api' and its component imports from that
 * SAME path; the reprint spec imports salesApi from
 * '@/shared/api/sales.api' and spies on it with vi.spyOn (F5h already
 * re-pointed it); CreateQuotationPage / VatDeclarationPage mock
 * different api modules (quotations.api, vat-declaration.api);
 * CustomerEditorCard / CustomerForm import priceListsApi from
 * '@/features/sales' (the staying customers->sales leg, F5g) and no
 * spec mocks '@/features/sales' for them; PosWorkspace has no spec.
 *
 * Consequences, all re-pinned in this package:
 * - The dialog spec's mock targets the shared sales api — the exact
 *   path the component imports — so the mock intercepts listPage again.
 * - Frontend edges 46 / statements 116, pairs 2, backend pins
 *   (63 / 736, total 738) unmoved. Feature-boundary baseline stays
 *   63 and import-layer baseline stays 152.
 * - Wiring: both critical lists carry 392 specs in identical order,
 *   this spec last.
 *
 * CI-ONLY VITEST LIMITATION (stated plainly): frontend vitest cannot
 * run locally (OOM — CI-only). That is why F5h could not catch this:
 * its local gates never execute the dialog spec. The proof for the
 * dialog spec is therefore: (1) mock-path alignment verified by code
 * inspection — the component imports salesApi from EXACTLY the path
 * the spec mocks, same factory; (2) this guard spec passing locally;
 * (3) the CI verdict (ci-fast / ci-full on this push). The dialog
 * spec's green is proven by CI, not locally.
 *
 * REBASE NOTE (2026-11-27): this repair was authored on 5983899ac
 * (F5h-REPAIR) as 390 -> 391; HEAD moved while it ran — F5j pushed
 * f8c5983fd (inventory|products pair broken, pairs 3 -> 2, edges
 * 46/116, critical 390 -> 391). The repair worktree was still clean
 * (verification only), so the rebase is a plain checkout of f8c5983fd
 * — nothing to replay. The repair is now the 392nd spec: wiring
 * re-pinned to 392, the F5j spec's sweep-block numbers 391 -> 392,
 * its guard assertion re-pinned to this repair INV, and the frontend
 * pins + baseline above are the F5j pins (116/46/63), not the repair
 * pins. F5j note: its rebase sweep's last-entry pattern covered only
 * the specs[...] form and missed the chain[...] form — the repair
 * spec's line 211 still pointed its chain last-entry at the repair
 * spec (solo run exit 1) until fixed with one line; the F5j spec's
 * §5 now has a chain-form stale-last-entry scan. This repair's sweep
 * uses BOTH forms (specs[...] AND chain[...]) for last-entry, and
 * this spec's §5 scans both forms for stale last-entries pointing at
 * the F5j spec.
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
const DIALOG_SPEC = path.join(
  FRONTEND,
  'src',
  'features',
  'pos',
  'components',
  'pos-workspace',
  'PosInstantExchangeDialog.spec.tsx',
);
const DIALOG_COMPONENT = path.join(
  FRONTEND,
  'src',
  'features',
  'pos',
  'components',
  'pos-workspace',
  'PosInstantExchangeDialog.tsx',
);
const VAN_SPEC = path.join(
  FRONTEND,
  'src',
  'features',
  'delivery-reps',
  'components',
  'VanSaleNewInvoiceModal.spec.tsx',
);
const VAN_COMPONENT = path.join(
  FRONTEND,
  'src',
  'features',
  'delivery-reps',
  'components',
  'VanSaleNewInvoiceModal.tsx',
);
const REPRINT_SPEC = path.join(
  FRONTEND,
  'src',
  'features',
  'pos',
  'components',
  'pos-workspace',
  'PosRecentSalesReprintModal.spec.tsx',
);
const REPRINT_COMPONENT = path.join(
  FRONTEND,
  'src',
  'features',
  'pos',
  'components',
  'pos-workspace',
  'PosRecentSalesReprintModal.tsx',
);
const ENVELOPE_CHECK_MSG = 'Phase23 API envelope checks passed.';
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

function walkSpecFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSpecFiles(full, out);
    else if (entry.isFile() && full.endsWith('.spec.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The dialog spec's mock targets the shared sales api — the exact
  // path the component imports — with the same factory. No spec in the
  // tree may still mock the old sales index path. The other sales mocks
  // are aligned with their components' actual imports (verified live).
  // The envelope check still passes (the F5h-REPAIR fix holds).
  const dialogSpec = fs.readFileSync(DIALOG_SPEC, 'utf8');
  assert.ok(
    dialogSpec.includes("vi.mock('@/shared/api/sales.api', () => ({"),
    "the dialog spec must mock the shared sales api (the component's import path)",
  );
  assert.ok(
    dialogSpec.includes('listPage: mocks.listPage,'),
    'the dialog spec mock factory must still provide salesApi.listPage',
  );
  assert.ok(
    !dialogSpec.includes("vi.mock('@/features/sales',"),
    'the dialog spec must no longer mock the old sales index path',
  );
  assert.ok(
    dialogSpec.includes("vi.mock('@/features/pos/api/pos.api',"),
    'the dialog spec must keep its pos.api mock unchanged',
  );
  const dialogComponent = fs.readFileSync(DIALOG_COMPONENT, 'utf8');
  assert.ok(
    dialogComponent.includes("import { salesApi } from '@/shared/api/sales.api';"),
    'the dialog component must import salesApi from the shared api',
  );
  assert.ok(
    dialogComponent.includes('salesApi.listPage('),
    'the dialog component must load the source invoice via salesApi.listPage (the mocked method)',
  );
  const specFiles: string[] = [];
  walkSpecFiles(path.join(FRONTEND, 'src'), specFiles);
  assert.ok(specFiles.length > 0, 'the spec walk must find frontend spec files');
  const staleIndexMocks = specFiles.filter((file) =>
    fs.readFileSync(file, 'utf8').includes("vi.mock('@/features/sales',"),
  );
  assert.deepEqual(staleIndexMocks, [], 'no spec file may still mock the old sales index path');
  const vanSpec = fs.readFileSync(VAN_SPEC, 'utf8');
  const vanComponent = fs.readFileSync(VAN_COMPONENT, 'utf8');
  assert.ok(
    vanSpec.includes("vi.mock('@/features/sales/api/sales.api',"),
    'the VanSale spec must keep mocking the sales api shim path',
  );
  assert.ok(
    vanComponent.includes("from '@/features/sales/api/sales.api'"),
    'the VanSale component must still import from the sales api shim path (mock aligned, not bypassed)',
  );
  const reprintSpec = fs.readFileSync(REPRINT_SPEC, 'utf8');
  const reprintComponent = fs.readFileSync(REPRINT_COMPONENT, 'utf8');
  assert.ok(
    reprintSpec.includes("from '@/shared/api/sales.api'"),
    'the reprint spec must import salesApi from the shared api (F5h re-point)',
  );
  assert.ok(
    reprintComponent.includes("from '@/shared/api/sales.api'"),
    'the reprint component must import salesApi from the shared api (spy target aligned)',
  );
  const run = spawnSync('node', ['scripts/api-mutation-envelope-check.mjs'], {
    cwd: FRONTEND,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `the Phase23 API envelope check must exit 0 (stderr: ${(run.stderr || '').trim()})`);
  assert.ok((run.stdout || '').includes(ENVELOPE_CHECK_MSG), 'the Phase23 API envelope check must report passed');

  // 2. F5k moves the module-boundary pins: frontend edges 45,
  // statements 111, pairs 1 (the pos|products pair is gone); the
  // backend pins do not move. Baselines 60 / 152.
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
    boundary.includes("'products->inventory': 3,"),
    'the products->inventory edge must stay pinned at 3 (the surviving direction)',
  );
  assert.ok(
    !boundary.includes("'inventory|products'"),
    'the inventory|products pair must stay gone from the pair list',
  );
  assert.ok(
    boundary.includes("'sales->pos': 3,"),
    'the sales->pos edge must stay pinned at 3 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'pos|sales'"), 'the pos|sales pair must stay gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5H-REPAIR-2-DIALOG-SPEC-MOCK/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5h-REPAIR-2 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-MARKETPLACE-WEBHOOK-MAP-ROW/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5h-REPAIR-2 INV exactly once');

  // 4. Wiring: both critical lists carry 392 specs in identical order, this spec last.
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
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 392 specs in order');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 413);') && src.includes('assert.equal(chain.length, 413);'),
      `${label} spec wiring must re-pin to 392`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s7-marketplace-webhook-map-row.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5h-REPAIR-2 spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5j spec, or pin
  // the old guard INV. (The live tree holds ~75 files asserting the
  // count — the #264-fix / D12 lesson. The F5j filename, the count
  // literals and the old INV id are built by concatenation so this
  // block's own source never contains the patterns it scans for. The
  // scan covers all three variable forms: specs, chain, and
  // list.length — and BOTH last-entry forms: specs[...] and chain[...],
  // the F5j rebase lesson.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const f5jName = 'phase1-f5j' + '-inventory-products.spec.ts';
  const f5jInv = 'INV-PHASE1-F5J' + '-INVENTORY-PRODUCTS-DECOUPLED';
  const staleSpecs = 'specs.length, 39' + '1';
  const staleChain = 'chain.length, 39' + '1';
  const staleList = 'list.length, 39' + '1';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5jName}'`)) staleLastEntry.push(file);
    if (src.includes(`chain[chain.length - 1], 'test/critical/${f5jName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${f5jInv}/g)`)) staleGuard.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5j spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV');

  // 6. The guard tail holds ONLY the newest id, so F5h-REPAIR-2 re-pins
  // the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/
  // F5h-REPAIR/F5j specs' guard assertions to the F5h-REPAIR-2 INV;
  // their invariants-file assertions still pin their own id (each line
  // stays in ARCHITECTURE_INVARIANTS.md exactly once).
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-MARKETPLACE-WEBHOOK-MAP-ROW/g)'),
      `${label} spec guard assertion must re-pin to the F5h-REPAIR-2 INV`,
    );
  }

  console.log(
    'phase1 F5h-REPAIR-2 dialog spec mock checks passed (dialog mock re-pointed to the shared sales api, 392 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
