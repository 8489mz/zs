import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { TaxSettingsService, TaxSettingsDto } from '../../services/tax-settings/tax-settings.service';
import { SessionAuthGuard } from '../../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';

@Controller(['api/tax-settings', 'api/v1/tax-settings'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class TaxSettingsController {
  constructor(private readonly taxSettingsService: TaxSettingsService) {}

  /**
   * لا يُعاد `client_secret` إطلاقاً — فقط علامة وجوده (`hasClientSecret`).
   * والصلاحية صارت نفس صلاحية الكتابة: قراءة إعدادات بوابة ضريبية ليست أقل
   * حساسية من تعديلها.
   */
  @Get()
  @RequirePermissions('canManageSettings')
  async getSettings(@Req() req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext);
    const settings = await this.taxSettingsService.getPublicSettings(tenantId);
    return {
      status: 'success',
      settings,
    };
  }

  @Post()
  @RequirePermissions('canManageSettings')
  async updateSettings(@Req() req: RequestWithAuth, @Body() payload: TaxSettingsDto) {
    if (!payload.provider) {
      payload.provider = 'ETA_EGYPT';
    }
    const { tenantId, accountId } = requireTenantScope(req.authContext);
    const settings = await this.taxSettingsService.upsertSettings(tenantId, accountId, payload);
    return {
      status: 'success',
      settings: this.taxSettingsService.toPublicSettings(settings),
    };
  }
}
