import { Body, Controller, Delete as HttpRemove, Get, Header, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { RequirePermissions, RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { CatalogService } from './catalog.service';
import { UpsertCategoryDto } from './dto/upsert-category.dto';
import { UpsertProductDto, SaveFashionGroupDto } from './dto/upsert-product.dto';

@Controller('api')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @RequireAnyPermission('products', 'sales')
  listCategories(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.listCategories(req.authContext!);
  }

  @Post('categories')
  @RequirePermissions('products')
  createCategory(@Body() payload: UpsertCategoryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.createCategory(payload, req.authContext!);
  }

  @Put('categories/:id')
  @RequirePermissions('products')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertCategoryDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.catalogService.updateCategory(id, payload, req.authContext!);
  }

  @HttpRemove('categories/:id')
  @RequirePermissions('canDelete')
  removeCategory(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.deleteCategory(id, req.authContext!);
  }

  @Post('categories/:id/transfer')
  @RequirePermissions('products')
  transferCategoryProducts(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: { targetCategoryId: number },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.catalogService.transferCategoryProducts(id, payload.targetCategoryId, req.authContext!);
  }

  @Get('products')
  @RequireAnyPermission('products', 'inventory', 'canAdjustInventory', 'purchases', 'manufacturing')
  listProducts(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.listProducts(query, req.authContext!);
  }

  @Get('products/next-style-code')
  @RequirePermissions('products')
  getNextStyleCode(@Req() req: RequestWithAuth): Promise<{ styleCode: string }> {
    return this.catalogService.getNextStyleCode(req.authContext!);
  }

  @Post('products/allocate-style-code')
  @RequirePermissions('products')
  allocateStyleCode(@Req() req: RequestWithAuth): Promise<{ styleCode: string }> {
    return this.catalogService.allocateStyleCode(req.authContext!);
  }

  @Get('products/:id')
  @RequirePermissions('products')
  getProduct(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.getProduct(id, req.authContext!);
  }

  @Get('catalog/pos-products/version')
  @RequirePermissions('sales')
  getPosCatalogVersion(@Req() req: RequestWithAuth): Promise<{ version: string; totalCount: number; lastUpdatedAt: string }> {
    return this.catalogService.getPosCatalogVersion(req.authContext!);
  }

  @Get('catalog/pos-products')
  @RequirePermissions('sales')
  listPosProducts(@Query() query: Record<string, unknown>, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.listPosProducts(query, req.authContext!);
  }

  @Post('products')
  @RequirePermissions('products')
  createProduct(@Body() payload: UpsertProductDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.createProduct(payload, req.authContext!);
  }

  @Post('products/bulk-icons')
  @RequirePermissions('products')
  bulkUpdateIcons(
    @Body() payload: { updates: Array<{ id: number; icon: string }> },
    @Req() req: RequestWithAuth,
  ): Promise<{ ok: boolean; updated: number }> {
    return this.catalogService.bulkUpdateIcons(payload?.updates || [], req.authContext!);
  }

  @Put('products/fashion-groups/:styleCode')
  @RequirePermissions('products')
  saveFashionGroup(
    @Param('styleCode') styleCode: string,
    @Body() payload: SaveFashionGroupDto,
    @Req() req: RequestWithAuth,
  ): Promise<{ ok: boolean; updated: number; created: number; archived: number }> {
    return this.catalogService.saveFashionGroup(styleCode, payload, req.authContext!);
  }

  @Put('products/:id')
  @RequirePermissions('products')
  updateProduct(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: UpsertProductDto,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.catalogService.updateProduct(id, payload, req.authContext!);
  }

  @Get('catalog/serials/lookup')
  @RequirePermissions('sales')
  lookupSerial(@Query('serial') serial: string, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.lookupSerial(serial || '', req.authContext!);
  }

  @Get('products/:id/serials')
  @RequirePermissions('products')
  listProductSerials(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: Record<string, unknown>,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.catalogService.listProductSerials(id, query, req.authContext!);
  }

  @Post('products/:id/serials')
  @RequirePermissions('products')
  addProductSerials(
    @Param('id', ParseIntPipe) id: number,
    @Body() payload: { items: any[] },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.catalogService.addProductSerials(id, payload?.items || [], req.authContext!);
  }

  @Post('products/:id/toggle-archive')
  @RequirePermissions('products')
  toggleProductArchive(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { zeroStock?: boolean; archiveEntireGroup?: boolean } | undefined,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.catalogService.toggleProductArchive(id, req.authContext!, body);
  }

  @HttpRemove('products/:id')
  @RequirePermissions('canDelete')
  removeProduct(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.catalogService.deleteProduct(id, req.authContext!);
  }
}
