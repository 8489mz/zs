/*
 * FE4 computed-money pin (Phase 5, unification batch U7).
 *
 * Scope decision (parent, 2026-11-08): the adopted FE partition is U7's
 * area partition as-is with COMPUTED-ONLY scope — display-only `toFixed(2)`
 * stays out of scope (Phase 0 §1.10). This spec pins the computed side only:
 * in the 39 FE4 files (delivery-reps + maintenance + tradein) there must be
 * ZERO remaining computed-money `toFixed(2)` sites, i.e. zero occurrences
 * of `.toFixed(2)` inside a `Number(...)` / `parseFloat(...)` call, which
 * is the shape that turns a formatted string back into a number and feeds
 * further calculation, a total, a posted value, or a decision.
 *
 * The 17 money sites found at HEAD 30a84e93 now route through the single
 * shared `roundMoney` in `features/delivery-reps/utils/van-money.utils.ts`
 * (same `toFixed(2)` semantics, so no value changed — pure deduplication).
 *
 * Allowlist (guard precedent: single known exception, max count): exactly
 * TWO shape-B sites remain, both in
 * `components/DriverNewLoadRequisitionView.tsx`, both QUANTITY stepping
 * (`currentQty +/- step`, weighted products, step 0.5) — not money. Each
 * allowlisted line must contain a quantity marker, so a money site cannot
 * hide in the allowlist; a third site fails the spec.
 *
 * Display-only `toFixed(2)` (formatting an already-computed value for
 * rendering/printing, e.g. `Number(x).toFixed(2)` in JSX) is intentionally
 * NOT pinned here — it is out of scope and may change freely.
 *
 * Style follows `architecture-guard.spec.ts` (file scanning on disk, plain
 * node:assert, ts-node, no test runner, no DB). Run:
 *   npx ts-node test/critical/fe4-computed-money.spec.ts
 */
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FE4_ROOT = 'frontend/src/features';

const FE4_FILES: string[] = [
  'delivery-reps/components/DriverLoadRequisitionModal.tsx',
  'delivery-reps/components/DriverNewLoadRequisitionView.tsx',
  'delivery-reps/components/FleetVehiclesTab.tsx',
  'delivery-reps/components/VanCollectionReceiptModal.tsx',
  'delivery-reps/components/VanCollectionTab.tsx',
  'delivery-reps/components/VanCustomerStatementModal.tsx',
  'delivery-reps/components/VanDamagedSwapModal.tsx',
  'delivery-reps/components/VanFieldReturnsAdminTab.tsx',
  'delivery-reps/components/VanFinancialLedgerAdminTab.tsx',
  'delivery-reps/components/VanFleetTab.tsx',
  'delivery-reps/components/VanInventoryTab.tsx',
  'delivery-reps/components/VanInvoiceReviewModal.tsx',
  'delivery-reps/components/VanPreSalesAdminTab.tsx',
  'delivery-reps/components/VanPreSalesTab.tsx',
  'delivery-reps/components/VanRepTargetsAdminTab.tsx',
  'delivery-reps/components/VanSaleCheckoutModal.tsx',
  'delivery-reps/components/VanSaleTab.tsx',
  'delivery-reps/components/VanSalesHistoryTab.tsx',
  'delivery-reps/components/VanSalesReceiptModal.tsx',
  'delivery-reps/components/VanSettleTab.tsx',
  'delivery-reps/components/VanSettlementReceiptModal.tsx',
  'delivery-reps/components/VanSignaturePadModal.tsx',
  'delivery-reps/components/VanTripsTab.tsx',
  'delivery-reps/components/VanVisitsTrackingAdminTab.tsx',
  'delivery-reps/components/VehicleMaintenanceModal.tsx',
  'delivery-reps/pages/VanSalesMobilePage.tsx',
  'delivery-reps/utils/escpos-printer.util.ts',
  'delivery-reps/utils/van-collection-receipt.utils.ts',
  'delivery-reps/utils/van-sales-receipt.utils.ts',
  'delivery-reps/utils/van-settlement-receipt.utils.ts',
  'maintenance/components/MaintenanceCreateTicketModal.tsx',
  'maintenance/components/MaintenanceDetailModal.tsx',
  'maintenance/components/MaintenanceReceiptModal.tsx',
  'maintenance/components/MaintenanceSettlementModal.tsx',
  'maintenance/components/tickets/MaintenanceTicketsKpiCards.tsx',
  'maintenance/components/tickets/MaintenanceTicketsTable.tsx',
  'maintenance/utils/maintenance-receipt.utils.ts',
  'tradein/components/TradeInDisclaimerModal.tsx',
  'tradein/pages/TradeInPage.tsx',
];

const HELPER_REL = 'delivery-reps/utils/van-money.utils.ts';
const HELPER_IMPORT = "from '../utils/van-money.utils'";
const QUANTITY_ALLOWLIST_FILE =
  'delivery-reps/components/DriverNewLoadRequisitionView.tsx';
const QUANTITY_ALLOWLIST_MAX = 2;

