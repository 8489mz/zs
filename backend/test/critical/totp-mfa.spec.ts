import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildOtpauthUri,
  decodeBase32,
  encodeBase32,
  formatSecretForDisplay,
  generateTotpCode,
  generateTotpSecret,
  totpStep,
  verifyTotpCode,
  TOTP_STEP_SECONDS,
} from '../../src/core/auth/utils/totp';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  resolveMfaEncryptionKey,
} from '../../src/core/auth/utils/mfa-secret-cipher';

/**
 * الثوابت MFA-1..MFA-6 (ARCHITECTURE_INVARIANTS.md §2.12).
 *
 * الخوارزمية هنا مكتوبة بأيدينا بلا حزمة خارجية، فالحارس الحقيقي عليها هو متجهات الاختبار
 * الرسمية في RFC 6238. لو كُسر الحساب يوماً، تفشل هذه المتجهات قبل أن يكتشف مستخدم أن
 * تطبيق المصادقة "بيدي رمز غلط".
 */

// RFC 6238 Appendix B: السر ASCII "12345678901234567890" بـHMAC-SHA1، ثمانية أرقام.
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_BASE32 = encodeBase32(Buffer.from(RFC_SECRET_ASCII, 'ascii'));
const RFC_VECTORS: Array<{ seconds: number; code: string }> = [
  { seconds: 59, code: '94287082' },
  { seconds: 1111111109, code: '07081804' },
  { seconds: 1111111111, code: '14050471' },
  { seconds: 1234567890, code: '89005924' },
  { seconds: 2000000000, code: '69279037' },
  { seconds: 20000000000, code: '65353130' },
];

function runBase32(): void {
  assert.equal(RFC_SECRET_BASE32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'base32 encoding must match the RFC 4648 alphabet');
  assert.equal(decodeBase32(RFC_SECRET_BASE32).toString('ascii'), RFC_SECRET_ASCII, 'decode must invert encode');

  // ما يكتبه الناس يدوياً: مسافات وشُرَط وحروف صغيرة وحشو.
  assert.equal(decodeBase32('gezd gnbv gy3t-qojq').toString('ascii'), '1234567890');
  assert.equal(decodeBase32('GEZDGNBVGY3TQOJQ====').toString('ascii'), '1234567890');
  assert.throws(() => decodeBase32('GEZD1!8'), /INVALID_BASE32_SECRET/, 'an invalid alphabet must be rejected, not silently truncated');

  for (let i = 1; i <= 20; i += 1) {
    const bytes = Buffer.alloc(i, i);
    assert.equal(decodeBase32(encodeBase32(bytes)).toString('hex'), bytes.toString('hex'), `round trip for ${i} bytes`);
  }
}

// MFA-2: الحساب نفسه مطابق للمعيار.
function runRfcVectors(): void {
  for (const vector of RFC_VECTORS) {
    const code = generateTotpCode(RFC_SECRET_BASE32, { atMs: vector.seconds * 1000, digits: 8 });
    assert.equal(code, vector.code, `RFC 6238 vector at T=${vector.seconds}`);
  }
}

// MFA-3: نافذة القبول خطوة واحدة في كل اتجاه — لا أوسع (تخمين أسهل) ولا أضيق (ساعة الهاتف).
function runDriftWindow(): void {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const currentStep = totpStep(now);

  for (const offset of [-1, 0, 1]) {
    const atMs = now + offset * TOTP_STEP_SECONDS * 1000;
    const code = generateTotpCode(secret, { atMs });
    assert.equal(verifyTotpCode(secret, code, { atMs: now }), currentStep + offset, `a code ${offset} step away must be accepted`);
  }

  for (const offset of [-2, 2, 10]) {
    const code = generateTotpCode(secret, { atMs: now + offset * TOTP_STEP_SECONDS * 1000 });
    assert.equal(verifyTotpCode(secret, code, { atMs: now }), null, `a code ${offset} steps away must be rejected`);
  }

  // مدخلات لا تُشبه الرمز أصلاً.
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', null as unknown as string]) {
    assert.equal(verifyTotpCode(secret, bad, { atMs: now }), null, `"${bad}" must not be accepted as a code`);
  }
  // مسافات وشُرَط داخل رمز صحيح تُقبل: الناس ينسخونه من التطبيق بمسافة في النص.
  const spaced = generateTotpCode(secret, { atMs: now });
  assert.equal(verifyTotpCode(secret, `${spaced.slice(0, 3)} ${spaced.slice(3)}`, { atMs: now }), currentStep);

  // سر تالف لا يرمي استثناءً إلى مسار تسجيل الدخول، يرفض فقط.
  assert.equal(verifyTotpCode('!!!not-base32!!!', '123456', { atMs: now }), null);
  assert.equal(verifyTotpCode('', '123456', { atMs: now }), null);
}

