import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ContractingService } from '../contracting.service';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import type { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import type {
  CreateEquipmentAssetDto,
  TransferEquipmentAssetDto,
  RecordSupplierPriceMemoryDto,
  CreateInspectionRequestDto,
  UpdateInspectionRequestStatusDto,
  CreateSnagItemDto,
  UpdateSnagItemStatusDto,
  CreateProjectHandoverDto,
  ApproveProjectHandoverDto,
} from '../dto/contracting.dto';

@Controller(['contracting', 'api/contracting', 'api/v1/contracting'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('contracting')
@AllowAuthenticated()
export class ContractingExecutionController {
  constructor(private readonly contractingService: ContractingService) {}

  // --------------------------------------------------------------------------
  // 26. Equipment & Tools Asset Tracking
  // --------------------------------------------------------------------------

  @Get('equipment')
  async getEquipmentAssets(
    @Query('projectId') projectId: string,
    @Query('operationalStatus') operationalStatus: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getEquipmentAssets(req.authContext!, { projectId, operationalStatus, search });
  }

  @Post('equipment')
  async createEquipmentAsset(@Body() dto: CreateEquipmentAssetDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createEquipmentAsset(req.authContext!, dto);
  }

  @Post('equipment/:id/transfer')
  async transferEquipmentAsset(
    @Param('id') id: string,
    @Body() dto: TransferEquipmentAssetDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.transferEquipmentAsset(req.authContext!, id, dto);
  }

  @Get('equipment-transfers')
  async getEquipmentTransfers(@Query('equipmentId') equipmentId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getEquipmentTransfers(req.authContext!, equipmentId);
  }

  // --------------------------------------------------------------------------
  // 27. Supplier Price Memory & Rating Directory
  // --------------------------------------------------------------------------

  @Get('supplier-price-memory')
  async getSupplierPriceMemory(
    @Query('supplierId') supplierId: string,
    @Query('materialName') materialName: string,
    @Query('governorate') governorate: string,
    @Query('paymentTerms') paymentTerms: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getSupplierPriceMemory(req.authContext!, {
      supplierId: supplierId ? Number(supplierId) : undefined,
      materialName,
      governorate,
      paymentTerms,
    });
  }

  @Post('supplier-price-memory')
  async recordSupplierPriceMemory(@Body() dto: RecordSupplierPriceMemoryDto, @Req() req: RequestWithAuth) {
    return this.contractingService.recordSupplierPriceMemory(req.authContext!, dto);
  }

  // --------------------------------------------------------------------------
  // 28. Item-Level Direct Profitability Ledger
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/item-profitability')
  async getItemProfitabilityLedger(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getItemProfitabilityLedger(req.authContext!, projectId);
  }

  // --------------------------------------------------------------------------
  // 29. Comprehensive Project Cost Breakdown (5-Stream Actual Costs vs Budget)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/cost-breakdown')
  async getProjectCostBreakdown(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getProjectCostBreakdown(req.authContext!, projectId);
  }

  // --------------------------------------------------------------------------
  // 30. Work Inspection Requests (WIR / طلبات استلام الأعمال الاستشارية)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/inspection-requests')
  async getInspectionRequests(
    @Param('projectId') projectId: string,
    @Query('status') status: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getInspectionRequests(req.authContext!, projectId, status);
  }

  @Post('projects/:projectId/inspection-requests')
  async createInspectionRequest(
    @Param('projectId') projectId: string,
    @Body() dto: CreateInspectionRequestDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createInspectionRequest(req.authContext!, projectId, dto);
  }

  @Put('inspection-requests/:id/status')
  async updateInspectionRequestStatus(
    @Param('id') id: string,
    @Body() dto: UpdateInspectionRequestStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateInspectionRequestStatus(req.authContext!, id, dto);
  }

  @Delete('inspection-requests/:id')
  async deleteInspectionRequest(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteInspectionRequest(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // 31. Punch List / Snag Items (قائمة العيوب والملاحظات الهندسية)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/snag-items')
  async getSnagItems(
    @Param('projectId') projectId: string,
    @Query('status') status: string,
    @Query('severity') severity: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getSnagItems(req.authContext!, projectId, status, severity);
  }

  @Post('projects/:projectId/snag-items')
  async createSnagItem(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSnagItemDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createSnagItem(req.authContext!, projectId, dto);
  }

  @Put('snag-items/:id/status')
  async updateSnagItemStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSnagItemStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateSnagItemStatus(req.authContext!, id, dto);
  }

  @Delete('snag-items/:id')
  async deleteSnagItem(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteSnagItem(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // 32. Project Handovers (الاستلام الابتدائي والنهائي للمشروع)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/handovers')
  async getProjectHandovers(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getProjectHandovers(req.authContext!, projectId);
  }

  @Post('projects/:projectId/handovers')
  async createProjectHandover(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectHandoverDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createProjectHandover(req.authContext!, projectId, dto);
  }

  @Post('handovers/:id/approve')
  async approveProjectHandover(
    @Param('id') id: string,
    @Body() dto: ApproveProjectHandoverDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.approveProjectHandover(req.authContext!, id, dto);
  }
}
