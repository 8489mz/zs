import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { VanSalesService } from './van-sales.service';
import { DeliveryRepsService } from './delivery-reps.service';
import { VanPreSalesService } from './services/van-pre-sales.service';
import { VanPromotionsService } from './services/van-promotions.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanFieldExecutionService } from './services/van-field-execution.service';
import { SubmitLoadRequisitionDto } from './dto/submit-load-requisition.dto';
import { CreatePreSalesOrderDto } from './services/van-pre-sales/van-pre-sales-types';
import {
  ExecuteDamagedSwapDto,
  ExecuteSaleDto,
  OpenTripDto,
  RecordCollectionDto,
  SettleTripDriverDto,
  SubmitFieldReturnDto,
  SubmitTripSettlementDto,
} from './dto/van-driver-orders.dto';
import {
  CheckInStoreVisitDto,
  CheckOutStoreVisitDto,
  CreateDriverCustomerDto,
  CreateTransferDto,
  EvaluateCartPromotionsDto,
  OptimizeDriverRouteDto,
  RecordBreadcrumbDto,
  RecordFieldVisitDto,
  RecordPackagingMovementDto,
  RecordTradeSurveyDto,
  RecordTripExpenseDto,
  RecordVisitInventoryDto,
  RecordVisitNoSaleDto,
} from './dto/van-driver-field.dto';
import { RecordFuelLogDto, RecordOilChangeDto } from './dto/van-fleet.dto';
import { RejectWithReasonDto } from './dto/van-trips.dto';
import { VanSalesDriverPreSalesSlice } from './van-sales-driver/van-sales-driver-pre-sales';
import { VanSalesDriverTripsSettleSlice } from './van-sales-driver/van-sales-driver-trips-settle';
import { VanSalesDriverSalesSlice } from './van-sales-driver/van-sales-driver-sales';
import { VanSalesDriverRequisitionsSlice } from './van-sales-driver/van-sales-driver-requisitions';
import { VanSalesDriverFieldSlice } from './van-sales-driver/van-sales-driver-field';

@Controller(['api/driver-portal/van-sales', 'api/v1/driver-portal/van-sales'])
export class VanSalesController {
  private readonly preSalesSlice: VanSalesDriverPreSalesSlice;
  private readonly tripsSettleSlice: VanSalesDriverTripsSettleSlice;
  private readonly driverSales: VanSalesDriverSalesSlice;
  private readonly requisitions: VanSalesDriverRequisitionsSlice;
  private readonly driverField: VanSalesDriverFieldSlice;

  constructor(
    private readonly vanSalesService: VanSalesService,
    private readonly deliveryRepsService: DeliveryRepsService,
    private readonly vanPreSalesService: VanPreSalesService,
    private readonly vanPromotionsService: VanPromotionsService,
    private readonly vanRoutesService: VanRoutesService,
    private readonly vanFieldExecutionService: VanFieldExecutionService,
  ) {
    this.preSalesSlice = new VanSalesDriverPreSalesSlice(this.vanPreSalesService, this.verifyDriver.bind(this));
    this.tripsSettleSlice = new VanSalesDriverTripsSettleSlice(
      this.vanSalesService,
      this.deliveryRepsService,
      this.verifyDriver.bind(this),
    );
    this.driverSales = new VanSalesDriverSalesSlice({
      vanSalesService: this.vanSalesService,
      verifyDriver: this.verifyDriver.bind(this),
    });
    this.requisitions = new VanSalesDriverRequisitionsSlice({
      vanSalesService: this.vanSalesService,
      verifyDriver: this.verifyDriver.bind(this),
    });
    this.driverField = new VanSalesDriverFieldSlice({
      vanSalesService: this.vanSalesService,
      vanPromotionsService: this.vanPromotionsService,
      vanRoutesService: this.vanRoutesService,
      vanFieldExecutionService: this.vanFieldExecutionService,
      verifyDriver: this.verifyDriver.bind(this),
    });
  }

