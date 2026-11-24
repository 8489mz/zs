/*
 * INV-SOLO-ADMIN-PO-SELF-APPROVAL-OVERRIDE: the self-decision ban in
 * `approveRequest` / `rejectRequest` (approval-workflow.service.ts)
 * refused the requester outright — `لا يجوز لصاحب الطلب اعتماد
 * مستنده.` — with no role or tenant-size exception. In a shop with
 * only ONE admin that ban is unsatisfiable: the solo admin who
 * created a purchase-order approval request can never decide it, so
 * the purchase order sits in `pending_approval` forever (no second
 * admin exists to approve it).
 *
 * WHAT THIS PINS (drives the real ApprovalWorkflowService against a
 * minimal PGlite harness):
 * - A solo admin approving their OWN purchase-order request (no
 *   other active admin/super_admin in the tenant) succeeds: the
 *   request becomes `approved`, the purchase order becomes
 *   `confirmed`, and the approval audit trail (`approval_request_logs`)
 *   carries the override stamp naming the requester == decider and
 *   that no second admin was available. The control is recorded,
 *   not silently dropped.
 * - A solo admin rejecting their OWN request succeeds the same way:
 *   the request becomes `rejected`, the purchase order returns to
 *   `draft`, and the log row carries the override stamp.
 * - A solo admin clears a 2-tier request alone, tier by tier: tier 1
 *   advances to tier 2 (still `pending`), tier 2 fully approves, and
 *   both log rows carry the override stamp.
 * - A solo super_admin in a tenant of their own approves their own
 *   request the same way, stamped with their name.
 * - An INACTIVE second admin does not count: the solo admin may
 *   still decide alone while the only other admin row is inactive.
 * - A non-admin requester still may NOT decide their own request:
 *   a cashier approving their own request is refused with the old
 *   self-decision message.
 * - A second admin deciding works as before: another active admin
 *   approves the requester's request, the order confirms, and the log
 *   row carries NO override stamp.
 * - Self-decision when a second admin EXISTS is still refused: with
 *   a second active admin in the tenant, the requester approving or
 *   rejecting their own request gets the old ForbiddenException, the
 *   request stays `pending` and the purchase order stays
 *   `pending_approval`, with no decision logged.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { ApprovalWorkflowService } from '../../src/modules/approvals/approval-workflow.service';

const SELF_APPROVE_MSG = 'لا يجوز لصاحب الطلب اعتماد مستنده.';
const SELF_REJECT_MSG = 'لا يجوز لصاحب الطلب رفض مستنده.';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const whatsappStub = { sendRawMessage: async () => {} };
  const approvals = new ApprovalWorkflowService(db, whatsappStub as any);
  const admin1 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin1', permissions: [] } as unknown as AuthContext;
  const admin2 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 2, username: 'admin2', permissions: [] } as unknown as AuthContext;
  const cashier3 = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 3, username: 'cashier3', permissions: [] } as unknown as AuthContext;
  const superAdmin = { tenantId: 't2', accountId: 'a2', role: 'super_admin', userId: 9, username: 'owner', permissions: [] } as unknown as AuthContext;

  const requestRow = async (id: string) => {
    const r = await pg.query<{ status: string; current_tier: number }>(
      'SELECT status, current_tier FROM approval_requests WHERE id=$1', [id]);
    return r.rows[0];
  };
  const poStatus = async (id: number) => {
    const r = await pg.query<{ status: string }>('SELECT status FROM purchase_orders WHERE id=$1', [id]);
    return r.rows[0].status;
  };
  const logsFor = async (requestId: string) => {
    const r = await pg.query<{ action: string; action_by: number; notes: string }>(
      'SELECT action, action_by, notes FROM approval_request_logs WHERE request_id=$1 ORDER BY created_at ASC', [requestId]);
    return r.rows;
  };
  const expectForbidden = async (promise: Promise<unknown>, message: string, label: string) => {
    try {
      await promise;
    } catch (err: unknown) {
      assert.equal((err as Error)?.message, message, `${label} — got: ${(err as Error)?.message}`);
      return;
    }
    assert.fail(`${label} — expected a ForbiddenException, the decision went through`);
  };

  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1'), ('t2');
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, role text, is_active boolean DEFAULT true, password_hash text, password_salt text, default_branch_id bigint);
      CREATE TABLE approval_rules (id text PRIMARY KEY, tenant_id text, module text, min_amount numeric, max_amount numeric,
        tier_level int, required_role text, approver_user_id bigint, is_active boolean DEFAULT true, notes text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE approval_requests (id text PRIMARY KEY, tenant_id text, module text, record_id text, record_ref text,
        amount numeric, currency text, current_tier int, max_tier int, status text,
        requested_by bigint, requested_by_name text, notes text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE approval_request_logs (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id text, request_id text,
        tier_level int, action text, action_by bigint, action_by_name text, action_role text, notes text,
        created_at timestamptz DEFAULT now());
      CREATE TABLE purchase_orders (id bigint PRIMARY KEY, tenant_id text, account_id text, order_number text,
        supplier_id bigint, supplier_name text, supplier_phone text, warehouse_id bigint, warehouse_name text,
        subtotal numeric, tax_amount numeric, discount_amount numeric, total_amount numeric, status text,
        expected_delivery_date timestamptz, converted_purchase_id bigint, notes text, terms_conditions text,
        created_by bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      INSERT INTO users(id,tenant_id,username,role,is_active) VALUES
        (1,'t1','admin1','admin',true),
        (2,'t1','admin2','admin',false),
        (3,'t1','cashier3','cashier',true),
        (9,'t2','owner','super_admin',true);
      INSERT INTO approval_rules(id,tenant_id,module,min_amount,max_amount,tier_level,required_role,approver_user_id,is_active) VALUES
        ('rule-t1-1','t1','purchase_orders',0,NULL,1,'admin',NULL,true),
        ('rule-t1-2','t1','purchase_orders',0,NULL,2,'admin',NULL,true),
        ('rule-t2-1','t2','purchase_orders',0,NULL,1,'admin',NULL,true);
      INSERT INTO purchase_orders(id,tenant_id,account_id,order_number,supplier_name,status) VALUES
        (101,'t1','a1','PO-101','Supplier A','pending_approval'),
        (102,'t1','a1','PO-102','Supplier A','pending_approval'),
        (103,'t1','a1','PO-103','Supplier A','pending_approval'),
        (104,'t1','a1','PO-104','Supplier A','pending_approval'),
        (105,'t1','a1','PO-105','Supplier A','pending_approval'),
        (106,'t1','a1','PO-106','Supplier A','pending_approval'),
        (107,'t1','a1','PO-107','Supplier A','pending_approval'),
        (108,'t2','a2','PO-108','Supplier A','pending_approval');
      INSERT INTO approval_requests(id,tenant_id,module,record_id,record_ref,amount,currency,current_tier,max_tier,status,requested_by,requested_by_name) VALUES
        ('req-1','t1','purchase_orders','101','PO-101',1000,'EGP',1,1,'pending',1,'admin1'),
        ('req-2','t1','purchase_orders','102','PO-102',1000,'EGP',1,1,'pending',1,'admin1'),
        ('req-3','t1','purchase_orders','103','PO-103',1000,'EGP',1,2,'pending',1,'admin1'),
        ('req-4','t1','purchase_orders','104','PO-104',1000,'EGP',1,1,'pending',1,'admin1'),
        ('req-5','t1','purchase_orders','105','PO-105',1000,'EGP',1,1,'pending',1,'admin1'),
        ('req-6','t1','purchase_orders','106','PO-106',1000,'EGP',1,1,'pending',1,'admin1'),
        ('req-7','t1','purchase_orders','107','PO-107',1000,'EGP',1,1,'pending',3,'cashier3'),
        ('req-8','t2','purchase_orders','108','PO-108',1000,'EGP',1,1,'pending',9,'owner');
    `);

    // ---------- Solo admin approves their OWN request: allowed + override logged. ----------
    // (admin2 exists in t1 but is INACTIVE, so no second admin is available.)
    const approved = await approvals.approveRequest('req-1', '', admin1);
    assert.equal(approved.status, 'approved', 'a solo admin approving their own PO request must succeed');
    assert.equal(approved.isFullyApproved, true, 'a single-tier solo approval must fully approve');
    assert.equal((await requestRow('req-1')).status, 'approved', 'the request must be approved');
    assert.equal(await poStatus(101), 'confirmed', 'the purchase order must move to confirmed');
    const logs1 = await logsFor('req-1');
    assert.equal(logs1.length, 1, 'exactly one decision log row must be written');
    assert.equal(logs1[0].action, 'approved', 'the log action must be approved');
    assert.equal(Number(logs1[0].action_by), 1, 'the log must record the requester as the decider');
    assert.ok(String(logs1[0].notes || '').includes('اعتماد منفرد بقرار إداري'), 'the log must carry the solo-admin override stamp');
    assert.ok(String(logs1[0].notes || '').includes('admin1'), 'the override stamp must name who decided');
    assert.ok(String(logs1[0].notes || '').includes('لا يوجد مدير ثانٍ متاح'), 'the override stamp must record that no second admin was available');

    // ---------- Solo admin rejects their OWN request: allowed + override logged. ----------
    const rejected = await approvals.rejectRequest('req-2', 'السعر مرتفع', admin1);
    assert.equal(rejected.status, 'rejected', 'a solo admin rejecting their own PO request must succeed');
    assert.equal((await requestRow('req-2')).status, 'rejected', 'the request must be rejected');
    assert.equal(await poStatus(102), 'draft', 'the purchase order must return to draft');
    const logs2 = await logsFor('req-2');
    assert.equal(logs2.length, 1, 'exactly one decision log row must be written');
    assert.equal(logs2[0].action, 'rejected', 'the log action must be rejected');
    assert.equal(Number(logs2[0].action_by), 1, 'the log must record the requester as the decider');
    assert.ok(String(logs2[0].notes || '').includes('السعر مرتفع'), 'the rejection reason must stay in the log');
    assert.ok(String(logs2[0].notes || '').includes('رفض منفرد بقرار إداري'), 'the log must carry the solo-admin override stamp');
    assert.ok(String(logs2[0].notes || '').includes('لا يوجد مدير ثانٍ متاح'), 'the override stamp must record that no second admin was available');

    // ---------- Solo admin clears a 2-tier request alone, tier by tier. ----------
    const tier1 = await approvals.approveRequest('req-3', '', admin1);
    assert.equal(tier1.status, 'pending', 'tier 1 of a 2-tier solo approval must leave the request pending');
    assert.equal(tier1.currentTier, 2, 'tier 1 must advance the request to tier 2');
    assert.equal(await poStatus(103), 'pending_approval', 'the order must stay pending until the last tier');
    const tier2 = await approvals.approveRequest('req-3', '', admin1);
    assert.equal(tier2.status, 'approved', 'tier 2 must fully approve the solo request');
    assert.equal(await poStatus(103), 'confirmed', 'the order must confirm after the last tier');
    const logs3 = await logsFor('req-3');
    assert.equal(logs3.length, 2, 'one log row per tier must be written');
    assert.ok(logs3.every((l) => String(l.notes || '').includes('اعتماد منفرد بقرار إداري')), 'both tier log rows must carry the override stamp');

    // ---------- Solo super_admin in their own tenant approves their own request. ----------
    const superApproved = await approvals.approveRequest('req-8', '', superAdmin);
    assert.equal(superApproved.status, 'approved', 'a solo super_admin approving their own PO request must succeed');
    assert.equal(await poStatus(108), 'confirmed', 'the super_admin order must confirm');
    const logs8 = await logsFor('req-8');
    assert.equal(logs8.length, 1, 'exactly one decision log row must be written');
    assert.ok(String(logs8[0].notes || '').includes('اعتماد منفرد بقرار إداري'), 'the log must carry the solo-admin override stamp');
    assert.ok(String(logs8[0].notes || '').includes('owner'), 'the override stamp must name the super_admin who decided');

    // ---------- A non-admin requester still may NOT decide their own request. ----------
    await expectForbidden(
      approvals.approveRequest('req-7', '', cashier3),
      SELF_APPROVE_MSG,
      'a cashier approving their own PO request must still be refused',
    );
    assert.equal((await requestRow('req-7')).status, 'pending', 'a refused decision must leave the request pending');
    assert.equal(await poStatus(107), 'pending_approval', 'a refused decision must leave the order pending approval');
    assert.equal((await logsFor('req-7')).length, 0, 'a refused decision must log nothing');

    // ---------- Activate the second admin: the old ban returns. ----------
    await pg.query(`UPDATE users SET is_active=true WHERE id=2`);

    // ---------- A second admin deciding works as before, with NO override stamp. ----------
    const secondApproved = await approvals.approveRequest('req-4', '', admin2);
    assert.equal(secondApproved.status, 'approved', 'a second admin approving the request must still succeed');
    assert.equal(await poStatus(104), 'confirmed', 'the order must confirm on a second-admin approval');
    const logs4 = await logsFor('req-4');
    assert.equal(logs4.length, 1, 'exactly one decision log row must be written');
    assert.equal(Number(logs4[0].action_by), 2, 'the log must record the second admin as the decider');
    assert.ok(!String(logs4[0].notes || '').includes('منفرد'), 'a second-admin decision must not carry the solo-override stamp');

    // ---------- Self-decision when a second admin EXISTS is still refused (approve). ----------
    await expectForbidden(
      approvals.approveRequest('req-5', '', admin1),
      SELF_APPROVE_MSG,
      'a requester approving their own request while a second admin exists must still be refused',
    );
    assert.equal((await requestRow('req-5')).status, 'pending', 'a refused decision must leave the request pending');
    assert.equal(await poStatus(105), 'pending_approval', 'a refused decision must leave the order pending approval');
    assert.equal((await logsFor('req-5')).length, 0, 'a refused decision must log nothing');

    // ---------- Self-decision when a second admin EXISTS is still refused (reject). ----------
    await expectForbidden(
      approvals.rejectRequest('req-6', 'لا أحتاجه', admin1),
      SELF_REJECT_MSG,
      'a requester rejecting their own request while a second admin exists must still be refused',
    );
    assert.equal((await requestRow('req-6')).status, 'pending', 'a refused decision must leave the request pending');
    assert.equal(await poStatus(106), 'pending_approval', 'a refused decision must leave the order pending approval');
    assert.equal((await logsFor('req-6')).length, 0, 'a refused decision must log nothing');

    // ---------- Wiring: this spec is in both critical lists, in identical order (324 specs — the solo-admin-import-approval-override spec is the last entry). ----------
    {
      const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8')).specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 324);
      assert.equal(chain.length, 324);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/solo-admin-po-self-approval-override.spec.ts'));
      console.log('wiring: evidence spec in both critical lists (324 = 324, identical order), passed');
    }

    console.log('Solo-admin PO self-approval override tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
