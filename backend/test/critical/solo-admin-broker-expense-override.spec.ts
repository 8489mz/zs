/*
 * S6 (INV-SOLO-ADMIN-BROKER-EXPENSE-OVERRIDE) — an admin who
 * settled (liquidated) a broker expense may verify it alone, with a
 * logged override, ONLY when no other active admin/super_admin
 * exists in the tenant. When a second active admin exists, the
 * maker-checker ban stands: the settler cannot verify their own
 * expense — a different admin verifies it (no second-manager
 * PASSWORD is ever required; verification by a different admin is
 * never blocked). Maker-checker (creator != verifier) is a money
 * control, distinct from the second-manager rule cancelled by
 * INV-SECOND-MANAGER-PASSWORD-REMOVED; the solo-admin override is
 * restored to its original tenant-size condition by
 * INV-BROKER-MAKER-CHECKER-RESTORED after the admin-mod widened
 * the shared helper to role-only and let the settler self-verify
 * even with a second admin present (ci-full 340/341).
 *
 * THE DEFECT (S6): verifyBrokerExpense in
 * import-treasury.service.ts refused the settler outright
 * (`مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز لمن سوّى المصروف
 * التحقق منه بنفسه. [IMPORT_BROKER_EXPENSE_SELF_VERIFICATION]`)
 * with no role or tenant-size exception — so a shop with only ONE
 * admin could never verify a broker expense they settled, and the
 * expense sat unverified (blocking project closure) forever with no
 * second admin to verify it.
 *
 * THE FIX: when verifier === settler (expense.created_by), the
 * verification is allowed only through TWO shared helpers in
 * manager-approval.ts: isSoloAdminOverride (created by P5, reused
 * by P6–P7 — no third copy; role-only since
 * INV-SECOND-MANAGER-PASSWORD-REMOVED) AND the maker-checker
 * tenant-size leg hasOtherActiveAdmin (new, same file — true when
 * another ACTIVE admin/super_admin exists in the same tenant).
 * The solo override applies only when the verifier is an
 * admin/super_admin AND no other active admin/super_admin exists
 * in the tenant. The verifier's role is read from the `users` row in
 * the same transaction (the verify path carries only userId, no auth
 * context), and the check runs lazily — only when a self-verification
 * would otherwise be refused — so a verification by a different admin
 * costs no extra query and behaves byte-identically. The override is
 * never silent: the expense row's `notes` TEXT column carries the
 * stamp naming settler == verifier (no second-manager reference —
 * INV-SECOND-MANAGER-PASSWORD-REMOVED); any pre-existing notes are
 * preserved in front of the stamp. The approved-token requirement
 * is untouched — the solo override never bypasses the bound
 * single-use approval token, and the gate
 * (verifyAndConsumeApprovalRequest) is unchanged: it checks only
 * token status / action / reference / payload, never identity.
 *
 * DECISIONS PINNED HERE: (1) the comparison stays byte-identical
 * (`Number(expense.created_by) === userId`) — no hardening smuggled
 * in, and none needed: unlike P7's bare `===`, this comparison
 * already coerces with Number(), so against live Postgres (pg
 * returns bigint as string, no setTypeParser anywhere in src) the
 * ban DOES fire — Number("1") === 1 — and the override path is
 * reached exactly when the ban would have fired; PGlite returns
 * bigint as number, so this spec proves the intended logic;
 * (2) no new column / migration: the stamp reuses `notes`, the
 * expense row's free-text field, and verified_by/verified_at carry
 * the verifier identity; (3) the is_verified check still runs before
 * the self-check, so re-verifying an already-verified own expense
 * still conflicts; (4) the tenant-size condition is RESTORED for
 * this flow only (INV-BROKER-MAKER-CHECKER-RESTORED): an ACTIVE
 * second admin in the same tenant refuses self-verification
 * (maker-checker — a money control, not a second-manager
 * password); an inactive second admin does not count, and a second
 * admin in another tenant does not count; (5) a non-admin
 * settler is never a solo override; (6) a missing approval token is
 * still refused before any override logic runs.
 *
 * BASE-RED (this package): at 061e0ce83 the admin-mod had made
 * self-verification succeed with a second admin present, so case 3
 * fails (allowed instead of refused) and
 * import-broker-capitalisation.spec.ts Case 8 fails with 'Missing
 * expected rejection: The liquidator must not verify their own
 * expense' (ci-full 340/341 on 3b45aff2d); all other cases pass at
 * base.
 *
 * Run: npx ts-node test/critical/solo-admin-broker-expense-override.spec.ts
 * (from backend/). One fresh in-memory database per case,
 * db.destroy() teardown only.
 *
 * NOT DRIVEN: a live-Postgres rehearsal (see decision (1) above);
 * the frontend import screen (no frontend change — it already sends
 * the approval token, and the solo admin now succeeds where he was
 * refused); decideApprovalRequest / S5 (its own package, P7).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ImportTreasuryService } from '../../src/modules/import-sales/services/import-treasury.service';
import { ImportApprovalGateSlice } from '../../src/modules/import-sales/import-approval-gate/import-approval-gate';

const TENANT = 't1';
const OLD_MSG =
  'مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز لمن سوّى المصروف التحقق منه بنفسه. [IMPORT_BROKER_EXPENSE_SELF_VERIFICATION]';
const CONFLICT_MSG = 'تم التحقق من مصروف المخلص مسبقاً.';
const TOKEN_REQUIRED_MSG = 'التحقق من مصروف مخلص يتطلب موافقة Maker-Checker معتمدة.';
const STAMP_HEAD = 'تحقق منفرد بقرار إداري';

type SecondAdmin = 'none' | 'active' | 'inactive' | 'other-tenant';

async function makeDb(opts: {
  secondAdmin?: SecondAdmin;
  settlerRole?: 'admin' | 'super_admin' | 'cashier';
  settlerId?: number;
  expenseNotes?: string | null;
  preVerified?: boolean;
}): Promise<{ pg: PGlite; db: Kysely<Database>; service: ImportTreasuryService; expenseId: string }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, role text, is_active boolean DEFAULT true);
    CREATE TABLE import_broker_expenses (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      broker_id text,
      receipt_no text,
      expense_date text,
      category text,
      amount_egp numeric,
      is_verified boolean DEFAULT false,
      verified_by bigint,
      verified_at timestamptz,
      notes text,
      created_by bigint
    );
    CREATE TABLE import_approval_requests (
      id text PRIMARY KEY,
      tenant_id text,
      module text,
      action_type text,
      reference_id text,
      requested_by bigint,
      status text,
      request_payload text,
      decided_at timestamptz
    );
  `);
  const settlerRole = opts.settlerRole ?? 'admin';
  const settlerId = opts.settlerId ?? 1;
  await db
    .insertInto('users')
    .values({ id: settlerId, tenant_id: TENANT, role: settlerRole, is_active: true } as any)
    .execute();
  if (opts.secondAdmin === 'active' || opts.secondAdmin === 'inactive') {
    await db
      .insertInto('users')
      .values({ id: 2, tenant_id: TENANT, role: 'admin', is_active: opts.secondAdmin === 'active' } as any)
      .execute();
  }
  if (opts.secondAdmin === 'other-tenant') {
    await db
      .insertInto('users')
      .values({ id: 2, tenant_id: 't2', role: 'admin', is_active: true } as any)
      .execute();
  }
  // A cashier settler still needs the tenant's admin present for
  // case 5 to prove the role leg refuses.
  if (settlerRole === 'cashier') {
    await db
      .insertInto('users')
      .values({ id: 4, tenant_id: TENANT, role: 'admin', is_active: true } as any)
      .execute();
  }
  const expenseId = randomUUID();
  await db
    .insertInto('import_broker_expenses')
    .values({
      id: expenseId,
      tenant_id: TENANT,
      broker_id: 'br-1',
      receipt_no: 'RC-1',
      expense_date: '2026-11-24',
      category: 'broker_fee',
      amount_egp: 1000,
      is_verified: opts.preVerified ?? false,
      verified_by: opts.preVerified ? settlerId : null,
      verified_at: opts.preVerified ? new Date() : null,
      notes: opts.expenseNotes ?? null,
      created_by: settlerId,
    } as any)
    .execute();
  const gate = new ImportApprovalGateSlice();
  const neverCalled = () => {
    throw new Error('unexpected dep call');
  };
  const service = new ImportTreasuryService({
    db: db as any,
    resolveTenantAccount: neverCalled,
    lockShipment: neverCalled as any,
    verifyAndConsumeApprovalRequest: gate.verifyAndConsumeApprovalRequest.bind(gate),
    applyImportCostRevaluation: neverCalled,
  });
  return { pg, db, service, expenseId };
}

async function insertToken(db: Kysely<Database>, id: string, expenseId: string, amount = 1000): Promise<void> {
  await db
    .insertInto('import_approval_requests')
    .values({
      id,
      tenant_id: TENANT,
      module: 'import',
      action_type: 'broker_expense_verification',
      reference_id: expenseId,
      requested_by: 99,
      status: 'approved',
      request_payload: JSON.stringify({ brokerExpenseId: expenseId, amount }),
    } as any)
    .execute();
}

async function expenseRow(db: Kysely<Database>, expenseId: string): Promise<any> {
  return await db
    .selectFrom('import_broker_expenses')
    .selectAll()
    .where('id', '=', expenseId)
    .executeTakeFirstOrThrow();
}

async function tokenStatus(db: Kysely<Database>, id: string): Promise<string> {
  const row = await db
    .selectFrom('import_approval_requests')
    .select('status')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return String((row as any).status);
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

  // 1. Solo admin settler verifies their own expense -> verified, stamped.
  await run('1 solo admin verifies own expense, override stamped', async () => {
    const { pg, db, service, expenseId } = await makeDb({});
    try {
      await insertToken(db, 'tok-1', expenseId);
      const out = await service.verifyBrokerExpense(TENANT, 1, expenseId, { approvalRequestId: 'tok-1' });
      assert.equal(out.is_verified, true, 'the expense must be verified');
      assert.equal(Number(out.verified_by), 1, 'verified_by must be the settler');
      assert.ok(out.verified_at, 'verified_at must be set');
      assert.equal(Number(out.created_by), Number(out.verified_by), 'settler == verifier must be on the row');
      const stamp = String(out.notes || '');
      assert.ok(stamp.includes(STAMP_HEAD), 'the override stamp must be on the expense row');
      assert.ok(stamp.includes('من سوّى المصروف 1'), 'the stamp must name the settler');
      assert.ok(stamp.includes('تحقق منه بنفسه'), 'the stamp must record self-verification');
      assert.ok(!stamp.includes('ثانٍ'), 'the stamp must carry no second-manager reference at all');
      assert.equal(await tokenStatus(db, 'tok-1'), 'executed', 'the token is single-use and consumed');
    } finally {
      await db.destroy();
    }
  });

  // 2. Solo admin verifies own expense with pre-existing notes -> notes preserved + stamp.
  await run('2 solo admin verifies own expense with notes, notes preserved + stamped', async () => {
    const { pg, db, service, expenseId } = await makeDb({ expenseNotes: 'إيصال مرفق' });
    try {
      await insertToken(db, 'tok-1', expenseId);
      const out = await service.verifyBrokerExpense(TENANT, 1, expenseId, { approvalRequestId: 'tok-1' });
      assert.equal(out.is_verified, true);
      const stamp = String(out.notes || '');
      assert.ok(stamp.startsWith('إيصال مرفق'), 'the pre-existing notes must be preserved in front of the stamp');
      assert.ok(stamp.includes(STAMP_HEAD), 'the override stamp must be appended');
    } finally {
      await db.destroy();
    }
  });

  // 3. Second active admin present -> self-verification still refused, byte-identical.
  await run('3 second admin present, self-verification still refused', async () => {
    const { pg, db, service, expenseId } = await makeDb({ secondAdmin: 'active' });
    try {
      await insertToken(db, 'tok-1', expenseId);
      await assert.rejects(
        service.verifyBrokerExpense(TENANT, 1, expenseId, { approvalRequestId: 'tok-1' }),
        (e: Error) => e.message === OLD_MSG,
      );
      const row = await expenseRow(db, expenseId);
      assert.equal(row.is_verified, false, 'the expense must stay unverified');
      assert.equal(row.verified_by, null);
      assert.equal(row.notes, null, 'nothing must be logged on a refused verification');
      assert.equal(
        await tokenStatus(db, 'tok-1'),
        'approved',
        'the refused self-verification does not consume the token',
      );
    } finally {
      await db.destroy();
    }
  });

  // 4. Different admin verifies -> works as before, no stamp.
  await run('4 second admin verifies, works as before with no stamp', async () => {
    const { pg, db, service, expenseId } = await makeDb({ secondAdmin: 'active' });
    try {
      await insertToken(db, 'tok-1', expenseId);
      const out = await service.verifyBrokerExpense(TENANT, 2, expenseId, { approvalRequestId: 'tok-1' });
      assert.equal(out.is_verified, true);
      assert.equal(Number(out.verified_by), 2);
      assert.equal(out.notes, null, 'a different-admin verification carries no override stamp');
      assert.equal(await tokenStatus(db, 'tok-1'), 'executed');
    } finally {
      await db.destroy();
    }
  });

  // 5. Non-admin settler verifies their own expense -> still refused.
  await run('5 cashier settler still refused', async () => {
    const { pg, db, service, expenseId } = await makeDb({ settlerRole: 'cashier', settlerId: 3 });
    try {
      await insertToken(db, 'tok-1', expenseId);
      await assert.rejects(
        service.verifyBrokerExpense(TENANT, 3, expenseId, { approvalRequestId: 'tok-1' }),
        (e: Error) => e.message === OLD_MSG,
      );
      const row = await expenseRow(db, expenseId);
      assert.equal(row.is_verified, false);
      assert.equal(row.notes, null);
      assert.equal(await tokenStatus(db, 'tok-1'), 'approved', 'the refused verification does not consume the token');
    } finally {
      await db.destroy();
    }
  });

  // 6. Solo super_admin settler verifies their own expense -> stamped.
  await run('6 solo super_admin verifies own expense, override stamped', async () => {
    const { pg, db, service, expenseId } = await makeDb({ settlerRole: 'super_admin' });
    try {
      await insertToken(db, 'tok-1', expenseId);
      const out = await service.verifyBrokerExpense(TENANT, 1, expenseId, { approvalRequestId: 'tok-1' });
      assert.equal(out.is_verified, true);
      assert.ok(String(out.notes || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 7. Inactive second admin does not count -> solo override applies.
  await run('7 inactive second admin does not count', async () => {
    const { pg, db, service, expenseId } = await makeDb({ secondAdmin: 'inactive' });
    try {
      await insertToken(db, 'tok-1', expenseId);
      const out = await service.verifyBrokerExpense(TENANT, 1, expenseId, { approvalRequestId: 'tok-1' });
      assert.equal(out.is_verified, true);
      assert.ok(String(out.notes || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 8. Second admin in another tenant does not count -> solo override applies.
  await run('8 second admin in another tenant does not count', async () => {
    const { pg, db, service, expenseId } = await makeDb({ secondAdmin: 'other-tenant' });
    try {
      await insertToken(db, 'tok-1', expenseId);
      const out = await service.verifyBrokerExpense(TENANT, 1, expenseId, { approvalRequestId: 'tok-1' });
      assert.equal(out.is_verified, true);
      assert.ok(String(out.notes || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 9. Solo admin re-verifying an already-verified own expense -> conflict.
  await run('9 solo admin re-verifying own verified expense gets the conflict message', async () => {
    const { pg, db, service, expenseId } = await makeDb({ preVerified: true });
    try {
      await insertToken(db, 'tok-1', expenseId);
      await assert.rejects(
        service.verifyBrokerExpense(TENANT, 1, expenseId, { approvalRequestId: 'tok-1' }),
        (e: Error) => e.message === CONFLICT_MSG,
      );
      assert.equal(await tokenStatus(db, 'tok-1'), 'approved', 'the conflict does not consume the token');
    } finally {
      await db.destroy();
    }
  });

  // 10. Solo admin without an approval token -> token-required refusal.
  await run('10 solo admin without a token is still refused', async () => {
    const { pg, db, service, expenseId } = await makeDb({});
    try {
      await assert.rejects(
        service.verifyBrokerExpense(TENANT, 1, expenseId, {} as any),
        (e: Error) => e.message === TOKEN_REQUIRED_MSG,
      );
      const row = await expenseRow(db, expenseId);
      assert.equal(row.is_verified, false);
      assert.equal(row.notes, null, 'nothing must be logged when the token is missing');
    } finally {
      await db.destroy();
    }
  });

  // 11. A token bound to another expense cannot verify this one.
  await run('11 foreign token still refused, token not consumed', async () => {
    const { pg, db, service, expenseId } = await makeDb({ secondAdmin: 'active' });
    try {
      await insertToken(db, 'tok-other', 'other-expense-id');
      await assert.rejects(
        service.verifyBrokerExpense(TENANT, 2, expenseId, { approvalRequestId: 'tok-other' }),
        (e: Error) => /مرتبط بمرجع/.test(e.message),
      );
      const row = await expenseRow(db, expenseId);
      assert.equal(row.is_verified, false);
      assert.equal(await tokenStatus(db, 'tok-other'), 'approved', 'the rejected foreign token is not consumed');
    } finally {
      await db.destroy();
    }
  });

  // 12. Wiring: this spec is in both critical lists, in identical order (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 369);
    assert.equal(chain.length, 369);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/solo-admin-broker-expense-override.spec.ts'));
    console.log('wiring: evidence spec in both critical lists (369 = 369, identical order), passed');
  }

  // 13. Source pins: the override reuses the shared helpers (role
  // leg + maker-checker tenant-size leg), the old ban message is
  // still present, and the identity comparison keeps its Number()
  // coercion (the P7 bigint hazard does not apply here — see the
  // header).
  {
    const serviceSource = readFileSync(
      resolve(__dirname, '../../src/modules/import-sales/services/import-treasury.service.ts'),
      'utf8',
    );
    const helperSource = readFileSync(resolve(__dirname, '../../src/common/utils/manager-approval.ts'), 'utf8');
    const gateSource = readFileSync(
      resolve(__dirname, '../../src/modules/import-sales/import-approval-gate/import-approval-gate.ts'),
      'utf8',
    );
    assert.ok(
      serviceSource.includes('INV-SOLO-ADMIN-BROKER-EXPENSE-OVERRIDE'),
      'the service names the solo-admin broker-expense override invariant',
    );
    assert.ok(serviceSource.includes('isSoloAdminOverride'), 'the service consults the shared solo-admin helper');
    assert.ok(
      serviceSource.includes('hasOtherActiveAdmin'),
      'the service consults the shared maker-checker tenant-size helper',
    );
    assert.ok(
      serviceSource.includes("from '../../../common/utils/manager-approval'"),
      'the service imports the shared helpers, it does not redefine them',
    );
    assert.ok(
      helperSource.split('export async function isSoloAdminOverride').length - 1 === 1,
      'the shared helper is defined exactly once',
    );
    assert.ok(
      helperSource.split('export async function hasOtherActiveAdmin').length - 1 === 1,
      'the maker-checker helper is defined exactly once',
    );
    assert.ok(
      serviceSource.includes(OLD_MSG),
      'the old maker-checker refusal message is still present byte-identically',
    );
    assert.ok(
      serviceSource.includes('Number(expense.created_by) === userId'),
      'the identity comparison keeps its Number() coercion',
    );
    assert.ok(serviceSource.includes(STAMP_HEAD), 'the service stamps the override');
    assert.ok(gateSource.includes("req.status !== 'approved'"), 'the gate still consumes only approved requests');
    console.log('  PASS S6 source pins');
  }

  if (failures.length) throw new Error(`${failures.length} S6 case(s) failed: ${failures.join(', ')}`);
  console.log('S6 solo-admin broker expense override tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
