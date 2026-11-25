import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ContractingService } from '../contracting.service';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import type { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import type {
  CreateSubcontractorDto,
  UpdateSubcontractorDto,
  CreateSubcontractorPaymentDto,
  CreateDailyLogDto,
  CreateRfiDto,
  AnswerRfiDto,
  CreateScheduleTaskDto,
  UpdateScheduleTaskDto,
  CreateMaterialRequisitionDto,
  CreateMasterPriceItemDto,
  UpdateMasterPriceItemDto,
} from '../dto/contracting.dto';

@Controller(['contracting', 'api/contracting'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('contracting')
@AllowAuthenticated()
export class ContractingFieldController {
  constructor(private readonly contractingService: ContractingService) {}

  // --------------------------------------------------------------------------
  // 5.1 Subcontractors Master Directory & Financial Ledger
  // --------------------------------------------------------------------------

  @Get('subcontractors')
  async getSubcontractors(
    @Query('search') search?: string,
    @Query('tradeSpecialty') tradeSpecialty?: string,
    @Query('status') status?: string,
    @Req() req?: RequestWithAuth,
  ) {
    return this.contractingService.getSubcontractors(req!.authContext!, { search, tradeSpecialty, status });
  }

  @Get('subcontractors/:id')
  async getSubcontractorById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getSubcontractorById(req.authContext!, Number(id));
  }

  @Post('subcontractors')
  async createSubcontractor(@Body() dto: CreateSubcontractorDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createSubcontractor(req.authContext!, dto);
  }

  @Put('subcontractors/:id')
  async updateSubcontractor(@Param('id') id: string, @Body() dto: UpdateSubcontractorDto, @Req() req: RequestWithAuth) {
    return this.contractingService.updateSubcontractor(req.authContext!, Number(id), dto);
  }

  @Delete('subcontractors/:id')
  async deleteSubcontractor(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteSubcontractor(req.authContext!, Number(id));
  }

  @Get('subcontractors/:id/ledger')
  async getSubcontractorLedger(
    @Param('id') id: string,
    @Query('projectId') projectId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Req() req?: RequestWithAuth,
  ) {
    return this.contractingService.getSubcontractorLedger(req!.authContext!, Number(id), {
      projectId,
      fromDate,
      toDate,
    });
  }

  @Post('subcontractors/payments')
  async createSubcontractorPayment(@Body() dto: CreateSubcontractorPaymentDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createSubcontractorPayment(req.authContext!, dto);
  }

  // --------------------------------------------------------------------------
  // 6. Site Daily Logs
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/daily-logs')
  async getDailyLogs(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getDailyLogs(req.authContext!, projectId);
  }

  @Post('projects/:projectId/daily-logs')
  async createDailyLog(
    @Param('projectId') projectId: string,
    @Body() dto: CreateDailyLogDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createDailyLog(req.authContext!, projectId, dto);
  }

  // --------------------------------------------------------------------------
  // 7. RFIs (Technical Office)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/rfis')
  async getRfiList(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getRfiList(req.authContext!, projectId);
  }

  @Post('projects/:projectId/rfis')
  async createRfi(@Param('projectId') projectId: string, @Body() dto: CreateRfiDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createRfi(req.authContext!, projectId, dto);
  }

  @Put('rfis/:id/answer')
  async answerRfi(@Param('id') id: string, @Body() dto: AnswerRfiDto, @Req() req: RequestWithAuth) {
    return this.contractingService.answerRfi(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 9. Schedule Tasks (Gantt & WBS)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/tasks')
  async getScheduleTasks(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getScheduleTasks(req.authContext!, projectId);
  }

  @Post('projects/:projectId/tasks')
  async createScheduleTask(
    @Param('projectId') projectId: string,
    @Body() dto: CreateScheduleTaskDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createScheduleTask(req.authContext!, projectId, dto);
  }

  @Put('tasks/:id')
  async updateScheduleTask(@Param('id') id: string, @Body() dto: UpdateScheduleTaskDto, @Req() req: RequestWithAuth) {
    return this.contractingService.updateScheduleTask(req.authContext!, id, dto);
  }

  @Delete('tasks/:id')
  async deleteScheduleTask(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteScheduleTask(req.authContext!, id);
  }

  @Get('projects/:projectId/resource-loading')
  async getResourceLoadingHistogram(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getResourceLoadingHistogram(req.authContext!, projectId);
  }

  // --------------------------------------------------------------------------
  // 10. Material Requisitions
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/material-requisitions')
  async getMaterialRequisitions(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getMaterialRequisitions(req.authContext!, projectId);
  }

  @Post('projects/:projectId/material-requisitions')
  async createMaterialRequisition(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMaterialRequisitionDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createMaterialRequisition(req.authContext!, projectId, dto);
  }

  @Delete('material-requisitions/:id')
  async deleteMaterialRequisition(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteMaterialRequisition(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // 11. Master Price List
  // --------------------------------------------------------------------------

  @Get('price-list')
  async getMasterPriceList(
    @Query('itemType') itemType: string,
    @Query('category') category: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getMasterPriceList(req.authContext!, { itemType, category, search });
  }

  @Post('price-list')
  async createMasterPriceItem(@Body() dto: CreateMasterPriceItemDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createMasterPriceItem(req.authContext!, dto);
  }

  @Put('price-list/:id')
  async updateMasterPriceItem(
    @Param('id') id: string,
    @Body() dto: UpdateMasterPriceItemDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateMasterPriceItem(req.authContext!, id, dto);
  }

  @Delete('price-list/:id')
  async deleteMasterPriceItem(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteMasterPriceItem(req.authContext!, id);
  }
}
