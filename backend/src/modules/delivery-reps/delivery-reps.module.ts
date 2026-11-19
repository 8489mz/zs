import { Module } from '@nestjs/common';
import { AuditModule } from '../../core/audit/audit.module';
import { DeliveryRepsController } from './delivery-reps.controller';
import { DriverPortalController } from './driver-portal.controller';
import { VanSalesController } from './van-sales.controller';
import { VanSalesAdminController } from './van-sales-admin.controller';
import { DeliveryRepsService } from './delivery-reps.service';
import { VanSalesService } from './van-sales.service';
import { VanFleetService } from './services/van-fleet.service';
import { VanRequisitionsService } from './services/van-requisitions.service';
import { VanReturnsService } from './services/van-returns.service';
import { VanTargetsService } from './services/van-targets.service';
import { VanTransfersService } from './services/van-transfers.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanPreSalesService } from './services/van-pre-sales.service';
import { VanFraudRadarService } from './services/van-fraud-radar.service';
import { VanPromotionsService } from './services/van-promotions.service';
import { VanFieldExecutionService } from './services/van-field-execution.service';

import { DatabaseModule } from '../../database/database.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SalesModule } from '../sales/sales.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AuditModule, DatabaseModule, AccountingModule, SalesModule, SettingsModule],
  controllers: [DeliveryRepsController, DriverPortalController, VanSalesController, VanSalesAdminController],
  providers: [
    DeliveryRepsService,
    VanSalesService,
    VanFleetService,
    VanRequisitionsService,
    VanReturnsService,
    VanTargetsService,
    VanTransfersService,
    VanRoutesService,
    VanPreSalesService,
    VanFraudRadarService,
    VanPromotionsService,
    VanFieldExecutionService,
  ],
  exports: [
    DeliveryRepsService,
    VanSalesService,
    VanFleetService,
    VanRequisitionsService,
    VanReturnsService,
    VanTargetsService,
    VanTransfersService,
    VanRoutesService,
    VanPreSalesService,
    VanFraudRadarService,
    VanPromotionsService,
    VanFieldExecutionService,
  ],
})
export class DeliveryRepsModule {}
