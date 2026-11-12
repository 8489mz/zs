/* Van-sales admin feature gate (M17 / D11 + D12, PD8 as decided).
 *
 * VanSalesAdminController must sit behind the deliveryReps plan feature
 * (class-level @RequireFeature, mirroring DeliveryRepsController), and the
 * fourteen money routes must require the narrower rep-management permission
 * 'deliveryReps' alone — a user holding only 'sales' must get 403 on them
 * while keeping read access to the view routes. The remaining fifty routes
 * (all 30 GETs plus non-money mutations) keep their original
 * @RequireAnyPermission triple, and financial-ledger/push-to-payroll keeps
 * its already-narrow ('hrPayrollManage', 'accounting') gate.
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
import { VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales.controller';

/* Money routes narrowed by M17: trip settlement, return approval,
 * commission/target adjustment, ledger settlement, load-requisition
 * approve/dispatch (incl. its paired reject/delete dispositions), and the
 * rep/customer-book assignment power (bulk + single-customer). */
const MONEY_METHODS = [
  'settleTripAdmin',
  'approveReturn',
  'rejectReturn',
  'reviewRequisition',
  'dispatchRequisition',
  'rejectRequisition',
  'deleteRequisition',
  'setRepTarget',
  'saveCommissionConfig',
  'settleRepCommission',
  'setCustomerRouteSchedule',
  'bulkAssignCustomerRoutes',
  'settleRepFinancialItem',
  'addRepBonusOrCommission',
];

/* Every other admin route keeps its original @RequireAnyPermission value. */
const KEPT_ANY: Record<string, string[]> = {
  listPreSalesOrders: ['deliveryReps', 'sales'],
  getPreSalesOrderDetails: ['deliveryReps', 'sales'],
  approvePreSalesOrder: ['deliveryReps', 'sales'],
  rejectPreSalesOrder: ['deliveryReps', 'sales'],
  consolidatePreSalesOrdersToRequisition: ['deliveryReps', 'sales', 'inventory'],
  convertPreSalesOrderToInvoice: ['deliveryReps', 'sales'],
  listTrips: ['deliveryReps', 'sales', 'inventory'],
  getTripDetails: ['deliveryReps', 'sales', 'inventory'],
  listVehicles: ['deliveryReps', 'sales', 'inventory'],
  createVehicle: ['deliveryReps', 'sales', 'inventory'],
  updateVehicle: ['deliveryReps', 'sales', 'inventory'],
  assignRep: ['deliveryReps', 'sales', 'inventory'],
  listReturns: ['deliveryReps', 'sales', 'inventory'],
  getAdminAvailableProducts: ['deliveryReps', 'sales', 'inventory'],
  listAdminRequisitions: ['deliveryReps', 'sales', 'inventory'],
  listAdminWarehouses: ['deliveryReps', 'sales', 'inventory'],
  createAdminRequisition: ['deliveryReps', 'sales', 'inventory'],
  listRepTargets: ['deliveryReps', 'sales', 'inventory'],
  getCommissionConfig: ['deliveryReps', 'sales', 'inventory'],
  getRouteKpis: ['deliveryReps', 'sales', 'inventory'],
  listFieldVisits: ['deliveryReps', 'sales', 'inventory'],
  getSupervisorCustomerRoutes: ['deliveryReps', 'sales', 'inventory'],
  listFuelLogs: ['deliveryReps', 'sales', 'inventory'],
  recordFuelLog: ['deliveryReps', 'sales', 'inventory'],
  listOilChanges: ['deliveryReps', 'sales', 'inventory'],
  recordOilChange: ['deliveryReps', 'sales', 'inventory'],
  getMaintenanceAlerts: ['deliveryReps', 'sales', 'inventory'],
  listVehicleDrivers: ['deliveryReps', 'sales', 'inventory'],
  assignVehicleDriver: ['deliveryReps', 'sales', 'inventory'],
  removeVehicleDriver: ['deliveryReps', 'sales', 'inventory'],
  listAdminTransfers: ['deliveryReps', 'sales', 'inventory'],
  getAdminTripExpenses: ['deliveryReps', 'sales', 'accounting'],
  getAdminTripPackaging: ['deliveryReps', 'sales', 'inventory'],
  getAdminCustomerPackaging: ['deliveryReps', 'sales', 'inventory'],
  getFraudRadarSummary: ['deliveryReps', 'sales', 'inventory', 'accounting'],
  getFraudRadarEvents: ['deliveryReps', 'sales', 'inventory', 'accounting'],
  listAdminPromotions: ['deliveryReps', 'sales', 'inventory'],
  createPromotion: ['deliveryReps', 'sales', 'inventory'],
  updatePromotion: ['deliveryReps', 'sales', 'inventory'],
  deletePromotion: ['deliveryReps', 'sales', 'inventory'],
  togglePromotionActive: ['deliveryReps', 'sales', 'inventory'],
  optimizeSupervisorRoute: ['deliveryReps', 'sales', 'inventory'],
  listVisitsHistory: ['deliveryReps', 'sales', 'inventory'],
  listTradeSurveys: ['deliveryReps', 'sales', 'inventory'],
  getLiveTripBreadcrumbs: ['deliveryReps', 'sales', 'inventory'],
  getRepFinancialLedger: ['deliveryReps', 'sales', 'accounting'],
  pushRepShortagesToPayroll: ['hrPayrollManage', 'accounting'],
  linkRepToEmployee: ['deliveryReps', 'sales', 'accounting'],
  listCandidateEmployees: ['deliveryReps', 'sales', 'accounting'],
  autoCreateEmployee: ['deliveryReps', 'sales', 'accounting'],
};

