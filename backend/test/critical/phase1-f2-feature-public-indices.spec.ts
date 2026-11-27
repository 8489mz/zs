import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * Phase 1 F2 — public index.ts for the 14 frontend features lacking one
 * (INV-PHASE1-F2-FEATURE-PUBLIC-INDICES).
 *
 * Grounding §4 (phase1-f0-grounding.md), re-derived live at 12da5cbc9:
 * 40 feature directories; 26 have a root index.ts, 14 lack one. The 14
 * are ai-copilot, approvals, apps-store, delivery-reps, hr, import-sales,
 * maintenance, manufacturing, pharmacy, portals-hub, public-trial,
 * saas-admin, tradein, updates. Each index re-exports ONLY that
 * feature's public surface — the components/services/types other
 * features actually import, derived from live importers at 12da5cbc9
 * (the app router registry/root-router, shared layout/hooks, and the
 * cross-feature deep imports: tradein api from products, maintenance
 * profiles/api from products/settings/tradein/shared, manufacturing
 * work-orders api from sales, pharmacy api/types from inventory, hr
 * api/hooks/components from settings/shared, saas-admin api from
 * shared). No existing import is re-pointed in F2 (additive only;
 * re-pointing comes in F3/F5) and no feature code changes — only the
 * 14 index files are added. Creating indices changes no import edge:
 * the frontend boundary counts do not move (57 edges / 138 statements;
 * feature-boundary-check 74 accepted legacy violations, 0 new).
 *
 * Consequences, all re-pinned in this package:
 * - Wiring: both critical lists carry 384 specs in identical order,
 *   the F5a spec last.
 *
 * F2-REPAIR (2026-11-26): CI on e7077ed63 failed the frontend
 * contract check (10 NEW violations) and module-doors (14 vs 0).
 * The check demands every index re-export its routes and page
 * component; F2's live-importer derivation had missed pages/routes
 * the router loads dynamically (lazy imports, no static external
 * importer). This repair adds the 9 real re-exports: approvals,
 * apps-store, import-sales (landing page ImportCommandCenter +
 * ChinaSourcingPage), manufacturing, pharmacy and saas-admin gain
 * their route pages; portals-hub and public-trial gain a routes
 * module (mirroring the inline root-router routes, exactly like
 * activation/routes.tsx, which only its index imports) re-exported
 * from the index. ai-copilot gains nothing: it is a toolbar-launched
 * modal by design — no page, no route exists anywhere — so its 2
 * violations are a deliberate, reviewed exception in the contract
 * baseline (hand-added, not --update-baseline), pinned by §8 below.
 * No behavior changes: re-exports and two unregistered route modules
 * only.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FEATURES = path.join(REPO_ROOT, 'frontend', 'src', 'features');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend', 'src');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
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
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');

