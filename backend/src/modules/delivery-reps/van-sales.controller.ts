import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { VanSalesService } from './van-sales.service';
import { DeliveryRepsService } from './delivery-reps.service';
import { VanPreSalesService } from './services/van-pre-sales.service';
import { VanPromotionsService } from './services/van-promotions.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanFieldExecutionService } from './services/van-field-execution.service';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { AUDIT_EVENT_CODES } from '../../core/audit/audit.service';

@Controller('api/driver-portal/van-sales')
export class VanSalesController {
  constructor(
    private readonly vanSalesService: VanSalesService,
    private readonly deliveryRepsService: DeliveryRepsService,
    private readonly vanPreSalesService: VanPreSalesService,
    private readonly vanPromotionsService: VanPromotionsService,
    private readonly vanRoutesService: VanRoutesService,
    private readonly vanFieldExecutionService: VanFieldExecutionService,
  ) {}

  @Get('pre-sales/catalog')
  async listPreSalesCatalog(
    @Headers('authorization') authHeader: string,
    @Query('warehouseLocationId') warehouseLocationId?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanPreSalesService.listWarehouseCatalog(
      driver.tenantId,
      warehouseLocationId ? Number(warehouseLocationId) : undefined,
      { search, categoryId: categoryId ? Number(categoryId) : undefined },
    );
  }

  @Post('pre-sales/orders')
  async createPreSalesOrder(
    @Headers('authorization') authHeader: string,
    @Body() body: any,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanPreSalesService.createPreSalesOrder(driver.repId, driver.tenantId, driver.accountId, body);
  }

  @Get('pre-sales/my-orders')
  async listMyPreSalesOrders(
    @Headers('authorization') authHeader: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('search') search?: string,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanPreSalesService.listPreSalesOrders(driver.tenantId, {
      repId: driver.repId,
      status,
      dateFrom,
      dateTo,
      search,
    });
  }

  @Get('pre-sales/orders/:id')
  async getMyPreSalesOrderDetails(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanPreSalesService.getPreSalesOrderDetails(id, driver.tenantId, driver.repId);
  }

  @Get('active-trip')
  async getActiveTrip(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getActiveTrip(driver.repId, driver.tenantId, driver.accountId);
  }

  @Post('trips/open')
  async openTrip(
    @Headers('authorization') authHeader: string,
    @Body() body: { sourceWarehouseId?: number; items?: { productId: number; qty: number }[]; notes?: string; startOdometer?: number; vehicleId?: number },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    if (body?.items && Array.isArray(body.items) && body.items.length > 0) {
      await this.vanSalesService.recordSuspicionEvent({
        tenantId: driver.tenantId,
        accountId: driver.accountId,
        repId: driver.repId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
        severity: 'critical',
        titleAr: 'محاولة سحب بضاعة مباشرة من المستودع بدون إذن صرف معتمد',
        detailsAr: `حاول المندوب فتح رحلة وتحميل (${body.items.length}) أصناف مباشرة من المستودع بدون اعتماد أمين المستودع أو المشرف.`,
        metadata: {
          itemsCount: body.items.length,
          sourceWarehouseId: body.sourceWarehouseId,
        },
      });
      throw new AppError(
        'سحب البضاعة المباشر من المستودع غير مسموح للمندوب؛ يرجى رفع طلب تحميل (إذن صرف) لاعتماده من أمين المستودع أو المشرف',
        'DIRECT_WAREHOUSE_LOAD_FORBIDDEN',
        403,
      );
    }
    return this.vanSalesService.openTripAndLoad(driver.repId, driver.tenantId, driver.accountId, {
      ...body,
      items: [],
    });
  }

