/*
 * F4 — POS customer phone: WARN, not block (user-approved 2026-11-27).
 *
 * THE HISTORY: POS "إضافة عميل" once created a fake customer ("عميل
 * وهمي للاختبار", phone 01000000000, code C-3065) with no validation
 * at all, then sold to it. The first fix (2026-11-22) made the phone
 * REQUIRED: create/update threw CUSTOMER_PHONE_REQUIRED,
 * INVALID_PHONE, or CUSTOMER_PHONE_PLACEHOLDER (400) on a missing,
 * malformed, or placeholder phone. That gate blocked real work:
 * POS quick-create by name only could not save, and editing an
 * existing customer could not be saved until a valid phone was
 * entered.
 *
 * THE RULE (this package): the phone NEVER blocks. The same checks
 * still run — validateAndNormalizePhone (core/utils/phone-utils.ts,
 * the same rule users.service.ts enforces) plus the minimal
 * placeholder rule (subscriber digits past the 3-digit trunk prefix
 * all identical, e.g. 01000000000) — but a failure only produces a
 * phoneWarning in the response; the customer is still created /
 * updated.
 *
 * CREATE: empty phone → allowed, stored as '' (customers.phone is
 * NOT NULL), phoneWarning code CUSTOMER_PHONE_MISSING. Invalid or
 * placeholder phone → allowed, the raw trimmed value is stored (no
 * data is lost), phoneWarning code CUSTOMER_PHONE_INVALID /
 * CUSTOMER_PHONE_PLACEHOLDER. Valid phone → stored normalized
 * (e.g. +201012345678 → 01012345678), no warning.
 *
 * UPDATE: empty / missing phone in the payload → the existing stored
 * phone is kept, no warning, no block. Invalid / placeholder phone
 * in the payload → the existing stored phone is kept (an invalid
 * value is never written over a good one), phoneWarning returned.
 * Valid new phone → stored normalized.
 *
 * DUPLICATES STAY ALLOWED (standing user decision 2026-11-06:
 * "Duplicate customer phone: warn but ALLOW"). A duplicate phone
 * still creates the customer and still returns phoneWarning; only
 * the FORMAT + PRESENCE are warned about, never uniqueness. Cases
 * (g) and (m) pin that. When a format warning and a duplicate
 * warning would both apply, the format warning wins (it describes
 * the value just stored). No duplicate lookup runs for an empty
 * phone — case (n) pins that two phone-less customers coexist
 * without a duplicate warning.
 *
 * SCOPE: the change lives in customer-crud.slice.ts only. The shared
 * validateAndNormalizePhone is untouched (users.service.ts keeps
 * enforcing INVALID_PHONE). The frontend needs no change: it already
 * renders phoneWarning.message (CustomerForm warning box + toast).
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

function warningCode(res: any): string | undefined {
  return (res?.phoneWarning as any)?.code as string | undefined;
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
  // (a) The trial fake 01000000000 is now WARNED, not refused:
  // created, raw value stored, placeholder warning returned.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل وهمي للاختبار', '01000000000'), adminAuth);
      assert.equal(res.ok, true, 'placeholder phone must not block creation');
      assert.equal(await storedPhone(db, Number(res.id)), '01000000000', 'raw placeholder value is stored, not lost');
      assert.ok(res.phoneWarning, 'placeholder phone must return phoneWarning');
      assert.equal(warningCode(res), 'CUSTOMER_PHONE_PLACEHOLDER');
    } finally {
      await db.destroy();
    }
    console.log('  (a) fake 01000000000 warns, creates, stores raw passed');
  }

  // (b) Missing phone is allowed: stored as '', missing warning returned.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل بلا هاتف'), adminAuth);
      assert.equal(res.ok, true, 'missing phone must not block creation');
      assert.equal(await storedPhone(db, Number(res.id)), '', 'missing phone is stored as empty string');
      assert.ok(res.phoneWarning, 'missing phone must return phoneWarning');
      assert.equal(warningCode(res), 'CUSTOMER_PHONE_MISSING');
    } finally {
      await db.destroy();
    }
    console.log('  (b) missing phone warns, creates, stores empty passed');
  }

  // (c) Blank phone behaves like missing (stored as '', same warning).
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل هاتف فارغ', '   '), adminAuth);
      assert.equal(res.ok, true, 'blank phone must not block creation');
      assert.equal(await storedPhone(db, Number(res.id)), '');
      assert.equal(warningCode(res), 'CUSTOMER_PHONE_MISSING');
    } finally {
      await db.destroy();
    }
    console.log('  (c) blank phone warns, creates, stores empty passed');
  }

  // (d) A malformed phone is allowed: raw trimmed value stored, invalid warning returned.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل رقم قصير', '12345'), adminAuth);
      assert.equal(res.ok, true, 'malformed phone must not block creation');
      assert.equal(await storedPhone(db, Number(res.id)), '12345', 'raw malformed value is stored, not lost');
      assert.equal(warningCode(res), 'CUSTOMER_PHONE_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  (d) malformed phone warns, creates, stores raw passed');
  }

  // (e) A valid Egyptian mobile is accepted and stored as typed, with NO warning.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل حقيقي', '01012345678'), adminAuth);
      assert.equal(res.ok, true);
      assert.equal(await storedPhone(db, Number(res.id)), '01012345678');
      assert.equal(res.phoneWarning, undefined, 'valid phone must not warn');
    } finally {
      await db.destroy();
    }
    console.log('  (e) valid Egyptian mobile accepted, no warning passed');
  }

  // (f) The +20 form is accepted and normalized to the national form on store, no warning.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const res: any = await slice.createCustomer(payload('عميل دولي', '+201012345678'), adminAuth);
      assert.equal(res.ok, true);
      assert.equal(await storedPhone(db, Number(res.id)), '01012345678');
      assert.equal(res.phoneWarning, undefined, 'valid +20 phone must not warn');
    } finally {
      await db.destroy();
    }
    console.log('  (f) +20 form normalized on store, no warning passed');
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

  // (h) updateCustomer to the trial fake: allowed, but the stored phone
  // is KEPT (an invalid value never overwrites a good one); warning returned.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const created: any = await slice.createCustomer(payload('عميل للتعديل', '01012345678'), adminAuth);
      const res: any = await slice.updateCustomer(
        Number(created.id),
        payload('عميل للتعديل', '01000000000'),
        adminAuth,
      );
      assert.equal(res.ok, true, 'placeholder phone must not block update');
      assert.equal(
        await storedPhone(db, Number(created.id)),
        '01012345678',
        'invalid update must keep the existing stored phone',
      );
      assert.equal(warningCode(res), 'CUSTOMER_PHONE_PLACEHOLDER');
    } finally {
      await db.destroy();
    }
    console.log('  (h) update to fake phone warns, keeps existing phone passed');
  }

  // (i) updateCustomer to a valid new phone is accepted and stored, no warning.
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
      assert.equal(res.phoneWarning, undefined, 'valid update must not warn');
    } finally {
      await db.destroy();
    }
    console.log('  (i) update to valid phone accepted, no warning passed');
  }

  // (j) updateCustomer with NO phone in the payload keeps the existing phone, no warning.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const created: any = await slice.createCustomer(payload('عميل للتعديل', '01012345678'), adminAuth);
      const res: any = await slice.updateCustomer(Number(created.id), payload('عميل للتعديل'), adminAuth);
      assert.equal(res.ok, true, 'missing phone on update must not block');
      assert.equal(await storedPhone(db, Number(created.id)), '01012345678', 'existing phone is kept');
      assert.equal(res.phoneWarning, undefined, 'kept phone must not warn');
    } finally {
      await db.destroy();
    }
    console.log('  (j) update with missing phone keeps existing phone passed');
  }

  // (k) updateCustomer with a BLANK phone keeps the existing phone, no warning.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const created: any = await slice.createCustomer(payload('عميل للتعديل', '01012345678'), adminAuth);
      const res: any = await slice.updateCustomer(
        Number(created.id),
        payload('عميل للتعديل', '   '),
        adminAuth,
      );
      assert.equal(res.ok, true, 'blank phone on update must not block');
      assert.equal(await storedPhone(db, Number(created.id)), '01012345678', 'existing phone is kept');
      assert.equal(res.phoneWarning, undefined, 'kept phone must not warn');
    } finally {
      await db.destroy();
    }
    console.log('  (k) update with blank phone keeps existing phone passed');
  }

  // (l) updateCustomer with a malformed phone keeps the existing phone and warns.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const created: any = await slice.createCustomer(payload('عميل للتعديل', '01012345678'), adminAuth);
      const res: any = await slice.updateCustomer(
        Number(created.id),
        payload('عميل للتعديل', '12345'),
        adminAuth,
      );
      assert.equal(res.ok, true, 'malformed phone on update must not block');
      assert.equal(await storedPhone(db, Number(created.id)), '01012345678', 'existing phone is kept');
      assert.equal(warningCode(res), 'CUSTOMER_PHONE_INVALID');
    } finally {
      await db.destroy();
    }
    console.log('  (l) update with malformed phone warns, keeps existing phone passed');
  }

  // (m) updateCustomer to a valid phone that ANOTHER customer already holds:
  // allowed, stored, duplicate warning returned.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      await slice.createCustomer(payload('العميل الأول', '01012345678'), adminAuth);
      const second: any = await slice.createCustomer(payload('العميل الثاني', '01198765432'), adminAuth);
      const res: any = await slice.updateCustomer(
        Number(second.id),
        payload('العميل الثاني', '01012345678'),
        adminAuth,
      );
      assert.equal(res.ok, true, 'duplicate phone on update must not block');
      assert.equal(await storedPhone(db, Number(second.id)), '01012345678');
      assert.ok(res.phoneWarning, 'duplicate phone on update must return phoneWarning');
      assert.equal(String((res.phoneWarning as any)?.existingCustomer?.name), 'العميل الأول');
    } finally {
      await db.destroy();
    }
    console.log('  (m) update to duplicate phone warns, stores passed');
  }

  // (n) Two phone-less customers coexist: both stored as '', the second
  // carries the MISSING warning, never a duplicate warning.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      const first: any = await slice.createCustomer(payload('الأول بلا هاتف'), adminAuth);
      assert.equal(first.ok, true);
      const second: any = await slice.createCustomer(payload('الثاني بلا هاتف'), adminAuth);
      assert.equal(second.ok, true);
      assert.equal(await storedPhone(db, Number(second.id)), '');
      assert.equal(warningCode(second), 'CUSTOMER_PHONE_MISSING', 'empty phone must not trigger a duplicate warning');
      const count = await (db as any)
        .selectFrom('customers')
        .select((eb: any) => eb.fn.countAll().as('count'))
        .where('phone', '=', '')
        .executeTakeFirstOrThrow();
      assert.equal(Number(count.count), 2, 'both phone-less customers must exist');
    } finally {
      await db.destroy();
    }
    console.log('  (n) two phone-less customers coexist without duplicate warning passed');
  }

  // (o) The phone change disables NO other gate: an empty name still refuses.
  {
    const { pg, db } = await makeDb();
    try {
      const slice = buildSlice(db);
      await expectCode(slice.createCustomer(payload('', '01012345678'), adminAuth), 'CUSTOMER_NAME_REQUIRED');
    } finally {
      await db.destroy();
    }
    console.log('  (o) empty name still refused passed');
  }

  console.log('customer-phone-validation: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
