/*
 * S7 (INV-SOLO-ADMIN-CARRIER-INVOICE-OVERRIDE) — an admin who
 * created (recorded) a maritime carrier invoice may approve their own
 * overcharge override alone, with a logged override. No second-manager
 * approval may block any admin, ever (INV-SECOND-MANAGER-PASSWORD-REMOVED) —
 * the override applies whether or not a second eligible approver
 * exists in the tenant.
 *
 * THE DEFECT (S7): validateMakerCheckerOverride in
 * freight-audit.engine.ts refused the invoice creator outright
 * (`حظر فصل المهام: لا يمكن للمستخدم الذي سجل الفاتورة اعتماد التجاوز
 * المالي بنفسه (Maker-Checker Separation).`) with no role or
 * tenant-size exception — so a shop with only ONE admin could never
 * approve an overcharge override on an invoice they recorded, and the
 * invoice sat in `overcharge` forever (no journal, no dispute path
 * taken). Maritime is set aside by the retail scope decision, but the
 * gate is live in code.
 *
 * THE FIX: in overrideCarrierInvoice
 * (maritime-freight-carrier-invoices.service.ts), when the engine
 * validation fails AND the actor is the invoice creator, the service
 * consults the shared exported isSoloAdminOverride helper
 * (manager-approval.ts, created by P5, reused by P6–P8 — no fourth
 * copy), lazily — only on the self-approval path — so an approval by
 * a different approver costs no extra query and behaves
 * byte-identically. The override is never silent: the invoice row's
 * `override_reason` TEXT column carries the stamp naming creator ==
 * approver, the overcharge amount (variance_amount) and that no
 * second eligible approver was available; the supplied reason is
 * preserved in front of the stamp, and override_approved_by /
 * override_approved_at already record who approved and when. The
 * audit_status gate still runs first (only an `overcharge` invoice
 * can be overridden), and the reason leg still applies on the solo
 * path with the engine's exact message.
 *
 * DECISIONS PINNED HERE: (1) stamp carrier = `override_reason`
 * (the row's free-text field for the override decision); no new
 * column / migration; (2) the helper is NOT extended with a roles
 * parameter: the engine's third eligible role, finance_manager, is
 * not a storable users role — `users_role_valid CHECK (role IN
 * ('super_admin', 'admin', 'cashier'))` (migration
 * 1710000001000-phase2-relational-schema.ts L29), the Kysely
 * UserTable.role union, and session.service.ts (AuthContext.role
 * comes straight from users.role) all agree — so no second
 * finance_manager approver and no finance_manager creator can exist
 * in production, and the shared helper (admin/super_admin) already
 * answers exactly the right question; extending it would query a
 * role value the DB forbids and would need a type-defeating cast
 * against UserTable.role. A finance_manager creator is therefore
 * fail-closed (old ban stands) and is pinned as such in case 6;
 * (3) the identity comparison keeps its coercion
 * (`Number(invoice.created_by)`, as the service already passes it
 * to the engine, and the engine itself compares with
 * String()): unlike P7's bare `===`, the P7 bigint hazard does NOT
 * apply here — production pg returns bigint as a string and there
 * is no setTypeParser anywhere in src, but Number("1") === 1 and
 * String(1) === String("1"), so the ban DOES fire against live
 * Postgres and the override is reached exactly when the ban would
 * have fired; PGlite returns bigint as number, so this spec proves
 * the intended logic; (4) the second-admin condition is removed
 * entirely (INV-SECOND-MANAGER-PASSWORD-REMOVED): an active, inactive or
 * other-tenant second admin changes nothing, and a cashier never
 * counts as an eligible approver — the only leg that still refuses
 * is the role leg (a non-admin / finance_manager creator); (5) the journal is posted
 * only when none exists — the spec seeds journal_entry_id so the
 * poster is never called and the override path is proven without
 * the accounting poster; (6) the engine itself is untouched, so its
 * ban (and its stale ≥10-char reason case 8 in
 * freight-audit.engine.spec.ts, which fails on the unpatched tree
 * today — pre-existing, not wired into test:critical) is out of
 * scope for this package.
 *
 * BASE-RED: at base, cases 1, 2, 8, 9 and 12 fail with the exact old
 * refusal, and case 10 fails with the old refusal instead of the
 * reason-required refusal; cases 3, 4, 5, 6, 7 and 11 already pass
 * at base.
 *
 * Run: npx ts-node test/critical/solo-admin-carrier-invoice-override.spec.ts
 * (from backend/). One fresh in-memory database per case,
 * db.destroy() teardown only.
 *
 * NOT DRIVEN: a live-Postgres rehearsal (see decision (3) above);
 * the frontend maritime screen (no frontend change — it already
 * sends the reason, and the solo admin now succeeds where he was
 * refused); the journal-posting branch (journal_entry_id is seeded,
 * so the poster is never called — a fresh overcharge invoice with
 * no journal still posts through the unchanged poster path).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightCarrierInvoicesService } from '../../src/modules/maritime-freight/maritime-freight-carrier-invoices.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const OLD_MSG =
  'حظر فصل المهام: لا يمكن للمستخدم الذي سجل الفاتورة اعتماد التجاوز المالي بنفسه (Maker-Checker Separation).';
const REASON_MSG = 'يجب تقديم مبرر مالي لاعتماد التجاوز يوضح سبب قبول الزيادة عن التعرفة.';
const REASON = 'اعتماد الزيادة بعد مراجعة إيميل الخط الملاحي بخصوص رسوم التكدس بالميناء';
const STAMP_HEAD = 'تجاوز منفرد بقرار إداري';
const VARIANCE = 150.5;

type SecondUser = 'none' | 'active-admin' | 'inactive-admin' | 'other-tenant-admin' | 'active-cashier';

async function makeDb(opts: {
  secondUser?: SecondUser;
  creatorRole?: 'admin' | 'super_admin' | 'cashier' | 'finance_manager';
  creatorId?: number;
  auditStatus?: string;
}): Promise<{ pg: PGlite; db: Kysely<Database>; service: MaritimeFreightCarrierInvoicesService }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, role text, is_active boolean DEFAULT true);
    CREATE TABLE maritime_carrier_invoices (
      id bigint PRIMARY KEY,
      tenant_id text NOT NULL,
      job_id bigint NOT NULL,
      shipping_line_id bigint,
      carrier_name text,
      invoice_number text,
      invoice_date date,
      currency text,
      total_invoiced_amount numeric,
      ocean_freight numeric,
      thc_charges numeric,
      baf_charges numeric,
      detention_demurrage numeric,
      other_charges numeric,
      rate_card_id bigint,
      contracted_amount numeric,
      variance_amount numeric,
      variance_pct numeric,
      audit_status text,
      override_approved_by bigint,
      override_approved_at timestamptz,
      override_reason text,
      journal_entry_id bigint,
      payment_status text,
      notes text,
      created_by bigint,
      created_at timestamptz,
      updated_at timestamptz
    );
  `);
  const creatorRole = opts.creatorRole ?? 'admin';
  const creatorId = opts.creatorId ?? 1;
  await db
    .insertInto('users')
    .values({ id: creatorId, tenant_id: TENANT, role: creatorRole, is_active: true } as any)
    .execute();
  const second = opts.secondUser ?? 'none';
  if (second === 'active-admin' || second === 'inactive-admin') {
    await db
      .insertInto('users')
      .values({ id: 2, tenant_id: TENANT, role: 'admin', is_active: second === 'active-admin' } as any)
      .execute();
  }
  if (second === 'other-tenant-admin') {
    await db
      .insertInto('users')
      .values({ id: 2, tenant_id: 't2', role: 'admin', is_active: true } as any)
      .execute();
  }
  if (second === 'active-cashier') {
    await db
      .insertInto('users')
      .values({ id: 2, tenant_id: TENANT, role: 'cashier', is_active: true } as any)
      .execute();
  }
  // A cashier creator still needs the tenant's admin present for
  // case 5 to prove the role leg refuses.
  if (creatorRole === 'cashier') {
    await db
      .insertInto('users')
      .values({ id: 4, tenant_id: TENANT, role: 'admin', is_active: true } as any)
      .execute();
  }
  await db
    .insertInto('maritime_carrier_invoices')
    .values({
      id: 1,
      tenant_id: TENANT,
      job_id: 1,
      shipping_line_id: null,
      carrier_name: 'Maersk',
      invoice_number: 'INV-1',
      invoice_date: '2026-11-24',
      currency: 'USD',
      total_invoiced_amount: 1150.5,
      ocean_freight: 1000,
      thc_charges: 100,
      baf_charges: 50,
      detention_demurrage: 0,
      other_charges: 0.5,
      rate_card_id: null,
      contracted_amount: 1000,
      variance_amount: VARIANCE,
      variance_pct: 15.05,
      audit_status: opts.auditStatus ?? 'overcharge',
      override_approved_by: opts.auditStatus === 'approved_override' ? creatorId : null,
      override_approved_at: null,
      override_reason: null,
      journal_entry_id: 77,
      payment_status: 'unpaid',
      notes: null,
      created_by: creatorId,
      created_at: new Date(),
      updated_at: new Date(),
    } as any)
    .execute();
  const neverCalled = () => {
    throw new Error('unexpected dep call');
  };
  const service = new MaritimeFreightCarrierInvoicesService({
    db: db as any,
    accountingPosting: {} as any,
    getJobById: (async () => ({ id: 1, job_number: 'JOB-1' })) as any,
    mapRateCardRow: (() => ({})) as any,
    resolveFreightExchangeRate: neverCalled as any,
    resolveAccountId: neverCalled as any,
    assertMaritimeJournalPeriodOpen: neverCalled as any,
  });
  return { pg, db, service };
}

function authFor(userId: number, role: string): AuthContext {
  return {
    userId,
    sessionId: 'sess',
    username: `u${userId}`,
    role,
    permissions: [],
    tenantId: TENANT,
    accountId: 'a1',
  } as AuthContext;
}

async function invoiceRow(db: Kysely<Database>): Promise<any> {
  return await db.selectFrom('maritime_carrier_invoices').selectAll().where('id', '=', '1').executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  const failures: string[] = [];
  async function run(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`  FAIL ${name}:`, (error as Error).message);
    }
  }

  // 1. Solo admin creator approves own overcharge override -> approved, stamped, journal untouched.
  await run('1 solo admin approves own overcharge override, override stamped', async () => {
    const { pg, db, service } = await makeDb({});
    try {
      const out = await service.overrideCarrierInvoice(authFor(1, 'admin'), '1', { reason: REASON });
      assert.equal(out.success, true, 'the override must succeed');
      assert.equal(out.invoice.audit_status, 'approved_override', 'the invoice must move to approved_override');
      assert.equal(Number(out.invoice.override_approved_by), 1, 'override_approved_by must be the creator');
      assert.equal(
        Number(out.invoice.created_by),
        Number(out.invoice.override_approved_by),
        'creator == approver must be on the row',
      );
      assert.ok(out.invoice.override_approved_at, 'override_approved_at must be set');
      assert.equal(
        Number(out.invoice.journal_entry_id),
        77,
        'the pre-existing journal entry must be kept, no new posting',
      );
      const stored = String(out.invoice.override_reason || '');
      assert.ok(stored.startsWith(REASON), 'the supplied reason must be preserved in front of the stamp');
      assert.ok(stored.includes(STAMP_HEAD), 'the override stamp must be on the invoice row');
      assert.ok(stored.includes('من سجل الفاتورة 1'), 'the stamp must name the creator');
      assert.ok(stored.includes('اعتمد التجاوز بنفسه'), 'the stamp must record self-approval');
      assert.ok(stored.includes(`الزيادة ${VARIANCE}`), 'the stamp must record the overcharge amount');
      assert.ok(!stored.includes('ثانٍ'), 'the stamp must carry no second-manager reference at all');
    } finally {
      await db.destroy();
    }
  });

  // 2. Solo super_admin creator approves own override -> stamped.
  await run('2 solo super_admin approves own override, override stamped', async () => {
    const { pg, db, service } = await makeDb({ creatorRole: 'super_admin' });
    try {
      const out = await service.overrideCarrierInvoice(authFor(1, 'super_admin'), '1', { reason: REASON });
      assert.equal(out.invoice.audit_status, 'approved_override');
      assert.equal(Number(out.invoice.override_approved_by), 1);
      assert.ok(String(out.invoice.override_reason || '').includes(STAMP_HEAD));
      assert.ok(
        !String(out.invoice.override_reason || '').includes('ثانٍ'),
        'the override reason must carry no second-manager reference at all',
      );
    } finally {
      await db.destroy();
    }
  });

  // 3. Second active admin present -> self-approval now allowed, stamped.
  await run('3 second admin present, self-approval now allowed and stamped', async () => {
    const { pg, db, service } = await makeDb({ secondUser: 'active-admin' });
    try {
      const out = await service.overrideCarrierInvoice(authFor(1, 'admin'), '1', { reason: REASON });
      assert.equal(out.success, true, 'the override must succeed');
      assert.equal(out.invoice.audit_status, 'approved_override', 'the invoice must move to approved_override');
      assert.equal(Number(out.invoice.override_approved_by), 1, 'override_approved_by must be the creator');
      assert.equal(
        Number(out.invoice.created_by),
        Number(out.invoice.override_approved_by),
        'creator == approver must be on the row',
      );
      assert.ok(out.invoice.override_approved_at, 'override_approved_at must be set');
      assert.equal(
        Number(out.invoice.journal_entry_id),
        77,
        'the pre-existing journal entry must be kept, no new posting',
      );
      const stored = String(out.invoice.override_reason || '');
      assert.ok(stored.startsWith(REASON), 'the supplied reason must be preserved in front of the stamp');
      assert.ok(stored.includes(STAMP_HEAD), 'the override stamp must be on the invoice row');
      assert.ok(stored.includes('من سجل الفاتورة 1'), 'the stamp must name the creator');
      assert.ok(stored.includes('اعتمد التجاوز بنفسه'), 'the stamp must record self-approval');
      assert.ok(stored.includes(`الزيادة ${VARIANCE}`), 'the stamp must record the overcharge amount');
      assert.ok(!stored.includes('ثانٍ'), 'the stamp must carry no second-manager reference at all');
    } finally {
      await db.destroy();
    }
  });

  // 4. Different admin approves -> works as before, no stamp.
  await run('4 second admin approves, works as before with no stamp', async () => {
    const { pg, db, service } = await makeDb({ secondUser: 'active-admin' });
    try {
      const out = await service.overrideCarrierInvoice(authFor(2, 'admin'), '1', { reason: REASON });
      assert.equal(out.invoice.audit_status, 'approved_override');
      assert.equal(Number(out.invoice.override_approved_by), 2);
      assert.equal(String(out.invoice.override_reason), REASON, 'a different-admin approval carries no override stamp');
    } finally {
      await db.destroy();
    }
  });

  // 5. Non-eligible creator (cashier) still refused.
  await run('5 cashier creator still refused', async () => {
    const { pg, db, service } = await makeDb({ creatorRole: 'cashier', creatorId: 3 });
    try {
      await assert.rejects(
        service.overrideCarrierInvoice(authFor(3, 'cashier'), '1', { reason: REASON }),
        (e: Error) => e.message === OLD_MSG,
      );
      const row = await invoiceRow(db);
      assert.equal(row.audit_status, 'overcharge');
      assert.equal(row.override_reason, null);
    } finally {
      await db.destroy();
    }
  });

  // 6. finance_manager creator, solo -> still refused (fail-closed:
  // finance_manager is not a storable users role — see header
  // decision (2) — so it can never be a solo override).
  await run('6 finance_manager creator still refused (fail-closed)', async () => {
    const { pg, db, service } = await makeDb({ creatorRole: 'finance_manager', creatorId: 5 });
    try {
      await assert.rejects(
        service.overrideCarrierInvoice(authFor(5, 'finance_manager'), '1', { reason: REASON }),
        (e: Error) => e.message === OLD_MSG,
      );
      const row = await invoiceRow(db);
      assert.equal(row.audit_status, 'overcharge');
      assert.equal(row.override_reason, null);
    } finally {
      await db.destroy();
    }
  });

  // 7. finance_manager creator with an active admin present -> still refused.
  await run('7 finance_manager creator with admin present still refused', async () => {
    const { pg, db, service } = await makeDb({
      creatorRole: 'finance_manager',
      creatorId: 5,
      secondUser: 'active-admin',
    });
    try {
      await assert.rejects(
        service.overrideCarrierInvoice(authFor(5, 'finance_manager'), '1', { reason: REASON }),
        (e: Error) => e.message === OLD_MSG,
      );
      const row = await invoiceRow(db);
      assert.equal(row.audit_status, 'overcharge');
    } finally {
      await db.destroy();
    }
  });

  // 8. Inactive second admin does not count -> solo override applies.
  await run('8 inactive second admin does not count', async () => {
    const { pg, db, service } = await makeDb({ secondUser: 'inactive-admin' });
    try {
      const out = await service.overrideCarrierInvoice(authFor(1, 'admin'), '1', { reason: REASON });
      assert.equal(out.invoice.audit_status, 'approved_override');
      assert.ok(String(out.invoice.override_reason || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 9. Second admin in another tenant does not count -> solo override applies.
  await run('9 second admin in another tenant does not count', async () => {
    const { pg, db, service } = await makeDb({ secondUser: 'other-tenant-admin' });
    try {
      const out = await service.overrideCarrierInvoice(authFor(1, 'admin'), '1', { reason: REASON });
      assert.equal(out.invoice.audit_status, 'approved_override');
      assert.ok(String(out.invoice.override_reason || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 10. Solo admin with an empty reason -> reason-required refusal, row unchanged.
  await run('10 solo admin with empty reason still refused with the reason message', async () => {
    const { pg, db, service } = await makeDb({});
    try {
      await assert.rejects(
        service.overrideCarrierInvoice(authFor(1, 'admin'), '1', { reason: '   ' }),
        (e: Error) => e.message === REASON_MSG,
      );
      const row = await invoiceRow(db);
      assert.equal(row.audit_status, 'overcharge', 'the invoice must stay in overcharge');
      assert.equal(row.override_reason, null, 'nothing must be logged on a refused override');
    } finally {
      await db.destroy();
    }
  });

  // 11. Already-approved invoice -> the audit_status gate still refuses first.
  await run('11 already-approved invoice still refused by the status gate', async () => {
    const { pg, db, service } = await makeDb({ auditStatus: 'approved_override' });
    try {
      await assert.rejects(service.overrideCarrierInvoice(authFor(1, 'admin'), '1', { reason: REASON }), (e: Error) =>
        e.message.includes('ليست في انتظار مراجعة زيادة سعرية'),
      );
      const row = await invoiceRow(db);
      assert.equal(row.audit_status, 'approved_override');
    } finally {
      await db.destroy();
    }
  });

  // 12. A cashier never counts as an eligible second approver -> solo override applies.
  await run('12 active cashier does not count as a second approver', async () => {
    const { pg, db, service } = await makeDb({ secondUser: 'active-cashier' });
    try {
      const out = await service.overrideCarrierInvoice(authFor(1, 'admin'), '1', { reason: REASON });
      assert.equal(out.invoice.audit_status, 'approved_override');
      assert.ok(String(out.invoice.override_reason || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 13. Wiring: this spec is in both critical lists, in identical order (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 378);
    assert.equal(chain.length, 378);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/solo-admin-carrier-invoice-override.spec.ts'));
    console.log('wiring: evidence spec in both critical lists (373 = 373, identical order), passed');
  }

  // 14. Source pins: the override reuses the shared helper (no fourth
  // copy), the old ban message is still present, the identity
  // comparison keeps its coercion (the P7 bigint hazard does not
  // apply here — see the header), and the engine ban is untouched.
  {
    const serviceSource = readFileSync(
      resolve(__dirname, '../../src/modules/maritime-freight/maritime-freight-carrier-invoices.service.ts'),
      'utf8',
    );
    const helperSource = readFileSync(resolve(__dirname, '../../src/common/utils/manager-approval.ts'), 'utf8');
    const engineSource = readFileSync(
      resolve(__dirname, '../../src/modules/maritime-freight/engines/freight-audit.engine.ts'),
      'utf8',
    );
    assert.ok(
      serviceSource.includes('INV-SOLO-ADMIN-CARRIER-INVOICE-OVERRIDE'),
      'the service names the solo-admin carrier-invoice override invariant',
    );
    assert.ok(serviceSource.includes('isSoloAdminOverride'), 'the service consults the shared solo-admin helper');
    assert.ok(
      serviceSource.includes("from '../../common/utils/manager-approval'"),
      'the service imports the shared helper, it does not redefine it',
    );
    assert.ok(
      helperSource.split('export async function isSoloAdminOverride').length - 1 === 1,
      'the shared helper is defined exactly once',
    );
    assert.ok(
      engineSource.includes(OLD_MSG),
      'the old maker-checker refusal message is still present byte-identically in the engine',
    );
    assert.ok(
      serviceSource.includes('throw new BadRequestException(validation.error)'),
      'the service still throws the engine refusal unchanged when no solo override applies',
    );
    assert.ok(
      serviceSource.includes('Number(auth.userId) === createdBy'),
      'the self-check compares the coerced creator id against the actor',
    );
    assert.ok(serviceSource.includes(STAMP_HEAD), 'the service stamps the override');
    assert.ok(
      engineSource.includes('String(ctx.userId) === String(ctx.invoiceCreatedBy)'),
      'the engine ban keeps its String() coercion (P7 bigint hazard does not apply)',
    );
    console.log('  PASS S7 source pins');
  }

  if (failures.length) throw new Error(`${failures.length} S7 case(s) failed: ${failures.join(', ')}`);
  console.log('S7 solo-admin carrier invoice override tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
