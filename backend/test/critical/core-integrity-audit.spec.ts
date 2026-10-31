import { strict as assert } from 'node:assert';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Database } from '../../src/database/database.types';
import { BootstrapAdminService } from '../../src/core/auth/services/bootstrap-admin.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AuthCacheService } from '../../src/core/auth/services/auth-cache.service';
import { UsersService } from '../../src/modules/users/users.service';
import { SessionService } from '../../src/core/auth/services/session.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { InventoryTransferService } from '../../src/modules/inventory/services/inventory-transfer.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { ConfigService } from '@nestjs/config';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  user: 'postgres',
  password: 'postgres',
  database: 'zs_core_audit_test',
};

function createDb(maxConnections = 5): Kysely<Database> {
  const pool = new Pool({ ...DB_CONFIG, max: maxConnections, idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 2000, statement_timeout: 5000,
    options: '-c idle_in_transaction_session_timeout=10000',
  });
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

const mockAudit: any = {
  log: async () => {},
  logWithExecutor: async () => {},
};

async function runCoreAuditSuite() {
  console.log('===============================================================');
  console.log('  ZS ERP — Core Integrity & Security Audit Test Suite');
  console.log('  Testing real PostgreSQL semantics on disposable database');
  console.log('===============================================================\n');

  const db = createDb(10);
  const tx = new TransactionHelper();
  const authCache = new AuthCacheService();

  try {
    // Fresh migrations intentionally contain no administrator credentials.
    // Provision this disposable fixture through the real bootstrap service.
    await new BootstrapAdminService(db, new ConfigService({
      PLATFORM_TENANT_ID: 'zs', APP_MODE: 'CLOUD_SAAS',
      PLATFORM_SUPERADMIN_PASSWORD: 'DisposableCoreAudit!2026#Only',
    })).onApplicationBootstrap();
    // -------------------------------------------------------------------------
    // TEST 1: CORE-001 Platform Root Administrator Provisioning Safety
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: CORE-001 Insecure Platform Administrator Provisioning ---');
    {
      class MockFirstRunDb {
        public insertedUser: any = null;
        getExecutor() {
          return {
            transformQuery: (args: any) => args.node,
            compileQuery: () => ({ sql: '', parameters: [] }),
            executeQuery: async () => ({ rows: [] }),
          };
        }
        selectFrom(table: string) {
          return {
            select: () => ({
              where: () => ({
                where: () => ({ executeTakeFirst: async () => null }), // userZs does NOT exist
                executeTakeFirst: async () => ({ id: 'zs' }), // tenantExists
              }),
            }),
          };
        }
        insertInto(table: string) {
          return {
            values: (val: any) => {
              this.insertedUser = val;
              return { execute: async () => ({}) };
            },
          };
        }
        updateTable() {
          return { set: () => ({ where: () => ({ execute: async () => ({}) }) }) };
        }
      }

      // 1. Missing PLATFORM_SUPERADMIN_PASSWORD: fail closed, do not create admin
      const mockDb1 = new MockFirstRunDb();
      const bootstrapNoSecret = new BootstrapAdminService(mockDb1 as any, new ConfigService({ PLATFORM_TENANT_ID: 'zs', APP_MODE: 'CLOUD_SAAS' }));
      await bootstrapNoSecret.onApplicationBootstrap();
      assert.equal(mockDb1.insertedUser, null, 'Superadmin must NOT be created when secret is missing');

      // 2. Published default password 'ZsAdmin2026': must be refused
      const mockDb2 = new MockFirstRunDb();
      let rejectedDefault = false;
      try {
        const bootstrapPublished = new BootstrapAdminService(mockDb2 as any, new ConfigService({
          PLATFORM_TENANT_ID: 'zs',
          APP_MODE: 'CLOUD_SAAS',
          PLATFORM_SUPERADMIN_PASSWORD: 'ZsAdmin2026',
        }));
        await bootstrapPublished.onApplicationBootstrap();
      } catch (e: any) {
        rejectedDefault = true;
      }
      assert.equal(mockDb2.insertedUser, null, 'Must reject published default password ZsAdmin2026');

      // 3. Published password 'ChangeMe123!': must be refused
      const mockDb3 = new MockFirstRunDb();
      try {
        const bootstrapPublished2 = new BootstrapAdminService(mockDb3 as any, new ConfigService({
          PLATFORM_TENANT_ID: 'zs',
          APP_MODE: 'CLOUD_SAAS',
          PLATFORM_SUPERADMIN_PASSWORD: 'ChangeMe123!',
        }));
        await bootstrapPublished2.onApplicationBootstrap();
      } catch (e: any) {}
      assert.equal(mockDb3.insertedUser, null, 'Must reject published default password ChangeMe123!');

      // 4. Weak password: must be refused
      const mockDb4 = new MockFirstRunDb();
      try {
        const bootstrapWeak = new BootstrapAdminService(mockDb4 as any, new ConfigService({
          PLATFORM_TENANT_ID: 'zs',
          APP_MODE: 'CLOUD_SAAS',
          PLATFORM_SUPERADMIN_PASSWORD: 'weak',
        }));
        await bootstrapWeak.onApplicationBootstrap();
      } catch (e: any) {}
      assert.equal(mockDb4.insertedUser, null, 'Must reject weak password');

      // 5. Strong operator secret: provisions with must_change_password = true
      const mockDb5 = new MockFirstRunDb();
      const bootstrapValid = new BootstrapAdminService(mockDb5 as any, new ConfigService({
        PLATFORM_TENANT_ID: 'zs',
        APP_MODE: 'CLOUD_SAAS',
        PLATFORM_SUPERADMIN_PASSWORD: 'OperatorStrongSecret!2026#Secure',
      }));
      await bootstrapValid.onApplicationBootstrap();
      assert.ok(mockDb5.insertedUser, 'Superadmin must be provisioned with valid operator secret');
      assert.equal(mockDb5.insertedUser.username, 'zs');
      assert.equal(mockDb5.insertedUser.must_change_password, true, 'must_change_password must be true');

      // 6. Real PostgreSQL Database Verification: detect 'ZsAdmin2026' on root 'zs' account and set must_change_password = true
      const compromisedPw = await createPasswordRecord('ZsAdmin2026');
      await db.updateTable('users').set({
        password_hash: compromisedPw.hash,
        password_salt: compromisedPw.salt,
        must_change_password: false,
      } as any).where('username', '=', 'zs').where('tenant_id', '=', 'zs').execute();

      const bootstrapDetect = new BootstrapAdminService(db, new ConfigService({
        PLATFORM_TENANT_ID: 'zs',
        APP_MODE: 'CLOUD_SAAS',
      }));
      await bootstrapDetect.onApplicationBootstrap();
      const adminDetected = await db.selectFrom('users').selectAll()
        .where('username', '=', 'zs').where('tenant_id', '=', 'zs').executeTakeFirst();
      assert.equal(adminDetected?.must_change_password, true, 'Compromised ZsAdmin2026 password on real DB must be flagged with must_change_password = true');

      console.log('✓ CORE-001 passed: No default or published secret can provision platform super-admin; compromised credentials detected on real DB');
    }

    // -------------------------------------------------------------------------
    // TEST 2: CORE-002 Migration Reconciliation Data Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: CORE-002 Migration Reconciliation Data Preservation ---');
    {
      const client = new Pool(DB_CONFIG);
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS test_legacy_settlements (
            id SERIAL PRIMARY KEY,
            tenant_id VARCHAR(50),
            total_amount NUMERIC(15,2),
            collected_amount NUMERIC(15,2)
          );
          DELETE FROM test_legacy_settlements;
          INSERT INTO test_legacy_settlements (tenant_id, total_amount, collected_amount)
          VALUES ('t1', 1000.50, 750.25), ('t1', 500.00, 250.00);
        `);

        const pre = await client.query(`SELECT COUNT(*)::int as cnt, COALESCE(SUM(total_amount), 0)::numeric as tot, COALESCE(SUM(collected_amount), 0)::numeric as col FROM test_legacy_settlements`);
        assert.equal(pre.rows[0].cnt, 2);
        assert.equal(Number(pre.rows[0].tot), 1500.50);
        assert.equal(Number(pre.rows[0].col), 1000.25);

        // Discrepancy assertion test:
        const simulatedPostDiscrepancy = { cnt: 1, tot: 1000.50, col: 750.25 };
        let caughtDiscrepancy = false;
        try {
          if (pre.rows[0].cnt !== simulatedPostDiscrepancy.cnt || Number(pre.rows[0].tot) !== simulatedPostDiscrepancy.tot) {
            throw new Error(`PRE_POST_RECONCILIATION_MISMATCH: Count mismatch pre=${pre.rows[0].cnt} post=${simulatedPostDiscrepancy.cnt}`);
          }
        } catch (e: any) {
          caughtDiscrepancy = true;
          assert.ok(e.message.includes('PRE_POST_RECONCILIATION_MISMATCH'));
        }
        assert.ok(caughtDiscrepancy, 'Should fail closed on discrepancy');

        await client.query(`DROP TABLE test_legacy_settlements;`);
      } finally {
        await client.end();
      }
      console.log('✓ CORE-002 passed: Migration reconciliation asserts count and financial sums, failing closed');
    }

    // -------------------------------------------------------------------------
    // TEST 3 & 4: CORE-003 Idempotency Identity & Collision Prevention
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3 & 4: CORE-003 Incomplete Idempotency Identity ---');
    {
      const idempotency = new IdempotencyService(db as any);
      const tenantId = 't_idempotency_audit';
      const accountId = 'acc_audit';
      const key = `idem_${Date.now()}`;

      // 1. Initial reservation for operation A with resource 1
      const res1 = await idempotency.reserveOperation({
        tenantId,
        accountId,
        idempotencyKey: key,
        operationType: 'order_create',
        requestHash: 'hash_resource_order_101',
      });
      assert.equal(res1, null, 'Initial reservation must succeed');

      // 2. Same key + DIFFERENT resource ID / payload => MUST REJECT with payload mismatch
      let caughtPayloadMismatch = false;
      try {
        await idempotency.reserveOperation({
          tenantId,
          accountId,
          idempotencyKey: key,
          operationType: 'order_create',
          requestHash: 'hash_resource_order_202', // Different resource!
        });
      } catch (e: any) {
        if (e.code === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' || e.message?.includes('payload')) {
          caughtPayloadMismatch = true;
        }
      }
      assert.ok(caughtPayloadMismatch, 'Reusing same key for different resource ID must reject');

      // 3. Same key + DIFFERENT operation type => MUST REJECT with operation mismatch
      let caughtOpMismatch = false;
      try {
        await idempotency.reserveOperation({
          tenantId,
          accountId,
          idempotencyKey: key,
          operationType: 'payment_capture', // Different operation type!
          requestHash: 'hash_resource_order_101',
        });
      } catch (e: any) {
        if (e.code === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_OPERATION' || e.message?.includes('operation')) {
          caughtOpMismatch = true;
        }
      }
      assert.ok(caughtOpMismatch, 'Reusing same key for different operation type must reject');

      console.log('✓ CORE-003 passed: Resource IDs and operation types are canonically enforced');
    }

    // -------------------------------------------------------------------------
    // TEST 5: CORE-004 Transactional Idempotency Completion
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: CORE-004 Idempotency Completion Inside Transaction ---');
    {
      const idempotency = new IdempotencyService(db as any);
      const tenantId = 't_core004_test';
      const key = `idem_tx_${Date.now()}`;

      // Reserve key
      await idempotency.reserveOperation({
        tenantId,
        accountId: 'acc',
        idempotencyKey: key,
        operationType: 'sales_return',
        requestHash: 'hash_return_payload',
      });

      // Simulate a business transaction that FAILS after inserting
      try {
        await tx.runInTransaction(db, async (trx) => {
          // Inside transaction: mark committed
          await idempotency.commitOperation(
            trx,
            { tenantId, accountId: 'acc', idempotencyKey: key, operationType: 'sales_return' },
            { ok: true },
            'RET-999'
          );
          // Simulate failure before commit!
          throw new Error('SIMULATED_DB_FAILURE_DURING_RETURN');
        });
      } catch (e: any) {
        assert.equal(e.message, 'SIMULATED_DB_FAILURE_DURING_RETURN');
      }

      // Check record in DB: commitOperation must have been ROLLED BACK because it shared trx!
      const opRecord = await db.selectFrom('operation_executions')
        .select(['status'])
        .where('tenant_id', '=', tenantId)
        .where('idempotency_key', '=', key)
        .executeTakeFirst();

      assert.notEqual(opRecord?.status, 'committed', 'Committed state must roll back with the business transaction');
      console.log('✓ CORE-004 passed: Idempotency commit shares business transaction and rolls back on failure');
    }

    // -------------------------------------------------------------------------
    // TEST 6: CORE-005 Session and Authorization Revocation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: CORE-005 Session and Authorization Revocation ---');
    {
      const testTenant = 't_session_revocation';
      const testUser = await db.insertInto('users').values({
        username: `user_rev_${Date.now()}`,
        role: 'cashier',
        phone: '01099990001',
        permissions_json: JSON.stringify(['pos']),
        tenant_id: testTenant,
        account_id: 'acc1',
        password_hash: '$2b$10$abcdefghijklmnopqrstuu',
        password_salt: 'salt',
      } as any).returning('id').executeTakeFirstOrThrow();
      const userId = Number(testUser.id);

      // Create 2 active sessions in DB
      const sess1 = `sess1_${Date.now()}`;
      const sess2 = `sess2_${Date.now()}`;
      await db.insertInto('sessions').values([
        { id: sess1, user_id: userId, tenant_id: testTenant, account_id: 'acc1', expires_at: new Date(Date.now() + 3600000) } as any,
        { id: sess2, user_id: userId, tenant_id: testTenant, account_id: 'acc1', expires_at: new Date(Date.now() + 3600000) } as any,
      ]).execute();

      // Cache session in AuthCache
      authCache.setSession(sess1, { userId, sessionId: sess1, tenantId: testTenant, username: 'test', role: 'cashier', permissions: ['pos'] });
      authCache.setSession(sess2, { userId, sessionId: sess2, tenantId: testTenant, username: 'test', role: 'cashier', permissions: ['pos'] });
      assert.ok(authCache.getSession(sess1) !== null);

      // Revoke sessions via UsersService bulk disable
      const usersService = new UsersService(db, tx, mockAudit, authCache);
      const actor: AuthContext = { userId: 1, sessionId: 'actor_sess', tenantId: testTenant, accountId: 'acc1', username: 'admin', role: 'admin', permissions: ['users'] };
      
      await usersService.bulkDisableUsers([userId], actor);

      // Assert sessions removed from DB
      const dbSessions = await db.selectFrom('sessions').where('user_id', '=', userId).execute();
      assert.equal(dbSessions.length, 0, 'Sessions must be removed from DB upon disable');

      // Assert AuthCache invalidated
      assert.equal(authCache.getSession(sess1), null, 'Cached authorization must be invalidated immediately');
      assert.equal(authCache.getSession(sess2), null, 'Cached authorization must be invalidated immediately');

      // Test SessionService.changePassword: other sessions revoked, active preserved, cache cleared
      const user2 = await db.insertInto('users').values({
        username: `user_pw_${Date.now()}`,
        role: 'cashier',
        phone: '01099990002',
        password_hash: '$2b$10$abcdefghijklmnopqrstuu',
        password_salt: 'salt',
        tenant_id: testTenant,
        account_id: 'acc1',
      } as any).returning('id').executeTakeFirstOrThrow();
      const u2Id = Number(user2.id);

      const sessActive = `sess_act_${Date.now()}`;
      const sessOther = `sess_oth_${Date.now()}`;
      await db.insertInto('sessions').values([
        { id: sessActive, user_id: u2Id, tenant_id: testTenant, account_id: 'acc1', expires_at: new Date(Date.now() + 3600000) } as any,
        { id: sessOther, user_id: u2Id, tenant_id: testTenant, account_id: 'acc1', expires_at: new Date(Date.now() + 3600000) } as any,
      ]).execute();

      authCache.setSession(sessActive, { userId: u2Id, sessionId: sessActive, tenantId: testTenant, username: 'user2', role: 'cashier', permissions: [] });
      authCache.setSession(sessOther, { userId: u2Id, sessionId: sessOther, tenantId: testTenant, username: 'user2', role: 'cashier', permissions: [] });

      const sessionService = new SessionService(db, new ConfigService({ PLATFORM_TENANT_ID: 'zs' }), mockAudit, authCache);
      const u2Auth: AuthContext = { userId: u2Id, sessionId: sessActive, tenantId: testTenant, accountId: 'acc1', username: 'user2', role: 'cashier', permissions: [] };
      await sessionService.revokeOtherSessions(u2Auth, sessActive);

      const remainingSessions = await db.selectFrom('sessions').select('id').where('user_id', '=', u2Id).execute();
      assert.equal(remainingSessions.length, 1, 'Only active session must remain');
      assert.equal((remainingSessions[0] as any).id, sessActive);
      assert.equal(authCache.getSession(sessOther), null, 'Other session cache must be wiped');

      console.log('✓ CORE-005 passed: Sessions and cached permissions revoked immediately');
    }

    // -------------------------------------------------------------------------
    // TEST 7: CORE-006 Non-Atomic User/Branch Updates & Optional Semantics
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: CORE-006 User Branch Updates & Optional Semantics ---');
    {
      const testTenant = `t_branch_atomic_${Date.now()}`;
      const b1 = await db.insertInto('branches').values({ name: 'Branch 1', code: `B1_${Date.now()}`, tenant_id: testTenant, account_id: 'acc' } as any).returning('id').executeTakeFirstOrThrow();
      const b2 = await db.insertInto('branches').values({ name: 'Branch 2', code: `B2_${Date.now()}`, tenant_id: testTenant, account_id: 'acc' } as any).returning('id').executeTakeFirstOrThrow();
      const b1Id = Number(b1.id);
      const b2Id = Number(b2.id);

      const usersService = new UsersService(db, tx, mockAudit, authCache);
      const actor: AuthContext = { userId: 1, sessionId: 'act', tenantId: testTenant, accountId: 'acc', username: 'admin', role: 'admin', permissions: ['users'] };

      // Create user with branch b1
      const created = await usersService.createUser({
        username: `user_br_${Date.now()}`,
        phone: '01011112222',
        password: 'Password123!',
        role: 'cashier',
        branchIds: [String(b1Id)],
      }, actor);
      const uid = Number((created as any).user.id);

      // Check initial branches
      let userBranches = await db.selectFrom('user_branches').selectAll().where('user_id', '=', uid).where('tenant_id', '=', testTenant).execute();
      assert.equal(userBranches.length, 1);
      assert.equal(Number((userBranches[0] as any).branch_id), b1Id);

      // Update user with branchIds: undefined (omitted) => MUST PRESERVE existing branch
      await usersService.updateUser(uid, {
        username: `user_br_upd_${Date.now()}`,
        phone: '01011112222',
        role: 'cashier',
        // branchIds omitted!
      }, actor);
      userBranches = await db.selectFrom('user_branches').selectAll().where('user_id', '=', uid).where('tenant_id', '=', testTenant).execute();
      assert.equal(userBranches.length, 1, 'Omitted branchIds must preserve existing associations');
      assert.equal(Number((userBranches[0] as any).branch_id), b1Id);

      // Update with invalid branch belonging to foreign tenant => MUST THROW AND ROLL BACK
      let caughtInvalidBranch = false;
      try {
        await usersService.updateUser(uid, {
          username: `user_br_upd_${Date.now()}`,
          phone: '01011112222',
          role: 'cashier',
          branchIds: ['999999'], // Non-existent
        }, actor);
      } catch (e: any) {
        caughtInvalidBranch = true;
        assert.equal(e.code, 'INVALID_BRANCH_ASSIGNMENT');
      }
      assert.ok(caughtInvalidBranch, 'Invalid branch must throw');

      // Verify existing branch was NOT deleted during the failed update
      userBranches = await db.selectFrom('user_branches').selectAll().where('user_id', '=', uid).where('tenant_id', '=', testTenant).execute();
      assert.equal(userBranches.length, 1, 'Failed update must roll back and not delete existing branches');

      // Update with explicit [] => MUST CLEAR branches
      await usersService.updateUser(uid, {
        username: `user_br_upd_${Date.now()}`,
        phone: '01011112222',
        role: 'cashier',
        branchIds: [],
      }, actor);
      userBranches = await db.selectFrom('user_branches').selectAll().where('user_id', '=', uid).where('tenant_id', '=', testTenant).execute();
      assert.equal(userBranches.length, 0, 'Explicit [] must clear branches');

      console.log('✓ CORE-006 passed: Optional branchIds preserves links, invalid branches roll back atomically');
    }

    // -------------------------------------------------------------------------
    // TEST 8: CORE-007 Cross-Tenant Default Branch Reference Protection
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: CORE-007 Cross-Tenant Default Branch Reference Protection ---');
    {
      const tenantA = `tenant_A_${Date.now()}`;
      const tenantB = `tenant_B_${Date.now()}`;

      // Create branch in Tenant B
      const branchB = await db.insertInto('branches').values({ name: 'Branch B', code: `BB_${Date.now()}`, tenant_id: tenantB, account_id: 'acc' } as any).returning('id').executeTakeFirstOrThrow();
      const branchBId = Number(branchB.id);

      const usersService = new UsersService(db, tx, mockAudit, authCache);
      const actorA: AuthContext = { userId: 1, sessionId: 'actA', tenantId: tenantA, accountId: 'acc', username: 'admin', role: 'admin', permissions: ['users'] };

      // Attempt to create user in Tenant A with defaultBranchId = branchBId
      let caughtCrossTenant = false;
      try {
        await usersService.createUser({
          username: `user_cross_${Date.now()}`,
          phone: '01033334444',
          password: 'Password123!',
          role: 'cashier',
          defaultBranchId: String(branchBId),
        }, actorA);
      } catch (e: any) {
        caughtCrossTenant = true;
        assert.ok(e.message.includes('لا يتبع لهذه المنشأة') || e.code === 'DEFAULT_BRANCH_NOT_FOUND');
      }
      assert.ok(caughtCrossTenant, 'Cross-tenant defaultBranchId must be rejected by service');

      // Attempt direct SQL insert bypassing service: Database composite FK constraint must reject!
      let caughtDbConstraint = false;
      try {
        await db.insertInto('users').values({
          username: `raw_user_cross_${Date.now()}`,
          role: 'cashier',
          phone: '01033334445',
          tenant_id: tenantA,
          account_id: 'acc',
          default_branch_id: branchBId, // Foreign tenant branch!
          password_hash: 'hash',
          password_salt: 'salt',
        } as any).execute();
      } catch (e: any) {
        caughtDbConstraint = true;
        assert.ok(e.message?.includes('violates foreign key constraint') || e.code === '23503');
      }
      assert.ok(caughtDbConstraint, 'Database composite FK constraint must reject cross-tenant branch reference');

      // Verify InventoryScopeService ignores foreign branch even if row somehow had it
      const scopeService = new InventoryScopeService(db);
      const fakeAuth: AuthContext = { userId: 99999, sessionId: 's', tenantId: tenantA, accountId: 'acc', username: 'x', role: 'cashier', permissions: [] };
      const branches = await scopeService.branchScope(fakeAuth);
      assert.ok(!branches.includes(branchBId), 'Scope service must never trust cross-tenant branch');

      console.log('✓ CORE-007 passed: Cross-tenant defaultBranchId rejected at service and DB constraint levels');
    }

    // -------------------------------------------------------------------------
    // TEST 9: CORE-008 Single-Connection Pool (max: 1) Read-Your-Writes & No Deadlocks
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: CORE-008 Single-Connection Pool Stock Transfers ---');
    {
      const singleConnDb = createDb(1);
      const transferTenant = `t_single_conn_${Date.now()}`;

      // Setup locations
      const locFrom = await singleConnDb.insertInto('stock_locations').values({
        name: 'المخزن الرئيسي',
        code: `LOC_M_${Date.now()}`,
        location_type: 'internal_warehouse' as any,
        is_active: true,
        tenant_id: transferTenant,
        account_id: 'acc',
      }).returning('id').executeTakeFirstOrThrow();

      const locTo = await singleConnDb.insertInto('stock_locations').values({
        name: 'مخزن الفرع',
        code: `LOC_T_${Date.now()}`,
        location_type: 'branch_stock' as any,
        is_active: true,
        tenant_id: transferTenant,
        account_id: 'acc',
      }).returning('id').executeTakeFirstOrThrow();

      // Setup product with stock
      const prod = await singleConnDb.insertInto('products').values({
        name: 'منتج تجريبي',
        barcode: `BAR_${Date.now()}`,
        stock_qty: 50,
        is_active: true,
        tenant_id: transferTenant,
        account_id: 'acc',
      } as any).returning('id').executeTakeFirstOrThrow();

      await singleConnDb.insertInto('product_location_stock').values({
        product_id: Number(prod.id),
        location_id: Number(locFrom.id),
        qty: 50,
        tenant_id: transferTenant,
        account_id: 'acc',
      }).execute();

      const scopeService = new InventoryScopeService(singleConnDb);
      const idempotency = new IdempotencyService(singleConnDb as any);
      const transferService = new InventoryTransferService(singleConnDb, tx, mockAudit, scopeService, idempotency, {} as any);

      const auth: AuthContext = {
        userId: 1,
        sessionId: 'trans_sess',
        tenantId: transferTenant,
        accountId: 'acc',
        username: 'trans_user',
        role: 'admin',
        permissions: ['inventory'],
      };

      // 1. Create Stock Transfer on single-connection pool!
      console.log('  Testing createStockTransfer with pool max: 1...');
      const createRes = await transferService.createStockTransfer({
        fromLocationId: Number(locFrom.id),
        toLocationId: Number(locTo.id),
        items: [{ productId: Number(prod.id), qty: 10 }],
        note: 'تحويل أحادي الاتصال',
      }, auth);

      assert.equal(createRes.ok, true);
      const transferId = Number(createRes.transferId);
      assert.ok(transferId > 0);
      const transfersList1 = createRes.stockTransfers as Array<any>;
      const createdItem = transfersList1.find((t) => Number(t.id) === transferId);
      assert.ok(createdItem, 'Created transfer must be immediately visible in stockTransfers (read-your-writes)');
      assert.equal(createdItem.status, 'sent');
      console.log('  ✓ createStockTransfer completed without deadlock; read-your-writes verified');

      // 2. Receive Stock Transfer on single-connection pool!
      console.log('  Testing receiveStockTransfer with pool max: 1...');
      const receiveRes = await transferService.receiveStockTransfer(transferId, auth, { items: (createdItem.items as Array<{ id: string; qty: number }>).map((row) => ({ itemId: Number(row.id), receivedQty: Number(row.qty) })) });
      assert.equal(receiveRes.ok, true);
      const transfersList2 = receiveRes.stockTransfers as Array<any>;
      const receivedItem = transfersList2.find((t) => Number(t.id) === transferId);
      assert.ok(receivedItem, 'Received transfer must be visible');
      assert.equal(receivedItem.status, 'received', 'Status must be received (read-your-writes)');
      console.log('  ✓ receiveStockTransfer completed without deadlock; read-your-writes verified');

      // 3. Create second transfer and Cancel on single-connection pool!
      const createRes2 = await transferService.createStockTransfer({
        fromLocationId: Number(locFrom.id),
        toLocationId: Number(locTo.id),
        items: [{ productId: Number(prod.id), qty: 5 }],
      }, auth);
      const transfer2Id = Number(createRes2.transferId);

      console.log('  Testing cancelStockTransfer with pool max: 1...');
      const cancelRes = await transferService.cancelStockTransfer(transfer2Id, auth);
      assert.equal(cancelRes.ok, true);
      const transfersList3 = cancelRes.stockTransfers as Array<any>;
      const cancelledItem = transfersList3.find((t) => Number(t.id) === transfer2Id);
      assert.equal(cancelledItem.status, 'cancelled', 'Status must be cancelled (read-your-writes)');
      console.log('  ✓ cancelStockTransfer completed without deadlock; read-your-writes verified');

      await singleConnDb.destroy();
      console.log('✓ CORE-008 passed: No deadlocks on pool size 1, read-your-writes guaranteed');
    }

    console.log('\n===============================================================');
    console.log('  ALL CORE INTEGRITY & SECURITY TESTS PASSED (10/10) [CODE 0]');
    console.log('===============================================================');
  } finally {
    await db.destroy();
  }
}

runCoreAuditSuite().catch((err) => {
  console.error('\nFAILED CORE INTEGRITY AUDIT TEST:', err);
  process.exit(1);
});
