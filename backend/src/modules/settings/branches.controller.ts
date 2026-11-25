import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { SettingsService } from './settings.service';

@Controller('api')
@UseGuards(SessionAuthGuard)
export class BranchesController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get(['branches', 'v1/branches'])
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  listBranches(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.settingsService.listBranches(req.authContext!);
  }
}
