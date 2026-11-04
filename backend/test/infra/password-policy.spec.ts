import assert from 'node:assert/strict';
import { assertStrongPassword, assertSecurePasscode, MIN_PASSWORD_LENGTH } from '../../src/core/auth/utils/password-policy';

assert.throws(() => assertStrongPassword(''), /PASSWORD_REQUIRED/);
assert.throws(() => assertStrongPassword('   '), /PASSWORD_REQUIRED/);
assert.throws(() => assertStrongPassword('1'), /PASSWORD_TOO_WEAK/);
assert.throws(() => assertStrongPassword('a'), /PASSWORD_TOO_WEAK/);
assert.throws(() => assertStrongPassword('1234567'), /PASSWORD_TOO_WEAK/);
assert.doesNotThrow(() => assertStrongPassword('12345678'));
assert.equal(MIN_PASSWORD_LENGTH, 8);

// Test assertSecurePasscode
assert.throws(() => assertSecurePasscode(''), /PASSCODE_REQUIRED/);
assert.throws(() => assertSecurePasscode('123'), /PASSCODE_TOO_SHORT/);
// Trivial repeated digits
assert.throws(() => assertSecurePasscode('0000'), /WEAK_PASSCODE/);
assert.throws(() => assertSecurePasscode('1111'), /WEAK_PASSCODE/);
assert.throws(() => assertSecurePasscode('999999'), /WEAK_PASSCODE/);
// Trivial sequential or dictionary
assert.throws(() => assertSecurePasscode('1234'), /WEAK_PASSCODE/);
assert.throws(() => assertSecurePasscode('4321'), /WEAK_PASSCODE/);
assert.throws(() => assertSecurePasscode('123456'), /WEAK_PASSCODE/);
assert.throws(() => assertSecurePasscode('password'), /WEAK_PASSCODE/);
// Phone suffix matching
assert.throws(() => assertSecurePasscode('5678', { phone: '01012345678' }), /WEAK_PASSCODE/);
assert.throws(() => assertSecurePasscode('345678', { phone: '01012345678' }), /WEAK_PASSCODE/);

// Valid PINs and Passwords
assert.doesNotThrow(() => assertSecurePasscode('8492'));
assert.doesNotThrow(() => assertSecurePasscode('938472'));
assert.doesNotThrow(() => assertSecurePasscode('StrongPass@2026'));
assert.doesNotThrow(() => assertSecurePasscode('Ahmed#8391', { phone: '01012345678' }));

console.log('password-policy.spec.ts passed');

