import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ContractingService } from '../contracting.service';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import type { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import type {
  CreateEngineeringConstantDto,
  AutoPriceBoqItemDto,
  CreateCostSnapshotDto,
  CreateRetentionRecordDto,
  ReleaseRetentionDto,
  CreatePaymentHoldDto,
  ReleasePaymentHoldDto,
  CreateSupplierReturnDto,
  CreateLaborAttendanceDto,
  CreatePettyCashDto,
  SettlePettyCashDto,
  CreateGovernmentLicenseDto,
} from '../dto/contracting.dto';

@Controller(['contracting', 'api/contracting'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('contracting')
@AllowAuthenticated()
export class ContractingFinanceController {
  constructor(private readonly contractingService: ContractingService) {}

  // --------------------------------------------------------------------------
  // 12. Engineering Constants & Auto-Pricing
  // --------------------------------------------------------------------------

  @Get('engineering-constants')
  async getEngineeringConstants(@Req() req: RequestWithAuth) {
    return this.contractingService.getEngineeringConstants(req.authContext!);
  }

  @Post('engineering-constants')
  async createEngineeringConstant(@Body() dto: CreateEngineeringConstantDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createEngineeringConstant(req.authContext!, dto);
  }

  @Post('auto-price-boq')
  async autoPriceBoqItem(@Body() dto: AutoPriceBoqItemDto, @Req() req: RequestWithAuth) {
    return this.contractingService.autoPriceBoqItem(req.authContext!, dto);
  }

  // --------------------------------------------------------------------------
  // 13. Cost Baseline Snapshots
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/snapshots')
  async getCostSnapshots(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getCostSnapshots(req.authContext!, projectId);
  }

  @Post('projects/:projectId/snapshots')
  async createCostSnapshot(
    @Param('projectId') projectId: string,
    @Body() dto: CreateCostSnapshotDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createCostSnapshot(req.authContext!, projectId, dto);
  }

  // --------------------------------------------------------------------------
  // 14. Retention & Guarantees
  // --------------------------------------------------------------------------

  @Get('retentions')
  async getRetentionRecords(
    @Query('projectId') projectId: string,
    @Query('status') status: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getRetentionRecords(req.authContext!, { projectId, status });
  }

  @Post('projects/:projectId/retentions')
  async createRetentionRecord(
    @Param('projectId') projectId: string,
    @Body() dto: CreateRetentionRecordDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createRetentionRecord(req.authContext!, projectId, dto);
  }

  @Post('retentions/:id/release')
  async releaseRetentionRecord(@Param('id') id: string, @Body() dto: ReleaseRetentionDto, @Req() req: RequestWithAuth) {
    return this.contractingService.releaseRetentionRecord(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 15. Payment Holds
  // --------------------------------------------------------------------------

  @Get('payment-holds')
  async getPaymentHolds(
    @Query('projectId') projectId: string,
    @Query('isReleased') isReleased: string,
    @Req() req: RequestWithAuth,
  ) {
    const isRel = isReleased !== undefined ? isReleased === 'true' : undefined;
    return this.contractingService.getPaymentHolds(req.authContext!, { projectId, isReleased: isRel });
  }

  @Post('projects/:projectId/payment-holds')
  async createPaymentHold(
    @Param('projectId') projectId: string,
    @Body() dto: CreatePaymentHoldDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createPaymentHold(req.authContext!, projectId, dto);
  }

  @Post('payment-holds/:id/release')
  async releasePaymentHold(@Param('id') id: string, @Body() dto: ReleasePaymentHoldDto, @Req() req: RequestWithAuth) {
    return this.contractingService.releasePaymentHold(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 16. Supplier Returns & Credit Notes
  // --------------------------------------------------------------------------

  @Get('supplier-returns')
  async getSupplierReturns(@Query('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getSupplierReturns(req.authContext!, { projectId });
  }

  @Post('projects/:projectId/supplier-returns')
  async createSupplierReturn(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSupplierReturnDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createSupplierReturn(req.authContext!, projectId, dto);
  }

  // --------------------------------------------------------------------------
  // 17. Labor Attendance & Split Hours
  // --------------------------------------------------------------------------

  @Get('labor-attendance')
  async getLaborAttendance(
    @Query('projectId') projectId: string,
    @Query('workDate') workDate: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getLaborAttendance(req.authContext!, { projectId, workDate });
  }

  @Post('projects/:projectId/labor-attendance')
  async createLaborAttendance(
    @Param('projectId') projectId: string,
    @Body() dto: CreateLaborAttendanceDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createLaborAttendance(req.authContext!, projectId, dto);
  }

  // --------------------------------------------------------------------------
  // 18. Petty Cash Custody
  // --------------------------------------------------------------------------

  @Get('petty-cash')
  async getPettyCashRecords(
    @Query('projectId') projectId: string,
    @Query('status') status: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getPettyCashRecords(req.authContext!, { projectId, status });
  }

  @Post('projects/:projectId/petty-cash')
  async createPettyCash(
    @Param('projectId') projectId: string,
    @Body() dto: CreatePettyCashDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createPettyCash(req.authContext!, projectId, dto);
  }

  @Post('petty-cash/:id/settle')
  async settlePettyCash(@Param('id') id: string, @Body() dto: SettlePettyCashDto, @Req() req: RequestWithAuth) {
    return this.contractingService.settlePettyCash(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 19. Government Licenses & Expiry Alerts
  // --------------------------------------------------------------------------

  @Get('government-licenses')
  async getGovernmentLicenses(
    @Query('projectId') projectId: string,
    @Query('status') status: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getGovernmentLicenses(req.authContext!, { projectId, status });
  }

  @Post('projects/:projectId/government-licenses')
  async createGovernmentLicense(
    @Param('projectId') projectId: string,
    @Body() dto: CreateGovernmentLicenseDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createGovernmentLicense(req.authContext!, projectId, dto);
  }
}
