import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { GUARDS_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { SessionsController } from '../../src/modules/sessions/sessions.controller';
import {
  ConfirmPasswordResetDto,
  RequestPasswordResetDto,
  ValidatePasswordResetTokenDto,
} from '../../src/modules/sessions/dto/password-reset.dto';
import { buildPasswordResetUrl } from '../../src/modules/sessions/password-reset.service';
import {
  classifyPasswordResetToken,
  generatePasswordResetToken,
  hashPasswordResetToken,
  passwordResetTokenTtlMs,
} from '../../src/core/auth/utils/password-reset-token';

function assertValid<T>(cls: new () => T, payload: unknown, label: string): void {
  const errors = validateSync(plainToInstance(cls, payload) as object);
  assert.equal(errors.length, 0, `${label}: expected a valid payload, got ${errors.length} error(s)`);
}

function assertInvalid<T>(cls: new () => T, payload: unknown, label: string): void {
  const errors = validateSync(plainToInstance(cls, payload) as object);
  assert.ok(errors.length > 0, `${label}: expected an invalid payload`);
}

/**
 * الرمز لا يُخزَّن أبداً — المخزَّن تجزئته. لو عاد أحد يوماً وخزّن الرمز الخام "لتسهيل الدعم"،
 * تصير نسخة احتياطية مسروقة كافية لتغيير كلمة مرور أي مالك منشأة.
 */
function runTokenHashing(): void {
  const token = generatePasswordResetToken();
  const hash = hashPasswordResetToken(token);

  assert.notEqual(hash, token, 'الرمز المخزَّن يجب ألّا يكون الرمز نفسه');
  assert.ok(!hash.includes(token), 'التجزئة يجب ألّا تحتوي الرمز');
  assert.match(hash, /^[0-9a-f]{64}$/, 'التجزئة يجب أن تكون SHA-256 بصيغة hex');
  assert.equal(hashPasswordResetToken(token), hash, 'التجزئة يجب أن تكون حتمية ليعمل البحث بالفهرس');
  assert.notEqual(hashPasswordResetToken(generatePasswordResetToken()), hash, 'رمزان مختلفان لا ينتجان نفس التجزئة');

  // إنتروبيا كاملة: بلا هذا يصبح تخمين الرمز مساراً واقعياً مهما بلغت صرامة بقية المسار.
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/, 'الرمز يجب أن يكون base64url بطول 256 بت');
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i += 1) seen.add(generatePasswordResetToken());
  assert.equal(seen.size, 1000, 'كل رمز يجب أن يكون فريداً');
}

/** رمز مستهلك أو ملغى أو منتهٍ لا يفتح الباب — هذه هي القاعدة التي تجعله رمز استعادة لا مفتاحاً دائماً. */
function runTokenLifecycle(): void {
  const now = new Date('2026-09-23T12:00:00.000Z');
  const future = new Date(now.getTime() + 60_000);
  const past = new Date(now.getTime() - 1);
  const base = { user_id: 1, tenant_id: 't1', expires_at: future, used_at: null, invalidated_at: null };

  assert.equal(classifyPasswordResetToken(base, now), 'usable');
  assert.equal(classifyPasswordResetToken({ ...base, used_at: now }, now), 'used');
  assert.equal(classifyPasswordResetToken({ ...base, invalidated_at: now }, now), 'invalidated');
  assert.equal(classifyPasswordResetToken({ ...base, expires_at: past }, now), 'expired');
  assert.equal(classifyPasswordResetToken({ ...base, expires_at: now }, now), 'expired', 'اللحظة نفسها منتهية لا صالحة');
  assert.equal(classifyPasswordResetToken(undefined, now), 'unknown');

  // التواريخ تصل من القاعدة كنصوص أحياناً (حسب السائق) — لا يجوز أن يقلب هذا الحكم.
  assert.equal(classifyPasswordResetToken({ ...base, expires_at: past.toISOString() }, now), 'expired');
  assert.equal(classifyPasswordResetToken({ ...base, expires_at: future.toISOString() }, now), 'usable');
}

function runTtl(): void {
  assert.equal(passwordResetTokenTtlMs({} as NodeJS.ProcessEnv), 30 * 60 * 1000, 'الافتراضي 30 دقيقة');
  assert.equal(passwordResetTokenTtlMs({ PASSWORD_RESET_TOKEN_TTL_MINUTES: '15' } as any), 15 * 60 * 1000);
  assert.equal(passwordResetTokenTtlMs({ PASSWORD_RESET_TOKEN_TTL_MINUTES: 'abc' } as any), 30 * 60 * 1000, 'قيمة غير رقمية تعود للافتراضي');
  assert.equal(passwordResetTokenTtlMs({ PASSWORD_RESET_TOKEN_TTL_MINUTES: '0' } as any), 30 * 60 * 1000, 'صفر يعود للافتراضي');
  assert.equal(passwordResetTokenTtlMs({ PASSWORD_RESET_TOKEN_TTL_MINUTES: '99999' } as any), 120 * 60 * 1000, 'العمر مقصوص عند ساعتين');
}

