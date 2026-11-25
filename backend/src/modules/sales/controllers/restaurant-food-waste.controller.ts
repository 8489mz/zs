import { Controller, Get, Post, Body, Query, Req, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { RequirePermissions } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { RestaurantFoodWasteService, CreateFoodWasteLogDto } from '../services/restaurant-food-waste.service';

@Controller(['sales/food-waste', 'api/sales/food-waste'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequirePermissions('sales')
export class RestaurantFoodWasteController {
  constructor(private readonly service: RestaurantFoodWasteService) {}

  @Post()
  async logWaste(@Req() req: RequestWithAuth, @Body() dto: CreateFoodWasteLogDto) {
    return this.service.logWaste(req.authContext!, dto);
  }

  @Post(':id/reconcile')
  async reconcilePendingWaste(@Req() req: RequestWithAuth, @Param('id', ParseIntPipe) id: number) {
    return this.service.reconcilePendingWaste(req.authContext!, id);
  }

  @Get()
  async listLogs(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string, @Query('limit') limit?: string) {
    return this.service.listLogs(req.authContext!, {
      branchId: branchId ? Number(branchId) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('summary')
  async getVarianceSummary(@Req() req: RequestWithAuth, @Query('branchId') branchId?: string) {
    return this.service.getVarianceSummary(req.authContext!, branchId ? Number(branchId) : undefined);
  }
}
