import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChangePasswordDto } from '../../src/modules/sessions/dto/change-password.dto';
import { UpsertUserDto } from '../../src/modules/users/dto/upsert-user.dto';
import { MIN_PASSWORD_LENGTH } from '../../src/core/auth/utils/password-policy';

function assertValid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  if (errors.length) throw new Error(`Expected valid payload, got ${errors.length} errors`);
}

function assertInvalid<T>(cls: new () => T, payload: unknown): void {
  const instance = plainToInstance(cls, payload);
  const errors = validateSync(instance as object);
  if (!errors.length) throw new Error('Expected invalid payload');
}

function run(): void {
  const strongPassword = 'VeryStrongPass123!';

  assertValid(UpsertUserDto, {
    username: 'owner',
    phone: '01000000000',
    password: strongPassword,
    role: 'admin',
  });

  assertValid(UpsertUserDto, {
    username: 'owner',
    phone: '01000000000',
    role: 'admin',
  });

  assertInvalid(UpsertUserDto, {
    username: 'cashier1',
    phone: '01000000001',
    password: '1',
    role: 'cashier',
  });

  assertInvalid(UpsertUserDto, {
    username: 'admin1',
    phone: '01000000002',
    password: 'a',
    role: 'admin',
  });

  // Mobile-first identity (09589654): a user record is invalid without a phone number.
  assertInvalid(UpsertUserDto, {
    username: 'owner',
    password: strongPassword,
    role: 'admin',
  });

  assertInvalid(UpsertUserDto, {
    username: 'owner',
    phone: '0100',
    password: strongPassword,
    role: 'admin',
  });

  assertValid(ChangePasswordDto, {
    currentPassword: 'CurrentPass123!',
    newPassword: strongPassword,
  });

  assertInvalid(ChangePasswordDto, {
    currentPassword: 'CurrentPass123!',
    newPassword: '1',
  });

  assertInvalid(ChangePasswordDto, {
    currentPassword: 'CurrentPass123!',
    newPassword: '1234567',
  });

  assertInvalid(ChangePasswordDto, {
    currentPassword: '',
    newPassword: strongPassword,
  });

  assertInvalid(ChangePasswordDto, {
    currentPassword: 'CurrentPass123!',
    newPassword: '',
  });

  if (MIN_PASSWORD_LENGTH !== 8) {
    throw new Error('Password policy minimum should be 8 characters for login passwords');
  }

  process.stdout.write('auth.dto.spec.ts passed\n');
}

try {
  run();
} catch (error: unknown) {
  process.stderr.write(`auth.dto.spec.ts failed: ${String(error)}\n`);
  process.exit(1);
}