  /**
   * INV-DRIVER-PIN-FIRST-LOGIN-CHANGE (H4 ride-along, M16): every
   * van-sales driver endpoint re-derives the default-PIN flag from
   * the live hash — a default-PIN rep is refused here exactly as on
   * the driver portal's own data routes (DriverPortalController).
   * The change-PIN endpoint lives in DriverPortalController and is
   * the only escape hatch; it must NOT call this helper.
   */
  private async verifyDriver(authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    await this.deliveryRepsService.assertDriverPinChanged(driver);
    return driver;
  }

  @Get('pre-sales/catalog')
  async listPreSalesCatalog(
    @Headers('authorization') authHeader: string,
    @Query('warehouseLocationId') warehouseLocationId?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.preSalesSlice.listPreSalesCatalog(authHeader, warehouseLocationId, search, categoryId);
  }

  @Post('pre-sales/orders')
  async createPreSalesOrder(@Headers('authorization') authHeader: string, @Body() body: CreatePreSalesOrderDto) {
    return this.preSalesSlice.createPreSalesOrder(authHeader, body);
  }

  @Get('pre-sales/my-orders')
  async listMyPreSalesOrders(
    @Headers('authorization') authHeader: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    return this.preSalesSlice.listMyPreSalesOrders(authHeader, status, dateFrom, dateTo, search);
  }

  @Get('pre-sales/orders/:id')
  async getMyPreSalesOrderDetails(@Headers('authorization') authHeader: string, @Param('id', ParseIntPipe) id: number) {
    return this.preSalesSlice.getMyPreSalesOrderDetails(authHeader, id);
  }

  @Get('active-trip')
  async getActiveTrip(@Headers('authorization') authHeader: string) {
    return this.tripsSettleSlice.getActiveTrip(authHeader);
  }

  @Get('trips/:id/due-by-day')
  async getTripDueByDay(@Headers('authorization') authHeader: string, @Param('id', ParseIntPipe) id: number) {
    return this.tripsSettleSlice.getTripDueByDay(authHeader, id);
  }

  @Post('trips/open')
  async openTrip(@Headers('authorization') authHeader: string, @Body() body: OpenTripDto) {
    return this.tripsSettleSlice.openTrip(authHeader, body);
  }

  @Post('trips/settle')
  async settleTrip(@Headers('authorization') authHeader: string, @Body() body: SettleTripDriverDto) {
    return this.tripsSettleSlice.settleTrip(authHeader, body);
  }

  @Post('trips/submit-settlement')
  async submitTripSettlement(@Headers('authorization') authHeader: string, @Body() body: SubmitTripSettlementDto) {
    return this.tripsSettleSlice.submitTripSettlement(authHeader, body);
  }

  @Post('sales')
  async executeSale(@Headers('authorization') authHeader: string, @Body() body: ExecuteSaleDto) {
    return this.driverSales.executeSale(authHeader, body);
  }

  @Get('sales')
  async listDriverSales(
    @Headers('authorization') authHeader: string,
    @Query('dateScope') dateScope?: 'today' | 'yesterday' | 'week' | 'all',
    @Query('customerId') customerId?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('search') search?: string,
    @Query('tripId') tripId?: string,
    @Query('discountedOnly') discountedOnly?: string,
  ) {
    return this.driverSales.listDriverSales(
      authHeader,
      dateScope,
      customerId,
      paymentMethod,
      search,
      tripId,
      discountedOnly,
    );
  }

  @Post('collections')
  async recordCollection(@Headers('authorization') authHeader: string, @Body() body: RecordCollectionDto) {
    return this.driverSales.recordCollection(authHeader, body);
  }

  @Post('trips/:tripId/damaged-swap')
  async executeDamagedSwap(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
    @Body() body: ExecuteDamagedSwapDto,
  ) {
    return this.driverSales.executeDamagedSwap(authHeader, tripId, body);
  }