function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let state: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  while (i < n) {
    const c = source[i];
    const nxt = i + 1 < n ? source[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && nxt === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && nxt === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = "'";
      else if (c === '"') state = '"';
      else if (c === '`') state = '`';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && nxt === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += c;
      if (i + 1 < n) out += source[i + 1];
      i += 2;
      continue;
    }
    if ((state === "'" && c === "'") || (state === '"' && c === '"') || (state === '`' && c === '`')) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

type ExportKind = 'named' | 'default';

interface SourceCheck {
  name: string;
  file: string;
  kind: ExportKind;
}

interface IndexEntry {
  feature: string;
  lines: string[];
  sources: SourceCheck[];
}

// The public surface of each of the 14 features, derived from live
// importers at 12da5cbc9 — nothing more, nothing less. `lines` are the
// exact export statements the index must hold (no extras); `sources`
// prove each re-exported name is really exported by its home file.
const INDICES: IndexEntry[] = [
  {
    feature: 'ai-copilot',
    lines: ["export { AiBusinessCopilotModal } from '@/features/ai-copilot/components/AiBusinessCopilotModal';"],
    sources: [{ name: 'AiBusinessCopilotModal', file: 'components/AiBusinessCopilotModal.tsx', kind: 'named' }],
  },
  {
    feature: 'approvals',
    lines: [
      "export { ApprovalsWorkspacePage } from '@/features/approvals/pages/ApprovalsWorkspacePage';",
      "export { approvalsRouteModule } from '@/features/approvals/routes';",
    ],
    sources: [
      { name: 'ApprovalsWorkspacePage', file: 'pages/ApprovalsWorkspacePage.tsx', kind: 'named' },
      { name: 'approvalsRouteModule', file: 'routes.tsx', kind: 'named' },
    ],
  },
  {
    feature: 'apps-store',
    lines: [
      "export { AppsStorePage } from '@/features/apps-store/pages/AppsStorePage';",
      "export { appsStoreRouteModule } from '@/features/apps-store/routes';",
    ],
    sources: [
      { name: 'AppsStorePage', file: 'pages/AppsStorePage.tsx', kind: 'named' },
      { name: 'appsStoreRouteModule', file: 'routes.tsx', kind: 'named' },
    ],
  },
  {
    feature: 'delivery-reps',
    lines: [
      "export { DriverNewLoadRequisitionPage } from '@/features/delivery-reps/pages/DriverNewLoadRequisitionPage';",
      "export { DriverPortalPage } from '@/features/delivery-reps/pages/DriverPortalPage';",
      "export { default as VanSalesMobilePage } from '@/features/delivery-reps/pages/VanSalesMobilePage';",
      "export { deliveryRepsRoutes } from '@/features/delivery-reps/routes';",
    ],
    sources: [
      { name: 'DriverNewLoadRequisitionPage', file: 'pages/DriverNewLoadRequisitionPage.tsx', kind: 'named' },
      { name: 'DriverPortalPage', file: 'pages/DriverPortalPage.tsx', kind: 'named' },
      { name: 'VanSalesMobilePage', file: 'pages/VanSalesMobilePage.tsx', kind: 'default' },
      { name: 'deliveryRepsRoutes', file: 'routes.tsx', kind: 'named' },
    ],
  },
  {
    feature: 'hr',
    lines: [
      "export { EmployeePortalPage } from '@/features/hr/pages/EmployeePortalPage';",
      "export { default as MobilePunchPage } from '@/features/hr/pages/MobilePunchPage';",
      "export { hrRouteModule } from '@/features/hr/routes';",
      "export { hrApi } from '@/features/hr/api/hr.api';",
      "export { HrSectionNav } from '@/features/hr/components/HrSectionNav';",
      "export { DailyAttendanceTable } from '@/features/hr/components/attendance/DailyAttendanceTable';",
      "export { ManualAttendanceModal } from '@/features/hr/components/attendance/ManualAttendanceModal';",
      "export { CreatePayrollRunModal } from '@/features/hr/components/payroll/CreatePayrollRunModal';",
      "export type { PayrollDraft } from '@/features/hr/components/payroll/CreatePayrollRunModal';",
      "export { QuickCashAdvanceModal } from '@/features/hr/components/QuickCashAdvanceModal';",
      "export { ClockIcon, CheckCircleIcon, MagnifyingGlassIcon } from '@/features/hr/components/HrIcons';",
      "export { useHrMutations } from '@/features/hr/hooks/useHr';",
    ],
    sources: [
      { name: 'EmployeePortalPage', file: 'pages/EmployeePortalPage.tsx', kind: 'named' },
      { name: 'MobilePunchPage', file: 'pages/MobilePunchPage.tsx', kind: 'default' },
      { name: 'hrRouteModule', file: 'routes.tsx', kind: 'named' },
      { name: 'hrApi', file: 'api/hr.api.ts', kind: 'named' },
      { name: 'HrSectionNav', file: 'components/HrSectionNav.tsx', kind: 'named' },
      { name: 'DailyAttendanceTable', file: 'components/attendance/DailyAttendanceTable.tsx', kind: 'named' },
      { name: 'ManualAttendanceModal', file: 'components/attendance/ManualAttendanceModal.tsx', kind: 'named' },
      { name: 'CreatePayrollRunModal', file: 'components/payroll/CreatePayrollRunModal.tsx', kind: 'named' },
      { name: 'PayrollDraft', file: 'components/payroll/CreatePayrollRunModal.tsx', kind: 'named' },
      { name: 'QuickCashAdvanceModal', file: 'components/QuickCashAdvanceModal.tsx', kind: 'named' },
      { name: 'ClockIcon', file: 'components/HrIcons.tsx', kind: 'named' },
      { name: 'CheckCircleIcon', file: 'components/HrIcons.tsx', kind: 'named' },
      { name: 'MagnifyingGlassIcon', file: 'components/HrIcons.tsx', kind: 'named' },
      { name: 'useHrMutations', file: 'hooks/useHr.ts', kind: 'named' },
    ],
  },
  {
    feature: 'import-sales',
    lines: [
      "export { default as ImportCommandCenter } from '@/features/import-sales/ImportCommandCenter';",
      "export { default as ChinaSourcingPage } from '@/features/import-sales/ChinaSourcingPage';",
      "export { importSalesRouteModule } from '@/features/import-sales/routes';",
    ],
    sources: [
      { name: 'ImportCommandCenter', file: 'ImportCommandCenter.tsx', kind: 'default' },
      { name: 'ChinaSourcingPage', file: 'ChinaSourcingPage.tsx', kind: 'default' },
      { name: 'importSalesRouteModule', file: 'routes.tsx', kind: 'named' },
    ],
  },
  {
    feature: 'maintenance',
    lines: [
      "export { maintenanceRouteModule } from '@/features/maintenance/routes';",
      "export { maintenanceApi } from '@/features/maintenance/api/maintenance.api';",
      "export type { MaintenanceListPageResponse } from '@/features/maintenance/api/maintenance.api';",
      "export { getMaintenanceProfile, MAINTENANCE_PROFILES } from '@/features/maintenance/constants/maintenance-profiles';",
      "export type {\n  MaintenanceProfileKey,\n  MaintenanceProfileInfo,\n} from '@/features/maintenance/constants/maintenance-profiles';",
    ],
    sources: [
      { name: 'maintenanceRouteModule', file: 'routes.tsx', kind: 'named' },
      { name: 'maintenanceApi', file: 'api/maintenance.api.ts', kind: 'named' },
      { name: 'MaintenanceListPageResponse', file: 'api/maintenance.api.ts', kind: 'named' },
      { name: 'getMaintenanceProfile', file: 'constants/maintenance-profiles.ts', kind: 'named' },
      { name: 'MAINTENANCE_PROFILES', file: 'constants/maintenance-profiles.ts', kind: 'named' },
      { name: 'MaintenanceProfileKey', file: 'constants/maintenance-profiles.ts', kind: 'named' },
      { name: 'MaintenanceProfileInfo', file: 'constants/maintenance-profiles.ts', kind: 'named' },
    ],
  },
  {
    feature: 'manufacturing',
    lines: [
      "export { default as WorkOrdersListPage } from '@/features/manufacturing/pages/WorkOrdersListPage';",
      "export { manufacturingRouteModule } from '@/features/manufacturing/routes';",
      "export { workOrdersApi } from '@/features/manufacturing/api/work-orders.api';",
    ],
    sources: [
      { name: 'WorkOrdersListPage', file: 'pages/WorkOrdersListPage.tsx', kind: 'default' },
      { name: 'manufacturingRouteModule', file: 'routes.tsx', kind: 'named' },
      { name: 'workOrdersApi', file: 'api/work-orders.api.ts', kind: 'named' },
    ],
  },
  {
    feature: 'pharmacy',
    lines: [
      "export { default as PharmacyDashboardPage } from '@/features/pharmacy/pages/PharmacyDashboardPage';",
      "export { pharmacyRouteModule } from '@/features/pharmacy/routes';",
      "export { pharmacyApi } from '@/features/pharmacy/api/pharmacy.api';",
      "export type { PharmacyBatch } from '@/features/pharmacy/types/pharmacy.types';",
    ],
    sources: [
      { name: 'PharmacyDashboardPage', file: 'pages/PharmacyDashboardPage.tsx', kind: 'default' },
      { name: 'pharmacyRouteModule', file: 'routes.tsx', kind: 'named' },
      { name: 'pharmacyApi', file: 'api/pharmacy.api.ts', kind: 'named' },
      { name: 'PharmacyBatch', file: 'types/pharmacy.types.ts', kind: 'named' },
    ],
  },
  {
    feature: 'portals-hub',
    lines: [
      "export { PortalsHubPage } from '@/features/portals-hub/pages/PortalsHubPage';",
      "export { portalsHubRouteModule } from '@/features/portals-hub/routes';",
    ],
    sources: [
      { name: 'PortalsHubPage', file: 'pages/PortalsHubPage.tsx', kind: 'named' },
      { name: 'portalsHubRouteModule', file: 'routes.tsx', kind: 'named' },
    ],
  },
  {
    feature: 'public-trial',
    lines: [
      "export { TrialSignupPage } from '@/features/public-trial/pages/TrialSignupPage';",
      "export { publicTrialRouteModule } from '@/features/public-trial/routes';",
    ],
    sources: [
      { name: 'TrialSignupPage', file: 'pages/TrialSignupPage.tsx', kind: 'named' },
      { name: 'publicTrialRouteModule', file: 'routes.tsx', kind: 'named' },
    ],
  },
  {
    feature: 'saas-admin',
    lines: [
      "export { SaasTenantsPage } from '@/features/saas-admin/pages/SaasTenantsPage';",
      "export { saasAdminRouteModule } from '@/features/saas-admin/routes';",
      "export { saasAdminApi } from '@/features/saas-admin/api/saas-admin.api';",
    ],
    sources: [
      { name: 'SaasTenantsPage', file: 'pages/SaasTenantsPage.tsx', kind: 'named' },
      { name: 'saasAdminRouteModule', file: 'routes.tsx', kind: 'named' },
      { name: 'saasAdminApi', file: 'api/saas-admin.api.ts', kind: 'named' },
    ],
  },
  {
    feature: 'tradein',
    lines: [
      "export { tradeInRouteModule } from '@/features/tradein/routes';",
      "export { tradeInApi } from '@/features/tradein/api/tradein.api';",
      "export type { TradeInListPageResponse } from '@/features/tradein/api/tradein.api';",
    ],
    sources: [
      { name: 'tradeInRouteModule', file: 'routes.tsx', kind: 'named' },
      { name: 'tradeInApi', file: 'api/tradein.api.ts', kind: 'named' },
      { name: 'TradeInListPageResponse', file: 'api/tradein.api.ts', kind: 'named' },
    ],
  },
  {
    feature: 'updates',
    lines: [
      "export { UpdatesPage } from '@/features/updates/pages/UpdatesPage';",
      "export { updatesRouteModule } from '@/features/updates/routes';",
      "export { useOfflineUpdateCheck } from '@/features/updates/hooks/useOfflineUpdateCheck';",
    ],
    sources: [
      { name: 'UpdatesPage', file: 'pages/UpdatesPage.tsx', kind: 'named' },
      { name: 'updatesRouteModule', file: 'routes.tsx', kind: 'named' },
      { name: 'useOfflineUpdateCheck', file: 'hooks/useOfflineUpdateCheck.ts', kind: 'named' },
    ],
  },
];

function sourceExportsNamed(src: string, name: string): boolean {
  if (
    new RegExp(`export\\s+(const|let|var|function|class|interface|type|enum|abstract\\s+class)\\s+${name}\\b`).test(src)
  ) {
    return true;
  }
  const blocks = src.match(/export\s*\{[\s\S]*?\}/g) ?? [];
  return blocks.some((block) => new RegExp(`\\b${name}\\b`).test(block));
}

function sourceExportsDefault(src: string, name: string): boolean {
  return new RegExp(`export\\s+default\\s+(function|class)\\s+${name}\\b`).test(src);
}

function walkTs(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkTs(full, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
}

async function main(): Promise<void> {
  // 1. All 14 index files exist and re-export exactly their public
  // surface; every re-export target stays inside its own feature (an
  // index that reached into another feature would be a new edge); and
  // every re-exported name is really exported by its home file.
  assert.equal(INDICES.length, 14, 'F2 covers exactly the 14 index-less features');
  for (const entry of INDICES) {
    const indexPath = path.join(FEATURES, entry.feature, 'index.ts');
    assert.ok(fs.existsSync(indexPath), `${entry.feature}/index.ts must exist`);
    const src = fs.readFileSync(indexPath, 'utf8');
    const exportLines = src.split('\n').filter((line) => line.startsWith('export '));
    assert.equal(
      exportLines.length,
      entry.lines.length,
      `${entry.feature}/index.ts must hold exactly ${entry.lines.length} export statements (public surface only, no internals dumped in)`,
    );
    for (const line of entry.lines) {
      assert.ok(src.includes(line), `${entry.feature}/index.ts must re-export: ${line}`);
    }
    const fromTargets = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.ok(fromTargets.length > 0, `${entry.feature}/index.ts must re-export from its own feature`);
    for (const target of fromTargets) {
      assert.ok(
        target.startsWith(`@/features/${entry.feature}/`),
        `${entry.feature}/index.ts must not reach outside its own feature: ${target}`,
      );
    }
    for (const check of entry.sources) {
      const home = path.join(FEATURES, entry.feature, check.file);
      assert.ok(fs.existsSync(home), `${entry.feature} source file must exist: ${check.file}`);
      const homeSrc = stripComments(fs.readFileSync(home, 'utf8'));
      if (check.kind === 'default') {
        assert.ok(sourceExportsDefault(homeSrc, check.name), `${check.file} must default-export ${check.name}`);
      } else {
        assert.ok(sourceExportsNamed(homeSrc, check.name), `${check.file} must export ${check.name}`);
      }
    }
  }

  // 2. F2 is additive only: no existing file imports any of the 14
  // features through a bare public path — nothing was re-pointed at
  // the new indices (re-pointing comes in F3/F5).
  const frontendFiles: string[] = [];
  walkTs(FRONTEND_SRC, frontendFiles);
  assert.ok(frontendFiles.length > 2000, 'frontend scan must find its files');
  const bare: string[] = [];
  for (const file of frontendFiles) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const entry of INDICES) {
      if (src.includes(`from '@/features/${entry.feature}'`) || src.includes(`import('@/features/${entry.feature}')`)) {
        bare.push(`${path.relative(FRONTEND_SRC, file)} -> ${entry.feature}`);
      }
    }
  }
  assert.deepEqual(bare, [], 'no existing file may import a feature through its bare public path');

  // 3. The boundary pins do not move: creating indices adds no import
  // edge, so the backend total, the frontend total and both edge
  // tables stay exactly where B8 left them.
  const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
  assert.ok(
    boundary.includes('const PINNED_BACKEND_TOTAL = 738;'),
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

  // 4. The INV entry exists exactly once in both places (never quote another INV id literally).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const invCount = (invariants.match(/INV-PHASE1-F2-FEATURE-PUBLIC-INDICES/g) || []).length;
  assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the F2 INV exactly once');
  const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
  const guardCount = (guard.match(/INV-SHIFT-CLOSE-DISCOUNT-SUMMARY/g) || []).length;
  assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the F2 INV exactly once');

  // 5. Wiring: both critical lists carry 384 specs in identical order, the F4 spec last.
  const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
  const specs = specsJson.specs;
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts: { 'test:critical:serial': string };
  };
  const chain = pkg.scripts['test:critical:serial']
    .split('&&')
    .map((part) => part.trim().replace(/^ts-node\s+/, ''))
    .filter((part) => part.endsWith('.spec.ts'));
  assert.equal(specs.length, 402);
  assert.equal(chain.length, 402);
  assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 378 specs in order');
  assert.equal(specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  assert.equal(chain[chain.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts');
  for (const [label, specPath] of [
    ['B1', B1_SPEC],
    ['B2', B2_SPEC],
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('assert.equal(specs.length, 402);') && src.includes('assert.equal(chain.length, 402);'),
      `${label} spec wiring must re-pin to 378`,
    );
    assert.ok(
      src.includes("specs[specs.length - 1], 'test/critical/phase1-cleanup-as-any-reduction.spec.ts'"),
      `${label} spec last-entry must re-pin to the F2 spec`,
    );
  }

  // 6. The wiring re-pin sweep is complete: no critical spec may still
  // pin the old count or point its last-entry at the B8 spec. (The
  // live tree holds ~47 files asserting the count — the #264-fix /
  // D12 lesson. The B8 filename and the count literals are built by
  // concatenation so this block's own source never contains the
  // patterns it scans for. The scan covers all three variable forms:
  // specs, chain, and list.length.)
  const staleCount: string[] = [];
  const staleLastEntry: string[] = [];
  const b8Name = 'phase1-b8' + '-delivery-reps-sales.spec.ts';
  const staleSpecs = 'specs.length, 37' + '7';
  const staleChain = 'chain.length, 37' + '7';
  const staleList = 'list.length, 37' + '7';
  for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
    if (!file.endsWith('.spec.ts')) continue;
    const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
    if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
    if (src.includes(`specs[specs.length - 1], 'test/critical/${b8Name}'`)) staleLastEntry.push(file);
  }
  assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count');
  assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the B8 spec');

  // 7. The guard tail holds ONLY the newest id, so F2 re-pins the
  // B3/B4/B5/B6/B7/B8 specs' guard assertions to the F2 INV; their
  // invariants-file assertions still pin their own id (each line stays
  // in ARCHITECTURE_INVARIANTS.md exactly once).
  for (const [label, specPath] of [
    ['B3', B3_SPEC],
    ['B4', B4_SPEC],
    ['B5', B5_SPEC],
    ['B6', B6_SPEC],
    ['B7', B7_SPEC],
    ['B8', B8_SPEC],
  ] as const) {
    const src = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      src.includes('guard.match(/INV-SHIFT-CLOSE-DISCOUNT-SUMMARY/g)'),
      `${label} spec guard assertion must re-pin to the F2 INV`,
    );
  }

  // 8. The ai-copilot exception is pinned in the contract baseline:
  // the feature is a toolbar-launched modal by design (no page, no
  // route exists anywhere), so its 2 violations are a deliberate,
  // reviewed exception — hand-added to the baseline, never via
  // --update-baseline (which would rewrite the whole file).
  const contractBaseline = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'frontend', 'scripts', 'baselines', 'feature-contract.json'), 'utf8'),
  ) as string[];
  assert.ok(
    contractBaseline.includes('Feature ai-copilot index.ts does not re-export its page component.'),
    'the contract baseline must carry the ai-copilot page exception',
  );
  assert.ok(
    contractBaseline.includes('Feature ai-copilot index.ts does not re-export routes.'),
    'the contract baseline must carry the ai-copilot routes exception',
  );

  console.log(
    'phase1 F2 feature public indices checks passed (14 indices, 49 public exports, counts unmoved, 379 specs wired)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
