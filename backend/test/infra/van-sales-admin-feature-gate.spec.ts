/* Van-sales admin permission split (F12, trial problem 15).
 *
 * VanSalesAdminController must sit behind the deliveryReps plan feature
 * (class-level @RequireFeature, mirroring DeliveryRepsController), and
 * every route except financial-ledger/push-to-payroll must require the
 * supervisor-only permission 'deliveryRepsAdmin' alone — a rep holding
 * only 'deliveryReps' (even with 'sales' + 'inventory') is 403 on all
 * of them, including the view routes. financial-ledger/push-to-payroll
 * keeps its already-narrow ('hrPayrollManage', 'accounting') gate.
 *
 * SUPERSEDES M17 / D12 (the previous version of this file): M17 kept
 * the 30 view routes open to any sales/inventory holder and narrowed
 * only the 14 money routes to 'deliveryReps'. That openness IS the
 * trial leak — the rep read other reps' trips (#5, #6) with their
 * figures through listTrips/getTripDetails, and saw every other rep's
 * targets, ledger, fraud radar and settings. The rep's OWN trip reads
 * never go through this controller: they go through the rep-scoped
 * driver portal (api/driver-portal/van-sales, token-verified,
 * rep-scoped reads pinned by driver-portal-rep-scoped-reads.spec.ts).
 *
 * Grounded on the repo's existing guard specs:
 * test/infra/product-modifier-link-load.spec.ts and
 * test/critical/platform-auth-boundaries-p0a.spec.ts — the REAL
 * PermissionsGuard driven with a REAL Reflector and the REAL
 * PermissionService, with PlanFeatureService stubbed only to model the plan
 * matrix (FALLBACK_PLAN_FEATURES in session.service.ts: plan_basic has no
 * deliveryReps; plan_ultimate / plan_omnichannel do). No database is used.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { PermissionService } from '../../src/core/auth/services/permission.service';
import { REQUIRED_FEATURE_KEY } from '../../src/core/auth/decorators/feature.decorator';
import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../../src/core/auth/decorators/permissions.decorator';
import { VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales-admin.controller';

/* Every admin route except push-to-payroll requires the supervisor-only key. */
const SUPERVISOR_METHODS = [
  'listPreSalesOrders',
  'getPreSalesOrderDetails',
  'approvePreSalesOrder',
  'rejectPreSalesOrder',
  'consolidatePreSalesOrdersToRequisition',
  'convertPreSalesOrderToInvoice',
  'listTrips',
  'getTripDetails',
  'settleTripAdmin',
  'listVehicles',
  'createVehicle',
  'updateVehicle',
  'assignRep',
  'listReturns',
  'approveReturn',
  'rejectReturn',
  'getAdminAvailableProducts',
  'listAdminRequisitions',
  'listAdminWarehouses',
  'createAdminRequisition',
  'reviewRequisition',
  'dispatchRequisition',
  'rejectRequisition',
  'deleteRequisition',
  'listRepTargets',
  'setRepTarget',
  'getCommissionConfig',
  'saveCommissionConfig',
  'settleRepCommission',
  'getRouteKpis',
  'listFieldVisits',
  'setCustomerRouteSchedule',
  'getSupervisorCustomerRoutes',
  'bulkAssignCustomerRoutes',
  'listFuelLogs',
  'recordFuelLog',
  'listOilChanges',
  'recordOilChange',
  'getMaintenanceAlerts',
  'listVehicleDrivers',
  'assignVehicleDriver',
  'removeVehicleDriver',
  'listAdminTransfers',
  'getAdminTripExpenses',
  'getAdminTripPackaging',
  'getAdminCustomerPackaging',
  'getFraudRadarSummary',
  'getFraudRadarEvents',
  'listAdminPromotions',
  'createPromotion',
  'updatePromotion',
  'deletePromotion',
  'togglePromotionActive',
  'optimizeSupervisorRoute',
  'listVisitsHistory',
  'listTradeSurveys',
  'getLiveTripBreadcrumbs',
  'getRepFinancialLedger',
  'settleRepFinancialItem',
  'addRepBonusOrCommission',
  'linkRepToEmployee',
  'listCandidateEmployees',
  'autoCreateEmployee',
];

function makeGuard(): PermissionsGuard {
  return new PermissionsGuard(
    new Reflector(),
    new PermissionService(),
    {
      /* Models the plan matrix: only plan_ultimate / plan_omnichannel carry
       * the deliveryReps feature; plan_basic (and plan_pro) do not. */
      hasFeature: (planId: string | undefined) =>
        planId === 'plan_ultimate' || planId === 'plan_omnichannel',
    } as never,
    {} as never,
  );
}

function guardContext(auth: Record<string, unknown>, methodName: string): any {
  const handler = (VanSalesAdminController.prototype as any)[methodName];
  assert.ok(typeof handler === 'function', `VanSalesAdminController must have method ${methodName}`);
  return {
    getHandler: () => handler,
    getClass: () => VanSalesAdminController,
    switchToHttp: () => ({
      getRequest: () => ({ url: `/api/van-sales/admin/${methodName}`, authContext: auth }),
    }),
  };
}

