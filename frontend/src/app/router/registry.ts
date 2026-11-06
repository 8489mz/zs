import type { FeatureRouteModule } from '@/app/router/types';
import { dashboardRouteModule } from '@/features/dashboard/routes';
import { productsRouteModule } from '@/features/products/routes';
import { salesRouteModule } from '@/features/sales/routes';
import { posRouteModule } from '@/features/pos/routes';
import { cashDrawerRouteModule } from '@/features/cash-drawer/routes';
import { purchasesRouteModule } from '@/features/purchases/routes';
import { inventoryRouteModule } from '@/features/inventory/routes';
import { suppliersRouteModule } from '@/features/suppliers/routes';
import { customersRouteModule } from '@/features/customers/routes';
import { accountsRouteModule } from '@/features/accounts/routes';
import { returnsRouteModule } from '@/features/returns/routes';
import { reportsRouteModule } from '@/features/reports/routes';
import { auditRouteModule } from '@/features/audit/routes';
import { treasuryRouteModule } from '@/features/treasury/routes';
import { servicesRouteModule } from '@/features/services/routes';
import { hrRouteModule } from '@/features/hr/routes';
import { settingsRouteModule } from '@/features/settings/routes';
import { updatesRouteModule } from '@/features/updates/routes';
import { pricingCenterRouteModule } from '@/features/pricing-center/routes';
import { accountingRouteModule } from '@/features/accounting/routes';
import { saasAdminRouteModule } from '@/features/saas-admin/routes';
import { manufacturingRouteModule } from '@/features/manufacturing/routes';
import { deliveryRepsRoutes } from '@/features/delivery-reps/routes';
import { importSalesRouteModule } from '@/features/import-sales/routes';
import { maritimeFreightRouteModule } from '@/features/maritime-freight/routes';
import { maintenanceRouteModule } from '@/features/maintenance/routes';
import { tradeInRouteModule } from '@/features/tradein/routes';
import { pharmacyRouteModule } from '@/features/pharmacy/routes';
import { crmRouteModule } from '@/features/crm/routes';
import { approvalsRouteModule } from '@/features/approvals/routes';
import { contractingRouteModule } from '@/features/contracting/routes';
import { appsStoreRouteModule } from '@/features/apps-store/routes';

export const featureRouteModules: FeatureRouteModule[] = [
  appsStoreRouteModule,
  dashboardRouteModule,
  approvalsRouteModule,
  productsRouteModule,
  salesRouteModule,
  crmRouteModule,
  posRouteModule,
  cashDrawerRouteModule,
  purchasesRouteModule,
  inventoryRouteModule,
  suppliersRouteModule,
  customersRouteModule,
  accountsRouteModule,
  returnsRouteModule,
  reportsRouteModule,
  auditRouteModule,
  treasuryRouteModule,
  maintenanceRouteModule,
  tradeInRouteModule,
  pharmacyRouteModule,
  servicesRouteModule,
  hrRouteModule,
  accountingRouteModule,
  saasAdminRouteModule,
  pricingCenterRouteModule,
  settingsRouteModule,
  updatesRouteModule,
  manufacturingRouteModule,
  deliveryRepsRoutes,
  importSalesRouteModule,
  maritimeFreightRouteModule,
  contractingRouteModule,
];

export const appRoutes = featureRouteModules.flatMap((module) => module.routes);
export const navigationItems = featureRouteModules.flatMap((module) => module.navigation ?? []);