/**
 * الرمز في الـfragment لا في الـquery: الـfragment لا يصل للسيرفر إطلاقاً، فلا يدخل سجلات
 * nginx ولا ترويسة Referer. نفس سبب `#t=` في رابط تتبع الطلب (SF-1).
 */
function runResetUrl(): void {
  const token = 'abc-123_XYZ';
  const url = buildPasswordResetUrl('https://ignored.example', token, { APP_PUBLIC_URL: 'https://app.example.com' } as any);
  assert.equal(url, `https://app.example.com/reset-password#token=${encodeURIComponent(token)}`);
  assert.ok(!String(url).includes('?token='), 'الرمز يجب ألّا يظهر في الـquery string');

  assert.equal(
    buildPasswordResetUrl('https://attacker.example.com', token, {} as any),
    null,
    'بلا APP_PUBLIC_URL لا يجوز إرسال رابط إعادة تعيين إلى عنوان يحدده الطلب',
  );
  assert.equal(
    buildPasswordResetUrl('http://127.0.0.1:5173', token, { APP_MODE: 'SELF_CONTAINED' } as any),
    `http://127.0.0.1:5173/reset-password#token=${encodeURIComponent(token)}`,
    'نسخة الديسكتوب المحلية تسمح فقط بعنوان loopback',
  );
  assert.equal(buildPasswordResetUrl('https://attacker.example.com', token, { APP_MODE: 'SELF_CONTAINED' } as any), null);

  assert.equal(
    buildPasswordResetUrl('https://app.example.com/', token, { APP_PUBLIC_URL: 'https://app.example.com/' } as any),
    `https://app.example.com/reset-password#token=${encodeURIComponent(token)}`,
    'الشرطة الأخيرة لا تُكرَّر',
  );

  assert.equal(buildPasswordResetUrl(undefined, token, {} as any), null, 'بلا أصل صالح لا يُبنى رابط نصف صحيح');
  assert.equal(buildPasswordResetUrl('not-a-url', token, {} as any), null);
}

/** مسارات الاستعادة عامة عمداً (من نسي كلمته لا يملك جلسة) — لكن بقية مسارات الجلسة تبقى محروسة. */
function runRouteShape(): void {
  const proto = SessionsController.prototype as any;
  const publicMethods = ['requestPasswordReset', 'validatePasswordResetToken', 'confirmPasswordReset'];

  for (const method of publicMethods) {
    assert.equal(typeof proto[method], 'function', `SessionsController.${method} مفقود`);
    const guards = (Reflect.getMetadata(GUARDS_METADATA, proto[method]) || []).map((g: Function) => g?.name || '');
    assert.ok(!guards.includes(SessionAuthGuard.name), `${method} يجب أن يبقى عاماً بلا SessionAuthGuard`);
    assert.equal(Reflect.getMetadata(METHOD_METADATA, proto[method]), 1, `${method} يجب أن يكون POST`);
  }

  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.requestPasswordReset), 'password-reset/request');
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.validatePasswordResetToken), 'password-reset/validate');
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.confirmPasswordReset), 'password-reset/confirm');
  assert.equal(Reflect.getMetadata(PATH_METADATA, SessionsController), 'api/auth');

  // الجار المحروس: لو سقط الحارس عن تغيير كلمة المرور صار أي مجهول يغيّرها.
  const changePasswordGuards = (Reflect.getMetadata(GUARDS_METADATA, proto.changePassword) || []).map((g: Function) => g?.name || '');
  assert.ok(changePasswordGuards.includes(SessionAuthGuard.name), 'change-password يجب أن يبقى خلف SessionAuthGuard');
}

function runDtoValidation(): void {
  assertValid(RequestPasswordResetDto, { email: 'owner@example.com' }, 'request');
  assertValid(RequestPasswordResetDto, { email: 'owner@example.com', companyCode: 'my-store' }, 'request+company');
  assertInvalid(RequestPasswordResetDto, { email: 'not-an-email' }, 'request/bad email');
  assertInvalid(RequestPasswordResetDto, {}, 'request/missing email');

  const token = generatePasswordResetToken();
  assertValid(ValidatePasswordResetTokenDto, { token }, 'validate');
  assertInvalid(ValidatePasswordResetTokenDto, { token: 'short' }, 'validate/short token');
  assertInvalid(ValidatePasswordResetTokenDto, {}, 'validate/missing token');

  assertValid(ConfirmPasswordResetDto, { token, newPassword: 'NewPass12' }, 'confirm');
  assertInvalid(ConfirmPasswordResetDto, { token, newPassword: '1234567' }, 'confirm/short password');
  assertInvalid(ConfirmPasswordResetDto, { token, newPassword: '' }, 'confirm/empty password');
  assertInvalid(ConfirmPasswordResetDto, { token: 'short', newPassword: 'x' }, 'confirm/short token');
}

(() => {
  runTokenHashing();
  runTokenLifecycle();
  runTtl();
  runResetUrl();
  runRouteShape();
  runDtoValidation();

  console.log('password-reset.spec: ok');
})();
