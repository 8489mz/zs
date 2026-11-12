import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { DeliveryRepsService } from './delivery-reps.service';

@Controller('api/driver-portal')
export class DriverPortalController {
  constructor(private readonly service: DeliveryRepsService) {}

  @Post('login')
  login(@Body() body: { phone: string; pinCode: string; companyCode?: string; tenantId?: string }) {
    return this.service.driverLogin(body);
  }

  // INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: the only driver-portal call a
  // rep still on the default PIN must be able to reach; it verifies the
  // current PIN and returns a fresh, unflagged token.
  @Post('change-pin')
  async changePin(
    @Headers('authorization') authHeader: string,
    @Body() body: { currentPin?: string; newPin?: string },
  ) {
    const driver = await this.service.verifyDriverToken(authHeader);
    return this.service.driverChangePin(driver, body);
  }

  @Get('profile')
  async getProfile(@Headers('authorization') authHeader: string) {
    const driver = await this.service.verifyDriverToken(authHeader);
    await this.service.assertDriverPinChanged(driver);
    return { ok: true, driver };
  }

  @Get('orders')
  async getOrders(
    @Headers('authorization') authHeader: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const driver = await this.service.verifyDriverToken(authHeader);
    await this.service.assertDriverPinChanged(driver);
    return this.service.driverListOrders(driver.repId, driver.tenantId, driver.accountId, { status, dateFrom, dateTo, page: Number(page), pageSize: Number(pageSize) });
  }

  @Post('orders/:saleId/settle')
  async settleOrder(
    @Param('saleId', ParseIntPipe) saleId: number,
    @Headers('authorization') authHeader: string,
    @Body() body: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string },
  ) {
    const driver = await this.service.verifyDriverToken(authHeader);
    await this.service.assertDriverPinChanged(driver);
    return this.service.driverSettleOrder(saleId, driver.repId, driver.tenantId, body);
  }
}
