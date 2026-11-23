import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ContractingService } from '../contracting.service';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import type { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import type {
  CreateProjectDto,
  UpdateProjectDto,
  MarkTenderLostDto,
  AwardTenderDto,
  CreateBoqItemDto,
  UpdateBoqItemDto,
  CreateChangeOrderDto,
  UpdateChangeOrderStatusDto,
  CreateIpcInvoiceDto,
  CreateSubcontractDto,
} from '../dto/contracting.dto';

@Controller(['contracting', 'api/contracting'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('contracting')
@AllowAuthenticated()
export class ContractingCoreController {
  constructor(private readonly contractingService: ContractingService) {}

  // --------------------------------------------------------------------------
  // 1. Projects
  // --------------------------------------------------------------------------

  @Get('projects')
  async getProjects(
    @Query('status') status: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getProjects(req.authContext!, { status, search });
  }

  @Get('projects/:id')
  async getProjectById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getProjectById(req.authContext!, id);
  }

  @Post('projects')
  async createProject(@Body() dto: CreateProjectDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createProject(req.authContext!, dto);
  }

  @Put('projects/:id')
  async updateProject(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateProject(req.authContext!, id, dto);
  }

  @Delete('projects/:id')
  async deleteProject(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteProject(req.authContext!, id);
  }

  @Post('projects/:id/revisions')
  async createTenderRevision(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.createTenderRevision(req.authContext!, id);
  }

  @Post('projects/:id/mark-lost')
  async markTenderLost(
    @Param('id') id: string,
    @Body() dto: MarkTenderLostDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.markTenderLost(req.authContext!, id, dto);
  }

  @Post('projects/:id/award')
  async awardTender(
    @Param('id') id: string,
    @Body() dto: AwardTenderDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.awardTender(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 2. BOQ (Bill of Quantities / Schedule of Values)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/boq')
  async getBoqItems(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getBoqItems(req.authContext!, projectId);
  }

  @Post('projects/:projectId/boq')
  async createBoqItem(
    @Param('projectId') projectId: string,
    @Body() dto: CreateBoqItemDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createBoqItem(req.authContext!, projectId, dto);
  }

  @Post('projects/:projectId/boq/batch')
  async batchCreateBoqItems(
    @Param('projectId') projectId: string,
    @Body() body: { items: CreateBoqItemDto[] },
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.batchCreateBoqItems(req.authContext!, projectId, body.items || []);
  }

  @Put('boq/:id')
  async updateBoqItem(
    @Param('id') id: string,
    @Body() dto: UpdateBoqItemDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateBoqItem(req.authContext!, id, dto);
  }

  @Delete('boq/:id')
  async deleteBoqItem(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.deleteBoqItem(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // 3. Change Orders (أوامر التغيير والملحقات)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/change-orders')
  async getChangeOrders(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getChangeOrders(req.authContext!, projectId);
  }

  @Post('projects/:projectId/change-orders')
  async createChangeOrder(
    @Param('projectId') projectId: string,
    @Body() dto: CreateChangeOrderDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createChangeOrder(req.authContext!, projectId, dto);
  }

  @Put('change-orders/:id/status')
  async updateChangeOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateChangeOrderStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateChangeOrderStatus(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 4. Invoices / IPCs (المستخلصات التراكمية)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/invoices')
  async getInvoices(
    @Param('projectId') projectId: string,
    @Query('type') type: 'client' | 'subcontractor',
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getInvoices(req.authContext!, projectId, type);
  }

  @Get('invoices/:id')
  async getInvoiceById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getInvoiceById(req.authContext!, id);
  }

  @Post('projects/:projectId/invoices')
  async createInvoice(
    @Param('projectId') projectId: string,
    @Body() dto: CreateIpcInvoiceDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createInvoice(req.authContext!, projectId, dto);
  }

  @Post('invoices/:id/approve')
  async approveInvoice(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.approveInvoice(req.authContext!, id);
  }

  @Post('invoices/:id/post-journal')
  async postInvoiceJournal(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.postInvoiceJournalEntry(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // 5. Subcontracts (Commitments)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/subcontracts')
  async getSubcontracts(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getSubcontracts(req.authContext!, projectId);
  }

  @Post('projects/:projectId/subcontracts')
  async createSubcontract(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSubcontractDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createSubcontract(req.authContext!, projectId, dto);
  }

}
