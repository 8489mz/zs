import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  VatDeclarationService,
  vatDefaultPeriodFromTenantDay,
} from '../../src/modules/tax-integration/services/vat-declaration/vat-declaration.service';
import { warrantyEndDate } from '../../src/modules/contracting/services/contracting-quality.service';
import { rfqDateKey } from '../../src/modules/maritime-freight/maritime-freight-rfq-bids.service';
import { profitAttributionDefaultRange } from '../../src/modules/import-sales/import-sales.service';
import { summarizeSales } from '../../src/modules/sales/helpers/sales-query.helper';
import { HrLeaveService } from '../../src/modules/hr/services/hr-leave.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 final inspection, slice 5 — business-date R3
 * continuation (INV-BUSINESS-DATE-R3-CONTINUATION).
 *
 * THE GAP: the verification recount on the slice-4 tree found
 * 43 `toISOString().slice(0, 10)` sites in 33 files and 10
 * `split('T')[0]` sites in backend/src. Seven of them derive a
 * business-day key from UTC or from the host's local clock
 * instead of the tenant zone — the same root cause as the
 * earlier business-date slices (one root cause, one package):
 * at 01:00 Cairo on Nov 1 the VAT default period was October,
 * the GCC SMSA sentDate was Oct 31, the profit-attribution
 * default range started Oct 31, an HR holiday stored Nov 15
 * displayed Nov 14 on an east host, an RFQ date written
 * "15 Nov 2026" keyed Nov 14, and the contracting date
 * arithmetic used host-local setDate/setFullYear, which slips
 * a day across a DST transition (proven: Mar 28 + 2d on a
 * Berlin host, Oct 3 + 1y on a Sydney host).
 *
 * THE RULE: the seven real keys move to the tenant zone —
 * VAT defaults from resolveBusinessDateKey, the GCC sentDate
 * and the profit-attribution defaults from todayTenantDate,
 * HR holidays from normalizePgDateOnly, the RFQ date from a
 * shape-aware key, and the contracting arithmetic from UTC
 * calendar math. Everything else is classified kept, with the
 * reason recorded (see §4): validation round-trips, UTC
 * calendar math, UTC-midnight DTO dates, correct renderings,
 * display-only and demo sites.
 *
 * SCOPE DECISIONS (recorded, all from live code):
 * - VAT lines 235-236 stay. They render UTC-midnight period
 *   bounds back to day keys, which is correct; the defect was
 *   the DEFAULTS (UTC month), not the rendering. The instant
 *   bounds stay UTC-midnight over the selected calendar days,
 *   exactly as for an explicit query — only the selected month
 *   changes.
 * - summarizeSales :194 stays. Its UTC-slice fallback is
 *   pinned legacy behaviour by two specs, and its today
 *   computation is dead in production: its only production
 *   caller (listSales) overrides the today fields with
 *   tenant-keyed SQL aggregates. No parameter is threaded
 *   through listSales — that would be dead code. §1e re-pins
 *   the legacy behaviour so the keep is deliberate.
 * - The contracting site-operations end date keeps its UTC
 *   slice rendering and changes only setDate -> setUTCDate:
 *   the defect was the arithmetic, not the rendering, so the
 *   slice ratchet does not move (43 stays 43).
 * - The commercial profit-attribution service does NOT
 *   change: its UTC slices render UTC-midnight DTO dates,
 *   which is correct. The defaults move to the facade, which
 *   already owns the db handle.
 * - The profit-report sibling: the §3 pin caught a second
 *   host-local month-start in the same controller
 *   (generateProfitReport) and a third in the command-center
 *   metrics, where the profit-report service already held the
 *   tenant todayKey for its ACI window. Same root cause, same
 *   package: both move to the tenant month, and the
 *   period-report service itself already keys every bound in
 *   the tenant zone.
 * - No new feature-module import anywhere: every new import
 *   is from common/ (the boundary scanner does not count
 *   it), and the VAT engine import merges into an existing
 *   line. Boundary / frontend / baseline / write pins do not
 *   move, and no migration is added (highest stays 0344).
 *
 * WHAT THIS PINS:
 * - §1: the pure helpers (VAT default period, warranty end,
 *   RFQ date key, profit-attribution default range) and the
 *   summarizeSales legacy behaviour that justifies its keep.
 * - §2: the real services on PGlite — the VAT default period
 *   follows the tenant month, and an HR holiday round-trips
 *   its stored day.
 * - §3: CONTROL — static pins on every converted site (the
 *   old spelling is gone, the new call is present) + the
 *   kept renderings that must not be "fixed".
 * - §4: the ratchet — 43 slice sites / 6 split sites with
 *   the per-file counts and the kept-file set, the two
 *   multi-line twins (excluded by the single-line method),
 *   and the engine-map business-date row.
 * - §5: the INV exists exactly once in
 *   ARCHITECTURE_INVARIANTS.md and exactly once in the
 *   guard tail.
 * - §6: wiring 411 in both lists, this spec last,
 *   all earlier specs re-pinned (counts, last-entry).
 * - §7: the re-pin sweep is complete (no stale count,
 *   last-entry or guard INV remains).
 * - §8: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §9: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5)
 *   and the "highest migration" pins still point at 0344.
 *
 * Wiring: both critical lists carry 411 specs in identical
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
const ENGINE_MAP = path.join(REPO_ROOT, 'docs', 'ENGINE_MAP.md');
const VAT_SERVICE = path.join(
  BACKEND,
  'src',
  'modules',
  'tax-integration',
  'services',
  'vat-declaration',
  'vat-declaration.service.ts',
);
const GCC_SERVICE = path.join(BACKEND, 'src', 'modules', 'gcc-shipping', 'gcc-shipping.service.ts');
const SITE_OPS_SERVICE = path.join(
  BACKEND,
  'src',
  'modules',
  'contracting',
  'services',
  'contracting-site-operations.service.ts',
);
const QUALITY_SERVICE = path.join(
  BACKEND,
  'src',
  'modules',
  'contracting',
  'services',
  'contracting-quality.service.ts',
);
const HR_LEAVE_SERVICE = path.join(BACKEND, 'src', 'modules', 'hr', 'services', 'hr-leave.service.ts');
const RFQ_SERVICE = path.join(BACKEND, 'src', 'modules', 'maritime-freight', 'maritime-freight-rfq-bids.service.ts');
const PROFIT_CONTROLLER = path.join(BACKEND, 'src', 'modules', 'import-sales', 'import-sales.controller.ts');
const PROFIT_FACADE = path.join(BACKEND, 'src', 'modules', 'import-sales', 'import-sales.service.ts');
const PROFIT_COMMERCIAL = path.join(
  BACKEND,
  'src',
  'modules',
  'import-sales',
  'services',
  'import-commercial.service.ts',
);
const PROFIT_REPORT_SERVICE = path.join(
  BACKEND,
  'src',
  'modules',
  'import-sales',
  'services',
  'import-profit-report.service.ts',
);
const SALES_QUERY_HELPER = path.join(BACKEND, 'src', 'modules', 'sales', 'helpers', 'sales-query.helper.ts');
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
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';

