import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { ConfigAccessModule } from './config/config-access.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './core/health/health.module';
import { LoggingModule } from './core/logging/logging.module';
import { AuthFoundationModule } from './core/auth/auth.module';
import { AuditModule } from './core/audit/audit.module';
import { IdempotencyModule } from './core/idempotency/idempotency.module';
import { UsersModule } from './modules/users/users.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PartnersModule } from './modules/partners/partners.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule } from './modules/sales/sales.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CashDrawerModule } from './modules/cash-drawer/cash-drawer.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { TreasuryModule } from './modules/treasury/treasury.module';
import { ServicesModule } from './modules/services/services.module';
import { HrModule } from './modules/hr/hr.module';
import { ActivationModule } from './modules/activation/activation.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ManagerActionsModule } from './modules/manager-actions/manager-actions.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { SaasAdminModule } from './modules/saas-admin/saas-admin.module';
import { PublicModule } from './modules/public/public.module';
import { ManufacturingModule } from './modules/manufacturing/manufacturing.module';
import { DeliveryRepsModule } from './modules/delivery-reps/delivery-reps.module';
import { AddonsModule } from './modules/addons/addons.module';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { LoginRateLimitMiddleware } from './common/middleware/login-rate-limit.middleware';
import { AuthBurstRateLimitMiddleware } from './common/middleware/auth-burst-rate-limit.middleware';
import { StorefrontPublicRateLimitMiddleware } from './common/middleware/storefront-public-rate-limit.middleware';
import { InMemoryRateLimitService } from './common/security/in-memory-rate-limit.service';
import { TaxIntegrationModule } from './modules/tax-integration/tax-integration.module';
import { ImportSalesModule } from './modules/import-sales/import-sales.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { TradeInModule } from './modules/tradein/tradein.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { TenantSubscriptionModule } from './modules/tenant-subscription/tenant-subscription.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { AiCopilotModule } from './modules/ai-copilot/ai-copilot.module';
import { BostaModule } from './modules/bosta/bosta.module';
import { GccShippingModule } from './modules/gcc-shipping/gcc-shipping.module';
import { CrmModule } from './modules/crm/crm.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { MaritimeFreightModule } from './modules/maritime-freight/maritime-freight.module';
import { ContractingModule } from './modules/contracting/contracting.module';

@Module({
  imports: [
    ContractingModule,
    ApprovalsModule,
    AppConfigModule,
    ConfigAccessModule,
    LoggingModule,
    DatabaseModule,
    AuthFoundationModule,
    AuditModule,
    IdempotencyModule,
    HealthModule,
    UsersModule,
    SettingsModule,
    SessionsModule,
    CatalogModule,
    PartnersModule,
    InventoryModule,
    SalesModule,
    PurchasesModule,
    ReportsModule,
    CashDrawerModule,
    ReturnsModule,
    TreasuryModule,
    ServicesModule,
    HrModule,
    ActivationModule,
    PricingModule,
    ManagerActionsModule,
    AccountingModule,
    SaasAdminModule,
    TenantSubscriptionModule,
    PublicModule,
    ManufacturingModule,
    DeliveryRepsModule,
    AddonsModule,
    TaxIntegrationModule,
    ImportSalesModule,
    MaintenanceModule,
    TradeInModule,
    PharmacyModule,
    StorefrontModule,
    AiCopilotModule,
    BostaModule,
    GccShippingModule,
    CrmModule,
    MaritimeFreightModule,
  ],

  providers: [
    InMemoryRateLimitService,
    LoginRateLimitMiddleware,
    AuthBurstRateLimitMiddleware,
    StorefrontPublicRateLimitMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');

    consumer
      .apply(LoginRateLimitMiddleware)
      .forRoutes(
        { path: 'api/auth/login', method: RequestMethod.POST },
        { path: 'api/auth/login/mfa', method: RequestMethod.POST },
        { path: 'api/developer/feature-plans', method: RequestMethod.GET },
        { path: 'api/developer/update-plan', method: RequestMethod.POST },
      );

    consumer.apply(AuthBurstRateLimitMiddleware).forRoutes(
      { path: 'api/auth/logout', method: RequestMethod.POST },
      { path: 'api/auth/change-password', method: RequestMethod.POST },
      { path: 'api/auth/sessions/revoke-others', method: RequestMethod.POST },
      { path: 'api/auth/sessions/:id', method: RequestMethod.DELETE },
      // Public portal endpoints validate their own short-lived HMAC/PIN,
      // but must also have an IP burst budget before reaching the login
      // service, including requests probing many different identities.
      { path: 'api/hr/portal/login', method: RequestMethod.POST },
      { path: 'api/hr/mobile-punch/login', method: RequestMethod.POST },
      { path: 'api/driver-portal/login', method: RequestMethod.POST },
      { path: 'api/freight-portal/auth/login', method: RequestMethod.POST },
      { path: 'api/freight-portal/auth/token-login', method: RequestMethod.POST },
      { path: 'freight-portal/auth/login', method: RequestMethod.POST },
      { path: 'freight-portal/auth/token-login', method: RequestMethod.POST },
      { path: 'api/maritime-freight/portal/auth/login', method: RequestMethod.POST },
      { path: 'api/maritime-freight/portal/auth/token-login', method: RequestMethod.POST },
      // Magic-link bids are public but write commercial records.
      { path: 'api/public/freight-tracking/rfq/:id/bid', method: RequestMethod.POST },
      { path: 'public/freight-tracking/rfq/:id/bid', method: RequestMethod.POST },
      { path: 'api/public/carrier-quote/rfq/:id/bid', method: RequestMethod.POST },
      { path: 'public/carrier-quote/rfq/:id/bid', method: RequestMethod.POST },
      { path: 'api/developer/*path', method: RequestMethod.ALL },
    );

    // O60: public storefront writes. The middleware itself decides which paths are limited
    // (classifyStorefrontPublicRequest) and lets reads, webhooks and admin routes through untouched.
    consumer
      .apply(StorefrontPublicRateLimitMiddleware)
      .forRoutes({ path: 'api/storefront/*path', method: RequestMethod.ALL });
  }
}
