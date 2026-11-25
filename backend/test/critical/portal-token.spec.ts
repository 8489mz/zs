import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppError } from '../../src/common/errors/app-error';
import {
  PORTAL_TOKEN_TTL_MS,
  resolvePortalTokenSecret,
  signPortalToken,
  verifyPortalToken,
  type PortalTokenErrorSpec,
} from '../../src/core/auth/utils/portal-token';

const ERRORS: PortalTokenErrorSpec = {
  missing: { message: 'missing', code: 'MISSING' },
  invalid: { message: 'invalid', code: 'INVALID' },
  signature: { message: 'signature', code: 'BAD_SIGNATURE' },
  expired: { message: 'expired', code: 'EXPIRED' },
};

const REAL_SECRET = 'a-real-production-session-secret-value';

/** السر الثابت الذي كان مكتوباً في الكود للديسكتوب — منشور، فأي رمز موقَّع به مرفوض. */
const OLD_DESKTOP_LITERAL = 'zs-desktop-offline-portal-token-secret';

/** الأسرار الافتراضية التي كانت مكتوبة داخل الكود قبل الإصلاح. */
const LEAKED_LEGACY_SECRETS = [
  'zs-attendance-mobile-punch-secret-2026',
  'zs-delivery-secret-token-key-2026',
  OLD_DESKTOP_LITERAL,
];

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

function expectAppError(code: string, fn: () => unknown): void {
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.code === code, `expected ${code}`);
}

const CLOUD_ENV = {
  APP_MODE: 'CLOUD_SAAS',
  SESSION_SECRET: undefined,
  SESSION_CSRF_SECRET: undefined,
  ZS_INSTALL_SECRET_PATH: undefined,
  PORTABLE_MODE: undefined,
  IS_ELECTRON: undefined,
};

