import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
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
import { VanSalesAdminPromotionsLedgerSlice } from './van-sales-admin/van-sales-admin-promotions-ledger';

@Controller('api/van-sales/admin')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('deliveryReps')
export class VanSalesAdminController {
  private readonly adminPreSalesTrips: VanSalesAdminPreSalesTripsSlice;
  private readonly adminFleet: VanSalesAdminFleetSlice;
  private readonly adminTargets: VanSalesAdminTargetsSlice;
  private readonly adminOps: VanSalesAdminOpsSlice;
  private readonly adminPromotionsLedger: VanSalesAdminPromotionsLedgerSlice;

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
    this.adminPromotionsLedger = new VanSalesAdminPromotionsLedgerSlice(
      this.vanSalesService,
      this.vanPromotionsService,
      this.vanRoutesService,
      this.vanFieldExecutionService,
    );
  }

  @Get('pre-sales-orders')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async getPreSalesOrderDetails(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminPreSalesTrips.getPreSalesOrderDetails(req, id);
  }

  @Post('pre-sales-orders/:id/approve')
  @RequirePermissions('deliveryRepsAdmin')
  async approvePreSalesOrder(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminPreSalesTrips.approvePreSalesOrder(req, id);
  }

  @Post('pre-sales-orders/:id/reject')
  @RequirePermissions('deliveryRepsAdmin')
  async rejectPreSalesOrder(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    return this.adminPreSalesTrips.rejectPreSalesOrder(req, id, reason);
  }

  @Post('pre-sales-orders/consolidate-requisition')
  @RequirePermissions('deliveryRepsAdmin')
  async consolidatePreSalesOrdersToRequisition(
    @Req() req: RequestWithAuth,
    @Body()
    body: {
      orderIds: number[];
      // F18 (trial problem 30): FE sends `deliveryRepId`; `targetRepId`
      // is the older name. Either is accepted downstream.
      targetRepId?: number;
      deliveryRepId?: number;
      sourceWarehouseId?: number;
      notes?: string;
    },
  ) {
    return this.adminPreSalesTrips.consolidatePreSalesOrdersToRequisition(req, body);
  }

  @Post('pre-sales-orders/:id/convert-invoice')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async getTripDetails(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
  ) {
    return this.adminPreSalesTrips.getTripDetails(req, id, page, pageSize);
  }

  @Post('trips/:id/settle')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async listVehicles(@Req() req: RequestWithAuth) {
    return this.adminFleet.listVehicles(req);
  }

  @Post('vehicles')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async assignRep(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { repId: number | null; shiftName?: string },
  ) {
    return this.adminFleet.assignRep(req, id, body);
  }

  @Get('returns')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async approveReturn(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminFleet.approveReturn(req, id);
  }

  @Post('returns/:id/reject')
  @RequirePermissions('deliveryRepsAdmin')
  async rejectReturn(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.adminFleet.rejectReturn(req, id, body);
  }

  @Get('available-products')
  @RequirePermissions('deliveryRepsAdmin')
  async getAdminAvailableProducts(
    @Req() req: RequestWithAuth,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.adminFleet.getAdminAvailableProducts(req, warehouseId);
  }

  @Get('requisitions')
  @RequirePermissions('deliveryRepsAdmin')
  async listAdminRequisitions(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('repId') repId?: string,
  ) {
    return this.adminFleet.listAdminRequisitions(req, status, repId);
  }

  @Get('warehouses')
  @RequirePermissions('deliveryRepsAdmin')
  async listAdminWarehouses(@Req() req: RequestWithAuth) {
    return this.adminFleet.listAdminWarehouses(req);
  }

  @Post('requisitions')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async reviewRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { approvedItems: { productId: number; qty: number }[]; notes?: string; sourceWarehouseId?: number },
  ) {
    return this.adminFleet.reviewRequisition(req, id, body);
  }

  @Post('requisitions/:id/dispatch')
  @RequirePermissions('deliveryRepsAdmin')
  async dispatchRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminFleet.dispatchRequisition(req, id);
  }

  @Post('requisitions/:id/reject')
  @RequirePermissions('deliveryRepsAdmin')
  async rejectRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    return this.adminFleet.rejectRequisition(req, id, body);
  }

  @Delete('requisitions/:id')
  @RequirePermissions('deliveryRepsAdmin')
  async deleteRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminFleet.deleteRequisition(req, id);
  }

  // Targets Management Endpoints
  @Get('targets')
  @RequirePermissions('deliveryRepsAdmin')
  async listRepTargets(
    @Req() req: RequestWithAuth,
    @Query('month') month?: string,
  ) {
    return this.adminTargets.listRepTargets(req, month);
  }

  @Post('targets')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async getCommissionConfig(@Req() req: RequestWithAuth) {
    return this.adminTargets.getCommissionConfig(req);
  }

  @Post('targets/commission-config')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async getRouteKpis(
    @Req() req: RequestWithAuth,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminTargets.getRouteKpis(req, dateFrom, dateTo);
  }

  @Get('field-visits')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
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

  // Fleet Oil Changes Endpoints
  @Get('oil-changes')
  @RequirePermissions('deliveryRepsAdmin')
  async listOilChanges(
    @Req() req: RequestWithAuth,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.adminOps.listOilChanges(req, vehicleId);
  }

  @Post('oil-changes')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async getMaintenanceAlerts(@Req() req: RequestWithAuth) {
    return this.adminOps.getMaintenanceAlerts(req);
  }

  @Get('vehicles/:id/drivers')
  @RequirePermissions('deliveryRepsAdmin')
  async listVehicleDrivers(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminOps.listVehicleDrivers(req, id);
  }

  @Post('vehicles/:id/drivers')
  @RequirePermissions('deliveryRepsAdmin')
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
  @RequirePermissions('deliveryRepsAdmin')
  async removeVehicleDriver(
    @Req() req: RequestWithAuth,
    @Param('driverId', ParseIntPipe) driverId: number,
  ) {
    return this.adminOps.removeVehicleDriver(req, driverId);
  }

  @Get('transfers')
  @RequirePermissions('deliveryRepsAdmin')
  async listAdminTransfers(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('status') status?: string,
  ) {
    return this.adminOps.listAdminTransfers(req, repId, status);
  }

  @Get('trips/:id/expenses')
  @RequirePermissions('deliveryRepsAdmin')
  async getAdminTripExpenses(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminOps.getAdminTripExpenses(req, id);
  }

  @Get('trips/:id/packaging')
  @RequirePermissions('deliveryRepsAdmin')
  async getAdminTripPackaging(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminOps.getAdminTripPackaging(req, id);
  }

  @Get('customers/:customerId/packaging')
  @RequirePermissions('deliveryRepsAdmin')
  async getAdminCustomerPackaging(
    @Req() req: RequestWithAuth,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.adminOps.getAdminCustomerPackaging(req, customerId);
  }

  @Get('fraud-radar/summary')
  @RequirePermissions('deliveryRepsAdmin')
  async getFraudRadarSummary(
    @Req() req: RequestWithAuth,
    @Query('days') days?: string,
    @Query('repId') repId?: string,
  ) {
    return this.adminOps.getFraudRadarSummary(req, days, repId);
  }

  @Get('fraud-radar/events')
  @RequirePermissions('deliveryRepsAdmin')
  async getFraudRadarEvents(
    @Req() req: RequestWithAuth,
    @Query('days') days?: string,
    @Query('repId') repId?: string,
    @Query('eventCode') eventCode?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminOps.getFraudRadarEvents(req, days, repId, eventCode, limit);
  }

  // =========================================================================
  // FMCG MIX & MATCH PROMOTIONS ADMIN
  // =========================================================================

  @Get('promotions')
  @RequirePermissions('deliveryRepsAdmin')
  async listAdminPromotions(
    @Req() req: RequestWithAuth,
    @Query('isActive') isActive?: string,
    @Query('promoType') promoType?: string,
  ) {
    return this.adminPromotionsLedger.listAdminPromotions(req, isActive, promoType);
  }

  @Post('promotions')
  @RequirePermissions('deliveryRepsAdmin')
  async createPromotion(
    @Req() req: RequestWithAuth,
    @Body() body: any,
  ) {
    return this.adminPromotionsLedger.createPromotion(req, body);
  }

  @Put('promotions/:id')
  @RequirePermissions('deliveryRepsAdmin')
  async updatePromotion(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.adminPromotionsLedger.updatePromotion(req, id, body);
  }

  @Delete('promotions/:id')
  @RequirePermissions('deliveryRepsAdmin')
  async deletePromotion(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.adminPromotionsLedger.deletePromotion(req, id);
  }

  @Patch('promotions/:id/toggle-active')
  @RequirePermissions('deliveryRepsAdmin')
  async togglePromotionActive(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isActive: boolean },
  ) {
    return this.adminPromotionsLedger.togglePromotionActive(req, id, body);
  }

  @Post('routes/optimize')
  @RequirePermissions('deliveryRepsAdmin')
  async optimizeSupervisorRoute(
    @Req() req: RequestWithAuth,
    @Body() body: {
      customerIds?: number[];
      route?: string;
      repId?: number;
      startLat?: number;
      startLng?: number;
      persistSequence?: boolean;
    },
  ) {
    return this.adminPromotionsLedger.optimizeSupervisorRoute(req, body);
  }

  @Get('visits')
  @RequirePermissions('deliveryRepsAdmin')
  async listVisitsHistory(
    @Req() req: RequestWithAuth,
    @Query('tripId') tripId?: string,
    @Query('repId') repId?: string,
    @Query('customerId') customerId?: string,
    @Query('date') date?: string,
    @Query('noSaleOnly') noSaleOnly?: string,
  ) {
    return this.adminPromotionsLedger.listVisitsHistory(req, tripId, repId, customerId, date, noSaleOnly);
  }

  @Get('trade-surveys')
  @RequirePermissions('deliveryRepsAdmin')
  async listTradeSurveys(
    @Req() req: RequestWithAuth,
    @Query('tripId') tripId?: string,
    @Query('customerId') customerId?: string,
    @Query('surveyType') surveyType?: string,
  ) {
    return this.adminPromotionsLedger.listTradeSurveys(req, tripId, customerId, surveyType);
  }

  @Get('trips/:tripId/breadcrumbs')
  @RequirePermissions('deliveryRepsAdmin')
  async getLiveTripBreadcrumbs(
    @Req() req: RequestWithAuth,
    @Param('tripId', ParseIntPipe) tripId: number,
  ) {
    return this.adminPromotionsLedger.getLiveTripBreadcrumbs(req, tripId);
  }

  @Get('financial-ledger')
  @RequirePermissions('deliveryRepsAdmin')
  async getRepFinancialLedger(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminPromotionsLedger.getRepFinancialLedger(req, repId, status, dateFrom, dateTo);
  }

  @Post('financial-ledger/:id/settle')
  @RequirePermissions('deliveryRepsAdmin')
  async settleRepFinancialItem(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { method: 'cash' | 'waiver'; notes?: string; reason?: string; supervisorPin?: string },
  ) {
    return this.adminPromotionsLedger.settleRepFinancialItem(req, id, body);
  }

  @Post('financial-ledger/push-to-payroll')
  @RequireAnyPermission('hrPayrollManage', 'accounting')
  async pushRepShortagesToPayroll(
    @Req() req: RequestWithAuth,
    @Body() body: { settlementIds: number[]; targetMonth?: string },
  ) {
    return this.adminPromotionsLedger.pushRepShortagesToPayroll(req, body);
  }

  @Post('financial-ledger/bonus')
  @RequirePermissions('deliveryRepsAdmin')
  async addRepBonusOrCommission(
    @Req() req: RequestWithAuth,
    @Body() body: { repId: number; entryType: 'bonus' | 'commission'; amount: number; notes: string },
  ) {
    return this.adminPromotionsLedger.addRepBonusOrCommission(req, body);
  }

  @Post('financial-ledger/link-employee')
  @RequirePermissions('deliveryRepsAdmin')
  async linkRepToEmployee(
    @Req() req: RequestWithAuth,
    @Body() body: { repId: number; employeeId: number | null },
  ) {
    return this.adminPromotionsLedger.linkRepToEmployee(req, body);
  }

  @Get('financial-ledger/candidate-employees')
  @RequirePermissions('deliveryRepsAdmin')
  async listCandidateEmployees(
    @Req() req: RequestWithAuth,
  ) {
    return this.adminPromotionsLedger.listCandidateEmployees(req);
  }

  @Post('financial-ledger/auto-create-employee')
  @RequirePermissions('deliveryRepsAdmin')
  async autoCreateEmployee(
    @Req() req: RequestWithAuth,
    @Body() body: { repId: number },
  ) {
    return this.adminPromotionsLedger.autoCreateEmployee(req, body);
  }
}
