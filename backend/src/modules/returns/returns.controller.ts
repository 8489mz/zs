import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnsService } from './returns.service';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get('returns')
  @RequirePermissions('returns')
  listReturns(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.returnsService.listReturns(query, req.authContext!);
  }

  @Get('returns/invoices/:type/:invoiceId/quantities')
  @RequirePermissions('returns')
  getInvoiceReturnedQuantities(
    @Param('type') type: string,
    @Param('invoiceId', ParseIntPipe) invoiceId: number,
    @Req() req: RequestWithAuth,
  ): Promise<{ returnedQtyByLine: Record<string, number>; blockedProductIds: string[] }> {
    return this.returnsService.getInvoiceReturnedQuantities(type, invoiceId, req.authContext!);
  }

  /* INV-STATEMENT-RETURN-ROW-DETAILS: single return-document read for the
   * statement details button. Registered after the specific
   * 'returns/invoices/...' route so that path never reaches this handler
   * (ParseIntPipe would also reject the 'invoices' segment). */
  @Get('returns/:id')
  @RequirePermissions('returns')
  getReturnById(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.returnsService.getReturnById(id, req.authContext!);
  }

  @Post('returns')
  @RequirePermissions('returns')
  @UseInterceptors(IdempotencyInterceptor)
  createReturn(@Body() payload: CreateReturnDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.returnsService.createReturn(payload, req.authContext!);
  }
}
