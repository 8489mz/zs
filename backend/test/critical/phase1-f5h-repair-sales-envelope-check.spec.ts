import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5h-REPAIR — the F5h commit's Phase23 API envelope check
 * failure (INV-PHASE1-F5H-REPAIR-SALES-ENVELOPE-CHECK).
 *
 * ci-fast #496 on 47eba1b6a (F5h) failed in job frontend-fast, step
 * "Frontend architecture and contract guards": the Phase23 API
 * envelope check (frontend/scripts/api-mutation-envelope-check.mjs)
 * failed with:
 *   src/features/sales/api/sales.api.ts: missing unwrapEntity usage
 *   for entity envelopes
 * ci-full #316's frontend job failed the same way. The check hardcodes
 * three files and fails any of them whose source does not contain the
 * literal string `unwrapEntity`. F5h moved the real sales api WHOLE
 * (git mv, byte-identical, sha256 41698cbd...) to
 * frontend/src/shared/api/sales.api.ts and left a pure re-export shim
 * at the old features path — the shim contains no `unwrapEntity`
 * string, so the check failed on the shim. The customers.api shim
 * (F5g) passed only because customers.api.ts is NOT in the check's
 * hardcoded list. The implementation the check guards still uses
 * unwrapEntity at 5 entity-envelope call sites
 * (getById/create/cancel/update/adjustPayments); only the check's
 * path for sales is stale after the F5h move.
 *
 * The fix: point the check at the real implementation — the sales
 * entry in api-mutation-envelope-check.mjs moves from
 * 'src/features/sales/api/sales.api.ts' to
 * 'src/shared/api/sales.api.ts' (one line; the purchases + pos
 * entries stay). The guard stays exactly as strong: it still fails
 * if unwrapEntity is ever removed from the real sales api (pinned
 * live by running the check from this spec). The shim is NOT
 * touched — no comment containing the string, no fake usage — and
 * the check itself is NOT weakened or deleted.
 *
 * Consequences, all re-pinned in this package:
 * - The envelope check passes (exit 0) with the sales entry on the
 *   shared implementation; purchases + pos entries unchanged.
 * - Frontend edges 47 / statements 122, pairs 3, backend pins
 *   (63 / 736, total 738) unmoved. Feature-boundary baseline stays
 *   64 and import-layer baseline stays 152.
 * - Wiring: both critical lists carry 390 specs in identical order,
 *   this spec last.
 *
 * REBASE NOTE (2026-11-27): this repair was authored on 47eba1b6a
 * (F5h) as 388 -> 389; HEAD moved while it ran — F5i pushed
 * 8f940f973 (pos|settings pair broken, pairs 4 -> 3, edges 48/47,
 * statements 125/122, baseline 65/64). The repair rebased onto
 * 8f940f973, so it is now the 390th spec: wiring re-pinned to 390,
 * the F5i spec's sweep block re-pinned 389 -> 390, its guard
 * assertion re-pinned to this repair INV, and the frontend pins +
 * baseline above are the F5i pins (122/47/64), not the F5h pins.
 * F5i verified live that settings.api is NOT in the envelope-check
 * list, so F5i introduces no new envelope failure — the only open
 * envelope failure remains the pre-existing sales path this repair
 * fixes.
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
const ENVELOPE_CHECK = path.join(FRONTEND, 'scripts', 'api-mutation-envelope-check.mjs');
const SHARED_SALES_API = path.join(FRONTEND, 'src', 'shared', 'api', 'sales.api.ts');
const SALES_API_SHIM = path.join(FRONTEND, 'src', 'features', 'sales', 'api', 'sales.api.ts');
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

