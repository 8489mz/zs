import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ContractingService } from '../contracting.service';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import type { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import type {
  CreateCostPoolDto,
  CreateIndirectExpenseDto,
  CreateAllocationBatchDto,
  CreateContractingDocumentDto,
  CreateContractingDocumentRevisionDto,
  UpdateContractingDocumentRevisionStatusDto,
  DistributeContractingDocumentDto,
  CreateMeetingMinuteDto,
  CreateMeetingActionItemDto,
} from '../dto/contracting.dto';

@Controller(['contracting', 'api/contracting'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('contracting')
@AllowAuthenticated()
export class ContractingAdminController {
  constructor(private readonly contractingService: ContractingService) {}

  // --------------------------------------------------------------------------
  // 40. Field Indirect Costs & Cost Pools (أوعية التكاليف والمصاريف غير المباشرة)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/cost-pools')
  async getCostPools(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getCostPools(req.authContext!, projectId);
  }

  @Post('projects/:projectId/cost-pools')
  async createCostPool(
    @Param('projectId') projectId: string,
    @Body() dto: CreateCostPoolDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createCostPool(req.authContext!, projectId, dto);
  }

  @Get('projects/:projectId/indirect-expenses')
  async getIndirectExpenses(
    @Param('projectId') projectId: string,
    @Query('poolId') poolId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getIndirectExpenses(req.authContext!, projectId, poolId);
  }

  @Post('projects/:projectId/indirect-expenses')
  async createIndirectExpense(
    @Param('projectId') projectId: string,
    @Body() dto: CreateIndirectExpenseDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createIndirectExpense(req.authContext!, projectId, dto);
  }

  @Get('projects/:projectId/allocation-batches')
  async getAllocationBatches(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getAllocationBatches(req.authContext!, projectId);
  }

  @Post('projects/:projectId/allocation-batches/preview')
  async previewBatchAllocation(
    @Param('projectId') projectId: string,
    @Body() dto: CreateAllocationBatchDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.previewBatchAllocation(req.authContext!, projectId, dto);
  }

  @Post('projects/:projectId/allocation-batches')
  async postBatchAllocation(
    @Param('projectId') projectId: string,
    @Body() dto: CreateAllocationBatchDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.postBatchAllocation(req.authContext!, projectId, dto);
  }

  // --------------------------------------------------------------------------
  // 41. Document Register (سجل المخططات والمستندات ومراجعاتها وتوزيعها)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/documents')
  async listDocuments(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.listDocuments(req.authContext!, projectId);
  }

  @Get('documents/:id')
  async getDocumentDetail(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getDocumentDetail(req.authContext!, id);
  }

  @Post('projects/:projectId/documents')
  async createDocument(
    @Param('projectId') projectId: string,
    @Body() dto: CreateContractingDocumentDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createDocument(req.authContext!, projectId, dto);
  }

  @Post('documents/:id/revisions')
  async addDocumentRevision(
    @Param('id') id: string,
    @Body() dto: CreateContractingDocumentRevisionDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.addDocumentRevision(req.authContext!, id, dto);
  }

  @Put('document-revisions/:id/status')
  async updateDocumentRevisionStatus(
    @Param('id') id: string,
    @Body() dto: UpdateContractingDocumentRevisionStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateDocumentRevisionStatus(req.authContext!, id, dto);
  }

  @Post('document-revisions/:id/distribute')
  async distributeDocument(
    @Param('id') id: string,
    @Body() dto: DistributeContractingDocumentDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.distributeDocument(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 42. Meeting Minutes & Action Items (محاضر الاجتماعات وبنود المتابعة)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/meeting-minutes')
  async listMeetingMinutes(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.listMeetingMinutes(req.authContext!, projectId);
  }

  @Get('meeting-minutes/:id')
  async getMeetingMinuteDetail(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getMeetingMinuteDetail(req.authContext!, id);
  }

  @Post('projects/:projectId/meeting-minutes')
  async createMeetingMinute(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMeetingMinuteDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createMeetingMinute(req.authContext!, projectId, dto);
  }

  @Post('meeting-minutes/:id/action-items')
  async addMeetingActionItem(
    @Param('id') id: string,
    @Body() dto: CreateMeetingActionItemDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.addMeetingActionItem(req.authContext!, id, dto);
  }

  @Put('meeting-action-items/:id/status')
  async updateMeetingActionItemStatus(
    @Param('id') id: string,
    @Body('status') status: 'open' | 'closed',
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateMeetingActionItemStatus(req.authContext!, id, status);
  }
}