const NEW_INV = 'INV-BUSINESS-DATE-R3-CONTINUATION';
const NEW_SPEC_NAME = 'phase1-final-s5-business-date-r3.spec.ts';

// §4 ratchet data: every backend/src file that still carries the
// single-line UTC-slice spelling, with its count. The set is
// append-only in the ratchet sense: a later slice converts a file
// by editing this map deliberately, never silently.
const KEPT_SLICE_COUNTS: Record<string, number> = {
  'modules/contracting/services/contracting-site-operations.service.ts': 3,
  'common/utils/client-date-bounds.util.ts': 3,
  'modules/import-sales/services/import-commercial.service.ts': 2,
  'modules/hr/hr-helpers.ts': 2,
  'modules/hr/engines/hr-statutory-policy.engine.ts': 2,
  'modules/cash-drawer/helpers/cash-drawer.helper.ts': 2,
  'modules/accounting/engines/fiscal-period-generation.engine.ts': 2,
  'modules/accounting/engines/accounting-date.engine.ts': 2,
  'modules/storefront/engines/storefront-offers.engine.ts': 1,
  'modules/sales/helpers/sales-write.helper.ts': 1,
  'modules/sales/helpers/sales-query.helper.ts': 1,
  'modules/returns/helpers/returns-listing.helper.ts': 1,
  'modules/reports/services/daily-commercial-rollup.service.ts': 1,
  'modules/purchases/services/supplier-payment-schedules.service.ts': 1,
  'modules/purchases/services/purchases-write-update.service.ts': 1,
  'modules/purchases/services/purchases-write-create.service.ts': 1,
  'modules/purchases/services/goods-receipt-post.service.ts': 1,
  'modules/purchases/engines/duplicate-bill-detector.engine.ts': 1,
  'modules/pharmacy/pharmacy/batches.slice.ts': 1,
  'modules/maritime-freight/maritime-freight-jobs-containers.service.ts': 1,
  'modules/import-sales/import-container-helpers/import-container-helpers.ts': 1,
  'modules/hr/services/hr-payroll-runs.service.ts': 1,
  'modules/hr/services/end-of-service.service.ts': 1,
  'modules/hr/payroll-loan-allocation.engine.ts': 1,
  'modules/hr/engines/hourly-attendance-pay.engine.ts': 1,
  'modules/hr/employee-portal.service.ts': 1,
  'modules/delivery-reps/van-settlement-split.engine.ts': 1,
  'modules/contracting/services/contracting-posting.service.ts': 1,
  'modules/accounting/services/pdc-cheques/update-cheque-status.slice.ts': 1,
  'modules/accounting/services/pdc-cheques/create-cheque.slice.ts': 1,
  'modules/accounting/services/forex-revaluation.service.ts': 1,
  'modules/accounting/remediation/sale-edit-remediation-repair.engine.ts': 1,
  'common/utils/tenant-timezone.util.ts': 1,
};

