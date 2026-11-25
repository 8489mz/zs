import { Controller, Get, Post, Delete, Body, Param, Query, Req, ParseIntPipe, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { RequirePermissions, RequireAnyPermission } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import {
  EndOfServiceService,
  SettlementCalculateInputDto,
  CreateSettlementDto,
} from '../services/end-of-service.service';
import { PostSettlementAccountingDto } from '../dto/hr-eos-write.dto';

@Controller('api/hr/settlements')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('hr')
export class EndOfServiceController {
  constructor(private readonly eosService: EndOfServiceService) {}

  @Post('calculate-preview')
  @RequireAnyPermission('hrSalaryView', 'hrSalaryManage', 'hrPayrollApprove')
  async calculatePreview(@Body() body: SettlementCalculateInputDto, @Req() req: RequestWithAuth) {
    return this.eosService.calculateSettlementPreview(body, req.authContext!);
  }

  @Post()
  @RequirePermissions('hrSalaryManage')
  async createSettlement(@Body() body: CreateSettlementDto, @Req() req: RequestWithAuth) {
    return this.eosService.createSettlement(body, req.authContext!);
  }

  @Get()
  @RequireAnyPermission('hrSalaryView', 'hrSalaryManage', 'hrPayrollApprove')
  async listSettlements(
    @Query('status') status: string | undefined,
    @Query('employeeId') employeeId: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.eosService.listSettlements(req.authContext!, {
      status,
      employeeId: employeeId ? Number(employeeId) : undefined,
    });
  }

  @Get(':id')
  @RequireAnyPermission('hrSalaryView', 'hrSalaryManage', 'hrPayrollApprove')
  async getSettlement(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.eosService.getSettlement(id, req.authContext!);
  }

  @Post(':id/post-accounting')
  @RequirePermissions('hrPayrollApprove')
  async postAccounting(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PostSettlementAccountingDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.eosService.postAccountingEntry(id, body, req.authContext!);
  }

  @Delete(':id')
  @RequirePermissions('hrSalaryManage')
  async deleteSettlement(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.eosService.deleteSettlement(id, req.authContext!);
  }
}
