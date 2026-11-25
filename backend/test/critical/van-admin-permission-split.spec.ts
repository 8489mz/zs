/*
 * F12 (trial problem 15, 2026-11-21): the rep could open supervisor
 * screens — the van-control settings dialog, the van center showing
 * OTHER reps' trips (#5, #6 with their figures), the decision-center
 * dashboard, the manager alerts panel (25 alerts), and the full POS
 * item editor. The backend had no supervisor/admin distinction on
 * these reads: every van-sales-admin route accepted any
 * 'deliveryReps' holder, and GET /api/manager-actions accepted any
 * of dashboard/pos/sales/inventory/customers/accounting/reports.
 *
 * WHAT THIS PINS, driving the REAL PermissionsGuard with a REAL
 * Reflector and the REAL PermissionService (same harness as
 * test/infra/van-sales-admin-feature-gate.spec.ts; PlanFeatureService
 * is stubbed only to model the plan matrix):
 * 1. The new supervisor-only key 'deliveryRepsAdmin' is registered
 *    in SUPER_ADMIN_PERMISSIONS (so the activation owner and the
 *    platform super_admin hold it) and has an Arabic label.
 * 2. The full 64-route admin-controller table: 63 routes require
 *    exactly ['deliveryRepsAdmin']; financial-ledger/push-to-payroll
 *    keeps its already-narrow ('hrPayrollManage', 'accounting') gate;
 *    the class-level @RequireFeature('deliveryReps') is unchanged.
 *    This SUPERSEDES M17/D12 (van-sales-admin-feature-gate.spec.ts),
 *    which kept the 30 view routes open to any sales/inventory
 *    holder — that openness is exactly the trial leak (a rep reading
 *    another rep's trips and figures).
 * 3. A rep holding only 'deliveryReps' (even with 'sales' +
 *    'inventory') is 403 on ALL 64 admin routes; a sales-only user
 *    is 403 on all 64.
 * 4. A supervisor holding 'deliveryRepsAdmin' passes the 63 routes
 *    (payroll push still needs its HR gate); the platform
 *    super_admin carve-out still holds.
 * 5. Manager surfaces: a rep holding 'dashboard' + 'sales' is 403 on
 *    GET /api/manager-actions and GET /api/dashboard/manager-overview;
 *    a 'reports' holder passes both; a dashboard-only user is 403 on
 *    the overview (it used to require only 'dashboard', which every
 *    cashier holds).
 * 6. Migration 0340 backfills 'deliveryRepsAdmin' to admin-role users
 *    who already hold 'deliveryReps' — and to nobody else (a cashier
 *    rep keeps exactly what he had; an admin without 'deliveryReps'
 *    gains nothing). Up is idempotent; down removes it from exactly
 *    that population.
 * 7. The rep's OWN trip read still works through the rep-scoped
 *    portal path (real VanSalesService.getTripExpenses on PGlite):
 *    own trip reads, another rep's trip is 403, a missing trip is
 *    404. The admin controller is never the rep's own-trip path.
 * 8. FE gates are pinned by source (there is no FE spec harness for
 *    these pages): the admin page gates on 'deliveryRepsAdmin', the
 *    router permission map requires it for every admin-page path, the
 *    alerts bell and the dashboard decision center gate on 'reports',
 *    and the POS cart-line edit affordance gates on 'products'.
 * 9. This spec is wired into BOTH critical lists (304 specs,
 *    identical order).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { PermissionService } from '../../src/core/auth/services/permission.service';
import { REQUIRED_FEATURE_KEY } from '../../src/core/auth/decorators/feature.decorator';
import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../src/core/auth/decorators/permissions.decorator';
import { VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales-admin.controller';
import { ManagerActionsController } from '../../src/modules/manager-actions/manager-actions.controller';
import { SUPER_ADMIN_PERMISSIONS } from '../../src/core/auth/constants/super-admin-permissions';
import { PERMISSION_ARABIC_LABELS } from '../../src/modules/users/permission-labels';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

const TENANT = 't-van-admin-split';
const ACCOUNT = 'a-van-admin-split';
const REP_OWN = 11;
const REP_OTHER = 22;

function makeGuard(): PermissionsGuard {
  return new PermissionsGuard(
    new Reflector(),
    new PermissionService(),
    {
      hasFeature: (planId: string | undefined) => planId === 'plan_ultimate' || planId === 'plan_omnichannel',
    } as never,
    {} as never,
  );
}

function guardContext(controller: any, auth: Record<string, unknown>, methodName: string): any {
  const handler = controller.prototype[methodName];
  assert.ok(typeof handler === 'function', `${controller.name} must have method ${methodName}`);
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ url: `/api/${methodName}`, authContext: auth }),
    }),
  };
}

function authContext(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: 2,
    sessionId: 'sess-f12',
    username: 'rep',
    role: 'cashier',
    permissions: ['deliveryReps'],
    tenantId: TENANT,
    accountId: ACCOUNT,
    planId: 'plan_ultimate',
    extraFeatures: undefined,
    activityType: undefined,
    pillar: undefined,
    ...overrides,
  };
}

function assertForbidden(fn: () => unknown, label: string): void {
  assert.throws(fn, ForbiddenException, label);
}

async function main(): Promise<void> {
  const guard = makeGuard();
  const proto = VanSalesAdminController.prototype as any;
  const handlerMethods = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');

  // 1. The new key is registered where a new key must be registered.
  {
    assert.ok(
      SUPER_ADMIN_PERMISSIONS.includes('deliveryRepsAdmin'),
      'SUPER_ADMIN_PERMISSIONS must include deliveryRepsAdmin (activation owner + platform super_admin hold it)',
    );
    assert.ok(
      typeof PERMISSION_ARABIC_LABELS.deliveryRepsAdmin === 'string' &&
        PERMISSION_ARABIC_LABELS.deliveryRepsAdmin.length > 0,
      'deliveryRepsAdmin must have an Arabic label for the grant form / refusal message',
    );
    console.log('1. deliveryRepsAdmin registered (SUPER_ADMIN_PERMISSIONS + Arabic label), passed');
  }

  // 2. The full 64-route admin table: 63 supervisor-only, payroll push keeps its HR gate.
  {
    assert.equal(handlerMethods.length, 64, `expected 64 admin routes, found ${handlerMethods.length}`);
    assert.equal(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, VanSalesAdminController),
      'deliveryReps',
      "VanSalesAdminController must keep @RequireFeature('deliveryReps') at class level",
    );
    for (const method of handlerMethods) {
      if (method === 'pushRepShortagesToPayroll') continue;
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[method]) || [],
        ['deliveryRepsAdmin'],
        `${method} must require exactly the deliveryRepsAdmin permission`,
      );
      assert.equal(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, proto[method]),
        undefined,
        `${method} must not keep a broad RequireAnyPermission gate`,
      );
    }
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, proto.pushRepShortagesToPayroll) || [],
      ['hrPayrollManage', 'accounting'],
      'financial-ledger/push-to-payroll keeps its already-narrow gate',
    );
    assert.equal(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto.pushRepShortagesToPayroll),
      undefined,
      'financial-ledger/push-to-payroll must not gain a deliveryRepsAdmin gate',
    );
    console.log('2. admin-controller table (63 supervisor-only + payroll HR gate), passed');
  }

  // 3. A rep is 403 on ALL 64 admin routes — even with sales + inventory.
  {
    const rep = authContext({ permissions: ['deliveryReps'] });
    const repWide = authContext({ permissions: ['deliveryReps', 'sales', 'inventory'] });
    for (const method of handlerMethods) {
      assertForbidden(
        () => guard.canActivate(guardContext(VanSalesAdminController, rep, method)),
        `deliveryReps-only rep must be 403 on ${method}`,
      );
      assertForbidden(
        () => guard.canActivate(guardContext(VanSalesAdminController, repWide, method)),
        `deliveryReps+sales+inventory rep must be 403 on ${method}`,
      );
    }
    const salesOnly = authContext({ permissions: ['sales'] });
    for (const method of handlerMethods) {
      assertForbidden(
        () => guard.canActivate(guardContext(VanSalesAdminController, salesOnly, method)),
        `sales-only user must be 403 on ${method}`,
      );
    }
    console.log('3. rep (deliveryReps / +sales+inventory) and sales-only: 403 on all 64 admin routes, passed');
  }

  // 4. A supervisor holding deliveryRepsAdmin passes; payroll push still needs its HR gate.
  {
    const supervisor = authContext({
      role: 'admin',
      username: 'supervisor',
      permissions: ['deliveryReps', 'deliveryRepsAdmin'],
    });
    for (const method of handlerMethods) {
      if (method === 'pushRepShortagesToPayroll') continue;
      assert.equal(
        guard.canActivate(guardContext(VanSalesAdminController, supervisor, method)),
        true,
        `supervisor must pass ${method}`,
      );
    }
    assertForbidden(
      () => guard.canActivate(guardContext(VanSalesAdminController, supervisor, 'pushRepShortagesToPayroll')),
      'supervisor without an HR key must still be 403 on push-to-payroll',
    );
    const payrollSupervisor = authContext({
      role: 'admin',
      username: 'payroll-supervisor',
      permissions: ['deliveryRepsAdmin', 'hrPayrollManage'],
    });
    assert.equal(
      guard.canActivate(guardContext(VanSalesAdminController, payrollSupervisor, 'pushRepShortagesToPayroll')),
      true,
      'supervisor with hrPayrollManage must pass push-to-payroll',
    );
    const platformSuperAdmin = authContext({
      role: 'super_admin',
      tenantId: 'zs',
      permissions: [],
      planId: 'plan_basic',
      username: 'platform',
    });
    assert.equal(
      guard.canActivate(guardContext(VanSalesAdminController, platformSuperAdmin, 'listTrips')),
      true,
      'platform super_admin keeps the guard carve-out',
    );
    console.log('4. supervisor passes 63 routes; payroll push keeps its HR gate; super_admin carve-out holds, passed');
  }

  // 5. Manager surfaces: rep 403, reports holder allowed, dashboard-only 403 on the overview.
  {
    const rep = authContext({ permissions: ['dashboard', 'sales', 'deliveryReps'] });
    assertForbidden(
      () => guard.canActivate(guardContext(ManagerActionsController, rep, 'list')),
      'rep must be 403 on GET /api/manager-actions',
    );
    assertForbidden(
      () => guard.canActivate(guardContext(ManagerActionsController, rep, 'managerOverview')),
      'rep must be 403 on GET /api/dashboard/manager-overview',
    );
    const dashboardOnly = authContext({ permissions: ['dashboard'] });
    assertForbidden(
      () => guard.canActivate(guardContext(ManagerActionsController, dashboardOnly, 'managerOverview')),
      'dashboard-only user must be 403 on the manager overview (dashboard alone no longer opens it)',
    );
    assertForbidden(
      () => guard.canActivate(guardContext(ManagerActionsController, dashboardOnly, 'list')),
      'dashboard-only user must be 403 on manager actions',
    );
    const reportsHolder = authContext({ role: 'admin', username: 'manager', permissions: ['dashboard', 'reports'] });
    assert.equal(
      guard.canActivate(guardContext(ManagerActionsController, reportsHolder, 'list')),
      true,
      'reports holder must pass manager actions',
    );
    assert.equal(
      guard.canActivate(guardContext(ManagerActionsController, reportsHolder, 'managerOverview')),
      true,
      'reports holder must pass the manager overview',
    );
    console.log('5. manager actions + overview: rep 403, reports holder allowed, passed');
  }

  // 6. Migration 0340 backfill: only admin-role holders of deliveryReps gain the key.
  // Lazy import so the fail-first run compiles on pre-fix code and
  // fails here at runtime (module absent) instead of at compile time.
  // Concatenated on purpose: a literal specifier would fail
  // ts-node's compile step before any case runs.
  {
    const { migration: deliveryRepsAdminBackfill } = await import(
      '../../src/database/migrations/' + '2040000000340_delivery_reps_admin_backfill'
    );
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    const anyDb = db as any;
    try {
      await pg.exec(`
        CREATE TABLE users (id bigint PRIMARY KEY, role text NOT NULL, permissions_json jsonb NOT NULL DEFAULT '[]'::jsonb);
      `);
      await anyDb
        .insertInto('users')
        .values([
          { id: 1, role: 'admin', permissions_json: JSON.stringify(['deliveryReps', 'sales']) },
          { id: 2, role: 'cashier', permissions_json: JSON.stringify(['deliveryReps', 'sales']) },
          { id: 3, role: 'admin', permissions_json: JSON.stringify(['sales']) },
          { id: 4, role: 'admin', permissions_json: JSON.stringify(['deliveryReps', 'deliveryRepsAdmin']) },
          { id: 5, role: 'super_admin', permissions_json: JSON.stringify(['deliveryReps']) },
        ])
        .execute();
      const readPerms = async (id: number): Promise<string[]> => {
        const row = await anyDb
          .selectFrom('users')
          .select('permissions_json')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        return JSON.parse(
          typeof row.permissions_json === 'string' ? row.permissions_json : JSON.stringify(row.permissions_json),
        );
      };
      await deliveryRepsAdminBackfill.up(db);
      assert.deepEqual((await readPerms(1)).sort(), ['deliveryReps', 'deliveryRepsAdmin', 'sales'].sort());
      assert.deepEqual((await readPerms(2)).sort(), ['deliveryReps', 'sales'].sort());
      assert.deepEqual((await readPerms(3)).sort(), ['sales'].sort());
      assert.deepEqual((await readPerms(4)).sort(), ['deliveryReps', 'deliveryRepsAdmin'].sort());
      assert.deepEqual((await readPerms(5)).sort(), ['deliveryReps', 'deliveryRepsAdmin'].sort());
      // Idempotent: a second run adds no duplicate key.
      await deliveryRepsAdminBackfill.up(db);
      assert.equal((await readPerms(1)).filter((p: string) => p === 'deliveryRepsAdmin').length, 1);
      await deliveryRepsAdminBackfill.down(db);
      assert.deepEqual((await readPerms(1)).sort(), ['deliveryReps', 'sales'].sort());
      assert.deepEqual((await readPerms(5)).sort(), ['deliveryReps'].sort());
      assert.deepEqual((await readPerms(4)).sort(), ['deliveryReps'].sort());
      console.log('6. migration 0340 backfill (admin-only, idempotent, reversible), passed');
    } finally {
      await db.destroy();
    }
  }

  // 7. The rep's OWN trip read still works through the rep-scoped portal path.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    const anyDb = db as any;
    try {
      await pg.exec(`
        CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text);
        CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW());
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text);
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      `);
      await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
      await anyDb
        .insertInto('currency_exchange_rates')
        .values({ tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1 })
        .execute();
      await anyDb
        .insertInto('users')
        .values({ id: 1, tenant_id: TENANT, display_name: 'Sys', username: 'sys' })
        .execute();
      await anyDb
        .insertInto('van_sales_trips')
        .values([
          {
            id: 1,
            tenant_id: TENANT,
            account_id: ACCOUNT,
            rep_id: REP_OWN,
            van_location_id: 10,
            source_warehouse_id: 10,
            status: 'open',
            settlement_status: 'open',
          },
          {
            id: 2,
            tenant_id: TENANT,
            account_id: ACCOUNT,
            rep_id: REP_OTHER,
            van_location_id: 10,
            source_warehouse_id: 10,
            status: 'open',
            settlement_status: 'open',
          },
        ])
        .execute();
      await anyDb
        .insertInto('van_trip_expenses')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          trip_id: 1,
          expense_type: 'fuel',
          amount: 42,
          created_by_user_id: 1,
        })
        .execute();
      const postingStub = {
        postSale: async () => undefined,
        clearPostingFailure: async () => undefined,
        postVanStockTransfer: async () => undefined,
      };
      const vanService = new VanSalesService(db, {} as never, {} as never, postingStub as never);
      (vanService as any).resolveSystemAuthContext = async () => ({ userId: 1, sessionId: 'spec', username: 'spec' });
      const forbidden = (err: any) => err && err.code === 'FORBIDDEN' && err.statusCode === 403;
      const own = await vanService.getTripExpenses(1, TENANT, REP_OWN);
      assert.equal((own as any).expenses.length, 1);
      assert.equal(Number((own as any).expenses[0].amount), 42);
      await assert.rejects(vanService.getTripExpenses(2, TENANT, REP_OWN), forbidden);
      await assert.rejects(
        vanService.getTripExpenses(999, TENANT, REP_OWN),
        (err: any) => err && err.code === 'TRIP_NOT_FOUND' && err.statusCode === 404,
      );
      // The staff path (no repId) is unchanged: the supervisor view behind a staff session.
      const staff = await vanService.getTripExpenses(2, TENANT);
      assert.equal((staff as any).expenses.length, 0);
      console.log('7. rep-scoped own-trip read still allowed (other rep 403, missing 404), passed');
    } finally {
      await db.destroy();
    }
  }

  // 8. FE gates pinned by source (no FE spec harness for these pages).
  {
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../../', rel), 'utf8');
    const adminPage = read('frontend/src/features/delivery-reps/pages/VanSalesAdminManagementPage.tsx');
    assert.ok(adminPage.includes('deliveryRepsAdmin'), 'admin page must gate on deliveryRepsAdmin');
    assert.ok(adminPage.includes('useHasAnyPermission'), 'admin page must use the permission hook for the gate');
    const access = read('frontend/src/app/router/access.ts');
    assert.ok(
      access.includes("'van-sales-admin': 'deliveryRepsAdmin'"),
      'router permission map must require deliveryRepsAdmin for van-sales-admin',
    );
    assert.ok(
      access.includes("'/inventory/van-sales': 'deliveryRepsAdmin'"),
      'router permission map must require deliveryRepsAdmin for /inventory/van-sales',
    );
    const bell = read('frontend/src/features/dashboard/components/ManagerNotificationsBell.tsx');
    assert.ok(
      bell.includes("useHasAnyPermission('reports')"),
      'manager alerts bell must gate its query on the reports permission',
    );
    const dashboard = read('frontend/src/features/dashboard/pages/DashboardPage.tsx');
    assert.ok(
      dashboard.includes("useHasAnyPermission('reports')"),
      'dashboard decision center must gate on the reports permission',
    );
    const pos = read('frontend/src/features/pos/components/PosWorkspace.tsx');
    assert.ok(
      pos.includes('onEditProduct={canEditProduct ? setEditProductId : undefined}'),
      'POS cart-line edit affordance must gate on the products permission',
    );
    const adminHook = read('frontend/src/features/delivery-reps/hooks/useVanSalesAdmin.ts');
    assert.ok(
      adminHook.includes('useVanSalesAdmin(enabled = true)'),
      'admin data hook must accept an enabled flag so a denied page fires no admin queries',
    );
    console.log('8. FE gates pinned by source (admin page, router, bell, dashboard, POS), passed');
  }

  // 9. This spec is wired into BOTH critical lists (347 specs, identical order).
  {
    const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 347);
    assert.equal(chain.length, 347);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/van-admin-permission-split.spec.ts'));
    console.log('9. spec wired into both critical lists (347 = 347, identical order), passed');
  }

  console.log('van-admin-permission-split: all cases passed');
}

main()
  .then(async () => {
    console.log('van-admin-permission-split: all cases passed');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
