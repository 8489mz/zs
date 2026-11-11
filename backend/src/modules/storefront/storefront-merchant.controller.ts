import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { StorefrontService } from './storefront.service';
import { StorefrontReservationSchedulerService } from './services/storefront-reservation-scheduler.service';
import { DEFAULT_COD_STALE_TIMEOUT_MS, DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS } from './engines/storefront-reservation.engine';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { UpdateStorefrontSettingsDto } from './dto/update-storefront-settings.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';
import { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './dto/delivery-zone.dto';

// O59: every route used to need only a session, so any user of the tenant (a cashier included) could
// rewrite storefront settings, coupons and delivery prices — and read the payment gateways' secret keys.
// Day-to-day order handling (list, status, load into POS, convert, confirm transfer) stays open to
// 'sales' because cashiers do it from the POS; store configuration needs 'storefront' or 'settings'.
const CONFIG_PERMISSIONS = ['storefront', 'settings'] as const;

@Controller('api/storefront/admin')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireAnyPermission('storefront', 'sales')
export class StorefrontMerchantController {
  constructor(
    private readonly service: StorefrontService,
    private readonly reaperScheduler: StorefrontReservationSchedulerService,
  ) {}

  @Get('orders')
  listOrders(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth) {
    return this.service.listOrders(query, req.authContext!);
  }

  @Get('orders/counts')
  getOrderCounts(@Req() req: RequestWithAuth) {
    return this.service.getOrderCounts(req.authContext!);
  }

  // D-SF-12: the reaper's last sweep, so a dead scheduler is visible in the
  // admin UI instead of silent — null until the first sweep runs.
  @Get('orders/reap-status')
  getReapStatus() {
    return {
      lastSweep: this.reaperScheduler.getLastResults(),
      onlineTimeoutMs: DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS,
      codTimeoutMs: DEFAULT_COD_STALE_TIMEOUT_MS,
    };
  }

  @Post('orders/bulk-cancel')
  bulkCancelOrders(
    @Body('adminPassword') adminPassword: string,
    @Body('status') status: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.bulkCancelOrders(adminPassword, status || 'pending', req.authContext!);
  }

  @Post('orders/reap-expired')
  reapExpiredReservations(@Req() req: RequestWithAuth) {
    return this.service.reapExpiredReservations({ tenantId: req.authContext!.tenantId });
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.service.getOrder(id, req.authContext!);
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
    @Body('saleId') saleId: number | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.updateOrderStatus(id, status, req.authContext!, saleId ? Number(saleId) : undefined);
  }

  @Post('orders/:id/confirm-payment')
  confirmManualPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body('reference') reference: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.confirmManualPayment(id, reference, req.authContext!);
  }

  @Post('orders/:id/convert-to-sale')
  convertToSale(
    @Param('id', ParseIntPipe) id: number,
    @Body('deliveryRepId') deliveryRepId: number | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.convertToSale(id, req.authContext!, deliveryRepId);
  }

  @Post('orders/:id/prepare-pos')
  prepareOrderForPos(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.service.prepareOrderForPos(id, req.authContext!);
  }

  @Get('settings')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  getSettings(@Req() req: RequestWithAuth) {
    return this.service.getStorefrontSettings(req.authContext!);
  }

  @Post('settings')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  updateSettings(@Body() payload: UpdateStorefrontSettingsDto, @Req() req: RequestWithAuth) {
    return this.service.updateStorefrontSettings(payload, req.authContext!);
  }

  @Patch('products/:id/image')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  updateProductImage(
    @Param('id', ParseIntPipe) id: number,
    @Body('imageUrl') imageUrl: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.updateProductImage(id, imageUrl || '', req.authContext!);
  }

  @Patch('categories/:id/image')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  updateCategoryImage(
    @Param('id', ParseIntPipe) id: number,
    @Body('imageUrl') imageUrl: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.updateCategoryImage(id, imageUrl || '', req.authContext!);
  }

  @Get('coupons')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  listCoupons(@Req() req: RequestWithAuth) {
    return this.service.listCoupons(req.authContext!);
  }

  @Post('coupons')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  createCoupon(@Body() body: CreateCouponDto, @Req() req: RequestWithAuth) {
    return this.service.createCoupon(body, req.authContext!);
  }

  @Put('coupons/:id')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  updateCoupon(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCouponDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.updateCoupon(id, body, req.authContext!);
  }

  @Delete('coupons/:id')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  deleteCoupon(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.service.deleteCoupon(id, req.authContext!);
  }

  @Get('delivery-zones')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  listDeliveryZones(@Req() req: RequestWithAuth) {
    return this.service.listDeliveryZones(req.authContext!);
  }

  @Post('delivery-zones')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  createDeliveryZone(@Body() body: CreateDeliveryZoneDto, @Req() req: RequestWithAuth) {
    return this.service.createDeliveryZone(body, req.authContext!);
  }

  @Put('delivery-zones/:id')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  updateDeliveryZone(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateDeliveryZoneDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.service.updateDeliveryZone(id, body, req.authContext!);
  }

  @Delete('delivery-zones/:id')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  deleteDeliveryZone(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.service.deleteDeliveryZone(id, req.authContext!);
  }

  @Get('abandoned-carts')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  listAbandonedCarts(@Req() req: RequestWithAuth) {
    return this.service.listAbandonedCarts(req.authContext!);
  }

  @Delete('abandoned-carts/:id')
  @RequireAnyPermission(...CONFIG_PERMISSIONS)
  deleteAbandonedCart(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.service.deleteAbandonedCart(id, req.authContext!);
  }

  @Get('analytics')
  @RequireAnyPermission('storefront', 'sales', 'settings')
  getAnalytics(@Req() req: RequestWithAuth) {
    return this.service.getStorefrontAnalytics(req.authContext!);
  }
}
