import { Controller, Get, Post, Body, Param, Req, UseGuards, Headers, BadRequestException } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions, RequireAnyPermission } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { PosTerminalService, TerminalPaymentRequest } from '../services/pos-terminal.service';

@Controller('api/sales/pos/terminals')
export class PosTerminalController {
  constructor(private readonly terminalService: PosTerminalService) {}

  @Post('test-connection')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequireAnyPermission('sales', 'canManageSettings')
  async testConnection(@Req() req: RequestWithAuth, @Body() body: { ip?: string; port?: number; provider?: string }) {
    const result = await this.terminalService.testConnection(String(req.authContext!.tenantId), body);
    return {
      success: true,
      data: result,
    };
  }

  @Get()
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('sales')
  async getTerminals(@Req() req: RequestWithAuth) {
    const terminals = await this.terminalService.getTerminals(String(req.authContext!.tenantId));
    return {
      success: true,
      data: terminals,
    };
  }

  @Post('charge')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('sales')
  async initiateCharge(@Req() req: RequestWithAuth, @Body() body: TerminalPaymentRequest) {
    const session = await this.terminalService.initiatePayment(String(req.authContext!.tenantId), body);
    return {
      success: true,
      data: session,
    };
  }

  @Get('status/:transactionId')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('sales')
  async checkStatus(@Param('transactionId') transactionId: string, @Req() req: RequestWithAuth) {
    const session = await this.terminalService.getPaymentStatus(String(req.authContext!.tenantId), transactionId);
    return {
      success: true,
      data: session,
    };
  }

  @Post('cancel/:transactionId')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('sales')
  async cancelCharge(@Param('transactionId') transactionId: string, @Req() req: RequestWithAuth) {
    const session = await this.terminalService.cancelPayment(String(req.authContext!.tenantId), transactionId);
    return {
      success: true,
      data: session,
    };
  }

  // --- Hardware Bridge Outbound Relay Endpoints ---

  @Post('bridge/poll')
  async pollBridge(
    @Body() body: { tenantId: string; machineName?: string; bridgeVersion?: string },
    @Headers('x-zs-bridge-key') bridgeKey?: string,
  ) {
    if (!body?.tenantId) throw new BadRequestException('tenantId is required');
    this.terminalService.assertBridgeAuthenticated(String(body.tenantId).trim(), bridgeKey);
    const result = await this.terminalService.pollBridge(String(body.tenantId).trim());
    return {
      success: true,
      data: result,
    };
  }

  @Post('bridge/callback')
  async bridgeCallback(
    @Body()
    body: {
      tenantId: string;
      jobId: string;
      status: string;
      authCode?: string;
      rrn?: string;
      cardScheme?: string;
      cardLastFour?: string;
      message?: string;
    },
    @Headers('x-zs-bridge-key') bridgeKey?: string,
  ) {
    if (!body?.jobId || !body?.tenantId) throw new BadRequestException('jobId and tenantId are required');
    this.terminalService.assertBridgeAuthenticated(String(body.tenantId).trim(), bridgeKey);
    const success = await this.terminalService.handleBridgeCallback(String(body.tenantId).trim(), body);
    return {
      success,
    };
  }
}
