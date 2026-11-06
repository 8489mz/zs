/*
New file: backend/test/critical/portal-default-pin-change.spec.ts
Pins the forced default-PIN change (INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE).

THE GAP: the employee portal login page advertised the public default PIN
("1234") and an employee still on it walked straight into the dashboard.
There was no detection, no change endpoint and no gate.

THE RULE: login detects a still-default PIN with a real password check
(verifyPassword('1234', pin_hash)) and reports mustChangePin; the portal
serves no data while the flag is set (PIN_CHANGE_REQUIRED, 403); the
employee changes the PIN through POST /api/hr/portal/pin/change, which
verifies the current PIN, rejects weak replacements (short, 0000, 1234, or
unchanged) and returns a fresh, unflagged token. The flag is re-derived
from the live stored hash on every verifyToken, never trusted from the
token. The default value is never returned or displayed.

WHAT THIS PINS, driving the REAL EmployeePortalService on PGlite:
- login with the default PIN returns mustChangePin true; verifyToken on
  that token also reports true; assertPinChanged throws PIN_CHANGE_REQUIRED.
- changePin with a wrong current PIN fails INVALID_PIN; with a new PIN of
  '1234', '0000' or '12' fails WEAK_PIN.
- changePin ('1234' -> '5678') succeeds and returns a fresh token with
  mustChangePin false; login with '5678' reports false; login with the old
  '1234' now fails INVALID_PIN; verifyToken on the fresh token reports
  false and assertPinChanged passes.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { EmployeePortalService } from '../../src/modules/hr/employee-portal.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { AppError } from '../../src/common/errors/app-error';

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

function expectCodeSync(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.code === code);
}

async function main(): Promise<void> {
  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'test-portal-secret-1234567890';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, business_name text, status text, trial_ends_at timestamptz);
      CREATE TABLE tenant_subscriptions (id bigserial PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW(), ends_at timestamptz, grace_ends_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_positions (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_no text, display_name text, first_name text, last_name text, pin_hash text, pin_salt text, hire_date date, status text, branch_id bigint, department_id bigint, position_id bigint);
      CREATE TABLE hr_employee_contacts (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, value text, contact_type text);
    `);

    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();
    await anyDb.insertInto('tenants').values({ id: 't1', slug: 't1', business_name: 'Test Co', status: 'active', trial_ends_at: null }).execute();
    await anyDb.insertInto('tenant_subscriptions').values({ tenant_id: 't1', status: 'active', ends_at: future, grace_ends_at: null }).execute();
    await anyDb.insertInto('branches').values({ id: 1, tenant_id: 't1', name: 'Main' }).execute();

    const pin = await createPasswordRecord('1234');
    await anyDb.insertInto('hr_employees').values({
      id: 1, tenant_id: 't1', account_id: 'a1', employee_no: '001',
      display_name: 'Emp One', first_name: 'Emp', last_name: 'One',
      pin_hash: pin.hash, pin_salt: pin.salt, hire_date: '2020-01-01',
      status: 'active', branch_id: 1, department_id: null, position_id: null,
    }).execute();
    await anyDb.insertInto('hr_employee_contacts').values({ tenant_id: 't1', employee_id: 1, value: '01000000001', contact_type: 'phone' }).execute();

    const service = new EmployeePortalService(db);

    // 1. Login with the default PIN flags the session.
    const loginRes = await service.login({ identifier: '01000000001', pinCode: '1234' });
    assert.equal(loginRes.mustChangePin, true);
    assert.ok(loginRes.token.length > 20);

    // 2. The flag is re-derived live from the stored hash, not the token.
    const flaggedUser = await service.verifyToken(`Bearer ${loginRes.token}`);
    assert.equal(flaggedUser.mustChangePin, true);

    // 3. No portal data is served while flagged.
    expectCodeSync(() => service.assertPinChanged(flaggedUser), 'PIN_CHANGE_REQUIRED');

    // 4. The change endpoint rejects a wrong current PIN and weak replacements.
    await expectCode(service.changePin(flaggedUser, { currentPin: '9999', newPin: '5678' }), 'INVALID_PIN');
    await expectCode(service.changePin(flaggedUser, { currentPin: '1234', newPin: '1234' }), 'WEAK_PIN');
    await expectCode(service.changePin(flaggedUser, { currentPin: '1234', newPin: '0000' }), 'WEAK_PIN');
    await expectCode(service.changePin(flaggedUser, { currentPin: '1234', newPin: '12' }), 'WEAK_PIN');

    // 5. A real change succeeds and returns a fresh, unflagged token.
    const changed = await service.changePin(flaggedUser, { currentPin: '1234', newPin: '5678' });
    assert.equal(changed.mustChangePin, false);
    assert.ok(changed.token.length > 20);
    assert.notEqual(changed.token, loginRes.token);

    // 6. The old default PIN no longer works; the new one logs in unflagged.
    await expectCode(service.login({ identifier: '01000000001', pinCode: '1234' }), 'INVALID_PIN');
    const loginRes2 = await service.login({ identifier: '01000000001', pinCode: '5678' });
    assert.equal(loginRes2.mustChangePin, false);

    // 7. The fresh token verifies unflagged and the gate passes.
    const unflaggedUser = await service.verifyToken(`Bearer ${changed.token}`);
    assert.equal(unflaggedUser.mustChangePin, false);
    service.assertPinChanged(unflaggedUser);

    console.log('portal-default-pin-change.spec: ok');
  } finally {
    await db.destroy();
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
