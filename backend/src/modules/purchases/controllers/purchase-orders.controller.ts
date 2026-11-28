import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto } from '../dto/purchase-order.dto';

@Controller(['api/purchase-orders', 'api/v1/purchase-orders'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequirePermissions('purchases')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  listOrders(
    @Query() query: { status?: string; search?: string; limit?: string; offset?: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.purchaseOrdersService.listOrders(req.authContext!, {
      status: query.status,
      search: query.search,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  }

  @Get(':id')
  getOrderById(
    @Param('id', ParseIntPipe) id: number,
    @Query('forReceiving') forReceiving: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.purchaseOrdersService.getOrderById(id, req.authContext!, forReceiving === 'true');
  }

  @Post()
  createOrder(@Body() dto: CreatePurchaseOrderDto, @Req() req: RequestWithAuth) {
    return this.purchaseOrdersService.createOrder(dto, req.authContext!);
  }

  @Put(':id')
  updateOrder(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePurchaseOrderDto, @Req() req: RequestWithAuth) {
    return this.purchaseOrdersService.updateOrder(id, dto, req.authContext!);
  }

  @Post(':id/confirm')
  confirmOrder(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.purchaseOrdersService.confirmOrder(id, req.authContext!);
  }

  // NOTE: direct goods-receiving for purchase orders was removed here (O3 audit finding).
  // It wrote stock via a path that never created a `goods_receipt_notes` row, never posted
  // a GRNI journal entry, and never ran `computeThreeWayMatch` — a live bypass of the
  // hardened three-way-match/accounting pipeline. It also had zero frontend callers.
  // Conversion below creates a draft bill linked to the PO. Physical receipt and
  // three-way matching use the dedicated goods-receipt endpoints, not this route.

  @Post(':id/convert-to-bill')
  convertToBill(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.purchaseOrdersService.convertToBill(id, req.authContext!);
  }

  @Post(':id/cancel')
  cancelOrder(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.purchaseOrdersService.cancelOrder(id, req.authContext!);
  }

  @Delete(':id')
  deleteOrder(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.purchaseOrdersService.deleteOrder(id, req.authContext!);
  }
}
