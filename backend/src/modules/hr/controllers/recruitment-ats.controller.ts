import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { RecruitmentAtsService } from '../services/recruitment-ats.service';
import {
  CreateJobOpeningDto,
  CreateApplicantDto,
  UpdateApplicantStageDto,
  HireApplicantDto,
} from '../dto/recruitment-ats.dto';

@Controller(['api/hr/recruitment', 'api/v1/hr/recruitment'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('hr')
@RequirePermissions('hrEmployees')
export class RecruitmentAtsController {
  constructor(private readonly recruitmentService: RecruitmentAtsService) {}

  @Get('metrics')
  getFunnelMetrics(@Req() req: RequestWithAuth) {
    return this.recruitmentService.getFunnelMetrics(req.authContext!);
  }

  @Get('jobs')
  getJobOpenings(@Query() query: { status?: string; search?: string }, @Req() req: RequestWithAuth) {
    return this.recruitmentService.getJobOpenings(req.authContext!, query);
  }

  @Post('jobs')
  createJobOpening(@Body() dto: CreateJobOpeningDto, @Req() req: RequestWithAuth) {
    return this.recruitmentService.createJobOpening(req.authContext!, dto);
  }

  @Get('applicants')
  getApplicants(
    @Query() query: { stage?: string; jobId?: string; talentPoolTag?: string; search?: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.recruitmentService.getApplicants(req.authContext!, query);
  }

  @Post('applicants')
  createApplicant(@Body() dto: CreateApplicantDto, @Req() req: RequestWithAuth) {
    return this.recruitmentService.createApplicant(req.authContext!, dto);
  }

  @Patch('applicants/:id/stage')
  updateApplicantStage(@Param('id') id: string, @Body() dto: UpdateApplicantStageDto, @Req() req: RequestWithAuth) {
    return this.recruitmentService.updateApplicantStage(req.authContext!, id, dto);
  }

  @Post('applicants/:id/hire')
  @RequirePermissions('hrEmployees', 'hrSalaryManage')
  hireApplicant(@Param('id') id: string, @Body() dto: HireApplicantDto, @Req() req: RequestWithAuth) {
    return this.recruitmentService.hireApplicant(req.authContext!, id, dto);
  }
}