// MFA-4: رمزان مختلفان لسرين مختلفين، والسر بطول 160 بت كما يفترض RFC 4226.
function runSecretGeneration(): void {
  const secrets = new Set<string>();
  for (let i = 0; i < 200; i += 1) secrets.add(generateTotpSecret());
  assert.equal(secrets.size, 200, 'every generated secret must be unique');

  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/, 'a 160-bit secret is 32 base32 characters');
  assert.equal(decodeBase32(secret).length, 20);

  const other = generateTotpSecret();
  const atMs = 1_700_000_000_000;
  assert.notEqual(generateTotpCode(secret, { atMs }), generateTotpCode(other, { atMs }), 'different secrets must give different codes');
  assert.equal(verifyTotpCode(other, generateTotpCode(secret, { atMs }), { atMs }), null, 'a code from another secret must not verify');

  assert.equal(formatSecretForDisplay('ABCDEFGH'), 'ABCD EFGH');
}

function runOtpauthUri(): void {
  const uri = buildOtpauthUri({ issuer: 'Z Systems Pro', account: 'owner@example.com', secret: 'ABCDEF' });
  assert.ok(uri.startsWith('otpauth://totp/'), 'authenticator apps only read otpauth:// URIs');
  assert.ok(uri.includes('secret=ABCDEF'));
  assert.ok(uri.includes('algorithm=SHA1'));
  assert.ok(uri.includes('digits=6'));
  assert.ok(uri.includes('period=30'));
  // المسافات والـ@ مرمَّزة، وإلا كسر الرابط في نصف التطبيقات.
  assert.ok(!/otpauth:\/\/totp\/[^?]*[\s@]/.test(uri), 'issuer and account must be percent-encoded');
}

/**
 * MFA-5: سر TOTP لا يمكن تجزئته (التحقق يحتاجه)، فيُشفَّر — والمفتاح في البيئة لا في القاعدة.
 * هذا هو الفرق الكامل بين نسخة احتياطية مسروقة تُمكّن من توليد رموز أي مستخدم، ونسخة لا تُمكّن.
 */
