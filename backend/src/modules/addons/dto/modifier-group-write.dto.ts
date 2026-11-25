/*
 * D10 — addons modifier-group write DTOs (new file; 2 sites share one
 * class: create + update modifier group).
 *
 * Caller traps (verified against ProductModifiersPage + addons.api.ts
 * at 7413c4f3e):
 * - The save payload carries NO group id (id is in the URL on update).
 * - Options are `...opt` spreads, so an edited option KEEPS id/groupId/
 *   componentProductName/portionAllowed/preparationTimeMinutes when
 *   present in form state — all accepted as optional.
 * - name is the only required field (the service defaults everything
 *   else); option price/costPrice carry @Min(0) (the service asserts
 *   non-negative prices).
 * - Nullable option fields are plain optional scalars — @IsOptional
 *   skips null, per the D9 `| null` lesson.
 */
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ModifierOptionDto {
  @IsOptional()
  @IsNumber()
  id?: number;

  @IsOptional()
  @IsNumber()
  groupId?: number;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  displayOrder?: number;

  @IsOptional()
  @IsNumber()
  componentProductId?: number;

  @IsOptional()
  @IsString()
  componentProductName?: string;

  @IsOptional()
  @IsNumber()
  consumptionQty?: number;

  @IsOptional()
  @IsString()
  unitName?: string;

  @IsOptional()
  @IsString()
  portionAllowed?: string;

  @IsOptional()
  @IsNumber()
  preparationTimeMinutes?: number;
}

export class ModifierGroupDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsEnum(['single', 'multiple'])
  selectionType?: 'single' | 'multiple';

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @IsNumber()
  minSelections?: number;

  @IsOptional()
  @IsNumber()
  maxSelections?: number;

  @IsOptional()
  @IsNumber()
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isSplittableInHalf?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionDto)
  options?: ModifierOptionDto[];
}
