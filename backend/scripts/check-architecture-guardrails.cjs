#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { countLines, enforceFileSizeCap, FILE_SIZE_CAP } = require('./file-size-guard.cjs');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function walk(dirPath, relBase = '') {
  const current = path.join(dirPath, relBase);
  const entries = fs.readdirSync(current, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const relPath = path.join(relBase, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(dirPath, relPath));
      continue;
    }
    out.push(relPath);
  }
  return out;
}

assert(exists('src/common/utils/location-stock-ledger.ts'), 'Missing location stock ledger utility');
assert(exists('src/database/migrations/1710000006000-location-stock-ledger.ts'), 'Missing location stock ledger migration');

const ledgerSource = read('src/common/utils/location-stock-ledger.ts');
for (const fnName of [
  'previewConsumableStockQty',
  'previewAssignedLocationStockQty',
  'applyStockDelta',
  'setScopedStockQty',
  'beginLocationTransfer',
  'receiveLocationTransfer',
  'restoreLocationTransfer',
  'relocateStockBetweenLocations',
]) {
  assert(ledgerSource.includes(`export async function ${fnName}`), `Location stock ledger is missing exported helper ${fnName}`);
}

assert(exists('src/modules/reports/helpers/reports-inventory.helper.ts'), 'Missing reports inventory helper');
const inventoryHelperSource = read('src/modules/reports/helpers/reports-inventory.helper.ts');
for (const fnName of ['groupInventoryLocationBreakdown', 'buildInventoryReportItems', 'buildInventoryLocationHighlights', 'buildInventorySummary']) {
  assert(inventoryHelperSource.includes(`export function ${fnName}`), `Reports inventory helper is missing exported helper ${fnName}`);
}

assert(exists('src/modules/reports/helpers/reports-ledger.helper.ts'), 'Missing reports ledger helper');
const ledgerHelperSource = read('src/modules/reports/helpers/reports-ledger.helper.ts');
for (const fnName of ['buildCustomerBalancesPayload', 'buildSupplierBalancesPayload', 'buildCustomerLedgerPayload', 'buildSupplierLedgerPayload', 'buildLedgerSummary']) {
  assert(ledgerHelperSource.includes(`export function ${fnName}`), `Reports ledger helper is missing exported helper ${fnName}`);
}

assert(exists('src/modules/reports/helpers/reports-summary.helper.ts'), 'Missing reports summary helper');
const summaryHelperSource = read('src/modules/reports/helpers/reports-summary.helper.ts');
for (const fnName of ['buildReportSummaryPayload', 'splitReturnRowsByType', 'buildTopProducts']) {
  assert(summaryHelperSource.includes(`export function ${fnName}`), `Reports summary helper is missing exported helper ${fnName}`);
}

assert(exists('src/modules/reports/helpers/reports-query.helper.ts'), 'Missing reports query helper');
const queryHelperSource = read('src/modules/reports/helpers/reports-query.helper.ts');
for (const fnName of ['buildReportListState']) {
  assert(queryHelperSource.includes(`export function ${fnName}`), `Reports query helper is missing exported helper ${fnName}`);
}

assert(exists('src/modules/reports/helpers/reports-query-pipeline.helper.ts'), 'Missing reports query pipeline helper');
const queryPipelineHelperSource = read('src/modules/reports/helpers/reports-query-pipeline.helper.ts');
for (const fnName of ['applyPartnerLedgerSearch', 'applySignedAmountFilter', 'applyTreasurySearch', 'applyAuditSearch']) {
  assert(queryPipelineHelperSource.includes(`export function ${fnName}`), `Reports query pipeline helper is missing exported helper ${fnName}`);
}

assert(exists('src/modules/reports/helpers/reports-dashboard.helper.ts'), 'Missing reports dashboard helper');
const dashboardHelperSource = read('src/modules/reports/helpers/reports-dashboard.helper.ts');
for (const fnName of ['buildDashboardSummary', 'buildDashboardStats', 'buildDashboardOverviewPayload', 'buildDashboardScope', 'buildDashboardComputedState']) {
  assert(dashboardHelperSource.includes(`export function ${fnName}`), `Reports dashboard helper is missing exported helper ${fnName}`);
}

