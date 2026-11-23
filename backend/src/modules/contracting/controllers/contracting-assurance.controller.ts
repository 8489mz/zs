import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ContractingService } from '../contracting.service';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import type { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import type {
  CreateSubmittalDto,
  UpdateSubmittalStatusDto,
  CreateMaterialEscalationDto,
  UpdateMaterialEscalationStatusDto,
  CreateSubcontractorBackchargeDto,
  UpdateBackchargeStatusDto,
  CreateEquipmentFuelLogDto,
  CreateGuaranteeDto,
  UpdateGuaranteeDto,
  ExtendGuaranteeDto,
  ReleaseGuaranteeDto,
  InvokeGuaranteeDto,
} from '../dto/contracting.dto';

@Controller(['contracting', 'api/contracting'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('contracting')
@AllowAuthenticated()
export class ContractingAssuranceController {
  constructor(private readonly contractingService: ContractingService) {}

  // --------------------------------------------------------------------------
  // 33. Material & Shop Drawing Submittals (اعتمادات المواد والمخططات MAR/MAS)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/submittals')
  async getSubmittals(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getSubmittals(req.authContext!, projectId);
  }

  @Post('projects/:projectId/submittals')
  async createSubmittal(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSubmittalDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createSubmittal(req.authContext!, projectId, dto);
  }

  @Put('submittals/:id/status')
  async updateSubmittalStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSubmittalStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateSubmittalStatus(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 34. Material Price Escalation & Fluctuation Claims (حاسبة ومطالبات فروق الأسعار)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/escalations')
  async getMaterialEscalations(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getMaterialEscalations(req.authContext!, projectId);
  }

  @Post('projects/:projectId/escalations')
  async createMaterialEscalation(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMaterialEscalationDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createMaterialEscalation(req.authContext!, projectId, dto);
  }

  @Put('escalations/:id/status')
  async updateMaterialEscalationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateMaterialEscalationStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateMaterialEscalationStatus(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 35. Subcontractor Back-Charges (سندات الخصومات المحملة على مقاولي الباطن)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/backcharges')
  async getSubcontractorBackcharges(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getSubcontractorBackcharges(req.authContext!, projectId);
  }

  @Post('projects/:projectId/backcharges')
  async createSubcontractorBackcharge(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSubcontractorBackchargeDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createSubcontractorBackcharge(req.authContext!, projectId, dto);
  }

  @Put('backcharges/:id/status')
  async updateBackchargeStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBackchargeStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateBackchargeStatus(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // 36. Equipment Fuel & Operating Meter Logs (سجل عدادات وسولار المعدات)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/fuel-logs')
  async getEquipmentFuelLogs(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getEquipmentFuelLogs(req.authContext!, projectId);
  }

  @Post('projects/:projectId/fuel-logs')
  async createEquipmentFuelLog(
    @Param('projectId') projectId: string,
    @Body() dto: CreateEquipmentFuelLogDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.createEquipmentFuelLog(req.authContext!, projectId, dto);
  }

  // --------------------------------------------------------------------------
  // 37. Earned Value Management (EVM) & S-Curve Metrics (محرك القيمة المكتسبة)
  // --------------------------------------------------------------------------

  @Get('projects/:projectId/evm-metrics')
  async getProjectEvmMetrics(@Param('projectId') projectId: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getProjectEvmMetrics(req.authContext!, projectId);
  }

  // --------------------------------------------------------------------------
  // 38. Bank Guarantees & Gateway G1 (خطابات الضمان البنكية والبوابة الرقابية)
  // --------------------------------------------------------------------------

  @Get('guarantees')
  async getGuarantees(
    @Query('projectId') projectId: string,
    @Query('subcontractId') subcontractId: string,
    @Query('subcontractorId') subcontractorId: string,
    @Query('status') status: string,
    @Query('guaranteeType') guaranteeType: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getGuarantees(req.authContext!, {
      projectId,
      subcontractId,
      subcontractorId: subcontractorId ? Number(subcontractorId) : undefined,
      status,
      guaranteeType,
    });
  }

  @Get('guarantees/alerts')
  async getGuaranteeExpiryAlerts(
    @Query('projectId') projectId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.getGuaranteeExpiryAlerts(req.authContext!, projectId);
  }

  @Get('guarantees/:id')
  async getGuaranteeById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.contractingService.getGuaranteeById(req.authContext!, id);
  }

  @Post('guarantees')
  async createGuarantee(@Body() dto: CreateGuaranteeDto, @Req() req: RequestWithAuth) {
    return this.contractingService.createGuarantee(req.authContext!, dto);
  }

  @Put('guarantees/:id')
  async updateGuarantee(
    @Param('id') id: string,
    @Body() dto: UpdateGuaranteeDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.updateGuarantee(req.authContext!, id, dto);
  }

  @Post('guarantees/:id/extend')
  async extendGuarantee(
    @Param('id') id: string,
    @Body() dto: ExtendGuaranteeDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.extendGuarantee(req.authContext!, id, dto);
  }

  @Post('guarantees/:id/release')
  async releaseGuarantee(
    @Param('id') id: string,
    @Body() dto: ReleaseGuaranteeDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.releaseGuarantee(req.authContext!, id, dto);
  }

  @Post('guarantees/:id/invoke')
  async invokeGuarantee(
    @Param('id') id: string,
    @Body() dto: InvokeGuaranteeDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.contractingService.invokeGuarantee(req.authContext!, id, dto);
  }

}
