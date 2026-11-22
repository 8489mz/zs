import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { ManagerDashboardService } from './manager-dashboard.service';
import { ManagerActionsService } from './manager-actions.service';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ManagerActionsController {
  constructor(
    private readonly managerActionsService: ManagerActionsService,
    private readonly managerDashboardService: ManagerDashboardService,
  ) {}

  // F12 (trial problem 15): manager insights are a supervisor
  // surface — the old Any list (dashboard/pos/sales/...) let any
  // cashier or rep read fraud, margin and shortage alerts for the
  // whole tenant. 'reports' is the established manager-view key:
  // the cashier default deliberately excludes it, the admin template
  // holds it.
  @Get('manager-actions')
  @RequirePermissions('reports')
  list(@Query('limit') limit: string | undefined, @Req() req: RequestWithAuth) {
    return this.managerActionsService.list(Number(limit || 8), req.authContext!);
  }

  // F12 (trial problem 15): the decision-center overview fed the
  // dashboard's decision grid to any 'dashboard' holder — every
  // cashier holds 'dashboard'. Same 'reports' gate as manager-actions.
  @Get('dashboard/manager-overview')
  @RequirePermissions('reports')
  managerOverview(@Req() req: RequestWithAuth) {
    return this.managerDashboardService.overview(req.authContext!);
  }
}
