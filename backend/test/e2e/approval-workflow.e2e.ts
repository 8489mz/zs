import assert from 'node:assert/strict';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { resolveDatabaseConfigFromEnv } from '../../src/database/migration-runner';
import { resolvePgSslConfig } from '../../src/database/ssl.util';
import type { Database } from '../../src/database/database.types';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { ApprovalWorkflowService } from '../../src/modules/approvals/approval-workflow.service';
import { PurchaseOrdersService } from '../../src/modules/purchases/services/purchase-orders.service';
import { migration as purchaseOrderMigration } from '../../src/database/migrations/2040000000060_purchase_orders_and_unbuild';
import { migration as approvalsMigration } from '../../src/database/migrations/2040000000071_multi_tier_approval_workflows';

async function main(): Promise<void> {
  const embedded = process.argv.includes('--embedded') || process.env.TEST_USE_PGLITE === '1';
  const db = embedded
    ? new Kysely<Database>({ dialect: new PGliteDialect(new PGlite()) })
    : (() => {
        const config = resolveDatabaseConfigFromEnv();
        const pool = new Pool({
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
          database: config.name,
          ssl: resolvePgSslConfig({
            enabled: config.ssl,
            rejectUnauthorized: config.sslRejectUnauthorized,
            caCert: config.sslCaCert,
          }),
        });
        return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
      })();
  if (embedded) {
    await purchaseOrderMigration.up(db);
    await approvalsMigration.up(db as unknown as Kysely<unknown>);
  }
  const tenantId = '__approval_e2e_tmp__';
  const maker: AuthContext = {
    userId: -901,
    username: 'maker',
    role: 'cashier',
    permissions: [],
    sessionId: 'test',
    tenantId,
    accountId: tenantId,
  };
  const approver: AuthContext = { ...maker, userId: -902, username: 'approver', role: 'admin' };
  const other: AuthContext = { ...maker, userId: -903, username: 'other' };
  const rollback = new Error('__rollback_approval_e2e__');
  try {
    await db.transaction().execute(async (trx) => {
      // Keep the test data inside the outer rollback; Kysely does not support
      // starting a nested transaction from a Transaction instance.
      const rollbackDb = Object.assign(Object.create(trx), {
        transaction: () => ({ execute: async <T>(run: (db: typeof trx) => Promise<T>): Promise<T> => run(trx) }),
      }) as Kysely<Database>;
      const approvals = new ApprovalWorkflowService(rollbackDb, {} as any);
      const orders = new PurchaseOrdersService(rollbackDb, {} as any, approvals);
      await sql`insert into approval_rules (tenant_id, module, min_amount, tier_level, required_role)
        values (${tenantId}, 'purchase_orders', 100, 1, 'admin')`.execute(trx);
      const order = await trx
        .insertInto('purchase_orders')
        .values({
          tenant_id: tenantId,
          account_id: tenantId,
          order_number: 'PO-260930-9001',
          supplier_id: 44,
          supplier_name: 'Test supplier',
          total_amount: 500,
          status: 'draft',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('purchase_order_items')
        .values({
          tenant_id: tenantId,
          account_id: tenantId,
          purchase_order_id: order.id,
          product_id: 77,
          product_name: 'Test product',
          quantity: 2,
          unit_cost: 250,
          total: 500,
        })
        .execute();

      await assert.rejects(() => approvals.createRule({ module: 'purchase_orders', minAmount: 0 }, maker));
      const pending = await orders.confirmOrder(order.id, maker);
      assert.equal(pending.status, 'pending_approval');
      assert.equal(
        (await trx.selectFrom('purchase_orders').select('status').where('id', '=', order.id).executeTakeFirstOrThrow())
          .status,
        'pending_approval',
      );
      const request = await trx
        .selectFrom('approval_requests')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();
      const rule = await trx
        .selectFrom('approval_rules')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .executeTakeFirstOrThrow();
      await assert.rejects(() => approvals.updateRule(String(rule.id), { minAmount: -1 }, approver));
      await assert.rejects(() => approvals.updateRule(String(rule.id), { isActive: false }, approver));
      await assert.rejects(() => approvals.deleteRule(String(rule.id), approver));
      await assert.rejects(() => orders.confirmOrder(order.id, maker));
      await assert.rejects(() => orders.convertToBill(order.id, maker));
      await assert.rejects(() => approvals.approveRequest(String(request.id), '', maker));
      await assert.rejects(() => approvals.approveRequest(String(request.id), '', other));
      assert.equal((await approvals.approveRequest(String(request.id), '', approver)).status, 'approved');
      assert.equal(
        (await trx.selectFrom('purchase_orders').select('status').where('id', '=', order.id).executeTakeFirstOrThrow())
          .status,
        'confirmed',
      );
      await assert.rejects(() => approvals.approveRequest(String(request.id), '', approver));

      const second = await trx
        .insertInto('purchase_orders')
        .values({
          tenant_id: tenantId,
          account_id: tenantId,
          order_number: 'PO-260930-9002',
          supplier_name: 'Test supplier',
          total_amount: 500,
          status: 'draft',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await orders.confirmOrder(second.id, maker);
      const rejectedRequest = await trx
        .selectFrom('approval_requests')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('record_id', '=', String(second.id))
        .executeTakeFirstOrThrow();
      assert.equal(
        (await approvals.rejectRequest(String(rejectedRequest.id), 'Not needed', approver)).status,
        'rejected',
      );
      assert.equal(
        (await trx.selectFrom('purchase_orders').select('status').where('id', '=', second.id).executeTakeFirstOrThrow())
          .status,
        'draft',
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.destroy();
  }
  console.log('approval workflow e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
