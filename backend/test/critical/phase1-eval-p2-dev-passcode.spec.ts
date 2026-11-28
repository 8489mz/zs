import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { OfflineReleasesCheck } from '../../src/modules/settings/services/offline-releases/offline-releases-check';

/*
 * Phase 1 evaluation follow-up P2 — dev passcode in the release history
 * (INV-PHASE1-EVAL-P2-DEV-PASSCODE).
 *
 * Both evaluations found the same residue: the offline-releases history
 * response STILL returns the dev passcode in dev mode. The CORS
 * reflect-any hole that made it readable cross-origin is already closed
 * (cors-options.util.ts); the response field itself is the residue.
 * OfflineReleasesCheck.listReleaseHistory maps every row to
 * `passcode: isDev ? (r.passcode ?? undefined) : undefined`, where
 * isDev is NODE_ENV !== 'production' && APP_MODE !== 'SELF_CONTAINED'.
 * The history is exposed twice: the controller GET history
 * (offline-releases.controller.ts:60 -> releasesService
 * .listReleaseHistory -> this.s3.listReleaseHistory) and inside
 * checkForUpdate (`releases: history`). No reader anywhere needs the
 * field: the frontend `.passcode` hits are maintenance-ticket fields
 * only, no backend consumer reads the history passcode, and the apply
 * endpoint takes the passcode as INPUT from the admin.
 *
 * THE FIX: drop the `passcode` key and the `isDev` computation from
 * listReleaseHistory entirely — never return it, even in dev. The
 * passcode STAYS stored in the offline_releases row (the admin
 * provisioning surface in offline-releases-admin.ts and the apply
 * validation in offline-releases-apply.ts keep using it); only the
 * public history stops disclosing it. requiresPasscode (boolean)
 * stays — clients need to know a code is required, not the code.
 *
 * WHAT THIS PINS, driving the REAL OfflineReleasesCheck on PGlite
 * (fresh database, no mocks — the bound disk/GitHub fns are no-ops):
 * - listReleaseHistory under NODE_ENV=development returns every row
 *   WITHOUT a `passcode` key at all (not merely undefined — the old
 *   code set `passcode: undefined` in production, so the key was
 *   present; `'passcode' in row` must be false), and the serialised
 *   row contains nowhere the seeded secret.
 * - The same holds under NODE_ENV=production.
 * - checkForUpdate's embedded `releases` array carries no passcode
 *   key in either mode (the second exposure path).
 * - The other history fields are untouched (id, version, changelog,
 *   patchUrl, promotedAt, requiresPasscode) and the stored passcode
 *   is still in the DB row (scope pin: hiding, not wiping).
 * - Source pin: the listReleaseHistory body returns no `passcode:`
 *   key, reads no `.passcode`, and computes no `isDev`.
 *
 * Wiring: both critical lists carry 404 specs in identical order,
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const CHECK_SOURCE = path.join(
  BACKEND,
  'src',
  'modules',
  'settings',
  'services',
  'offline-releases',
  'offline-releases-check.ts',
);

const SECRET_ACTIVE = 'DEV-SECRET-1';
const SECRET_OLD = 'DEV-SECRET-0';

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE offline_releases (
      id SERIAL PRIMARY KEY,
      version VARCHAR(50) NOT NULL,
      changelog TEXT NOT NULL DEFAULT '',
      patch_url TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      promoted_by VARCHAR(100),
      promoted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      passcode VARCHAR(100) DEFAULT NULL,
      requires_passcode BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);
  return { pg, db };
}

function makeCheck(db: Kysely<Database>): OfflineReleasesCheck {
  return new OfflineReleasesCheck(db, {
    syncManifestsFromDisk: async () => {},
    fetchGitHubLatestRelease: async () => null,
  });
}

function assertNoPasscode(rows: unknown[], mode: string): void {
  assert.ok(Array.isArray(rows) && rows.length === 2, `history must carry both seeded rows (${mode})`);
  for (const row of rows as Record<string, unknown>[]) {
    assert.ok(!('passcode' in row), `history row must not carry a passcode key (${mode})`);
    assert.ok(!JSON.stringify(row).includes('DEV-SECRET'), `serialised row must not leak the secret (${mode})`);
    assert.equal(typeof row.version, 'string');
    assert.equal(typeof row.patchUrl, 'string');
    assert.equal(row.requiresPasscode, true);
  }
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  const origNodeEnv = process.env.NODE_ENV;
  const origAppMode = process.env.APP_MODE;
  try {
    await db
      .insertInto('offline_releases' as never)
      .values([
        {
          version: '1.2.0',
          changelog: 'test release',
          patch_url: 'https://example.invalid/patch.zip',
          passcode: SECRET_ACTIVE,
          requires_passcode: true,
          is_active: true,
          promoted_by: 'test',
          promoted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        {
          version: '1.1.0',
          changelog: 'older release',
          patch_url: 'https://example.invalid/patch-old.zip',
          passcode: SECRET_OLD,
          requires_passcode: true,
          is_active: false,
          promoted_by: 'test',
          promoted_at: new Date(Date.now() - 86400000).toISOString(),
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
      ] as never)
      .execute();
    const check = makeCheck(db);

    // 1. The live behaviour: no passcode key in either mode, on both
    // exposure paths (direct history + checkForUpdate's releases).
    process.env.NODE_ENV = 'development';
    delete process.env.APP_MODE;
    assertNoPasscode(await check.listReleaseHistory(), 'development');
    assertNoPasscode((await check.checkForUpdate('9.9.9')).releases as unknown[], 'development/checkForUpdate');
    process.env.NODE_ENV = 'production';
    assertNoPasscode(await check.listReleaseHistory(), 'production');
    assertNoPasscode((await check.checkForUpdate('9.9.9')).releases as unknown[], 'production/checkForUpdate');

    // The stored passcode is still in the DB row (hiding, not wiping:
    // the admin surface and the apply validation keep using it).
    const stored = await db
      .selectFrom('offline_releases')
      .selectAll()
      .where('version', '=', '1.2.0')
      .executeTakeFirstOrThrow();
    assert.equal((stored as { passcode: string }).passcode, SECRET_ACTIVE);

    // 2. Source pin: the listReleaseHistory body returns no
    // `passcode:` key, reads no `.passcode`, and computes no `isDev`
    // (the function is the last method in the class, so slicing to
    // the end of file is its body; the `requires_passcode` column read
    // for the boolean stays, and the check is case-sensitive so the
    // camelCase `requiresPasscode:` key does not trip it).
    const src = fs.readFileSync(CHECK_SOURCE, 'utf8');
    const body = src.slice(src.indexOf('async listReleaseHistory()'));
    assert.ok(!body.includes('passcode:'), 'listReleaseHistory must not return a passcode key');
    assert.ok(!body.includes('.passcode'), 'listReleaseHistory must not read the stored passcode');
    assert.ok(!body.includes('isDev'), 'listReleaseHistory must not compute isDev');

    // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(/INV-PHASE1-EVAL-P2-DEV-PASSCODE/g) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the P2 INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S14/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the P2 INV exactly once');

    // 4. Wiring: both critical lists carry 404 specs in identical order, this spec last.
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
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 404 specs in order');
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 450);') && src.includes('assert.equal(chain.length, 450);'),
        `${label} spec wiring must re-pin to 404`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the P2 spec`,
      );
    }

    // 5. The wiring re-pin sweep is complete: no critical spec may still
    // pin the old count, point its last-entry at the P1 spec, pin the
    // old guard INV, pin the old frontend pins, or pin the old baseline
    // size. (Same shape as the P1 spec's §5; the patterns below are
    // built by concatenation so this block's own source never contains
    // the patterns it scans for.)
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const staleFePins: string[] = [];
    const staleBaseline: string[] = [];
    const prevName = 'phase1-eval-p1-frontend-' + 'lint.spec.ts';
    const prevInv = 'INV-PHASE1-EVAL-P1-FRONTEND-' + 'LINT';
    const staleSpecs = 'specs.length, 40' + '3';
    const staleChain = 'chain.length, 40' + '3';
    const staleList = 'list.length, 40' + '3';
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
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (403)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the P1 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (P1)');
    assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
    assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

    // 6. The guard tail holds ONLY the newest id, so this package re-pins
    // the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/
    // F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/F5l-REPAIR/D-M1/D-M3/
    // D-D10a/discount-fix/cleanup/P1 specs' guard assertions to the P2
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S14/g)'),
        `${label} spec guard assertion must re-pin to the P2 INV`,
      );
    }

    // 7. The module-boundary pins do not move (backend-only passcode
    // removal + spec; no import or edge changes).
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
  } finally {
    if (origNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origNodeEnv;
    if (origAppMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = origAppMode;
    await pg.close();
  }

  console.log(
    'phase1 eval P2 dev-passcode checks passed (history carries no passcode in dev or prod, 404 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
