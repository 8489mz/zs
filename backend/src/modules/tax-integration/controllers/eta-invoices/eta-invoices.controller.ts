import { Controller, Get, Post, Body, Req, Param, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../../core/auth/decorators/permissions.decorator';
import { EtaSubmissionService } from '../../services/eta-submission/eta-submission.service';
import { SubmitEtaInvoicesDto } from '../../dto/tax-write.dto';
import {
  EtaSignatureBridgeService,
  AttachSignatureDto,
} from '../../services/eta-submission/eta-signature-bridge.service';
import { RequestWithAuth } from '../../../../core/auth/interfaces/request-with-auth.interface';

@Controller('api/tax-integration/eta/invoices')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class EtaInvoicesController {
  constructor(
    private readonly etaSubmissionService: EtaSubmissionService,
    private readonly etaSignatureBridge: EtaSignatureBridgeService,
  ) {}

  @Get('pending')
  @RequirePermissions('sales')
  async getPendingInvoices(@Req() req: RequestWithAuth) {
    const invoices = await this.etaSubmissionService.getPendingInvoices(String(req.authContext!.tenantId));
    return { success: true, data: invoices };
  }

  @Post('submit')
  @RequirePermissions('canEditInvoices')
  async submitInvoices(@Req() req: RequestWithAuth, @Body() body: SubmitEtaInvoicesDto) {
    return this.etaSubmissionService.submitInvoices(String(req.authContext!.tenantId), body.invoiceIds ?? []);
  }

  @Get('status/:submissionId')
  @RequirePermissions('sales')
  async getSubmissionStatus(@Req() req: RequestWithAuth, @Param('submissionId') submissionId: string) {
    return this.etaSubmissionService.checkSubmissionStatus(String(req.authContext!.tenantId), submissionId);
  }

  @Get('doc/:uuid')
  @RequirePermissions('sales')
  async getDocumentDetails(@Req() req: RequestWithAuth, @Param('uuid') uuid: string) {
    return this.etaSubmissionService.getDocumentDetails(String(req.authContext!.tenantId), uuid);
  }

  // ─── Signature Bridge (USB Token CAdES-BES) ──────────────────────────────────

  @Get(':id/canonical')
  @RequirePermissions('canEditInvoices')
  async prepareCanonical(@Req() req: RequestWithAuth, @Param('id') id: string) {
    const result = await this.etaSignatureBridge.prepareCanonicalDocument(
      String(req.authContext!.tenantId),
      Number(id),
    );
    return { success: true, data: result };
  }

  @Post('attach-signature')
  @RequirePermissions('canEditInvoices')
  async attachCadesSignature(@Req() req: RequestWithAuth, @Body() body: AttachSignatureDto) {
    return this.etaSignatureBridge.attachCadesSignature(String(req.authContext!.tenantId), body);
  }
}
