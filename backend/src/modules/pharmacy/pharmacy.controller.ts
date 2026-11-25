import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PharmacyService } from './pharmacy.service';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequirePermissions, RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequireFeature } from '../../core/auth/decorators/feature.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { UpsertDrugDto } from './dto/upsert-drug.dto';
import { UpsertBatchDto } from './dto/upsert-batch.dto';
import { UpsertPrescriptionDto } from './dto/upsert-prescription.dto';
import { UpsertShortageDto } from './dto/upsert-shortage.dto';
import { UpsertClinicalServiceDto } from './dto/upsert-clinical-service.dto';

@Controller('api/pharmacy')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('pharmacy')
export class PharmacyController {
  constructor(private readonly pharmacyService: PharmacyService) {}

  // Master Catalog Endpoints
  @Get('master-catalog')
  @RequireAnyPermission('pharmacy', 'products', 'sales')
  getMasterCatalog(
    @Query('q') q?: string,
    @Query('drugClass') drugClass?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pharmacyService.getMasterCatalog({
      q,
      drugClass,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('master-catalog/seed-all')
  @RequirePermissions('pharmacy')
  seedAllMasterDrugs(@Req() req: RequestWithAuth) {
    return this.pharmacyService.seedAllMasterDrugs(req.authContext!);
  }

  @Post('master-catalog/import-selected')
  @RequirePermissions('pharmacy')
  importSelectedMasterDrugs(@Req() req: RequestWithAuth, @Body('drugIds') drugIds: string[]) {
    return this.pharmacyService.importSelectedMasterDrugs(req.authContext!, drugIds || []);
  }

  @Get('master-catalog/lookup')
  @RequireAnyPermission('pharmacy', 'products', 'sales')
  lookupBarcode(@Req() req: RequestWithAuth, @Query('barcode') barcode: string) {
    return this.pharmacyService.lookupBarcode(req.authContext!, barcode || '');
  }

  // Distributor Invoice Importer
  @Post('distributors/import-invoice')
  @RequireAnyPermission('pharmacy', 'purchases')
  importDistributorInvoice(@Req() req: RequestWithAuth, @Body() dto: any) {
    return this.pharmacyService.importDistributorInvoice(req.authContext!, dto);
  }

  // Dashboard Stats
  @Get('stats')
  @RequireAnyPermission('pharmacy', 'dashboard', 'reports')
  getStats(@Req() req: RequestWithAuth) {
    return this.pharmacyService.getDashboardStats(req.authContext!);
  }

  // Drugs & Substitutes
  @Get('drugs')
  @RequireAnyPermission('pharmacy', 'products', 'sales')
  listDrugs(
    @Req() req: RequestWithAuth,
    @Query('q') q?: string,
    @Query('activeIngredient') activeIngredient?: string,
    @Query('dosageForm') dosageForm?: string,
    @Query('controlledLevel') controlledLevel?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pharmacyService.listDrugs(req.authContext!, {
      q,
      activeIngredient,
      dosageForm,
      controlledLevel,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('drugs/substitutes')
  @RequireAnyPermission('pharmacy', 'products', 'sales')
  findSubstitutes(
    @Req() req: RequestWithAuth,
    @Query('activeIngredient') activeIngredient: string,
    @Query('strength') strength?: string,
  ) {
    return this.pharmacyService.findSubstitutes(req.authContext!, activeIngredient, strength);
  }

  @Post('drugs')
  @RequirePermissions('pharmacy')
  upsertDrug(@Req() req: RequestWithAuth, @Body() dto: UpsertDrugDto) {
    return this.pharmacyService.upsertDrug(req.authContext!, dto);
  }

  @Delete('drugs/:id')
  @RequirePermissions('canDelete')
  deleteDrug(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number) {
    return this.pharmacyService.deleteDrug(req.authContext!, id);
  }

  // Batches
  @Get('batches')
  @RequireAnyPermission('pharmacy', 'inventory', 'sales')
  listBatches(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pharmacyService.listBatches(req.authContext!, {
      status,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('batches')
  @RequireAnyPermission('pharmacy', 'canAdjustInventory')
  upsertBatch(@Req() req: RequestWithAuth, @Body() dto: UpsertBatchDto) {
    return this.pharmacyService.upsertBatch(req.authContext!, dto);
  }

  // Prescriptions
  @Get('prescriptions')
  @RequireAnyPermission('pharmacy', 'sales')
  listPrescriptions(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('insuranceProvider') insuranceProvider?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pharmacyService.listPrescriptions(req.authContext!, {
      status,
      insuranceProvider,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('prescriptions')
  @RequireAnyPermission('pharmacy', 'sales')
  upsertPrescription(@Req() req: RequestWithAuth, @Body() dto: UpsertPrescriptionDto) {
    return this.pharmacyService.upsertPrescription(req.authContext!, dto);
  }

  // Shortages Book
  @Get('shortages')
  @RequireAnyPermission('pharmacy', 'sales', 'purchases')
  listShortages(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pharmacyService.listShortages(req.authContext!, {
      status,
      priority,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('shortages')
  @RequireAnyPermission('pharmacy', 'sales')
  upsertShortage(@Req() req: RequestWithAuth, @Body() dto: UpsertShortageDto) {
    return this.pharmacyService.upsertShortage(req.authContext!, dto);
  }

  @Patch('shortages/:id/status')
  @RequireAnyPermission('pharmacy', 'purchases')
  updateShortageStatus(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.pharmacyService.updateShortageStatus(req.authContext!, id, status);
  }

  // Clinical Services
  @Get('clinical-services')
  @RequireAnyPermission('pharmacy', 'sales')
  listClinicalServices(@Req() req: RequestWithAuth, @Query('limit') limit?: string) {
    return this.pharmacyService.listClinicalServices(req.authContext!, limit ? parseInt(limit, 10) : undefined);
  }

  @Post('clinical-services')
  @RequireAnyPermission('pharmacy', 'sales')
  createClinicalService(@Req() req: RequestWithAuth, @Body() dto: UpsertClinicalServiceDto) {
    return this.pharmacyService.createClinicalService(req.authContext!, dto);
  }
}
