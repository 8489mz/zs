import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../../core/auth/guards/permissions.guard';
import { AllowAuthenticated } from '../../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  RestaurantAdvancedFnbService,
  Toggle86ItemDto,
  CalculateTipPoolDto,
  SaveTableZoneDto,
  GeneratePrepSheetDto,
} from '../services/restaurant-advanced-fnb.service';

@Controller('api/sales/restaurant')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@AllowAuthenticated()
export class RestaurantAdvancedFnbController {
  constructor(private readonly service: RestaurantAdvancedFnbService) {}

  // 1. Fast 86 Engine
  @Get('86-items')
  async get86Items(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const branch = branchId ? parseInt(branchId, 10) : undefined;
    return this.service.get86Items(scope, branch);
  }

  @Post('86-items/toggle')
  async toggle86Item(
    @Req() req: RequestWithAuth,
    @Body() dto: Toggle86ItemDto,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const userId = Number(req.authContext?.userId || 0);
    return this.service.toggle86Item({ ...scope, userId }, dto);
  }

  // 2. Tip Pooling & Shift Distribution
  // INV-REST-FNB-CLAIMS-POST: these three endpoints are manager-only. The
  // gate lives in the service (assertManagerCaller), not in a decorator:
  // the manager definition is admin role OR the pos_manager /
  // manage_restaurant permission — the same definition the POS uses for
  // its manager tiles — and PermissionsGuard checks permission strings
  // only, so a decorator could not express the role half and would lock
  // out tenant admins.
  @Get('tip-pools')
  async getTipPools(
    @Req() req: RequestWithAuth,
    @Query('shiftDate') shiftDate?: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getTipPools(scope, shiftDate);
  }

