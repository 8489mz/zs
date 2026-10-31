/*
New file: backend/test/critical/freight-portal-pin-hash.spec.ts
Pins INV-FREIGHT-PORTAL-PIN-HASHED: freight customer portal login
verifies the PIN only against the stored bcrypt hash, driving the REAL
MaritimeCustomerPortalService on PGlite.

WHAT THE AUDIT FEARED: the portal accepted the universal default PIN
'1234' for EVERY customer -- even customers with a different PIN
stored -- because the check read `pinCode !== expectedPin &&
pinCode !== '1234'`, and migration 0201 had backfilled '1234' in
plaintext for every active customer with no PIN. Anyone knowing a
customer's phone number (often printed on invoices) could take over
the account and approve quotations, with no brute force needed.

WHAT THIS PINS, driving the real customerLogin / setCustomerPortalPin:
1. Login with the correct hashed PIN succeeds and returns a token
   without leaking any PIN or hash material in the response.
2. Login with '1234' is rejected for a customer with a different PIN
   AND for a customer with no hash set (PORTAL_PIN_NOT_SET).
3. A wrong PIN is rejected.
4. Staff set/rotate works through the real method: the new PIN logs
   in, the old one stops working, '1234' can never be set
   (WEAK_PASSCODE), and a cross-tenant set is rejected.
5. The REAL migration up() on a pre-migration schema drops the
   plaintext column (including backfilled '1234' values), adds the
   hash columns, preserves every other row value, and re-runs cleanly.

Deliberately NOT changed here: the 30-day portal token lifetime, the
magic-link token login, and quote-approval rules.

Harness note: resolvePortalTokenSecret reads SESSION_SECRET from the
environment (fail-closed in cloud); the spec sets a test secret so
login can sign tokens. The portal service's audit collaborator is a
recording stub; the freight service is stubbed because only
approveQuotation uses it.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeCustomerPortalService } from '../../src/modules/maritime-freight/maritime-customer-portal.service';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { migration as pinHashMigration } from '../../src/database/migrations/2040000000273_freight_portal_pin_hash';

const TENANT = 't-freight-pin';
const OTHER_TENANT = 't-freight-pin-other';
const ACCOUNT = 'a-freight-pin';

function appErrorCode(err: unknown): string | undefined {
  return (err as any)?.code;
}

async function main(): Promise<void> {
  process.env.SESSION_SECRET = 'spec-portal-secret-0123456789';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  const pg2 = new PGlite();
  const db2 = new Kysely<Database>({ dialect: new PGliteDialect(pg2) });
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, business_name text);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, company_name text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_active boolean DEFAULT true, metadata text, portal_access_pin text, portal_pin_hash text, portal_pin_salt text, portal_token text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    `);
    await anyDb.insertInto('tenants').values({ id: TENANT, business_name: 'Test Freight Co' }).execute();
    await anyDb.insertInto('tenants').values({ id: OTHER_TENANT, business_name: 'Other Freight Co' }).execute();

    const auditStub = { log: async () => undefined };
    const service = new MaritimeCustomerPortalService(db, auditStub as never, {} as never);

    async function seedCustomer(
      id: number,
      tenantId: string,
      phone: string,
      pin: string | null,
      legacyPin: string | null,
    ): Promise<void> {
      const record = pin ? await createPasswordRecord(pin) : null;
      await anyDb
        .insertInto('customers')
        .values({
          id,
          tenant_id: tenantId,
          account_id: ACCOUNT,
          name: `Customer ${id}`,
          phone,
          company_name: `Company ${id}`,
          address: 'Cairo',
          balance: 0,
          credit_limit: 1000,
          is_active: true,
          portal_access_pin: legacyPin,
          portal_pin_hash: record ? record.hash : null,
          portal_pin_salt: record ? record.salt : null,
          portal_token: `magic-${id}`,
        })
        .execute();
    }

    // Customer 1: hashed PIN '8472', legacy plaintext '1234' still present
    // (as it would be pre-migration) -- the new code must ignore it.
    await seedCustomer(1, TENANT, '01001234567', '8472', '1234');
    // Customer 2: no hash set at all (legacy '1234' only).
    await seedCustomer(2, TENANT, '01007654321', null, '1234');
    // Customer 3: another tenant's customer, hashed PIN '9315'.
    await seedCustomer(3, OTHER_TENANT, '01009998888', '9315', null);

    // Case 1: the correct PIN logs in; the response leaks no PIN/hash.
    const ok = await service.customerLogin({ phone: '01001234567', pinCode: '8472' });
    assert.ok(String(ok.token || '').length > 10);
    assert.equal(Number((ok.customer as any).id), 1);
    assert.equal(JSON.stringify(ok.customer).includes('8472'), false);
    assert.equal(JSON.stringify(ok.customer).includes('portal_pin'), false);

    // Case 2: '1234' is rejected -- different PIN, and no hash set.
    await assert.rejects(
      service.customerLogin({ phone: '01001234567', pinCode: '1234' }),
      (err: unknown) => appErrorCode(err) === 'UNAUTHORIZED_CUSTOMER',
    );
    await assert.rejects(
      service.customerLogin({ phone: '01007654321', pinCode: '1234' }),
      (err: unknown) => appErrorCode(err) === 'PORTAL_PIN_NOT_SET',
    );

    // Case 3: a wrong PIN is rejected.
    await assert.rejects(
      service.customerLogin({ phone: '01001234567', pinCode: '0000' }),
      (err: unknown) => appErrorCode(err) === 'UNAUTHORIZED_CUSTOMER',
    );

    // Case 4: staff set/rotate through the real method.
    const staff = { userId: 7, sessionId: 'spec', username: 'staff', role: 'admin', permissions: ['*'], tenantId: TENANT, accountId: ACCOUNT };
    const setRes = await service.setCustomerPortalPin(staff as never, 2, '5621');
    assert.deepEqual(setRes, { ok: true, customerId: 2 });
    const afterSet = await service.customerLogin({ phone: '01007654321', pinCode: '5621' });
    assert.equal(Number((afterSet.customer as any).id), 2);
    // Rotate: the old PIN stops working, the new one works.
    await service.setCustomerPortalPin(staff as never, 2, '7390');
    await assert.rejects(
      service.customerLogin({ phone: '01007654321', pinCode: '5621' }),
      (err: unknown) => appErrorCode(err) === 'UNAUTHORIZED_CUSTOMER',
    );
    const afterRotate = await service.customerLogin({ phone: '01007654321', pinCode: '7390' });
    assert.equal(Number((afterRotate.customer as any).id), 2);
    // '1234' can never be set again.
    await assert.rejects(
      service.setCustomerPortalPin(staff as never, 2, '1234'),
      (err: unknown) => appErrorCode(err) === 'WEAK_PASSCODE',
    );
    // Cross-tenant set is rejected.
    await assert.rejects(
      service.setCustomerPortalPin(staff as never, 3, '5621'),
      (err: unknown) => appErrorCode(err) === 'CUSTOMER_NOT_FOUND',
    );
    // The stored row holds a hash, never the plaintext PIN.
    const stored = await anyDb.selectFrom('customers').selectAll().where('id', '=', 2).executeTakeFirstOrThrow();
    assert.ok(String(stored.portal_pin_hash).startsWith('$2b$'));
    assert.equal(String(stored.portal_pin_hash).includes('7390'), false);

    // Case 5: the REAL migration on a pre-migration schema (separate DB).
    await pg2.exec(`
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, is_active boolean DEFAULT true, portal_access_pin text, portal_token text);
      CREATE INDEX idx_customers_tenant_phone_pin ON customers (tenant_id, phone, portal_access_pin);
    `);
    const anyDb2 = db2 as any;
    await anyDb2.insertInto('customers').values({ id: 11, tenant_id: TENANT, account_id: ACCOUNT, name: 'Legacy A', phone: '01001112222', is_active: true, portal_access_pin: '1234', portal_token: 'magic-11' }).execute();
    await anyDb2.insertInto('customers').values({ id: 12, tenant_id: TENANT, account_id: ACCOUNT, name: 'Legacy B', phone: '01003334444', is_active: true, portal_access_pin: '9876', portal_token: 'magic-12' }).execute();
    await pinHashMigration.up(db2 as never);
    const cols = await sql<{ column_name: string }>`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'customers'`.execute(db2);
    const colNames = new Set(cols.rows.map((row) => row.column_name));
    assert.equal(colNames.has('portal_access_pin'), false);
    assert.equal(colNames.has('portal_pin_hash'), true);
    assert.equal(colNames.has('portal_pin_salt'), true);
    const kept = await anyDb2.selectFrom('customers').selectAll().orderBy('id', 'asc').execute();
    assert.equal(kept.length, 2);
    assert.equal(kept[0].portal_token, 'magic-11');
    assert.equal(kept[1].portal_token, 'magic-12');
    const idx = await sql<{ indexname: string }>`SELECT indexname FROM pg_indexes WHERE tablename = 'customers'`.execute(db2);
    assert.equal(idx.rows.some((row) => row.indexname === 'idx_customers_tenant_phone_pin'), false);
    // Re-running the migration is a no-op.
    await pinHashMigration.up(db2 as never);
    const kept2 = await anyDb2.selectFrom('customers').selectAll().execute();
    assert.equal(kept2.length, 2);
  } finally {
    await db.destroy();
    await db2.destroy();
  }
}

main()
  .then(() => console.log('freight portal PIN hash checks passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
