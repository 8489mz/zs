import { Global, Module } from '@nestjs/common';
import { PermissionService } from './services/permission.service';
import { SessionService } from './services/session.service';
import { PlanFeatureService } from './services/plan-feature.service';
import { BootstrapAdminService } from './services/bootstrap-admin.service';
import { AuthCacheService } from './services/auth-cache.service';
import { AdminRoleGuard } from './guards/admin-role.guard';

@Global()
@Module({
  providers: [
    SessionService,
    PermissionService,
    PlanFeatureService,
    BootstrapAdminService,
    AuthCacheService,
    AdminRoleGuard,
  ],
  exports: [SessionService, PermissionService, PlanFeatureService, AuthCacheService, AdminRoleGuard],
})
export class AuthFoundationModule {}
