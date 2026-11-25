import { AccountingModule } from '../accounting/accounting.module';
import { Module } from '@nestjs/common';
import { MaritimeFreightService } from './maritime-freight.service';
import { MaritimeMailService } from './maritime-mail.service';
import { MaritimeFreightController } from './maritime-freight.controller';
import { MaritimePublicTrackingController } from './maritime-public-tracking.controller';
import { MaritimeCustomerPortalController } from './maritime-customer-portal.controller';
import { MaritimeCustomerPortalService } from './maritime-customer-portal.service';

import { MaritimeAutomationSchedulerService } from './maritime-automation-scheduler.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [AccountingModule, SettingsModule],
  controllers: [MaritimeFreightController, MaritimePublicTrackingController, MaritimeCustomerPortalController],
  providers: [
    MaritimeFreightService,
    MaritimeMailService,
    MaritimeAutomationSchedulerService,
    MaritimeCustomerPortalService,
  ],
  exports: [
    MaritimeFreightService,
    MaritimeMailService,
    MaritimeAutomationSchedulerService,
    MaritimeCustomerPortalService,
  ],
})
export class MaritimeFreightModule {}
