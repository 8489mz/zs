import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { TableServiceCallsService } from '../services/table-service-calls.service';
import { TableCallRateLimitGuard } from '../guards/table-call-rate-limit.guard';
import { CreateTableServiceCallDto } from '../dto/table-service-call.dto';

@Controller('api/sales/table-calls')
export class TableServiceCallsController {
  constructor(private readonly service: TableServiceCallsService) {}

  @Post()
  @UseGuards(TableCallRateLimitGuard)
  async createCall(
    @Req() req: RequestWithAuth,
    @Body() dto: CreateTableServiceCallDto,
    @Query('slug') slug?: string,
  ) {
    // INV-TABLE-CALL-SLUG-TENANT: the endpoint stays public (the caller
    // is a storefront guest), but the tenant is resolved server-side:
    // a staff session wins when present, otherwise the storefront slug.
    // Caller-supplied x-tenant-id / ?tenantId are never read, and there
    // is no 'default' tenant fallback: an unknown slug fails closed.
    const tenantId = req.authContext?.tenantId || (await this.service.resolveTenantBySlug(slug));
    return this.service.createCall(tenantId, dto);
  }

  @Get()
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('sales')
  async listPendingCalls(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    const tenantId = req.authContext?.tenantId || 'default';
    return this.service.listPendingCalls(tenantId, branchId ? Number(branchId) : undefined);
  }

  @Patch(':id/resolve')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('sales')
  async resolveCall(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const tenantId = req.authContext?.tenantId || 'default';
    return this.service.resolveCall(tenantId, id);
  }

  @Patch('table/:tableNumber/resolve')
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions('sales')
  async resolveCallsForTable(
    @Req() req: RequestWithAuth,
    @Param('tableNumber') tableNumber: string,
  ) {
    const tenantId = req.authContext?.tenantId || 'default';
    return this.service.resolveCallsForTable(tenantId, tableNumber);
  }
}
