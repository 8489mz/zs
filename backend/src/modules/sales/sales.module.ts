import { Module } from '@nestjs/common';
import { ReturnsModule } from '../returns/returns.module';
import { AccountingModule } from '../accounting/accounting.module';
import { AuditModule } from '../../core/audit/audit.module';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { SettingsModule } from '../settings/settings.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SalesAuthorizationService } from './services/sales-authorization.service';
import { SalesFinanceService } from './services/sales-finance.service';
import { SalesQueryService } from './services/sales-query.service';
import { SalesWriteService } from './services/sales-write.service';
import { QuotationsController } from './controllers/quotations.controller';
import { QuotationsService } from './services/quotations.service';
import { PosTerminalController } from './controllers/pos-terminal.controller';
import { PosTerminalService } from './services/pos-terminal.service';

import { CustomerInstallmentsController } from './controllers/customer-installments.controller';
import { CustomerInstallmentsService } from './services/customer-installments.service';
import { CashierFraudRadarController } from './controllers/cashier-fraud-radar.controller';
import { CashierFraudRadarService } from './services/cashier-fraud-radar.service';
import { KdsController } from './controllers/kds.controller';
import { KdsService } from './services/kds.service';
import { SalesOrdersController } from './controllers/sales-orders.controller';
import { SalesOrdersService } from './services/sales-orders.service';
import { PriceListsController } from './controllers/price-lists.controller';
import { PriceListsService } from './services/price-lists.service';
import { CommercialSubscriptionController } from './controllers/commercial-subscription.controller';
import { CommercialSubscriptionService } from './services/commercial-subscription.service';
import { DeliveryAggregatorsController } from './controllers/delivery-aggregators.controller';
import { DeliveryAggregatorsService } from './services/delivery-aggregators.service';
import { RestaurantFoodWasteController } from './controllers/restaurant-food-waste.controller';
import { RestaurantFoodWasteService } from './services/restaurant-food-waste.service';
import { TableReservationsController } from './controllers/table-reservations.controller';
import { TableReservationsService } from './services/table-reservations.service';
import { KitchenPrintersController } from './controllers/kitchen-printers.controller';
import { KitchenPrintersService } from './services/kitchen-printers.service';
import { TableServiceCallsController } from './controllers/table-service-calls.controller';
import { TableServiceCallsService } from './services/table-service-calls.service';
import { TableCallRateLimitGuard } from './guards/table-call-rate-limit.guard';
import { InMemoryRateLimitService } from '../../common/security/in-memory-rate-limit.service';
import { RestaurantAdvancedFnbController } from './controllers/restaurant-advanced-fnb.controller';
import { RestaurantAdvancedFnbService } from './services/restaurant-advanced-fnb.service';

@Module({
  imports: [DatabaseModule, AuditModule, AuthFoundationModule, AccountingModule, SettingsModule, ReturnsModule],
  controllers: [
    PriceListsController,
    PosTerminalController,
    QuotationsController,
    SalesOrdersController,
    CustomerInstallmentsController,
    CashierFraudRadarController,
    KdsController,
    DeliveryAggregatorsController,
    RestaurantFoodWasteController,
    TableReservationsController,
    KitchenPrintersController,
    TableServiceCallsController,
    RestaurantAdvancedFnbController,
    CommercialSubscriptionController,
    SalesController,
  ],
  providers: [
    SalesService,
    SalesAuthorizationService,
    SalesFinanceService,
    SalesQueryService,
    SalesWriteService,
    QuotationsService,
    SalesOrdersService,
    PriceListsService,
    PosTerminalService,
    CustomerInstallmentsService,
    CashierFraudRadarService,
    KdsService,
    DeliveryAggregatorsService,
    RestaurantFoodWasteService,
    TableReservationsService,
    KitchenPrintersService,
    TableServiceCallsService,
    TableCallRateLimitGuard,
    InMemoryRateLimitService,
    RestaurantAdvancedFnbService,
    CommercialSubscriptionService,
  ],
  exports: [
    SalesService,
    SalesFinanceService,
    QuotationsService,
    SalesOrdersService,
    PriceListsService,
    PosTerminalService,
    CustomerInstallmentsService,
    CashierFraudRadarService,
    KdsService,
    DeliveryAggregatorsService,
    RestaurantFoodWasteService,
    TableReservationsService,
    KitchenPrintersService,
    TableServiceCallsService,
    CommercialSubscriptionService,
  ],
})
export class SalesModule {}


