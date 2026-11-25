import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequireAnyPermission } from '../auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../auth/interfaces/request-with-auth.interface';
import { TamperAuditService } from './tamper-audit.service';
import { TamperAuditQueryDto } from './dto/tamper-audit.dto';

@Controller(['api/audit/tamper-trail', 'api/v1/audit/tamper-trail'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireAnyPermission('audit', 'admin', 'reports')
export class TamperAuditController {
  constructor(private readonly tamperAuditService: TamperAuditService) {}

  @Get()
  async listLogs(@Query() query: TamperAuditQueryDto, @Req() req: RequestWithAuth) {
    return this.tamperAuditService.listTamperLogs(req.authContext!, query);
  }

  @Get('verify')
  async verifyChain(@Req() req: RequestWithAuth) {
    return this.tamperAuditService.verifyChainIntegrity(req.authContext!);
  }

  @Get('history/:tableName/:recordId')
  async getRecordHistory(
    @Param('tableName') tableName: string,
    @Param('recordId') recordId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.tamperAuditService.getRecordTimeline(req.authContext!, tableName, recordId);
  }
}