// §4 ratchet data: every backend/src file that still carries the
// `split('T')[0]` spelling, with its count. The four converted
// sites (warranty, GCC, two HR holiday lines) are gone; the RFQ
// YYYY-first branch keeps one by design.
const KEPT_SPLIT_COUNTS: Record<string, number> = {
  'modules/maritime-freight/maritime-freight-rfq-bids.service.ts': 1,
  'modules/tax-integration/services/vat-declaration/vat-declaration.service.ts': 2,
  'modules/settings/services/demo-data/settings-demo-data-seed.ts': 2,
  'modules/delivery-reps/rep-target/rep-target-metrics.slice.ts': 1,
};

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectTsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function countLiteral(src: string, literal: string): number {
  return src.split(literal).length - 1;
}

async function main(): Promise<void> {
  // §1a: the VAT default period is the tenant month, from the
  // tenant day key — never the UTC month.
  {
    const nov = vatDefaultPeriodFromTenantDay('2026-11-15');
    assert.equal(nov.from.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(nov.to.toISOString(), '2026-12-01T00:00:00.000Z');
    const oct = vatDefaultPeriodFromTenantDay('2026-10-31');
    assert.equal(oct.from.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(oct.to.toISOString(), '2026-11-01T00:00:00.000Z');
    const dec = vatDefaultPeriodFromTenantDay('2026-12-15');
    assert.equal(dec.from.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(dec.to.toISOString(), '2027-01-01T00:00:00.000Z');
    assert.throws(() => vatDefaultPeriodFromTenantDay('2026-13-40'), 'a malformed day key must fail loudly');
    assert.throws(() => vatDefaultPeriodFromTenantDay(''), 'an empty day key must fail loudly');
    console.log('  ✓ §1a VAT default period from the tenant day');
  }

  // §1b: the warranty end is UTC calendar math — the host clock
  // and its DST transitions cannot move it.
  {
    assert.equal(warrantyEndDate('2026-11-01'), '2027-11-01');
    assert.equal(warrantyEndDate('2026-10-03'), '2027-10-03');
    assert.equal(warrantyEndDate('2023-02-28'), '2024-02-28');
    // Feb 29 rolls to Mar 1, exactly as the old setFullYear did.
    assert.equal(warrantyEndDate('2024-02-29'), '2025-03-01');
    assert.throws(
      () => warrantyEndDate('not-a-date'),
      (error: unknown) => error instanceof RangeError,
      'an invalid warranty start must throw like the old rendering did',
    );
    console.log('  ✓ §1b warranty end on UTC calendar math');
  }

  // §1c: the RFQ date key keeps the written day for every shape
  // the carrier text can carry; unparseable text passes through.
  {
    assert.equal(rfqDateKey('2026-11-15'), '2026-11-15');
    assert.equal(rfqDateKey('15 Nov 2026'), '2026-11-15');
    assert.equal(rfqDateKey('Nov 15, 2026'), '2026-11-15');
    assert.equal(rfqDateKey('2026/11/15'), '2026-11-15');
    assert.equal(rfqDateKey('11/15/2026'), '2026-11-15');
    assert.equal(rfqDateKey('no date here'), 'no date here');
    console.log('  ✓ §1c RFQ date key keeps the written day');
  }

  // §1d: the profit-attribution default range is month-start to
  // the tenant today.
  {
    assert.deepEqual(profitAttributionDefaultRange('2026-11-15'), { start: '2026-11-01', end: '2026-11-15' });
    assert.deepEqual(profitAttributionDefaultRange('2026-01-05'), { start: '2026-01-01', end: '2026-01-05' });
    assert.throws(() => profitAttributionDefaultRange('garbage'), 'a malformed day key must fail loudly');
    console.log('  ✓ §1d profit-attribution default range');
  }

  // §1e: the summarizeSales legacy behaviour is PINNED, not fixed.
  // No todayKey + ISO-string rows count by the UTC day (the old
  // reports-query-book-digits pin); an explicit todayKey + date-only
  // string rows count by that key (the business-date-display pin).
  // This is why :194 stays: changing it would break both specs for
  // a computation no production caller reads.
  {
    const nowIso = new Date().toISOString();
    const rows = [
      { date: nowIso, total: 100.13, paymentType: 'cash', status: 'posted', createdBy: 'A' },
      { date: nowIso, total: 50, paymentType: 'cash', status: 'posted', createdBy: 'A' },
    ];
    const legacy = summarizeSales(rows as never, 2);
    assert.equal(legacy.todaySalesCount, 2, 'legacy UTC fallback must still count ISO-string rows');
    assert.equal(legacy.todaySalesTotal, 150.13);
    const keyed = summarizeSales(
      [
        { date: '2026-11-08', total: 100, paymentType: 'cash', status: 'posted', createdBy: 'A' },
        { date: '2026-11-07', total: 50, paymentType: 'cash', status: 'posted', createdBy: 'A' },
      ] as never,
      2,
      '2026-11-08',
    );
    assert.equal(keyed.todaySalesCount, 1, 'an explicit todayKey must count only that day');
    assert.equal(keyed.todaySalesTotal, 100);
    const helper = fs.readFileSync(SALES_QUERY_HELPER, 'utf8');
    assert.ok(
      helper.includes('const today = todayKey ?? new Date().toISOString().slice(0, 10);'),
      'the legacy UTC fallback must stay in the helper source',
    );
    console.log('  ✓ §1e summarizeSales legacy behaviour pinned');
  }

  // §2: the real services on PGlite.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    const auth = {
      tenantId: 't1',
      accountId: 'a1',
      role: 'admin',
      userId: 1,
      permissions: [],
    } as unknown as AuthContext;
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        CREATE TABLE tenants (id text PRIMARY KEY, business_name text, owner_name text, owner_phone text);
        CREATE TABLE tenant_tax_settings (id serial PRIMARY KEY, tenant_id text, account_id text, provider text, tax_id text, is_active boolean);
        CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz, subtotal numeric, discount numeric, service_charge numeric, tax_amount numeric, total numeric, tax_rate numeric, prices_include_tax boolean);
        CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, status text, created_at timestamptz, subtotal numeric, discount numeric, tax_amount numeric, total numeric, tax_rate numeric, prices_include_tax boolean);
        CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_at timestamptz, total numeric);
        CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text, return_document_id bigint, allocated_tax numeric);
        CREATE TABLE hr_holidays (id serial PRIMARY KEY, tenant_id text, name text, start_date date, end_date date);
        INSERT INTO tenants VALUES ('t1','Test Co','Owner','0100');
        INSERT INTO settings VALUES ('t1','country','EG'),('t1','currency','EGP'),('t1','timezone','Africa/Cairo');
        INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
        INSERT INTO tenant_tax_settings (tenant_id, account_id, provider, tax_id, is_active) VALUES ('t1','a1','ETA_EGYPT','123456789',true);
        INSERT INTO hr_holidays (tenant_id, name, start_date, end_date) VALUES ('t1','Eid','2026-11-15','2026-11-20');
      `);
      // A sale right now: it must fall inside the default period
      // whichever month the tenant is in when this runs.
      const nowIso = new Date().toISOString();
      await pg.exec(`INSERT INTO sales VALUES (1,'t1','posted','${nowIso}',1000,0,0,140,1140,14,false)`);

      // §2a: no from/to in the query — the defaults are the tenant
      // month, and the sale made right now is inside the period.
      const vat = new VatDeclarationService(db);
      const decl = await vat.getDeclaration({} as never, auth);
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = new Map(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
      const year = parts.get('year') as string;
      const month = parts.get('month') as string;
      const expectedFrom = `${year}-${month}-01`;
      const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
      const expectedTo = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
      assert.equal(decl.period.from, expectedFrom, 'the default period must start on the tenant month');
      assert.equal(decl.period.to, expectedTo, 'the default period must end on the tenant month');
      assert.equal(decl.period.country, 'EG');
      assert.equal(
        decl.output_tax.standard_rated_tax,
        140,
        'the sale made right now must be inside the default period',
      );

      // §2b: the stored holiday day round-trips — the pg DATE row
      // is a local-midnight Date, and the listing must show the
      // stored day, not the day before it.
      const leave = new HrLeaveService({
        db,
        tx: {} as never,
        audit: {} as never,
        tenantPredicate: () => sql<boolean>`true`,
      });
      const listed = (await leave.listHolidays({}, auth)) as {
        rows: Array<{ startDate: string; endDate: string }>;
      };
      assert.equal(listed.rows.length, 1);
      assert.equal(listed.rows[0]?.startDate, '2026-11-15', 'the holiday must keep its stored start day');
      assert.equal(listed.rows[0]?.endDate, '2026-11-20', 'the holiday must keep its stored end day');
      console.log('  ✓ §2 PGlite VAT defaults + HR holiday round-trip');
    } finally {
      await db.destroy();
    }
  }

  // §3: CONTROL — the old spelling is gone from every converted
  // site and the new call is present; the kept renderings stay.
  {
    const vat = fs.readFileSync(VAT_SERVICE, 'utf8');
    assert.ok(
      vat.includes('resolveBusinessDateKey(this.db, scope.tenantId, now)'),
      'VAT defaults must resolve the business day from the tenant zone',
    );
    assert.ok(
      vat.includes('vatDefaultPeriodFromTenantDay(todayKey)'),
      'VAT defaults must come from the tenant-day helper',
    );
    assert.ok(!vat.includes('now.getUTCFullYear(), now.getUTCMonth()'), 'the UTC-month defaults must be gone from VAT');
    assert.ok(vat.includes('from: fromDate.toISOString().split'), 'the VAT from/to rendering stays (it is correct)');

    const gcc = fs.readFileSync(GCC_SERVICE, 'utf8');
    assert.ok(
      gcc.includes('todayTenantDate(await getTenantTimezone(this.db, tenantId), now)'),
      'the GCC sentDate must come from the tenant day',
    );
    assert.ok(!gcc.includes('sentDate: now.toISOString().split'), 'the UTC sentDate must be gone from GCC');

    const siteOps = fs.readFileSync(SITE_OPS_SERVICE, 'utf8');
    assert.ok(
      siteOps.includes('s.setUTCDate(s.getUTCDate() + durationDays)'),
      'the site-ops end date must use UTC calendar math',
    );
    assert.ok(
      !siteOps.includes('s.setDate(s.getDate() + durationDays)'),
      'the host-local setDate must be gone from site-ops',
    );

    const quality = fs.readFileSync(QUALITY_SERVICE, 'utf8');
    assert.ok(quality.includes('warrantyEndDate(warrantyStart)'), 'the warranty end must come from the UTC helper');
    assert.ok(
      !quality.includes('d.setFullYear(d.getFullYear() + 1)'),
      'the host-local setFullYear must be gone from quality',
    );

    const hrLeave = fs.readFileSync(HR_LEAVE_SERVICE, 'utf8');
    assert.ok(
      hrLeave.includes('normalizePgDateOnly(row.start_date)'),
      'the holiday start must normalize the pg DATE row',
    );
    assert.ok(hrLeave.includes('normalizePgDateOnly(row.end_date)'), 'the holiday end must normalize the pg DATE row');
    assert.ok(
      !hrLeave.includes("new Date(row.start_date as string).toISOString().split('T')[0]"),
      'the UTC-sliced holiday start must be gone',
    );
    assert.ok(
      !hrLeave.includes("new Date(row.end_date as string).toISOString().split('T')[0]"),
      'the UTC-sliced holiday end must be gone',
    );

    const rfq = fs.readFileSync(RFQ_SERVICE, 'utf8');
    assert.ok(rfq.includes('return rfqDateKey(match[1].trim());'), 'the RFQ extractor must call the shape-aware key');
    assert.ok(
      rfq.includes('if (/^\\d{4}-\\d{2}-\\d{2}/.test(rawDate))'),
      'the RFQ key must keep the UTC slice for dash dates only',
    );
    assert.ok(rfq.includes('formatLocalCalendarDay(parsed)'), 'the RFQ key must use local parts for non-dash dates');

    const controller = fs.readFileSync(PROFIT_CONTROLLER, 'utf8');
    assert.ok(
      !controller.includes('start.setDate(1)'),
      'the host-local month-start construction must be gone from the controller',
    );
    assert.ok(
      controller.includes(
        'return this.importSalesService.listProjectProfitAttribution(req.authContext!.tenantId!, startDate, endDate);',
      ),
      'the controller must pass the dates straight through to the facade',
    );
    const facade = fs.readFileSync(PROFIT_FACADE, 'utf8');
    assert.ok(
      facade.includes('resolveBusinessDateKey(this.db, tenantId, new Date())'),
      'the facade must resolve the tenant day for the defaults',
    );
    assert.ok(
      facade.includes('profitAttributionDefaultRange(todayKey)'),
      'the facade must use the default-range helper',
    );
    const commercial = fs.readFileSync(PROFIT_COMMERCIAL, 'utf8');
    assert.ok(
      commercial.includes(
        'async listProjectProfitAttribution(tenantId: string, startDate: string | Date, endDate: string | Date)',
      ),
      'the commercial signature must be unchanged',
    );
    assert.ok(
      controller.includes(
        'return this.importSalesService.generatePeriodProfitReport(\n      req.authContext!.tenantId!,\n      startDate,\n      endDate,\n      projectId,\n    );',
      ),
      'the profit-report endpoint must pass the dates straight through to the facade',
    );
    assert.equal(
      facade.split('profitAttributionDefaultRange(todayKey)').length - 1,
      2,
      'both profit default ranges in the facade must use the helper',
    );
    const profitReport = fs.readFileSync(PROFIT_REPORT_SERVICE, 'utf8');
    assert.ok(
      profitReport.includes('const monthStart = `${todayKey.slice(0, 8)}01`;'),
      'the command-center month-start must come from the resolved tenant day',
    );
    assert.ok(
      !profitReport.includes('monthStart.setDate(1)'),
      'the host-local month-start must be gone from the profit-report service',
    );
    console.log('  ✓ §3 converted sites pinned, kept renderings kept');
  }

  // §4: the ratchet — 43 slice sites / 6 split sites, per-file,
  // with the kept-file sets; the two multi-line twins stay
  // outside the single-line method; the engine-map row.
  {
    const files = collectTsFiles(BACKEND_SRC);
    let sliceTotal = 0;
    let splitTotal = 0;
    const sliceByFile = new Map<string, number>();
    const splitByFile = new Map<string, number>();
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(BACKEND_SRC, file);
      const sliceCount = countLiteral(src, 'toISOString().slice(0, 10)');
      const splitCount = countLiteral(src, "split('T')[0]");
      if (sliceCount > 0) sliceByFile.set(rel, sliceCount);
      if (splitCount > 0) splitByFile.set(rel, splitCount);
      sliceTotal += sliceCount;
      splitTotal += splitCount;
    }
    assert.equal(sliceTotal, 43, 'the UTC-slice ratchet must stay 43 (no new site, none removed)');
    assert.equal(splitTotal, 6, 'the split ratchet must fall 10 -> 6');
    assert.deepEqual(
      Object.fromEntries([...sliceByFile.entries()].sort()),
      Object.fromEntries(Object.entries(KEPT_SLICE_COUNTS).sort()),
      'the slice sites must live exactly in the kept files',
    );
    assert.deepEqual(
      Object.fromEntries([...splitByFile.entries()].sort()),
      Object.fromEntries(Object.entries(KEPT_SPLIT_COUNTS).sort()),
      'the split sites must live exactly in the kept files',
    );
    // The two multi-line twins are reviewed-and-kept UTC calendar
    // math; the single-line method above excludes them by design.
    const loanAlloc = fs.readFileSync(
      path.join(BACKEND_SRC, 'modules', 'hr', 'payroll-loan-allocation.engine.ts'),
      'utf8',
    );
    assert.ok(
      /\.toISOString\(\)\s*\n\s*\.slice\(0, 10\)/.test(loanAlloc),
      'the payroll-loan multi-line twin must stay as reviewed',
    );
    const payrollRuns = fs.readFileSync(
      path.join(BACKEND_SRC, 'modules', 'hr', 'services', 'hr-payroll-runs.service.ts'),
      'utf8',
    );
    assert.ok(
      /\.toISOString\(\)\s*\n\s*\.slice\(0, 10\)/.test(payrollRuns),
      'the payroll-runs multi-line twin must stay as reviewed',
    );
    const engineMap = fs.readFileSync(ENGINE_MAP, 'utf8');
    assert.ok(
      engineMap.includes('INV-BUSINESS-DATE-R3-CONTINUATION'),
      'the engine-map business-date row must cite the new INV',
    );
    assert.ok(engineMap.includes('43 slice sites'), 'the engine-map row must state the current slice count');
    assert.ok(engineMap.includes('6 split sites'), 'the engine-map row must state the current split count');
    assert.ok(
      !engineMap.includes('R3a–R3c slices are in progress'),
      'the engine-map row must no longer say the R3 slices are in progress',
    );
    console.log('  ✓ §4 ratchet 43 / 6 + engine-map row');
  }

  // §5: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-TEST-FILE-WIRING-S9/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §6: Wiring: both critical lists carry 411 specs in identical
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
    assert.equal(specs.length, 425);
    assert.equal(chain.length, 425);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 411 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts');
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 425);') && src.includes('assert.equal(chain.length, 425);'),
        `${label} spec wiring must re-pin to 411`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s9-test-file-wiring.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §7: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-4 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s4-legacy-doc-' + 'numbers.spec.ts';
    const prevInv = 'INV-LEGACY-DOC-NUMBER-UNIQUE-' + 'BACKSTOP';
    const staleSpecs = 'specs.length, 41' + '0';
    const staleChain = 'chain.length, 41' + '0';
    const staleList = 'list.length, 41' + '0';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (410)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-4 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 4)');
  }

  // §8: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1/S2/S3/S4 specs' guard assertions to the new INV;
  // their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
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
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-TEST-FILE-WIRING-S9/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §9: The module-boundary pins do not move in this package
  // (every new import is from common/, which the boundary
  // scanner does not count, and the VAT engine import merges
  // into an existing line — no new edge and no total move).
  // No migration is added, so the "highest migration" pins
  // still point at 0344 (the two 3dp specs, the S2 spec §5/§10
  // and the S3 spec §9).
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
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
        src.includes(`const HIGHEST_MIGRATION_FILE = '${MIGRATION_FILE}';`),
        `${label} spec highest-migration pin must re-point to 0345`,
      );
      assert.ok(
        src.includes('the 0345 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must re-point to 0345`,
      );
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes(`const MIGRATION_FILE = '${MIGRATION_FILE}';`),
      'S2 spec migration-file pin must re-point to 0345',
    );
    assert.ok(
      s2Src.includes('the 0345 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must re-point to 0345',
    );
    const s3Src = fs.readFileSync(S3_SPEC, 'utf8');
    assert.ok(
      s3Src.includes(`const MIGRATION_FILE = '${MIGRATION_FILE}';`),
      'S3 spec migration-file pin must re-point to 0345',
    );
    assert.ok(s3Src.includes('must re-point to 0345'), 'S3 spec highest-migration assertions must re-point to 0345');
  }

  console.log('phase1 final slice 5 checks passed (business-date R3 continuation, 411 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
