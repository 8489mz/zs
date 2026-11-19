import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { VanSalesService } from './van-sales.service';
import { VanPreSalesService } from './services/van-pre-sales.service';
import { VanPromotionsService } from './services/van-promotions.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanFieldExecutionService } from './services/van-field-execution.service';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { RequireFeature } from '../../core/auth/decorators/feature.decorator';
import { VanSalesAdminPreSalesTripsSlice } from './van-sales-admin/van-sales-admin-pre-sales-trips';

@Controller('api/van-sales/admin')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('deliveryReps')
export class VanSalesAdminController {
  private readonly adminPreSalesTrips: VanSalesAdminPreSalesTripsSlice;

  constructor(
    private readonly vanSalesService: VanSalesService,
    private readonly vanPreSalesService: VanPreSalesService,
    private readonly vanPromotionsService: VanPromotionsService,
    private readonly vanRoutesService: VanRoutesService,
    private readonly vanFieldExecutionService: VanFieldExecutionService,
  ) {
    this.adminPreSalesTrips = new VanSalesAdminPreSalesTripsSlice(
      this.vanSalesService,
      this.vanPreSalesService,
    );
  }

  @Get('pre-sales-orders')
  @RequireAnyPermission('deliveryReps', 'sales')
  async listPreSalesOrders(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    return this.adminPreSalesTrips.listPreSalesOrders(req, repId, customerId, status, dateFrom, dateTo, search);
  }

  @Get('pre-sales-orders/:id')
  @RequireAnyPermission('deliveryReps', 'sales')
  async getPreSalesOrderDetails(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminPreSalesTrips.getPreSalesOrderDetails(req, id);
  }

  @Post('pre-sales-orders/:id/approve')
  @RequireAnyPermission('deliveryReps', 'sales')
  async approvePreSalesOrder(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminPreSalesTrips.approvePreSalesOrder(req, id);
  }

  @Post('pre-sales-orders/:id/reject')
  @RequireAnyPermission('deliveryReps', 'sales')
  async rejectPreSalesOrder(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    return this.adminPreSalesTrips.rejectPreSalesOrder(req, id, reason);
  }

  @Post('pre-sales-orders/consolidate-requisition')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async consolidatePreSalesOrdersToRequisition(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      orderIds: number[];
      targetRepId: number;
      sourceWarehouseId?: number;
      notes?: string;
    },
  ) {
    return this.adminPreSalesTrips.consolidatePreSalesOrdersToRequisition(req, body);
  }

  @Post('pre-sales-orders/:id/convert-invoice')
  @RequireAnyPermission('deliveryReps', 'sales')
  async convertPreSalesOrderToInvoice(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body?: {
      paymentType?: 'cash' | 'credit';
      paidAmount?: number;
      notes?: string;
    },
  ) {
    return this.adminPreSalesTrips.convertPreSalesOrderToInvoice(req, id, body);
  }

  @Get('trips')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listTrips(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminPreSalesTrips.listTrips(req, repId, status, dateFrom, dateTo);
  }

  @Get('trips/:id')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getTripDetails(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.adminPreSalesTrips.getTripDetails(req, id, page, pageSize);
  }

  @Post('trips/:id/settle')
  @RequirePermissions('deliveryReps')
  async settleTripAdmin(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      repId: number;
      countedCash: number;
      // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash.
      perDayCash?: { businessDay: string; countedCash: number }[];
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      nightStockApproved?: boolean;
      nightStockNotes?: string;
      endOdometer?: number;
      chargeStockVarianceToRep?: boolean;
      notes?: string;
    },
  ) {
    return this.adminPreSalesTrips.settleTripAdmin(req, id, body);
  }
}
