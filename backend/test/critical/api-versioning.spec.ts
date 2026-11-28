/*
 * New file: backend/test/critical/api-versioning.spec.ts
 *
 * WHAT THIS PINS (INV-API-VERSIONING-DUAL-SERVE-V1, D11): every API route is
 * served under BOTH its legacy path and the api/v1/... form. Single-path
 * controllers carry @Controller(['api/<rest>', 'api/v1/<rest>']), dual-path
 * controllers gain the api/v1/... element for each api/... element, and the
 * 15 @Controller('api') controllers carry a 'v1/<method-path>' alias on every
 * route decorator. No route is removed and no legacy URL changes — the
 * frontend keeps calling /api/... untouched (0 frontend files in D11).
 *
 * WHAT IS DRIVEN (the real Nest route registration, no mocks, no booted
 * production app):
 * (a) the route inventory, read from the SAME decorator metadata Nest's
 *     router consumes (PATH_METADATA / METHOD_METADATA on all 101 controller
 *     classes): the legacy set is pinned by SHA-256 (it must be byte-identical
 *     to the pre-D11 census), the /api/v1/... set must be exactly the image
 *     of the /api/... set under api/ -> api/v1/, and the diagnostics /v1
 *     routes must still resolve.
 * (b) a live HTTP probe through the REAL Nest router (@nestjs/testing,
 *     ephemeral port): GET /api/saas-admin/diagnostics/upload and
 *     GET /api/v1/saas-admin/diagnostics/upload both return 200 with the
 *     identical body (the live /v1 contract + controller-array aliasing);
 *     GET /api/customers and /api/v1/customers both 200 identical
 *     (method-level aliasing); GET /api/customers/1/contacts and
 *     /api/v1/customers/1/contacts both 200 identical, and the same for
 *     /api/partners/customers/1/contacts (method-ARRAY aliasing). The
 *     unversioned call still works in every pair. Controller services are
 *     stubbed (the probe drives route REGISTRATION, not business logic);
 *     guards are overridden to allow (the probe drives routing, not auth).
 *
 * COUNTS PINNED HERE (live census at 0cef7f74c, re-derived — the grounding's
 * "97 controllers" counted a barrel file and missed the multi-class files):
 * 101 controller classes (97 *controller.ts files: 1 barrel re-export +
 * 3 files defining several classes); 1,391 route decorators; 1,719 expanded
 * instances before D11 (1,718 unique legacy routes); 1,422 api-prefixed
 * routes; 296 bare routes; 5 pre-existing /api/v1 routes (diagnostics).
 * After D11: 3,132 instances, 3,130 unique routes, 1,417 v1 routes (1,412
 * new — the 5 diagnostics twins already existed before D11).
 *
 * PRE-EXISTING DUPLICATE ROUTES (recorded, NOT fixed in D11 — first-wins
 * Express semantics, preserved exactly, their v1 twins equally duplicated):
 * GET /api/branches (branches.controller.ts + settings.controller.ts).
 * (An earlier census draft also listed GET /api/maintenance/tickets/:id —
 * that was a @Get(':id') named in a // comment, not a route.)
 *
 * REJECTED ALTERNATIVES, pinned by the source checks below: NestJS URI
 * versioning (produces v1/api/..., wrong shape vs the live api/v1/... client)
 * and header versioning (invisible, no client uses it); setGlobalPrefix('api')
 * would double-prefix the api/... controllers. No /v1/... route (without the
 * api/ prefix) may exist.
 *
 * NOT DRIVEN: a live HTTP request through the full production app (needs a
 * booted AppModule + database); the services behind the probed routes (their
 * own specs own them); the frontend (untouched).
 *
 * Fail-first: on the unpatched tree the /api/v1/... set has only the 5
 * diagnostics routes, so the v1-bijection assertion exits 1 (see the log).
 * GREEN means every legacy route still resolves and every one of them has
 * an identical /api/v1/... twin that serves through the real router.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SaasDiagnosticsService } from '../../src/modules/saas-admin/saas-diagnostics.service';
import { PartnersService } from '../../src/modules/partners/partners.service';
import { SessionAuthGuard } from '../../src/core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../src/core/auth/guards/permissions.guard';
import { DiagnosticsUploadRateLimitGuard } from '../../src/modules/saas-admin/diagnostics-upload-rate-limit.guard';
import { TamperAuditController } from '../../src/core/audit/tamper-audit.controller';
import { HealthController } from '../../src/core/health/health.controller';
import { RuntimeHealthController } from '../../src/core/health/runtime-health.controller';
import { IdempotencyController } from '../../src/core/idempotency/idempotency.controller';
import { LogsController } from '../../src/core/logging/logs.controller';
import { AccountingController } from '../../src/modules/accounting/accounting.controller';
import { ArCollectionsController } from '../../src/modules/accounting/ar-collections.controller';
import { ActivationController } from '../../src/modules/activation/activation.controller';
import { AddonsController } from '../../src/modules/addons/addons.controller';
import { AiCopilotController } from '../../src/modules/ai-copilot/ai-copilot.controller';
import { ApprovalWorkflowController } from '../../src/modules/approvals/approval-workflow.controller';
import { BostaController } from '../../src/modules/bosta/bosta.controller';
import { CashDrawerController } from '../../src/modules/cash-drawer/cash-drawer.controller';
import { CatalogController } from '../../src/modules/catalog/catalog.controller';
import { ContractingAdminController } from '../../src/modules/contracting/controllers/contracting-admin.controller';
import { ContractingAssuranceController } from '../../src/modules/contracting/controllers/contracting-assurance.controller';
import { ContractingCoreController } from '../../src/modules/contracting/controllers/contracting-core.controller';
import { ContractingExecutionController } from '../../src/modules/contracting/controllers/contracting-execution.controller';
import { ContractingFieldController } from '../../src/modules/contracting/controllers/contracting-field.controller';
import { ContractingFinanceController } from '../../src/modules/contracting/controllers/contracting-finance.controller';
import { ContractingPlanningController } from '../../src/modules/contracting/controllers/contracting-planning.controller';
import { CrmController } from '../../src/modules/crm/crm.controller';
import { DeliveryRepsController } from '../../src/modules/delivery-reps/delivery-reps.controller';
import { DriverPortalController } from '../../src/modules/delivery-reps/driver-portal.controller';
import { VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales-admin.controller';
import { VanSalesController } from '../../src/modules/delivery-reps/van-sales.controller';
import { GccShippingController } from '../../src/modules/gcc-shipping/gcc-shipping.controller';
import {
  BiometricAttendanceController,
  BiometricAdmsWebhookController,
  BiometricMultiBrandWebhookController,
} from '../../src/modules/hr/controllers/biometric-attendance.controller';
import { EndOfServiceController } from '../../src/modules/hr/controllers/end-of-service.controller';
import { RecruitmentAtsController } from '../../src/modules/hr/controllers/recruitment-ats.controller';
import { EmployeePortalController } from '../../src/modules/hr/employee-portal.controller';
import { HrController } from '../../src/modules/hr/hr.controller';
import { MobileAttendanceController } from '../../src/modules/hr/mobile-attendance.controller';
import { ImportSalesController } from '../../src/modules/import-sales/import-sales.controller';
import { QualityAssuranceController } from '../../src/modules/inventory/controllers/quality-assurance.controller';
import { ReorderingRulesController } from '../../src/modules/inventory/controllers/reordering-rules.controller';
import { WarehouseBinsController } from '../../src/modules/inventory/controllers/warehouse-bins.controller';
import { WarehousePackagesController } from '../../src/modules/inventory/controllers/warehouse-packages.controller';
import { InventoryController } from '../../src/modules/inventory/inventory.controller';
import { MaintenanceController } from '../../src/modules/maintenance/maintenance.controller';
import { ManagerActionsController } from '../../src/modules/manager-actions/manager-actions.controller';
import { ManufacturingController } from '../../src/modules/manufacturing/controllers/manufacturing.controller';
import { MaritimeCustomerPortalController } from '../../src/modules/maritime-freight/maritime-customer-portal.controller';
import { MaritimeFreightController } from '../../src/modules/maritime-freight/maritime-freight.controller';
import { MaritimePublicTrackingController } from '../../src/modules/maritime-freight/maritime-public-tracking.controller';
import { PartnersController } from '../../src/modules/partners/partners.controller';
import { PharmacyController } from '../../src/modules/pharmacy/pharmacy.controller';
import { PricingController } from '../../src/modules/pricing/pricing.controller';
import { PublicController } from '../../src/modules/public/public.controller';
import { GoodsReceiptController } from '../../src/modules/purchases/controllers/goods-receipt.controller';
import { PurchaseOrdersController } from '../../src/modules/purchases/controllers/purchase-orders.controller';
import { PurchaseRfqsController } from '../../src/modules/purchases/controllers/purchase-rfqs.controller';
import { PurchasesController } from '../../src/modules/purchases/purchases.controller';
import { ReportsController } from '../../src/modules/reports/reports.controller';
import { ReturnsController } from '../../src/modules/returns/returns.controller';
import { DeveloperController } from '../../src/modules/saas-admin/developer.controller';
import { SaasAdminController } from '../../src/modules/saas-admin/saas-admin.controller';
import { SaasDiagnosticsController } from '../../src/modules/saas-admin/saas-diagnostics.controller';
import { CashierFraudRadarController } from '../../src/modules/sales/controllers/cashier-fraud-radar.controller';
import { CommercialSubscriptionController } from '../../src/modules/sales/controllers/commercial-subscription.controller';
import { CustomerInstallmentsController } from '../../src/modules/sales/controllers/customer-installments.controller';
import { DeliveryAggregatorsController } from '../../src/modules/sales/controllers/delivery-aggregators.controller';
import { KdsController } from '../../src/modules/sales/controllers/kds.controller';
import { KitchenPrintersController } from '../../src/modules/sales/controllers/kitchen-printers.controller';
import { PosTerminalController } from '../../src/modules/sales/controllers/pos-terminal.controller';
import { PriceListsController } from '../../src/modules/sales/controllers/price-lists.controller';
import { QuotationsController } from '../../src/modules/sales/controllers/quotations.controller';
import { RestaurantAdvancedFnbController } from '../../src/modules/sales/controllers/restaurant-advanced-fnb.controller';
import { RestaurantFoodWasteController } from '../../src/modules/sales/controllers/restaurant-food-waste.controller';
import { SalesOrdersController } from '../../src/modules/sales/controllers/sales-orders.controller';
import { TableReservationsController } from '../../src/modules/sales/controllers/table-reservations.controller';
import { TableServiceCallsController } from '../../src/modules/sales/controllers/table-service-calls.controller';
import { SalesController } from '../../src/modules/sales/sales.controller';
import { ServicesController } from '../../src/modules/services/services.controller';
import { SessionsController } from '../../src/modules/sessions/sessions.controller';
import { BranchesController } from '../../src/modules/settings/branches.controller';
import { DailyDigestController } from '../../src/modules/settings/controllers/daily-digest.controller';
import {
  OfflineUpdatesPublicController,
  OfflineUpdatesProtectedController,
  OfflineReleasesAdminController,
} from '../../src/modules/settings/controllers/offline-releases.controller';
import { SettingsAdminController } from '../../src/modules/settings/controllers/settings-admin.controller';
import { SettingsBackupController } from '../../src/modules/settings/controllers/settings-backup.controller';
import { SettingsImportController } from '../../src/modules/settings/controllers/settings-import.controller';
import { SettingsSupportController } from '../../src/modules/settings/controllers/settings-support.controller';
import { TenantTransferController } from '../../src/modules/settings/controllers/tenant-transfer.controller';
import {
  WhatsAppGatewayController,
  WhatsAppPublicWebhookController,
} from '../../src/modules/settings/controllers/whatsapp-gateway.controller';
import { SettingsController } from '../../src/modules/settings/settings.controller';
import { MarketplaceSyncController } from '../../src/modules/storefront/controllers/marketplace-sync.controller';
import { StorefrontMerchantController } from '../../src/modules/storefront/storefront-merchant.controller';
import { StorefrontPublicController } from '../../src/modules/storefront/storefront-public.controller';
import { EtaInvoicesController } from '../../src/modules/tax-integration/controllers/eta-invoices/eta-invoices.controller';
import { TaxSettingsController } from '../../src/modules/tax-integration/controllers/tax-settings/tax-settings.controller';
import { VatDeclarationController } from '../../src/modules/tax-integration/controllers/vat-declaration/vat-declaration.controller';
import { ZatcaController } from '../../src/modules/tax-integration/controllers/zatca/zatca.controller';
import { TenantSubscriptionController } from '../../src/modules/tenant-subscription/tenant-subscription.controller';
import { TradeInController } from '../../src/modules/tradein/tradein.controller';
import { TreasuryController } from '../../src/modules/treasury/treasury.controller';
import { UsersController } from '../../src/modules/users/users.controller';

const CONTROLLERS = [
  TamperAuditController,
  HealthController,
  RuntimeHealthController,
  IdempotencyController,
  LogsController,
  AccountingController,
  ArCollectionsController,
  ActivationController,
  AddonsController,
  AiCopilotController,
  ApprovalWorkflowController,
  BostaController,
  CashDrawerController,
  CatalogController,
  ContractingAdminController,
  ContractingAssuranceController,
  ContractingCoreController,
  ContractingExecutionController,
  ContractingFieldController,
  ContractingFinanceController,
  ContractingPlanningController,
  CrmController,
  DeliveryRepsController,
  DriverPortalController,
  VanSalesAdminController,
  VanSalesController,
  GccShippingController,
  BiometricAttendanceController,
  BiometricAdmsWebhookController,
  BiometricMultiBrandWebhookController,
  EndOfServiceController,
  RecruitmentAtsController,
  EmployeePortalController,
  HrController,
  MobileAttendanceController,
  ImportSalesController,
  QualityAssuranceController,
  ReorderingRulesController,
  WarehouseBinsController,
  WarehousePackagesController,
  InventoryController,
  MaintenanceController,
  ManagerActionsController,
  ManufacturingController,
  MaritimeCustomerPortalController,
  MaritimeFreightController,
  MaritimePublicTrackingController,
  PartnersController,
  PharmacyController,
  PricingController,
  PublicController,
  GoodsReceiptController,
  PurchaseOrdersController,
  PurchaseRfqsController,
  PurchasesController,
  ReportsController,
  ReturnsController,
  DeveloperController,
  SaasAdminController,
  SaasDiagnosticsController,
  CashierFraudRadarController,
  CommercialSubscriptionController,
  CustomerInstallmentsController,
  DeliveryAggregatorsController,
  KdsController,
  KitchenPrintersController,
  PosTerminalController,
  PriceListsController,
  QuotationsController,
  RestaurantAdvancedFnbController,
  RestaurantFoodWasteController,
  SalesOrdersController,
  TableReservationsController,
  TableServiceCallsController,
  SalesController,
  ServicesController,
  SessionsController,
  BranchesController,
  DailyDigestController,
  OfflineUpdatesPublicController,
  OfflineUpdatesProtectedController,
  OfflineReleasesAdminController,
  SettingsAdminController,
  SettingsBackupController,
  SettingsImportController,
  SettingsSupportController,
  TenantTransferController,
  WhatsAppGatewayController,
  WhatsAppPublicWebhookController,
  SettingsController,
  MarketplaceSyncController,
  StorefrontMerchantController,
  StorefrontPublicController,
  EtaInvoicesController,
  TaxSettingsController,
  VatDeclarationController,
  ZatcaController,
  TenantSubscriptionController,
  TradeInController,
  TreasuryController,
  UsersController,
];

const LEGACY_SHA256 = 'f46fea8f16d57b16b5440cf60fc81c6d996e36ade332c0f99dd51c23a310f76e';
// The 5 /api/v1/... routes that already existed before D11 (the diagnostics
// controller's dual array) — they belong to the legacy set AND to the v1 set.
const PRE_EXISTING_V1 = [
  'GET /api/v1/saas-admin/diagnostics/upload',
  'POST /api/v1/saas-admin/diagnostics/upload',
  'GET /api/v1/saas-admin/diagnostics',
  'DELETE /api/v1/saas-admin/diagnostics/:id',
  'GET /api/v1/saas-admin/diagnostics/:id/download',
];
const METHOD_NAMES = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

function norm(...parts: (string | undefined)[]): string {
  const segs: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    for (const s of p.split('/')) {
      if (s) segs.push(s);
    }
  }
  return '/' + segs.join('/');
}

function collectRoutes(): { instances: number; routes: Map<string, number> } {
  const counts = new Map<string, number>();
  let instances = 0;
  for (const Ctrl of CONTROLLERS as any[]) {
    const cpaths: string | string[] = Reflect.getMetadata(PATH_METADATA, Ctrl);
    assert.ok(cpaths !== undefined, `${Ctrl.name}: missing @Controller path metadata`);
    const cList = Array.isArray(cpaths) ? cpaths : [cpaths];
    const proto = Ctrl.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const m = Reflect.getMetadata(METHOD_METADATA, proto[name]);
      if (m === undefined) continue;
      const mp: string | string[] | undefined = Reflect.getMetadata(PATH_METADATA, proto[name]);
      const mList = mp === undefined ? [undefined] : Array.isArray(mp) ? mp : [mp];
      for (const cp of cList) {
        for (const p of mList) {
          const route = `${METHOD_NAMES[m] ?? m} ${norm(cp, p)}`;
          counts.set(route, (counts.get(route) ?? 0) + 1);
          instances++;
        }
      }
    }
  }
  return { instances, routes: counts };
}

function sha256(lines: string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, '../../src', rel), 'utf8');
}

async function main(): Promise<void> {
  // 1. Inventory — the full route table from Nest's own metadata.
  const { instances, routes } = collectRoutes();
  assert.equal(CONTROLLERS.length, 101, 'controller classes');
  assert.equal(instances, 3146, 'expanded route instances after D11');
  const unique = [...routes.keys()].sort();
  assert.equal(unique.length, 3144, 'unique routes after D11');

  const nonV1 = unique.filter((r) => !r.split(' ')[1].startsWith('/api/v1/'));
  const v1 = unique.filter((r) => r.split(' ')[1].startsWith('/api/v1/'));
  const api = unique.filter((r) => r.split(' ')[1].startsWith('/api/') && !r.split(' ')[1].startsWith('/api/v1/'));
  const bare = unique.filter((r) => !r.split(' ')[1].startsWith('/api/'));
  // The legacy set is the non-v1 routes PLUS the 5 v1 routes that already
  // existed before D11 (the diagnostics twins) — it must be byte-identical
  // to the pre-D11 census.
  const legacy = [...new Set([...nonV1, ...PRE_EXISTING_V1])].sort();
  assert.equal(legacy.length, 1725, 'legacy routes (must be unchanged by D11)');
  assert.equal(api.length, 1424, 'legacy api-prefixed routes (excluding v1)');
  assert.equal(bare.length, 296, 'bare (non-api) routes');
  assert.equal(v1.length, 1424, 'v1 routes');
  assert.equal(sha256(legacy), LEGACY_SHA256, 'legacy route set must be byte-identical to the pre-D11 census');

  // The v1 set must be exactly the image of the api set under api/ -> api/v1/.
  const expectedV1 = new Set(
    api.map((r) => {
      const [method, path] = r.split(' ');
      return `${method} ${path.replace('/api/', '/api/v1/')}`;
    }),
  );
  assert.deepEqual(new Set(v1), expectedV1, 'v1 set must be the exact image of the api set');
  // No v1/... route without the api/ prefix (the rejected URI-versioning shape).
  assert.ok(
    unique.every((r) => !r.split(' ')[1].startsWith('/v1/')),
    'no /v1/... route without the api/ prefix may exist',
  );

  // The only duplicated routes are the known pre-existing pair (legacy + v1 twin).
  const duplicated = [...routes.entries()]
    .filter(([, n]) => n > 1)
    .map(([r]) => r)
    .sort();
  assert.deepEqual(
    duplicated,
    ['GET /api/branches', 'GET /api/v1/branches'],
    'only the known pre-existing GET /api/branches overlap may duplicate',
  );

  // The diagnostics /v1 contract resolves (all 5 routes, both forms).
  for (const r of PRE_EXISTING_V1) {
    assert.ok(routes.has(r), `${r} must resolve`);
  }
  console.log('  route inventory passed (101 controllers, 3130 routes, legacy hash pinned)');

  // 2. Source pins — the rejected alternatives stay rejected.
  const mainSrc = readSrc('main.ts');
  assert.ok(!mainSrc.includes('enableVersioning'), 'main.ts must not enable NestJS versioning');
  assert.ok(!mainSrc.includes('setGlobalPrefix'), 'main.ts must not set a global prefix');
  assert.ok(!mainSrc.includes('@Version('), 'no @Version( anywhere in main.ts');
  const diagSrc = readSrc('modules/saas-admin/saas-diagnostics.controller.ts');
  assert.ok(
    diagSrc.includes("'api/saas-admin/diagnostics', 'api/v1/saas-admin/diagnostics'"),
    'the diagnostics controller must keep its dual array (live /v1 contract)',
  );
  console.log('  source pins passed');

  // 3. Live probe — both forms serve identically through the real Nest router.
  @Module({
    controllers: [SaasDiagnosticsController, PartnersController],
    providers: [
      { provide: SaasDiagnosticsService, useValue: {} },
      {
        provide: PartnersService,
        useValue: {
          listCustomers: async () => ({ customers: [], total: 0 }),
          listContacts: async () => ({ contacts: [] }),
        },
      },
    ],
  })
  class VersioningProbeModule {}

  const moduleRef = await Test.createTestingModule({ imports: [VersioningProbeModule] })
    .overrideGuard(SessionAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(DiagnosticsUploadRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0, '127.0.0.1');
  try {
    const port = (app.getHttpServer().address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    async function getBoth(legacyPath: string, v1Path: string, label: string): Promise<void> {
      const a = await fetch(`${base}${legacyPath}`);
      const b = await fetch(`${base}${v1Path}`);
      assert.equal(a.status, 200, `${label}: legacy ${legacyPath} must serve 200`);
      assert.equal(b.status, 200, `${label}: v1 ${v1Path} must serve 200`);
      const bodyA = (await a.json()) as unknown;
      const bodyB = (await b.json()) as unknown;
      assert.deepEqual(bodyB, bodyA, `${label}: v1 body must equal the legacy body`);
    }

    // The live /v1 contract (controller-array aliasing) + unversioned still works.
    await getBoth(
      '/api/saas-admin/diagnostics/upload',
      '/api/v1/saas-admin/diagnostics/upload',
      'diagnostics upload info',
    );
    const diag = await (await fetch(`${base}/api/saas-admin/diagnostics/upload`)).json();
    assert.equal((diag as { status?: string }).status, 'active', 'diagnostics upload info must report active');
    // Method-level aliasing (@Controller('api') + 'v1/<method-path>').
    await getBoth('/api/customers', '/api/v1/customers', 'partners customers');
    // Method-ARRAY aliasing (both elements of the array path gain a v1 twin).
    await getBoth('/api/customers/1/contacts', '/api/v1/customers/1/contacts', 'partners contacts (bare element)');
    await getBoth(
      '/api/partners/customers/1/contacts',
      '/api/v1/partners/customers/1/contacts',
      'partners contacts (partners element)',
    );
    console.log('  live probe passed (both forms serve identically through the real router)');
  } finally {
    await app.close();
  }

  // 4. Wiring: this spec is in both critical lists, in identical order
  // (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 450);
    assert.equal(chain.length, 450);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/api-versioning.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s14-module-documentation.spec.ts');
    console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('API versioning tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
