import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions, AllowAuthenticated } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';
import { CreateDamagedStockDto } from './dto/create-damaged-stock.dto';
import { CreateStockCountSessionDto, PostStockCountSessionDto, RecountStockCountItemDto } from './dto/create-stock-count-session.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { InventoryAdjustmentDto } from './dto/inventory-adjustment.dto';
import { InventoryService } from './inventory.service';
import { InventoryReplenishmentService } from './services/inventory-replenishment.service';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@UseInterceptors(IdempotencyInterceptor)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly replenishmentService: InventoryReplenishmentService,
  ) {}

  @Get('locations')
  @AllowAuthenticated()
  listLocations(@Req() req: RequestWithAuth, @Query('includeInactive') includeInactive?: string): Promise<Record<string, unknown>> {
    return this.inventoryService.listLocations(req.authContext!, includeInactive === 'true');
  }

  @Get('location-stocks')
  @AllowAuthenticated()
  getAllLocationStocks(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.getAllLocationStocks(req.authContext!);
  }

  @Get('inventory/advanced-overview')
  @RequirePermissions('inventory')
  getAdvancedOverview(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.getAdvancedOverview(req.authContext!);
  }

  @Get('locations/:id/categories')
  @RequirePermissions('inventory')
  getLocationCategories(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.getLocationCategories(id, req.authContext!);
  }

  @Get('locations/:id/categories/:categoryId/products')
  @RequirePermissions('inventory')
  getLocationCategoryProducts(
    @Param('id', ParseIntPipe) id: number,
    @Param('categoryId') categoryId: string,
    @Req() req: RequestWithAuth
  ): Promise<Record<string, unknown>> {
    const parsedCategoryId = categoryId === 'all' ? 'all' : parseInt(categoryId, 10);
    return this.inventoryService.getLocationCategoryProducts(id, parsedCategoryId, req.authContext!);
  }

  @Post('locations/:id/assign-products')
  @RequirePermissions('canAdjustInventory')
  assignProductsToLocation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { productIds: number[] },
    @Req() req: RequestWithAuth
  ): Promise<{ success: boolean }> {
    return this.inventoryService.assignProductsToLocation(id, body.productIds || [], req.authContext!);
  }

  @Delete('locations/:id/products/:productId')
  @RequirePermissions('canAdjustInventory')
  removeProductFromLocation(
    @Param('id', ParseIntPipe) id: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Req() req: RequestWithAuth
  ): Promise<{ success: boolean }> {
    return this.inventoryService.removeProductFromLocation(id, productId, req.authContext!);
  }

  @Get('stock-transfers')
  @RequirePermissions('inventory')
  listTransfers(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.listStockTransfers(query, req.authContext!);
  }

  @Get('stock-movements')
  @RequirePermissions('inventory')
  listMovements(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.listStockMovements(query, req.authContext!);
  }

  @Post('stock-transfers')
  @RequirePermissions('canAdjustInventory')
  createTransfer(@Body() payload: CreateStockTransferDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.createStockTransfer(payload, req.authContext!);
  }

  @Post('transfer-category')
  @RequirePermissions('canAdjustInventory')
  transferCategory(@Body() payload: import('./dto/create-category-transfer.dto').CreateCategoryTransferDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.transferCategory(payload, req.authContext!);
  }

  @Post('internal-transfer')
  @RequirePermissions('canAdjustInventory')
  internalTransfer(@Body() payload: CreateStockTransferDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.internalTransferProducts(payload as any, req.authContext!);
  }

  @Post('internal-transfer-category')
  @RequirePermissions('canAdjustInventory')
  internalTransferCategory(@Body() payload: import('./dto/create-category-transfer.dto').CreateCategoryTransferDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.internalTransferCategory(payload as any, req.authContext!);
  }

  @Post('stock-transfers/:id/receive')
  @RequirePermissions('canAdjustInventory')
  receiveTransfer(
    @Param('id', ParseIntPipe) id: number,
    // Partial/short receipts must identify which serials and which batches arrived.
    // INV-TRANSFER-RECEIPT-PINNED: a short receipt must also carry a
    // written variance reason (at least 8 characters).
    @Body() body: { items?: Array<{
      itemId: number;
      receivedQty: number;
      receivedSerials?: string[];
      batchReceipts?: Array<{ transitBatchId: number; receivedQty: number }>;
    }>; varianceReason?: string },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.receiveStockTransfer(id, req.authContext!, body);
  }

  @Post('stock-transfers/:id/cancel')
  @RequirePermissions('canAdjustInventory')
  cancelTransfer(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.cancelStockTransfer(id, req.authContext!);
  }

  @Get('stock-count-sessions')
  @RequirePermissions('inventory')
  listStockCountSessions(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.listStockCountSessions(query, req.authContext!);
  }

  @Post('stock-count-sessions')
  @RequirePermissions('canAdjustInventory')
  createStockCountSession(@Body() payload: CreateStockCountSessionDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.createStockCountSession(payload, req.authContext!);
  }

  @Post('stock-count-sessions/:id/post')
  @RequirePermissions('canAdjustInventory')
  postStockCountSession(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: PostStockCountSessionDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    const adminPassword = String(payload?.adminPassword || payload?.managerPin || '').trim();
    return this.inventoryService.postStockCountSession(id, req.authContext!, adminPassword);
  }

  @Delete('stock-count-sessions/:id')
  @RequirePermissions('canAdjustInventory')
  deleteStockCountSession(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.deleteStockCountSession(id, req.authContext!);
  }

  @Post('stock-count-sessions/:id/items/:itemId/recount')
  @RequirePermissions('canAdjustInventory')
  recountStockCountItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() payload: RecountStockCountItemDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.inventoryService.recountPendingStockCountItem(id, itemId, payload, req.authContext!);
  }

  @Get('damaged-stock')
  @RequirePermissions('inventory')
  listDamaged(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.listDamagedStock(query, req.authContext!);
  }

  @Post('damaged-stock')
  @RequirePermissions('canAdjustInventory')
  createDamaged(@Body() payload: CreateDamagedStockDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.createDamagedStock(payload, req.authContext!);
  }

  @Post('inventory-adjustments')
  @RequirePermissions('canAdjustInventory')
  createAdjustment(@Body() payload: InventoryAdjustmentDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.inventoryService.createInventoryAdjustment(payload, req.authContext!);
  }

  @Get('inventory/smart-replenishment/suggestions')
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

  @Post('inventory/smart-replenishment/execute')
  @RequirePermissions('canAdjustInventory')
  executeSmartReplenishment(
    @Body()
    payload: {
      fromLocationId: number;
      toLocationId: number;
      items: { productId: number; qty: number }[];
      note?: string;
    },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.replenishmentService.executeReplenishment(payload, req.authContext!);
  }
}
