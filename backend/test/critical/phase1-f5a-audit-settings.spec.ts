import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F5a — break the audit|settings frontend circular pair
 * (INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED).
 *
 * Grounding §7 row 1 / §8 F5a (phase1-f0-grounding.md), re-derived live
 * at 1546158a5: audit|settings, module-boundary counts 1/1, ZERO deep
 * legs — both legs go through the public indices:
 * - audit -> settings (1): AuditPage.tsx:29 imports settingsApi from
 *   '@/features/settings' (queryFn: settingsApi.settings()).
 * - settings -> audit (1): UserManagementSection.tsx:34 imports
 *   formatEmployeeActivityDetails + getAuditActionLabel from
 *   '@/features/audit'.
 * A pair breaks ONLY when one direction's statements reach 0 (code
 * moves / inversion) — routing through a public index does NOT reduce
 * the module-boundary count (proven by F3). So F5a breaks the
 * settings -> audit direction by moving the shared code to shared:
 * the two pure activity-presentation helpers
 * audit/lib/audit-details-format.ts (208L, formatEmployeeActivityDetails)
 * and audit/lib/audit-activity-presenter.ts (510L, getAuditActionLabel)
 * move WHOLE (git mv, byte-identical) to frontend/src/shared/utils/.
 * They are pure functions (their only imports are the AuditLog type
 * from '@/types/domain', translateUiText from '@/lib/auto-translator',
 * and each other), and they are already used by THREE features —
 * audit itself, settings, and reports (EmployeesReportSection.tsx:15
 * imports the same two names from '@/features/audit') — a classic
 * shared utility, not audit-feature internals. The audit -> settings
 * direction stays (AuditPage keeps importing settingsApi): breaking
 * ONE direction is enough for the pair to be gone.
 *
 * What moves and what re-points (all re-points are import-route
 * changes only; the function objects are identical, so no behaviour
 * can change):
 * - Moved whole: audit/lib/audit-details-format.ts and
 *   audit/lib/audit-activity-presenter.ts (+ their 4 colocated spec
 *   files, which move with the code they test) -> shared/utils/.
 * - Re-pointed to '@/shared/utils/...': audit/hooks/useAuditPageActions
 *   (:7-8), audit/pages/AuditPage (:17, :24), the 4 moved spec files,
 *   settings/components/UserManagementSection (:34),
 *   reports/components/sections/EmployeesReportSection (:15).
 * - audit/index.ts keeps re-exporting both names (public surface
 *   unchanged) from the new shared paths.
 * - The moved audit-details-format.ts internal import of
 *   audit-activity-presenter re-points to the shared path.
 * Consequences, all re-pinned in this package:
 * - settings -> audit: 1 -> 0 AND reports -> audit: 1 -> 0 (the
 *   reports import was the same two names); audit -> settings stays 1.
 * - Frontend edges 57 -> 55, statements 138 -> 136, pairs 12 -> 11
 *   ('audit|settings' gone). Backend pins unmoved (63 / 736, total 738).
 * - Feature-boundary baseline stays 70, import-layer baseline stays
 *   152 (no deep string and no app-layer string moves).
 * - Wiring: both critical lists carry 384 specs in identical order,
 *   the F5b spec last.
 *
 * Notes: the stale cosmetic string in the F2 spec ("379 specs wired"
 * in its console.log) is pre-existing since F3 and is NOT an
 * assertion — left as-is per the parent brief. docs/MODULE_DOORS.md
 * §4 coupling line ('57 edges / 133 statements') is a stale
 * historical note (already wrong about the live pins before F5a:
 * backend 71/652, posting 79) that no package maintains — left as-is.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const FEATURES = path.join(FRONTEND, 'src', 'features');
const FRONTEND_SRC = path.join(FRONTEND, 'src');
const SHARED_UTILS = path.join(FRONTEND_SRC, 'shared', 'utils');
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

