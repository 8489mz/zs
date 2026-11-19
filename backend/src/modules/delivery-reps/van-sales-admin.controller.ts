import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
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
import { VanSalesAdminFleetSlice } from './van-sales-admin/van-sales-admin-fleet';
import { VanSalesAdminTargetsSlice } from './van-sales-admin/van-sales-admin-targets';
import { VanSalesAdminOpsSlice } from './van-sales-admin/van-sales-admin-ops';

@Controller('api/van-sales/admin')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('deliveryReps')
export class VanSalesAdminController {
  private readonly adminPreSalesTrips: VanSalesAdminPreSalesTripsSlice;
  private readonly adminFleet: VanSalesAdminFleetSlice;
  private readonly adminTargets: VanSalesAdminTargetsSlice;
  private readonly adminOps: VanSalesAdminOpsSlice;

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
    this.adminFleet = new VanSalesAdminFleetSlice(
      this.vanSalesService,
    );
    this.adminTargets = new VanSalesAdminTargetsSlice(
      this.vanSalesService,
    );
    this.adminOps = new VanSalesAdminOpsSlice(
      this.vanSalesService,
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

  @Get('vehicles')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listVehicles(@Req() req: RequestWithAuth) {
    return this.adminFleet.listVehicles(req);
  }

  @Post('vehicles')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async createVehicle(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      plateNumber: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      assignedRepId?: number;
      notes?: string;
    },
  ) {
    return this.adminFleet.createVehicle(req, body);
  }