  @Post('trips/settle')
  async settleTrip(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      tripId: number;
      countedCash: number;
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      // INV-VAN-SELF-SETTLE-PIN-REQUIRED: a driver-supplied value here
      // is IGNORED — the rep never decides whether his own shortage is
      // charged or waived. The field stays in the type so older phone
      // builds keep sending it without a 400; the service treats the
      // shortage as pending until a supervisor decides.
      chargeStockVarianceToRep?: boolean;
      // Explicit supervisor-approved overnight retention, requested by
      // the rep and authorized by the supervisor PIN below. Merely not
      // unloading is NOT approval.
      nightStockApproved?: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
      supervisorPin?: string;
      supervisorOverridePin?: string;
    },
  ) {
    // INV-PORTAL-TENANT-STATUS-ENFORCED: finish-and-settle only. A
    // suspended tenant's driver may settle his already-open trip; the
    // settle service enforces open-trip + rep ownership. New trips and
    // sales stay blocked by the strict verifier elsewhere.
    const driver = await this.deliveryRepsService.verifyDriverTokenForSettlement(authHeader);
    const pinToVerify = String(body?.supervisorPin || body?.supervisorOverridePin || '').trim();

    // INV-VAN-SELF-SETTLE-PIN-REQUIRED: self-settlement from the
    // driver's phone ALWAYS requires a supervisor PIN — mandatory, not
    // opt-in by default. The old path let the PIN be skipped whenever
    // the tenant setting was absent (default false), so the service
    // received no authContext and its maker-checker check never ran.
    // A missing PIN fails closed here, and a verified PIN always
    // produces the supervisor authContext below, so maker-checker runs
    // on every driver settle. The rep's own PIN is refused inside
    // verifySupervisorPin (MAKER_CHECKER_SELF_APPROVAL).
    if (!pinToVerify) {
      await this.vanSalesService.recordSuspicionEvent({
        tenantId: driver.tenantId,
        accountId: driver.accountId,
        repId: driver.repId,
        tripId: body?.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
        severity: 'critical',
        titleAr: 'محاولة إغلاق وتصفية رحلة ذاتياً بدون رمز اعتماد المشرف (PIN)',
        detailsAr: `حاول المندوب اعتماد وتصفية الرحلة #${body?.tripId} نهائياً من تطبيق المندوب دون إدخال رمز اعتماد المشرف.`,
        metadata: {
          tripId: body?.tripId,
          countedCash: body?.countedCash,
        },
      });
      throw new AppError(
        'إغلاق وتصفية رحلة التوزيع نهائياً من تطبيق المندوب يتطلب رمز اعتماد المشرف (Supervisor PIN)؛ أو يمكنك مراجعة المشرف لاعتمادها من لوحة الإدارة',
        'SETTLEMENT_REQUIRES_SUPERVISOR_PIN',
        403,
      );
    }
    const pinVerification = await this.vanSalesService.verifySupervisorPin(
      driver.tenantId,
      pinToVerify,
      driver.repId,
    );

    const supervisorAuthContext = {
      userId: Number(pinVerification.supervisorId || 0),
      sessionId: 'supervisor-pin-settlement',
      username: String(pinVerification.supervisorName || 'supervisor'),
      role: (pinVerification.supervisorRole || 'supervisor') as any,
      permissions: ['deliveryReps', 'sales', 'inventory', 'accounting'] as any,
      tenantId: driver.tenantId,
      accountId: driver.accountId,
    };

    // Night stock is approved only when the rep explicitly asks to keep
    // the stock overnight AND the supervisor PIN authorizes it. Not
    // unloading, on its own, never approves overnight retention — the
    // engine fails closed (NIGHT_STOCK_UNAPPROVED) without both.
    const nightStockApproved = Boolean(body.nightStockApproved) && Boolean(pinVerification);

    return this.vanSalesService.settleTrip(
      driver.repId,
      driver.tenantId,
      driver.accountId,
      {
        tripId: body.tripId,
        countedCash: body.countedCash,
        unloadRemainingToWarehouse: body.unloadRemainingToWarehouse,
        countedStock: body.countedStock,
        chargeStockVarianceDecidedBySupervisor: false,
        nightStockApproved,
        nightStockNotes: nightStockApproved
          ? `تم الإبقاء على البضاعة في سيارة التوزيع لليوم التالي باعتماد المشرف (${pinVerification.supervisorName})`
          : undefined,
        endOdometer: body.endOdometer,
        activeVisitCustomerId: body.activeVisitCustomerId,
        notes: body.notes,
      },
      supervisorAuthContext,
    );
  }

  @Post('trips/submit-settlement')
  async submitTripSettlement(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      tripId: number;
      countedCash: number;
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      notes?: string;
    },
  ) {
    // INV-PORTAL-TENANT-STATUS-ENFORCED: finish-and-settle only (see
    // settleTrip above).
    const driver = await this.deliveryRepsService.verifyDriverTokenForSettlement(authHeader);
    return this.vanSalesService.submitTripSettlement(driver.repId, driver.tenantId, driver.accountId, body);
  }

  @Post('sales')
  async executeSale(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      tripId: number;
      customerId?: number;
      customerName?: string;
      customerPhone?: string;
      paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
      paidAmount?: number;
      items: {
        productId: number;
        qty: number;
        unitPrice?: number;
        unitName?: string;
        unitMultiplier?: number;
        isBonus?: boolean;
        bonusReason?: string;
        originalPrice?: number;
      }[];
      notes?: string;
      deliveryGpsLat?: number;
      deliveryGpsLng?: number;
      deliveryProofPhoto?: string;
      packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
      clientTxId?: string;
      cashDiscountAmount?: number;
      supervisorOverridePin?: string;
      supervisorOverrideReason?: string;
      transferReference?: string;
      transferReceiptUrl?: string;
      recipientName?: string;
      recipientPhone?: string;
      recipientRole?: string;
      recipientSignature?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.executeFieldSale(driver.repId, driver.tenantId, driver.accountId, body);
  }

  @Get('sales')
  async listDriverSales(
    @Headers('authorization') authHeader: string,
    @Query('dateScope') dateScope?: 'today' | 'yesterday' | 'week' | 'all',
    @Query('customerId') customerId?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('search') search?: string,
    @Query('tripId') tripId?: string,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const sales = await this.vanSalesService.listDriverSales(driver.tenantId, driver.repId, {
      dateScope: dateScope || 'all',
      customerId: customerId ? Number(customerId) : undefined,
      paymentMethod,
      search,
      tripId: tripId ? Number(tripId) : undefined,
    });
    return { ok: true, sales };
  }

  @Post('collections')
  async recordCollection(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      tripId: number;
      customerId: number;
      amount: number;
      paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
      transferReference?: string;
      transferReceiptUrl?: string;
      supervisorOverridePin?: string;
      notes?: string;
      gpsLat?: number;
      gpsLng?: number;
      clientTxId?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.recordFieldCollection(driver.repId, driver.tenantId, driver.accountId, body);
  }

  @Post('trips/:tripId/damaged-swap')
  async executeDamagedSwap(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
    @Body()
    body: {
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
      clientTxId?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.executeDamagedSwap(driver.repId, driver.tenantId, driver.accountId, {
      tripId,
      ...body,
    });
  }

  @Get('trips/:tripId/damaged-swaps')
  async listTripDamagedSwaps(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const swaps = await this.vanSalesService.listTripDamagedSwaps(driver.tenantId, tripId, driver.repId);
    return { ok: true, swaps };
  }

  @Get('customers/:customerId/eligible-sales')
  async getCustomerEligibleSales(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const sales = await this.vanSalesService.getCustomerEligibleSales(driver.tenantId, customerId, driver.repId);
    return { ok: true, sales };
  }

  @Post('field-returns')
  async submitFieldReturn(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      tripId: number;
      customerId: number;
      saleId?: number | null;
      returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
      refundMethod?: 'credit' | 'cash';
      items: { productId: number; qty: number; unitPrice: number; saleItemId?: number }[];
      notes?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.submitFieldReturn(driver.repId, driver.tenantId, driver.accountId, body);
  }

  @Post('requisitions')
  async submitLoadRequisition(
    @Headers('authorization') authHeader: string,
    @Body() body: {
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.submitLoadRequisition(driver.repId, driver.tenantId, driver.accountId, body);
  }

  @Get('requisitions')
  async listMyRequisitions(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const requisitions = await this.vanSalesService.listLoadRequisitions(driver.tenantId, { repId: driver.repId });
    return { ok: true, requisitions };
  }

  @Delete('requisitions/:id')
  async cancelMyRequisition(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.cancelLoadRequisitionByDriver(driver.tenantId, driver.repId, id);
  }

  @Post('requisitions/:id/cancel')
  async cancelMyRequisitionPost(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.cancelLoadRequisitionByDriver(driver.tenantId, driver.repId, id);
  }

  @Get('warehouses')
  async getDriverWarehouses(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const warehouses = await this.vanSalesService.getDriverWarehouses(driver.tenantId);
    return { ok: true, warehouses };
  }

  @Get('available-products')
  async getDriverAvailableProducts(
    @Headers('authorization') authHeader: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const parsedWhId = warehouseId && warehouseId !== 'all' ? Number(warehouseId) : undefined;
    const products = await this.vanSalesService.getDriverAvailableProducts(driver.tenantId, parsedWhId);
    return { ok: true, products };
  }

  @Get('my-target')
  async getMyTarget(
    @Headers('authorization') authHeader: string,
    @Query('month') month?: string,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getRepTarget(driver.tenantId, driver.repId, month);
  }

  @Get('itinerary')
  async getMyItinerary(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const itinerary = await this.vanSalesService.getDriverTodayItinerary(driver.tenantId, driver.repId);
    return { ok: true, itinerary };
  }

  @Post('customers')
  async createDriverCustomer(
    @Headers('authorization') authHeader: string,
    @Body() body: any,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.createDriverCustomer(driver.repId, driver.tenantId, driver.accountId, body);
  }

  @Post('field-visits')
  async recordFieldVisit(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      tripId: number;
      customerId: number;
      visitType: 'positive' | 'negative';
      saleId?: number;
      negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
      postponedToDate?: string;
      gpsLat?: number;
      gpsLng?: number;
      notes?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.recordFieldVisit(driver.tenantId, driver.accountId, driver.repId, body);
  }

  @Post('fuel-logs')
  async recordFuelLog(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      vehicleId: number;
      tripId?: number;
      odometer: number;
      liters: number;
      pricePerLiter: number;
      stationName?: string;
      notes?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.recordFuelLog(driver.tenantId, driver.accountId, driver.repId, body);
  }

  @Get('fuel-logs')
  async listMyFuelLogs(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const logs = await this.vanSalesService.listFuelLogs(driver.tenantId, { repId: driver.repId });
    return { ok: true, logs };
  }

  @Post('oil-changes')
  async recordOilChange(
    @Headers('authorization') authHeader: string,
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
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.recordOilChange(driver.tenantId, driver.accountId, driver.repId, body);
  }

  @Get('maintenance-alerts')
  async getMyMaintenanceAlerts(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getFleetMaintenanceAlerts(driver.tenantId);
  }

  @Post('transfers')
  async createTransfer(
    @Headers('authorization') authHeader: string,
    @Body()
    body: {
      toRepId: number;
      fromTripId?: number;
      toTripId?: number;
      items: { productId: number; qty: number }[];
      notes?: string;
    },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.createInterVanTransfer(driver.tenantId, driver.accountId, driver.repId, body);
  }

  @Get('transfers')
  async listMyTransfers(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const transfers = await this.vanSalesService.listInterVanTransfers(driver.tenantId, { repId: driver.repId });
    return { ok: true, transfers };
  }

  @Post('transfers/:id/accept')
  async acceptTransfer(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.acceptInterVanTransfer(driver.tenantId, driver.accountId, driver.repId, id);
  }

  @Post('transfers/:id/reject')
  async rejectTransfer(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.rejectInterVanTransfer(driver.tenantId, driver.repId, id, body?.reason);
  }

  @Get('peer-reps')
  async getPeerReps(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const reps = await this.vanSalesService.getPeerReps(driver.tenantId, driver.repId);
    return { ok: true, reps };
  }

  // =========================================================================
  // TRIP OPERATIONAL EXPENSES
  // =========================================================================

  @Post('trips/:tripId/expenses')
  async recordTripExpense(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
    @Body() body: { expenseType: string; amount: number; notes?: string; receiptPhotoUrl?: string; supervisorOverridePin?: string },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.recordTripExpense(driver.repId, driver.tenantId, driver.accountId, {
      ...body,
      tripId,
    });
  }

  @Get('trips/:tripId/expenses')
  async getTripExpenses(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getTripExpenses(tripId, driver.tenantId, driver.repId);
  }

  // =========================================================================
  // RETURNABLE PACKAGING & EMPTIES LEDGER
  // =========================================================================

  @Post('trips/:tripId/packaging')
  async recordPackagingMovement(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
    @Body() body: { customerId?: number; packageType: string; deliveredQty: number; returnedQty: number; notes?: string },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.recordPackagingMovement(driver.repId, driver.tenantId, driver.accountId, {
      ...body,
      tripId,
    });
  }

  @Get('trips/:tripId/packaging')
  async getTripPackagingMovements(
    @Headers('authorization') authHeader: string,
    @Param('tripId', ParseIntPipe) tripId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getTripPackagingMovements(tripId, driver.tenantId, driver.repId);
  }

  @Get('customers/:customerId/packaging')
  async getCustomerPackagingBalance(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getCustomerPackagingBalance(customerId, driver.tenantId, driver.repId);
  }

  @Get('customers/:customerId/suggested-order')
  async getCustomerSuggestedOrder(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getCustomerSuggestedOrder(driver.tenantId, driver.accountId, driver.repId, customerId);
  }

  @Get('customers/:customerId/last-prices')
  async getCustomerLastSoldPrices(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getCustomerLastSoldPrices(driver.tenantId, customerId, driver.repId);
  }

  @Get('customers/:customerId/field-statement')
  async getCustomerFieldStatement(
    @Headers('authorization') authHeader: string,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanSalesService.getCustomerFieldStatement(driver.tenantId, customerId, driver.repId);
  }

  @Get('promotions')
  async listActivePromotions(@Headers('authorization') authHeader: string) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const promotions = await this.vanPromotionsService.listPromotions(driver.tenantId, { isActive: true });
    return { ok: true, promotions };
  }

  @Post('promotions/evaluate-cart')
  async evaluateCartPromotions(
    @Headers('authorization') authHeader: string,
    @Body() body: { cartItems: any[]; invoiceSubtotal?: number; customerType?: string },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const result = await this.vanPromotionsService.evaluateCart(driver.tenantId, body);
    return { ok: true, ...result };
  }

  @Post('routes/optimize')
  async optimizeDriverRoute(
    @Headers('authorization') authHeader: string,
    @Body() body: { customerIds?: number[]; startLat?: number; startLng?: number; persistSequence?: boolean; route?: string },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    const result = await this.vanRoutesService.optimizeCustomerRoute(driver.tenantId, {
      ...body,
      repId: driver.repId,
    });
    return { ok: true, ...result };
  }

  // =========================================================================
  // FMCG STRUCTURED STORE VISITS & MERCHANDISING (DRIVER)
  // =========================================================================

  @Post('visits/check-in')
  async checkInStoreVisit(
    @Headers('authorization') authHeader: string,
    @Body() body: { tripId?: number; customerId: number; customerName?: string; latitude?: number; longitude?: number },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanFieldExecutionService.checkInVisit(driver.tenantId, Number(driver.accountId || 0), driver.repId, body);
  }

  @Post('visits/:id/inventory')
  async recordVisitInventory(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { items: any[] },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanFieldExecutionService.recordVisitInventory(driver.tenantId, id, body);
  }

  @Post('visits/:id/no-sale')
  async recordVisitNoSale(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { noSaleReason: string; noSaleNotes?: string },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanFieldExecutionService.recordVisitNoSale(driver.tenantId, id, body);
  }

  @Post('visits/:id/check-out')
  async checkOutStoreVisit(
    @Headers('authorization') authHeader: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { hasSale?: boolean; saleId?: number; saleAmount?: number; hasCollection?: boolean; collectionAmount?: number },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanFieldExecutionService.checkOutVisit(driver.tenantId, id, body);
  }

  @Post('trade-surveys')
  async recordTradeSurvey(
    @Headers('authorization') authHeader: string,
    @Body() body: any,
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanFieldExecutionService.recordTradeSurvey(driver.tenantId, Number(driver.accountId || 0), driver.repId, body);
  }

  @Post('breadcrumbs')
  async recordBreadcrumb(
    @Headers('authorization') authHeader: string,
    @Body() body: { tripId: number; latitude: number; longitude: number; speedKmh?: number; batteryLevel?: number },
  ) {
    const driver = await this.deliveryRepsService.verifyDriverToken(authHeader);
    return this.vanFieldExecutionService.recordLiveBreadcrumb(driver.tenantId, Number(driver.accountId || 0), driver.repId, body);
  }
}

