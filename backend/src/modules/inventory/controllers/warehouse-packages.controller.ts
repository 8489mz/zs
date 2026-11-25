import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { WarehousePackagesService } from '../services/warehouse-packages.service';
import { CreateWarehousePackageDto, UnpackPackageDto, UpdatePackageStatusDto } from '../dto/warehouse-package.dto';

@Controller(['api/inventory/packages', 'api/v1/inventory/packages'])
@UseGuards(SessionAuthGuard)
export class WarehousePackagesController {
  constructor(private readonly packagesService: WarehousePackagesService) {}

  @Get()
  getPackages(@Query() query: { packageType?: string; status?: string; search?: string }, @Req() req: RequestWithAuth) {
    return this.packagesService.getPackages(req.authContext!, query);
  }

  @Get(':identifier')
  getPackageDetails(@Param('identifier') identifier: string, @Req() req: RequestWithAuth) {
    return this.packagesService.getPackageDetails(req.authContext!, identifier);
  }

  @Post()
  createPackage(@Body() dto: CreateWarehousePackageDto, @Req() req: RequestWithAuth) {
    return this.packagesService.createPackage(req.authContext!, dto);
  }

  @Post(':id/unpack')
  unpack(@Param('id') id: string, @Body() dto: UnpackPackageDto, @Req() req: RequestWithAuth) {
    return this.packagesService.unpack(req.authContext!, id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePackageStatusDto, @Req() req: RequestWithAuth) {
    return this.packagesService.updateStatus(req.authContext!, id, dto);
  }
}
