import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CatalogController } from '../../src/modules/catalog/catalog.controller';
import { ProductSerialsService } from '../../src/modules/catalog/services/product-serials.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 D-D10a — serials caller sends {serials}, controller reads
 * items only (INV-PHASE1-D-D10A-SERIALS-PAYLOAD).
 *
 * Grounding §6 row D10a (phase1-grounding.md), caller re-verified live
 * at 949ecce6e before this batch was written (phase1-d-batch-log.md
 * §STEP 0): product-serials.api.ts addSerials POSTs { serials } to
 * /api/products/:id/serials (the ONLY caller is ProductSerialsDialog),
 * and catalog.controller.ts:172 reads payload?.items only — every call
 * added 0 serials with a success response. The DTO
 * (AddProductSerialsDto) already accepts BOTH items and serials — NO
 * DTO change. The fix is one line in the controller:
 * payload?.items ?? payload?.serials ?? [] (items first, serials as
 * fallback). This CHANGES write behaviour (0 -> N inserted) — the
 * whole point: the caller's serials were silently discarded.
 *
 * WHAT THIS PINS, driving the REAL controller method with the REAL
 * serials service on PGlite (the CatalogService facade is stubbed as
 * a thin delegate — its real addProductSerials is exactly
 * `return this.serialsService.addSerials(productId, items, actor)`):
 * - a {serials} payload inserts N serials (count + rows);
 * - an {items} payload still inserts (the old shape keeps working);
 * - when both are present, items win (the pinned precedence);
 * - an empty payload inserts 0 without error;
 * - source pin: the controller reads items ?? serials ?? [].
 *
 * PROOF LIMIT (stated plainly): the PGlite drive proves the
 * controller passes the caller's serials through to the real insert;
 * the HTTP path (route + validation pipe) is proven by CI (the DTO
 * already accepts both shapes). No live-Postgres rehearsal claimed.
 *
 * Wiring: both critical lists carry 399 specs in identical order,
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const CATALOG_CONTROLLER = path.join(BACKEND, 'src', 'modules', 'catalog', 'catalog.controller.ts');

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = {
    tenantId: 't1',
    accountId: 'a1',
    role: 'admin',
    userId: 1,
    username: 'tester',
    permissions: [],
  } as unknown as AuthContext;
  const serialsService = new ProductSerialsService(db, { log: async () => {} } as never);
  // Thin delegate mirroring the real CatalogService.addProductSerials
  // (catalog.service.ts: `return this.serialsService.addSerials(...)`).
  const catalogStub = {
    addProductSerials: (productId: number, items: never[], actor: AuthContext) =>
      serialsService.addSerials(productId, items as never, actor),
  };
  const controller = new CatalogController(catalogStub as never);
  const req = { authContext: auth } as never;

  async function serialRows(productId: number): Promise<string[]> {
    const rows = await db
      .selectFrom('product_serials')
      .select('serial_number')
      .where('product_id', '=', productId)
      .orderBy('serial_number', 'asc')
      .execute();
    return rows.map((r) => r.serial_number);
  }

  try {
    await pg.exec(`
      CREATE TABLE product_serials (
        id serial PRIMARY KEY, tenant_id text, account_id text, product_id integer,
        serial_number text, imei_2 text, status text, branch_id integer, location_id integer,
        cost_price numeric, purchase_id integer, purchase_item_id integer,
        warranty_end_date text, notes text
      );
    `);

    // 1. A {serials} payload inserts N serials (the defect: 0 before).
    const serialsResult = await controller.addProductSerials(
      7,
      { serials: [{ serialNumber: 'SN-001' }, { serialNumber: 'SN-002' }] } as never,
      req,
    );
    assert.equal((serialsResult as { count: number }).count, 2, '{serials} must insert 2 serials');
    assert.deepEqual(await serialRows(7), ['SN-001', 'SN-002'], 'both serial numbers must be stored');

    // 2. An {items} payload still inserts (the old shape keeps working).
    const itemsResult = await controller.addProductSerials(8, { items: [{ serialNumber: 'SN-003' }] } as never, req);
    assert.equal((itemsResult as { count: number }).count, 1, '{items} must still insert 1 serial');
    assert.deepEqual(await serialRows(8), ['SN-003'], 'the items serial must be stored');

    // 3. When both are present, items win (the pinned precedence).
    const bothResult = await controller.addProductSerials(
      9,
      {
        items: [{ serialNumber: 'SN-004' }],
        serials: [{ serialNumber: 'SN-005' }, { serialNumber: 'SN-006' }],
      } as never,
      req,
    );
    assert.equal((bothResult as { count: number }).count, 1, 'items must win over serials when both are present');
    assert.deepEqual(await serialRows(9), ['SN-004'], 'only the items serial must be stored');

    // 4. An empty payload inserts 0 without error.
    const emptyResult = await controller.addProductSerials(10, {} as never, req);
    assert.equal((emptyResult as { count: number }).count, 0, 'an empty payload must insert 0 serials');
    assert.deepEqual(await serialRows(10), [], 'no rows must be stored for an empty payload');

    // 5. Source pin: the controller reads items ?? serials ?? [].
    const src = fs.readFileSync(CATALOG_CONTROLLER, 'utf8');
    assert.ok(
      src.includes('payload?.items ?? payload?.serials ?? []'),
      'the controller must read payload?.items ?? payload?.serials ?? []',
    );

    // 2. The module-boundary pins do not move (backend-only package).
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
    const invCount = (invariants.match(/INV-PHASE1-D-D10A-SERIALS-PAYLOAD/g) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the D-D10a INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-SETTINGS-IMPORT-POSTING-PORT/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the D-D10a INV exactly once');

    // 4. Wiring: both critical lists carry 399 specs in identical order, this spec last.
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 414);
    assert.equal(chain.length, 414);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 399 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s8-settings-import-posting-port.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s8-settings-import-posting-port.spec.ts');
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 414);') && src.includes('assert.equal(chain.length, 414);'),
        `${label} spec wiring must re-pin to 399`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s8-settings-import-posting-port.spec.ts'"),
        `${label} spec last-entry must re-pin to the D-D10a spec`,
      );
    }

    // 5. The wiring re-pin sweep is complete: no critical spec may still
    // pin the old count, point its last-entry at the F5l-REPAIR spec, pin the old
    // guard INV, pin the old frontend pins, or pin the old baseline size.
    // (The live tree holds ~75 files asserting the count — the #264-fix /
    // D12 lesson. The F5l-REPAIR filename, the count literals, the FE pin
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
    const prevName = 'phase1-f5l-repair-bundle-' + 'budget.spec.ts';
    const prevInv = 'INV-PHASE1-F5L-REPAIR-' + 'BUNDLE-BUDGET';
    const staleSpecs = 'specs.length, 39' + '8';
    const staleChain = 'chain.length, 39' + '8';
    const staleList = 'list.length, 39' + '8';
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
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (398)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5l-REPAIR spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (F5l-REPAIR)');
    assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
    assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

    // 6. The guard tail holds ONLY the newest id, so D-D10a re-pins the
    // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/F5l-REPAIR/D-M1/D-M3 specs'
    // guard assertions to the D-D10a INV; their invariants-file assertions
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-SETTINGS-IMPORT-POSTING-PORT/g)'),
        `${label} spec guard assertion must re-pin to the D-D10a INV`,
      );
    }

    console.log('phase1 D-D10a serials-payload checks passed ({serials} inserts N serials, 399 specs wired)');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
