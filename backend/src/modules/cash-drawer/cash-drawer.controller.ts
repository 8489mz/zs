import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions, RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { CashDrawerService } from './cash-drawer.service';
import { CashDrawerCounterpartService } from './cash-drawer-counterpart.service';
import { CashMovementDto } from './dto/cash-movement.dto';
import { CloseCashierShiftDto } from './dto/close-cashier-shift.dto';
import { OpenCashierShiftDto } from './dto/open-cashier-shift.dto';
import { ReviewCashierShiftDto } from './dto/review-cashier-shift.dto';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CashDrawerController {
  constructor(
    private readonly cashDrawerService: CashDrawerService,
    private readonly counterpartService: CashDrawerCounterpartService,
  ) {}

  @Get('cashier-shifts')
  @RequireAnyPermission('cashDrawer', 'hrPayroll', 'hrPayrollManage', 'hr', 'accounting')
  list(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.cashDrawerService.listCashierShifts(query, req.authContext!);
  }

  // INV-CASH-DRAWER-COUNTERPART-CASHIER-ACCESS: narrow counterpart
  // list for the drawer movement form. Cashiers hold `cashDrawer`
  // by default; the full chart endpoint stays behind
  // AccountingAccessGuard (super_admin / admin / `accounting` only).
  @Get('cashier-shifts/counterpart-accounts')
  @RequirePermissions('cashDrawer')
  counterpartAccounts(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.counterpartService.listCounterpartAccounts(req.authContext!);
  }

  @Post('cashier-shifts/open')
  @RequirePermissions('cashDrawer')
  open(
    @Body() payload: OpenCashierShiftDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.cashDrawerService.openCashierShift(payload, req.authContext!);
  }

  @Post('cashier-shifts/:id/cash-movement')
  @RequirePermissions('cashDrawer')
  movement(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: CashMovementDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.cashDrawerService.recordCashMovement(id, payload, req.authContext!);
  }

  @Post('cashier-shifts/:id/close')
  @RequirePermissions('cashDrawer')
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: CloseCashierShiftDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.cashDrawerService.closeCashierShift(id, payload, req.authContext!);
  }

  @Post('cashier-shifts/:id/review-close')
  @RequirePermissions('cashDrawer')
  reviewClose(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: ReviewCashierShiftDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.cashDrawerService.reviewCashierShiftClose(id, payload, req.authContext!);
  }
}
