/*
New file: backend/test/critical/driver-token-invalidation-m14.spec.ts
Pins INV-DRIVER-TOKEN-PIN-INVALIDATION (M14, finding C10), driving the REAL
DeliveryRepsService on PGlite, through the REAL controllers where a
gate is involved.

THE GAP: driver tokens are stateless HMAC with no credential version,
so a PIN change left every token issued under the old PIN valid for
its full 30-day life. Separately, the driver-login rate limiter built
its key from the RAW phone number while the phone matching normalized
(+20 / 0 stripped) — so the same number in three formats got three
separate 5-attempt buckets, and 15 wrong guesses were needed to lock
one number instead of 5.

THE RULE:
- Every PIN change bumps metadata.pin_version on the rep row (driver
  self-service change-pin AND the admin update path AND create starts
  at 0), the fresh token embeds that version, and verifyDriverTokenCore
  rejects any token whose version is older than the stored one.
- Legacy tokens issued before this change carry no version claim and
  read as version 0 — so they stay valid only until the first PIN
  change after this lands, which then invalidates them too.
- The limiter key uses the SAME phone normalization as the matching
  logic (one shared helper), so one phone number is one bucket in any
  format. The limiter stays in-memory only (resets on restart) — that
  is out of scope and deliberately NOT changed here.

WHAT THIS PINS, driving the REAL service + controllers on PGlite:
1. A token issued under the old PIN is rejected (INVALID_DRIVER_TOKEN)
   after a driver self-service PIN change via POST /api/driver-portal/
   change-pin (DriverPortalController, Bearer token as the controller
   derives the driver identity); the fresh token from the change works.
2. Login with the old PIN then fails UNAUTHORIZED_DRIVER; login with
   the new PIN works and its token verifies.
3. An admin-path PIN change (PUT /api/delivery-reps/:id through
   DeliveryRepsController with a real req.authContext) also invalidates
   tokens issued before it; login with the admin-set PIN works.
4. A legacy token signed WITHOUT a version claim verifies while the
   rep has never changed PIN (version 0), and is rejected after that
   rep's PIN is changed by the admin.
5. Limiter: the same phone in +20 / 0 / raw formats shares ONE bucket
   — 5 wrong-PIN attempts across the formats, then the 6th attempt is
   blocked with LOGIN_RATE_LIMITED even with the correct PIN.
6. A different phone gets its own bucket — a wrong PIN for it still
   returns UNAUTHORIZED_DRIVER while the first phone is locked.

NOT pinned here: limiter persistence across restarts (in-memory by
design, out of scope for C10); employee-portal / maritime tokens
(the version claim is driver-only — other portals do not read it).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { DeliveryRepsController } from '../../src/modules/delivery-reps/delivery-reps.controller';
import { DriverPortalController } from '../../src/modules/delivery-reps/driver-portal.controller';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { signPortalToken, PORTAL_TOKEN_TTL_MS } from '../../src/core/auth/utils/portal-token';
import { AppError } from '../../src/common/errors/app-error';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

let checks = 0;
function check(condition: unknown, label: string): void {
  checks += 1;
  assert.ok(condition, label);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  checks += 1;
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

async function main(): Promise<void> {
  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'driver-token-invalidation-m14-secret';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, business_name text, status text, trial_ends_at timestamptz);
      CREATE TABLE tenant_subscriptions (id bigserial PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW(), ends_at timestamptz, grace_ends_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, full_name text, name text, phone text, vehicle_plate text, pin_hash text, pin_salt text, is_van_rep boolean DEFAULT false, van_location_id bigint, permissions jsonb, metadata jsonb NOT NULL DEFAULT '{}', is_active boolean DEFAULT true, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, account_id text, plate_number text, van_location_id bigint, assigned_rep_id bigint);
      CREATE TABLE fleet_vehicle_drivers (id bigserial PRIMARY KEY, tenant_id text, account_id text, vehicle_id bigint, rep_id bigint, shift_name text, is_active boolean DEFAULT true);
    `);

    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await anyDb.insertInto('tenants').values({ id: 't1', slug: 't1', business_name: 'Test Co', status: 'active', trial_ends_at: null }).execute();
    await anyDb.insertInto('tenant_subscriptions').values({ tenant_id: 't1', status: 'active', ends_at: future, grace_ends_at: null }).execute();

    const pin1 = await createPasswordRecord('1234');
    const pin2 = await createPasswordRecord('9753');
    const pin3 = await createPasswordRecord('8642');
    await anyDb.insertInto('delivery_representatives').values([
      { id: 1, tenant_id: 't1', account_id: 'a1', full_name: 'Rep One', name: 'Rep One', phone: '01000000001', vehicle_plate: null, pin_hash: pin1.hash, pin_salt: pin1.salt, is_van_rep: false, van_location_id: null, permissions: null, metadata: {}, is_active: true },
      { id: 2, tenant_id: 't1', account_id: 'a1', full_name: 'Rep Two', name: 'Rep Two', phone: '01000000002', vehicle_plate: null, pin_hash: pin2.hash, pin_salt: pin2.salt, is_van_rep: false, van_location_id: null, permissions: null, metadata: {}, is_active: true },
      { id: 3, tenant_id: 't1', account_id: 'a1', full_name: 'Rep Three', name: 'Rep Three', phone: '01000000003', vehicle_plate: null, pin_hash: pin3.hash, pin_salt: pin3.salt, is_van_rep: false, van_location_id: null, permissions: null, metadata: {}, is_active: true },
    ]).execute();

    const auditStub = { log: async () => undefined };
    const service = new DeliveryRepsService(db, auditStub as never, {} as never, {} as never);
    const driverPortal = new DriverPortalController(service);
    const adminController = new DeliveryRepsController(service);
    const adminActor: AuthContext = {
      userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
      permissions: ['deliveryReps'], tenantId: 't1', accountId: 'a1',
    };
    const adminReq = { authContext: adminActor } as any;

    // --- Case 1+2: driver self-service PIN change invalidates the old token.
    const loginOld = await service.driverLogin({ phone: '01000000001', pinCode: '1234' });
    check(loginOld.mustChangePin === true, 'default PIN still flags mustChangePin');
    const tokenOld = loginOld.token;
    const driverOld = await service.verifyDriverToken(tokenOld);
    check(driverOld.repId === 1, 'old token verifies before the change');

    // The change goes through the real controller: Bearer token in the
    // header, driver identity derived by verifyDriverToken inside.
    const changed = await driverPortal.changePin(`Bearer ${tokenOld}`, { currentPin: '1234', newPin: '5829' });
    check(changed.mustChangePin === false, 'fresh token after change is unflagged');
    check(changed.token !== tokenOld, 'change returns a different token');
    const driverNew = await service.verifyDriverToken(changed.token);
    check(driverNew.repId === 1, 'fresh token verifies after the change');

    // The token issued under the old PIN is now rejected.
    await expectCode(service.verifyDriverToken(tokenOld), 'INVALID_DRIVER_TOKEN');
    // And the controller gate rejects it too (not just the service call).
    await expectCode(driverPortal.getProfile(`Bearer ${tokenOld}`), 'INVALID_DRIVER_TOKEN');

    // Old PIN no longer logs in; new PIN does, and its token verifies.
    await expectCode(service.driverLogin({ phone: '01000000001', pinCode: '1234' }), 'UNAUTHORIZED_DRIVER');
    const loginNew = await service.driverLogin({ phone: '01000000001', pinCode: '5829' });
    check(loginNew.mustChangePin === false, 'login with the new PIN is unflagged');
    const driverNewLogin = await service.verifyDriverToken(loginNew.token);
    check(driverNewLogin.repId === 1, 'token from login with the new PIN verifies');

    // --- Case 3: admin-path PIN change invalidates pre-change tokens.
    const tokenBeforeAdmin = loginNew.token;
    await adminController.update(1, { name: 'Rep One', phone: '01000000001', pinCode: '7391' } as any, adminReq);
    await expectCode(service.verifyDriverToken(tokenBeforeAdmin), 'INVALID_DRIVER_TOKEN');
    await expectCode(service.verifyDriverToken(changed.token), 'INVALID_DRIVER_TOKEN');
    await expectCode(service.driverLogin({ phone: '01000000001', pinCode: '5829' }), 'UNAUTHORIZED_DRIVER');
    const loginAdmin = await service.driverLogin({ phone: '01000000001', pinCode: '7391' });
    const driverAdmin = await service.verifyDriverToken(loginAdmin.token);
    check(driverAdmin.repId === 1, 'token from login with the admin-set PIN verifies');

    // --- Case 4: legacy token (no version claim) at version 0, then invalidated.
    const legacyToken = signPortalToken(
      { repId: 3, tenantId: 't1', accountId: 'a1', name: 'Rep Three', phone: '01000000003' },
      PORTAL_TOKEN_TTL_MS,
    );
    const legacyDriver = await service.verifyDriverToken(legacyToken);
    check(legacyDriver.repId === 3, 'legacy token without a version claim verifies at version 0');
    await adminController.update(3, { name: 'Rep Three', phone: '01000000003', pinCode: '2958' } as any, adminReq);
    await expectCode(service.verifyDriverToken(legacyToken), 'INVALID_DRIVER_TOKEN');
    const loginRep3 = await service.driverLogin({ phone: '01000000003', pinCode: '2958' });
    check(loginRep3.token.length > 20, 'rep 3 logs in with the admin-set PIN');

    // --- Case 5: limiter — one phone, three formats, ONE bucket.
    // Rep 2 (01000000002) has never had a failed login; 5 wrong-PIN
    // attempts spread across +20 / 0 / raw formats, then the 6th is
    // blocked even with the correct PIN.
    const wrongPin = '1111';
    await expectCode(service.driverLogin({ phone: '+20 100 000 0002', pinCode: wrongPin }), 'UNAUTHORIZED_DRIVER');
    await expectCode(service.driverLogin({ phone: '01000000002', pinCode: wrongPin }), 'UNAUTHORIZED_DRIVER');
    await expectCode(service.driverLogin({ phone: '1000000002', pinCode: wrongPin }), 'UNAUTHORIZED_DRIVER');
    await expectCode(service.driverLogin({ phone: '+201000000002', pinCode: wrongPin }), 'UNAUTHORIZED_DRIVER');
    await expectCode(service.driverLogin({ phone: '01000000002', pinCode: wrongPin }), 'UNAUTHORIZED_DRIVER');
    await expectCode(service.driverLogin({ phone: '1000000002', pinCode: '9753' }), 'LOGIN_RATE_LIMITED');
    await expectCode(service.driverLogin({ phone: '01000000002', pinCode: wrongPin }), 'LOGIN_RATE_LIMITED');

    // --- Case 6: a different phone gets its own bucket.
    // Rep 1 is locked out of rep 2's bucket: a wrong PIN still answers
    // UNAUTHORIZED_DRIVER, not LOGIN_RATE_LIMITED.
    await expectCode(service.driverLogin({ phone: '01000000001', pinCode: wrongPin }), 'UNAUTHORIZED_DRIVER');

    console.log(`driver-token-invalidation-m14.spec: ok (${checks} checks)`);
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