function authContext(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: 2,
    sessionId: 'sess-m17',
    username: 'cashier',
    role: 'cashier',
    permissions: ['sales'],
    tenantId: 't1',
    accountId: 'a1',
    planId: 'plan_ultimate',
    extraFeatures: undefined,
    activityType: undefined,
    pillar: undefined,
    ...overrides,
  };
}

async function run(): Promise<void> {
  const guard = makeGuard();
  const proto = VanSalesAdminController.prototype as any;

  /* Phase 1: the class-level plan gate (D11, unchanged by F12). */
  {
    assert.equal(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, VanSalesAdminController),
      'deliveryReps',
      'VanSalesAdminController must carry @RequireFeature(\'deliveryReps\') at class level',
    );
  }

  /* Phase 2: the full 64-route permission table (F12). A route added later
   * without a table entry fails here, forcing its classification. */
  {
    const handlerMethods = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');
    const tabled = [...SUPERVISOR_METHODS, 'pushRepShortagesToPayroll'];
    assert.equal(handlerMethods.length, 64, `expected 64 admin routes, found ${handlerMethods.length}`);
    assert.equal(tabled.length, 64, `expected 64 classified routes, found ${tabled.length}`);
    assert.deepEqual(
      [...handlerMethods].sort(),
      [...tabled].sort(),
      'permission table must cover exactly the controller methods',
    );

    for (const method of SUPERVISOR_METHODS) {
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
    console.log('van-sales-admin-feature-gate.spec: phase 1-2 (metadata, 64 routes) OK');
  }

  /* Phase 3: the real guard — a rep (deliveryReps, even with sales +
   * inventory) and a sales-only user are 403 on EVERY route, views included. */
  {
    const rep = authContext({ permissions: ['deliveryReps'] });
    const repWide = authContext({ permissions: ['deliveryReps', 'sales', 'inventory'] });
    const salesOnly = authContext({ permissions: ['sales'] });
    for (const method of [...SUPERVISOR_METHODS, 'pushRepShortagesToPayroll']) {
      assert.throws(
        () => guard.canActivate(guardContext(rep, method)),
        ForbiddenException,
        `deliveryReps-only rep must be 403 on ${method}`,
      );
      assert.throws(
        () => guard.canActivate(guardContext(repWide, method)),
        ForbiddenException,
        `deliveryReps+sales+inventory rep must be 403 on ${method}`,
      );
      assert.throws(
        () => guard.canActivate(guardContext(salesOnly, method)),
        ForbiddenException,
        `sales-only user must be 403 on ${method}`,
      );
    }
    console.log('van-sales-admin-feature-gate.spec: phase 3 (rep / sales-only: 403 everywhere) OK');
  }

  /* Phase 4: a deliveryRepsAdmin holder passes the 63 supervisor routes
   * (payroll push still needs its HR gate). */
  {
    const supervisor = authContext({ permissions: ['deliveryReps', 'deliveryRepsAdmin'], role: 'admin', username: 'supervisor' });
    for (const method of SUPERVISOR_METHODS) {
      assert.equal(
        guard.canActivate(guardContext(supervisor, method)),
        true,
        `deliveryRepsAdmin holder must pass ${method}`,
      );
    }
    assert.throws(
      () => guard.canActivate(guardContext(supervisor, 'pushRepShortagesToPayroll')),
      ForbiddenException,
      'supervisor without an HR key must still be 403 on push-to-payroll',
    );
    console.log('van-sales-admin-feature-gate.spec: phase 4 (deliveryRepsAdmin holder passes) OK');
  }

  /* Phase 5: the plan gate (D11) — a tenant whose plan lacks deliveryReps
   * is 403 on admin routes even with the permission, and even a supervisor
   * is blocked; the platform super_admin carve-out still holds. */
  {
    const basicSales = authContext({ permissions: ['sales'], planId: 'plan_basic' });
    assert.throws(
      () => guard.canActivate(guardContext(basicSales, 'listTrips')),
      ForbiddenException,
      'plan_basic tenant must be 403 on a view route even with sales',
    );
    const basicSupervisor = authContext({ permissions: ['deliveryRepsAdmin'], planId: 'plan_basic' });
    assert.throws(
      () => guard.canActivate(guardContext(basicSupervisor, 'settleTripAdmin')),
      ForbiddenException,
      'plan_basic tenant must be 403 on a money route even with deliveryRepsAdmin',
    );
    const platformSuperAdmin = authContext({
      role: 'super_admin',
      tenantId: 'zs',
      permissions: [],
      planId: 'plan_basic',
      username: 'platform',
    });
    assert.equal(
      guard.canActivate(guardContext(platformSuperAdmin, 'listTrips')),
      true,
      'platform super_admin keeps the guard carve-out',
    );
    console.log('van-sales-admin-feature-gate.spec: phase 5 (plan gate) OK');
  }

  console.log('van-sales-admin-feature-gate.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
