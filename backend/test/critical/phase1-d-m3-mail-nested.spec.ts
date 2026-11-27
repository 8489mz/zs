import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeMailService } from '../../src/modules/maritime-freight/maritime-mail.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 D-M3 — testMailConnection ignores the nested payload
 * (INV-PHASE1-D-M3-MAIL-NESTED).
 *
 * Grounding §6 row M3 (phase1-grounding.md), caller re-verified live
 * at 949ecce6e before this batch was written (phase1-d-batch-log.md
 * §STEP 0): MaritimeSettingsTab sends NESTED { smtp: { host, port,
 * secure, user, password }, imap: { ... } } to POST
 * /api/maritime-freight/mail-settings/test, and testConnection reads
 * only the FLAT fields (smtpHost etc.) — so today the test ignores
 * the form values and tests the SAVED config. The DTO
 * (TestMailConnectionDto) already accepts the nested shape PLUS the
 * flat fields — NO contract change. The fix maps the nested payload
 * into the flat override path at the top of testConnection (nested
 * wins when both are present — it is the form's live values); the
 * rest of the function is untouched, including the masked-password
 * fallback (a masked nested password still falls back to the saved
 * one) and the saved-config fallback.
 *
 * WHAT THIS PINS, driving the REAL testConnection on PGlite:
 * - a nested-only payload is TESTED, not the saved config (a nested
 *   smtp user of '' must hit the missing-credentials branch even
 *   though the saved config is complete);
 * - the flat-only override path still works (a flat payload with an
 *   empty user hits the same branch);
 * - nested wins over flat when both are present (a flat user plus a
 *   nested empty user hits the missing-credentials branch);
 * - with no saved config and no payload the defaults apply (the
 *   fallback chain is untouched);
 * - source pins: testConnection maps the nested smtp/imap fields.
 *
 * PROOF LIMIT (stated plainly): the PGlite drive proves the service
 * uses the nested payload; the HTTP path (controller -> service) and
 * the validation pipe are proven by CI (the DTO already accepts the
 * nested shape). The RED run at base performs real network attempts
 * to .invalid hosts (the saved config the base code tests) — those
 * fail fast on DNS (NXDOMAIN, reserved TLD) and never reach a real
 * server; no live-Postgres rehearsal is claimed here.
 *
 * Wiring: both critical lists carry 397 specs in identical order,
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
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const MAIL_SERVICE = path.join(BACKEND, 'src', 'modules', 'maritime-freight', 'maritime-mail.service.ts');

const SMTP_MISSING = 'يرجى إدخال اسم المضيف واسم المستخدم وكلمة مرور خادم SMTP';
const IMAP_MISSING = 'يرجى إدخال اسم المضيف واسم المستخدم وكلمة مرور خادم IMAP';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const authNoSaved = {
    tenantId: 't2',
    accountId: 'a1',
    role: 'admin',
    userId: 1,
    permissions: [],
  } as unknown as AuthContext;
  const service = new MaritimeMailService(db as never);

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
    `);
    // A COMPLETE saved config on .invalid hosts: at base the code
    // tests THIS config (real network attempts that fail fast on DNS);
    // after the fix the nested payload is tested instead.
    const saved = {
      outgoingProvider: 'custom',
      smtpHost: 'saved.invalid',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'saved-user',
      smtpPassword: 'saved-pass',
      fromName: 'Test',
      fromEmail: 'test@saved.invalid',
      incomingProvider: 'custom',
      imapHost: 'saved-imap.invalid',
      imapPort: 993,
      imapSecure: true,
      imapUser: 'saved-imap-user',
      imapPassword: 'saved-imap-pass',
      autoReadInboundBids: true,
    };
    await db
      .insertInto('settings')
      .values({ tenant_id: 't1', key: 'maritime_mail_config', value: JSON.stringify(saved) })
      .execute();

    // 1. A nested-only payload is TESTED, not the saved config: the
    // nested smtp/imap users are empty, so the missing-credentials
    // branch must fire even though the saved config is complete.
    const nestedOnly = await service.testConnection(auth, {
      smtp: { host: 'nested.invalid', port: 587, secure: false, user: '', password: 'nested-pass' },
      imap: { host: 'nested-imap.invalid', port: 993, secure: true, user: '', password: 'nested-imap-pass' },
    } as never);
    assert.equal(nestedOnly.smtpOk, false, 'nested-only payload with an empty smtp user must fail the test');
    assert.equal(nestedOnly.smtpMessage, SMTP_MISSING, 'nested smtp user must be the tested value, not the saved one');
    assert.equal(nestedOnly.imapOk, false, 'nested-only payload with an empty imap user must fail the test');
    assert.equal(nestedOnly.imapMessage, IMAP_MISSING, 'nested imap user must be the tested value, not the saved one');

    // 2. The flat-only override path still works (regression pin).
    const flatOnly = await service.testConnection(auth, {
      smtpHost: 'flat.invalid',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: '',
      smtpPassword: 'flat-pass',
      imapHost: 'flat-imap.invalid',
      imapPort: 993,
      imapSecure: true,
      imapUser: '',
      imapPassword: 'flat-imap-pass',
    } as never);
    assert.equal(flatOnly.smtpOk, false, 'flat-only payload with an empty smtp user must fail the test');
    assert.equal(flatOnly.smtpMessage, SMTP_MISSING, 'flat smtp user must still be honoured');
    assert.equal(flatOnly.imapOk, false, 'flat-only payload with an empty imap user must fail the test');
    assert.equal(flatOnly.imapMessage, IMAP_MISSING, 'flat imap user must still be honoured');

    // 3. Nested wins over flat when both are present (the decided
    // precedence: the nested payload is the form's live values).
    const both = await service.testConnection(auth, {
      smtpHost: 'flat.invalid',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'flat-user',
      smtpPassword: 'flat-pass',
      smtp: { host: 'nested.invalid', port: 587, secure: false, user: '', password: 'nested-pass' },
      imapHost: 'flat-imap.invalid',
      imapPort: 993,
      imapSecure: true,
      imapUser: 'flat-imap-user',
      imapPassword: 'flat-imap-pass',
      imap: { host: 'nested-imap.invalid', port: 993, secure: true, user: '', password: 'nested-imap-pass' },
    } as never);
    assert.equal(both.smtpOk, false, 'nested empty smtp user must win over a flat user');
    assert.equal(both.smtpMessage, SMTP_MISSING, 'nested smtp must win over flat smtp');
    assert.equal(both.imapOk, false, 'nested empty imap user must win over a flat user');
    assert.equal(both.imapMessage, IMAP_MISSING, 'nested imap must win over flat imap');

    // 4. With no saved config and no payload the defaults apply (the
    // fallback chain is untouched): host defaults, user empty.
    const emptyTenant = await service.testConnection(authNoSaved, {} as never);
    assert.equal(emptyTenant.smtpOk, false, 'no saved config and no payload must fail the smtp test');
    assert.equal(emptyTenant.smtpMessage, SMTP_MISSING, 'the default smtp host with an empty user must hit the branch');
    assert.equal(emptyTenant.imapOk, false, 'no saved config and no payload must fail the imap test');
    assert.equal(emptyTenant.imapMessage, IMAP_MISSING, 'the default imap host with an empty user must hit the branch');

    // 5. Source pins: testConnection maps the nested smtp/imap fields.
    const src = fs.readFileSync(MAIL_SERVICE, 'utf8');
    const testStart = src.indexOf('async testConnection(');
    const testEnd = src.indexOf('private async rawTestImap(');
    assert.ok(testStart >= 0 && testEnd > testStart, 'testConnection slice must be locatable');
    const slice = src.slice(testStart, testEnd);
    for (const field of [
      'smtp?.host',
      'smtp?.port',
      'smtp?.secure',
      'smtp?.user',
      'smtp?.password',
      'imap?.host',
      'imap?.port',
      'imap?.secure',
      'imap?.user',
      'imap?.password',
    ]) {
      assert.ok(slice.includes(field), `testConnection must map nested ${field}`);
    }

    // 2. The module-boundary pins do not move (backend-only package).
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
    const invCount = (invariants.match(/INV-PHASE1-D-M3-MAIL-NESTED/g) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the D-M3 INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-PHASE1-F5L-REPAIR-BUNDLE-BUDGET/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the D-M3 INV exactly once');

    // 4. Wiring: both critical lists carry 397 specs in identical order, this spec last.
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 398);
    assert.equal(chain.length, 398);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 397 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5l-repair-bundle-budget.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-f5l-repair-bundle-budget.spec.ts');
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
      ['D-M1', D_M1_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 398);') && src.includes('assert.equal(chain.length, 398);'),
        `${label} spec wiring must re-pin to 397`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-f5l-repair-bundle-budget.spec.ts'"),
        `${label} spec last-entry must re-pin to the D-M3 spec`,
      );
    }

    // 5. The wiring re-pin sweep is complete: no critical spec may still
    // pin the old count, point its last-entry at the D-M1 spec, pin the old
    // guard INV, pin the old frontend pins, or pin the old baseline size.
    // (The live tree holds ~75 files asserting the count — the #264-fix /
    // D12 lesson. The D-M1 filename, the count literals, the FE pin
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
    const prevName = 'phase1-d-m1-job-' + 'fields.spec.ts';
    const prevInv = 'INV-PHASE1-D-M1-' + 'JOB-FIELDS';
    const staleSpecs = 'specs.length, 39' + '6';
    const staleChain = 'chain.length, 39' + '6';
    const staleList = 'list.length, 39' + '6';
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
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (396)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the D-M1 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (D-M1)');
    assert.deepEqual(staleFePins, [], 'no critical spec may still pin the old frontend pins');
    assert.deepEqual(staleBaseline, [], 'no critical spec may still pin the old baseline size');

    // 6. The guard tail holds ONLY the newest id, so D-M3 re-pins the
    // B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/F5l/D-M1 specs'
    // guard assertions to the D-M3 INV; their invariants-file assertions
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
      ['D-M1', D_M1_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-PHASE1-F5L-REPAIR-BUNDLE-BUDGET/g)'),
        `${label} spec guard assertion must re-pin to the D-M3 INV`,
      );
    }

    console.log('phase1 D-M3 mail-nested checks passed (testMailConnection tests the nested payload, 397 specs wired)');
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
