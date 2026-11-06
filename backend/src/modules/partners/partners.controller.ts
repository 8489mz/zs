import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AllowAuthenticated, RequirePermissions, RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PartnersService } from './partners.service';
import { resolveLoyaltyAdjustActionType } from './helpers/loyalty-adjust-action.helper';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';
import { UpsertSupplierDto } from './dto/upsert-supplier.dto';
import { UpsertContactDto } from './dto/upsert-contact.dto';
import { UpsertAddressDto } from './dto/upsert-address.dto';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get('customers')
  @RequirePermissions('customers')
  listCustomers(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.listCustomers(query, req.authContext!);
  }

  @Post('customers')
  @RequireAnyPermission('customers', 'deliveryReps', 'delivery_reps', 'sales', 'pos')
  createCustomer(@Body() payload: UpsertCustomerDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.createCustomer(payload, req.authContext!);
  }

  @Get('customers/delivery-lookup')
  @AllowAuthenticated()
  lookupCustomerDeliveryProfile(
    @Query('phone') phone: string,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.lookupCustomerDeliveryProfile(phone, req.authContext!);
  }

  @Get('customers/marketing/inactive')
  @RequirePermissions('customers')
  getInactiveCustomersMarketing(
    @Query('days') days: string,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    const daysInactive = days ? Math.max(1, Number(days)) : 30;
    return this.partnersService.getInactiveCustomersMarketing(daysInactive, req.authContext!);
  }

  @Get('customers/:id/loyalty/history')
  @RequirePermissions('customers')
  getCustomerLoyaltyHistory(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.getCustomerLoyaltyHistory(id, req.authContext!);
  }

  @Post('customers/:id/loyalty/adjust')
  @RequirePermissions('customers')
  adjustCustomerLoyaltyPoints(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: { pointsChange: number; actionType?: 'earn' | 'redeem' | 'manual_adjust'; notes?: string },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    // The manual-adjust endpoint records a manual adjustment. An explicit
    // earn / redeem is honoured; an unspecified action is 'manual_adjust',
    // never silently a purchase earn or a discount redemption.
    const action = resolveLoyaltyAdjustActionType(payload.actionType);
    return this.partnersService.adjustCustomerLoyaltyPoints(id, Number(payload.pointsChange), action, payload.notes, req.authContext!);
  }

  @Get('customers/:id/pos-summary')
  @RequirePermissions('customers')
  getCustomerPosSummary(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.getCustomerPosSummary(id, req.authContext!);
  }

  @Get('customers/:id/addresses')
  @AllowAuthenticated()
  getCustomerAddresses(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<string[]> {
    return this.partnersService.getCustomerAddresses(id, req.authContext!);
  }

  @Post('customers/:id/addresses')
  @AllowAuthenticated()
  addCustomerAddress(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: { address: string },
    @Req() req: RequestWithAuth,
  ): Promise<{ ok: boolean; addresses: string[] }> {
    return this.partnersService.addCustomerAddress(id, payload.address, req.authContext!);
  }

  @Delete('customers/:id/addresses')
  @AllowAuthenticated()
  deleteCustomerAddress(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: { address: string },
    @Req() req: RequestWithAuth,
  ): Promise<{ ok: boolean; addresses: string[] }> {
    return this.partnersService.deleteCustomerAddress(id, payload.address, req.authContext!);
  }

  @Get('customers/:id/delivery-profile')
  @AllowAuthenticated()
  getCustomerDeliveryProfile(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.getCustomerDeliveryProfile(id, req.authContext!);
  }

  @Put('customers/:id')
  @RequirePermissions('customers')
  updateCustomer(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertCustomerDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.updateCustomer(id, payload, req.authContext!);
  }

  @Delete('customers/:id')
  @RequirePermissions('canDelete')
  deleteCustomer(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.deleteCustomer(id, req.authContext!);
  }

  @Get('suppliers')
  @RequireAnyPermission('suppliers', 'purchases')
  listSuppliers(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.listSuppliers(query, req.authContext!);
  }

  @Post('suppliers')
  @RequirePermissions('suppliers')
  createSupplier(@Body() payload: UpsertSupplierDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.createSupplier(payload, req.authContext!);
  }

  @Put('suppliers/:id')
  @RequirePermissions('suppliers')
  updateSupplier(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertSupplierDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.updateSupplier(id, payload, req.authContext!);
  }

  @Delete('suppliers/:id')
  @RequirePermissions('canDelete')
  deleteSupplier(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.partnersService.deleteSupplier(id, req.authContext!);
  }

  @Get([':partnerType/:partnerId/contacts', 'partners/:partnerType/:partnerId/contacts'])
  @RequireAnyPermission('customers', 'suppliers', 'sales', 'purchases')
  listContacts(
    @Param('partnerType') partnerType: string,
    @Param('partnerId', ParseIntPipe) partnerId: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.listContacts(partnerType, partnerId, req.authContext!);
  }

  @Post([':partnerType/:partnerId/contacts', 'partners/:partnerType/:partnerId/contacts'])
  @RequireAnyPermission('customers', 'suppliers')
  createContact(
    @Param('partnerType') partnerType: string,
    @Param('partnerId', ParseIntPipe) partnerId: number,
    @Body() payload: UpsertContactDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.createContact(partnerType, partnerId, payload, req.authContext!);
  }

  @Get([':partnerType/:partnerId/addresses', 'partners/:partnerType/:partnerId/addresses'])
  @RequireAnyPermission('customers', 'suppliers', 'sales', 'purchases')
  listAddresses(
    @Param('partnerType') partnerType: string,
    @Param('partnerId', ParseIntPipe) partnerId: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.listAddresses(partnerType, partnerId, req.authContext!);
  }

  @Post([':partnerType/:partnerId/addresses', 'partners/:partnerType/:partnerId/addresses'])
  @RequireAnyPermission('customers', 'suppliers')
  createAddress(
    @Param('partnerType') partnerType: string,
    @Param('partnerId', ParseIntPipe) partnerId: number,
    @Body() payload: UpsertAddressDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.partnersService.createAddress(partnerType, partnerId, payload, req.authContext!);
  }
}