  @Get('trips/:tripId/damaged-swaps')
  async listTripDamagedSwaps(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
  ) {
    return this.driverSales.listTripDamagedSwaps(authHeader, tripId);
  }

  @Get('customers/:customerId/eligible-sales')
  async getCustomerEligibleSales(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.driverSales.getCustomerEligibleSales(authHeader, customerId);
  }

  @Post('field-returns')
  async submitFieldReturn(@Headers('authorization') authHeader: string, @Body() body: SubmitFieldReturnDto) {
    return this.driverSales.submitFieldReturn(authHeader, body);
  }

  @Post('requisitions')
  async submitLoadRequisition(@Headers('authorization') authHeader: string, @Body() body: SubmitLoadRequisitionDto) {
    return this.requisitions.submitLoadRequisition(authHeader, body);
  }

  @Get('requisitions')
  async listMyRequisitions(@Headers('authorization') authHeader: string) {
    return this.requisitions.listMyRequisitions(authHeader);
  }

  @Delete('requisitions/:id')
  async cancelMyRequisition(@Headers('authorization') authHeader: string, @Param('id', ParseIntPipe) id: number) {
    return this.requisitions.cancelMyRequisition(authHeader, id);
  }

  @Post('requisitions/:id/cancel')
  async cancelMyRequisitionPost(@Headers('authorization') authHeader: string, @Param('id', ParseIntPipe) id: number) {
    return this.requisitions.cancelMyRequisitionPost(authHeader, id);
  }

  @Get('warehouses')
  async getDriverWarehouses(@Headers('authorization') authHeader: string) {
    return this.requisitions.getDriverWarehouses(authHeader);
  }

  @Get('available-products')
  async getDriverAvailableProducts(
    @Headers('authorization') authHeader: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.requisitions.getDriverAvailableProducts(authHeader, warehouseId);
  }

  @Get('my-target')
  async getMyTarget(@Headers('authorization') authHeader: string, @Query('month') month?: string) {
    return this.requisitions.getMyTarget(authHeader, month);
  }

  @Get('itinerary')
  async getMyItinerary(@Headers('authorization') authHeader: string) {
    return this.requisitions.getMyItinerary(authHeader);
  }

  @Post('customers')
  async createDriverCustomer(@Headers('authorization') authHeader: string, @Body() body: CreateDriverCustomerDto) {
    return this.requisitions.createDriverCustomer(authHeader, body);
  }

  @Post('field-visits')
  async recordFieldVisit(@Headers('authorization') authHeader: string, @Body() body: RecordFieldVisitDto) {
    return this.requisitions.recordFieldVisit(authHeader, body);
  }

  @Post('fuel-logs')
  async recordFuelLog(@Headers('authorization') authHeader: string, @Body() body: RecordFuelLogDto) {
    return this.requisitions.recordFuelLog(authHeader, body);
  }

  @Get('fuel-logs')
  async listMyFuelLogs(@Headers('authorization') authHeader: string) {
    return this.requisitions.listMyFuelLogs(authHeader);
  }

  @Post('oil-changes')
  async recordOilChange(@Headers('authorization') authHeader: string, @Body() body: RecordOilChangeDto) {
    return this.requisitions.recordOilChange(authHeader, body);
  }

  @Get('maintenance-alerts')
  async getMyMaintenanceAlerts(@Headers('authorization') authHeader: string) {
    return this.requisitions.getMyMaintenanceAlerts(authHeader);
  }

  @Post('transfers')
  async createTransfer(@Headers('authorization') authHeader: string, @Body() body: CreateTransferDto) {
    return this.requisitions.createTransfer(authHeader, body);
  }

  @Get('transfers')
  async listMyTransfers(@Headers('authorization') authHeader: string) {
    return this.requisitions.listMyTransfers(authHeader);
  }

  @Post('transfers/:id/accept')
  async acceptTransfer(@Headers('authorization') authHeader: string, @Param('id', ParseIntPipe) id: number) {
    return this.requisitions.acceptTransfer(authHeader, id);
  }