/* All 30 GET (view) routes. */
const VIEW_METHODS = [
  'listPreSalesOrders',
  'getPreSalesOrderDetails',
  'listTrips',
  'getTripDetails',
  'listVehicles',
  'listReturns',
  'getAdminAvailableProducts',
  'listAdminRequisitions',
  'listAdminWarehouses',
  'listRepTargets',
  'getCommissionConfig',
  'getRouteKpis',
  'listFieldVisits',
  'getSupervisorCustomerRoutes',
  'listFuelLogs',
  'listOilChanges',
  'getMaintenanceAlerts',
  'listVehicleDrivers',
  'listAdminTransfers',
  'getAdminTripExpenses',
  'getAdminTripPackaging',
  'getAdminCustomerPackaging',
  'getFraudRadarSummary',
  'getFraudRadarEvents',
  'listAdminPromotions',
  'listVisitsHistory',
  'listTradeSurveys',
  'getLiveTripBreadcrumbs',
  'getRepFinancialLedger',
  'listCandidateEmployees',
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

  /* Phase 1: the class-level plan gate (D11). */
  {
    assert.equal(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, VanSalesAdminController),
      'deliveryReps',
      'VanSalesAdminController must carry @RequireFeature(\'deliveryReps\') at class level',
    );
  }

  /* Phase 2: the full 64-route permission table (D12). A route added later
   * without a table entry fails here, forcing its classification. */
  {
    const handlerMethods = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');
    const tabled = [...MONEY_METHODS, ...Object.keys(KEPT_ANY)];
    assert.equal(handlerMethods.length, 64, `expected 64 admin routes, found ${handlerMethods.length}`);
    assert.equal(tabled.length, 64, `expected 64 classified routes, found ${tabled.length}`);
    assert.deepEqual(
      [...handlerMethods].sort(),
      [...tabled].sort(),
      'permission table must cover exactly the controller methods',
    );

    for (const method of MONEY_METHODS) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[method]) || [],
        ['deliveryReps'],
        `${method} must require exactly the deliveryReps permission`,
      );
      assert.equal(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, proto[method]),
        undefined,
        `${method} must not keep the broad RequireAnyPermission triple`,
      );
    }
    for (const [method, expected] of Object.entries(KEPT_ANY)) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, proto[method]) || [],
        expected,
        `${method} must keep its original RequireAnyPermission value`,
      );
      assert.equal(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, proto[method]),
        undefined,
        `${method} must not gain a RequirePermissions gate`,
      );
    }
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, proto.pushRepShortagesToPayroll) || [],
      ['hrPayrollManage', 'accounting'],
      'financial-ledger/push-to-payroll keeps its already-narrow gate',
    );
    console.log('van-sales-admin-feature-gate.spec: phase 1-2 (metadata, 64 routes) OK');
  }

  /* Phase 3: the real guard — a sales-only user is 403 on every money
   * route but passes every view route (D12 / PD8). */
  {
    const salesOnly = authContext({ permissions: ['sales'] });
    for (const method of MONEY_METHODS) {
      assert.throws(
        () => guard.canActivate(guardContext(salesOnly, method)),
        ForbiddenException,
        `sales-only user must be 403 on money route ${method}`,
      );
    }
    for (const method of VIEW_METHODS) {
      assert.equal(
        guard.canActivate(guardContext(salesOnly, method)),
        true,
        `sales-only user must keep view access on ${method}`,
      );
    }
    console.log('van-sales-admin-feature-gate.spec: phase 3 (sales-only: 403 money / 200 view) OK');
  }

  /* Phase 4: a deliveryReps holder passes the money routes. */
  {
    const repManager = authContext({ permissions: ['deliveryReps'], role: 'admin', username: 'rep-manager' });
    for (const method of MONEY_METHODS) {
      assert.equal(
        guard.canActivate(guardContext(repManager, method)),
        true,
        `deliveryReps holder must pass money route ${method}`,
      );
    }
    console.log('van-sales-admin-feature-gate.spec: phase 4 (deliveryReps holder passes money) OK');
  }

  /* Phase 5: the plan gate (D11) — a tenant whose plan lacks deliveryReps
   * is 403 on admin routes even with the permission, and even a rep
   * manager is blocked; the platform super_admin carve-out still holds. */
  {
    const basicSales = authContext({ permissions: ['sales'], planId: 'plan_basic' });
    assert.throws(
      () => guard.canActivate(guardContext(basicSales, 'listTrips')),
      ForbiddenException,
      'plan_basic tenant must be 403 on a view route even with sales',
    );
    const basicRepManager = authContext({ permissions: ['deliveryReps'], planId: 'plan_basic' });
    assert.throws(
      () => guard.canActivate(guardContext(basicRepManager, 'settleTripAdmin')),
      ForbiddenException,
      'plan_basic tenant must be 403 on a money route even with deliveryReps',
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
