import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightJobCloseService } from '../../src/modules/maritime-freight/maritime-freight-job-close.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 D-M1 — PUT jobs/:id silently drops 9 fields
 * (INV-PHASE1-D-M1-JOB-FIELDS).
 *
 * Grounding §6 row M1 (phase1-grounding.md), caller re-verified live
 * at 949ecce6e before this package was written (phase1-d-batch-log.md
 * §STEP 0): the three maritime job cards PUT through
 * maritimeApi.updateJob (PUT /api/maritime-freight/jobs/:id) and the
 * service (maritime-freight-job-close.service.ts:131 updateJob) never
 * reads the fields — the saves are silent no-ops (the service updates
 * only updated_at and returns the job while the UI toasts success).
 * - JobConsolidationTab sends { isConsolidation: true } (enable path
 *   only — no disable path in this caller; the toggle-off design stays
 *   a separate question).
 * - JobEgyptianAciCard sends acidNumber / acidIssueDate /
 *   acidExpiryDate / foreignExporterId / importerTaxId (ACI =
 *   Egyptian-import compliance data).
 * - JobExportCutoffsCard sends siCutoffDate / vgmCutoffDate /
 *   portCutoffDate.
 * The DTO (UpdateJobDto) already declares all 9, and all 9 columns
 * already exist on maritime_jobs (migration 2040000000200) — NO
 * migration. The fix wires all 9 through the update path, same values
 * the caller sends, no transformation: isConsolidation ->
 * is_consolidation_master (the column createJob already writes from
 * dto.isConsolidationMaster), the five ACI fields -> acid_number /
 * acid_issue_date / acid_expiry_date / foreign_exporter_id /
 * importer_tax_id, the three cutoff fields -> si_cutoff_date /
 * vgm_cutoff_date / port_cutoff_date. NOTE: portCutOff (a DIFFERENT
 * field) is already handled -> port_cut_off; this package wires only
 * the *CutoffDate variants and does NOT sync the legacy port_cut_off
 * column (JobExportCutoffsCard reads portCutoffDate with a fallback to
 * the legacy field — out of scope, noted in the batch log).
 *
 * WHAT THIS PINS, driving the REAL updateJob on PGlite:
 * - a PUT carrying all 9 fields persists all 9 on the row;
 * - a partial PUT changes only the fields it carries (the !==
 *   undefined pattern — no wipe of the other 8);
 * - isConsolidation: false persists false (the passthrough works in
 *   both directions — wiring, not the toggle design);
 * - source pins: the updateJob slice contains all 9 column
 *   assignments.
 *
 * PROOF LIMIT (stated plainly): the PGlite drive proves the service
 * persists the fields; the HTTP path (controller -> facade -> service)
 * and the validation pipe are proven by CI (the DTO already declares
 * the fields, so the pipe passes them through). No live-Postgres
 * rehearsal is claimed here.
 *
 * Wiring: both critical lists carry 396 specs in identical order,
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const JOB_CLOSE_SERVICE = path.join(
  BACKEND,
  'src',
  'modules',
  'maritime-freight',
  'maritime-freight-job-close.service.ts',
);

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new MaritimeFreightJobCloseService({
    db,
    accountingPosting: {} as never,
    assertJobCanClose: async () => {},
    assertRoadProofOfDelivery: async () => {},
    assertUniqueMasterBl: async () => {},
    syncConsolidationParentTotals: async () => ({ synced: false, grossWeightKg: 0, totalCbm: 0, packageCount: 0 }),
    getJobById: async () => null,
    resolveTenantConfiguredTaxRate: async () => null,
    hasPostedCloseJournal: async () => false,
    resolveMaritimeAccountIdOn: async () => null,
  });

  interface JobRow {
    is_consolidation_master: boolean | null;
    acid_number: string | null;
    acid_issue_date: string | Date | null;
    acid_expiry_date: string | Date | null;
    foreign_exporter_id: string | null;
    importer_tax_id: string | null;
    si_cutoff_date: string | Date | null;
    vgm_cutoff_date: string | Date | null;
    port_cutoff_date: string | Date | null;
  }

  async function jobRow(id: string): Promise<JobRow> {
    const row = await db.selectFrom('maritime_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    return row as unknown as JobRow;
  }

  try {
    await pg.exec(`
      CREATE TABLE maritime_jobs (
        id text PRIMARY KEY, tenant_id text, parent_job_id text, transport_mode text, status text,
        milestone_status text, booking_number text, mbl_number text,
        air_cargo_type text, flight_number text, flight_date text, mawb_number text, hawb_number text,
        gross_weight_kg numeric, volumetric_weight_kg numeric, chargeable_weight_kg numeric,
        total_cbm numeric, package_count numeric,
        vessel_name text, voyage_number text, pol_code text, pol_name text, pod_code text, pod_name text,
        etd text, eta text, port_cut_off timestamptz, bl_type text, hbl_number text,
        shipper_details text, consignee_details text, notify_party text,
        shipping_line_id text, shipping_line_name text, notes text, updated_at timestamptz,
        is_consolidation_master boolean, acid_number text, acid_issue_date date, acid_expiry_date date,
        foreign_exporter_id text, importer_tax_id text,
        si_cutoff_date timestamptz, vgm_cutoff_date timestamptz, port_cutoff_date timestamptz
      );
      INSERT INTO maritime_jobs (id, tenant_id, parent_job_id, transport_mode, status, is_consolidation_master)
      VALUES ('job-1', 't1', NULL, 'sea', 'active', false);
    `);

    // 1. A PUT carrying all 9 fields persists all 9 on the row.
    await service.updateJob(auth, 'job-1', {
      isConsolidation: true,
      acidNumber: 'EGY1234567890123456789',
      acidIssueDate: '2026-01-15',
      acidExpiryDate: '2027-01-15',
      foreignExporterId: 'EXP-EG-001',
      importerTaxId: '123456789',
      siCutoffDate: '2026-02-01T10:00:00.000Z',
      vgmCutoffDate: '2026-02-02T10:00:00.000Z',
      portCutoffDate: '2026-02-03T10:00:00.000Z',
    });
    const afterAll = await jobRow('job-1');
    assert.equal(afterAll.is_consolidation_master, true, 'isConsolidation must persist to is_consolidation_master');
    assert.equal(afterAll.acid_number, 'EGY1234567890123456789', 'acidNumber must persist');
    assert.equal(
      new Date(String(afterAll.acid_issue_date)).toISOString().slice(0, 10),
      '2026-01-15',
      'acidIssueDate must persist',
    );
    assert.equal(
      new Date(String(afterAll.acid_expiry_date)).toISOString().slice(0, 10),
      '2027-01-15',
      'acidExpiryDate must persist',
    );
    assert.equal(afterAll.foreign_exporter_id, 'EXP-EG-001', 'foreignExporterId must persist');
    assert.equal(afterAll.importer_tax_id, '123456789', 'importerTaxId must persist');
    assert.equal(
      new Date(String(afterAll.si_cutoff_date)).toISOString(),
      '2026-02-01T10:00:00.000Z',
      'siCutoffDate must persist',
    );
    assert.equal(
      new Date(String(afterAll.vgm_cutoff_date)).toISOString(),
      '2026-02-02T10:00:00.000Z',
      'vgmCutoffDate must persist',
    );
    assert.equal(
      new Date(String(afterAll.port_cutoff_date)).toISOString(),
      '2026-02-03T10:00:00.000Z',
      'portCutoffDate must persist',
    );

    // 2. A partial PUT changes only the fields it carries (no wipe).
    await service.updateJob(auth, 'job-1', { acidNumber: 'EGY999' });
    const afterPartial = await jobRow('job-1');
    assert.equal(afterPartial.acid_number, 'EGY999', 'partial PUT must update acidNumber');
    assert.equal(afterPartial.is_consolidation_master, true, 'partial PUT must not wipe isConsolidation');
    assert.equal(afterPartial.foreign_exporter_id, 'EXP-EG-001', 'partial PUT must not wipe foreignExporterId');
    assert.equal(
      new Date(String(afterPartial.si_cutoff_date)).toISOString(),
      '2026-02-01T10:00:00.000Z',
      'partial PUT must not wipe siCutoffDate',
    );

    // 3. isConsolidation: false persists false (passthrough, both directions).
    await service.updateJob(auth, 'job-1', { isConsolidation: false });
    const afterFalse = await jobRow('job-1');
    assert.equal(afterFalse.is_consolidation_master, false, 'isConsolidation: false must persist');
    assert.equal(afterFalse.acid_number, 'EGY999', 'the false PUT must not wipe acidNumber');

    // 4. Source pins: the updateJob slice contains all 9 column assignments.
    const src = fs.readFileSync(JOB_CLOSE_SERVICE, 'utf8');
    const updateStart = src.indexOf('async updateJob(');
    const updateEnd = src.indexOf('async getQuotationCharges(');
    assert.ok(updateStart >= 0 && updateEnd > updateStart, 'updateJob slice must be locatable');
    const slice = src.slice(updateStart, updateEnd);
    for (const column of [
      'is_consolidation_master',
      'acid_number',
      'acid_issue_date',
      'acid_expiry_date',
      'foreign_exporter_id',
      'importer_tax_id',
      'si_cutoff_date',
      'vgm_cutoff_date',
      'port_cutoff_date',
    ]) {
      assert.ok(slice.includes(column), `updateJob must write ${column}`);
    }

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
    const invCount = (invariants.match(/INV-PHASE1-D-M1-JOB-FIELDS/g) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the D-M1 INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S11/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the D-M1 INV exactly once');

    // 4. Wiring: both critical lists carry 396 specs in identical order, this spec last.
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 427);
    assert.equal(chain.length, 427);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 396 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts');
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 427);') && src.includes('assert.equal(chain.length, 427);'),
        `${label} spec wiring must re-pin to 396`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the D-M1 spec`,
      );
    }

    // 5. The wiring re-pin sweep is complete: no critical spec may still
    // pin the old count, point its last-entry at the F5l spec, pin the old
    // guard INV, pin the old frontend pins, or pin the old baseline size.
    // (The live tree holds ~75 files asserting the count — the #264-fix /
    // D12 lesson. The F5l filename, the count literals, the FE pin
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
    const prevName = 'phase1-f5l-pos-' + 'storefront.spec.ts';
    const prevInv = 'INV-PHASE1-F5L-POS-' + 'STOREFRONT-DECOUPLED';
    const staleSpecs = 'specs.length, 39' + '5';
    const staleChain = 'chain.length, 39' + '5';
    const staleList = 'list.length, 39' + '5';
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
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (395)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F5l spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (F5l)');
    assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
    assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

    // 6. The guard tail holds ONLY the newest id, so D-M1 re-pins the
    // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l specs'
    // guard assertions to the D-M1 INV; their invariants-file assertions
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S11/g)'),
        `${label} spec guard assertion must re-pin to the D-M1 INV`,
      );
    }

    console.log('phase1 D-M1 job-fields checks passed (PUT jobs/:id persists all 9 fields, 396 specs wired)');
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
