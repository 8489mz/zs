/*
 * F4 — POS customer-creation phone validation (trial problem 4).
 *
 * THE GAP: POS "إضافة عميل" created a fake customer ("عميل وهمي
 * للاختبار", phone 01000000000, code C-3065) with no validation at
 * all, then sold to it (Z-261121-16632, 10.00). createCustomer in
 * customer-crud.slice.ts required only `name`; `phone` was trimmed
 * and stored verbatim — never required, never format-checked.
 *
 * THE RULE (this package): customer creation AND update require a
 * phone, and the phone must pass the codebase's established
 * validator, validateAndNormalizePhone (core/utils/phone-utils.ts,
 * the same rule users.service.ts enforces with INVALID_PHONE).
 * The stored phone is the validator's normalized national number
 * (e.g. +201012345678 is stored as 01012345678), so the existing
 * duplicate detection (generatePhoneSearchVariants) keeps working.
 *
 * THE FAKE GUARD: the established format pattern alone accepts
 * 01000000000 (010 + 8 digits), so a second, minimal rule refuses
 * placeholder numbers: a phone whose subscriber digits (everything
 * past the 3-digit trunk prefix) are all identical is refused with
 * CUSTOMER_PHONE_PLACEHOLDER. The codebase already treats
 * 01000000000 / 0000000000 as placeholders — migration
 * 2040000000019 and saas-admin.service.ts rewrite them to the real
 * owner phone instead of keeping them.
 *
 * DUPLICATES STAY ALLOWED (standing user decision 2026-11-06:
 * "Duplicate customer phone: warn but ALLOW"). A duplicate phone
 * still creates the customer and still returns phoneWarning; only
 * the FORMAT + PRESENCE are gated. Case (g) pins that.
 *
 * HOW THIS IS DRIVEN: the real CustomerCrudSlice on PGlite, with
 * its bound seams implemented against the same tables (the
 * findCustomerByPhone seam uses the real
 * generatePhoneSearchVariants, mirroring the production slice;
 * addCustomerOpeningBalance is a no-op because every payload here
 * carries balance 0). Tear down is db.destroy() only.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuditService } from '../../src/core/audit/audit.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { CustomerCrudSlice } from '../../src/modules/partners/partners/customer-crud.slice';
import { generatePhoneSearchVariants } from '../../src/core/utils/phone-utils';

const TENANT = 't-cust-phone';
const ACCOUNT = 'a-cust-phone';

const adminAuth: AuthContext = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['customers'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, customer_type text, price_list_id bigint, store_credit_balance numeric DEFAULT 0, company_name text, tax_number text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
  `);
  await (db as any).insertInto('tenants').values({ id: TENANT }).execute();
  return { pg, db };
}

function buildSlice(db: Kysely<Database>): CustomerCrudSlice {
  const audit = new AuditService(db);
  return new CustomerCrudSlice(db, audit, {
    tenantPredicate: () => sql<boolean>`tenant_id = ${TENANT}`,
    tenantId: () => TENANT,
    tenantFields: () => ({ tenant_id: TENANT, account_id: ACCOUNT }),
    customerNameExists: async (name, _actor, excludeId) => {
      let q = (db as any)
        .selectFrom('customers')
        .select(['id'])
        .where('is_active', '=', true)
        .where(sql`LOWER(name)`, '=', name.toLowerCase())
        .where('tenant_id', '=', TENANT);
      if (excludeId) q = q.where('id', '!=', excludeId);
      const row = await q.executeTakeFirst();
      return Boolean(row);
    },
    findCustomerByPhone: async (phone, _actor, excludeId) => {
      const trimmed = String(phone || '').trim();
      if (!trimmed) return null;
      const variants = generatePhoneSearchVariants(trimmed);
      let q = (db as any)
        .selectFrom('customers')
        .select(['id', 'name', 'phone'])
        .where('is_active', '=', true)
        .where('tenant_id', '=', TENANT)
        .where('phone', 'in', variants);
      if (excludeId) q = q.where('id', '!=', excludeId);
      const row = await q.orderBy('id', 'asc').executeTakeFirst();
      if (!row) return null;
      return { id: Number(row.id), name: row.name, phone: row.phone || '' };
    },
    buildDuplicatePhoneWarning: (existing) => ({
      message: `هذا الهاتف مسجل بالفعل للعميل ${existing.name}`,
      existingCustomer: { id: String(existing.id), name: existing.name, phone: existing.phone },
    }),
    addCustomerOpeningBalance: async () => {},
    listCustomers: async () => {
      const rows = await (db as any)
        .selectFrom('customers')
        .selectAll()
        .where('is_active', '=', true)
        .where('tenant_id', '=', TENANT)
        .execute();
      return { customers: rows };
    },
  });
}

function payload(name: string, phone?: string): any {
  const p: any = { name, creditLimit: 0 };
  if (phone !== undefined) p.phone = phone;
  return p;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

async function storedPhone(db: Kysely<Database>, id: number): Promise<string> {
  const row = await (db as any)
    .selectFrom('customers')
    .select(['phone'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return String(row.phone || '');
}

async function main(): Promise<void> {
  // (a) The trial fake: 01000000000 is refused with the placeholder code.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      await expectCode(
        slice.createCustomer(payload('عميل وهمي للاختبار', '01000000000'), adminAuth),
        'CUSTOMER_PHONE_PLACEHOLDER',
      );
    } finally {
      await db.destroy();
    }
    console.log('  (a) fake 01000000000 refused passed');
  }

  // (b) Missing phone is refused.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      await expectCode(slice.createCustomer(payload('عميل بلا هاتف'), adminAuth), 'CUSTOMER_PHONE_REQUIRED');
    } finally {
      await db.destroy();
    }
    console.log('  (b) missing phone refused passed');
  }

  // (c) Empty-string phone is refused (same as missing, not stored as '').
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      await expectCode(slice.createCustomer(payload('عميل هاتف فارغ', '   '), adminAuth), 'CUSTOMER_PHONE_REQUIRED');
    } finally {
      await db.destroy();
    }
    console.log('  (c) blank phone refused passed');
  }

  // (d) A malformed phone is refused with the established INVALID_PHONE code.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      await expectCode(slice.createCustomer(payload('عميل رقم قصير', '12345'), adminAuth), 'INVALID_PHONE');
    } finally {
      await db.destroy();
    }
    console.log('  (d) malformed phone refused passed');
  }

  // (e) A valid Egyptian mobile is accepted and stored as typed (national form).
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل حقيقي', '01012345678'), adminAuth);
      assert.equal(res.ok, true);
      assert.equal(await storedPhone(db, Number(res.id)), '01012345678');
    } finally {
      await db.destroy();
    }
    console.log('  (e) valid Egyptian mobile accepted passed');
  }

  // (f) The +20 form is accepted and normalized to the national form on store.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل دولي', '+201012345678'), adminAuth);
      assert.equal(res.ok, true);
      assert.equal(await storedPhone(db, Number(res.id)), '01012345678');
    } finally {
      await db.destroy();
    }
    console.log('  (f) +20 form normalized on store passed');
  }

  // (g) STANDING DECISION PIN: a duplicate phone is still ALLOWED —
  // the second customer is created AND the warning is returned.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const first: any = await slice.createCustomer(payload('العميل الأول', '01012345678'), adminAuth);
      assert.equal(first.ok, true);
      const second: any = await slice.createCustomer(payload('العميل الثاني', '01012345678'), adminAuth);
      assert.equal(second.ok, true, 'duplicate phone must still create the customer');
      assert.ok(second.phoneWarning, 'duplicate phone must still return phoneWarning');
      assert.equal(String((second.phoneWarning as any)?.existingCustomer?.name), 'العميل الأول');
      const count = await (db as any)
        .selectFrom('customers')
        .select((eb: any) => eb.fn.countAll().as('count'))
        .where('phone', '=', '01012345678')
        .executeTakeFirstOrThrow();
      assert.equal(Number(count.count), 2, 'both customers with the shared phone must exist');
    } finally {
      await db.destroy();
    }
    console.log('  (g) duplicate phone still allowed with warning passed');
  }

  // (h) updateCustomer to the trial fake is refused the same way.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const created: any = await slice.createCustomer(payload('عميل للتعديل', '01012345678'), adminAuth);
      await expectCode(
        slice.updateCustomer(Number(created.id), payload('عميل للتعديل', '01000000000'), adminAuth),
        'CUSTOMER_PHONE_PLACEHOLDER',
      );
      assert.equal(
        await storedPhone(db, Number(created.id)),
        '01012345678',
        'refused update must not change the stored phone',
      );
    } finally {
      await db.destroy();
    }
    console.log('  (h) update to fake phone refused passed');
  }

  // (i) updateCustomer to a valid new phone is accepted and stored.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const created: any = await slice.createCustomer(payload('عميل للتعديل', '01012345678'), adminAuth);
      const res: any = await slice.updateCustomer(
        Number(created.id),
        payload('عميل للتعديل', '01198765432'),
        adminAuth,
      );
      assert.equal(res.ok, true);
      assert.equal(await storedPhone(db, Number(created.id)), '01198765432');
    } finally {
      await db.destroy();
    }
    console.log('  (i) update to valid phone accepted passed');
  }

  console.log('customer-phone-validation: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
