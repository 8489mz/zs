import { Controller, Get, Post, Patch, Param, Body, Query, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { DeliveryAggregatorsService, AggregatorChannelDto, IngestOrderDto } from '../services/delivery-aggregators.service';

@Controller(['sales/aggregators', 'api/sales/delivery-aggregators', 'api/sales/aggregators'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@AllowAuthenticated()
export class DeliveryAggregatorsController {
  constructor(private readonly service: DeliveryAggregatorsService) {}

  @Get()
  async listAggregators(@Req() req: RequestWithAuth) {
    return this.service.listAggregators(req.authContext!);
  }

  @Patch(':id')
  async updateAggregator(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: Partial<AggregatorChannelDto>,
  ) {
    return this.service.updateAggregator(req.authContext!, id, payload);
  }

  // INV-REST-FNB-TRUTH-2 (R-I7): ingest stays session-authenticated
  // for manual / mock ingest. A real aggregator webhook has no staff
  // session, so this endpoint cannot accept live webhooks — and no
  // real webhook ingestion is built here (LEAVE: no real aggregator
  // demand; marketplace sync deferred by user decision 2026-11-05).
  @Post('orders/ingest')
  async ingestOrder(@Req() req: RequestWithAuth, @Body() dto: IngestOrderDto) {
    return this.service.ingestOrder(req.authContext!, dto);
  }

  @Get('orders')
  async listOrders(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listOrders(req.authContext!, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.service.updateOrderStatus(req.authContext!, id, status);
  }

  @Post('86')
  async trigger86(
    @Req() req: RequestWithAuth,
    @Body('productId', ParseIntPipe) productId: number,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    return this.service.trigger86(req.authContext!, productId, isAvailable ?? false);
  }
}
