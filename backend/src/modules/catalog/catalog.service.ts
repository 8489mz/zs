import { Injectable } from '@nestjs/common';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { UpsertCategoryDto } from './dto/upsert-category.dto';
import { UpsertProductDto, SaveFashionGroupDto } from './dto/upsert-product.dto';
import { CatalogCategoryService } from './services/catalog-category.service';
import { CatalogProductService } from './services/catalog-product.service';
import { ProductSerialsService, ProductSerialItemInput } from './services/product-serials.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly categoryService: CatalogCategoryService,
    private readonly productService: CatalogProductService,
    private readonly serialsService: ProductSerialsService,
  ) {}

  listCategories(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.categoryService.listCategories(actor);
  }
  createCategory(payload: UpsertCategoryDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.categoryService.createCategory(payload, actor);
  }
  updateCategory(id: number, payload: UpsertCategoryDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.categoryService.updateCategory(id, payload, actor);
  }
  deleteCategory(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.categoryService.deleteCategory(id, actor);
  }
  transferCategoryProducts(id: number, toCategoryId: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.categoryService.transferProducts(id, toCategoryId, actor);
  }
  listProducts(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.productService.listProducts(query, actor);
  }
  getProduct(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.productService.getProduct(id, actor);
  }
  getPosCatalogVersion(actor: AuthContext): Promise<{ version: string; totalCount: number; lastUpdatedAt: string }> {
    return this.productService.getPosCatalogVersion(actor);
  }
  listPosProducts(query: Record<string, unknown>, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.productService.listPosProducts(query, actor);
  }
  createProduct(payload: UpsertProductDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.productService.createProduct(payload, actor);
  }
  saveFashionGroup(
    styleCode: string,
    payload: SaveFashionGroupDto,
    actor: AuthContext,
  ): Promise<{ ok: boolean; updated: number; created: number; archived: number }> {
    return this.productService.saveFashionGroup(styleCode, payload, actor);
  }
  updateProduct(id: number, payload: UpsertProductDto, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.productService.updateProduct(id, payload, actor);
  }
  deleteProduct(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.productService.deleteProduct(id, actor);
  }
  toggleProductArchive(
    id: number,
    actor: AuthContext,
    options?: { zeroStock?: boolean; archiveEntireGroup?: boolean },
  ): Promise<Record<string, unknown>> {
    return this.productService.toggleProductArchive(id, actor, options);
  }
  getNextStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    return this.productService.getNextStyleCode(actor);
  }
  allocateStyleCode(actor: AuthContext): Promise<{ styleCode: string }> {
    return this.productService.allocateStyleCode(actor);
  }
  bulkUpdateIcons(
    updates: Array<{ id: number; icon: string }>,
    actor: AuthContext,
  ): Promise<{ ok: boolean; updated: number }> {
    return this.productService.bulkUpdateIcons(updates, actor);
  }

  listProductSerials(productId: number, query: Record<string, unknown>, actor: AuthContext) {
    return this.serialsService.listSerials(productId, query, actor);
  }
  addProductSerials(productId: number, items: ProductSerialItemInput[], actor: AuthContext) {
    return this.serialsService.addSerials(productId, items, actor);
  }
  lookupSerial(serial: string, actor: AuthContext) {
    return this.serialsService.lookupSerial(serial, actor);
  }
}
