import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { ApprovalWorkflowService, CreateApprovalRuleDto, ApprovalRequestFilter } from './approval-workflow.service';
import { ApproveApprovalRequestDto, RejectApprovalRequestDto, UpdateApprovalRuleDto } from './dto/approval-write.dto';

@Controller('api/approvals')
@UseGuards(SessionAuthGuard)
export class ApprovalWorkflowController {
  constructor(private readonly approvalService: ApprovalWorkflowService) {}

  @Get('rules')
  getRules(@Req() req: RequestWithAuth) {
    return this.approvalService.getRules(req.authContext!);
  }

  @Post('rules')
  createRule(@Body() dto: CreateApprovalRuleDto, @Req() req: RequestWithAuth) {
    return this.approvalService.createRule(dto, req.authContext!);
  }

  @Put('rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateApprovalRuleDto, @Req() req: RequestWithAuth) {
    return this.approvalService.updateRule(id, dto, req.authContext!);
  }

  @Delete('rules/:id')
  deleteRule(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.approvalService.deleteRule(id, req.authContext!);
  }

  @Get('requests')
  getRequests(@Query() query: ApprovalRequestFilter, @Req() req: RequestWithAuth) {
    return this.approvalService.getRequests(query, req.authContext!);
  }

  @Get('requests/pending-count')
  getPendingCount(@Req() req: RequestWithAuth) {
    return this.approvalService.getPendingCount(req.authContext!);
  }

  @Get('requests/:id')
  getRequestDetails(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.approvalService.getRequestDetails(id, req.authContext!);
  }

  @Post('requests/:id/approve')
  approveRequest(@Param('id') id: string, @Body() body: ApproveApprovalRequestDto, @Req() req: RequestWithAuth) {
    return this.approvalService.approveRequest(id, body?.notes || '', req.authContext!);
  }

  @Post('requests/:id/reject')
  rejectRequest(@Param('id') id: string, @Body() body: RejectApprovalRequestDto, @Req() req: RequestWithAuth) {
    return this.approvalService.rejectRequest(id, body?.reason || '', req.authContext!);
  }
}
