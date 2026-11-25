/*
 * INV-PORTAL-PER-INSTALL-SECRET: no hardcoded signing/encryption secret may
 * live in `backend/src/core/auth/`.
 *
 * Before this fix `portal-token.ts` and `mfa-secret-cipher.ts` fell back to
 * public literals (`zs-desktop-offline-...`) on any Desktop install without
 * an env secret, so any Desktop copy could forge portal tokens for any other
 * copy. Both literals are deleted; Desktop now derives its keys from a
 * per-install secret file (`install-secret.ts`), and `csrf-token.ts` fails
 * closed on an empty secret instead of falling back to a public literal.
 *
 * This spec pins that in two ways: (1) a static scan of every `.ts` file
 * under `src/core/auth/` fails on any denylisted literal or on the deleted
 * `DESKTOP_LOCAL_*` identifiers; (2) behaviour — a Desktop install with no
 * env secret signs and verifies through its own install-secret file, a token
 * forged with the old public literal is rejected, and an MFA secret
 * encrypted under one install secret cannot be decrypted under another.
 * Scope note: the denylist covers signing/encryption key literals only.
 * `ZsAdmin2026` (default-password detection, not a key), `zs` tenant
 * identifiers, cookie names and the trivial-passcode blocklist are not keys
 * and are intentionally not listed.
 */

import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppError } from '../../src/common/errors/app-error';
import { decryptMfaSecret, encryptMfaSecret } from '../../src/core/auth/utils/mfa-secret-cipher';
import {
  PORTAL_TOKEN_TTL_MS,
  resolvePortalTokenSecret,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenErrorSpec,
} from '../../src/core/auth/utils/portal-token';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const AUTH_DIR = path.join(REPO_ROOT, 'backend', 'src', 'core', 'auth');

/** Retired public literals that must never reappear in `src/core/auth/`. */
const DENYLISTED_LITERALS = [
  'zs-desktop-offline-portal-token-secret',
  'zs-desktop-offline-mfa-encryption-key',
  'local-dev-csrf-secret',
];

const ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'missing', code: 'MISSING' },
  invalid: { message: 'invalid', code: 'INVALID' },
  signature: { message: 'signature', code: 'BAD_SIGNATURE' },
  expired: { message: 'expired', code: 'EXPIRED' },
};

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key] as string;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key] as string;
    }
  }
}

function withTempSecretFile(fn: (secretPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-'));
  try {
    fn(path.join(dir, 'install-secret'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function expectAppError(code: string, fn: () => unknown): void {
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.code === code, `expected ${code}`);
}

function run(): void {
  // 1. Static scan: no denylisted literal and no DESKTOP_LOCAL_* identifier
  //    anywhere under src/core/auth/.
  const files = listTsFiles(AUTH_DIR);
  assert.ok(files.length > 10, 'the auth scan must actually find source files');
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (const literal of DENYLISTED_LITERALS) {
      lines.forEach((line, i) => {
        assert.ok(
          !line.includes(literal),
          `${path.relative(REPO_ROOT, file)}:${i + 1} contains retired literal ${literal}`,
        );
      });
    }
    assert.ok(!src.includes('DESKTOP_LOCAL_SECRET'), `${file} still defines DESKTOP_LOCAL_SECRET`);
    assert.ok(!src.includes('DESKTOP_LOCAL_KEY'), `${file} still defines DESKTOP_LOCAL_KEY`);
  }

  // 2. Desktop with no env secret signs and verifies through its own
  //    install-secret file — never through the retired public literal.
  withTempSecretFile((secretPath) => {
    withEnv(
      {
        APP_MODE: 'SELF_CONTAINED',
        SESSION_SECRET: undefined,
        SESSION_CSRF_SECRET: undefined,
        ZS_INSTALL_SECRET_PATH: secretPath,
      },
      () => {
        assert.notEqual(
          resolvePortalTokenSecret(),
          'zs-desktop-offline-portal-token-secret',
          'the desktop portal secret must never be the retired public literal',
        );
        const token = signPortalToken({ employeeId: 7, tenantId: 'default' }, PORTAL_TOKEN_TTL_MS);
        assert.equal(verifyPortalToken<any>(`Bearer ${token}`, ERRORS).employeeId, 7);

        // 3. A token forged with the old public literal is rejected.
        const encoded = Buffer.from(
          JSON.stringify({ employeeId: 999, tenantId: 'victim-tenant', exp: Date.now() + 60_000 }),
        ).toString('base64url');
        const forged = createHmac('sha256', 'zs-desktop-offline-portal-token-secret')
          .update(encoded)
          .digest('base64url');
        expectAppError('BAD_SIGNATURE', () => verifyPortalToken(`${encoded}.${forged}`, ERRORS));
      },
    );
  });

  // 4. MFA under Desktop: encrypt/decrypt round-trips on the install secret,
  //    and a different install secret cannot decrypt.
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-b-'));
  try {
    const envA = {
      APP_MODE: 'SELF_CONTAINED',
      ZS_INSTALL_SECRET_PATH: path.join(dirA, 'install-secret'),
    } as unknown as NodeJS.ProcessEnv;
    const envB = {
      APP_MODE: 'SELF_CONTAINED',
      ZS_INSTALL_SECRET_PATH: path.join(dirB, 'install-secret'),
    } as unknown as NodeJS.ProcessEnv;
    const stored = encryptMfaSecret('JBSWY3DPEHPK3PXP', envA);
    assert.equal(decryptMfaSecret(stored, envA), 'JBSWY3DPEHPK3PXP');
    assert.throws(() => decryptMfaSecret(stored, envB), /MFA_SECRET_CORRUPT/);
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }

  // 5. Cloud stays fail-closed: no env secret, no install-secret file.
  withEnv(
    {
      APP_MODE: 'CLOUD_SAAS',
      SESSION_SECRET: undefined,
      SESSION_CSRF_SECRET: undefined,
      ZS_INSTALL_SECRET_PATH: undefined,
    },
    () => {
      expectAppError('PORTAL_TOKEN_SECRET_MISSING', () => resolvePortalTokenSecret());
    },
  );

  // 6. Wiring: this spec is in test:critical and its INV entry exists once.
  const specs = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'backend', 'scripts', 'critical-specs.json'), 'utf8'))
    .specs as string[];
  assert.ok(
    specs.includes('test/critical/no-hardcoded-auth-secrets.spec.ts'),
    'this spec must be wired into test:critical',
  );
  const invariants = fs.readFileSync(path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md'), 'utf8');
  assert.equal(
    invariants.split('INV-PORTAL-PER-INSTALL-SECRET').length - 1,
    1,
    'the invariant entry must exist exactly once',
  );

  console.log('no-hardcoded-auth-secrets.spec: ok');
}

run();
