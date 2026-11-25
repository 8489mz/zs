import { Controller, Get, Post, Body, Param, Query, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { WhatsAppGatewayService, WhatsAppConfig } from '../services/whatsapp-gateway.service';

@Controller('api/settings/whatsapp')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class WhatsAppGatewayController {
  constructor(private readonly whatsappService: WhatsAppGatewayService) {}

  @Get()
  @RequirePermissions('canManageSettings')
  getConfig(@Req() req: RequestWithAuth): Promise<WhatsAppConfig> {
    return this.whatsappService.getConfig(req.authContext!);
  }

  @Post()
  @RequirePermissions('canManageSettings')
  saveConfig(@Body() payload: Partial<WhatsAppConfig>, @Req() req: RequestWithAuth): Promise<{ ok: boolean }> {
    return this.whatsappService.saveConfig(payload, req.authContext!);
  }

  @Post('test')
  @RequirePermissions('canManageSettings')
  sendTestMessage(
    @Body('phone') phone: string,
    @Req() req: RequestWithAuth,
  ): Promise<{ success: boolean; message?: string }> {
    return this.whatsappService.sendTestMessage(phone, req.authContext!);
  }

  @Post('simulate-bot')
  @RequirePermissions('canManageSettings')
  simulateBot(@Body('question') question: string, @Req() req: RequestWithAuth) {
    const { tenantId } = requireTenantScope(req.authContext!);
    return this.whatsappService.handleInboundWebhook({ phone: '01000000000', question, simulate: true }, tenantId);
  }

  @Post('send-invoice/:saleId')
  @RequirePermissions('sales')
  sendInvoice(
    @Param('saleId', ParseIntPipe) saleId: number,
    @Req() req: RequestWithAuth,
  ): Promise<{ success: boolean; message?: string }> {
    return this.whatsappService.sendInvoiceNotification(saleId, req.authContext!);
  }
}

@Controller('api/whatsapp')
export class WhatsAppPublicWebhookController {
  constructor(private readonly whatsappService: WhatsAppGatewayService) {}

  @Get('webhook')
  verifyWebhook(@Query('hub.challenge') challenge: string) {
    return challenge || 'OK';
  }

  @Post('webhook')
  handleWebhook(@Body() body: any, @Req() req: any, @Query('tenantId') tenantId?: string) {
    return this.whatsappService.handleVerifiedInboundWebhook(
      body,
      tenantId,
      req.headers['x-zs-webhook-signature'],
      req.rawBody,
    );
  }

  @Post('webhook/:tenantId')
  handleTenantWebhook(@Param('tenantId') tenantId: string, @Body() body: any, @Req() req: any) {
    return this.whatsappService.handleVerifiedInboundWebhook(
      body,
      tenantId,
      req.headers['x-zs-webhook-signature'],
      req.rawBody,
    );
  }
}