async function main(): Promise<void> {
  // 1. The check points at the real implementation now. The shared
  // sales api still unwraps every entity envelope; the shim is
  // unchanged (a pure re-export — it must NOT gain an unwrapEntity
  // string, or a future edit could game the check through the shim);
  // the purchases + pos entries stay. The check itself runs green.
  const check = fs.readFileSync(ENVELOPE_CHECK, 'utf8');
  assert.ok(
    check.includes("'src/shared/api/sales.api.ts',"),
    'the envelope check must list the shared sales api (the real implementation)',
  );
  assert.ok(
    !check.includes("'src/features/sales/api/sales.api.ts'"),
    'the envelope check must no longer list the sales shim path (a pure re-export, no unwrapEntity string)',
  );
  assert.ok(
    check.includes("'src/features/purchases/api/purchases.api.ts',"),
    'the envelope check must keep the purchases entry unchanged',
  );
  assert.ok(
    check.includes("'src/features/pos/api/pos.api.ts'"),
    'the envelope check must keep the pos entry unchanged',
  );
  const sharedApi = fs.readFileSync(SHARED_SALES_API, 'utf8');
  assert.ok(sharedApi.includes('export const salesApi = {'), 'the shared sales.api must define salesApi');
  const entityMethods = ['getById', 'create', 'cancel', 'update', 'adjustPayments'];
  for (const method of entityMethods) {
    const line = sharedApi.split('\n').find((entry) => entry.includes(`${method}: async`));
    assert.ok(line !== undefined, `the shared sales.api must still define ${method}`);
    assert.ok(
      line.includes('unwrapEntity<Sale>('),
      `the shared sales.api ${method} must still unwrap its entity envelope`,
    );
  }
  const unwrapCalls = (sharedApi.match(/unwrapEntity<Sale>\(/g) || []).length;
  assert.equal(unwrapCalls, 5, 'the shared sales.api must unwrap exactly 5 entity envelopes');
  const shim = fs.readFileSync(SALES_API_SHIM, 'utf8');
  assert.ok(
    shim.includes("from '@/shared/api/sales.api';"),
    'the sales api shim must still re-export from the shared home',
  );
  assert.ok(shim.includes('salesApi'), 'the sales api shim must still re-export salesApi');
  assert.ok(
    !shim.includes('unwrapEntity'),
    'the sales api shim must contain no unwrapEntity string (the check must guard the implementation, not the shim)',
  );
  const run = spawnSync('node', ['scripts/api-mutation-envelope-check.mjs'], {
    cwd: FRONTEND,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `the Phase23 API envelope check must exit 0 (stderr: ${(run.stderr || '').trim()})`);
  assert.ok(
    (run.stdout || '').includes('Phase23 API envelope checks passed.'),
    'the Phase23 API envelope check must report passed',
  );

  // 2. The module-boundary pins do not move: frontend edges 47,
  // statements 122, pairs 3; the backend pins do not move. Both
  // baselines stay (64 / 152).
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
  const invCount = (invariants.match(/INV-PHASE1-F5H-REPAIR-SALES-ENVELOPE-CHECK/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5h-REPAIR INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S10/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5h-REPAIR INV exactly once');

  // 4. Wiring: both critical lists carry 390 specs in identical order, this spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 426);
  assert.equal(chain.length, 426);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 390 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 426);') && src.includes('assert.equal(chain.length, 426);'),
      `${label} spec wiring must re-pin to 390`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5h-REPAIR spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count, point its last-entry at the F5i spec, or pin
  // the old guard INV. (The live tree holds ~73 files asserting the
  // count — the #264-fix / D12 lesson. The F5i filename, the count
  // literals and the old INV id are built by concatenation so this
  // block's own source never contains the patterns it scans for. The
  // scan covers all three variable forms: specs, chain, and
  // list.length. The frontend pins and baselines do NOT move in this
  // repair, so no stale-pin scan for them.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const staleGuard: string[] = [];
  const f5iName = 'phase1-f5i' + '-pos-settings.spec.ts';
  const f5iInv = 'INV-PHASE1-F5I' + '-POS-SETTINGS-DECOUPLED';
  const staleSpecs = 'specs.length, 38' + '9';
  const staleChain = 'chain.length, 38' + '9';
  const staleList = 'list.length, 38' + '9';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f5iName}'`)) staleLastEntry.push(file);
    if (src.includes(`guard.match(/${f5iInv}/g)`)) staleGuard.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5i spec');
  assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV');

  // 6. The guard tail holds ONLY the newest id, so F5h-REPAIR re-pins
  // the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i
  // specs' guard assertions to the F5h-REPAIR INV; their
  // invariants-file assertions still pin their own id (each line
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S10/g)'),
      `${label} spec guard assertion must re-pin to the F5h-REPAIR INV`,
    );
  }

  console.log(
    'phase1 F5h-REPAIR sales envelope checks passed (envelope check green on the shared sales api, 390 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
