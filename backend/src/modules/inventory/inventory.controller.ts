import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RequirePermissions, AllowAuthenticated } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';
import { CreateDamagedStockDto } from './dto/create-damaged-stock.dto';
import {
  CreateStockCountSessionDto,
  PostStockCountSessionDto,
  RecountStockCountItemDto,
} from './dto/create-stock-count-session.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { AssignProductsDto } from './dto/assign-products.dto';
import { ReceiveStockTransferDto } from './dto/receive-stock-transfer.dto';
import { ExecuteReplenishmentDto } from './dto/execute-replenishment.dto';
import { InventoryAdjustmentDto } from './dto/inventory-adjustment.dto';
import { ToggleHotSkuDto } from './dto/toggle-hot-sku.dto';
import { InventoryService } from './inventory.service';
import { InventoryReplenishmentService } from './services/inventory-replenishment.service';
import { InTransitAgingMonitorService } from './services/in-transit-aging-monitor.service';
import { LossPreventionInventoryService } from './services/loss-prevention-inventory.service';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@UseInterceptors(IdempotencyInterceptor)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly replenishmentService: InventoryReplenishmentService,
    private readonly inTransitMonitor: InTransitAgingMonitorService,
    private readonly lossPreventionInventory: LossPreventionInventoryService,
  ) {}

  @Get(['locations', 'v1/locations'])
  @AllowAuthenticated()
  listLocations(
    @Req() req: RequestWithAuth,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.listLocations(req.authContext!, includeInactive === 'true');
  }

  // INV-VAN-GENERIC-FEFO: read-only list of the generic batch ledger
  // (inventory_batches) for the batches page's second tab.
  @Get(['inventory/batches', 'v1/inventory/batches'])
  @RequirePermissions('inventory')
  listInventoryBatches(
    @Req() req: RequestWithAuth,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.listInventoryBatches(req.authContext!, {
      status,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get(['location-stocks', 'v1/location-stocks'])
  @AllowAuthenticated()
  getAllLocationStocks(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.getAllLocationStocks(req.authContext!);
  }

  // INV-ADJUST-SINGLE-QTY-BASIS: the adjustment dialog's prefill read
  // -- the location's available qty on the same basis the adjustment
  // targets. Read-only; declared before any ':id' route so the
  // literal segment is never captured as a parameter.
  @Get(['inventory/product-availability', 'v1/inventory/product-availability'])
  @RequirePermissions('inventory')
  getProductLocationAvailability(
    @Query('productId', ParseIntPipe) productId: number,
    @Query('locationId') locationId: string | undefined,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    const parsed = locationId === undefined || locationId === '' ? null : Number(locationId);
    if (parsed !== null && !Number.isFinite(parsed)) {
      throw new BadRequestException('المخزن غير صالح');
    }
    return this.inventoryService.getProductLocationAvailability(productId, parsed, req.authContext!);
  }

  @Get(['inventory/advanced-overview', 'v1/inventory/advanced-overview'])
  @RequirePermissions('inventory')
  getAdvancedOverview(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.getAdvancedOverview(req.authContext!);
  }

  @Get(['locations/:id/categories', 'v1/locations/:id/categories'])
  @RequirePermissions('inventory')
  getLocationCategories(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.getLocationCategories(id, req.authContext!);
  }

  @Get(['locations/:id/categories/:categoryId/products', 'v1/locations/:id/categories/:categoryId/products'])
  @RequirePermissions('inventory')
  getLocationCategoryProducts(
    @Param('id', ParseIntPipe) id: number,
    @Param('categoryId') categoryId: string,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    const parsedCategoryId = categoryId === 'all' ? 'all' : parseInt(categoryId, 10);
    return this.inventoryService.getLocationCategoryProducts(id, parsedCategoryId, req.authContext!);
  }

  @Post(['locations/:id/assign-products', 'v1/locations/:id/assign-products'])
  @RequirePermissions('canAdjustInventory')
  assignProductsToLocation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AssignProductsDto,
    @Req() req: RequestWithAuth,
  ): Promise<{ success: boolean }> {
    return this.inventoryService.assignProductsToLocation(id, body.productIds || [], req.authContext!);
  }

  @Delete(['locations/:id/products/:productId', 'v1/locations/:id/products/:productId'])
  @RequirePermissions('canAdjustInventory')
  removeProductFromLocation(
    @Param('id', ParseIntPipe) id: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Req() req: RequestWithAuth,
  ): Promise<{ success: boolean }> {
    return this.inventoryService.removeProductFromLocation(id, productId, req.authContext!);
  }

  @Get(['stock-transfers', 'v1/stock-transfers'])
  @RequirePermissions('inventory')
  listTransfers(
    @Query() query: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.listStockTransfers(query, req.authContext!);
  }

  @Get(['stock-movements', 'v1/stock-movements'])
  @RequirePermissions('inventory')
  listMovements(
    @Query() query: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.listStockMovements(query, req.authContext!);
  }

  @Post(['stock-transfers', 'v1/stock-transfers'])
  @RequirePermissions('canAdjustInventory')
  createTransfer(
    @Body() payload: CreateStockTransferDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.createStockTransfer(payload, req.authContext!);
  }

  @Post(['transfer-category', 'v1/transfer-category'])
  @RequirePermissions('canAdjustInventory')
  transferCategory(
    @Body() payload: import('./dto/create-category-transfer.dto').CreateCategoryTransferDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.transferCategory(payload, req.authContext!);
  }

  @Post(['internal-transfer', 'v1/internal-transfer'])
  @RequirePermissions('canAdjustInventory')
  internalTransfer(
    @Body() payload: CreateStockTransferDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.internalTransferProducts(payload, req.authContext!);
  }

  @Post(['internal-transfer-category', 'v1/internal-transfer-category'])
  @RequirePermissions('canAdjustInventory')
  internalTransferCategory(
    @Body() payload: import('./dto/create-category-transfer.dto').CreateCategoryTransferDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.internalTransferCategory(payload, req.authContext!);
  }

  @Post(['stock-transfers/:id/receive', 'v1/stock-transfers/:id/receive'])
  @RequirePermissions('canAdjustInventory')
  receiveTransfer(
    @Param('id', ParseIntPipe) id: number,
    // Partial/short receipts must identify which serials and which batches arrived.
    // INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL: a short receipt (any
    // shortfall over 0.0001) needs a written variance reason of at least
    // 8 characters AND approval by a different user than the receiver
    // (approvalSecret: the approving admin's password). The shared
    // manager PIN does not identify an approver and cannot satisfy it.
    @Body()
    body: ReceiveStockTransferDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.receiveStockTransfer(id, req.authContext!, body);
  }

  @Post(['stock-transfers/:id/cancel', 'v1/stock-transfers/:id/cancel'])
  @RequirePermissions('canAdjustInventory')
  cancelTransfer(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.cancelStockTransfer(id, req.authContext!);
  }

  // F19: reverse a received final issue prospectively (stock back to the
  // source at the frozen cost + a correcting journal that flips the
  // original expense journal; the original rows are never touched).
  @Post(['stock-transfers/:id/reverse-final-issue', 'v1/stock-transfers/:id/reverse-final-issue'])
  @RequirePermissions('canAdjustInventory')
  reverseFinalIssue(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.reverseFinalIssue(id, req.authContext!);
  }

  @Get(['stock-count-sessions', 'v1/stock-count-sessions'])
  @RequirePermissions('inventory')
  listStockCountSessions(
    @Query() query: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.listStockCountSessions(query, req.authContext!);
  }

  @Post(['stock-count-sessions', 'v1/stock-count-sessions'])
  @RequirePermissions('canAdjustInventory')
  createStockCountSession(
    @Body() payload: CreateStockCountSessionDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.createStockCountSession(payload, req.authContext!);
  }

  @Post(['stock-count-sessions/:id/post', 'v1/stock-count-sessions/:id/post'])
  @RequirePermissions('canAdjustInventory')
  postStockCountSession(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: PostStockCountSessionDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    const adminPassword = String(payload?.adminPassword || payload?.managerPin || '').trim();
    return this.inventoryService.postStockCountSession(id, req.authContext!, adminPassword);
  }

  @Delete(['stock-count-sessions/:id', 'v1/stock-count-sessions/:id'])
  @RequirePermissions('canAdjustInventory')
  deleteStockCountSession(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.deleteStockCountSession(id, req.authContext!);
  }

  @Post(['stock-count-sessions/:id/items/:itemId/recount', 'v1/stock-count-sessions/:id/items/:itemId/recount'])
  @RequirePermissions('canAdjustInventory')
  recountStockCountItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() payload: RecountStockCountItemDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.recountPendingStockCountItem(id, itemId, payload, req.authContext!);
  }

  @Get(['damaged-stock', 'v1/damaged-stock'])
  @RequirePermissions('inventory')
  listDamaged(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.listDamagedStock(query, req.authContext!);
  }

  @Post(['damaged-stock', 'v1/damaged-stock'])
  @RequirePermissions('canAdjustInventory')
  createDamaged(@Body() payload: CreateDamagedStockDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.createDamagedStock(payload, req.authContext!);
  }

  @Post(['inventory-adjustments', 'v1/inventory-adjustments'])
  @RequirePermissions('canAdjustInventory')
  createAdjustment(
    @Body() payload: InventoryAdjustmentDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.createInventoryAdjustment(payload, req.authContext!);
  }

  @Get(['inventory/smart-replenishment/suggestions', 'v1/inventory/smart-replenishment/suggestions'])
  @RequirePermissions('inventory')
  getSmartReplenishmentSuggestions(
    @Query('fromLocationId', ParseIntPipe) fromLocationId: number,
    @Query('toLocationId', ParseIntPipe) toLocationId: number,
    @Query('coverDays') coverDays: string | undefined,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.replenishmentService.getSuggestions(
      {
        fromLocationId,
        toLocationId,
        coverDays: coverDays ? parseInt(coverDays, 10) : 2,
      },
      req.authContext!,
    );
  }

  @Post(['inventory/smart-replenishment/execute', 'v1/inventory/smart-replenishment/execute'])
  @RequirePermissions('canAdjustInventory')
  executeSmartReplenishment(
    @Body()
    payload: ExecuteReplenishmentDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.replenishmentService.executeReplenishment(payload, req.authContext!);
  }

  @Get(['inventory/in-transit-custody', 'v1/inventory/in-transit-custody'])
  @RequirePermissions('inventory')
  listInTransitCustody(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inTransitMonitor.listInTransitCustody(req.authContext!) as unknown as Promise<Record<string, unknown>>;
  }

  @Get(['inventory/hot-skus', 'v1/inventory/hot-skus'])
  @RequirePermissions('inventory')
  listHotSkus(
    @Query('locationId') locationId: string | undefined,
    @Query('search') search: string | undefined,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    const parsedLoc = locationId ? parseInt(locationId, 10) : undefined;
    return this.lossPreventionInventory.listHotSkus(
      { locationId: parsedLoc && Number.isFinite(parsedLoc) ? parsedLoc : undefined, search },
      req.authContext!,
    );
  }

  @Post(['inventory/hot-skus/toggle', 'v1/inventory/hot-skus/toggle'])
  @RequirePermissions('canAdjustInventory')
  toggleHotSku(
    @Body() payload: ToggleHotSkuDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.lossPreventionInventory.toggleHotSku(
      payload.productId,
      payload.isHighRiskShrinkage,
      req.authContext!,
    );
  }

  @Get(['inventory/shrinkage-report', 'v1/inventory/shrinkage-report'])
  @RequirePermissions('inventory')
  getShrinkageReport(
    @Query('timeframe') timeframe: string | undefined,
    @Query('locationId') locationId: string | undefined,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    const parsedLoc = locationId ? parseInt(locationId, 10) : undefined;
    return this.lossPreventionInventory.getShrinkageReport(
      { timeframe, locationId: parsedLoc && Number.isFinite(parsedLoc) ? parsedLoc : undefined },
      req.authContext!,
    );
  }
}
