import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';
import { HeldSaleDto } from './dto/held-sale.dto';
import { PosAuditEventDto } from './dto/pos-audit-event.dto';
import { UpsertSaleDto } from './dto/upsert-sale.dto';
import { AdjustSalePaymentsDto } from './dto/adjust-sale-payments.dto';
import { AuthorizeDiscountOverrideDto, CancelSaleDto } from './dto/sales-misc.dto';
import { SalesService } from './sales.service';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get(['sales', 'v1/sales'])
  @RequirePermissions('sales')
  listSales(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.listSales(query, req.authContext!);
  }

  @Get(['sales/:id', 'v1/sales/:id'])
  @RequirePermissions('sales')
  getSale(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.getSaleById(id, req.authContext!);
  }

  @Post(['sales', 'v1/sales'])
  @RequirePermissions('sales')
  @UseInterceptors(IdempotencyInterceptor)
  createSale(@Body() payload: UpsertSaleDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.createSale(payload, req.authContext!);
  }

  @Post(['sales/discount-authorization', 'v1/sales/discount-authorization'])
  @RequirePermissions('sales')
  authorizeDiscountOverride(
    @Body() body: AuthorizeDiscountOverrideDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.salesService.authorizeDiscountOverride(String(body?.secret || ''), req.authContext!);
  }

  @Post(['sales/pos-audit-event', 'v1/sales/pos-audit-event'])
  @RequirePermissions('sales')
  logPosAuditEvent(@Body() payload: PosAuditEventDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.logPosAuditEvent(payload, req.authContext!);
  }

  @Post(['sales/:id/cancel', 'v1/sales/:id/cancel'])
  @RequirePermissions('canEditInvoices')
  @UseInterceptors(IdempotencyInterceptor)
  cancelSale(@Param('id', ParseIntPipe) id: number, @Body() body: CancelSaleDto, @Req() req: RequestWithAuth) {
    return this.salesService.cancelSale(
      id,
      String(body?.reason || ''),
      String(body?.managerPin || ''),
      req.authContext!,
    );
  }

  @Put(['sales/:id', 'v1/sales/:id'])
  @RequirePermissions('canEditInvoices')
  updateSale(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertSaleDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.salesService.updateSale(id, payload, req.authContext!);
  }

  // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the ONLY writer of
  // sale_payments after posting, besides the original sale insert.
  // updateSale never touches the legs; a money correction comes here
  // with the complete new leg set, a reason, and a manager PIN.
  @Post(['sales/:id/payment-adjustment', 'v1/sales/:id/payment-adjustment'])
  @RequirePermissions('canEditInvoices')
  adjustSalePayments(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: AdjustSalePaymentsDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.salesService.adjustSalePayments(id, payload, req.authContext!);
  }

  @Get(['held-sales', 'v1/held-sales'])
  @RequirePermissions('sales')
  listHeldSales(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.listHeldSales(req.authContext!);
  }

  @Post(['held-sales', 'v1/held-sales'])
  @RequirePermissions('sales')
  saveHeldSale(@Body() payload: HeldSaleDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.saveHeldSale(payload, req.authContext!);
  }

  @Delete(['held-sales', 'v1/held-sales'])
  @RequirePermissions('sales')
  clearHeldSales(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.clearHeldSales(req.authContext!);
  }

  @Delete(['held-sales/:id', 'v1/held-sales/:id'])
  @RequirePermissions('sales')
  deleteHeldSale(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.salesService.deleteHeldSale(id, req.authContext!);
  }
}
