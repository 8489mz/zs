import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { RequireFeature } from '../../core/auth/decorators/feature.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { DeliveryRepsService } from './delivery-reps.service';
import { UpsertDeliveryRepDto } from './dto/upsert-delivery-rep.dto';
import {
  DispatchDeliveryOrdersDto,
  SettleAllDeliveryOrdersDto,
  SettleDeliveryOrderDto,
} from './dto/delivery-reps-settlement.dto';

@Controller(['api/delivery-reps', 'api/v1/delivery-reps'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('deliveryReps')
export class DeliveryRepsController {
  constructor(private readonly service: DeliveryRepsService) {}

  @Get()
  @RequirePermissions('deliveryReps')
  list(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.service.list(req.authContext!);
  }

  @Post()
  @RequirePermissions('deliveryReps')
  create(@Body() payload: UpsertDeliveryRepDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.service.create(payload, req.authContext!);
  }

  @Put(':id')
  @RequirePermissions('deliveryReps')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertDeliveryRepDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.update(id, payload, req.authContext!);
  }

  @Delete(':id')
  @RequirePermissions('deliveryReps')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.service.remove(id, req.authContext!);
  }

  @Get(':id/orders')
  @RequirePermissions('deliveryReps')
  listOrders(
    @Param('id', ParseIntPipe) id: number,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('status') status: string,
    @Query('discountedOnly') discountedOnly: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.listOrders(id, req.authContext!, {
      dateFrom,
      dateTo,
      status,
      discountedOnly: discountedOnly === 'true',
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Get(':id/settlements')
  @RequirePermissions('deliveryReps')
  listSettlements(
    @Param('id', ParseIntPipe) id: number,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.listSettlements(id, req.authContext!, {
      dateFrom,
      dateTo,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Get(':id/kpi')
  @RequirePermissions('deliveryReps')
  getKPIs(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.service.getRepKPIs(id, req.authContext!);
  }

  @Post('settle/:saleId')
  @RequirePermissions('deliveryReps')
  settleOrder(
    @Param('saleId', ParseIntPipe) saleId: number,
    @Body() body: SettleDeliveryOrderDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.settleOrder(saleId, req.authContext!, body);
  }

  @Post('settle-partial/:saleId')
  @RequirePermissions('deliveryReps')
  settlePartialOrder(
    @Param('saleId', ParseIntPipe) saleId: number,
    @Body() body: SettleDeliveryOrderDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.settlePartialOrder(saleId, req.authContext!, body);
  }

  @Post(':id/settle-all')
  @RequirePermissions('deliveryReps')
  settleAllOrders(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SettleAllDeliveryOrdersDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.settleAllOrders(id, body?.expectedAmount as number, req.authContext!, body?.countedCashAmount);
  }

  @Get(':id/summary')
  @RequirePermissions('deliveryReps')
  getRepSummary(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.service.getRepSummary(id, req.authContext!);
  }

  // INV-VAN-PROFIT-REP-REPORTING: unified rep lifetime report.
  @Get(':id/lifetime-report')
  @RequirePermissions('deliveryReps')
  getRepLifetimeReport(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.getRepLifetimeReport(id, req.authContext!);
  }

  @Post('dispatch')
  @RequirePermissions('deliveryReps')
  dispatchOrders(
    @Body() payload: DispatchDeliveryOrdersDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.service.dispatchOrders(req.authContext!, payload);
  }
}
