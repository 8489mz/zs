import { InMemoryRateLimitService } from '../../common/security/in-memory-rate-limit.service';
import { DiagnosticsUploadRateLimitGuard } from './diagnostics-upload-rate-limit.guard';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthFoundationModule } from '../../core/auth/auth.module';
import { AuditModule } from '../../core/audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { SaasAdminController } from './saas-admin.controller';
import { DeveloperController } from './developer.controller';
import { SaasDiagnosticsController } from './saas-diagnostics.controller';
import { SaasAdminService } from './saas-admin.service';
import { TrialTenantProvisioningService } from './trial-tenant-provisioning.service';
import { SaasDiagnosticsService } from './saas-diagnostics.service';

@Module({
  imports: [DatabaseModule, AuthFoundationModule, AuditModule, SettingsModule],
  controllers: [SaasAdminController, DeveloperController, SaasDiagnosticsController],
  providers: [
    SaasAdminService,
    TrialTenantProvisioningService,
    SaasDiagnosticsService,
    InMemoryRateLimitService,
    DiagnosticsUploadRateLimitGuard,
  ],
  exports: [TrialTenantProvisioningService, SaasDiagnosticsService],
})
export class SaasAdminModule {}
