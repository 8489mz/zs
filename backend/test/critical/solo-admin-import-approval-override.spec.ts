/*
 * S5 (INV-SOLO-ADMIN-IMPORT-APPROVAL-OVERRIDE) — a solo admin who
 * created an import approval request may decide it alone, with a
 * logged override, when no other active admin/super_admin exists in
 * the tenant. When a second admin exists, the maker-checker ban
 * stands byte-identically.
 *
 * THE DEFECT (S5): decideApprovalRequest in
 * import-commercial.service.ts refused the requester outright
 * (`مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز للمستخدم الذي
 * أنشأ الطلب اعتماده بنفسه.`) with no role or tenant-size exception
 * — so a shop with only ONE admin could never decide an import
 * approval request they created, and the gated action (shipment,
 * broker, trip-expense, payment method, partner payout, project
 * close) sat blocked forever with no second admin to decide it.
 *
 * THE FIX: when requester === decider, the decision is allowed only
 * through the shared exported isSoloAdminOverride helper
 * (manager-approval.ts, created by P5, reused by P6 — no third
 * copy): true only when the decider is an admin/super_admin AND no
 * OTHER active admin/super_admin exists in the tenant. The decider's
 * role is read from the `users` row in the same transaction (the
 * decide path carries only userId, no auth context), and the check
 * runs lazily — only when a self-decision would otherwise be
 * refused — so a decision by a different admin costs no extra query
 * and behaves byte-identically. The override is never silent: the
 * approval row's only free-text audit field (`rejection_reason`,
 * already the carrier for decision notes on both decisions) carries
 * the stamp naming requester == decider, the decision, and that no
 * second admin was available; any supplied reason/notes are
 * preserved in front of the stamp. The gate
 * (verifyAndConsumeApprovalRequest) reads only status / action_type
 * / reference_id / request_payload, never rejection_reason, so the
 * stamp cannot change consumption — and it survives it, because the
 * gate's consume update touches only status + decided_at.
 *
 * DECISIONS PINNED HERE: (1) the comparison stays byte-identical
 * (`req.requested_by === userId`) — no Number() hardening smuggled
 * in: production pg returns bigint as string and there is no
 * setTypeParser anywhere in src, so whether the ban fires against
 * live Postgres is a separate, unproven question for its own
 * package; PGlite returns bigint as number, so this spec proves the
 * intended logic; (2) no new column / migration: the stamp reuses
 * rejection_reason, the row's only notes field; (3) the status
 * check still runs after the self-check, so a solo admin deciding
 * an already-decided own request gets 'تم البت في هذا الطلب
 * مسبقاً.'; (4) an inactive second admin does not count, and a
 * second admin in another tenant does not count; (5) a non-admin
 * requester is never a solo override.
 *
 * BASE-RED: at base, cases 1, 2, 3, 7, 8, 9 and 10 fail with the
 * exact old refusal; cases 4, 5 and 6 already pass at base.
 *
 * Run: npx ts-node test/critical/solo-admin-import-approval-override.spec.ts
 * (from backend/). One fresh in-memory database per case,
 * db.destroy() teardown only.
 *
 * NOT DRIVEN: a live-Postgres rehearsal (see decision (1) above);
 * the frontend approvals screen (no frontend change — it already
 * sends decision + notes, and the solo admin now succeeds where he
 * was refused); verifyBrokerExpense / S6 (a different gate, its own
 * package).
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
import { ImportCommercialService } from '../../src/modules/import-sales/services/import-commercial.service';

const TENANT = 't1';
const OLD_MSG = 'مبدأ الرقابة الثنائية (Maker-Checker): لا يجوز للمستخدم الذي أنشأ الطلب اعتماده بنفسه.';
const DECIDED_MSG = 'تم البت في هذا الطلب مسبقاً.';
const STAMP_HEAD = 'اعتماد منفرد بقرار إداري';
const STAMP_TAIL = 'لا يوجد مدير ثانٍ متاح';

type SecondAdmin = 'none' | 'active' | 'inactive' | 'other-tenant';

async function makeDb(opts: {
  secondAdmin?: SecondAdmin;
  requesterRole?: 'admin' | 'super_admin' | 'cashier';
  requesterId?: number;
}): Promise<{ pg: PGlite; db: Kysely<Database>; service: ImportCommercialService; requestId: string }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, role text, is_active boolean DEFAULT true);
    CREATE TABLE import_approval_requests (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      module text,
      action_type text NOT NULL,
      reference_id text NOT NULL,
      requested_by bigint NOT NULL,
      approved_by bigint,
      status text DEFAULT 'pending',
      request_payload jsonb DEFAULT '{}'::jsonb,
      rejection_reason text,
      created_at timestamptz DEFAULT NOW(),
      decided_at timestamptz
    );
  `);
  const requesterRole = opts.requesterRole ?? 'admin';
  const requesterId = opts.requesterId ?? 1;
  await db
    .insertInto('users')
    .values({ id: requesterId, tenant_id: TENANT, role: requesterRole, is_active: true } as any)
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
  // A cashier requester still needs the tenant's admin present for
  // case 6 to prove the role leg (not the tenant-size leg) refuses.
  if (requesterRole === 'cashier') {
    await db
      .insertInto('users')
      .values({ id: 4, tenant_id: TENANT, role: 'admin', is_active: true } as any)
      .execute();
  }
  const requestId = randomUUID();
  await db
    .insertInto('import_approval_requests')
    .values({
      id: requestId,
      tenant_id: TENANT,
      module: 'import',
      action_type: 'large_transfer',
      reference_id: 'ref-1',
      requested_by: requesterId,
      status: 'pending',
      request_payload: '{}',
    } as any)
    .execute();
  const service = new ImportCommercialService({ db: db as any, generatePeriodProfitReport: async () => ({}) });
  return { pg, db, service, requestId };
}

async function requestRow(db: Kysely<Database>, requestId: string): Promise<any> {
  return await db
    .selectFrom('import_approval_requests')
    .selectAll()
    .where('id', '=', requestId)
    .executeTakeFirstOrThrow();
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

  // 1. Solo admin approves their own request -> approved, stamped.
  await run('1 solo admin approves own request, override stamped', async () => {
    const { pg, db, service, requestId } = await makeDb({});
    try {
      const out = await service.decideApprovalRequest(TENANT, 1, requestId, { decision: 'approved' });
      assert.equal(out.status, 'approved');
      assert.equal(Number(out.approved_by), 1, 'approved_by must be the requester');
      assert.ok(out.decided_at, 'decided_at must be set');
      assert.equal(Number(out.requested_by), Number(out.approved_by), 'requester == decider must be on the row');
      const stamp = String(out.rejection_reason || '');
      assert.ok(stamp.includes(STAMP_HEAD), 'the override stamp must be on the row');
      assert.ok(stamp.includes('صاحب الطلب 1'), 'the stamp must name the requester');
      assert.ok(stamp.includes('(approved)'), 'the stamp must record the decision');
      assert.ok(stamp.includes(STAMP_TAIL), 'the stamp must record that no second admin was available');
    } finally {
      await db.destroy();
    }
  });

  // 2. Solo admin rejects their own request -> rejected, reason + stamp.
  await run('2 solo admin rejects own request, reason preserved + stamped', async () => {
    const { pg, db, service, requestId } = await makeDb({});
    try {
      const out = await service.decideApprovalRequest(TENANT, 1, requestId, {
        decision: 'rejected',
        rejectionReason: 'المبلغ غير مبرر',
      });
      assert.equal(out.status, 'rejected');
      const stamp = String(out.rejection_reason || '');
      assert.ok(stamp.startsWith('المبلغ غير مبرر'), 'the rejection reason must be preserved in front of the stamp');
      assert.ok(stamp.includes(STAMP_HEAD), 'the override stamp must be appended');
      assert.ok(stamp.includes('(rejected)'), 'the stamp must record the decision');
    } finally {
      await db.destroy();
    }
  });

  // 3. Solo admin approves own request with decision notes -> notes + stamp.
  await run('3 solo admin approves own request with notes, notes preserved + stamped', async () => {
    const { pg, db, service, requestId } = await makeDb({});
    try {
      const out = await service.decideApprovalRequest(TENANT, 1, requestId, {
        decision: 'approved',
        decisionNotes: 'ملاحظة القرار',
      });
      assert.equal(out.status, 'approved');
      const stamp = String(out.rejection_reason || '');
      assert.ok(stamp.startsWith('ملاحظة القرار'), 'the decision notes must be preserved in front of the stamp');
      assert.ok(stamp.includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 4. Second active admin present -> self-decision still refused, byte-identical.
  await run('4 second admin present, self-decision still refused', async () => {
    const { pg, db, service, requestId } = await makeDb({ secondAdmin: 'active' });
    try {
      await assert.rejects(
        service.decideApprovalRequest(TENANT, 1, requestId, { decision: 'approved' }),
        (e: Error) => e.message === OLD_MSG,
      );
      const row = await requestRow(db, requestId);
      assert.equal(row.status, 'pending', 'the request must stay pending');
      assert.equal(row.rejection_reason, null, 'nothing must be logged on a refused decision');
      assert.equal(row.approved_by, null);
    } finally {
      await db.destroy();
    }
  });

  // 5. Second admin decides the request -> works as before, no stamp.
  await run('5 second admin decides, works as before with no stamp', async () => {
    const { pg, db, service, requestId } = await makeDb({ secondAdmin: 'active' });
    try {
      const out = await service.decideApprovalRequest(TENANT, 2, requestId, { decision: 'approved' });
      assert.equal(out.status, 'approved');
      assert.equal(Number(out.approved_by), 2);
      assert.equal(out.rejection_reason, null, 'a different-admin decision carries no override stamp');
    } finally {
      await db.destroy();
    }
  });

  // 6. Non-admin requester decides their own request -> still refused.
  await run('6 cashier requester still refused', async () => {
    const { pg, db, service, requestId } = await makeDb({ requesterRole: 'cashier', requesterId: 3 });
    try {
      await assert.rejects(
        service.decideApprovalRequest(TENANT, 3, requestId, { decision: 'approved' }),
        (e: Error) => e.message === OLD_MSG,
      );
      const row = await requestRow(db, requestId);
      assert.equal(row.status, 'pending');
      assert.equal(row.rejection_reason, null);
    } finally {
      await db.destroy();
    }
  });

  // 7. Inactive second admin does not count -> solo override applies.
  await run('7 inactive second admin does not count', async () => {
    const { pg, db, service, requestId } = await makeDb({ secondAdmin: 'inactive' });
    try {
      const out = await service.decideApprovalRequest(TENANT, 1, requestId, { decision: 'approved' });
      assert.equal(out.status, 'approved');
      assert.ok(String(out.rejection_reason || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 8. Second admin in another tenant does not count -> solo override applies.
  await run('8 second admin in another tenant does not count', async () => {
    const { pg, db, service, requestId } = await makeDb({ secondAdmin: 'other-tenant' });
    try {
      const out = await service.decideApprovalRequest(TENANT, 1, requestId, { decision: 'approved' });
      assert.equal(out.status, 'approved');
      assert.ok(String(out.rejection_reason || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 9. Solo super_admin requester approves their own request -> stamped.
  await run('9 solo super_admin approves own request, override stamped', async () => {
    const { pg, db, service, requestId } = await makeDb({ requesterRole: 'super_admin' });
    try {
      const out = await service.decideApprovalRequest(TENANT, 1, requestId, { decision: 'approved' });
      assert.equal(out.status, 'approved');
      assert.ok(String(out.rejection_reason || '').includes(STAMP_HEAD));
    } finally {
      await db.destroy();
    }
  });

  // 10. Solo admin deciding an already-decided own request -> decided message.
  await run('10 solo admin re-deciding own decided request gets the decided message', async () => {
    const { pg, db, service, requestId } = await makeDb({});
    try {
      await service.decideApprovalRequest(TENANT, 1, requestId, { decision: 'approved' });
      await assert.rejects(
        service.decideApprovalRequest(TENANT, 1, requestId, { decision: 'rejected', rejectionReason: 'x' }),
        (e: Error) => e.message === DECIDED_MSG,
      );
      const row = await requestRow(db, requestId);
      assert.equal(row.status, 'approved', 'the first decision must stand');
    } finally {
      await db.destroy();
    }
  });

  // 11. Wiring: this spec is in both critical lists, in identical order (326 specs — the solo-admin-carrier-invoice-override spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 326);
    assert.equal(chain.length, 326);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/solo-admin-import-approval-override.spec.ts'));
    console.log('wiring: evidence spec in both critical lists (326 = 326, identical order), passed');
  }

  // 12. Source pins: the override reuses the shared helper (no third
  // copy), the old ban message is still present, and the gate still
  // consumes only approved requests.
  {
    const serviceSource = readFileSync(
      resolve(__dirname, '../../src/modules/import-sales/services/import-commercial.service.ts'),
      'utf8',
    );
    const helperSource = readFileSync(resolve(__dirname, '../../src/common/utils/manager-approval.ts'), 'utf8');
    const gateSource = readFileSync(
      resolve(__dirname, '../../src/modules/import-sales/import-approval-gate/import-approval-gate.ts'),
      'utf8',
    );
    assert.ok(
      serviceSource.includes('INV-SOLO-ADMIN-IMPORT-APPROVAL-OVERRIDE'),
      'the service names the solo-admin import-approval override invariant',
    );
    assert.ok(serviceSource.includes('isSoloAdminOverride'), 'the service consults the shared solo-admin helper');
    assert.ok(
      serviceSource.includes("from '../../../common/utils/manager-approval'"),
      'the service imports the shared helper, it does not redefine it',
    );
    assert.ok(
      helperSource.split('export async function isSoloAdminOverride').length - 1 === 1,
      'the shared helper is defined exactly once',
    );
    assert.ok(
      serviceSource.includes(OLD_MSG),
      'the old maker-checker refusal message is still present byte-identically',
    );
    assert.ok(serviceSource.includes(STAMP_HEAD), 'the service stamps the override');
    assert.ok(gateSource.includes("req.status !== 'approved'"), 'the gate still consumes only approved requests');
    console.log('  PASS S5 source pins');
  }

  if (failures.length) throw new Error(`${failures.length} S5 case(s) failed: ${failures.join(', ')}`);
  console.log('S5 solo-admin import approval override tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