@Controller('api/van-sales/admin')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class VanSalesAdminController {
  constructor(
    private readonly vanSalesService: VanSalesService,
    private readonly vanPreSalesService: VanPreSalesService,
    private readonly vanPromotionsService: VanPromotionsService,
    private readonly vanRoutesService: VanRoutesService,
    private readonly vanFieldExecutionService: VanFieldExecutionService,
  ) {}

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
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.listPreSalesOrders(tenantId, {
      repId: repId ? Number(repId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      status,
      dateFrom,
      dateTo,
      search,
    });
  }

  @Get('pre-sales-orders/:id')
  @RequireAnyPermission('deliveryReps', 'sales')
  async getPreSalesOrderDetails(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.getPreSalesOrderDetails(id, tenantId);
  }

  @Post('pre-sales-orders/:id/approve')
  @RequireAnyPermission('deliveryReps', 'sales')
  async approvePreSalesOrder(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.approvePreSalesOrder(id, Number(req.authContext!.userId), tenantId, accountId);
  }

  @Post('pre-sales-orders/:id/reject')
  @RequireAnyPermission('deliveryReps', 'sales')
  async rejectPreSalesOrder(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.rejectPreSalesOrder(id, Number(req.authContext!.userId), tenantId, accountId, reason);
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanPreSalesService.consolidatePreSalesOrdersToRequisition(
      tenantId,
      accountId,
      Number(req.authContext!.userId),
      body,
    );
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
    requireTenantScope(req.authContext!);
    return this.vanPreSalesService.convertPreSalesOrderToInvoice(id, req.authContext!, body);
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
    const { tenantId } = requireTenantScope(req.authContext!);
    const trips = await this.vanSalesService.listTripsForAdmin(tenantId, {
      repId: repId ? Number(repId) : undefined,
      status,
      dateFrom,
      dateTo,
    });
    return { ok: true, trips };
  }

  @Get('trips/:id')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getTripDetails(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const details = await this.vanSalesService.getTripDetailsForAdmin(tenantId, id, { page: Number(page), pageSize: Number(pageSize) });
    return { ok: true, ...details };
  }

  @Post('trips/:id/settle')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory', 'accounting')
  async settleTripAdmin(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      repId: number;
      countedCash: number;
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      nightStockApproved?: boolean;
      nightStockNotes?: string;
      endOdometer?: number;
      chargeStockVarianceToRep?: boolean;
      notes?: string;
    },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.settleTrip(
      body.repId,
      tenantId,
      accountId,
      {
        tripId: id,
        countedCash: body.countedCash,
        unloadRemainingToWarehouse: body.unloadRemainingToWarehouse,
        countedStock: body.countedStock,
        nightStockApproved: body.nightStockApproved,
        nightStockNotes: body.nightStockNotes,
        endOdometer: body.endOdometer,
        // INV-VAN-SELF-SETTLE-PIN-REQUIRED: this endpoint runs under a
        // supervisor/admin session, so the flag IS the supervisor's
        // charge/waive decision at settle time and is honored as-is.
        chargeStockVarianceToRep: body.chargeStockVarianceToRep,
        chargeStockVarianceDecidedBySupervisor: true,
        notes: body.notes,
      },
      req.authContext,
    );
  }

  @Get('vehicles')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listVehicles(@Req() req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.listFleetVehicles(tenantId);
    return { ok: true, vehicles };
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.createFleetVehicle(tenantId, accountId, body);
    return { ok: true, vehicles };
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.updateFleetVehicle(tenantId, accountId, id, body);
    return { ok: true, vehicles };
  }

  @Post('vehicles/:id/assign')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async assignRep(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { repId: number | null; shiftName?: string },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const vehicles = await this.vanSalesService.assignVehicleRep(tenantId, id, body.repId, body.shiftName);
    return { ok: true, vehicles };
  }

  // Returns Management Endpoints
  @Get('returns')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listReturns(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('repId') repId?: string,
    @Query('tripId') tripId?: string,
    @Query('customerId') customerId?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const returns = await this.vanSalesService.listFieldReturns(tenantId, {
      status,
      repId: repId ? Number(repId) : undefined,
      tripId: tripId ? Number(tripId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
    });
    return { ok: true, returns };
  }

  @Post('returns/:id/approve')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async approveReturn(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.approveFieldReturn(tenantId, accountId, id, userId);
    return res;
  }

  @Post('returns/:id/reject')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async rejectReturn(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.rejectFieldReturn(tenantId, id, body.reason || '', userId);
    return res;
  }

  @Get('available-products')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getAdminAvailableProducts(
    @Req() req: RequestWithAuth,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const parsedWhId = warehouseId && warehouseId !== 'all' ? Number(warehouseId) : undefined;
    const products = await this.vanSalesService.getDriverAvailableProducts(tenantId, parsedWhId);
    return { ok: true, products };
  }

  // Requisitions Management Endpoints
  @Get('requisitions')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listAdminRequisitions(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('repId') repId?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const requisitions = await this.vanSalesService.listLoadRequisitions(tenantId, {
      status,
      repId: repId ? Number(repId) : undefined,
    });
    return { ok: true, requisitions };
  }

  @Get('warehouses')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listAdminWarehouses(@Req() req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const warehouses = await this.vanSalesService.getDriverWarehouses(tenantId);
    return { ok: true, warehouses };
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.createLoadRequisitionByAdmin(tenantId, accountId, userId, body);
    return res;
  }

  @Put('requisitions/:id/review')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async reviewRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { approvedItems: { productId: number; qty: number }[]; notes?: string; sourceWarehouseId?: number },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.reviewLoadRequisition(tenantId, id, body.approvedItems, body.notes, body.sourceWarehouseId);
    return res;
  }

  @Post('requisitions/:id/dispatch')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async dispatchRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.approveAndDispatchRequisition(tenantId, accountId, id, userId);
    return res;
  }

  @Post('requisitions/:id/reject')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async rejectRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const userId = req.authContext!.userId;
    const res = await this.vanSalesService.rejectLoadRequisition(tenantId, id, body.reason || '', userId);
    return res;
  }

  @Delete('requisitions/:id')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async deleteRequisition(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.deleteLoadRequisition(tenantId, id);
    return res;
  }

  // Targets Management Endpoints
  @Get('targets')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listRepTargets(
    @Req() req: RequestWithAuth,
    @Query('month') month?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const [targets, commissionConfig] = await Promise.all([
      this.vanSalesService.listAllRepTargets(tenantId, month),
      this.vanSalesService.getCommissionConfig(tenantId),
    ]);
    return { ok: true, targets, commissionConfig };
  }

  @Post('targets')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.setRepTarget(
      tenantId,
      accountId,
      Number(body.repId),
      body.month,
      Number(body.targetAmount),
      body.collectionTarget !== undefined && body.collectionTarget !== null ? Number(body.collectionTarget) : undefined,
      body.visitsTarget !== undefined && body.visitsTarget !== null ? Number(body.visitsTarget) : undefined,
      {
        salesCommissionRatePercent: body.salesCommissionRatePercent,
        collectionCommissionRatePercent: body.collectionCommissionRatePercent,
        targetBonusRatePercent: body.targetBonusRatePercent,
      },
    );
    return res;
  }

  @Get('targets/commission-config')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getCommissionConfig(@Req() req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const config = await this.vanSalesService.getCommissionConfig(tenantId);
    return { ok: true, config };
  }

  @Post('targets/commission-config')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const config = await this.vanSalesService.saveCommissionConfig(tenantId, accountId, body);
    return { ok: true, config };
  }

  @Post('targets/settle-commission')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.settleRepCommission(tenantId, accountId, req.authContext!, body);
  }

  // Route KPIs & Field Visits Endpoints
  @Get('kpis')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getRouteKpis(
    @Req() req: RequestWithAuth,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const kpis = await this.vanSalesService.getSupervisorRouteKpis(tenantId, dateFrom, dateTo);
    return { ok: true, ...kpis };
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
    const { tenantId } = requireTenantScope(req.authContext!);
    const visits = await this.vanSalesService.listFieldVisits(tenantId, {
      repId: repId ? Number(repId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      visitType,
      dateFrom,
      dateTo,
    });
    return { ok: true, visits };
  }

  @Post('customers/:id/route-schedule')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
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
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.setCustomerRouteSchedule(tenantId, id, body);
    return res;
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
    const { tenantId } = requireTenantScope(req.authContext!);
    const customers = await this.vanSalesService.getSupervisorCustomerRoutes(tenantId, {
      search,
      repId,
      route,
      unassignedOnly: unassignedOnly === 'true',
    });
    return { ok: true, customers };
  }

  @Post('supervisor/customer-routes/bulk-assign')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
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
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.bulkAssignCustomerRoutes(tenantId, body);
    return res;
  }


  // Fleet Fuel Logs Endpoints
  @Get('fuel-logs')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listFuelLogs(
    @Req() req: RequestWithAuth,
    @Query('vehicleId') vehicleId?: string,
    @Query('repId') repId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const logs = await this.vanSalesService.listFuelLogs(tenantId, {
      vehicleId: vehicleId ? Number(vehicleId) : undefined,
      repId: repId ? Number(repId) : undefined,
      dateFrom,
      dateTo,
    });
    return { ok: true, logs };
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.recordFuelLog(tenantId, accountId, body.repId || null, body);
    return res;
  }

  // Fleet Oil Changes Endpoints
  @Get('oil-changes')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listOilChanges(
    @Req() req: RequestWithAuth,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const changes = await this.vanSalesService.listOilChanges(tenantId, vehicleId ? Number(vehicleId) : undefined);
    return { ok: true, changes };
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.recordOilChange(tenantId, accountId, body.repId || null, body);
    return res;
  }

  @Get('maintenance-alerts')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getMaintenanceAlerts(@Req() req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getFleetMaintenanceAlerts(tenantId);
  }

  // Multi-Driver Vehicle Shifts Endpoints
  @Get('vehicles/:id/drivers')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listVehicleDrivers(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const drivers = await this.vanSalesService.listVehicleDrivers(tenantId, id);
    return { ok: true, drivers };
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
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.assignVehicleDriver(tenantId, accountId, { vehicleId: id, ...body });
    return res;
  }

  @Delete('vehicles/:id/drivers/:driverId')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async removeVehicleDriver(
    @Req() req: RequestWithAuth,
    @Param('driverId', ParseIntPipe) driverId: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanSalesService.removeVehicleDriver(tenantId, driverId);
    return res;
  }

  // Inter-Van Transfers Audit Endpoints
  @Get('transfers')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listAdminTransfers(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('status') status?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const transfers = await this.vanSalesService.listInterVanTransfers(tenantId, {
      repId: repId ? Number(repId) : undefined,
      status,
    });
    return { ok: true, transfers };
  }

  // Trip Operational Expenses Audit
  @Get('trips/:id/expenses')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async getAdminTripExpenses(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getTripExpenses(id, tenantId);
  }

  // Returnable Packaging & Empties Ledger Audit
  @Get('trips/:id/packaging')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getAdminTripPackaging(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getTripPackagingMovements(id, tenantId);
  }

  @Get('customers/:customerId/packaging')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getAdminCustomerPackaging(
    @Req() req: RequestWithAuth,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getCustomerPackagingBalance(customerId, tenantId);
  }

  // Van Sales Anti-Theft & Suspicion Radar (رادار الشبهات ومكافحة التلاعب لمناديب التوزيع)
  @Get('fraud-radar/summary')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory', 'accounting')
  async getFraudRadarSummary(
    @Req() req: RequestWithAuth,
    @Query('days') days?: string,
    @Query('repId') repId?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const summary = await this.vanSalesService.getFraudRadarSummary(tenantId, {
      days: days ? Number(days) : undefined,
      repId: repId ? Number(repId) : undefined,
    });
    return { ok: true, ...summary };
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
    const { tenantId } = requireTenantScope(req.authContext!);
    const events = await this.vanSalesService.getFraudRadarEvents(tenantId, {
      days: days ? Number(days) : undefined,
      repId: repId ? Number(repId) : undefined,
      eventCode: eventCode || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { ok: true, events };
  }

  // =========================================================================
  // FMCG MIX & MATCH PROMOTIONS ADMIN
  // =========================================================================

  @Get('promotions')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listAdminPromotions(
    @Req() req: RequestWithAuth,
    @Query('isActive') isActive?: string,
    @Query('promoType') promoType?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promotions = await this.vanPromotionsService.listPromotions(tenantId, {
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      promoType,
    });
    return { ok: true, promotions };
  }

  @Post('promotions')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async createPromotion(
    @Req() req: RequestWithAuth,
    @Body() body: any,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promo = await this.vanPromotionsService.createPromotion(tenantId, body);
    return { ok: true, promotion: promo };
  }

  @Put('promotions/:id')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async updatePromotion(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promo = await this.vanPromotionsService.updatePromotion(tenantId, id, body);
    return { ok: true, promotion: promo };
  }

  @Delete('promotions/:id')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async deletePromotion(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const res = await this.vanPromotionsService.deletePromotion(tenantId, id);
    return res;
  }

  @Patch('promotions/:id/toggle-active')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async togglePromotionActive(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isActive: boolean },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    const promo = await this.vanPromotionsService.toggleActive(tenantId, id, Boolean(body.isActive));
    return { ok: true, promotion: promo };
  }

  // =========================================================================
  // DYNAMIC ROUTE OPTIMIZATION (TSP)
  // =========================================================================

  @Post('routes/optimize')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
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
    const { tenantId } = requireTenantScope(req.authContext!);
    const result = await this.vanRoutesService.optimizeCustomerRoute(tenantId, body);
    return { ok: true, ...result };
  }

  // =========================================================================
  // FMCG VISITS, STRIKE RATE, TRADE SURVEYS & LIVE GPS BREADCRUMBS (SUPERVISOR)
  // =========================================================================

  @Get('visits')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listVisitsHistory(
    @Req() req: RequestWithAuth,
    @Query('tripId') tripId?: string,
    @Query('repId') repId?: string,
    @Query('customerId') customerId?: string,
    @Query('date') date?: string,
    @Query('noSaleOnly') noSaleOnly?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanFieldExecutionService.getVisitsHistory(tenantId, {
      tripId: tripId ? Number(tripId) : undefined,
      repId: repId ? Number(repId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      date,
      noSaleOnly: noSaleOnly === 'true',
    });
  }

  @Get('trade-surveys')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async listTradeSurveys(
    @Req() req: RequestWithAuth,
    @Query('tripId') tripId?: string,
    @Query('customerId') customerId?: string,
    @Query('surveyType') surveyType?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanFieldExecutionService.getTradeSurveys(tenantId, {
      tripId: tripId ? Number(tripId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      surveyType,
    });
  }

  @Get('trips/:tripId/breadcrumbs')
  @RequireAnyPermission('deliveryReps', 'sales', 'inventory')
  async getLiveTripBreadcrumbs(
    @Req() req: RequestWithAuth,
    @Param('tripId', ParseIntPipe) tripId: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanFieldExecutionService.getLiveTripBreadcrumbs(tenantId, tripId);
  }

  @Get('financial-ledger')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async getRepFinancialLedger(
    @Req() req: RequestWithAuth,
    @Query('repId') repId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.getRepFinancialLedger(tenantId, {
      repId: repId ? Number(repId) : undefined,
      status,
      dateFrom,
      dateTo,
    });
  }

  @Post('financial-ledger/:id/settle')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async settleRepFinancialItem(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { method: 'cash' | 'waiver'; notes?: string },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.settleRepFinancialItem(tenantId, accountId, id, body, req.authContext!);
  }

  @Post('financial-ledger/push-to-payroll')
  @RequireAnyPermission('hrPayrollManage', 'accounting')
  async pushRepShortagesToPayroll(
    @Req() req: RequestWithAuth,
    @Body() body: { settlementIds: number[]; targetMonth?: string },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.pushRepShortagesToPayroll(tenantId, accountId, body, req.authContext!);
  }

  @Post('financial-ledger/bonus')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async addRepBonusOrCommission(
    @Req() req: RequestWithAuth,
    @Body() body: { repId: number; entryType: 'bonus' | 'commission'; amount: number; notes: string },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.addRepBonusOrCommission(tenantId, accountId, body, req.authContext!);
  }

  @Post('financial-ledger/link-employee')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async linkRepToEmployee(
    @Req() req: RequestWithAuth,
    @Body() body: { repId: number; employeeId: number | null },
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.linkRepToEmployee(tenantId, body.repId, body.employeeId);
  }

  @Get('financial-ledger/candidate-employees')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async listCandidateEmployees(
    @Req() req: RequestWithAuth,
  ) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.listCandidateEmployees(tenantId);
  }

  @Post('financial-ledger/auto-create-employee')
  @RequireAnyPermission('deliveryReps', 'sales', 'accounting')
  async autoCreateEmployee(
    @Req() req: RequestWithAuth,
    @Body() body: { repId: number },
  ) {
    const { tenantId, accountId } = requireTenantScope(req.authContext!);
    return this.vanSalesService.autoCreateEmployeeForRep(tenantId, accountId, body.repId, req.authContext!);
  }
}

