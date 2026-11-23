import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ContractingService } from '../contracting.service';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import type { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import type {
  CreateMasterBoqLibraryItemDto,
  UpdateMasterBoqLibraryItemDto,
  BatchImportMasterBoqDto,
  ToggleMasterBoqItemStatusDto,
  ImportMasterBoqToProjectDto,
  SaveBoqTakeoffsDto,
  CreateSiteMobilizationExpenseDto,
  RecordLaborAttendanceRecordDto,
  CreateClientPaymentMilestoneDto,
  RecordInKindBarterDeductionDto,
} from '../dto/contracting.dto';

@Controller(['contracting', 'api/contracting'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('contracting')
@AllowAuthenticated()
export class ContractingPlanningController {
  constructor(private readonly contractingService: ContractingService) {}

  // --------------------------------------------------------------------------
  // 20. Executive Intelligence: Health Score, Cash Forecast, MRP, P&L
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/health-score')
  async getProjectHealthScore(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getProjectHealthScore(req.authContext!, projectId);
  }

  @Get('cash-forecast')
  async getCashForecast(@Query('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getCashForecast(req.authContext!, { projectId });
  }

  @Get('projects/:projectId/material-requirements')
  async getProjectMaterialRequirements(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getProjectMaterialRequirements(req.authContext!, projectId);
  }

  @Get('projects/:projectId/profitability')
  async getBoqProfitabilityAnalysis(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getBoqProfitabilityAnalysis(req.authContext!, projectId);
  }

  // --------------------------------------------------------------------------
  // 21. Multi-Trade Master BOQ Library & Project Import
  // --------------------------------------------------------------------------

  @Get('master-boq/trades')
  async getMasterBoqTrades(@Req() req: RequestWithAuth) {
    return this.contractingService.getMasterBoqTrades(req.authContext!);
  }

  @Get('master-boq/items')
  async getMasterBoqLibrary(
    @Query('tradeCategory') tradeCategory: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getMasterBoqLibrary(req.authContext!, { tradeCategory, search });
  }

  @Post('master-boq/items')
  async createMasterBoqItem(@Body() dto: CreateMasterBoqLibraryItemDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createMasterBoqItem(req.authContext!, dto);
  }

  @Post('master-boq/items/bulk')
  async bulkImportMasterBoqItems(@Body() dto: BatchImportMasterBoqDto, @Req() req: RequestWithAuth) {
    return this.contractingService.bulkImportMasterBoqItems(req.authContext!, dto);
  }

  @Put('master-boq/items/:id')
  async updateMasterBoqItem(
    @Param('id') id: string,
    @Body() dto: UpdateMasterBoqLibraryItemDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateMasterBoqItem(req.authContext!, id, dto);
  }

  @Put('master-boq/items/:id/toggle-status')
  async toggleMasterBoqItemStatus(
    @Param('id') id: string,
    @Body() dto: ToggleMasterBoqItemStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.toggleMasterBoqItemStatus(req.authContext!, id, dto.isActive);
  }

  @Delete('master-boq/items/:id')
  async deleteMasterBoqItem(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteMasterBoqItem(req.authContext!, id);
  }

  @Post('projects/:projectId/boq/import-master')
  async importMasterBoqItemsToProject(
    @Param('projectId') projectId: string,
    @Body() dto: ImportMasterBoqToProjectDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.importMasterBoqItemsToProject(req.authContext!, projectId, dto);
  }

  // --------------------------------------------------------------------------
  // 22. BOQ CAD Quantity Takeoff Sheet
  // --------------------------------------------------------------------------

  @Get('boq/:boqItemId/takeoffs')
  async getTakeoffsByBoqItem(@Param('boqItemId') boqItemId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getTakeoffsByBoqItem(req.authContext!, boqItemId);
  }

  @Post('boq/:boqItemId/takeoffs')
  async saveTakeoffs(
    @Param('boqItemId') boqItemId: string,
    @Body() dto: SaveBoqTakeoffsDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.saveTakeoffs(req.authContext!, boqItemId, dto);
  }

  // --------------------------------------------------------------------------
  // 23. Site Mobilization & Setup Expenses
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/mobilization')
  async getMobilizationExpenses(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getMobilizationExpenses(req.authContext!, projectId);
  }

  @Post('projects/:projectId/mobilization')
  async createMobilizationExpense(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSiteMobilizationExpenseDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createMobilizationExpense(req.authContext!, projectId, dto);
  }

  @Delete('mobilization/:id')
  async deleteMobilizationExpense(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteMobilizationExpense(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // 24. Labor Attendance & Overtime Records (Linked to BOQ Item)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/labor-records')
  async getLaborAttendanceRecords(
    @Param('projectId') projectId: string,
    @Query('date') date: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getLaborAttendanceRecords(req.authContext!, projectId, date);
  }

  @Post('projects/:projectId/labor-records')
  async recordLaborAttendance(
    @Param('projectId') projectId: string,
    @Body() dto: RecordLaborAttendanceRecordDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.recordLaborAttendance(req.authContext!, projectId, dto);
  }

  @Delete('labor-records/:id')
  async deleteLaborAttendanceRecord(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteLaborAttendanceRecord(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // 25. Client Payment Milestones & In-Kind Barter Settlements
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/milestones')
  async getClientPaymentMilestones(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getClientPaymentMilestones(req.authContext!, projectId);
  }

  @Post('projects/:projectId/milestones')
  async createClientPaymentMilestone(
    @Param('projectId') projectId: string,
    @Body() dto: CreateClientPaymentMilestoneDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createClientPaymentMilestone(req.authContext!, projectId, dto);
  }

  @Post('milestones/:id/barter-settlement')
  async recordInKindBarterDeduction(
    @Param('id') id: string,
    @Body() dto: RecordInKindBarterDeductionDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.recordInKindBarterDeduction(req.authContext!, id, dto);
  }

  @Delete('milestones/:id')
  async deleteClientPaymentMilestone(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteClientPaymentMilestone(req.authContext!, id);
  }

}
