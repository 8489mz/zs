import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SettingsAdminController } from './controllers/settings-admin.controller';
import { SettingsAdminService } from './services/settings-admin.service';
import { SettingsBackupController } from './controllers/settings-backup.controller';
import { SettingsBackupService } from './services/settings-backup.service';
import { SettingsSupportService } from './services/settings-support.service';
import { SettingsSupportController } from './controllers/settings-support.controller';
import { SettingsImportController } from './controllers/settings-import.controller';
import { SettingsImportService } from './services/settings-import.service';
import { SettingsDemoDataService } from './services/settings-demo-data.service';
import { OfflineReleasesAdminController,
    OfflineUpdatesPublicController,
    OfflineUpdatesProtectedController } from './controllers/offline-releases.controller';
import { OfflineReleasesService } from './services/offline-releases.service';

import { WhatsAppGatewayController, WhatsAppPublicWebhookController } from './controllers/whatsapp-gateway.controller';
import { WhatsAppGatewayService } from './services/whatsapp-gateway.service';
import { DailyDigestController } from './controllers/daily-digest.controller';
import { DailyDigestService } from './services/daily-digest.service';
import { CloudBackupService } from './services/cloud-backup.service';
import { TenantTransferService } from './services/tenant-transfer.service';
import { TenantTransferController } from './controllers/tenant-transfer.controller';
import { DiagnosticsSchedulerService } from './services/diagnostics-scheduler.service';
import { AiCopilotModule } from '../ai-copilot/ai-copilot.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AiCopilotModule, AccountingModule],
  controllers: [
    SettingsController,
    SettingsAdminController,
    SettingsBackupController,
    TenantTransferController,
    SettingsSupportController,
    SettingsImportController,
    WhatsAppGatewayController,
    WhatsAppPublicWebhookController,
    DailyDigestController,
    OfflineReleasesAdminController,
    OfflineUpdatesPublicController,
    OfflineUpdatesProtectedController,
  ],
  providers: [
    SettingsService,
    SettingsAdminService,
    SettingsBackupService,
    CloudBackupService,
    TenantTransferService,
    SettingsSupportService,
    DiagnosticsSchedulerService,
    SettingsImportService,
    SettingsDemoDataService,
    OfflineReleasesService,
    WhatsAppGatewayService,
    DailyDigestService,
  ],
  exports: [SettingsService, WhatsAppGatewayService, DailyDigestService, CloudBackupService, SettingsSupportService, SettingsDemoDataService],
})
export class SettingsModule {}


