import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'path';

/*
 * Phase 1 final-inspection slice 10 — module-documentation program,
 * batch 1: scoped verification for 10 modules on the current HEAD.
 *
 * GROUNDING (recounted on 61832f1, live code + register):
 * docs/reviews/module-review-status.json holds 37 modules (36
 * unverified_current_head + hr release_blocked, baseline 05433c03).
 * The evidence base is ONE full run of the 425-spec critical chain
 * on 61832f1 via run-critical.mjs (2 workers, per-spec logs in
 * backend/test-runner-logs/s10-module-evidence/, run record
 * phase1-final-s10-fullchain.out in the audit workspace): 424 pass
 * / 1 fail / 0 missing. Run 1 was SIGTERM-killed at 168/425 and
 * resumed in three --list chunks (chunk 1: 119/119 pass; chunk 2:
 * 119/119 done with one worker SIGKILLed by Linux OOM at 135s,
 * retried solo with --workers 1 to PASS; chunk 3: 118/118 pass).
 * The sole real failure is import-fx-trips-posting (import-sales
 * primary): its local PGlite schema predates migration 0345, so
 * the idempotency_key column production now sends does not exist
 * there — PGlite harness schema drift, own follow-up slice;
 * import-sales stays unverified.
 *
 * BATCH 1 (decided from the run, filename-primary ownership v3):
 * the 10 modules whose EVERY primary-owner linked spec passes,
 * ranked by evidence count: delivery-reps (52), accounting (46),
 * sales (37), purchases (27), storefront (21), returns (16),
 * reports (13), cash-drawer (12), manager-actions (8),
 * inventory (8). Tiebreak at 8 specs by filename-directness:
 * manager-actions 8/8 filename-primary, inventory 7/8,
 * maritime-freight 6/8 (d-m1/d-m3 via import fallback) — so
 * maritime-freight is 11th, first in line for slice 11. The 15
 * other qualifying modules are recorded for slice 11 in the log;
 * 10 modules have zero primary specs and stay unverified.
 * Scope per flipped module = exactly its passing specs'
 * scenarios (backend critical specs, PGlite, no operation mode
 * pinned — APP_MODE is unset unless the spec itself sets it).
 * Non-run areas are stated explicitly in test_evidence:
 * PostgreSQL integration, UI, UAT, legal/statutory, full routes,
 * environment-specific integration. This is verified_scoped, not
 * a full module review (README U1-U4 note) and not release_ready.
 * P0-A blockers are kept in batch 1 (accounting, reports,
 * settings); scope excludes the blocked areas.
 *
 * HR (user decision 2026-11-28, corrected the same day): Egypt's
 * rules are the focus now. Existing SA/KW rules stay as they are
 * (not removed, not deferred); QA/OM rules deferred (new work
 * only) until a foreign client exists, then that country's rules
 * are fixed. hr stays release_blocked until Egypt's rules are
 * confirmed correct in the code. hr keeps 3 blockers: Egypt
 * rules pending + KWD 3-decimal/WPS unverified (existing KW
 * rules) + integration/UAT not run. State release_blocked,
 * no verified commit.
 *
 * WHAT THIS PINS (all static — the specs prove their own live
 * cases when the chain runs them):
 * - §1: register shape — 37 modules, 26 verified_scoped (named),
 *   10 unverified (named), 1 release_blocked (hr), baseline
 *   unchanged. (Slice 11: batch 1 (10) + batch 2 (16).)
 * - §2: per flipped module — state, verified commit, verified
 *   date, exact scope list (mode entry + spec files), exact
 *   test_evidence, blocker count.
 * - §3: hr still release_blocked with 3 blockers (Egypt rules
 *   pending, KWD unverified, integration/UAT not run), nulls,
 *   sources unchanged.
 * - §4: the INV entry exists exactly once in both places.
 * - §5: wiring 426 in both lists, this spec last, and the
 *   earlier chain specs re-pinned.
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
 * RED-1: run this spec BEFORE the register is updated (and
 * before the INV exists) — §1 fails on the states, §2 fails
 * on the flipped modules, §3 fails on the hr blockers, §4
 * fails on the missing INV, §5 fails on the wiring count.
 *
 * Wiring: both critical lists carry 426 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const CRITICAL_DIR = path.join(BACKEND, 'test', 'critical');
const REGISTER = path.join(REPO_ROOT, 'docs', 'reviews', 'module-review-status.json');
const BOUNDARY_SPEC = path.join(CRITICAL_DIR, 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(CRITICAL_DIR, 'architecture-guard.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(CRITICAL_DIR, 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');
const DEPOSIT_3DP_SPEC = path.join(CRITICAL_DIR, 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(CRITICAL_DIR, 'van-transfer-loaded-amount-3dp.spec.ts');
const S2_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s2-maritime-settlement-idempotency.spec.ts');
const S3_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s3-money-precision-hr-import.spec.ts');
const S4_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s4-legacy-doc-numbers.spec.ts');
const S5_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s5-business-date-r3.spec.ts');
const S6_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s6-import-fx-payout-idempotency.spec.ts');
const S7_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s7-marketplace-webhook-map-row.spec.ts');
const S8_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s8-settings-import-posting-port.spec.ts');
const S9_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s9-test-file-wiring.spec.ts');

const NEW_INV = 'INV-MODULE-DOCUMENTATION-S10';
const SHA = '61832f1147e78a068fb5d605b0241e0346598689';
const VERIFIED_AT = '2026-11-28';
const MODE_ENTRY =
  'Backend critical specs (PGlite, run-critical.mjs, no operation mode pinned) on commit 61832f1, run 2026-11-28';
const BASELINE = '05433c03cc352160bf216f1b3d27375b20ca280f';

interface RegisterModule {
  module: string;
  owner: string;
  state: string;
  last_verified_commit: string | null;
  verified_at: string | null;
  verified_scope: string[];
  test_evidence: string[];
  blockers: string[];
  blocker_sources: string[];
}

interface Register {
  schema_version: number;
  baseline_code_commit: string;
  modules: RegisterModule[];
}

// Earlier chain specs (wiring loop §5): the phase-1 series plus the
// eval/repair/discount/cleanup specs and S9 — every spec whose
// wiring assertions the re-pin sweep moves to the new count.
const EARLIER_WIRING: ReadonlyArray<readonly [string, string]> = [
  ['B1', path.join(CRITICAL_DIR, 'phase1-b1-reports-sales.spec.ts')],
  ['B2', path.join(CRITICAL_DIR, 'phase1-b2-sales-settings.spec.ts')],
  ['B3', path.join(CRITICAL_DIR, 'phase1-b3-sales-storefront.spec.ts')],
  ['B4', path.join(CRITICAL_DIR, 'phase1-b4-accounting-hr.spec.ts')],
  ['B5', path.join(CRITICAL_DIR, 'phase1-b5-accounting-manufacturing.spec.ts')],
  ['B6', path.join(CRITICAL_DIR, 'phase1-b6-accounting-purchases.spec.ts')],
  ['B7', path.join(CRITICAL_DIR, 'phase1-b7-returns-sales.spec.ts')],
  ['B8', path.join(CRITICAL_DIR, 'phase1-b8-delivery-reps-sales.spec.ts')],
  ['F2', path.join(CRITICAL_DIR, 'phase1-f2-feature-public-indices.spec.ts')],
  ['F3', path.join(CRITICAL_DIR, 'phase1-f3-feature-boundary-legs.spec.ts')],
  ['F4', path.join(CRITICAL_DIR, 'phase1-f4-settings-access-door.spec.ts')],
  ['F5a', path.join(CRITICAL_DIR, 'phase1-f5a-audit-settings.spec.ts')],
  ['F5b', path.join(CRITICAL_DIR, 'phase1-f5b-products-settings.spec.ts')],
  ['F5c', path.join(CRITICAL_DIR, 'phase1-f5c-accounts-purchases.spec.ts')],
  ['F5d', path.join(CRITICAL_DIR, 'phase1-f5d-maintenance-products.spec.ts')],
  ['F5e', path.join(CRITICAL_DIR, 'phase1-f5e-accounting-treasury.spec.ts')],
  ['F5f', path.join(CRITICAL_DIR, 'phase1-f5f-cash-drawer-pos.spec.ts')],
  ['F5g', path.join(CRITICAL_DIR, 'phase1-f5g-customers-sales.spec.ts')],
  ['F5h', path.join(CRITICAL_DIR, 'phase1-f5h-pos-sales.spec.ts')],
  ['F5i', path.join(CRITICAL_DIR, 'phase1-f5i-pos-settings.spec.ts')],
  ['F5h-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5h-repair-sales-envelope-check.spec.ts')],
  ['F5j', path.join(CRITICAL_DIR, 'phase1-f5j-inventory-products.spec.ts')],
  ['F5h-REPAIR-2', path.join(CRITICAL_DIR, 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts')],
  ['F5k', path.join(CRITICAL_DIR, 'phase1-f5k-pos-products.spec.ts')],
  ['F5j-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5j-repair-expiry-spec-import.spec.ts')],
  ['F5l', path.join(CRITICAL_DIR, 'phase1-f5l-pos-storefront.spec.ts')],
  ['F5l-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5l-repair-bundle-budget.spec.ts')],
  ['D-M1', path.join(CRITICAL_DIR, 'phase1-d-m1-job-fields.spec.ts')],
  ['D-M3', path.join(CRITICAL_DIR, 'phase1-d-m3-mail-nested.spec.ts')],
  ['D-D10a', path.join(CRITICAL_DIR, 'phase1-d-d10a-serials-payload.spec.ts')],
  ['discount-fix', path.join(CRITICAL_DIR, 'phase1-discount-fix-line-amount.spec.ts')],
  ['cleanup', path.join(CRITICAL_DIR, 'phase1-cleanup-as-any-reduction.spec.ts')],
  ['P1', path.join(CRITICAL_DIR, 'phase1-eval-p1-frontend-lint.spec.ts')],
  ['P2', path.join(CRITICAL_DIR, 'phase1-eval-p2-dev-passcode.spec.ts')],
  ['P3', path.join(CRITICAL_DIR, 'phase1-eval-p3-van-writer.spec.ts')],
  ['repair', path.join(CRITICAL_DIR, 'phase1-eval-repair-type-imports.spec.ts')],
  ['S1', path.join(CRITICAL_DIR, 'phase1-final-s1-fx-maritime-close-asof.spec.ts')],
  ['S2', path.join(CRITICAL_DIR, 'phase1-final-s2-maritime-settlement-idempotency.spec.ts')],
  ['S3', path.join(CRITICAL_DIR, 'phase1-final-s3-money-precision-hr-import.spec.ts')],
  ['S4', path.join(CRITICAL_DIR, 'phase1-final-s4-legacy-doc-numbers.spec.ts')],
  ['S5', path.join(CRITICAL_DIR, 'phase1-final-s5-business-date-r3.spec.ts')],
  ['S6', path.join(CRITICAL_DIR, 'phase1-final-s6-import-fx-payout-idempotency.spec.ts')],
  ['S7', path.join(CRITICAL_DIR, 'phase1-final-s7-marketplace-webhook-map-row.spec.ts')],
  ['S8', path.join(CRITICAL_DIR, 'phase1-final-s8-settings-import-posting-port.spec.ts')],
  ['S9', path.join(CRITICAL_DIR, 'phase1-final-s9-test-file-wiring.spec.ts')],
];

// Earlier specs carrying a guard assertion (guard list §7): every
// file whose guard.match line the re-pin sweep moves to the new INV
// (measured by grep before the sweep: 43 files).
const EARLIER_GUARD: ReadonlyArray<readonly [string, string]> = [
  ['B3', path.join(CRITICAL_DIR, 'phase1-b3-sales-storefront.spec.ts')],
  ['B4', path.join(CRITICAL_DIR, 'phase1-b4-accounting-hr.spec.ts')],
  ['B5', path.join(CRITICAL_DIR, 'phase1-b5-accounting-manufacturing.spec.ts')],
  ['B6', path.join(CRITICAL_DIR, 'phase1-b6-accounting-purchases.spec.ts')],
  ['B7', path.join(CRITICAL_DIR, 'phase1-b7-returns-sales.spec.ts')],
  ['B8', path.join(CRITICAL_DIR, 'phase1-b8-delivery-reps-sales.spec.ts')],
  ['cleanup', path.join(CRITICAL_DIR, 'phase1-cleanup-as-any-reduction.spec.ts')],
  ['D-D10a', path.join(CRITICAL_DIR, 'phase1-d-d10a-serials-payload.spec.ts')],
  ['D-M1', path.join(CRITICAL_DIR, 'phase1-d-m1-job-fields.spec.ts')],
  ['D-M3', path.join(CRITICAL_DIR, 'phase1-d-m3-mail-nested.spec.ts')],
  ['discount-fix', path.join(CRITICAL_DIR, 'phase1-discount-fix-line-amount.spec.ts')],
  ['P1', path.join(CRITICAL_DIR, 'phase1-eval-p1-frontend-lint.spec.ts')],
  ['P2', path.join(CRITICAL_DIR, 'phase1-eval-p2-dev-passcode.spec.ts')],
  ['P3', path.join(CRITICAL_DIR, 'phase1-eval-p3-van-writer.spec.ts')],
  ['repair', path.join(CRITICAL_DIR, 'phase1-eval-repair-type-imports.spec.ts')],
  ['F2', path.join(CRITICAL_DIR, 'phase1-f2-feature-public-indices.spec.ts')],
  ['F3', path.join(CRITICAL_DIR, 'phase1-f3-feature-boundary-legs.spec.ts')],
  ['F4', path.join(CRITICAL_DIR, 'phase1-f4-settings-access-door.spec.ts')],
  ['F5a', path.join(CRITICAL_DIR, 'phase1-f5a-audit-settings.spec.ts')],
  ['F5b', path.join(CRITICAL_DIR, 'phase1-f5b-products-settings.spec.ts')],
  ['F5c', path.join(CRITICAL_DIR, 'phase1-f5c-accounts-purchases.spec.ts')],
  ['F5d', path.join(CRITICAL_DIR, 'phase1-f5d-maintenance-products.spec.ts')],
  ['F5e', path.join(CRITICAL_DIR, 'phase1-f5e-accounting-treasury.spec.ts')],
  ['F5f', path.join(CRITICAL_DIR, 'phase1-f5f-cash-drawer-pos.spec.ts')],
  ['F5g', path.join(CRITICAL_DIR, 'phase1-f5g-customers-sales.spec.ts')],
  ['F5h', path.join(CRITICAL_DIR, 'phase1-f5h-pos-sales.spec.ts')],
  ['F5h-REPAIR-2', path.join(CRITICAL_DIR, 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts')],
  ['F5h-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5h-repair-sales-envelope-check.spec.ts')],
  ['F5i', path.join(CRITICAL_DIR, 'phase1-f5i-pos-settings.spec.ts')],
  ['F5j', path.join(CRITICAL_DIR, 'phase1-f5j-inventory-products.spec.ts')],
  ['F5j-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5j-repair-expiry-spec-import.spec.ts')],
  ['F5k', path.join(CRITICAL_DIR, 'phase1-f5k-pos-products.spec.ts')],
  ['F5l', path.join(CRITICAL_DIR, 'phase1-f5l-pos-storefront.spec.ts')],
  ['F5l-REPAIR', path.join(CRITICAL_DIR, 'phase1-f5l-repair-bundle-budget.spec.ts')],
  ['S1', path.join(CRITICAL_DIR, 'phase1-final-s1-fx-maritime-close-asof.spec.ts')],
  ['S2', path.join(CRITICAL_DIR, 'phase1-final-s2-maritime-settlement-idempotency.spec.ts')],
  ['S3', path.join(CRITICAL_DIR, 'phase1-final-s3-money-precision-hr-import.spec.ts')],
  ['S4', path.join(CRITICAL_DIR, 'phase1-final-s4-legacy-doc-numbers.spec.ts')],
  ['S5', path.join(CRITICAL_DIR, 'phase1-final-s5-business-date-r3.spec.ts')],
  ['S6', path.join(CRITICAL_DIR, 'phase1-final-s6-import-fx-payout-idempotency.spec.ts')],
  ['S7', path.join(CRITICAL_DIR, 'phase1-final-s7-marketplace-webhook-map-row.spec.ts')],
  ['S8', path.join(CRITICAL_DIR, 'phase1-final-s8-settings-import-posting-port.spec.ts')],
  ['S9', path.join(CRITICAL_DIR, 'phase1-final-s9-test-file-wiring.spec.ts')],
];

// Batch-1 scope data (generated from the v3 primary-owner map and
// the updated register — exact literals, never interpolated).
const DELIVERY_REPS_SPECS: string[] = [
  'test/critical/clock-b5-driver-visits-batch-expiry.spec.ts',
  'test/critical/clock-p7-offer-van-day.spec.ts',
  'test/critical/customer-rep-balances-unassigned.spec.ts',
  'test/critical/delivery-cod-custody-gl.spec.ts',
  'test/critical/delivery-rep-custody-net-returns.spec.ts',
  'test/critical/delivery-rep-prepaid-shift-treasury-m6.spec.ts',
  'test/critical/delivery-rep-settle-all-confirmation-counted-cash.spec.ts',
  'test/critical/delivery-rep-single-settle-counted-cash.spec.ts',
  'test/critical/delivery-reps-retail-self-install.spec.ts',
  'test/critical/dispatch-state-guards-audit.spec.ts',
  'test/critical/driver-portal-pin-change.spec.ts',
  'test/critical/driver-portal-remaining-amount.spec.ts',
  'test/critical/driver-requisition-dto-whitelist.spec.ts',
  'test/critical/driver-token-invalidation-m14.spec.ts',
  'test/critical/phase1-b8-delivery-reps-sales.spec.ts',
  'test/critical/pos-van-stock-pool.spec.ts',
  'test/critical/rep-custody-ledger-m12.spec.ts',
  'test/critical/rep-driver-writes-ownership-m16.spec.ts',
  'test/critical/rep-field-collection-money-precision-m10.spec.ts',
  'test/critical/rep-target-engine.spec.ts',
  'test/critical/trip-reconciliation-digits.spec.ts',
  'test/critical/van-admin-permission-split.spec.ts',
  'test/critical/van-customer-schedule-itinerary.spec.ts',
  'test/critical/van-egypt-market-fmcg.spec.ts',
  'test/critical/van-eligible-sales-payment-type.spec.ts',
  'test/critical/van-field-noncash-evidence.spec.ts',
  'test/critical/van-field-return-carton-qty.spec.ts',
  'test/critical/van-field-return-cogs-residual-mirror.spec.ts',
  'test/critical/van-field-sale-tax-optional.spec.ts',
  'test/critical/van-field-sale-wholesale-price.spec.ts',
  'test/critical/van-fmcg-master-commercial-flow.spec.ts',
  'test/critical/van-fmcg-promotions-and-route-opt.spec.ts',
  'test/critical/van-fmcg-visit-execution.spec.ts',
  'test/critical/van-general-feature-overrides.spec.ts',
  'test/critical/van-generic-fefo-batches.spec.ts',
  'test/critical/van-load-available-qty.spec.ts',
  'test/critical/van-portal-sale-rep-attribution-f20.spec.ts',
  'test/critical/van-pos-discount-cap.spec.ts',
  'test/critical/van-pre-sales-customer-attribution.spec.ts',
  'test/critical/van-presales-consolidate-delivery-rep-alias.spec.ts',
  'test/critical/van-presales-order-details-line-total.spec.ts',
  'test/critical/van-profit-rep-reporting.spec.ts',
  'test/critical/van-route-sale-gate.spec.ts',
  'test/critical/van-sales-adversarial-sabotage.spec.ts',
  'test/critical/van-sales-claude-audit.spec.ts',
  'test/critical/van-sales-concurrency-dedup.spec.ts',
  'test/critical/van-sales-deep-adversarial-all-modes.spec.ts',
  'test/critical/van-sales-list-date-filter.spec.ts',
  'test/critical/van-transfer-loaded-amount-3dp.spec.ts',
  'test/critical/van-trip-reconciliation-engine.spec.ts',
  'test/critical/van-trip-started-audit.spec.ts',
  'test/critical/van-visits-tracking-collections.spec.ts',
];
const DELIVERY_REPS_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 52 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const ACCOUNTING_SPECS: string[] = [
  'test/critical/accounting-access.spec.ts',
  'test/critical/accounting-commercial-posting.spec.ts',
  'test/critical/accounting-digits-core.spec.ts',
  'test/critical/accounting-digits-services.spec.ts',
  'test/critical/accounting-foundation.spec.ts',
  'test/critical/accounting-ledger-hardening.spec.ts',
  'test/critical/admin-close-declared-totals-waiver.spec.ts',
  'test/critical/arch02-accounting-engines.spec.ts',
  'test/critical/bank-fee-atomicity.spec.ts',
  'test/critical/bank-statement-integrity.spec.ts',
  'test/critical/blind-close-declared-reconciliation.spec.ts',
  'test/critical/business-date-accounting.spec.ts',
  'test/critical/clock-b4-low-date-bounds.spec.ts',
  'test/critical/clock-b4-money-day-fixes.spec.ts',
  'test/critical/clock-b5-low-current-date.spec.ts',
  'test/critical/clock-b5-offer-date-bounds.spec.ts',
  'test/critical/clock-b6-today-buckets.spec.ts',
  'test/critical/clock-p4-utc-day-keys.spec.ts',
  'test/critical/clock-p5-engines-tenant-tz.spec.ts',
  'test/critical/clock-p6-client-date-bounds.spec.ts',
  'test/critical/clock-p8-frontend-server-time.spec.ts',
  'test/critical/clock-p9-stamp-unification.spec.ts',
  'test/critical/close-declared-totals-required.spec.ts',
  'test/critical/cogs-remainder-absorption.spec.ts',
  'test/critical/convert-currency-target-digits.spec.ts',
  'test/critical/cost-center-allocation-safety.spec.ts',
  'test/critical/d6c-misc-book-digits.spec.ts',
  'test/critical/document-numbers-tenant-day.spec.ts',
  'test/critical/expected-cash-single-window.spec.ts',
  'test/critical/fiscal-close-book-digits.spec.ts',
  'test/critical/fiscal-close-integrity.spec.ts',
  'test/critical/fiscal-periods.spec.ts',
  'test/critical/forex-rate-validation.spec.ts',
  'test/critical/import-landed-cost-canonical.spec.ts',
  'test/critical/landed-cost-allocation.spec.ts',
  'test/critical/large-cash-refund-approval.spec.ts',
  'test/critical/manual-journal-book-digits.spec.ts',
  'test/critical/money-minor-units.spec.ts',
  'test/critical/opening-balance-book-digits.spec.ts',
  'test/critical/opening-balances-ledger.spec.ts',
  'test/critical/payment-allocation-precision.spec.ts',
  'test/critical/payment-allocation-safety.spec.ts',
  'test/critical/phase1-b5-accounting-manufacturing.spec.ts',
  'test/critical/posting-book-precision.spec.ts',
  'test/critical/purchase-landed-cost-at-receipt.spec.ts',
  'test/critical/unbalanced-journal-throw.spec.ts',
];
const ACCOUNTING_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 46 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
  'P0-A blocker retained (see blockers); scope excludes the blocked areas (full routes, environment-specific integration)',
];
const SALES_SPECS: string[] = [
  'test/critical/admin-discount-authority.spec.ts',
  'test/critical/closed-shift-row-sales.spec.ts',
  'test/critical/comprehensive-offers-audit.spec.ts',
  'test/critical/exchange-approval-quantities.spec.ts',
  'test/critical/held-sales-safety.spec.ts',
  'test/critical/offline-sale-backdate-bound.spec.ts',
  'test/critical/online-order-pos-terms.spec.ts',
  'test/critical/operational-flows.spec.ts',
  'test/critical/partial-cod-settlement-m13.spec.ts',
  'test/critical/phase1-b2-sales-settings.spec.ts',
  'test/critical/phase1-b3-sales-storefront.spec.ts',
  'test/critical/phase1-f5g-customers-sales.spec.ts',
  'test/critical/phase1-f5h-pos-sales.spec.ts',
  'test/critical/phase1-f5h-repair-sales-envelope-check.spec.ts',
  'test/critical/phase1-f5i-pos-settings.spec.ts',
  'test/critical/phase1-f5k-pos-products.spec.ts',
  'test/critical/phase1-f5l-pos-storefront.spec.ts',
  'test/critical/pos-cash-discount.spec.ts',
  'test/critical/pos-collection-balance-cap.spec.ts',
  'test/critical/pos-collection-trip-attribution.spec.ts',
  'test/critical/pos-offer-digits.spec.ts',
  'test/critical/pos-plan-sync-module-durability.spec.ts',
  'test/critical/pos-product-lookup.spec.ts',
  'test/critical/pos-retail-feature-gate.spec.ts',
  'test/critical/pos-sale-trip-attribution.spec.ts',
  'test/critical/pos-weighted-barcode-toggle-persists.spec.ts',
  'test/critical/rest-cod-collection-truth.spec.ts',
  'test/critical/restaurant-86-enforcement.spec.ts',
  'test/critical/restaurant-fnb-claims-post.spec.ts',
  'test/critical/restaurant-fnb-workflow.spec.ts',
  'test/critical/restaurant-manager-comp-gate.spec.ts',
  'test/critical/restaurant-paid-gates.spec.ts',
  'test/critical/sale-edit-payload-contract.spec.ts',
  'test/critical/sale-money-truth.spec.ts',
  'test/critical/sales-writer-cancel-edit.spec.ts',
  'test/critical/sales-writer-create.spec.ts',
  'test/critical/sales-writer-food-waste.spec.ts',
];
const SALES_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 37 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const PURCHASES_SPECS: string[] = [
  'test/critical/canonical-rounding.spec.ts',
  'test/critical/grn-freight-allocation.spec.ts',
  'test/critical/grn-journal-central-posting.spec.ts',
  'test/critical/grn-pending-review.spec.ts',
  'test/critical/grn-quarantine.spec.ts',
  'test/critical/grni-settlement-precision.spec.ts',
  'test/critical/noncash-receipt-evidence-gate.spec.ts',
  'test/critical/pharmacy-distributor-purchase.spec.ts',
  'test/critical/phase1-a10-purchases-writer.spec.ts',
  'test/critical/phase1-b6-accounting-purchases.spec.ts',
  'test/critical/phase1-f5c-accounts-purchases.spec.ts',
  'test/critical/po-received-quantity-advance.spec.ts',
  'test/critical/purchase-cancel-wac-recompute.spec.ts',
  'test/critical/purchase-manager-approval.spec.ts',
  'test/critical/purchase-order-totals-digits.spec.ts',
  'test/critical/purchase-order-totals.spec.ts',
  'test/critical/purchase-repricing-precision.spec.ts',
  'test/critical/purchase-stock-integrity.spec.ts',
  'test/critical/purchases-writer.spec.ts',
  'test/critical/stuck-receipt-idempotency.spec.ts',
  'test/critical/supplier-advance-overdraft.spec.ts',
  'test/critical/supplier-advance-ui-wiring.spec.ts',
  'test/critical/supplier-bill.spec.ts',
  'test/critical/supplier-payment-details.spec.ts',
  'test/critical/supplier-payment-schedule-precision.spec.ts',
  'test/critical/supplier-schedule-coverage.spec.ts',
  'test/critical/three-way-match-bill-rate.spec.ts',
];
const PURCHASES_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 27 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const STOREFRONT_SPECS: string[] = [
  'test/critical/marketplace-outbox-relay.spec.ts',
  'test/critical/marketplace-settlement-book-digits.spec.ts',
  'test/critical/marketplace-simulation-stock-atomic.spec.ts',
  'test/critical/marketplace-sync-sim-row.spec.ts',
  'test/critical/marketplace-webhook-persistence.spec.ts',
  'test/critical/sandbox-checkout-render.spec.ts',
  'test/critical/store-public-url.spec.ts',
  'test/critical/storefront-catalog-book-digits.spec.ts',
  'test/critical/storefront-gateway-amounts.spec.ts',
  'test/critical/storefront-media.spec.ts',
  'test/critical/storefront-order-access.spec.ts',
  'test/critical/storefront-order-entitlement.spec.ts',
  'test/critical/storefront-order-pricing.spec.ts',
  'test/critical/storefront-order-row-rounding.spec.ts',
  'test/critical/storefront-payment-webhooks.spec.ts',
  'test/critical/storefront-paymob-capture.spec.ts',
  'test/critical/storefront-pricing-digits.spec.ts',
  'test/critical/storefront-public-hardening.spec.ts',
  'test/critical/storefront-simulate-order-gate.spec.ts',
  'test/critical/storefront-stock-reaper.spec.ts',
  'test/critical/webhook-order-resolution.spec.ts',
];
const STOREFRONT_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 21 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const RETURNS_SPECS: string[] = [
  'test/critical/cash-return-approval-threshold.spec.ts',
  'test/critical/fashion-rows-ledger-return.spec.ts',
  'test/critical/phase1-b7-returns-sales.spec.ts',
  'test/critical/purchase-return-traceability.spec.ts',
  'test/critical/purchase-return-wac-recompute.spec.ts',
  'test/critical/return-document-details.spec.ts',
  'test/critical/return-payload.spec.ts',
  'test/critical/returns-conditional-discount-forfeit.spec.ts',
  'test/critical/returns-exchange-precision.spec.ts',
  'test/critical/returns-invoice-full-history-search.spec.ts',
  'test/critical/returns-payout-truth.spec.ts',
  'test/critical/returns-relief-preview-truth.spec.ts',
  'test/critical/returns-services-users-sql-pagination.spec.ts',
  'test/critical/returns-shift-gate.spec.ts',
  'test/critical/sale-return-cash-only.spec.ts',
  'test/critical/sales-return-cogs-residual-mirror.spec.ts',
];
const RETURNS_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 16 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
  'returns-conditional-discount-forfeit.spec.ts failed in the chunk-2 run only because Linux OOM-killed its worker (exit SIGKILL, 135s); retried solo with --workers 1 on 2026-11-28 -> PASS; the retry supersedes the SIGKILL',
];
const REPORTS_SPECS: string[] = [
  'test/critical/phase1-b1-reports-sales.spec.ts',
  'test/critical/reports-audit-logs-pagination.spec.ts',
  'test/critical/reports-business-timezone.spec.ts',
  'test/critical/reports-customer-balances.spec.ts',
  'test/critical/reports-dashboard-trends.spec.ts',
  'test/critical/reports-discount-profit.spec.ts',
  'test/critical/reports-financial-summary.spec.ts',
  'test/critical/reports-home-open-shift.spec.ts',
  'test/critical/reports-overview-figures.spec.ts',
  'test/critical/reports-query-book-digits.spec.ts',
  'test/critical/reports-supplier-balances.spec.ts',
  'test/critical/reports-tenant-day.spec.ts',
  'test/critical/reports-treasury-pagination.spec.ts',
];
const REPORTS_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 13 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
  'P0-A blocker retained (see blockers); scope excludes the blocked areas (full routes, environment-specific integration)',
];
const CASH_DRAWER_SPECS: string[] = [
  'test/critical/cash-drawer-counterpart-accounts.spec.ts',
  'test/critical/cash-drawer-expected-cash-precision.spec.ts',
  'test/critical/cash-drawer-movement-idempotency.spec.ts',
  'test/critical/cash-drawer-movement-types.spec.ts',
  'test/critical/cash-drawer-shift-close-control.spec.ts',
  'test/critical/cash-drawer-variance.spec.ts',
  'test/critical/closed-shift-post-close-refresh.spec.ts',
  'test/critical/drawer-disbursement-gate-boundary.spec.ts',
  'test/critical/drawer-money-in-no-password.spec.ts',
  'test/critical/phase1-f5f-cash-drawer-pos.spec.ts',
  'test/critical/shift-close-password-identity.spec.ts',
  'test/critical/shift-expected-per-method-collections.spec.ts',
];
const CASH_DRAWER_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 12 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const MANAGER_ACTIONS_SPECS: string[] = [
  'test/critical/manager-pin-drawer.spec.ts',
  'test/critical/solo-admin-broker-expense-override.spec.ts',
  'test/critical/solo-admin-carrier-invoice-override.spec.ts',
  'test/critical/solo-admin-import-approval-override.spec.ts',
  'test/critical/solo-admin-po-self-approval-override.spec.ts',
  'test/critical/solo-admin-rep-waiver-override.spec.ts',
  'test/critical/solo-admin-shift-close-over-tolerance.spec.ts',
  'test/critical/solo-admin-transfer-shortage-override.spec.ts',
];
const MANAGER_ACTIONS_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 8 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const INVENTORY_SPECS: string[] = [
  'test/critical/divergence-9187-stock-scale.spec.ts',
  'test/critical/final-issue-paired-movement.spec.ts',
  'test/critical/inventory-count-transfer-sql-pagination.spec.ts',
  'test/critical/inventory-issue-modes.spec.ts',
  'test/critical/inventory-transfers-writer.spec.ts',
  'test/critical/money-stock-count-precision.spec.ts',
  'test/critical/phase1-a9-inventory-writer.spec.ts',
  'test/critical/phase1-f5j-inventory-products.spec.ts',
];
const INVENTORY_EVIDENCE: string[] = [
  'Full critical chain (run-critical.mjs --workers 2) on 61832f1, 2026-11-28: all 8 primary-owner specs passed; 424/425 pass overall, sole failure test/critical/import-fx-trips-posting.spec.ts (import-sales, not this module); per-spec logs backend/test-runner-logs/s10-module-evidence/ (gitignored), run record phase1-final-s10-fullchain.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const BATCH: ReadonlyArray<{ module: string; specs: string[]; evidence: string[]; blockers: number }> = [
  { module: 'delivery-reps', specs: DELIVERY_REPS_SPECS, evidence: DELIVERY_REPS_EVIDENCE, blockers: 0 },
  { module: 'accounting', specs: ACCOUNTING_SPECS, evidence: ACCOUNTING_EVIDENCE, blockers: 1 },
  { module: 'sales', specs: SALES_SPECS, evidence: SALES_EVIDENCE, blockers: 0 },
  { module: 'purchases', specs: PURCHASES_SPECS, evidence: PURCHASES_EVIDENCE, blockers: 0 },
  { module: 'storefront', specs: STOREFRONT_SPECS, evidence: STOREFRONT_EVIDENCE, blockers: 0 },
  { module: 'returns', specs: RETURNS_SPECS, evidence: RETURNS_EVIDENCE, blockers: 0 },
  { module: 'reports', specs: REPORTS_SPECS, evidence: REPORTS_EVIDENCE, blockers: 1 },
  { module: 'cash-drawer', specs: CASH_DRAWER_SPECS, evidence: CASH_DRAWER_EVIDENCE, blockers: 0 },
  { module: 'manager-actions', specs: MANAGER_ACTIONS_SPECS, evidence: MANAGER_ACTIONS_EVIDENCE, blockers: 0 },
  { module: 'inventory', specs: INVENTORY_SPECS, evidence: INVENTORY_EVIDENCE, blockers: 0 },
];

async function main(): Promise<void> {
  const register = JSON.parse(fs.readFileSync(REGISTER, 'utf8')) as Register;

  // §1: Register shape — 37 modules, 26 verified_scoped (named),
  // 10 unverified (named), 1 release_blocked (hr), baseline unchanged.
  // (Slice 11 moved the counts: batch 1 (10) + batch 2 (16) = 26;
  // the 10 left unverified have zero primary specs.)
  {
    assert.equal(register.modules.length, 37, 'the register must hold exactly 37 modules');
    assert.equal(register.baseline_code_commit, BASELINE, 'the register baseline must stay unchanged');
    const verified = register.modules.filter((m) => m.state === 'verified_scoped').map((m) => m.module);
    const unverified = register.modules.filter((m) => m.state === 'unverified_current_head').map((m) => m.module);
    const blocked = register.modules.filter((m) => m.state === 'release_blocked').map((m) => m.module);
    assert.deepEqual(
      verified,
      [
        'accounting',
        'cash-drawer',
        'catalog',
        'delivery-reps',
        'import-sales',
        'inventory',
        'maintenance',
        'manager-actions',
        'manufacturing',
        'maritime-freight',
        'partners',
        'pharmacy',
        'pricing',
        'public',
        'purchases',
        'reports',
        'returns',
        'saas-admin',
        'sales',
        'services',
        'settings',
        'storefront',
        'tax-integration',
        'tenant-subscription',
        'treasury',
        'users',
      ],
      'exactly the 26 verified modules (batch 1 + batch 2) must be verified_scoped',
    );
    assert.deepEqual(
      unverified,
      [
        'activation',
        'addons',
        'ai-copilot',
        'approvals',
        'bosta',
        'contracting',
        'crm',
        'gcc-shipping',
        'sessions',
        'tradein',
      ],
      'the other 10 modules must stay unverified_current_head',
    );
    assert.deepEqual(blocked, ['hr'], 'hr alone must stay release_blocked');
  }

  // §2: Per flipped module — state, verified commit, verified date,
  // exact scope list (mode entry + spec files), exact test_evidence,
  // blocker count (P0-A blockers kept: accounting, reports, settings).
  {
    for (const entry of BATCH) {
      const mod = register.modules.find((m) => m.module === entry.module);
      assert.ok(mod, `register must list ${entry.module}`);
      assert.equal(mod.state, 'verified_scoped', `${entry.module} state must be verified_scoped`);
      assert.equal(mod.last_verified_commit, SHA, `${entry.module} verified commit must be the slice-10 HEAD`);
      assert.equal(mod.verified_at, VERIFIED_AT, `${entry.module} verified date must be 2026-11-28`);
      assert.deepEqual(
        mod.verified_scope,
        [MODE_ENTRY, ...entry.specs],
        `${entry.module} scope must list exactly its specs`,
      );
      assert.equal(
        mod.test_evidence.length,
        entry.evidence.length,
        `${entry.module} evidence must hold exactly its entries`,
      );
      for (let i = 0; i < entry.evidence.length; i++) {
        assert.equal(mod.test_evidence[i], entry.evidence[i], `${entry.module} evidence entry ${i} must match`);
      }
      assert.equal(mod.blockers.length, entry.blockers, `${entry.module} blocker count must match`);
      if (entry.blockers > 0) {
        assert.ok(mod.blockers[0].includes('P0-A code-only follow-up'), `${entry.module} must keep its P0-A blocker`);
      }
    }
  }

  // §3: hr still release_blocked with 3 blockers — Egypt rules
  // pending (the focus), KWD 3-decimal/WPS unverified (existing
  // KW rules, restored by the same-day correction), integration/
  // UAT not run. Existing SA/KW rules stay as they are; QA/OM
  // deferred (new work only). Nulls, sources unchanged.
  {
    const hr = register.modules.find((m) => m.module === 'hr');
    assert.ok(hr, 'register must list hr');
    assert.equal(hr.state, 'release_blocked', 'hr must stay release_blocked');
    assert.equal(hr.last_verified_commit, null, 'hr must carry no verified commit');
    assert.equal(hr.verified_at, null, 'hr must carry no verified date');
    assert.deepEqual(hr.verified_scope, [], 'hr scope must stay empty');
    assert.deepEqual(hr.test_evidence, [], 'hr evidence must stay empty');
    assert.equal(hr.blockers.length, 3, 'hr must carry exactly 3 blockers');
    assert.ok(hr.blockers[0].includes('Egypt (EG)'), 'hr first blocker must be Egypt-focused');
    assert.ok(
      hr.blockers[0].includes('stay as they are'),
      'hr first blocker must keep existing SA/KW rules as they are',
    );
    assert.ok(
      hr.blockers[0].includes('Qatar (QA) and Oman (OM)'),
      'hr first blocker must name the deferred countries (QA/OM)',
    );
    assert.ok(
      hr.blockers[0].includes('User decision 2026-11-28'),
      'hr first blocker must record the 2026-11-28 decision',
    );
    assert.equal(
      hr.blockers[1],
      'KWD 3-decimal end-to-end accuracy and bank/WPS acceptance unverified',
      'hr second blocker (KWD, existing KW rules) must stay verbatim',
    );
    assert.ok(!hr.blockers[1].includes('OMR'), 'hr KWD blocker must not carry the deferred OMR half');
    assert.equal(
      hr.blockers[2],
      'Full HR integration and user acceptance tests not run/accepted for current head',
      'hr third blocker (integration/UAT) must stay verbatim',
    );
    assert.deepEqual(
      hr.blocker_sources,
      ['REVIEW_ROADMAP.md', 'HR_PAYROLL_STATUTORY_RELEASE_MATRIX.md'],
      'hr blocker sources must stay unchanged',
    );
  }

  // §4: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S11/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §5: Wiring: both critical lists carry 426 specs in identical
  // order, this spec last, and the earlier chain specs re-pinned.
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
    assert.equal(specs.length, 427);
    assert.equal(chain.length, 427);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 426 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts');
    for (const [label, specPath] of EARLIER_WIRING) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 427);') && src.includes('assert.equal(chain.length, 427);'),
        `${label} spec wiring must re-pin to 426`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s11-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §6: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // previous spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s9-test-file-' + 'wiring.spec.ts';
    const prevInv = 'INV-TEST-FILE-WIRING-' + 'S9';
    const staleSpecs = 'specs.length, 42' + '5';
    const staleChain = 'chain.length, 42' + '5';
    const staleList = 'list.length, 42' + '5';
    for (const file of fs.readdirSync(CRITICAL_DIR)) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(CRITICAL_DIR, file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (425)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the previous spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 9)');
  }

  // §7: The guard tail holds ONLY the newest id, so this package
  // re-pins the earlier specs' guard assertions to the new INV;
  // their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
    for (const [label, specPath] of EARLIER_GUARD) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S11/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §8: The module-boundary pins do not move in this package
  // (no production code changes at all — only the register
  // statuses + wiring). No migration in this package, so the
  // "highest migration" pins stay at 0345.
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
    for (const [label, specPath] of [
      ['S2', S2_SPEC],
      ['S3', S3_SPEC],
      ['S5', S5_SPEC],
      ['S6', S6_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';`),
        `${label} spec migration-file pin must stay at 0345`,
      );
      assert.ok(src.includes('must re-point to 0345'), `${label} spec highest-migration assertions must stay at 0345`);
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
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
    const s9Src = fs.readFileSync(S9_SPEC, 'utf8');
    assert.ok(
      s9Src.includes('2040000000345_import_fx_payout_idempotency_keys.ts'),
      'S9 spec highest-migration pin must stay at 0345',
    );
  }

  console.log('phase1 final slice 10 checks passed (module documentation batch 1, 426 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