/** يشغّل fn بمسار ملف سر تثبيت مؤقت، ثم يمسح المجلد. */
function withTempSecretFile(fn: (secretPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-'));
  try {
    fn(path.join(dir, 'install-secret'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(): void {
  // 1. فشل آمن: في السحابة بلا سر لا يُصدَر ولا يُقبَل أي رمز إطلاقاً.
  //    (عكس هذا هو النمط F12 — قيمة افتراضية تجعل التحقق يمر.)
  withEnv(CLOUD_ENV, () => {
    expectAppError('PORTAL_TOKEN_SECRET_MISSING', () => resolvePortalTokenSecret());
    expectAppError('PORTAL_TOKEN_SECRET_MISSING', () => signPortalToken({ employeeId: 1 }, PORTAL_TOKEN_TTL_MS));
  });

  // 1-b. استخدام SESSION_CSRF_SECRET كبديل آمن عند غياب SESSION_SECRET
  withEnv({ ...CLOUD_ENV, SESSION_CSRF_SECRET: REAL_SECRET }, () => {
    assert.equal(resolvePortalTokenSecret(), REAL_SECRET);
    const token = signPortalToken({ employeeId: 10, tenantId: 'tenant-x' }, PORTAL_TOKEN_TTL_MS);
    const payload = verifyPortalToken<any>(`Bearer ${token}`, ERRORS);
    assert.equal(payload.employeeId, 10);
  });

  // 2. سر قصير جداً في السحابة يُعامَل كغياب سر.
  withEnv({ ...CLOUD_ENV, SESSION_SECRET: 'short' }, () => {
    expectAppError('PORTAL_TOKEN_SECRET_MISSING', () => resolvePortalTokenSecret());
  });

  // 3. الديسكتوب/الأوفلاين يعمل بلا سر مضبوط: سر التثبيت يُولَّد عند أول تشغيل
  //    ويُحفَظ محلياً — ولا يكون أبداً السر الثابت العام القديم.
  withTempSecretFile((secretPath) => {
    withEnv(
      {
        APP_MODE: 'SELF_CONTAINED',
        SESSION_SECRET: undefined,
        SESSION_CSRF_SECRET: undefined,
        ZS_INSTALL_SECRET_PATH: secretPath,
      },
      () => {
        const resolved = resolvePortalTokenSecret();
        assert.notEqual(
          resolved,
          OLD_DESKTOP_LITERAL,
          'the resolved desktop secret must never be the retired public literal',
        );
        const token = signPortalToken({ employeeId: 7, tenantId: 'default' }, PORTAL_TOKEN_TTL_MS);
        const payload = verifyPortalToken<any>(`Bearer ${token}`, ERRORS);
        assert.equal(payload.employeeId, 7);
        const stored = fs.readFileSync(secretPath, 'utf8').trim();
        assert.match(stored, /^[0-9a-f]{64}$/, 'the install secret file must hold 64 hex chars');
        assert.equal(resolvePortalTokenSecret(), resolved, 'the install secret must be stable across resolves');
      },
    );
  });

  // 3-b. بيئة التطوير والبايلوت المحلي (LOCAL_PILOT) تعمل أيضاً كبيئة محلية بلا إيقاف البوابات.
  withTempSecretFile((secretPath) => {
    withEnv(
      {
        APP_MODE: 'LOCAL_PILOT',
        SESSION_SECRET: undefined,
        SESSION_CSRF_SECRET: undefined,
        ZS_INSTALL_SECRET_PATH: secretPath,
      },
      () => {
        assert.notEqual(resolvePortalTokenSecret(), OLD_DESKTOP_LITERAL);
        const token = signPortalToken({ employeeId: 9, tenantId: 'default' }, PORTAL_TOKEN_TTL_MS);
        const payload = verifyPortalToken<any>(`Bearer ${token}`, ERRORS);
        assert.equal(payload.employeeId, 9);
      },
    );
  });

  withEnv({ APP_MODE: 'CLOUD_SAAS', SESSION_SECRET: REAL_SECRET }, () => {
    // 4. الدورة الكاملة: توقيع ثم تحقق يعيد نفس الحمولة، ويضيف iat/exp.
    const token = signPortalToken({ employeeId: 42, tenantId: 'tenant-a' }, PORTAL_TOKEN_TTL_MS);
    const payload = verifyPortalToken<any>(`Bearer ${token}`, ERRORS);
    assert.equal(payload.employeeId, 42);
    assert.equal(payload.tenantId, 'tenant-a');
    assert.ok(payload.exp > Date.now());

    // يقبل الرمز الخام بلا بادئة Bearer أيضاً.
    assert.equal(verifyPortalToken<any>(token, ERRORS).tenantId, 'tenant-a');

    // 5. تبديل المستأجر داخل الحمولة يكسر التوقيع — لا عبور بين المستأجرين.
    const forgedPayload = Buffer.from(
      JSON.stringify({ employeeId: 42, tenantId: 'tenant-b', exp: Date.now() + 60_000 }),
    ).toString('base64url');
    const stolenSignature = token.split('.')[1];
    expectAppError('BAD_SIGNATURE', () => verifyPortalToken(`${forgedPayload}.${stolenSignature}`, ERRORS));

    // 6. رمز موقّع بأي سر افتراضي قديم مسرَّب يُرفض بعد ضبط سر حقيقي.
    for (const legacySecret of LEAKED_LEGACY_SECRETS) {
      const encoded = Buffer.from(
        JSON.stringify({ employeeId: 999, tenantId: 'victim-tenant', exp: Date.now() + 60_000 }),
      ).toString('base64url');
      const legacySignature = createHmac('sha256', legacySecret).update(encoded).digest('base64url');
      expectAppError('BAD_SIGNATURE', () => verifyPortalToken(`${encoded}.${legacySignature}`, ERRORS));
    }

    // 7. الرموز المنتهية والمشوّهة والغائبة.
    const expired = signPortalToken({ employeeId: 1 }, -1000);
    expectAppError('EXPIRED', () => verifyPortalToken(expired, ERRORS));
    expectAppError('MISSING', () => verifyPortalToken('', ERRORS));
    expectAppError('MISSING', () => verifyPortalToken(undefined, ERRORS));
    expectAppError('INVALID', () => verifyPortalToken('no-dot-separator', ERRORS));
    expectAppError('INVALID', () => verifyPortalToken('a.b.c', ERRORS));

    // 8. حمولة ليست JSON صالحاً لكنها موقّعة بشكل سليم → INVALID لا انهيار.
    const badBody = Buffer.from('not-json').toString('base64url');
    const badSignature = createHmac('sha256', REAL_SECRET).update(badBody).digest('base64url');
    expectAppError('INVALID', () => verifyPortalToken(`${badBody}.${badSignature}`, ERRORS));
  });

  // 9. تدوير سر التثبيت يُبطل الرموز الصادرة بالسر القديم — بلا توافق خلفي،
  //    لأن السر القديم منشور في الكود العام.
  {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-b-'));
    try {
      let token = '';
      withEnv(
        {
          APP_MODE: 'SELF_CONTAINED',
          SESSION_SECRET: undefined,
          SESSION_CSRF_SECRET: undefined,
          ZS_INSTALL_SECRET_PATH: path.join(dirA, 'install-secret'),
        },
        () => {
          token = signPortalToken({ employeeId: 7, tenantId: 'default' }, PORTAL_TOKEN_TTL_MS);
        },
      );
      withEnv(
        {
          APP_MODE: 'SELF_CONTAINED',
          SESSION_SECRET: undefined,
          SESSION_CSRF_SECRET: undefined,
          ZS_INSTALL_SECRET_PATH: path.join(dirB, 'install-secret'),
        },
        () => {
          expectAppError('BAD_SIGNATURE', () => verifyPortalToken(token, ERRORS));
        },
      );
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  }

  console.log('portal-token.spec: ok');
}

run();
