import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { SuperAdminRoleGuard } from '../../core/auth/guards/super-admin-role.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import {
  ActivateTenantDto,
  CreateTrialTenantDto,
  ExtendTrialDto,
  ListSaasTenantsQueryDto,
  ResetOwnerPasswordDto,
  TenantStatusActionDto,
  RenewTenantDto,
  CreateSaasPlanDto,
  UpdateSaasPlanDto,
  RecordPaymentDto,
  UpdateTenantPlanDto,
  UpdateTenantSlugDto,
} from './dto/saas-admin.dto';
import { SaasAdminService } from './saas-admin.service';
import {
  DeleteTenantDto,
  ExitImpersonationDto,
  SeedTenantDemoDto,
  WipeTenantDataDto,
} from './dto/saas-admin-lifecycle-write.dto';

@Controller('api/saas-admin')
@UseGuards(SessionAuthGuard, SuperAdminRoleGuard)
export class SaasAdminController {
  constructor(private readonly service: SaasAdminService) {}

  @Get('plans')
  listPlans(@Req() req: RequestWithAuth) {
    return this.service.listPlans(req.authContext!);
  }

  @Get('feature-plans')
  listFeaturePlans(@Req() req: RequestWithAuth) {
    return this.service.listFeaturePlans(req.authContext!);
  }

  @Post('plans')
  createPlan(@Body() body: CreateSaasPlanDto, @Req() req: RequestWithAuth) {
    return this.service.createPlan(body, req.authContext!);
  }

  @Post('plans/:id')
  updatePlan(@Param('id') id: string, @Body() body: UpdateSaasPlanDto, @Req() req: RequestWithAuth) {
    return this.service.updatePlan(Number(id), body, req.authContext!);
  }

  @Get('tenants/:id/subscriptions')
  getSubscriptions(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.service.getSubscriptions(id, req.authContext!);
  }

  @Post('tenants/:id/renew')
  renewTenant(@Param('id') id: string, @Body() body: RenewTenantDto, @Req() req: RequestWithAuth) {
    return this.service.renewTenant(id, body, req.authContext!);
  }

  @Post('tenants/:id/payment')
  recordPayment(@Param('id') id: string, @Body() body: RecordPaymentDto, @Req() req: RequestWithAuth) {
    return this.service.recordPayment(id, body, req.authContext!);
  }

  @Get('tenants')
  listTenants(@Query() query: ListSaasTenantsQueryDto, @Req() req: RequestWithAuth) {
    return this.service.listTenants(query, req.authContext!);
  }

  @Get('tenants/:id')
  getTenantById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.service.getTenantById(id, req.authContext!);
  }

  @Get('tenants/:id/timeline')
  getTenantTimeline(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.service.getTenantTimeline(id, req.authContext!);
  }

  @Post('tenants/trial')
  createTrialTenant(@Body() body: CreateTrialTenantDto, @Req() req: RequestWithAuth) {
    return this.service.createTrialTenant(body, req.authContext!);
  }

  @Post('tenants/:id/activate')
  activateTenant(@Param('id') id: string, @Body() body: ActivateTenantDto, @Req() req: RequestWithAuth) {
    return this.service.activateTenant(id, body, req.authContext!);
  }

  @Post('tenants/:id/suspend')
  suspendTenant(@Param('id') id: string, @Body() body: TenantStatusActionDto, @Req() req: RequestWithAuth) {
    return this.service.suspendTenant(id, body, req.authContext!);
  }

  @Post('tenants/:id/expire')
  expireTenant(@Param('id') id: string, @Body() body: TenantStatusActionDto, @Req() req: RequestWithAuth) {
    return this.service.expireTenant(id, body, req.authContext!);
  }

  @Post('tenants/:id/extend-trial')
  extendTrial(@Param('id') id: string, @Body() body: ExtendTrialDto, @Req() req: RequestWithAuth) {
    return this.service.extendTrial(id, body, req.authContext!);
  }

  @Post('tenants/:id/unlock-owner')
  unlockOwner(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.service.unlockOwner(id, req.authContext!);
  }

  @Post('tenants/:id/reset-owner-password')
  resetOwnerPassword(@Param('id') id: string, @Body() body: ResetOwnerPasswordDto, @Req() req: RequestWithAuth) {
    return this.service.resetOwnerPassword(id, body, req.authContext!);
  }

  @Post('tenants/:id/delete')
  deleteTenant(@Param('id') id: string, @Body() body: DeleteTenantDto, @Req() req: RequestWithAuth) {
    return this.service.deleteTenant(id, body?.superAdminPassword || '', req.authContext!);
  }

  @Post('tenants/:id/plan')
  updateTenantPlan(@Param('id') id: string, @Body() body: UpdateTenantPlanDto, @Req() req: RequestWithAuth) {
    return this.service.updateTenantPlan(id, body, req.authContext!);
  }

  @Post('tenants/:id/slug')
  updateTenantSlug(@Param('id') id: string, @Body() body: UpdateTenantSlugDto, @Req() req: RequestWithAuth) {
    return this.service.updateTenantSlug(id, body.slug, req.authContext!);
  }

  @Post('tenants/:id/impersonate')
  async impersonateTenant(
    @Param('id') id: string,
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.impersonateTenant(id, req.authContext!, {
      ipAddress: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '',
    });
    this.service.setAuthCookies(res, result.sessionId, result.expiresAt);
    return {
      ok: true,
      sessionId: result.sessionId,
      originalSessionId: result.originalSessionId,
      loginPayload: await this.service.buildLoginPayload(result.auth),
    };
  }

  @Post('exit-impersonation')
  async exitImpersonation(
    @Body() body: ExitImpersonationDto,
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.exitImpersonation(body?.originalSessionId, req.authContext!);
    this.service.setAuthCookies(res, result.sessionId, result.expiresAt);
    return {
      ok: true,
      sessionId: result.sessionId,
      loginPayload: await this.service.buildLoginPayload(result.auth),
    };
  }

  @Post('tenants/:id/seed-demo')
  seedTenantDemo(@Param('id') id: string, @Body() body: SeedTenantDemoDto, @Req() req: RequestWithAuth) {
    return this.service.seedTenantDemo(id, body, req.authContext!);
  }

  @Post('tenants/:id/wipe-data')
  wipeTenantData(@Param('id') id: string, @Body() body: WipeTenantDataDto, @Req() req: RequestWithAuth) {
    return this.service.wipeTenantData(id, body?.superAdminPassword || '', req.authContext!);
  }
}