  @Post('transfers/:id/reject')
  async rejectTransfer(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RejectWithReasonDto,
  ) {
    return this.requisitions.rejectTransfer(authHeader, id, body);
  }

  @Get('peer-reps')
  async getPeerReps(@Headers('authorization') authHeader: string) {
    return this.requisitions.getPeerReps(authHeader);
  }

  // =========================================================================
  // TRIP OPERATIONAL EXPENSES
  // =========================================================================

  @Post('trips/:tripId/expenses')
  async recordTripExpense(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
    @Body() body: RecordTripExpenseDto,
  ) {
    return this.driverField.recordTripExpense(authHeader, tripId, body);
  }

  @Get('trips/:tripId/expenses')
  async getTripExpenses(@Headers('authorization') authHeader: string, @Param('tripId', ParseIntPipe) tripId: number) {
    return this.driverField.getTripExpenses(authHeader, tripId);
  }

  @Post('trips/:tripId/packaging')
  async recordPackagingMovement(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
    @Body() body: RecordPackagingMovementDto,
  ) {
    return this.driverField.recordPackagingMovement(authHeader, tripId, body);
  }

  @Get('trips/:tripId/packaging')
  async getTripPackagingMovements(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
  ) {
    return this.driverField.getTripPackagingMovements(authHeader, tripId);
  }

  @Get('customers/:customerId/packaging')
  async getCustomerPackagingBalance(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.driverField.getCustomerPackagingBalance(authHeader, customerId);
  }

  @Get('customers/:customerId/suggested-order')
  async getCustomerSuggestedOrder(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.driverField.getCustomerSuggestedOrder(authHeader, customerId);
  }

  @Get('customers/:customerId/last-prices')
  async getCustomerLastSoldPrices(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.driverField.getCustomerLastSoldPrices(authHeader, customerId);
  }

  @Get('customers/:customerId/field-statement')
  async getCustomerFieldStatement(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.driverField.getCustomerFieldStatement(authHeader, customerId);
  }

  @Get('promotions')
  async listActivePromotions(@Headers('authorization') authHeader: string) {
    return this.driverField.listActivePromotions(authHeader);
  }

  @Post('promotions/evaluate-cart')
  async evaluateCartPromotions(@Headers('authorization') authHeader: string, @Body() body: EvaluateCartPromotionsDto) {
    return this.driverField.evaluateCartPromotions(authHeader, body);
  }

  @Post('routes/optimize')
  async optimizeDriverRoute(@Headers('authorization') authHeader: string, @Body() body: OptimizeDriverRouteDto) {
    return this.driverField.optimizeDriverRoute(authHeader, body);
  }

  @Post('visits/check-in')
  async checkInStoreVisit(@Headers('authorization') authHeader: string, @Body() body: CheckInStoreVisitDto) {
    return this.driverField.checkInStoreVisit(authHeader, body);
  }

  @Post('visits/:id/inventory')
  async recordVisitInventory(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RecordVisitInventoryDto,
  ) {
    return this.driverField.recordVisitInventory(authHeader, id, body);
  }

  @Post('visits/:id/no-sale')
  async recordVisitNoSale(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RecordVisitNoSaleDto,
  ) {
    return this.driverField.recordVisitNoSale(authHeader, id, body);
  }

  @Post('visits/:id/check-out')
  async checkOutStoreVisit(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CheckOutStoreVisitDto,
  ) {
    return this.driverField.checkOutStoreVisit(authHeader, id, body);
  }

  @Post('trade-surveys')
  async recordTradeSurvey(@Headers('authorization') authHeader: string, @Body() body: RecordTradeSurveyDto) {
    return this.driverField.recordTradeSurvey(authHeader, body);
  }

  @Post('breadcrumbs')
  async recordBreadcrumb(@Headers('authorization') authHeader: string, @Body() body: RecordBreadcrumbDto) {
    return this.driverField.recordBreadcrumb(authHeader, body);
  }
}
