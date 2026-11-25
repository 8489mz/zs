import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveMfaEncryptionKey } from '../../src/core/auth/utils/mfa-secret-cipher';

function run(): void {
  const missing = { SESSION_SECRET: '', MFA_ENCRYPTION_KEY: '', PORTABLE_MODE: 'true', IS_ELECTRON: 'true' } as any;
  assert.throws(
    () => resolveMfaEncryptionKey({ ...missing, APP_MODE: 'CLOUD_SAAS' }),
    /SESSION_SECRET \/ MFA_ENCRYPTION_KEY/,
  );
  assert.throws(
    () => resolveMfaEncryptionKey({ ...missing, APP_MODE: undefined }),
    /SESSION_SECRET \/ MFA_ENCRYPTION_KEY/,
  );
  assert.throws(
    () => resolveMfaEncryptionKey({ ...missing, APP_MODE: 'UNKNOWN' }),
    /SESSION_SECRET \/ MFA_ENCRYPTION_KEY/,
  );
  // الديسكتوب: المفتاح مشتق من سر التثبيت المحلي (ملف مؤقت هنا)، لا من ثابت في الكود.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-'));
  try {
    const secretPath = path.join(dir, 'install-secret');
    assert.equal(
      resolveMfaEncryptionKey({ ...missing, APP_MODE: 'SELF_CONTAINED', ZS_INSTALL_SECRET_PATH: secretPath }).length,
      32,
    );
    assert.equal(
      resolveMfaEncryptionKey({ ...missing, APP_MODE: 'LOCAL_PILOT', ZS_INSTALL_SECRET_PATH: secretPath }).length,
      32,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run();
