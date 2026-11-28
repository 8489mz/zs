import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { AppError } from '../../src/common/errors/app-error';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { AuditService } from '../../src/core/audit/audit.service';
import { decryptMfaSecret } from '../../src/core/auth/utils/mfa-secret-cipher';
import { formatSecretForDisplay, generateTotpCode } from '../../src/core/auth/utils/totp';
import { MfaService } from '../../src/modules/sessions/mfa.service';

/*
 * Phase 1 final-inspection slice 13 — the S12 FINDING 1 fix: MFA
 * setup was broken in production, not just in the test.
 *
 * GROUNDING (live code, read before writing):
 * - MfaService.beginSetup (sessions/mfa.service.ts) inserts the
 *   pending factor with INSERT ... ON CONFLICT (user_id) DO UPDATE
 *   ... WHERE tenant_id = $1 AND confirmed_at IS NULL. The WHERE
 *   columns are unqualified, and both exist in the target table
 *   and in the EXCLUDED row — so Postgres rejects the statement
 *   at parse time: column reference "tenant_id" is ambiguous
 *   (42702). MFA setup throws on ANY Postgres, before any row is
 *   read or written: even the FIRST setup call fails, because the
 *   ambiguity is a parse-time error, not a conflict-time one.
 * - The fix qualifies the columns (user_mfa.tenant_id /
 *   user_mfa.confirmed_at) and nothing else. It is the ONLY
 *   doUpdateSet in src/ that chains a .where() (verified by a
 *   brace-matching scan of every doUpdateSet site: 17 sites, 16
 *   end at .execute()/.returning(), only mfa.service.ts:123
 *   chains .where) — the bug is isolated, and no other statement
 *   needs the same qualification.
 * - user_mfa (migration 2040000000142): user_id BIGINT PRIMARY
 *   KEY, so the ON CONFLICT target is the primary key; the
 *   qualified WHERE keeps the two safety properties: the update
 *   touches only this tenant's row, and a concurrent confirmation
 *   is never reset back to an unenrolled factor (confirmed_at IS
 *   NULL fails once the row is confirmed).
 * - The slice-12 sessions baseline spec seeds the pending row
 *   directly and proves confirm / regenerate / disable only;
 *   beginSetup is NOT driven there, per the finding. This spec
 *   drives beginSetup itself, end to end (setup then confirm),
 *   on the real service with PGlite.
 *
 * WHAT THIS PROVES (real service on PGlite, audit stub only):
 * - beginSetup on a fresh user returns a secret + display form +
 *   otpauth URI and stores the pending row (confirmed_at NULL,
 *   the stored secret decrypts to the returned secret).
 * - A second beginSetup while pending takes the ON CONFLICT DO
 *   UPDATE path: the stored secret is replaced, still exactly
 *   one row, still unconfirmed (this is the fixed statement).
 * - Setup then confirm with a real TOTP code enables MFA and
 *   issues exactly 10 recovery codes.
 * - beginSetup after confirm rejects MFA_ALREADY_ENABLED (400).
 *
 * NOT RUN: live Postgres (PGlite is Postgres-compatible and
 * raises the same 42702), UI, the MFA_REQUIRED_FOR_PLATFORM
 * policy (env-forced; the default is off and isRequiredFor is
 * asserted off through getStatus).
 *
 * RED-1: run this spec BEFORE the fix — the first beginSetup
 * call throws 42702 and the spec exits 1. After the fix it
 * passes end to end.
 *
 * Wiring: both critical lists carry 436 specs in identical
 * order, this spec last.
 */

const TENANT = 't1';
const ACCOUNT = 'a1';

const auth: AuthContext = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: [],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

