import { BadRequestException, Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { KitchenPrintersService } from '../services/kitchen-printers.service';
import { CreateKitchenPrinterDto, UpdateKitchenPrinterDto } from '../dto/kitchen-printer.dto';

@Controller('api/sales/kitchen-printers')
@UseGuards(SessionAuthGuard, PermissionsGuard)
// R4-E I18: printer administration is restaurant-only, like the KDS itself.
@RequireFeature('restaurant')
export class KitchenPrintersController {
  constructor(private readonly service: KitchenPrintersService) {}

  @Get()
  @RequirePermissions('sales')
  async listPrinters(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    const { tenantId } = requireTenantScope(req.authContext);
    return this.service.listPrinters(tenantId, branchId ? Number(branchId) : undefined);
  }

  @Post()
  @RequirePermissions('sales')
  async createPrinter(
    @Req() req: RequestWithAuth,
    @Body() dto: CreateKitchenPrinterDto,
  ) {
    const { tenantId } = requireTenantScope(req.authContext);
    return this.service.createPrinter(tenantId, dto);
  }

  // R4-E I12: send a posted sale's kitchen ticket to the matched network
  // printers. Returns per-printer results; an empty list means no network
  // printer serves this sale and the caller falls back to Electron print.
  @Post('print')
  @RequirePermissions('sales')
  async printTicket(
    @Req() req: RequestWithAuth,
    @Body() body: { saleId: number },
  ) {
    const { tenantId } = requireTenantScope(req.authContext);
    const saleId = Number(body?.saleId);
    if (!Number.isSafeInteger(saleId) || saleId <= 0) {
      throw new BadRequestException('رقم الفاتورة غير صالح');
    }
    const results = await this.service.printTicketForPostedSale(tenantId, saleId);
    return { results };
  }

  @Patch(':id')
  @RequirePermissions('sales')
  async updatePrinter(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKitchenPrinterDto,
  ) {
    const { tenantId } = requireTenantScope(req.authContext);
    return this.service.updatePrinter(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sales')
  async deletePrinter(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { tenantId } = requireTenantScope(req.authContext);
    return this.service.deletePrinter(tenantId, id);
  }
}
