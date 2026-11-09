import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { SalesOrdersService } from '../services/sales-orders.service';
import { CreateSalesOrderDto } from '../dto/sales-order.dto';

@Controller('api/sales-orders')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequirePermissions('sales')
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Get()
  listOrders(
    @Query() query: { status?: string; search?: string; limit?: string; offset?: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.salesOrdersService.listOrders(req.authContext!, {
      status: query.status,
      search: query.search,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  }

  // INV-SALES-ORDER-WAREHOUSE-SELECTION: the order form's line
  // availability read. Declared BEFORE ':id' so 'availability' is
  // not captured as an order id. Same arithmetic as the approval
  // check — one source of truth for display and validation.
  @Get('availability')
  getLocationAvailability(
    @Query('productId', ParseIntPipe) productId: number,
    @Query('locationId') locationId: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    const parsed = locationId === undefined || locationId === '' ? null : Number(locationId);
    if (parsed !== null && !Number.isFinite(parsed)) {
      throw new BadRequestException('المخزن غير صالح');
    }
    return this.salesOrdersService.getLocationAvailability(productId, parsed, req.authContext!);
  }

  @Get(':id')
  getOrderById(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.salesOrdersService.getOrderById(id, req.authContext!);
  }

  @Post()
  createOrder(@Body() dto: CreateSalesOrderDto, @Req() req: RequestWithAuth) {
    return this.salesOrdersService.createOrder(dto, req.authContext!);
  }

  @Post(':id/confirm-and-reserve')
  confirmAndReserve(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.salesOrdersService.confirmAndReserve(id, req.authContext!);
  }

  @Post(':id/cancel')
  cancelOrder(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.salesOrdersService.cancelOrder(id, req.authContext!);
  }

  @Post(':id/convert-to-sale')
  convertToSale(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.salesOrdersService.convertToSale(id, req.authContext!);
  }

  @Delete(':id')
  deleteOrder(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.salesOrdersService.deleteOrder(id, req.authContext!);
  }
}