assert(exists('src/modules/reports/helpers/reports-ops.helper.ts'), 'Missing reports ops helper');
const opsHelperSource = read('src/modules/reports/helpers/reports-ops.helper.ts');
for (const fnName of ['buildTreasuryPayload', 'buildAuditPayload', 'buildTreasurySummary']) {
  assert(opsHelperSource.includes(`export function ${fnName}`), `Reports ops helper is missing exported helper ${fnName}`);
}

const reportsServiceSource = read('src/modules/reports/reports.service.ts');
const reportsAdminServiceSource = read('src/modules/reports/services/reports-admin.service.ts');
const reportsCombinedSource = `${reportsServiceSource}\n${reportsAdminServiceSource}`;
assert(reportsServiceSource.includes('./helpers/reports-inventory.helper'), 'ReportsService must consume the inventory helper module');
assert(reportsServiceSource.includes('./helpers/reports-summary.helper'), 'ReportsService must consume the summary helper module');
assert(reportsServiceSource.includes('./helpers/reports-query.helper'), 'ReportsService must consume the query helper module');
assert(reportsServiceSource.includes('./helpers/reports-query-pipeline.helper'), 'ReportsService must consume the query pipeline helper module');
assert(reportsServiceSource.includes('./helpers/reports-dashboard.helper'), 'ReportsService must consume the dashboard helper module');
assert(reportsServiceSource.includes('./helpers/reports-ledger.helper'), 'ReportsService must consume the ledger helper module');
assert(reportsCombinedSource.includes('helpers/reports-ops.helper'), 'Reports services must consume the ops helper module');
assert(reportsServiceSource.includes('buildReportSummaryPayload'), 'ReportsService must delegate summary shaping to the summary helper');
assert(reportsServiceSource.includes('buildReportListState'), 'ReportsService must centralize list-query parsing via the query helper');
assert(reportsCombinedSource.includes('applyTreasurySearch'), 'Reports services must centralize treasury search wiring via the query pipeline helper');
assert(reportsServiceSource.includes('buildDashboardOverviewPayload'), 'ReportsService must delegate dashboard shaping to the dashboard helper');
assert(reportsServiceSource.includes('buildDashboardScope'), 'ReportsService must centralize dashboard date-scope derivation via the dashboard helper');
assert(reportsServiceSource.includes('buildDashboardComputedState'), 'ReportsService must delegate dashboard in-memory aggregate shaping to the dashboard helper');
assert(reportsCombinedSource.includes('buildTreasuryPayload'), 'Reports services must delegate treasury payload shaping to the ops helper');
assert(reportsCombinedSource.includes('buildAuditPayload'), 'Reports services must delegate audit payload shaping to the ops helper');
const reportsServiceLines = countLines(reportsServiceSource);
assert(reportsServiceLines <= 1000, `ReportsService is still too large (${reportsServiceLines} lines)`);
assert(reportsServiceSource.includes("leftJoin('stock_locations as l'"), 'Inventory reporting must join stock_locations explicitly');

const serviceRequirements = [
  ['src/modules/sales/services/sales-write.service.ts', ['applyStockDelta', 'previewConsumableStockQty']],
  ['src/modules/purchases/services/purchases-write.service.ts', ['applyStockDelta', 'previewConsumableStockQty']],
  ['src/modules/returns/returns.service.ts', ['applyStockDelta', 'previewConsumableStockQty']],
  // INV-ADJUST-SINGLE-QTY-BASIS (H1): the adjust service must NOT call setScopedStockQty —
  // the raw setter from the available target booked phantom losses, so its canonical
  // ledger integration is the available delta (applyStockDelta) capped by the
  // consumable preview (previewConsumableStockQty), pinned by
  // inventory-adjustment-single-basis.spec.ts:334. Both tokens are real calls.
  ['src/modules/inventory/services/inventory-adjustment.service.ts', ['applyStockDelta', 'previewConsumableStockQty']],
  ['src/modules/inventory/services/inventory-count.service.ts', ['applyStockDelta', 'setScopedStockQty', 'previewAssignedLocationStockQty']],
  ['src/modules/inventory/services/inventory-transfer.service.ts', ['applyStockDelta']],
  ['src/modules/settings/services/settings-import.service.ts', ['applyStockDelta']],
];