const DDL = `
  CREATE TABLE user_mfa (
    user_id BIGINT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL DEFAULT '',
    secret_encrypted TEXT NOT NULL,
    confirmed_at TIMESTAMPTZ NULL,
    last_used_step BIGINT NOT NULL DEFAULT 0,
    recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(DDL);
  return { pg, db };
}

async function assertAppError(promise: Promise<unknown>, code: string, status?: number): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
    assert.equal((error as AppError).code, code, `expected code ${code}`);
    if (status !== undefined) assert.equal((error as AppError).statusCode, status);
    return;
  }
  assert.fail(`expected rejection with ${code}, but the call succeeded`);
}

async function liveProof(): Promise<void> {
  const prevMfaKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = 'slice13-test-only-mfa-key';
  try {
    const { pg, db } = await makeDb();
    try {
      const auditCalls: string[] = [];
      const audit = { log: async (action: string) => void auditCalls.push(action) } as unknown as AuditService;
      const mfa = new MfaService(db, audit);

      // ---- 1. Fresh beginSetup stores the pending row ----
      const first = await mfa.beginSetup(auth);
      assert.ok(first.secret.length > 0, 'beginSetup returns a secret');
      assert.equal(first.secretFormatted, formatSecretForDisplay(first.secret), 'the display form matches the secret');
      assert.ok(first.otpauthUri.startsWith('otpauth://totp/'), 'the otpauth URI has the totp scheme');
      assert.ok(first.otpauthUri.includes('admin'), 'the otpauth URI names the account');
      const storedFirst = await db
        .selectFrom('user_mfa')
        .select(['secret_encrypted', 'confirmed_at', 'tenant_id'])
        .where('user_id', '=', 1)
        .executeTakeFirstOrThrow();
      assert.equal(storedFirst.confirmed_at, null, 'the pending row is unconfirmed');
      assert.equal(storedFirst.tenant_id, TENANT, 'the pending row belongs to this tenant');
      assert.equal(
        decryptMfaSecret(storedFirst.secret_encrypted),
        first.secret,
        'the stored secret decrypts to the returned secret',
      );
      const before = await mfa.getStatus(auth);
      assert.equal(before.enabled, false, 'MFA is still disabled before confirm');
      assert.equal(before.required, false, 'MFA is not forced by default');
      console.log('  beginSetup on a fresh user passed');

      // ---- 2. Second beginSetup while pending: the ON CONFLICT DO
      // UPDATE path (the fixed statement) replaces the secret ----
      const second = await mfa.beginSetup(auth);
      assert.ok(second.secret.length > 0, 'the second beginSetup returns a secret');
      assert.notEqual(second.secret, first.secret, 'the second setup issues a fresh secret');
      const rows = await db
        .selectFrom('user_mfa')
        .select(['secret_encrypted', 'confirmed_at'])
        .where('user_id', '=', 1)
        .execute();
      assert.equal(rows.length, 1, 'the conflict update keeps exactly one row per user');
      assert.equal(rows[0].confirmed_at, null, 'the replaced row is still unconfirmed');
      assert.equal(
        decryptMfaSecret(rows[0].secret_encrypted),
        second.secret,
        'the stored secret is the second setup secret',
      );
      console.log('  second beginSetup (conflict path) passed');

      // ---- 3. Setup then confirm end to end ----
      const code = generateTotpCode(second.secret);
      const confirmed = await mfa.confirmSetup(auth, code);
      assert.equal(confirmed.recoveryCodes.length, 10, 'confirming issues exactly 10 recovery codes');
      const after = await mfa.getStatus(auth);
      assert.equal(after.enabled, true, 'MFA is enabled after confirm');
      assert.ok(after.confirmedAt, 'confirmation time is recorded');
      assert.equal(after.recoveryCodesRemaining, 10, 'all 10 recovery codes remain');
      assert.ok(auditCalls.includes('تفعيل المصادقة الثنائية'), 'the audit log records the activation');
      console.log('  setup then confirm passed');

      // ---- 4. beginSetup after confirm is rejected ----
      await assertAppError(mfa.beginSetup(auth), 'MFA_ALREADY_ENABLED', 400);
      console.log('  beginSetup after confirm rejected passed');
    } finally {
      await db.destroy();
    }
  } finally {
    if (prevMfaKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = prevMfaKey;
  }
}

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const CRITICAL_DIR = path.join(BACKEND, 'test', 'critical');
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
const S12_SPEC = path.join(CRITICAL_DIR, 'phase1-final-s12-module-documentation.spec.ts');

const NEW_INV = 'INV-MFA-BEGIN-SETUP-ON-CONFLICT-42702';

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
  ['S12', path.join(CRITICAL_DIR, 'phase1-final-s12-module-documentation.spec.ts')],
];

// Earlier specs carrying a guard assertion (guard list §7): every
// file whose guard.match line the re-pin sweep moves to the new INV.
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
  ['S12', path.join(CRITICAL_DIR, 'phase1-final-s12-module-documentation.spec.ts')],
];

async function guardChecks(): Promise<void> {
  // §4: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MFA-BEGIN-SETUP-ON-CONFLICT-42702/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §5: Wiring: both critical lists carry 436 specs in identical
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
    assert.equal(specs.length, 436);
    assert.equal(chain.length, 436);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 436 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts');
    for (const [label, specPath] of EARLIER_WIRING) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 436);') && src.includes('assert.equal(chain.length, 436);'),
        `${label} spec wiring must re-pin to 436`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s13-mfa-begin-setup.spec.ts'"),
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
    const prevName = 'phase1-final-s12-module-' + 'documentation.spec.ts';
    const prevInv = 'INV-MODULE-DOCUMENTATION-' + 'S12';
    const staleSpecs = 'specs.length, 43' + '5';
    const staleChain = 'chain.length, 43' + '5';
    const staleList = 'list.length, 43' + '5';
    for (const file of fs.readdirSync(CRITICAL_DIR)) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(CRITICAL_DIR, file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (435)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the previous spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 12)');
  }

  // §7: The guard tail holds ONLY the newest id, so this package
  // re-pins the earlier specs' guard assertions to the new INV;
  // their invariants-file assertions still pin their own id
  // (each line stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
    for (const [label, specPath] of EARLIER_GUARD) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MFA-BEGIN-SETUP-ON-CONFLICT-42702/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §8: The module-boundary pins do not move in this package
  // (one two-line qualification in the MFA service; no
  // behaviour change beyond the fixed statement). No migration
  // in this package, so the "highest migration" pins stay at
  // 0345.
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
    const s10Src = fs.readFileSync(S10_SPEC, 'utf8');
    assert.ok(
      s10Src.includes('2040000000345_import_fx_payout_idempotency_keys.ts'),
      'S10 spec highest-migration pin must stay at 0345',
    );
    const s11Src = fs.readFileSync(S11_SPEC, 'utf8');
    assert.ok(
      s11Src.includes('2040000000345_import_fx_payout_idempotency_keys.ts'),
      'S11 spec highest-migration pin must stay at 0345',
    );
    const s12Src = fs.readFileSync(S12_SPEC, 'utf8');
    assert.ok(
      s12Src.includes('2040000000345_import_fx_payout_idempotency_keys.ts'),
      'S12 spec highest-migration pin must stay at 0345',
    );
  }
}

async function main(): Promise<void> {
  await liveProof();
  await guardChecks();
  console.log('phase1 final slice 13 checks passed (MFA beginSetup fix, 436 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