  @Put('vehicles/:id')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async updateVehicle(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      plateNumber?: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      status?: string;
      assignedRepId?: number | null;
      notes?: string;
    },
  ) {
    return this.adminFleet.updateVehicle(req, id, body);
  }

  @Post('vehicles/:id/assign')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async assignRep(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { repId: number | null; shiftName?: string },
  ) {
    return this.adminFleet.assignRep(req, id, body);
  }

  @Get('returns')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listReturns(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('repId') repId?: string,
    @Query('tripId') tripId?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.adminFleet.listReturns(req, status, repId, tripId, customerId);
  }

  @Post('returns/:id/approve')
  @RequirePermissions('deliveryReps')
  async approveReturn(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminFleet.approveReturn(req, id);
  }

  @Post('returns/:id/reject')
  @RequirePermissions('deliveryReps')
  async rejectReturn(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.adminFleet.rejectReturn(req, id, body);
  }

  @Get('available-products')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getAdminAvailableProducts(
    @Req() req: RequestWithAuth,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.adminFleet.getAdminAvailableProducts(req, warehouseId);
  }

  @Get('requisitions')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listAdminRequisitions(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('repId') repId?: string,
  ) {
    return this.adminFleet.listAdminRequisitions(req, status, repId);
  }

  @Get('warehouses')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listAdminWarehouses(@Req() req: RequestWithAuth) {
    return this.adminFleet.listAdminWarehouses(req);
  }

  @Post('requisitions')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async createAdminRequisition(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      repId: number;
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
      dispatchImmediately?: boolean;
    },
  ) {
    return this.adminFleet.createAdminRequisition(req, body);
  }

  @Put('requisitions/:id/review')
  @RequirePermissions('deliveryReps')
  async reviewRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { approvedItems: { productId: number; qty: number }[]; notes?: string; sourceWarehouseId?: number },
  ) {
    return this.adminFleet.reviewRequisition(req, id, body);
  }

  @Post('requisitions/:id/dispatch')
  @RequirePermissions('deliveryReps')
  async dispatchRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminFleet.dispatchRequisition(req, id);
  }

  @Post('requisitions/:id/reject')
  @RequirePermissions('deliveryReps')
  async rejectRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.adminFleet.rejectRequisition(req, id, body);
  }

  @Delete('requisitions/:id')
  @RequirePermissions('deliveryReps')
  async deleteRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminFleet.deleteRequisition(req, id);
  }

  @Get('targets')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listRepTargets(
    @Req() req: RequestWithAuth,
    @Query('month') month?: string,
  ) {
    return this.adminTargets.listRepTargets(req, month);
  }

  @Post('targets')
  @RequirePermissions('deliveryReps')
  async setRepTarget(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      repId: number;
      month: string;
      targetAmount: number;
      collectionTarget?: number | null;
      visitsTarget?: number | null;
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
    },
  ) {
    return this.adminTargets.setRepTarget(req, body);
  }

  @Get('targets/commission-config')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getCommissionConfig(@Req() req: RequestWithAuth) {
    return this.adminTargets.getCommissionConfig(req);
  }

  @Post('targets/commission-config')
  @RequirePermissions('deliveryReps')
  async saveCommissionConfig(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
      repId?: number;
    },
  ) {
    return this.adminTargets.saveCommissionConfig(req, body);
  }

  @Post('targets/settle-commission')
  @RequirePermissions('deliveryReps')
  async settleRepCommission(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      repId: number;
      periodMonth: string;
      amount?: number;
      notes?: string;
    },
  ) {
    return this.adminTargets.settleRepCommission(req, body);
  }

  @Get('kpis')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getRouteKpis(
    @Req() req: RequestWithAuth,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminTargets.getRouteKpis(req, dateFrom, dateTo);
  }

  @Get('field-visits')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listFieldVisits(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('customerId') customerId?: string,
    @Query('visitType') visitType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminTargets.listFieldVisits(req, repId, customerId, visitType, dateFrom, dateTo);
  }

  @Post('customers/:id/route-schedule')
  @RequirePermissions('deliveryReps')
  async setCustomerRouteSchedule(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) {
    return this.adminTargets.setCustomerRouteSchedule(req, id, body);
  }

  @Get('supervisor/customer-routes')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getSupervisorCustomerRoutes(
    @Req() req: RequestWithAuth,
    @Query('search') search?: string,
    @Query('repId') repId?: string,
    @Query('route') route?: string,
    @Query('unassignedOnly') unassignedOnly?: string,
  ) {
    return this.adminTargets.getSupervisorCustomerRoutes(req, search, repId, route, unassignedOnly);
  }

  @Post('supervisor/customer-routes/bulk-assign')
  @RequirePermissions('deliveryReps')
  async bulkAssignCustomerRoutes(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      appendReps?: boolean;
      assignedRepName?: string;
      route?: string;
      visitDays?: string[];
    },
  ) {
    return this.adminTargets.bulkAssignCustomerRoutes(req, body);
  }

  @Get('fuel-logs')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listFuelLogs(
    @Req() req: RequestWithAuth,
    @Query('vehicleId') vehicleId?: string,
    @Query('repId') repId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminTargets.listFuelLogs(req, vehicleId, repId, dateFrom, dateTo);
  }

  @Post('fuel-logs')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async recordFuelLog(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      vehicleId: number;
      tripId?: number;
      repId?: number;
      odometer: number;
      liters: number;
      pricePerLiter: number;
      stationName?: string;
      notes?: string;
    },
  ) {
    return this.adminTargets.recordFuelLog(req, body);
  }

  @Get('oil-changes')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listOilChanges(
    @Req() req: RequestWithAuth,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.adminOps.listOilChanges(req, vehicleId);
  }

  @Post('oil-changes')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async recordOilChange(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      vehicleId: number;
      odometerAtChange: number;
      oilType: string;
      ratedKm: number;
      withFilter: boolean;
      alertKmBefore?: number;
      cost?: number;
      performedBy?: string;
      notes?: string;
      repId?: number;
    },
  ) {
    return this.adminOps.recordOilChange(req, body);
  }

  @Get('maintenance-alerts')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getMaintenanceAlerts(@Req() req: RequestWithAuth) {
    return this.adminOps.getMaintenanceAlerts(req);
  }

  @Get('vehicles/:id/drivers')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listVehicleDrivers(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminOps.listVehicleDrivers(req, id);
  }

  @Post('vehicles/:id/drivers')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async assignVehicleDriver(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      repId: number;
      shiftName: string;
      shiftStartTime?: string;
      shiftEndTime?: string;
      notes?: string;
    },
  ) {
    return this.adminOps.assignVehicleDriver(req, id, body);
  }

  @Delete('vehicles/:id/drivers/:driverId')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async removeVehicleDriver(
    @Req() req: RequestWithAuth,
    @Param('driverId', ParseIntPipe) driverId: number,
  ) {
    return this.adminOps.removeVehicleDriver(req, driverId);
  }

  @Get('transfers')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listAdminTransfers(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('status') status?: string,
  ) {
    return this.adminOps.listAdminTransfers(req, repId, status);
  }

  @Get('trips/:id/expenses')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async getAdminTripExpenses(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminOps.getAdminTripExpenses(req, id);
  }

  @Get('trips/:id/packaging')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getAdminTripPackaging(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminOps.getAdminTripPackaging(req, id);
  }

  @Get('customers/:customerId/packaging')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getAdminCustomerPackaging(
    @Req() req: RequestWithAuth,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.adminOps.getAdminCustomerPackaging(req, customerId);
  }

  @Get('fraud-radar/summary')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory', 'accounting')
  async getFraudRadarSummary(
    @Req() req: RequestWithAuth,
    @Query('days') days?: string,
    @Query('repId') repId?: string,
  ) {
    return this.adminOps.getFraudRadarSummary(req, days, repId);
  }

  @Get('fraud-radar/events')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory', 'accounting')
  async getFraudRadarEvents(
    @Req() req: RequestWithAuth,
    @Query('days') days?: string,
    @Query('repId') repId?: string,
    @Query('eventCode') eventCode?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminOps.getFraudRadarEvents(req, days, repId, eventCode, limit);
  }
}