function runSecretCipher(): void {
  const env = { APP_MODE: 'CLOUD_SAAS', SESSION_SECRET: 'a-very-long-session-secret-value' } as unknown as NodeJS.ProcessEnv;
  const secret = generateTotpSecret();
  const stored = encryptMfaSecret(secret, env);

  assert.notEqual(stored, secret);
  assert.ok(!stored.includes(secret), 'the stored value must not contain the secret');
  assert.ok(stored.startsWith('v1:'), 'the stored format must be versioned so it can be migrated later');
  assert.equal(decryptMfaSecret(stored, env), secret);

  // AES-GCM: نفس السر يعطي نصاً مشفَّراً مختلفاً كل مرة (IV عشوائي)، فلا يكشف التخزين تكرار السر.
  assert.notEqual(encryptMfaSecret(secret, env), stored);

  // العبث بالصف في القاعدة يُرفض، لا يُقرأ كسر آخر.
  const parts = stored.split(':');
  const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64url')].join(':');
  assert.throws(() => decryptMfaSecret(tampered, env), /MFA_SECRET_CORRUPT/);
  assert.throws(() => decryptMfaSecret('garbage', env), /MFA_SECRET_CORRUPT/);

  // مفتاح آخر لا يفك التشفير.
  const otherEnv = { APP_MODE: 'CLOUD_SAAS', SESSION_SECRET: 'a-completely-different-secret-val' } as unknown as NodeJS.ProcessEnv;
  assert.throws(() => decryptMfaSecret(stored, otherEnv), /MFA_SECRET_CORRUPT/);

  // فشل آمن في السحابة: بلا سر لا تشفير ولا فك تشفير — لا مفتاح افتراضي معروف للجميع.
  const cloudNoSecret = { APP_MODE: 'CLOUD_SAAS' } as unknown as NodeJS.ProcessEnv;
  assert.throws(() => resolveMfaEncryptionKey(cloudNoSecret), /MFA_ENCRYPTION_KEY_MISSING/);
  assert.throws(() => encryptMfaSecret(secret, cloudNoSecret), /MFA_ENCRYPTION_KEY_MISSING/);
  assert.throws(() => decryptMfaSecret(stored, cloudNoSecret), /MFA_ENCRYPTION_KEY_MISSING/);

  // الديسكتوب/الأوفلاين: مفتاح مشتق من سر التثبيت المحلي (ملف مؤقت هنا)،
  // لا من ثابت مكتوب في الكود.
  const installSecretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-install-secret-'));
  const installSecretPath = path.join(installSecretDir, 'install-secret');
  try {
    const desktopEnv = { APP_MODE: 'SELF_CONTAINED', ZS_INSTALL_SECRET_PATH: installSecretPath } as unknown as NodeJS.ProcessEnv;
    const desktopStored = encryptMfaSecret(secret, desktopEnv);
    assert.equal(decryptMfaSecret(desktopStored, desktopEnv), secret);

    const pilotEnv = { APP_MODE: 'LOCAL_PILOT', ZS_INSTALL_SECRET_PATH: installSecretPath } as unknown as NodeJS.ProcessEnv;
    const pilotStored = encryptMfaSecret(secret, pilotEnv);
    assert.equal(decryptMfaSecret(pilotStored, pilotEnv), secret);
  } finally {
    fs.rmSync(installSecretDir, { recursive: true, force: true });
  }

  // مفتاح مخصَّص له الأولوية على SESSION_SECRET.
  const dedicated = { APP_MODE: 'CLOUD_SAAS', SESSION_SECRET: 'a-very-long-session-secret-value', MFA_ENCRYPTION_KEY: 'dedicated-mfa-key-long-enough-01' } as unknown as NodeJS.ProcessEnv;
  const dedicatedStored = encryptMfaSecret(secret, dedicated);
  assert.equal(decryptMfaSecret(dedicatedStored, dedicated), secret);
  assert.throws(() => decryptMfaSecret(dedicatedStored, env), /MFA_SECRET_CORRUPT/, 'the dedicated key must actually be the key in use');
}

/**
 * MFA-6: رموز الاسترداد. بدونها يفقد المستخدم حسابه بفقد هاتفه، فيصير الأثر الأرجح للميزة هو
 * قفل الحساب لا حمايته. وهي مخزَّنة مجزَّأة لأنها بديل كامل عن العامل الثاني.
 */
function runRecoveryCodes(): void {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10, 'recovery codes must be unique');
  for (const code of codes) {
    assert.match(code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/, 'a readable 64-bit code');
  }

  const hashes = codes.map(hashRecoveryCode);
  assert.equal(new Set(hashes).size, 10);
  for (let i = 0; i < codes.length; i += 1) {
    assert.ok(!hashes[i].includes(normalizeRecoveryCode(codes[i])), 'the stored hash must not contain the code');
    assert.match(hashes[i], /^[0-9a-f]{64}$/);
  }

  // الشكل الذي يكتبه المستخدم (بشُرَط أو بدونها، صغيرة أو كبيرة) يطابق نفس التجزئة.
  const sample = codes[0];
  assert.equal(hashRecoveryCode(sample.toLowerCase()), hashRecoveryCode(sample));
  assert.equal(hashRecoveryCode(sample.replace(/-/g, '')), hashRecoveryCode(sample));
  assert.equal(hashRecoveryCode(` ${sample} `), hashRecoveryCode(sample));
  assert.notEqual(hashRecoveryCode(codes[1]), hashRecoveryCode(codes[0]));
}

(() => {
  runBase32();
  runRfcVectors();
  runDriftWindow();
  runSecretGeneration();
  runOtpauthUri();
  runSecretCipher();
  runRecoveryCodes();

  console.log('totp-mfa.spec: ok');
})();
