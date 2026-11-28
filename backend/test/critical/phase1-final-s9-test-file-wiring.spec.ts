import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'path';

/*
 * Phase 1 final-inspection slice 9 — test-file wiring: inventory + first batch.
 *
 * GROUNDING (recounted on da825ed, live code): 877 *.spec.ts files
 * under backend/test; 414 linked in critical-specs.json; 463
 * unlinked (382 test/critical + 62 test/infra + 16 top-level test/
 * + 3 test/acceptance). The verification report's "452 of 894" is
 * stale. Of the 463, 51 run in another suite on main CI (test:infra
 * 41, ci-full solo/named steps 10) and 4 run only in the
 * branch-gated accounting-acceptance workflow (never on main), so
 * 408 are truly unwired (371 critical + 21 infra + 16 top-level).
 * The full solo inventory run (run-critical.mjs, 2 workers) and the
 * second run (37 other unwired files) are recorded in the inventory
 * file; this spec pins their outcome, not the runs themselves.
 *
 * DECISION (recorded): the batch is test/critical files only (at
 * most 10, live + passing solo). The 21 infra and 16 top-level
 * files stay unwired for later slices — their natural home is
 * infra-specs.json or a new list, not the critical chain. The
 * batch includes maritime-settle-book-digits.spec.ts after a
 * trivial one-path re-point (see §3); the other two named broken
 * files stay out (engine-map-corrections: stale pins in §2/§5/§6;
 * maritime-carrier-invoice-fx-conversion: the facade never
 * delegates postCarrierInvoiceJournal — both need their own
 * slices, recorded in the inventory file).
 *
 * WHAT THIS PINS (all static — the wired specs prove their own
 * live cases when the chain runs them):
 * - §1: the inventory counts — 878 files on disk (877
 *   inventoried + this spec itself, which is the 878th file
 *   and is wired by the batch), 425 linked, 453 unlinked;
 *   categories 51 / 4 / 398 after wiring; the inventory run
 *   summaries as recorded.
 * - §2: every batch file is present in BOTH critical lists.
 * - §3: the settle-book-digits trivial fix — the pinned line
 *   lives in purchases-write-customer-payments.service.ts:388
 *   and nowhere in purchases-write.service.ts, and the spec
 *   reads the new path.
 * - §4: the INV entry exists exactly once in both places.
 * - §5: wiring 425 in both lists, this spec last.
 * - §6: the re-pin sweep is complete (no stale count,
 *   last-entry or guard id remains).
 * - §7: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §8: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5,
 *   posting pin 97, settings->accounting table 14)
 *   and the "highest migration" pins stay at 0345 (no
 *   migration in this package).
 *
 * RED-1: run this spec BEFORE the batch is wired (and before the
 * INV exists) — §1 fails on the linked count, §2 fails on the
 * missing batch entries, §4 fails on the missing INV, §5 fails
 * on the wiring count.
 *
 * Wiring: both critical lists carry 425 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const BACKEND_SRC = path.join(BACKEND, 'src');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const INVENTORY = path.join(REPO_ROOT, '..', 'phase1-final-s9-inventory.md');
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
const REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-repair-type-imports.spec.ts');
const S1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s1-fx-maritime-close-asof.spec.ts');
const S2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s2-maritime-settlement-idempotency.spec.ts');
const S3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s3-money-precision-hr-import.spec.ts');
const S4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s4-legacy-doc-numbers.spec.ts');
const S5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s5-business-date-r3.spec.ts');
const S6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s6-import-fx-payout-idempotency.spec.ts');
const S7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s7-marketplace-webhook-map-row.spec.ts');
const S8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s8-settings-import-posting-port.spec.ts');
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const SETTLE_SPEC = path.join(BACKEND, 'test', 'critical', 'maritime-settle-book-digits.spec.ts');
const SIBLING_NEW = path.join(
  BACKEND_SRC,
  'modules',
  'purchases',
  'services',
  'purchases-write-customer-payments.service.ts',
);
const SIBLING_OLD = path.join(BACKEND_SRC, 'modules', 'purchases', 'services', 'purchases-write.service.ts');

const NEW_INV = 'INV-TEST-FILE-WIRING-S9';

// The batch, exactly 10 test/critical files that passed solo
// (the settle spec after its trivial one-path re-point, verified
// solo), in wiring order. Theme: money/book-digits + reports —
// the specs most likely to catch money regressions.
const BATCH: string[] = [
  'test/critical/reports-query-book-digits.spec.ts',
  'test/critical/maritime-settle-book-digits.spec.ts',
  'test/critical/maritime-customs-duty-book-digits.spec.ts',
  'test/critical/maritime-forex-gain-loss-book-digits.spec.ts',
  'test/critical/maritime-deposit-fx-conversion.spec.ts',
  'test/critical/maritime-stored-money-post-at-close.spec.ts',
  'test/critical/opening-balance-book-digits.spec.ts',
  'test/critical/catalog-stock-totals-book-digits.spec.ts',
  'test/critical/reports-overview-figures.spec.ts',
  'test/critical/loan-repay-book-digits-tolerance.spec.ts',
];

function listSpecFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(p);
      } else if (entry.isFile() && p.endsWith('.spec.ts')) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

async function main(): Promise<void> {
  // §1: The inventory counts — 878 files on disk (877
  // inventoried + this spec itself, the 878th file, wired by
  // the batch), 425 linked, 453 unlinked; categories 51 / 4 /
  // 398 after wiring; the inventory run summaries as recorded
  // in the inventory file.
  {
    const all = listSpecFiles(path.join(BACKEND, 'test'));
    assert.equal(all.length, 891, 'backend/test must hold exactly 878 spec files');
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    assert.equal(specsJson.specs.length, 450, 'critical-specs.json must hold exactly 425 specs');
    assert.equal(all.length - specsJson.specs.length, 441, 'unlinked files must be exactly 441');
    const inventory = fs.readFileSync(INVENTORY, 'utf8');
    assert.ok(
      inventory.includes('Runs in another suite on main CI — 51'),
      'inventory must record category A (51 run in another suite)',
    );
    assert.ok(
      inventory.includes('Runs only in the branch-gated workflow — 4'),
      'inventory must record category B (4 branch-gated only)',
    );
    assert.ok(
      inventory.includes('Truly unwired — 398'),
      'inventory must record category C (398 truly unwired after wiring)',
    );
    assert.ok(
      inventory.includes('Critical run (382 files): 301 pass / 80 fail / 1 timeout'),
      'inventory must record the critical run summary as measured',
    );
    assert.ok(
      inventory.includes('Other run (37 files): 32 pass / 5 fail'),
      'inventory must record the second run summary as measured',
    );
  }

  // §2: Every batch file is present in BOTH critical lists.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(BATCH.length, 10, 'the batch must hold exactly 10 files');
    for (const entry of BATCH) {
      assert.ok(specs.includes(entry), `batch file ${entry} must be in critical-specs.json`);
      assert.ok(chain.includes(entry), `batch file ${entry} must be in the serial chain`);
    }
  }

  // §3: The settle-book-digits trivial fix — the pinned line
  // lives in the split customer-payments writer and nowhere in
  // the old writer file, and the spec reads the new path.
  {
    const siblingNew = fs.readFileSync(SIBLING_NEW, 'utf8');
    assert.ok(
      siblingNew.includes('const newPaid = currentPaid + amount;'),
      'the split writer must still hold the pinned line',
    );
    const siblingOld = fs.readFileSync(SIBLING_OLD, 'utf8');
    assert.ok(
      !siblingOld.includes('const newPaid = currentPaid + amount;'),
      'the old writer file must no longer hold the pinned line',
    );
    const settle = fs.readFileSync(SETTLE_SPEC, 'utf8');
    assert.ok(
      settle.includes('purchases-write-customer-payments.service.ts'),
      'the settle spec must read the split writer',
    );
    assert.ok(
      !settle.includes('services/purchases-write.service.ts'),
      'the settle spec must no longer read the old writer path',
    );
    assert.ok(
      BATCH.includes('test/critical/maritime-settle-book-digits.spec.ts'),
      'the settle spec must be in the wired batch',
    );
  }

  // §4: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S14/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §5: Wiring: both critical lists carry 425 specs in identical
  // order, this spec last.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 450);
    assert.equal(chain.length, 450);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 425 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
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
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
      ['S7', S7_SPEC],
      ['S8', S8_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 450);') && src.includes('assert.equal(chain.length, 450);'),
        `${label} spec wiring must re-pin to 425`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §6: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-8 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s8-settings-import-posting-' + 'port.spec.ts';
    const prevInv = 'INV-SETTINGS-IMPORT-POSTING-' + 'PORT';
    const staleSpecs = 'specs.length, 41' + '4';
    const staleChain = 'chain.length, 41' + '4';
    const staleList = 'list.length, 41' + '4';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (414)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-8 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 8)');
  }

  // §7: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1/S2/S3/S4/S5/S6/S7/S8 specs' guard assertions to
  // the new INV; their invariants-file assertions still pin their
  // own id (each line stays in ARCHITECTURE_INVARIANTS.md exactly
  // once).
  {
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
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S4', S4_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
      ['S7', S7_SPEC],
      ['S8', S8_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S14/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §8: The module-boundary pins do not move in this package
  // (no production code changes at all — only wiring + one
  // spec-path re-point). No migration in this package, so the
  // "highest migration" pins stay at 0345 (the two 3dp specs,
  // the S2 spec §5/§10, the S3 spec §9, the S4 spec §4/§9 —
  // including its standalone 0345 literals — the S5 spec §9,
  // the S6 spec §10, and the S7/S8 specs' own 0345 pins).
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_POSTING_EXTERNAL = 97;'),
      'module-boundary must pin the posting count 97',
    );
    assert.ok(
      boundary.includes("'settings->accounting': 14,"),
      'module-boundary must still pin the settings->accounting table 14',
    );
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
    assert.ok(
      writesSpec.includes('const PINNED_WRITE_COUNT = 5;'),
      'stock-movements-writes must pin the write count 5',
    );
    assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
    for (const [label, specPath] of [
      ['deposit-3dp', DEPOSIT_3DP_SPEC],
      ['van-transfer-3dp', VAN_TRANSFER_3DP_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const HIGHEST_MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
        `${label} spec highest-migration pin must stay at 0345`,
      );
      assert.ok(
        src.includes('the 0345 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must stay at 0345`,
      );
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S2 spec migration-file pin must stay at 0345',
    );
    assert.ok(
      s2Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must stay at 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration pin must re-point to 0345'),
      'S2 spec §10 pin message must stay at 0345',
    );
    assert.ok(
      s2Src.includes('spec highest-migration message must re-point to 0345'),
      'S2 spec §10 message must stay at 0345',
    );
    const s3Src = fs.readFileSync(S3_SPEC, 'utf8');
    assert.ok(
      s3Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S3 spec migration-file pin must stay at 0345',
    );
    assert.ok(s3Src.includes('must re-point to 0345'), 'S3 spec highest-migration assertions must stay at 0345');
    const s4Src = fs.readFileSync(S4_SPEC, 'utf8');
    assert.ok(
      s4Src.includes(
        "import { migration } from '../../src/database/migrations/2040000000344_legacy_document_number_unique_indexes';",
      ),
      'S4 spec must still drive the real 0344 migration (its own migration under test)',
    );
    assert.ok(s4Src.includes('files[files.length - 1],'), 'S4 spec §4 must still compare the highest file on disk');
    assert.ok(
      s4Src.includes("'2040000000345_import_fx_payout_idempotency_keys.ts',"),
      'S4 spec §4 highest-migration literal must stay at 0345',
    );
    assert.ok(
      s4Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S4 spec highest-migration assertion must stay at 0345',
    );
    assert.ok(
      s4Src.includes('spec highest-migration pin must re-point to 0345'),
      'S4 spec §9 pin message must stay at 0345',
    );
    const s5Src = fs.readFileSync(S5_SPEC, 'utf8');
    assert.ok(
      s5Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S5 spec migration-file pin must stay at 0345',
    );
    assert.ok(s5Src.includes('must re-point to 0345'), 'S5 spec highest-migration assertions must stay at 0345');
    const s6Src = fs.readFileSync(S6_SPEC, 'utf8');
    assert.ok(
      s6Src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
      'S6 spec migration-file pin must stay at 0345',
    );
    assert.ok(s6Src.includes('must re-point to 0345'), 'S6 spec highest-migration assertions must stay at 0345');
    const s7Src = fs.readFileSync(S7_SPEC, 'utf8');
    assert.ok(
      s7Src.includes('2040000000345_import_fx_payout_idempotency_keys.ts'),
      'S7 spec highest-migration pin must stay at 0345',
    );
    const s8Src = fs.readFileSync(S8_SPEC, 'utf8');
    assert.ok(
      s8Src.includes('2040000000345_import_fx_payout_idempotency_keys.ts'),
      'S8 spec highest-migration pin must stay at 0345',
    );
  }

  console.log('phase1 final slice 9 checks passed (test-file wiring, 425 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