for (const [relPath, patterns] of serviceRequirements) {
  assert(exists(relPath), `Missing critical write-flow service: ${relPath}`);
  const content = read(relPath);
  for (const pattern of patterns) {
    assert(content.includes(pattern), `${relPath} is missing required stock-ledger integration token: ${pattern}`);
  }
}

const inventoryCountSource = read('src/modules/inventory/services/inventory-count.service.ts');
assert(inventoryCountSource.includes('branch_id: session.branch_id'), 'Stock count posting must stamp branch_id on stock movements');
assert(inventoryCountSource.includes('location_id: session.location_id'), 'Stock count posting must stamp location_id on stock movements');

const forbiddenDirectMutationPattern = /updateTable\((['"])products\1\)\s*\.set\(\{[^}]*\bstock_qty\b[^}]*\}\)/m;
const directMutationAllowList = new Set([
  'src/common/utils/location-stock-ledger.ts',
  'src/modules/maintenance/maintenance.service.ts',
  'src/modules/tradein/tradein.service.ts',
  'src/modules/import-sales/import-sales.service.ts',
  'src/modules/settings/services/settings-demo-data.service.ts',
]);

const tsFiles = walk(path.join(root, 'src')).filter((relPath) => relPath.endsWith('.ts'));
const offenders = [];
for (const relPath of tsFiles) {
  if (relPath.startsWith('database/migrations/')) continue;
  const normalized = `src/${relPath.replace(/\\/g, '/')}`;
  if (directMutationAllowList.has(normalized)) continue;
  const content = read(normalized);
  if (forbiddenDirectMutationPattern.test(content)) {
    offenders.push(normalized);
  }
}
assert(!offenders.length, `Direct products.stock_qty mutations found outside the ledger utility: ${offenders.join(', ')}`);

// File-size cap (INV-FILE-SIZE-CAP-RATCHET, proposed at merge): no production
// source file under src may exceed 1000 lines, except files recorded in the
// ratchet baseline (scripts/baselines/file-size.json) at their recorded line
// count. Baseline files may shrink but never grow; unlisted oversized files
// fail. Generated / master-data / hands-off files are allowlisted below and
// never counted; migrations are immutable and skipped entirely. Specs are
// not under the code cap. Regenerate the baseline only after a reviewed
// change: node scripts/check-architecture-guardrails.cjs --update-baseline
const FILE_SIZE_ALLOWLIST = new Set([
  'src/database/database.types.ts', // GENERATED — kysely-codegen
  'src/modules/tenant-subscription/pricing/pricing-catalog.generated.ts', // GENERATED
  'src/modules/pharmacy/data/egyptian-master-drugs.data.ts', // MASTER DATA
  'src/modules/maritime-freight/maritime-defaults.data.ts', // MASTER DATA
  // Migration 2040000000087 is also covered by the migrations skip below;
  // listed here so the allowlist is the single explicit record.
  'src/database/migrations/2040000000087_maritime_comprehensive_defaults.ts',
]);
const fileSizeResult = enforceFileSizeCap({
  srcRoot: path.join(root, 'src'),
  baselineFile: path.join(__dirname, 'baselines', 'file-size.json'),
  allowlist: FILE_SIZE_ALLOWLIST,
  skipPrefixes: ['src/database/migrations/'],
  cap: FILE_SIZE_CAP,
  updateBaseline: process.argv.includes('--update-baseline') || process.env.UPDATE_ARCH_BASELINE === '1',
});
if (fileSizeResult.shrunk.length) {
  console.log(
    `[check:architecture] file-size cap: ${fileSizeResult.shrunk.length} baseline file(s) shrank below their recorded count — remove them from the baseline when they reach <= ${FILE_SIZE_CAP} lines.`,
  );
}

console.log('[check:architecture] stock ledger guardrails and mutation flow coverage passed.');
console.log(
  `[check:architecture] file-size cap passed (${fileSizeResult.checked} files checked, ${fileSizeResult.overCap} over ${FILE_SIZE_CAP} lines, ${fileSizeResult.baselineEntries} baseline entries).`,
);