interface ShapeBViolation {
  file: string;
  line: number;
  snippet: string;
}

function stripComments(source: string): string {
  // Blank out comments but keep every newline, so line numbers stay exact.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function lineNumberOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Find every `Number(...)` / `parseFloat(...)` call whose balanced-paren
 * argument contains `.toFixed(2)` — the computed-money shape. A bare
 * `Number(x).toFixed(2)` (formatting, string result) does NOT match: the
 * `.toFixed(2)` there sits outside the `Number(...)` call.
 */
function shapeBViolations(source: string, file: string): ShapeBViolation[] {
  const found: ShapeBViolation[] = [];
  const re = /(Number|parseFloat)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    const inner = source.slice(m.index + m[0].length, i - 1);
    if (inner.includes('.toFixed(2)')) {
      const line = lineNumberOf(source, m.index);
      found.push({
        file,
        line,
        snippet: source.split('\n')[line - 1].trim().slice(0, 120),
      });
    }
  }
  return found;
}

async function main(): Promise<void> {
  assert.equal(FE4_FILES.length, 39, 'FE4 file list must stay at 39 files');

  // 1. The shared rounder exists, exports roundMoney, and is the single
  //    implementation site: exactly one `.toFixed(2)` in the helper.
  const helperPath = path.join(REPO_ROOT, FE4_ROOT, HELPER_REL);
  assert.ok(fs.existsSync(helperPath), `${HELPER_REL} must exist`);
  const helper = fs.readFileSync(helperPath, 'utf8');
  const helperCode = stripComments(helper);
  assert.ok(
    /export function roundMoney\(value: number\): number/.test(helperCode),
    'helper must export roundMoney(value: number): number',
  );
  assert.ok(
    helperCode.includes('Number(value.toFixed(2))'),
    'helper must implement the toFixed(2) rounding it replaces',
  );
  assert.equal(
    helperCode.split('.toFixed(2)').length - 1,
    1,
    'helper must contain exactly one .toFixed(2) in code — the canonical site',
  );

  // 2. The numeric proof for the rounder exists (Vitest spec, runs in CI).
  const vitestSpec = path.join(
    REPO_ROOT,
    FE4_ROOT,
    'delivery-reps/utils/van-money.utils.spec.ts',
  );
  assert.ok(fs.existsSync(vitestSpec), 'van-money.utils.spec.ts must exist');
  const vitest = fs.readFileSync(vitestSpec, 'utf8');
  assert.ok(
    vitest.includes("from './van-money.utils'"),
    'Vitest spec must import the production rounder, not re-implement it',
  );
  assert.ok(
    vitest.includes('roundMoney(1.005)'),
    'Vitest spec must pin the 1.005 float-boundary case',
  );

  // 3. Exactly the three fixed components import the shared rounder.
  const importers: string[] = [];
  for (const rel of FE4_FILES) {
    const full = path.join(REPO_ROOT, FE4_ROOT, rel);
    assert.ok(fs.existsSync(full), `${rel} must exist`);
    const src = fs.readFileSync(full, 'utf8');
    if (src.includes(HELPER_IMPORT)) importers.push(rel);
  }
  assert.deepEqual(
    importers.sort(),
    [
      'delivery-reps/components/VanDamagedSwapModal.tsx',
      'delivery-reps/components/VanPreSalesTab.tsx',
      'delivery-reps/components/VanSaleCheckoutModal.tsx',
    ],
    'exactly the three fixed components must import the shared rounder',
  );

  // 4. Zero computed-money shape-B sites, except the quantity allowlist.
  const all: ShapeBViolation[] = [];
  for (const rel of FE4_FILES) {
    const full = path.join(REPO_ROOT, FE4_ROOT, rel);
    const stripped = stripComments(fs.readFileSync(full, 'utf8'));
    all.push(...shapeBViolations(stripped, rel));
  }
  const allowed = all.filter((v) => v.file === QUANTITY_ALLOWLIST_FILE);
  const forbidden = all.filter((v) => v.file !== QUANTITY_ALLOWLIST_FILE);
  assert.equal(
    forbidden.length,
    0,
    `computed-money toFixed(2) sites must be zero outside the quantity allowlist, found: ${JSON.stringify(forbidden)}`,
  );
  assert.ok(
    allowed.length <= QUANTITY_ALLOWLIST_MAX,
    `quantity allowlist allows at most ${QUANTITY_ALLOWLIST_MAX} sites, found ${allowed.length}`,
  );
  for (const v of allowed) {
    assert.ok(
      /currentQty|step/.test(v.snippet),
      `allowlisted site must be quantity stepping (currentQty/step), found: ${v.file}:${v.line}: ${v.snippet}`,
    );
  }
  assert.equal(
    all.length,
    allowed.length,
    'every shape-B site must be an allowlisted quantity site',
  );

  console.log(
    `fe4 computed money checks passed (${FE4_FILES.length} files, ${allowed.length} allowlisted quantity sites, 0 money sites)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
