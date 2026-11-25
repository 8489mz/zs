import { Controller, Get, Post, Body, Req, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SessionAuthGuard } from '../../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../../core/auth/interfaces/request-with-auth.interface';
import { ZatcaPhase2Service } from '../../services/zatca/zatca-phase2.service';
import {
  ZatcaOnboardingService,
  CreateEgsUnitDto,
  RequestComplianceDto,
} from '../../services/zatca/zatca-onboarding.service';
import { ZatcaSubmissionService } from '../../services/zatca/zatca-submission.service';
import { SubmitZatcaInvoicesBulkDto, ValidateZatcaComplianceDto } from '../../dto/tax-write.dto';

@Controller(['api/tax-integration/zatca', 'api/v1/tax-integration/zatca'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ZatcaController {
  constructor(
    private readonly zatcaService: ZatcaPhase2Service,
    private readonly zatcaOnboarding: ZatcaOnboardingService,
    private readonly zatcaSubmission: ZatcaSubmissionService,
  ) {}

  // ─── Clearance & Reporting Endpoints ─────────────────────────────────────────

  @Get('invoices/pending')
  @RequirePermissions('sales')
  async getPendingInvoices(@Req() req: RequestWithAuth) {
    const tenantId = String(req.authContext!.tenantId);
    const invoices = await this.zatcaSubmission.getPendingInvoices(tenantId);
    return { success: true, data: invoices };
  }

  @Post('invoices/submit/:id')
  @RequirePermissions('sales')
  async submitInvoice(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const tenantId = String(req.authContext!.tenantId);
    const result = await this.zatcaSubmission.submitInvoice(tenantId, Number(id));
    return { success: result.success, data: result };
  }

  @Post('invoices/submit-bulk')
  @RequirePermissions('sales')
  async bulkSubmitInvoices(@Req() req: RequestWithAuth, @Body() body: SubmitZatcaInvoicesBulkDto) {
    const tenantId = String(req.authContext!.tenantId);
    const numericIds = (body.invoiceIds || []).map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);
    const summary = await this.zatcaSubmission.bulkSubmitInvoices(tenantId, numericIds);
    return { success: summary.success, data: summary };
  }

  @Get('invoices/logs')
  @RequirePermissions('sales')
  async getTransmissionLogs(@Req() req: RequestWithAuth) {
    const tenantId = String(req.authContext!.tenantId);
    const logs = await this.zatcaSubmission.getTransmissionLogs(tenantId);
    return { success: true, data: logs };
  }

  // ─── Invoice Endpoints ───────────────────────────────────────────────────────

  @Get('invoice/:id')
  @RequirePermissions('sales')
  async getZatcaPackage(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const tenantId = String(req.authContext!.tenantId);
    const result = await this.zatcaService.buildZatcaInvoice(tenantId, Number(id));
    return { success: true, data: result };
  }

  @Get('invoice/:id/xml')
  @RequirePermissions('sales')
  async getZatcaXml(@Req() req: RequestWithAuth, @Param('id') id: string, @Res() res: Response) {
    const tenantId = String(req.authContext!.tenantId);
    const result = await this.zatcaService.buildZatcaInvoice(tenantId, Number(id));
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="zatca-invoice-${id}.xml"`);
    res.send(result.ublXml);
  }

  @Get('invoice/:id/qr')
  @RequirePermissions('sales')
  async getZatcaQr(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const tenantId = String(req.authContext!.tenantId);
    const result = await this.zatcaService.buildZatcaInvoice(tenantId, Number(id));
    return {
      success: true,
      data: {
        qrCodeBase64: result.qrCodeBase64,
        invoiceHash: result.invoiceHash,
        digitalSignature: result.digitalSignature,
      },
    };
  }

  @Post('compliance-check')
  @RequirePermissions('sales')
  async validateCompliance(@Body() body: ValidateZatcaComplianceDto) {
    const validation = this.zatcaService.validateCompliance(body);
    return { success: validation.valid, errors: validation.errors };
  }

  // ─── EGS Onboarding Endpoints ─────────────────────────────────────────────────

  @Get('egs-units')
  @RequirePermissions('canManageSettings')
  async listEgsUnits(@Req() req: RequestWithAuth) {
    const tenantId = String(req.authContext!.tenantId);
    const units = await this.zatcaOnboarding.listEgsUnits(tenantId);
    return { success: true, data: units };
  }

  @Post('egs-units')
  @RequirePermissions('canManageSettings')
  async createEgsUnit(@Req() req: RequestWithAuth, @Body() body: CreateEgsUnitDto) {
    const tenantId = String(req.authContext!.tenantId);
    return this.zatcaOnboarding.createEgsUnit(tenantId, body);
  }

  @Post('egs-units/request-compliance')
  @RequirePermissions('canManageSettings')
  async requestComplianceCsid(@Req() req: RequestWithAuth, @Body() body: RequestComplianceDto) {
    const tenantId = String(req.authContext!.tenantId);
    return this.zatcaOnboarding.requestComplianceCsid(tenantId, body);
  }

  @Post('egs-units/:id/request-production')
  @RequirePermissions('canManageSettings')
  async requestProductionCsid(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const tenantId = String(req.authContext!.tenantId);
    return this.zatcaOnboarding.requestProductionCsid(tenantId, id);
  }
}
