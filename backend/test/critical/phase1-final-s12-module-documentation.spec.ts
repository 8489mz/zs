import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'path';

/*
 * Phase 1 final-inspection slice 12 — module-documentation program,
 * batch 1: baseline specs + scoped verification for 5 of the 10
 * modules with zero primary specs on the current HEAD.
 *
 * GROUNDING (live code + register on 95858d5):
 * docs/reviews/module-review-status.json holds 37 modules (26
 * verified_scoped from slices 10 + 11, 10 unverified_current_head,
 * hr release_blocked, baseline 05433c03). The 10 zero-primary-spec
 * modules were activation, addons, ai-copilot, approvals, bosta,
 * contracting, crm, gcc-shipping, sessions, tradein. The slice-10
 * v3 primary-owner rule was filename-based: password-reset.spec.ts
 * and session-ttl-sliding.spec.ts were forced to PLATFORM although
 * they directly drive sessions-module code, and
 * solo-admin-po-self-approval-override.spec.ts was forced to
 * PLATFORM although it drives ApprovalWorkflowService approve /
 * reject — the "zero primary specs" verdict for sessions and
 * approvals was a rule artifact, not reality. This slice
 * re-classifies those three specs as sessions / approvals primary
 * instead of duplicating them. dto-tax-approvals.spec.ts is NOT
 * primary (static/DTO checks only).
 *
 * BATCH 1 (decided in this slice, recorded in the log): sessions,
 * approvals, tradein, crm, addons — all five have clear DB-backed
 * core behaviour directly drivable on PGlite with the real service
 * (no external HTTP/API); each gets ONE new baseline spec (plus
 * wiring / re-classification of existing passing specs where they
 * exist). Deferred, recorded for later slices: bosta + gcc-shipping
 * (core calls carrier APIs — needs an HTTP-stubbing study; the
 * p0a-commerce-shipping-rbac spec passes and is the wiring
 * candidate for the follow-up); activation (machine fingerprint +
 * license, environment-specific; apps-store-plan-compatibility
 * passes — read it in the follow-up); ai-copilot (ask path needs
 * live AI keys; the 3 passing copilot specs — read them in the
 * follow-up to confirm what they prove); contracting (SET-ASIDE
 * scope: retail is the readiness scope — deferred, NOT cancelled;
 * its 5 unlinked specs all pass, so it is ready-to-wire in its own
 * documentation slice).
 *
 * S12 FINDING 1 (discovered in this slice; FIXED in slice 13,
 * commit 56bb6d4): MfaService.beginSetup threw on ANY Postgres
 * — column reference "tenant_id" is ambiguous (42702) at parse
 * time: its ON CONFLICT ... DO UPDATE ... WHERE used unqualified
 * tenant_id / confirmed_at, which exist in both the target table
 * and the EXCLUDED row. No other doUpdateSet in src/ chains a
 * .where() — the bug was isolated to MFA setup. The slice-13 fix
 * qualifies the columns (user_mfa.tenant_id /
 * user_mfa.confirmed_at); the slice-13 spec proves setup, second
 * setup on the conflict path, setup then confirm, and beginSetup
 * after confirm rejected. The sessions baseline spec seeds the
 * pending user_mfa row directly (production encryptMfaSecret) and
 * proves confirm / regenerate / disable only; beginSetup is
 * driven by the slice-13 spec, not there.
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
 * - §1: register shape — 37 modules, 36 verified_scoped (named),
 *   0 unverified (named), 1 release_blocked (hr), baseline
 *   unchanged. (Slice 14: 31 + batch 2 (5).)
 * - §2: per flipped module — state, verified commit, verified
 *   date, exact scope list (mode entry + spec files), exact
 *   test_evidence, blocker count.
 * - §3: hr still release_blocked with 3 blockers (Egypt rules
 *   pending, KWD unverified, integration/UAT not run), nulls,
 *   sources unchanged.
 * - §4: the INV entry exists exactly once in both places.
 * - §5: wiring 435 in both lists, this spec last, and the
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
 * Wiring: both critical lists carry 435 specs in identical
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
const S10_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s10-module-documentation.spec.ts');
const S11_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s11-module-documentation.spec.ts');

const NEW_INV = 'INV-MODULE-DOCUMENTATION-S12';
const SHA = '95858d5e74669c2265255c78ab34ef0418f5ca38';
const VERIFIED_AT = '2026-11-28';
const MODE_ENTRY =
  'Backend critical specs (PGlite, run-critical.mjs, no operation mode pinned) on commit 95858d5, run 2026-11-28';
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
  ['S10', path.join(CRITICAL_DIR, 'phase1-final-s10-module-documentation.spec.ts')],
  ['S11', path.join(CRITICAL_DIR, 'phase1-final-s11-module-documentation.spec.ts')],
];

// Earlier specs carrying a guard assertion (guard list §7): every
// file whose guard.match line the re-pin sweep moves to the new INV
// (measured by grep before the sweep: 45 files — the slice-11
// comment said 43 but its list already held 44).
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
  ['S10', path.join(CRITICAL_DIR, 'phase1-final-s10-module-documentation.spec.ts')],
  ['S11', path.join(CRITICAL_DIR, 'phase1-final-s11-module-documentation.spec.ts')],
];

// Batch-1 scope data (decided in this slice from the live code +
// the register — exact literals, never interpolated).
const SESSIONS_SPECS: string[] = [
  'test/critical/password-reset.spec.ts',
  'test/critical/phase1-final-s12-sessions-baseline.spec.ts',
  'test/critical/session-ttl-sliding.spec.ts',
];
const SESSIONS_EVIDENCE: string[] = [
  'Targeted critical-spec run (run-critical.mjs --list --workers 1) on 95858d5, 2026-11-28: all 3 primary-owner specs passed; per-spec logs backend/test-runner-logs/s12-batch1/ (gitignored), run record phase1-final-s12-batch1.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
  'P0-A blocker retained (see blockers); scope excludes the blocked areas (full routes, environment-specific integration)',
  'S12 FINDING 1 (fixed in slice 13, commit 56bb6d4): MfaService.beginSetup ON CONFLICT WHERE columns qualified (user_mfa.tenant_id / user_mfa.confirmed_at) — MFA setup works end to end (setup, second setup on the conflict path, setup then confirm, beginSetup after confirm rejected); proven by test/critical/phase1-final-s13-mfa-begin-setup.spec.ts',
];
const APPROVALS_SPECS: string[] = [
  'test/critical/phase1-final-s12-approvals-baseline.spec.ts',
  'test/critical/solo-admin-po-self-approval-override.spec.ts',
];
const APPROVALS_EVIDENCE: string[] = [
  'Targeted critical-spec run (run-critical.mjs --list --workers 1) on 95858d5, 2026-11-28: all 2 primary-owner specs passed; per-spec logs backend/test-runner-logs/s12-batch1/ (gitignored), run record phase1-final-s12-batch1.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const TRADEIN_SPECS: string[] = [
  'test/critical/phase1-final-s12-tradein-baseline.spec.ts',
  'test/critical/tradein-exchange.spec.ts',
];
const TRADEIN_EVIDENCE: string[] = [
  'Targeted critical-spec run (run-critical.mjs --list --workers 1) on 95858d5, 2026-11-28: all 2 primary-owner specs passed; per-spec logs backend/test-runner-logs/s12-batch1/ (gitignored), run record phase1-final-s12-batch1.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const CRM_SPECS: string[] = [
  'test/critical/crm-close-date-required.spec.ts',
  'test/critical/phase1-final-s12-crm-baseline.spec.ts',
];
const CRM_EVIDENCE: string[] = [
  'Targeted critical-spec run (run-critical.mjs --list --workers 1) on 95858d5, 2026-11-28: all 2 primary-owner specs passed; per-spec logs backend/test-runner-logs/s12-batch1/ (gitignored), run record phase1-final-s12-batch1.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const ADDONS_SPECS: string[] = ['test/critical/phase1-final-s12-addons-baseline.spec.ts'];
const ADDONS_EVIDENCE: string[] = [
  'Targeted critical-spec run (run-critical.mjs --list --workers 1) on 95858d5, 2026-11-28: all 1 primary-owner specs passed; per-spec logs backend/test-runner-logs/s12-batch1/ (gitignored), run record phase1-final-s12-batch1.out in the audit workspace',
  'Not run: PostgreSQL integration, UI, UAT, legal/statutory; full routes and environment-specific integration not executed',
];
const BATCH: ReadonlyArray<{ module: string; specs: string[]; evidence: string[]; blockers: number }> = [
  { module: 'sessions', specs: SESSIONS_SPECS, evidence: SESSIONS_EVIDENCE, blockers: 1 },
  { module: 'approvals', specs: APPROVALS_SPECS, evidence: APPROVALS_EVIDENCE, blockers: 0 },
  { module: 'tradein', specs: TRADEIN_SPECS, evidence: TRADEIN_EVIDENCE, blockers: 0 },
  { module: 'crm', specs: CRM_SPECS, evidence: CRM_EVIDENCE, blockers: 0 },
  { module: 'addons', specs: ADDONS_SPECS, evidence: ADDONS_EVIDENCE, blockers: 0 },
];

async function main(): Promise<void> {
  const register = JSON.parse(fs.readFileSync(REGISTER, 'utf8')) as Register;

  // §1: Register shape — 37 modules, 36 verified_scoped (named),
  // 0 unverified, 1 release_blocked (hr), baseline unchanged.
  // (Slice 14 moved the counts: 31 + batch 2 (5) = 36;
  // no module is left unverified — hr alone stays release_blocked.)
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
        'activation',
        'addons',
        'ai-copilot',
        'approvals',
        'bosta',
        'cash-drawer',
        'catalog',
        'contracting',
        'crm',
        'delivery-reps',
        'gcc-shipping',
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
        'sessions',
        'settings',
        'storefront',
        'tax-integration',
        'tenant-subscription',
        'tradein',
        'treasury',
        'users',
      ],
      'exactly the 36 verified modules (slices 10 + 11 + slice 12 batch 1 + slice 14 batch 2) must be verified_scoped',
    );
    assert.deepEqual(unverified, [], 'no module may stay unverified_current_head');
    assert.deepEqual(blocked, ['hr'], 'hr alone must stay release_blocked');
  }

  // §2: Per flipped module — state, verified commit, verified date,
  // exact scope list (mode entry + spec files), exact test_evidence,
  // blocker count (P0-A blocker kept: sessions).
  {
    for (const entry of BATCH) {
      const mod = register.modules.find((m) => m.module === entry.module);
      assert.ok(mod, `register must list ${entry.module}`);
      assert.equal(mod.state, 'verified_scoped', `${entry.module} state must be verified_scoped`);
      assert.equal(mod.last_verified_commit, SHA, `${entry.module} verified commit must be the slice-12 HEAD`);
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
    const guardCount = (guard.match(/INV-OFFLINE-SYNC-BELOW-FLOOR-GATE/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §5: Wiring: both critical lists carry 435 specs in identical
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
    assert.equal(specs.length, 451);
    assert.equal(chain.length, 451);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 435 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-r1-offline-below-floor-gate.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-r1-offline-below-floor-gate.spec.ts');
    for (const [label, specPath] of EARLIER_WIRING) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 451);') && src.includes('assert.equal(chain.length, 451);'),
        `${label} spec wiring must re-pin to 435`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-r1-offline-below-floor-gate.spec.ts'"),
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
    const prevName = 'phase1-final-s11-module-' + 'documentation.spec.ts';
    const prevInv = 'INV-MODULE-DOCUMENTATION-' + 'S11';
    const staleSpecs = 'specs.length, 42' + '7';
    const staleChain = 'chain.length, 42' + '7';
    const staleList = 'list.length, 42' + '7';
    for (const file of fs.readdirSync(CRITICAL_DIR)) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(CRITICAL_DIR, file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (427)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the previous spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 11)');
  }

  // §7: The guard tail holds ONLY the newest id, so this package
  // re-pins the earlier specs' guard assertions to the new INV;
  // their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
    for (const [label, specPath] of EARLIER_GUARD) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-OFFLINE-SYNC-BELOW-FLOOR-GATE/g)'),
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
        src.includes(`const HIGHEST_MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
        `${label} spec highest-migration pin must stay at 0346`,
      );
      assert.ok(
        src.includes('the 0346 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must stay at 0346`,
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
        src.includes(`const MIGRATION_FILE = '2040000000346_loss_prevention_anti_theft_shield.ts';`),
        `${label} spec migration-file pin must stay at 0346`,
      );
      assert.ok(src.includes('must re-point to 0346'), `${label} spec highest-migration assertions must stay at 0346`);
    }
    const s2Src = fs.readFileSync(S2_SPEC, 'utf8');
    assert.ok(
      s2Src.includes('the 0346 migration must be the highest-numbered migration on disk'),
      'S2 spec highest-migration assertion must stay at 0346',
    );
    assert.ok(
      s2Src.includes('spec highest-migration pin must re-point to 0346'),
      'S2 spec §10 pin message must stay at 0346',
    );
    assert.ok(
      s2Src.includes('spec highest-migration message must re-point to 0346'),
      'S2 spec §10 message must stay at 0346',
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
      s4Src.includes("'2040000000346_loss_prevention_anti_theft_shield.ts',"),
      'S4 spec §4 highest-migration literal must stay at 0346',
    );
    assert.ok(
      s4Src.includes('the 0346 migration must be the highest-numbered migration on disk'),
      'S4 spec highest-migration assertion must stay at 0346',
    );
    assert.ok(
      s4Src.includes('spec highest-migration pin must re-point to 0346'),
      'S4 spec §9 pin message must stay at 0346',
    );
    const s7Src = fs.readFileSync(S7_SPEC, 'utf8');
    assert.ok(
      s7Src.includes('2040000000346_loss_prevention_anti_theft_shield.ts'),
      'S7 spec highest-migration pin must stay at 0346',
    );
    const s8Src = fs.readFileSync(S8_SPEC, 'utf8');
    assert.ok(
      s8Src.includes('2040000000346_loss_prevention_anti_theft_shield.ts'),
      'S8 spec highest-migration pin must stay at 0346',
    );
    const s9Src = fs.readFileSync(S9_SPEC, 'utf8');
    assert.ok(
      s9Src.includes('2040000000346_loss_prevention_anti_theft_shield.ts'),
      'S9 spec highest-migration pin must stay at 0346',
    );
    const s10Src = fs.readFileSync(S10_SPEC, 'utf8');
    assert.ok(
      s10Src.includes('2040000000346_loss_prevention_anti_theft_shield.ts'),
      'S10 spec highest-migration pin must stay at 0346',
    );
    const s11Src = fs.readFileSync(S11_SPEC, 'utf8');
    assert.ok(
      s11Src.includes('2040000000346_loss_prevention_anti_theft_shield.ts'),
      'S11 spec highest-migration pin must stay at 0346',
    );
  }

  console.log('phase1 final slice 12 checks passed (module documentation batch 1, 435 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