  // INV-REST-TIP-STAFF-REAL: the tip-pool picker's staff list. A plain
  // @AllowAuthenticated() GET (the class already carries it) — the
  // payload is active employees' id + displayName + branchId +
  // expectedDailyHours only, so there is no HR detail to gate behind
  // hrEmployees, and the manager caller who opens the modal does not
  // necessarily hold that permission (see the service comment).
  @Get('staff')
  async getTipPoolStaff(@Req() req: RequestWithAuth) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getTipPoolStaff(scope);
  }

  @Post('tip-pools/calculate')
  async calculateAndSaveTipPool(
    @Req() req: RequestWithAuth,
    @Body() dto: CalculateTipPoolDto,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.calculateAndSaveTipPool(
      { ...scope, role: req.authContext?.role, permissions: req.authContext?.permissions ?? [] },
      dto,
    );
  }

  @Post('tip-pools/:id/distribute')
  async confirmTipDistribution(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const userId = Number(req.authContext?.userId || 0);
    return this.service.confirmTipDistribution(
      { ...scope, userId, role: req.authContext?.role, permissions: req.authContext?.permissions ?? [] },
      id,
    );
  }

  // 3. Multi-Zone Floor Plan
  @Get('zones')
  async getZones(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const branch = branchId ? parseInt(branchId, 10) : undefined;
    return this.service.getZones(scope, branch);
  }

  @Post('zones')
  async saveZone(
    @Req() req: RequestWithAuth,
    @Body() dto: SaveTableZoneDto,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.saveZone(scope, dto);
  }

  // 4. Central Prep Kitchen & Daily Prep Sheets
  @Get('prep-sheets')
  async getPrepSheets(
    @Req() req: RequestWithAuth,
    @Query('prepDate') prepDate?: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getPrepSheets(scope, prepDate);
  }

  @Post('prep-sheets/generate')
  async generateDailyPrepSheet(
    @Req() req: RequestWithAuth,
    @Body() dto: GeneratePrepSheetDto,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const userId = Number(req.authContext?.userId || 0);
    return this.service.generateDailyPrepSheet({ ...scope, userId }, dto);
  }

  @Post('prep-sheets/items/:id/record')
  async recordPrepProduction(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('actualQty') actualQty: number,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const userId = Number(req.authContext?.userId || 0);
    return this.service.recordPrepProduction({ ...scope, userId }, id, Number(actualQty || 0));
  }

  // 5. Digital Stamp Card Loyalty
  @Get('stamp-cards/:customerId')
  async getCustomerStampCard(
    @Req() req: RequestWithAuth,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getCustomerStampCard(scope, customerId);
  }

  @Post('stamp-cards/:customerId/stamp')
  async addCustomerStamp(
    @Req() req: RequestWithAuth,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body('count') count?: number,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.addCustomerStamp(scope, customerId, Number(count || 1));
  }

  // 6. Live Food Inflation & Plate Cost Radar
  @Get('plate-cost-radar')
  async getPlateCostFluctuations(@Req() req: RequestWithAuth) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getPlateCostFluctuations(scope);
  }

  // 7. Manager Comps & VIP On-The-House
  @Get('manager-comps')
  async getManagerComps(@Req() req: RequestWithAuth) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getManagerComps(scope);
  }

  @Post('manager-comps')
  async recordManagerComp(
    @Req() req: RequestWithAuth,
    @Body() dto: {
      saleId?: number;
      tableNumber?: string;
      compType: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';
      managerName: string;
      managerPin?: string;
      amount: number;
      itemsSummary?: string;
      notes?: string;
    },
  ) {
    const scope = requireTenantScope(req.authContext!);
    const userId = Number(req.authContext?.userId || 0);
    return this.service.recordManagerComp(
      { ...scope, userId, role: req.authContext?.role, permissions: req.authContext?.permissions ?? [] },
      dto,
    );
  }

  // 8. Table QR Rating & Rescue Alert
  @Post('table-ratings')
  async recordTableRating(
    @Req() req: RequestWithAuth,
    @Body() dto: {
      tableNumber: string;
      saleId?: number;
      rating: number;
      feedbackCategory?: string;
      notes?: string;
    },
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.recordTableRating(scope, dto);
  }

  @Post('table-ratings/:id/rescue')
  async resolveRescueAlert(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('managerName') managerName: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.resolveRescueAlert(scope, id, managerName || 'مدير الصالة');
  }

  // 9. Table Minimum Spend Calculator
  @Post('minimum-spend/calculate')
  async calculateMinimumSpend(
    @Body('currentTotal') currentTotal: number,
    @Body('minimumSpend') minimumSpend: number,
  ) {
    return this.service.calculateMinimumSpend(Number(currentTotal || 0), Number(minimumSpend || 0));
  }

  // 10. Drive-Thru Lane & Speed of Service
  @Get('drive-thru')
  async getDriveThruOrders(@Req() req: RequestWithAuth) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getDriveThruOrders(scope);
  }

  @Post('drive-thru')
  async createDriveThruOrder(
    @Req() req: RequestWithAuth,
    @Body() dto: {
      vehiclePlate: string;
      vehicleDesc?: string;
      totalAmount?: number;
      notes?: string;
    },
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.createDriveThruOrder(scope, dto);
  }

  @Patch('drive-thru/:id/status')
  async updateDriveThruStatus(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: 'order_taken' | 'at_window' | 'completed' | 'cancelled',
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.updateDriveThruStatus(scope, id, status);
  }

  // 11. Smart Upselling & Cross-Selling
  @Get('upsell')
  async getUpsellRecommendations(
    @Req() req: RequestWithAuth,
    @Query('triggerProductId') triggerProductId?: string,
    @Query('categoryName') categoryName?: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.getUpsellRecommendations(
      scope,
      triggerProductId ? Number(triggerProductId) : undefined,
      categoryName,
    );
  }

  @Post('upsell')
  async createUpsellRule(
    @Req() req: RequestWithAuth,
    @Body() dto: {
      triggerProductId?: number;
      triggerCategoryName?: string;
      suggestedProductId: number;
      suggestedProductName: string;
      title: string;
      discountAmount?: number;
    },
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.createUpsellRule(scope, dto);
  }

  // 12. Visual Floor Plan Canvas Layouts
  @Get('table-layouts')
  async getTableLayouts(
    @Req() req: RequestWithAuth,
    @Query('branchId') branchId?: string,
  ) {
    const scope = requireTenantScope(req.authContext!);
    const branch = branchId ? parseInt(branchId, 10) : undefined;
    return this.service.getTableLayouts(scope, branch);
  }

  @Post('table-layouts')
  async saveTableLayouts(
    @Req() req: RequestWithAuth,
    @Body() dto: {
      layouts: Array<{
        id?: number;
        table_number: string;
        zone_code?: string;
        shape?: 'square' | 'round' | 'rectangle' | 'booth';
        x_pos: number;
        y_pos: number;
        width?: number;
        height?: number;
        seats?: number;
        rotation?: number;
      }>;
      branchId?: number;
    },
  ) {
    const scope = requireTenantScope(req.authContext!);
    // INV-REST-FLOOR-SAVE-MANAGER-FORWARD: the save gate lives in the
    // service (assertManagerCaller) and reads scope.role / scope.permissions,
    // but requireTenantScope returns only { tenantId, accountId } — passing
    // the bare scope made EVERY save 403, manager included. Forward the
    // caller's identity like the comp/tip endpoints do.
    return this.service.saveTableLayouts(
      { ...scope, role: req.authContext?.role, permissions: req.authContext?.permissions ?? [] },
      dto.layouts,
      dto.branchId,
    );
  }

  @Post('table-layouts/:id/delete')
  async deleteTableLayout(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.deleteTableLayout(scope, id);
  }

  // INV-REST-FLOOR-STATE-TRUTH (R5-D, R-I35): whole-table transfer for a
  // held draft renames ONLY held_sales.table_number (see
  // renameHeldDraftTable). The target-occupied refusal lives in the
  // service (409), the merge path stays in the POS dialog.
  @Post('held-drafts/:id/rename-table')
  async renameHeldDraftTable(
    @Req() req: RequestWithAuth,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { tableNumber?: string },
  ) {
    const scope = requireTenantScope(req.authContext!);
    return this.service.renameHeldDraftTable(scope, id, String(dto?.tableNumber || ''));
  }
}
