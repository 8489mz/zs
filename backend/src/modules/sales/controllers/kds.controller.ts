import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../../core/auth/decorators/feature.decorator';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import {
  KdsService,
  KdsStation,
  KdsTicketStatus,
  KdsItemStatus,
} from '../services/kds.service';

@Controller('api/sales/kds')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('restaurant')
@RequirePermissions('sales')
export class KdsController {
  constructor(private readonly kdsService: KdsService) {}

  @Get('tickets')
  async getTickets(
    @Req() req: RequestWithAuth,
    @Query('station') station?: KdsStation,
    @Query('orderType') orderType?: string,
    @Query('status') status?: KdsTicketStatus,
  ) {
    return this.kdsService.getActiveTickets(req.authContext!, {
      station,
      orderType,
      status,
    });
  }

  // R4-E I18: reads stay on 'sales' (class level). Every mutation that
  // moves kitchen state requires the 'kitchen' permission, introduced by
  // this package and granted alongside 'sales' in the role templates, and
  // backfilled to every existing user who holds 'sales' by migration
  // 0309, so no kitchen worker who holds restaurant/KDS access today is
  // locked out. The finer split (kitchen without sales) is a follow-up,
  // not a silent lockout. Method-level metadata overrides the
  // class-level 'sales'.
  @Post('tickets/:id/advance')
  @RequirePermissions('kitchen')
  async advanceStatus(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.kdsService.advanceTicketStatus(req.authContext!, id);
  }

  @Post('tickets/:id/status')
  @RequirePermissions('kitchen')
  async setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: KdsTicketStatus,
    @Req() req: RequestWithAuth,
  ) {
    return this.kdsService.setTicketStatus(req.authContext!, id, status);
  }

  @Post('tickets/:id/items/:itemId/status')
  @RequirePermissions('kitchen')
  async setItemStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body('status') status: KdsItemStatus,
    @Req() req: RequestWithAuth,
  ) {
    return this.kdsService.setItemStatus(req.authContext!, id, itemId, status);
  }

  @Post('tickets/recall-last')
  @RequirePermissions('kitchen')
  async recallLastServed(@Req() req: RequestWithAuth) {
    return this.kdsService.recallLastServedTicket(req.authContext!);
  }

  @Post('tickets/:id/fire-course')
  @RequirePermissions('kitchen')
  async fireCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body('course') course: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.kdsService.fireTicketCourse(req.authContext!, id, course);
  }
}
