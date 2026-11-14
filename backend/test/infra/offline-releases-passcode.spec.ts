/* Offline update passcodes must be per-release random secrets, never derived
 * from public repo contents and never leaked back to the caller.
 *
 * RED-proven on pristine: the old generateReleasePasscode is a deterministic
 * SHA-256 of a fixed literal + version, so (1) two calls return the same
 * value, (2) getReleasePasscodeByVersion hands out a code for a version that
 * was never provisioned, (3) simulateUpdate accepts the published code for
 * an unprovisioned version, and (4) the wrong-code error echoes the expected
 * code and the success response returns it as generatedPasscode.
 *
 * The published code used in case 3 is read from the tracked release manifest
 * releases/manifest-1.1.15.json — the code itself was public in the repo.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  OfflineReleasesService,
  generateReleasePasscode,
} from '../../src/modules/settings/services/offline-releases.service';

async function main() {
  process.env.APP_MODE = 'SELF_CONTAINED';
  process.env.PORTABLE_MODE = 'true';
  process.env.NODE_ENV = 'test';
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-passcode-'));
  process.env.ELECTRON_EXE_PATH = path.join(tmpRoot, 'electron.exe');

  const exitOrig = process.exit;
  (process as any).exit = () => undefined;

  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const service = new OfflineReleasesService(db as any);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'super_admin', userId: 1, permissions: [] } as any;

  try {
    await pg.exec(`
      CREATE TABLE offline_releases (
        id SERIAL PRIMARY KEY,
        version TEXT NOT NULL,
        changelog TEXT NOT NULL DEFAULT '',
        patch_url TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT false,
        passcode TEXT,
        requires_passcode BOOLEAN NOT NULL DEFAULT true,
        promoted_by TEXT,
        promoted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 1. A release passcode is a fresh random secret, never a deterministic
    // derivation of the version: two calls for the same version must differ.
    const first = generateReleasePasscode('1.1.42');
    const second = generateReleasePasscode('1.1.42');
    assert.match(first, /^ZS-UPD-1142-[0-9A-F]{4}-[0-9A-F]{4}$/, 'passcode keeps the ZS-UPD format');
    assert.notEqual(first, second, 'same version must not always yield the same passcode');

    // 2. No code is handed out for a version that was never provisioned.
    const unknown = await service.getReleasePasscodeByVersion(auth, '9.9.8');
    assert.equal(unknown.passcode, null, 'unprovisioned version must not receive a passcode');
    assert.equal(unknown.requiresPasscode, true);

    // 3. The published code for an unprovisioned version must NOT verify.
    // releases/manifest-1.1.15.json ships that code in the public repo.
    const publishedManifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), '../releases/manifest-1.1.15.json'), 'utf8'),
    ) as { version: string; passcode: string };
    assert.equal(publishedManifest.version, '1.1.15');
    assert.match(publishedManifest.passcode, /^ZS-UPD-1115-[0-9A-F]{4}-[0-9A-F]{4}$/);
    try {
      await service.simulateUpdate({ targetVersion: '1.1.15', passcode: publishedManifest.passcode });
      assert.fail('published code for an unprovisioned version must be rejected');
    } catch (e: any) {
      assert.ok(
        /no code provisioned|لم يتم تخصيص/i.test(e.message),
        `expected fail-closed error, got: ${e.message}`,
      );
    }

    // 3b. Same fail-closed rule when a row exists but holds no passcode.
    await db
      .insertInto('offline_releases')
      .values({
        version: '1.1.15', changelog: '', patch_url: '', is_active: false,
        passcode: null, requires_passcode: true, promoted_by: null,
        promoted_at: null, created_at: new Date().toISOString(),
      } as any)
      .execute();
    try {
      await service.simulateUpdate({ targetVersion: '1.1.15', passcode: publishedManifest.passcode });
      assert.fail('published code must be rejected when the row holds no passcode');
    } catch (e: any) {
      assert.ok(
        /no code provisioned|لم يتم تخصيص/i.test(e.message),
        `expected fail-closed error, got: ${e.message}`,
      );
    }

    // 4. A wrong code must not leak the expected code (and the success
    // response must not return it either).
    const storedCode = 'ZS-UPD-9999-AAAA-BBBB';
    await db
      .insertInto('offline_releases')
      .values({
        version: '9.9.9', changelog: '', patch_url: '', is_active: false,
        passcode: storedCode, requires_passcode: true, promoted_by: null,
        promoted_at: new Date().toISOString(), created_at: new Date().toISOString(),
      } as any)
      .execute();
    try {
      await service.simulateUpdate({ targetVersion: '9.9.9', passcode: 'ZS-UPD-9999-CCCC-DDDD' });
      assert.fail('wrong passcode must be rejected');
    } catch (e: any) {
      assert.ok(!e.message.includes('ZS-UPD-'), `error must not echo a passcode, got: ${e.message}`);
      assert.ok(!e.message.includes(storedCode), 'error must not echo the expected passcode');
    }

    // 5. Positive control: a stored (provisioned) code still verifies, and
    // the response carries no code back.
    const ok = await service.simulateUpdate({ targetVersion: '9.9.9', passcode: storedCode });
    assert.equal(ok.ok, true);
    assert.equal(ok.passcodeVerified, true);
    assert.ok(!('generatedPasscode' in ok), 'simulate response must not return the passcode');
    const byVersion = await service.getReleasePasscodeByVersion(auth, '9.9.9');
    assert.equal(byVersion.passcode, storedCode);

    // 5b. The stored code also unlocks the local apply path.
    const applied = await service.applyLocalUpdate({
      version: '9.9.9', patchUrl: 'https://example.invalid/patch-9.9.9.zip', changelog: '', passcode: storedCode,
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.version, '9.9.9');

    // 6. An admin can provision a code for a release that has none, and the
    // provisioned code then verifies.
    const row = await db
      .selectFrom('offline_releases')
      .select(['id'])
      .where('version', '=', '1.1.15')
      .executeTakeFirstOrThrow();
    const provisioned = await (service as any).setReleasePasscode(auth, Number(row.id), 'ZS-UPD-1115-QQQQ-WWWW');
    assert.equal(provisioned.ok, true);
    assert.equal(provisioned.version, '1.1.15');
    const after = await service.simulateUpdate({ targetVersion: '1.1.15', passcode: 'ZS-UPD-1115-QQQQ-WWWW' });
    assert.equal(after.ok, true);
    assert.equal(after.passcodeVerified, true);

    process.stdout.write('offline-releases-passcode.spec: ok\n');
  } finally {
    (process as any).exit = exitOrig;
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
