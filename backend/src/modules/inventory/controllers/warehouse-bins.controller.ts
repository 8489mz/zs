import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AllowAuthenticated, RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import {
  WarehouseBinsService,
  CreateBinDto,
  UpdateBinDto,
  QuickReassignDto,
  QuickAuditUpdateDto,
} from '../services/warehouse-bins.service';

@Controller(['api/inventory/bins', 'api/v1/inventory/bins'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class WarehouseBinsController {
  constructor(private readonly binsService: WarehouseBinsService) {}

  @Get()
  @AllowAuthenticated()
  listBins(@Query('locationId') locationId: string, @Query('search') search: string, @Req() req: RequestWithAuth) {
    return this.binsService.listBins(
      {
        locationId: locationId ? Number(locationId) : undefined,
        search,
      },
      req.authContext!,
    );
  }

  @Post()
  @RequirePermissions('inventory')
  createBin(@Body() dto: CreateBinDto, @Req() req: RequestWithAuth) {
    return this.binsService.createBin(dto, req.authContext!);
  }

  @Get('scan-audit')
  @AllowAuthenticated()
  scanAuditBin(@Query('barcode') barcode: string, @Req() req: RequestWithAuth) {
    return this.binsService.scanAuditBin(barcode, req.authContext!);
  }

  @Post('reassign')
  @RequirePermissions('inventory')
  quickReassignProduct(@Body() dto: QuickReassignDto, @Req() req: RequestWithAuth) {
    return this.binsService.quickReassignProduct(dto, req.authContext!);
  }

  @Post('quick-audit')
  @RequirePermissions('inventory')
  quickAuditUpdate(@Body() dto: QuickAuditUpdateDto, @Req() req: RequestWithAuth) {
    return this.binsService.quickAuditUpdate(dto, req.authContext!);
  }

  @Patch(':id')
  @RequirePermissions('inventory')
  updateBin(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBinDto, @Req() req: RequestWithAuth) {
    return this.binsService.updateBin(id, dto, req.authContext!);
  }

  @Delete(':id')
  @RequirePermissions('inventory')
  deleteBin(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.binsService.deleteBin(id, req.authContext!);
  }
}
