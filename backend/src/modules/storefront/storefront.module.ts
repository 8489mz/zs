import { AccountingModule } from '../accounting/accounting.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../../core/audit/audit.module';
import { SalesModule } from '../sales/sales.module';
import { SettingsModule } from '../settings/settings.module';
import { StorefrontService } from './storefront.service';
import { StorefrontPaymentService } from './storefront-payment.service';
import { StorefrontSocialPreviewService } from './storefront-social-preview.service';
import { StorefrontMediaService } from './storefront-media.service';
import { StorefrontPublicController } from './storefront-public.controller';
import { StorefrontMerchantController } from './storefront-merchant.controller';
import { MarketplaceSyncService } from './services/marketplace-sync.service';
import { MarketplaceSyncController } from './controllers/marketplace-sync.controller';
import { StorefrontReservationSchedulerService } from './services/storefront-reservation-scheduler.service';

@Module({
  imports: [AccountingModule, DatabaseModule, AuditModule, SalesModule, SettingsModule],
  controllers: [StorefrontMerchantController, StorefrontPublicController, MarketplaceSyncController],
  providers: [
    StorefrontService,
    StorefrontPaymentService,
    StorefrontSocialPreviewService,
    StorefrontMediaService,
    MarketplaceSyncService,
    StorefrontReservationSchedulerService,
  ],
  exports: [StorefrontService, StorefrontPaymentService, MarketplaceSyncService, StorefrontReservationSchedulerService],
})
export class StorefrontModule {}
