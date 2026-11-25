import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from '../../../core/auth/services/permission.service';
import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ANY_PERMISSIONS_KEY,
} from '../../../core/auth/decorators/permissions.decorator';
import { REQUIRED_FEATURE_KEY } from '../../../core/auth/decorators/feature.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { ConfigService } from '@nestjs/config';
import { PlanFeatureService } from '../services/plan-feature.service';
import { isPlatformTenantId } from '../utils/tenant-boundary';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly planFeatureService: PlanFeatureService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeature = this.reflector.getAllAndOverride<string>(REQUIRED_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(REQUIRED_ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const allowAuth = this.reflector.getAllAndOverride<boolean>('allow_authenticated', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required && !requiredAny && !allowAuth) {
      throw new Error(
        `Endpoint ${context.getClass().name}.${context.getHandler().name} is protected by PermissionsGuard but lacks @RequirePermissions, @RequireAnyPermission, or @AllowAuthenticated marker.`,
      );
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = request.authContext;

    // This guard is an authorization boundary even when a controller forgets
    // SessionAuthGuard. Never allow @AllowAuthenticated without an identity.
    if (!auth) throw new ForbiddenException('Authentication required');

    // Role alone cannot grant platform-wide access outside the platform tenant.
    const isSuperAdmin = auth.role === 'super_admin' && isPlatformTenantId(auth.tenantId);

    // 1. Mandatory Feature Check: MUST RUN FIRST before permission checks to prevent guard bypass
    if (!isSuperAdmin && requiredFeature && auth) {
      // P10: the super-admin per-tenant overrides ride on the auth context
      // (loaded from tenant_feature_overrides at session resolution), so a
      // hide override refuses the endpoint even when the user holds the
      // permission, and a grant opens it even where the mode default blocks it.
      if (
        !this.planFeatureService.hasFeature(
          auth.planId,
          auth.extraFeatures,
          requiredFeature,
          auth.pillar,
          auth.activityType,
          auth.featureOverrides,
        )
      ) {
        throw new ForbiddenException(
          'هذه الميزة غير متاحة في باقتك الحالية أو نشاط منشأتك. يرجى مراجعة إدارة المنظومة.',
        );
      }
    }

    if (isSuperAdmin) {
      return true;
    }

    if ((!required || required.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }

    const granted = auth?.permissions ?? [];

    // For regular users, check granular permissions
    if (required && required.length > 0 && !this.permissionService.hasAllPermissions(granted, required)) {
      console.error(
        `[PermissionsGuard] Missing required permissions! URL: ${request.url}, User: ${auth?.username}, Granted: ${granted.join(',')}, Required: ${required.join(',')}`,
      );
      throw new ForbiddenException('Missing required permissions');
    }

    if (requiredAny && requiredAny.length > 0 && !this.permissionService.hasAnyPermission(granted, requiredAny)) {
      console.error(
        `[PermissionsGuard] Missing required any permissions! URL: ${request.url}, User: ${auth?.username}, Granted: ${granted.join(',')}, RequiredAny: ${requiredAny.join(',')}`,
      );
      throw new ForbiddenException('Missing required any permissions');
    }

    return true;
  }
}
