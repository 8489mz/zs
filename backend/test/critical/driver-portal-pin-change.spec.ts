/*
New file: backend/test/critical/driver-portal-pin-change.spec.ts
Pins the forced default-PIN change on first driver-portal login
(INV-DRIVER-PIN-FIRST-LOGIN-CHANGE, PD10).

THE GAP: driverLogin returned { token, rep } with no mustChangePin flag,
and no change-PIN route existed at all — a search for mustChangePin /
changePin / forcePin in modules/delivery-reps/ returned zero hits. A rep
still on the public default PIN 1234 could log in as a driver forever,
and a new PIN could never be 1234 (password-policy lists it among the
trivial patterns), so the default could never be forced off. Anyone who
knew a rep's phone + the known default PIN could log in as that rep, see
customer phones/addresses, and mark that rep's orders delivered.

THE RULE (mirrors the staff portal, INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE):
login detects a still-default PIN with a real password check
(verifyPassword('1234', pin_hash)) and reports mustChangePin; the rep
changes the PIN through POST /api/driver-portal/change-pin
(driverChangePin), which verifies the current PIN, rejects weak
replacements through the shared assertSecurePasscode policy, rejects a
replacement equal to the current PIN, and returns a fresh, unflagged
token. The default value is never returned or displayed.

WHAT THIS PINS, driving the REAL DeliveryRepsService on PGlite:
- login with the default PIN returns mustChangePin true.
- changePin with a wrong current PIN fails INVALID_PIN; with a new PIN
  of '1234' or '0000' fails WEAK_PASSCODE (trivial pattern); with '12'
  fails PASSCODE_TOO_SHORT; with '7777' fails WEAK_PASSCODE.
- changePin ('1234' -> '5829') succeeds and returns a fresh token with
  mustChangePin false; login with '5829' reports false; login with the
  old '1234' now fails UNAUTHORIZED_DRIVER; a second change reusing the
  current PIN ('5829' -> '5829') fails WEAK_PIN.
- The driver identity for changePin comes from the real token path
  (verifyDriverToken on the login token), as the controller does.
- assertDriverPinChanged refuses portal data (PIN_CHANGE_REQUIRED)
  while the rep is still on the default PIN, and passes once the PIN
  is changed — the enforcement is server-side, not frontend-only.

NOT pinned here: token invalidation on PIN change — the driver token is
a stateless HMAC with no version, so an old token stays valid until it
expires; that is M14's package.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { AppError } from '../../src/common/errors/app-error';

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

async function main(): Promise<void> {
  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'driver-pin-change-spec-secret-1234';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, business_name text, status text, trial_ends_at timestamptz);
      CREATE TABLE tenant_subscriptions (id bigserial PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW(), ends_at timestamptz, grace_ends_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, full_name text, name text, phone text, vehicle_plate text, pin_hash text, pin_salt text, is_van_rep boolean DEFAULT false, van_location_id bigint, permissions text, is_active boolean DEFAULT true);
    `);

    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await anyDb.insertInto('tenants').values({ id: 't1', slug: 't1', business_name: 'Test Co', status: 'active', trial_ends_at: null }).execute();
    await anyDb.insertInto('tenant_subscriptions').values({ tenant_id: 't1', status: 'active', ends_at: future, grace_ends_at: null }).execute();

    const pin = await createPasswordRecord('1234');
    await anyDb.insertInto('delivery_representatives').values({
      id: 1, tenant_id: 't1', account_id: 'a1', full_name: 'Rep One', name: 'Rep One',
      phone: '01000000001', vehicle_plate: null, pin_hash: pin.hash, pin_salt: pin.salt,
      is_van_rep: false, van_location_id: null, permissions: null, is_active: true,
    }).execute();

    const service = new DeliveryRepsService(db, {} as never, {} as never, {} as never);

    // 1. Login with the default PIN flags the session.
    const loginRes = await service.driverLogin({ phone: '01000000001', pinCode: '1234' });
    assert.equal(loginRes.mustChangePin, true);
    assert.ok(loginRes.token.length > 20);

    // The driver identity for the change call comes from the real token,
    // exactly as the controller derives it.
    const driver = await service.verifyDriverToken(loginRes.token);
    assert.equal(driver.repId, 1);
    assert.equal(driver.tenantId, 't1');

    // 7. Server-side guard: no portal data is served while the rep is
    // still on the default PIN — the frontend screen alone is not the
    // enforcement; a direct API call with the login token is refused.
    await expectCode(service.assertDriverPinChanged(driver), 'PIN_CHANGE_REQUIRED');

    // 2. The change endpoint rejects a wrong current PIN.
    await expectCode(service.driverChangePin(driver, { currentPin: '9999', newPin: '5829' }), 'INVALID_PIN');

    // 3. A new PIN of '1234' or '0000' is refused as a trivial pattern.
    await expectCode(service.driverChangePin(driver, { currentPin: '1234', newPin: '1234' }), 'WEAK_PASSCODE');
    await expectCode(service.driverChangePin(driver, { currentPin: '1234', newPin: '0000' }), 'WEAK_PASSCODE');

    // 4. Weak replacements are refused per assertSecurePasscode.
    await expectCode(service.driverChangePin(driver, { currentPin: '1234', newPin: '12' }), 'PASSCODE_TOO_SHORT');
    await expectCode(service.driverChangePin(driver, { currentPin: '1234', newPin: '7777' }), 'WEAK_PASSCODE');

    // 5. A real change succeeds and returns a fresh, unflagged token.
    const changed = await service.driverChangePin(driver, { currentPin: '1234', newPin: '5829' });
    assert.equal(changed.mustChangePin, false);
    assert.ok(changed.token.length > 20);
    assert.notEqual(changed.token, loginRes.token);

    // A replacement equal to the current PIN is refused.
    const driver2 = await service.verifyDriverToken(changed.token);
    await expectCode(service.driverChangePin(driver2, { currentPin: '5829', newPin: '5829' }), 'WEAK_PIN');

    // 7 (continued). Once the PIN is changed the guard passes — even
    // for a session derived from the pre-change token.
    await service.assertDriverPinChanged(driver2);

    // 6. The old PIN no longer works; the new one logs in unflagged.
    await expectCode(service.driverLogin({ phone: '01000000001', pinCode: '1234' }), 'UNAUTHORIZED_DRIVER');
    const loginRes2 = await service.driverLogin({ phone: '01000000001', pinCode: '5829' });
    assert.equal(loginRes2.mustChangePin, false);

    console.log('driver-portal-pin-change.spec: ok');
  } finally {
    await db.destroy();
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
