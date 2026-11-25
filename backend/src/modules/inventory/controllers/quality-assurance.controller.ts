import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { QualityAssuranceService } from '../services/quality-assurance.service';
import {
  CreateQCPointDto,
  CreateQCInspectionDto,
  CreateNCRDto,
  UpdateNCRStatusDto,
} from '../dto/quality-assurance.dto';

@Controller('api/inventory/quality')
@UseGuards(SessionAuthGuard)
export class QualityAssuranceController {
  constructor(private readonly qualityService: QualityAssuranceService) {}

  @Get('summary')
  getQualitySummary(@Req() req: RequestWithAuth) {
    return this.qualityService.getQualitySummary(req.authContext!);
  }

  @Get('points')
  getQCPoints(@Query() query: { triggerStage?: string; productId?: number }, @Req() req: RequestWithAuth) {
    return this.qualityService.getQCPoints(req.authContext!, query);
  }

  @Post('points')
  createQCPoint(@Body() dto: CreateQCPointDto, @Req() req: RequestWithAuth) {
    return this.qualityService.createQCPoint(req.authContext!, dto);
  }

  @Get('inspections')
  getInspections(@Query() query: { status?: string; docType?: string }, @Req() req: RequestWithAuth) {
    return this.qualityService.getInspections(req.authContext!, query);
  }

  @Post('inspections')
  recordInspection(@Body() dto: CreateQCInspectionDto, @Req() req: RequestWithAuth) {
    return this.qualityService.recordInspection(req.authContext!, dto);
  }

  @Get('ncrs')
  getNCRs(@Query() query: { status?: string; severity?: string }, @Req() req: RequestWithAuth) {
    return this.qualityService.getNCRs(req.authContext!, query);
  }

  @Post('ncrs')
  createNCR(@Body() dto: CreateNCRDto, @Req() req: RequestWithAuth) {
    return this.qualityService.createNCR(req.authContext!, dto);
  }

  @Patch('ncrs/:id/status')
  updateNCRStatus(@Param('id') id: string, @Body() dto: UpdateNCRStatusDto, @Req() req: RequestWithAuth) {
    return this.qualityService.updateNCRStatus(req.authContext!, id, dto);
  }
}
