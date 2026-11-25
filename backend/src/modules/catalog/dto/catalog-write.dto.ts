/*
 * D10 — catalog write DTOs (new file; 4 sites).
 *
 * Caller traps (verified against products.api.ts + product-serials.api.ts
 * at 7413c4f3e):
 * - TransferCategoryProductsDto.productIds is NEVER read by the
 *   controller/service (transferProducts moves ALL category products)
 *   but the caller SENDS it — accepted as optional (Package C trap;
 *   pre-existing mismatch, recorded here).
 * - BulkUpdateIconsDto.updates is OPTIONAL (the service tolerates
 *   missing — payload?.updates || []), though the only caller always
 *   sends it.
 * - AddProductSerialsDto: PRE-EXISTING MISMATCH (recorded, NOT fixed):
 *   the ONLY caller (product-serials.api addSerials) sends { serials }
 *   while the controller reads payload.items — so today every call adds
 *   0 serials (the slice returns { count: 0 } on empty items). The DTO
 *   accepts BOTH field names so the caller's shape still passes the
 *   pipe; the service still reads items only.
 * - ToggleProductArchiveDto: ALL fields optional — the caller may send
 *   NO body at all.
 */
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class TransferCategoryProductsDto {
  @IsNumber()
  targetCategoryId!: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  productIds?: number[];
}

export class BulkIconUpdateDto {
  @IsNumber()
  id!: number;

  @IsString()
  icon!: string;
}

export class BulkUpdateIconsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkIconUpdateDto)
  updates?: BulkIconUpdateDto[];
}

export class ProductSerialItemDto {
  @IsString()
  serialNumber!: string;

  @IsOptional()
  @IsString()
  imei2?: string;

  @IsOptional()
  @IsNumber()
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  branchId?: number;

  @IsOptional()
  @IsNumber()
  locationId?: number;

  @IsOptional()
  @IsNumber()
  purchaseId?: number;

  @IsOptional()
  @IsNumber()
  purchaseItemId?: number;

  @IsOptional()
  @IsString()
  warrantyEndDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddProductSerialsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSerialItemDto)
  items?: ProductSerialItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSerialItemDto)
  serials?: ProductSerialItemDto[];
}

export class ToggleProductArchiveDto {
  @IsOptional()
  @IsBoolean()
  zeroStock?: boolean;

  @IsOptional()
  @IsBoolean()
  archiveEntireGroup?: boolean;
}
