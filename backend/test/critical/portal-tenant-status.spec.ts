/*
New file: backend/test/critical/portal-tenant-status.spec.ts
Pins INV-PORTAL-TENANT-STATUS-ENFORCED: all four portal surfaces
enforce the same tenant-status rules as the main session path, driving
the REAL verifiers and login paths on PGlite.

WHAT THE AUDIT FEARED: suspending or expiring a tenant locked its staff
out of the main app, but drivers, employees and freight customers kept
full portal access on 30-day stateless tokens, including cash sales and
collections, because no portal verifier or login path ever read the
tenants table for status.

WHAT THIS PINS:
1. A suspended tenant: fresh portal login rejected on all four
   surfaces, and token verification rejected on all four verifiers.
2. An expired tenant and an expired trial are rejected the same way;
   an active tenant without any live subscription is rejected too
   (the same effective rule as the main session path).
3. An active tenant with a live subscription, a trial inside its
   window, a subscription inside its grace window, and the platform
   tenant are all unaffected.
4. The check is strictly read-only: a rejected trial stays 'trial'
   and a rejected subscription-less tenant stays 'active' in the
   database (the status-flip writes stay with the main session path).
5. A cached denial survives the tenant row disappearing (the 60s
   tenant-allowed cache pattern, shared with the main session path).
6. Finish-and-settle: verifyDriverTokenForSettlement reports
   tenantSuspended=true for a suspended tenant (the settle service
   methods themselves enforce open-trip + rep ownership) and false
   for an active tenant; the strict verifier still throws.

Deliberately NOT driven here: the controller wiring of the two settle
handlers to verifyDriverTokenForSettlement (two one-line call sites,
verified by inspection); live HTTP end-to-end; the subscription
status-flip writes (main-session path, unchanged).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { PORTAL_TOKEN_TTL_MS, signPortalToken } from '../../src/core/auth/utils/portal-token';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { EmployeePortalService } from '../../src/modules/hr/employee-portal.service';
import { MobileAttendanceService } from '../../src/modules/hr/mobile-attendance.service';
import { MaritimeCustomerPortalService } from '../../src/modules/maritime-freight/maritime-customer-portal.service';

const PIN = '4321';
const ACCOUNT = 'a-portal-status';

const T = {
  active: 't-active',
  suspended: 't-suspended',
  expired: 't-expired',
  trialExpired: 't-trial-expired',
  trialOk: 't-trial-ok',
  noSub: 't-no-sub',
  grace: 't-grace',
  platform: 'zs',
};

async function main(): Promise<void> {
  // Harness note: resolvePortalTokenSecret reads SESSION_SECRET from the
  // environment (see freight-portal-pin-hash.spec.ts); a test secret is
  // set for this process only and restored afterwards.
  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'portal-tenant-status-test-secret-32';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, business_name text, status text, trial_ends_at timestamptz);
      CREATE TABLE tenant_subscriptions (id bigserial PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW(), ends_at timestamptz, grace_ends_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, is_active boolean DEFAULT true, pin_hash text, pin_salt text, metadata jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, latitude numeric, longitude numeric, geofence_radius_meters numeric);
      CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_positions (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_no text, display_name text, first_name text, last_name text, pin_hash text, pin_salt text, mobile_punch_enabled boolean DEFAULT true, hire_date date, status text, branch_id bigint, department_id bigint, position_id bigint);
      CREATE TABLE hr_employee_contacts (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, value text, contact_type text);
      CREATE TABLE hr_attendance_records (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, work_date date, check_in_at timestamptz, check_out_at timestamptz, distance_meters numeric);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, company_name text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_active boolean DEFAULT true, metadata text, portal_pin_hash text, portal_pin_salt text, portal_token text);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    `);

    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();
    const past = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    await anyDb.insertInto('tenants').values([
      { id: T.active, slug: 'active', business_name: 'Active', status: 'active', trial_ends_at: null },
      { id: T.suspended, slug: 'suspended', business_name: 'Suspended', status: 'suspended', trial_ends_at: null },
      { id: T.expired, slug: 'expired', business_name: 'Expired', status: 'expired', trial_ends_at: null },
      { id: T.trialExpired, slug: 'trial-exp', business_name: 'TrialExp', status: 'trial', trial_ends_at: past },
      { id: T.trialOk, slug: 'trial-ok', business_name: 'TrialOk', status: 'trial', trial_ends_at: future },
      { id: T.noSub, slug: 'nosub', business_name: 'NoSub', status: 'active', trial_ends_at: null },
      { id: T.grace, slug: 'grace', business_name: 'Grace', status: 'active', trial_ends_at: null },
      { id: T.platform, slug: 'zs', business_name: 'Platform', status: 'suspended', trial_ends_at: null },
    ]).execute();
    await anyDb.insertInto('tenant_subscriptions').values([
      { tenant_id: T.active, status: 'active', ends_at: future, grace_ends_at: null },
      { tenant_id: T.suspended, status: 'active', ends_at: future, grace_ends_at: null },
      { tenant_id: T.grace, status: 'active', ends_at: past, grace_ends_at: future },
      { tenant_id: T.platform, status: 'active', ends_at: future, grace_ends_at: null },
    ]).execute();

    const pin = await createPasswordRecord(PIN);
    async function seedPerson(tenantId: string, n: number, phone: string): Promise<void> {
      await anyDb.insertInto('delivery_representatives').values({ id: n, tenant_id: tenantId, account_id: ACCOUNT, name: `Rep ${n}`, phone, is_active: true, pin_hash: pin.hash, pin_salt: pin.salt }).execute();
      await anyDb.insertInto('branches').values({ id: n, tenant_id: tenantId, name: 'Main' }).execute();
      await anyDb.insertInto('hr_employees').values({ id: n, tenant_id: tenantId, account_id: ACCOUNT, employee_no: `EMP-${n}`, display_name: `Emp ${n}`, first_name: 'Emp', last_name: String(n), pin_hash: pin.hash, pin_salt: pin.salt, hire_date: '2020-01-01', status: 'active', branch_id: n, department_id: null, position_id: null }).execute();
      await anyDb.insertInto('hr_employee_contacts').values({ tenant_id: tenantId, employee_id: n, value: phone, contact_type: 'phone' }).execute();
      await anyDb.insertInto('customers').values({ id: n, tenant_id: tenantId, account_id: ACCOUNT, name: `Customer ${n}`, phone, company_name: '', address: '', is_active: true, portal_pin_hash: pin.hash, portal_pin_salt: pin.salt, portal_token: `magic-${n}` }).execute();
    }
    // Distinct phones per tenant: the login paths match across tenants
    // by phone when no company scope is given.
    await seedPerson(T.active, 1, '01000000001');
    await seedPerson(T.suspended, 2, '01000000002');
    await seedPerson(T.expired, 3, '01000000003');
    await seedPerson(T.trialExpired, 4, '01000000004');
    await seedPerson(T.trialOk, 5, '01000000005');
    await seedPerson(T.noSub, 6, '01000000006');
    await seedPerson(T.grace, 7, '01000000007');
    await seedPerson(T.platform, 8, '01000000008');

    const auditStub = { log: async () => undefined };
    const driverService = new DeliveryRepsService(db, auditStub as never, {} as never, {} as never);
    const employeeService = new EmployeePortalService(db);
    const mobileService = new MobileAttendanceService(db);
    const freightService = new MaritimeCustomerPortalService(db, auditStub as never, {} as never);
    // Fresh instances for the login cases: each service holds its own
    // 60s tenant-allowed cache, and a cached denial reports the generic
    // TENANT_NOT_ALLOWED (the main-session path behaves the same). The
    // login assertions below pin the SPECIFIC code from a fresh read,
    // so they must not reuse an instance that already cached the denial.
    const driverLoginService = new DeliveryRepsService(db, auditStub as never, {} as never, {} as never);
    const employeeLoginService = new EmployeePortalService(db);
    const mobileLoginService = new MobileAttendanceService(db);
    const freightLoginService = new MaritimeCustomerPortalService(db, auditStub as never, {} as never);
    const freightMagicService = new MaritimeCustomerPortalService(db, auditStub as never, {} as never);

    function driverToken(n: number, tenantId: string): string {
      return signPortalToken({ repId: n, tenantId, accountId: ACCOUNT }, PORTAL_TOKEN_TTL_MS);
    }
    function employeeToken(n: number, tenantId: string): string {
      return signPortalToken({ employeeId: n, tenantId, accountId: ACCOUNT }, PORTAL_TOKEN_TTL_MS);
    }
    function freightToken(n: number, tenantId: string): string {
      return signPortalToken({ customerId: n, tenantId, accountId: ACCOUNT }, PORTAL_TOKEN_TTL_MS);
    }
    const codeIs = (code: string) => (err: any) => err && err.code === code && err.statusCode === 401;

    // 1. Suspended tenant: every verifier rejects.
    await assert.rejects(driverService.verifyDriverToken(driverToken(2, T.suspended)), codeIs('TENANT_SUSPENDED'));
    await assert.rejects(employeeService.verifyToken(employeeToken(2, T.suspended)), codeIs('TENANT_SUSPENDED'));
    await assert.rejects(mobileService.verifyToken(employeeToken(2, T.suspended)), codeIs('TENANT_SUSPENDED'));
    await assert.rejects(freightService.verifyCustomerToken(freightToken(2, T.suspended)), codeIs('TENANT_SUSPENDED'));

    // 2. Suspended tenant: every fresh login rejects, including the magic link.
    await assert.rejects(driverLoginService.driverLogin({ phone: '01000000002', pinCode: PIN }), codeIs('TENANT_SUSPENDED'));
    await assert.rejects(employeeLoginService.login({ identifier: '01000000002', pinCode: PIN }), codeIs('TENANT_SUSPENDED'));
    await assert.rejects(mobileLoginService.employeeLogin({ phone: '01000000002', pinCode: PIN }), codeIs('TENANT_SUSPENDED'));
    await assert.rejects(freightLoginService.customerLogin({ phone: '01000000002', pinCode: PIN }), codeIs('TENANT_SUSPENDED'));
    await assert.rejects(freightMagicService.customerTokenLogin('magic-2'), codeIs('TENANT_SUSPENDED'));

    // 3. Expired, expired-trial, and active-without-subscription reject too.
    await assert.rejects(driverService.verifyDriverToken(driverToken(3, T.expired)), codeIs('TENANT_EXPIRED'));
    await assert.rejects(driverService.verifyDriverToken(driverToken(4, T.trialExpired)), codeIs('TENANT_TRIAL_EXPIRED'));
    await assert.rejects(driverService.verifyDriverToken(driverToken(6, T.noSub)), codeIs('TENANT_EXPIRED'));
    await assert.rejects(driverLoginService.driverLogin({ phone: '01000000003', pinCode: PIN }), codeIs('TENANT_EXPIRED'));

    // 4. Unaffected: active + subscription, trial in-window, grace
    // window, and the platform tenant all verify and log in.
    const okDriver = await driverService.verifyDriverToken(driverToken(1, T.active));
    assert.equal(okDriver.repId, 1);
    await employeeService.verifyToken(employeeToken(1, T.active));
    await mobileService.verifyToken(employeeToken(1, T.active));
    await freightService.verifyCustomerToken(freightToken(1, T.active));
    await driverService.verifyDriverToken(driverToken(5, T.trialOk));
    await driverService.verifyDriverToken(driverToken(7, T.grace));
    await driverService.verifyDriverToken(driverToken(8, T.platform));
    const okLogin = await driverService.driverLogin({ phone: '01000000001', pinCode: PIN });
    assert.ok(okLogin.token);
    const okEmpLogin = await employeeService.login({ identifier: '01000000001', pinCode: PIN });
    assert.ok(okEmpLogin.token);
    const okMobileLogin = await mobileService.employeeLogin({ phone: '01000000001', pinCode: PIN });
    assert.ok(okMobileLogin.token);
    const okFreightLogin = await freightService.customerLogin({ phone: '01000000001', pinCode: PIN });
    assert.ok(okFreightLogin.token);

    // 5. The check is read-only: rejected rows keep their status.
    const trialRow: any = await anyDb.selectFrom('tenants').select('status').where('id', '=', T.trialExpired).executeTakeFirstOrThrow();
    assert.equal(trialRow.status, 'trial');
    const noSubRow: any = await anyDb.selectFrom('tenants').select('status').where('id', '=', T.noSub).executeTakeFirstOrThrow();
    assert.equal(noSubRow.status, 'active');

    // 6. Cached denial survives the tenant row disappearing.
    await anyDb.deleteFrom('tenants').where('id', '=', T.suspended).execute();
    await assert.rejects(driverService.verifyDriverToken(driverToken(2, T.suspended)), codeIs('TENANT_NOT_ALLOWED'));

    // 7. Finish-and-settle surface: suspended reports true, active false.
    const settleSuspended = await driverService.verifyDriverTokenForSettlement(driverToken(2, T.suspended));
    assert.equal(settleSuspended.tenantSuspended, true);
    assert.equal(settleSuspended.repId, 2);
    const settleActive = await driverService.verifyDriverTokenForSettlement(driverToken(1, T.active));
    assert.equal(settleActive.tenantSuspended, false);

    console.log('portal tenant status checks passed');
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
