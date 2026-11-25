import { Controller, Get, Post, Req, Res, UseGuards, StreamableFile } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { AdminRoleGuard } from '../../../core/auth/guards/admin-role.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { SettingsSupportService } from '../services/settings-support.service';

@Controller('api')
@UseGuards(SessionAuthGuard, AdminRoleGuard)
export class SettingsSupportController {
  constructor(private readonly supportService: SettingsSupportService) {}

  @Get('support-bundle/download')
  async downloadSupportBundle(
    @Req() req: RequestWithAuth,
    @Res({ passthrough: true }) res: any,
  ): Promise<StreamableFile> {
    const zipBuffer = await this.supportService.generateSupportBundle(req.authContext!);
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const fileName = `ZERP-support-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    return new StreamableFile(zipBuffer);
  }

  @Post('support-bundle/send-to-server')
  async sendSupportBundleToServer(@Req() req: RequestWithAuth) {
    return this.supportService.uploadSupportBundleToServer(req.authContext!);
  }
}
