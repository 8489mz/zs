/*
WHAT THIS PINS (INV-PASSWORD-ROLE-MINIMUMS): login passwords enforce
role-aware minima at the validation boundary — 8 characters for ordinary
roles, 12 for admin/super_admin — superseding the O35 one-character rule
for login passwords. Manager/cashier quick PIN/passcode rules are a
separate path (assertSecurePasscode, minimum 4) and are unchanged.

WHAT IS DRIVEN: the real assertStrongPassword helper plus the real
UpsertUserDto class-validator floor. Service call sites (users,
session, password-reset, bootstrap, activation, trial provisioning)
pass the target role; the DTO floor is 8 for new passwords while
current/old-password verification stays at 1 so legacy weak accounts
can still authenticate to reach the change flow.

DELEGATED DECISION, FLAGGED FOR REVERSAL: existing accounts are NOT
mass-flagged or force-reset by this package. Bcrypt hashes cannot
reveal password length, so no migration can identify weak accounts;
the rule is prospective-only for newly set or changed passwords. A
future admin-triggered force-reset (must_change_password) is the only
mechanism and is not added here. The platform operator provisioning
gate enforces 12 for the platform super_admin.
*/
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ADMIN_MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  assertSecurePasscode,
  assertStrongPassword,
} from '../../src/core/auth/utils/password-policy';
import { UpsertUserDto } from '../../src/modules/users/dto/upsert-user.dto';

assert.equal(MIN_PASSWORD_LENGTH, 8);
assert.equal(ADMIN_MIN_PASSWORD_LENGTH, 12);

// Default / ordinary roles: 7 rejected, 8 accepted.
assert.throws(() => assertStrongPassword('1234567'), /PASSWORD_TOO_WEAK/);
assert.doesNotThrow(() => assertStrongPassword('12345678'));
assert.doesNotThrow(() => assertStrongPassword('12345678', { role: 'cashier' }));
assert.doesNotThrow(() => assertStrongPassword('12345678', { role: 'unknown-role' }));

// Admin / super_admin: 11 rejected, 12 accepted.
assert.throws(() => assertStrongPassword('12345678901', { role: 'admin' }), /PASSWORD_TOO_WEAK/);
assert.doesNotThrow(() => assertStrongPassword('123456789012', { role: 'admin' }));
assert.throws(() => assertStrongPassword('12345678901', { role: 'super_admin' }), /PASSWORD_TOO_WEAK/);
assert.doesNotThrow(() => assertStrongPassword('123456789012', { role: 'super_admin' }));

// Explicit minLength still overrides (operator provisioning style).
assert.throws(() => assertStrongPassword('12345678', { minLength: 10 }), /PASSWORD_TOO_WEAK/);
assert.doesNotThrow(() => assertStrongPassword('12345', { minLength: 5 }));

// Empty / blank still rejected with the required error, for every role.
assert.throws(() => assertStrongPassword('', { role: 'admin' }), /PASSWORD_REQUIRED/);
assert.throws(() => assertStrongPassword('   ', { role: 'cashier' }), /PASSWORD_REQUIRED/);

// PIN/passcode path unchanged: minimum 4, trivial values rejected.
assert.throws(() => assertSecurePasscode('123'), /PASSCODE_TOO_SHORT/);
assert.doesNotThrow(() => assertSecurePasscode('8492'));

// DTO floor for new passwords is 8 (role-aware 12 is enforced in services).
const shortDto = plainToInstance(UpsertUserDto, {
  username: 'owner',
  phone: '01000000000',
  password: '1234567',
  role: 'cashier',
});
assert.ok(validateSync(shortDto).length > 0, '7-char new password must fail DTO validation');
const okDto = plainToInstance(UpsertUserDto, {
  username: 'owner',
  phone: '01000000000',
  password: '12345678',
  role: 'cashier',
});
assert.equal(validateSync(okDto).length, 0, '8-char new password must pass DTO validation');

console.log('password-policy-role-minimums.spec.ts passed');