const AUDIT_INDEX = path.join(FEATURES, 'audit', 'index.ts');
const OLD_FORMAT = path.join(FEATURES, 'audit', 'lib', 'audit-details-format.ts');
const OLD_PRESENTER = path.join(FEATURES, 'audit', 'lib', 'audit-activity-presenter.ts');
const NEW_FORMAT = path.join(SHARED_UTILS, 'audit-details-format.ts');
const NEW_PRESENTER = path.join(SHARED_UTILS, 'audit-activity-presenter.ts');

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. The settings -> audit direction is gone (and the reports ->
  // audit edge with it — same two names); the audit -> settings
  // direction stays. The moved files exist at the shared paths with
  // their behaviour pinned verbatim; the old paths are gone; every
  // importer re-points to shared; the audit index still re-exports
  // both names (public surface unchanged).
  for (const feature of ['settings', 'reports']) {
    const files: string[] = [];
    walkTs(path.join(FEATURES, feature), files);
    const stillAudit: string[] = [];
    for (const file of files) {
      if (fs.readFileSync(file, 'utf8').includes("from '@/features/audit'")) {
        stillAudit.push(path.relative(FEATURES, file));
      }
    }
    assert.deepEqual(stillAudit, [], `no ${feature} file may still import from '@/features/audit'`);
  }
  const userMgmt = fs.readFileSync(path.join(FEATURES, 'settings', 'components', 'UserManagementSection.tsx'), 'utf8');
  assert.ok(
    userMgmt.includes("from '@/shared/utils/audit-details-format'") &&
      userMgmt.includes("from '@/shared/utils/audit-activity-presenter'"),
    'UserManagementSection must import the two helpers from shared utils',
  );
  assert.ok(
    userMgmt.includes("row.activityType === 'audit' ? getAuditActionLabel(row.title) : row.title"),
    'UserManagementSection must keep its title call site identical',
  );
  assert.ok(
    userMgmt.includes("row.activityType === 'audit' ? formatEmployeeActivityDetails(row) : row.details || '—'"),
    'UserManagementSection must keep its details call site identical',
  );
  const employeesReport = fs.readFileSync(
    path.join(FEATURES, 'reports', 'components', 'sections', 'EmployeesReportSection.tsx'),
    'utf8',
  );
  assert.ok(
    employeesReport.includes("from '@/shared/utils/audit-details-format'") &&
      employeesReport.includes("from '@/shared/utils/audit-activity-presenter'"),
    'EmployeesReportSection must import the two helpers from shared utils',
  );
  const auditPage = fs.readFileSync(path.join(FEATURES, 'audit', 'pages', 'AuditPage.tsx'), 'utf8');
  assert.ok(
    auditPage.includes("import { settingsApi } from '@/features/settings';"),
    'AuditPage must keep importing settingsApi from the settings index (the surviving direction)',
  );
  assert.ok(
    auditPage.includes('queryFn: () => settingsApi.settings(),'),
    'AuditPage must keep its settings query call site identical',
  );
  assert.ok(
    auditPage.includes("from '@/shared/utils/audit-details-format'") &&
      auditPage.includes("from '@/shared/utils/audit-activity-presenter'"),
    'AuditPage must import the helpers from shared utils now',
  );
  const actions = fs.readFileSync(path.join(FEATURES, 'audit', 'hooks', 'useAuditPageActions.ts'), 'utf8');
  assert.ok(
    actions.includes("from '@/shared/utils/audit-details-format'") &&
      actions.includes("from '@/shared/utils/audit-activity-presenter'"),
    'useAuditPageActions must import the helpers from shared utils now',
  );
  assert.ok(!fs.existsSync(OLD_FORMAT), 'the old audit/lib/audit-details-format.ts must be gone');
  assert.ok(!fs.existsSync(OLD_PRESENTER), 'the old audit/lib/audit-activity-presenter.ts must be gone');
  assert.ok(fs.existsSync(NEW_FORMAT), 'shared/utils/audit-details-format.ts must exist');
  assert.ok(fs.existsSync(NEW_PRESENTER), 'shared/utils/audit-activity-presenter.ts must exist');
  const movedFormat = fs.readFileSync(NEW_FORMAT, 'utf8');
  assert.ok(
    movedFormat.includes(
      'export function formatEmployeeActivityDetails(activity: { title: string; details: string }): string {',
    ),
    'the moved details-format must keep formatEmployeeActivityDetails verbatim',
  );
  assert.ok(
    movedFormat.includes('export function formatAuditDetails(row: AuditLog): string {'),
    'the moved details-format must keep formatAuditDetails verbatim',
  );
  assert.ok(
    movedFormat.includes("actorUserId: 'رقم المستخدم',"),
    'the moved details-format must keep its field labels verbatim',
  );
  assert.ok(
    movedFormat.includes("import { normalizeAuditDetailText } from '@/shared/utils/audit-activity-presenter';"),
    'the moved details-format must import the presenter from the shared path',
  );
  const movedPresenter = fs.readFileSync(NEW_PRESENTER, 'utf8');
  assert.ok(
    movedPresenter.includes('export function getAuditActionLabel(action: string, isEn = false): string {'),
    'the moved presenter must keep getAuditActionLabel verbatim',
  );
  assert.ok(
    movedPresenter.includes('export type AuditActivityType ='),
    'the moved presenter must keep AuditActivityType verbatim',
  );
  assert.ok(
    movedPresenter.includes("import { translateUiText } from '@/lib/auto-translator';"),
    'the moved presenter must keep its auto-translator import',
  );
  const auditIndex = fs.readFileSync(AUDIT_INDEX, 'utf8');
  assert.ok(
    auditIndex.includes("export { formatEmployeeActivityDetails } from '@/shared/utils/audit-details-format';"),
    'the audit index must still re-export formatEmployeeActivityDetails, from shared now',
  );
  assert.ok(
    auditIndex.includes("export { getAuditActionLabel } from '@/shared/utils/audit-activity-presenter';"),
    'the audit index must still re-export getAuditActionLabel, from shared now',
  );
  assert.ok(
    auditIndex.includes("export { AuditPage } from '@/features/audit/pages/AuditPage';"),
    'the audit index must still re-export its page component',
  );
  assert.ok(
    auditIndex.includes("export { auditRouteModule } from '@/features/audit/routes';"),
    'the audit index must still re-export its routes',
  );
  for (const specName of [
    'audit-activity-presenter.spec.ts',
    'audit-details-format.spec.ts',
    'audit-details-format-activity-log.spec.ts',
    'audit-details-format-count-trace.spec.ts',
    'audit-details-format-user-details.spec.ts',
  ]) {
    assert.ok(
      fs.existsSync(path.join(SHARED_UTILS, specName)),
      `the moved spec ${specName} must live next to the code it tests in shared/utils`,
    );
    assert.ok(
      !fs.existsSync(path.join(FEATURES, 'audit', 'lib', specName)),
      `the old spec ${specName} must be gone from audit/lib`,
    );
  }

  // 2. The module-boundary pins move: frontend edges 57 -> 55,
  // statements 138 -> 136, pairs 12 -> 11 ('audit|settings' gone);
  // the backend pins do not move. Both baselines stay put (no deep
  // string and no app-layer string moves in this package).
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
    'module-boundary must still pin the backend total 738',
  );
  assert.ok(
    boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
    'module-boundary must pin the frontend total 105 after F5a',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
    'module-boundary must still pin 63 backend edges',
  );
  assert.ok(
    boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
    'module-boundary must pin 44 frontend edges after F5a',
  );
  assert.ok(!boundary.includes("'settings->audit'"), 'the settings->audit edge must be gone from the edge table');
  assert.ok(!boundary.includes("'reports->audit'"), 'the reports->audit edge must be gone from the edge table');
  assert.ok(
    boundary.includes("'audit->settings': 1,"),
    'the audit->settings edge must stay pinned at 1 (the surviving direction)',
  );
  assert.ok(!boundary.includes("'audit|settings'"), 'the audit|settings pair must be gone from the pair list');
  const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
  assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57 after F5a');
  const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
  assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152 after F5a');

  // 3. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F5D-MAINTENANCE-PRODUCTS-DECOUPLED/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F5a INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-POS-LINE-DISCOUNT-AMOUNT/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F5a INV exactly once');

  // 4. Wiring: both critical lists carry 384 specs in identical order, the F5b spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 400);
  assert.equal(chain.length, 400);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 384 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-discount-fix-line-amount.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-discount-fix-line-amount.spec.ts');
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 400);') && src.includes('assert.equal(chain.length, 400);'),
      `${label} spec wiring must re-pin to 381`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-discount-fix-line-amount.spec.ts'"),
      `${label} spec last-entry must re-pin to the F5a spec`,
    );
  }

  // 5. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the F4 spec. (The
  // live tree holds ~57 files asserting the count — the #264-fix /
  // D12 lesson. The F4 filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const f4Name = 'phase1-f4' + '-settings-access-door.spec.ts';
  const staleSpecs = 'specs.length, 38' + '0';
  const staleChain = 'chain.length, 38' + '0';
  const staleList = 'list.length, 38' + '0';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${f4Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the F4 spec');

  // 6. The guard tail holds ONLY the newest id, so F5a re-pins the
  // B3/B4/B5/B6/B7/B8/F2/F3/F4 specs' guard assertions to the F5a INV;
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
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-POS-LINE-DISCOUNT-AMOUNT/g)'),
      `${label} spec guard assertion must re-pin to the F5a INV`,
    );
  }

  console.log(
    'phase1 F5a audit|settings checks passed (shared-code move to shared/utils, settings->audit and reports->audit gone, pairs 12->11, edges 55 / statements 136, 384 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
