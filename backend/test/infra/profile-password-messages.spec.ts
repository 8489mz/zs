/*
WHAT THIS PINS (INV-PROFILE-PASSWORD-ROLE-MESSAGES): on the profile page
(/api/users/me/password) the messages about the new-password minimum
disagreed with the enforced policy (INV-PASSWORD-ROLE-MINIMUMS: 8 for
ordinary roles, 12 for admin/super_admin). Live 2026-11-13, super_admin
Mahmoud Zakaria: a 1-char password was answered "كلمة المرور الجديدة يجب
ألا تقل عن 8 أحرف." (the DTO @MinLength(8) floor rendered through the
validation pipe), and an 8-char password was answered "كلمة المرور
مطلوبة." (PASSWORD_TOO_WEAK thrown with an English message, then
mistranslated by the static code map) — while only 12 chars were ever
accepted. The policy (8 / 12) is UNCHANGED; only the messages are fixed:
the role-aware policy error names the real minimum, the code-map
fallback no longer says "required" for a too-short password, and the
DTO floor messages no longer state 8.

WHAT IS DRIVEN: the real assertStrongPassword, the real
translateErrorMessageFromCode / mapToHttpException chain (the exact
path that builds the HTTP response body), and the real users +
sessions ChangePasswordDto class-validator floors.
*/
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ADMIN_MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  assertStrongPassword,
} from '../../src/core/auth/utils/password-policy';
import { translateErrorMessageFromCode } from '../../src/common/errors/error-translations';
import { mapToHttpException } from '../../src/common/mappers/error.mapper';
import { AppError } from '../../src/common/errors/app-error';
import { ChangePasswordDto as UsersChangePasswordDto } from '../../src/modules/users/dto/change-password.dto';
import { ChangePasswordDto as SessionsChangePasswordDto } from '../../src/modules/sessions/dto/change-password.dto';

// Policy itself is unchanged: 8 ordinary, 12 admin/super_admin.
assert.equal(MIN_PASSWORD_LENGTH, 8);
assert.equal(ADMIN_MIN_PASSWORD_LENGTH, 12);
assert.doesNotThrow(() => assertStrongPassword('12345678', { role: 'cashier' }));
assert.doesNotThrow(() => assertStrongPassword('123456789012', { role: 'super_admin' }));

// RED case 1 — the reported live case: an 8-char password for a
// super_admin is rejected, and the thrown error must name the real
// minimum (12), not the generic "required" text.
let adminError: AppError | null = null;
try {
  assertStrongPassword('12345678', { role: 'super_admin' });
} catch (err) {
  adminError = err as AppError;
}
assert.ok(adminError, '8-char password must be rejected for super_admin');
assert.equal(adminError!.code, 'PASSWORD_TOO_WEAK');
assert.equal(adminError!.details?.minLength, 12);
assert.ok(
  adminError!.message.includes('12'),
  `policy error must name the 12-char minimum, got: ${adminError!.message}`,
);
assert.notEqual(adminError!.message, 'كلمة المرور مطلوبة.');

// RED case 2 — the same error through the real HTTP error path must
// still name 12 in the response body (this is what the profile page
// renders in its red banner).
const httpError = mapToHttpException(adminError!);
const body = httpError.getResponse() as { message?: unknown; code?: unknown };
assert.equal(body.code, 'PASSWORD_TOO_WEAK');
assert.ok(
  typeof body.message === 'string' && body.message.includes('12'),
  `HTTP response message must name the 12-char minimum, got: ${body.message}`,
);
assert.notEqual(body.message, 'كلمة المرور مطلوبة.');

// RED case 3 — the static code-map fallback must never again translate
// a too-weak password as "required" (it hid the real reason).
const mapped = translateErrorMessageFromCode(
  'PASSWORD_TOO_WEAK',
  'Password must be at least 12 characters long',
  400,
);
assert.notEqual(mapped, 'كلمة المرور مطلوبة.');
assert.ok(mapped.includes('قصير'), `fallback must say the password is too short, got: ${mapped}`);

// RED case 4 — the DTO floor (8) stays, but its message must no longer
// claim 8: a 7-char new password for the profile endpoint must not be
// answered with any "8" text.
function checkDtoFloor(Dto: new () => object, name: string): void {
  const dto = plainToInstance(Dto, {
    oldPassword: 'CurrentPass123!',
    currentPassword: 'CurrentPass123!',
    newPassword: '1234567',
  });
  const errors = validateSync(dto);
  assert.ok(errors.length > 0, `${name} DTO must still reject a 7-char new password`);
  const rendered = errors.flatMap((e) => Object.values(e.constraints ?? {}));
  assert.ok(rendered.length > 0, `${name} DTO must render a message`);
  for (const message of rendered) {
    assert.ok(!message.includes('8'), `${name} DTO message must not claim 8, got: ${message}`);
  }
  const okDto = plainToInstance(Dto, {
    oldPassword: 'CurrentPass123!',
    currentPassword: 'CurrentPass123!',
    newPassword: '12345678',
  });
  assert.equal(validateSync(okDto).length, 0, `${name} DTO must still accept an 8-char new password`);
}
checkDtoFloor(UsersChangePasswordDto, 'users');
checkDtoFloor(SessionsChangePasswordDto, 'sessions');

// Empty / blank still rejected with the required error, for every role.
assert.throws(() => assertStrongPassword('', { role: 'admin' }), /PASSWORD_REQUIRED/);
assert.throws(() => assertStrongPassword('   ', { role: 'cashier' }), /PASSWORD_REQUIRED/);

console.log('profile-password-messages.spec.ts passed');
