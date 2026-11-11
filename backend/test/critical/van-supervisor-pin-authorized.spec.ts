/*
 * Van supervisor PIN via the shared manager-approval rule
 * (INV-VAN-SUPERVISOR-PIN-AUTHORIZED / INV-SPIRIT-MANAGER-APPROVAL-SHARED).
 *
 * THE BUG: verifySupervisorPin verified the supervisor PIN by PLAINTEXT
 * comparison — users.pin / pin_hash === input, SQL
 * (pin = input or pin_hash = input), delivery_representatives.pin_hash
 * === input, and a settings.managerPin plaintext fallback that then
 * attributed the approval to the FIRST supervisor by id (false
 * attribution). A bcrypt hash can never match a plaintext comparison,
 * so hashed PINs could never verify.
 *
 * THE RULE: verification now goes through the one shared rule,
 * authorizeManagerSecret — the shared manager PIN from settings
 * (bcrypt via verifyPassword; a legacy plaintext stored value verifies
 * once then hashes in place) or the login password of an ACTIVE admin /
 * super_admin. Its MANAGER_AUTH_INVALID is translated back to
 * INVALID_SUPERVISOR_PIN (403) so callers keep their behavior, and
 * account-mode self-approval still throws MAKER_CHECKER_SELF_APPROVAL.
 *
 * HARNESS: the real VanSalesService.verifySupervisorPin on ONE shared
 * PGlite database (one instance keeps the peak bounded while sibling
 * batch agents run specs concurrently). Cases are isolated by distinct
 * tenants (settings are per tenant). The fraud radar is stubbed
 * capturing, so the suspicion events are asserted, not the radar's
 * own storage. Bcrypt fixtures are built with the production helpers
 * (hashManagerPin / createPasswordRecord), never hand-rolled.
 *
 * LIMITS (recorded, not fixed here):
 * - PIN mode carries no attribution: the shared PIN belongs to no
 *   single user, so supervisorId is undefined and a PIN-approved
 *   settle records settled_by / supervisor_id NULL (and the settlement
 *   journal created_by / posted_by NULL — insertPostedJournal maps a
 *   non-positive id to null, so nothing FK-fails). The old "first
 *   supervisor by id" attribution was false and is gone.
 * - A rep's own PERSONAL PIN no longer yields MAKER_CHECKER_SELF_APPROVAL:
 *   it is simply a wrong PIN (INVALID_SUPERVISOR_PIN). Self-approval is
 *   only attributable when the rep's own ADMIN login password is used.
 * - A legacy plaintext managerPin verifies once only when stored
 *   JSON-quoted (the format the settings writer produces); a bare
 *   numeric value parses as a number in authorizeManagerSecret's
 *   getManagerPin and is treated as absent (pre-existing shared-rule
 *   behavior, not introduced here).
 * - No end-to-end HTTP or live-Postgres run here: the controller call
 *   site and the settle/sale/collection/expense paths are covered by
 *   the migrated regression specs (van-self-settle-pin-required,
 *   van-field-noncash-evidence); the live-Postgres e2e suites still
 *   carry plaintext PIN fixtures and need migration when run live.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { hashManagerPin, isBcryptHash } from '../../src/common/utils/manager-approval';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const ACCOUNT = 'a1';
const MANAGER_PIN = '4321';
const ADMIN_PASSWORD = 'adminpw1';
const REP_ADMIN_PASSWORD = 'rep-admin-pw';
const LEGACY_PIN = '5678';

const T_PIN = 't-pin';
const T_PLAIN_SUP = 't-plain-sup';
const T_SELF = 't-self';
const T_LEGACY = 't-legacy';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, account_id text, username text, display_name text, phone text, role text, pin text, pin_hash text, password_hash text, password_salt text, permissions_json text, is_active boolean DEFAULT true);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, pin_hash text, vehicle_plate text, van_location_id bigint, employee_id bigint, national_id text, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  const managerHash = await hashManagerPin(MANAGER_PIN);
  const adminRecord = await createPasswordRecord(ADMIN_PASSWORD);
  const repAdminRecord = await createPasswordRecord(REP_ADMIN_PASSWORD);

  // T_PIN: bcrypt manager PIN + an admin with a bcrypt login password.
  // The supervisor (id 2) holds no password; the rep's own login
  // (id 7, phone = rep phone) still carries his old PLAINTEXT pin
  // '1111' — the bug's regression fixture: it must never approve.
  await anyDb.insertInto('settings').values({ tenant_id: T_PIN, key: 'managerPin', value: JSON.stringify(managerHash) }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: T_PIN, account_id: ACCOUNT, username: 'admin', display_name: 'Admin', phone: '5550009', role: 'admin', pin: null, pin_hash: null, password_hash: adminRecord.hash, password_salt: adminRecord.salt, permissions_json: null, is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: T_PIN, account_id: ACCOUNT, username: 'sup', display_name: 'Supervisor', phone: '5550002', role: 'supervisor', pin: null, pin_hash: null, password_hash: '', password_salt: '', permissions_json: null, is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 7, tenant_id: T_PIN, account_id: ACCOUNT, username: '5550001', display_name: 'Rep 4', phone: '5550001', role: 'rep', pin: '1111', pin_hash: null, password_hash: '', password_salt: '', permissions_json: null, is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 4, tenant_id: T_PIN, account_id: ACCOUNT, name: 'Rep 4',
    phone: '5550001', pin_hash: '1111', vehicle_plate: null, van_location_id: 10,
    employee_id: null, national_id: null,
  }).execute();

  // T_PLAIN_SUP: the supervisor's PIN lives ONLY as plaintext
  // users.pin — no managerPin setting, no admin passwords.
  await anyDb.insertInto('users').values({ id: 12, tenant_id: T_PLAIN_SUP, account_id: ACCOUNT, username: 'sup', display_name: 'Supervisor', phone: '5550002', role: 'supervisor', pin: MANAGER_PIN, pin_hash: null, password_hash: '', password_salt: '', permissions_json: null, is_active: true }).execute();

  // T_SELF: the rep's own login IS an admin (his own credential), plus
  // a different admin as the control.
  await anyDb.insertInto('users').values({ id: 21, tenant_id: T_SELF, account_id: ACCOUNT, username: 'admin', display_name: 'Admin', phone: '5550009', role: 'admin', pin: null, pin_hash: null, password_hash: adminRecord.hash, password_salt: adminRecord.salt, permissions_json: null, is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 27, tenant_id: T_SELF, account_id: ACCOUNT, username: '5550001', display_name: 'Rep 4', phone: '5550001', role: 'admin', pin: null, pin_hash: null, password_hash: repAdminRecord.hash, password_salt: repAdminRecord.salt, permissions_json: null, is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 14, tenant_id: T_SELF, account_id: ACCOUNT, name: 'Rep 4',
    phone: '5550001', pin_hash: null, vehicle_plate: null, van_location_id: 10,
    employee_id: null, national_id: null,
  }).execute();

  // T_LEGACY: the manager PIN stored as JSON-quoted PLAINTEXT, the
  // format the settings writer produces for a pre-hash tenant.
  await anyDb.insertInto('settings').values({ tenant_id: T_LEGACY, key: 'managerPin', value: JSON.stringify(LEGACY_PIN) }).execute();
  await anyDb.insertInto('users').values({ id: 31, tenant_id: T_LEGACY, account_id: ACCOUNT, username: 'sys', display_name: 'System', phone: null, role: 'admin', pin: null, pin_hash: null, password_hash: '', password_salt: '', permissions_json: null, is_active: true }).execute();
}

function buildService(db: Kysely<Database>, events: unknown[]): any {
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  service.vanFraudRadarService = {
    recordSuspicionEvent: async (event: unknown) => {
      events.push(event);
    },
  };
  return service;
}

function errorCode(error: unknown): string {
  return String((error as any)?.code || '');
}

function errorStatus(error: unknown): number {
  return Number((error as any)?.statusCode || (error as any)?.status || 0);
}

async function settingValue(db: Kysely<Database>, tenantId: string): Promise<string | null> {
  const row = await (db as any)
    .selectFrom('settings')
    .select(['value'])
    .where('tenant_id', '=', tenantId)
    .where('key', '=', 'managerPin')
    .executeTakeFirst();
  return row ? String(row.value) : null;
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    await seed(db);
    const events: any[] = [];
    const service = buildService(db, events);

    // (1) A valid manager PIN (bcrypt-hashed setting) approves — the
    // exact input a bcrypt hash could never satisfy under the old
    // plaintext comparison. PIN mode carries no attribution.
    {
      const result = await service.verifySupervisorPin(T_PIN, MANAGER_PIN, 4, db, ACCOUNT);
      assert.equal(result.approved, true, 'the bcrypt manager PIN approves');
      assert.equal(result.supervisorId, undefined, 'PIN mode attributes the approval to no user');
      assert.equal(result.supervisorName, 'اعتماد المدير', 'PIN mode names the shared approval');
      assert.equal(result.supervisorRole, 'supervisor', 'PIN mode reports the supervisor role');
      console.log('  (1) bcrypt manager PIN approves without attribution passed');
    }

    // (2) A valid admin login password approves WITH attribution.
    {
      const result = await service.verifySupervisorPin(T_PIN, ADMIN_PASSWORD, 4, db, ACCOUNT);
      assert.equal(result.approved, true, 'the admin password approves');
      assert.equal(Number(result.supervisorId), 1, 'account mode attributes the approval to the admin');
      assert.equal(result.supervisorName, 'Admin', 'account mode names the admin');
      assert.equal(result.supervisorRole, 'admin', 'account mode reports the admin role');
      console.log('  (2) admin password approves with attribution passed');
    }

    // (3) A wrong PIN fails closed with INVALID_SUPERVISOR_PIN (403),
    // and the invalid-PIN suspicion event is recorded.
    {
      const before = events.length;
      await assert.rejects(
        () => service.verifySupervisorPin(T_PIN, '9999', 4, db, ACCOUNT),
        (error: unknown) => errorCode(error) === 'INVALID_SUPERVISOR_PIN' && errorStatus(error) === 403,
        'a wrong PIN must fail closed with INVALID_SUPERVISOR_PIN (403)',
      );
      assert.equal(events.length, before + 1, 'exactly one suspicion event is recorded');
      assert.equal(events[events.length - 1].eventCode, 'VAN_SUSPICION_INVALID_PIN', 'the event is the invalid-PIN suspicion');
      console.log('  (3) wrong PIN fails closed with INVALID_SUPERVISOR_PIN passed');
    }

    // (4a) A stored PLAINTEXT users.pin equal to the input does NOT
    // approve — the regression pinning the bug (the old code compared
    // pin = input in SQL, so '4321' approved here).
    {
      await assert.rejects(
        () => service.verifySupervisorPin(T_PLAIN_SUP, MANAGER_PIN, null, db, ACCOUNT),
        (error: unknown) => errorCode(error) === 'INVALID_SUPERVISOR_PIN' && errorStatus(error) === 403,
        'a plaintext users.pin must never approve',
      );
      console.log('  (4a) plaintext users.pin does not approve passed');
    }

    // (4b) The rep's own plaintext PIN — in users.pin AND in
    // delivery_representatives.pin_hash — does NOT approve either,
    // and it is a wrong PIN now, not self-approval: no credential of
    // his is attributable through the shared rule.
    {
      const before = events.length;
      await assert.rejects(
        () => service.verifySupervisorPin(T_PIN, '1111', 4, db, ACCOUNT),
        (error: unknown) => errorCode(error) === 'INVALID_SUPERVISOR_PIN' && errorStatus(error) === 403,
        'the rep’s own plaintext PIN must fail as a wrong PIN',
      );
      assert.equal(events[events.length - 1].eventCode, 'VAN_SUSPICION_INVALID_PIN', 'the rep PIN attempt records an invalid-PIN event, not self-approval');
      assert.equal(events.length, before + 1, 'exactly one suspicion event is recorded');
      console.log('  (4b) rep’s own plaintext PIN does not approve passed');
    }

    // (5) The rep's own ADMIN login password IS attributable — using
    // it to approve his own operation is refused as self-approval
    // (403), with the self-approval suspicion event. The control
    // proves the refusal is maker-checker, not a broken password
    // path: a different admin's password still approves.
    {
      const before = events.length;
      await assert.rejects(
        () => service.verifySupervisorPin(T_SELF, REP_ADMIN_PASSWORD, 14, db, ACCOUNT),
        (error: unknown) => errorCode(error) === 'MAKER_CHECKER_SELF_APPROVAL' && errorStatus(error) === 403,
        'the rep’s own admin credential must be refused as self-approval',
      );
      assert.equal(events.length, before + 1, 'exactly one suspicion event is recorded');
      assert.equal(events[events.length - 1].eventCode, 'VAN_SUSPICION_SELF_APPROVAL', 'the event is the self-approval suspicion');
      const control = await service.verifySupervisorPin(T_SELF, ADMIN_PASSWORD, 14, db, ACCOUNT);
      assert.equal(control.approved, true, 'another admin’s password still approves');
      assert.equal(Number(control.supervisorId), 21, 'the control approval attributes to the other admin');
      console.log('  (5) rep’s own admin credential refused as self-approval passed');
    }

    // (6) A legacy plaintext managerPin (JSON-quoted, the settings
    // writer's format) verifies once, then hashes in place on the
    // same handle — and the migrated hash verifies the second time.
    {
      const before = await settingValue(db, T_LEGACY);
      assert.equal(before, JSON.stringify(LEGACY_PIN), 'the legacy PIN starts as quoted plaintext');
      const first = await service.verifySupervisorPin(T_LEGACY, LEGACY_PIN, null, db, ACCOUNT);
      assert.equal(first.approved, true, 'the legacy plaintext PIN verifies once');
      const after = await settingValue(db, T_LEGACY);
      assert.ok(after && isBcryptHash(JSON.parse(after)), 'the stored value is a bcrypt hash after first success');
      const second = await service.verifySupervisorPin(T_LEGACY, LEGACY_PIN, null, db, ACCOUNT);
      assert.equal(second.approved, true, 'the migrated hash verifies the second time');
      console.log('  (6) legacy plaintext managerPin migrates to hash on first success passed');
    }

    // (7) The accountId argument is optional: a direct caller that
    // passes none still verifies, from the tenant's own user account.
    {
      const result = await service.verifySupervisorPin(T_PIN, MANAGER_PIN, 4, db);
      assert.equal(result.approved, true, 'verification works without an explicit accountId');
      console.log('  (7) verification without an explicit accountId passed');
    }

    // (8) An empty PIN is not an error: it returns unapproved, the
    // same as before (callers treat the missing secret as absent).
    {
      const result = await service.verifySupervisorPin(T_PIN, '', 4, db, ACCOUNT);
      assert.equal(result.approved, false, 'an empty PIN returns unapproved');
      const blank = await service.verifySupervisorPin(T_PIN, '   ', 4, db, ACCOUNT);
      assert.equal(blank.approved, false, 'a blank PIN returns unapproved');
      console.log('  (8) empty PIN returns unapproved passed');
    }

    console.log('van-supervisor-pin-authorized: all cases passed');
  } finally {
    await db.destroy();
  }
  void pg;
}

main()
  .then(async () => {
    console.log('van-supervisor-pin-authorized: all cases passed');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
