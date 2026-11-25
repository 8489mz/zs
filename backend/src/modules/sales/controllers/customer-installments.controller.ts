import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireAnyPermission } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { CustomerInstallmentsService } from '../services/customer-installments.service';
import { CreateInstallmentPlanDto, PayInstallmentDto, ListInstallmentsQueryDto } from '../dto/customer-installment.dto';

@Controller(['api/installments', 'api/v1/installments'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireAnyPermission('sales', 'customers')
export class CustomerInstallmentsController {
  constructor(private readonly installmentsService: CustomerInstallmentsService) {}

  @Get('metrics')
  getMetrics(@Req() req: RequestWithAuth) {
    return this.installmentsService.getSummaryMetrics(req.authContext!);
  }

  @Get('plans')
  listPlans(@Query() query: { customerId?: number; status?: string; search?: string }, @Req() req: RequestWithAuth) {
    return this.installmentsService.listPlans(query, req.authContext!);
  }

  @Get('plans/:id')
  getPlanDetails(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.installmentsService.getPlanDetails(id, req.authContext!);
  }

  @Post('plans')
  createPlan(@Body() dto: CreateInstallmentPlanDto, @Req() req: RequestWithAuth) {
    return this.installmentsService.createPlan(dto, req.authContext!);
  }

  @Get('schedule')
  listInstallments(@Query() query: ListInstallmentsQueryDto, @Req() req: RequestWithAuth) {
    return this.installmentsService.listInstallments(query, req.authContext!);
  }

  @Post(':id/pay')
  payInstallment(@Param('id', ParseIntPipe) id: number, @Body() dto: PayInstallmentDto, @Req() req: RequestWithAuth) {
    return this.installmentsService.payInstallment(id, dto, req.authContext!);
  }
}
