import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { DailyDigestService, DailyDigestConfig } from '../services/daily-digest.service';
import { DailyDigestConfigDto } from '../dto/settings-write.dto';

@Controller(['api/settings/daily-digest', 'api/v1/settings/daily-digest'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class DailyDigestController {
  constructor(private readonly dailyDigestService: DailyDigestService) {}

  @Get('config')
  @RequirePermissions('canManageSettings')
  getConfig(@Req() req: RequestWithAuth): Promise<DailyDigestConfig> {
    return this.dailyDigestService.getConfig(req.authContext!);
  }

  @Post('config')
  @RequirePermissions('canManageSettings')
  saveConfig(@Body() payload: DailyDigestConfigDto, @Req() req: RequestWithAuth): Promise<{ ok: boolean }> {
    return this.dailyDigestService.saveConfig(payload, req.authContext!);
  }

  @Post('send-test')
  @RequirePermissions('canManageSettings')
  sendTest(
    @Body('phone') phone: string,
    @Req() req: RequestWithAuth,
  ): Promise<{ success: boolean; message?: string; text?: string }> {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.dailyDigestService.generateAndSendDigest(tenantId, phone);
  }
}
