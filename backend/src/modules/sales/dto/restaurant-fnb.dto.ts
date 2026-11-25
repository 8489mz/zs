/*
 * D5 sales — restaurant F&B DTOs.
 *
 * RecordManagerCompDto (MONEY): the caller
 * (restaurant-advanced-fnb.api.ts recordManagerComp) sends the
 * full comp shape. managerName stays REQUIRED — the interface
 * declares it required and the caller always sends it — but the
 * service records the VERIFIED approver, never the free-text
 * name (a display label, not an identity).
 *
 * RecordTableRatingDto: the caller (recordTableRating) sends
 * { tableNumber, saleId?, rating, feedbackCategory?, notes? }.
 *
 * CreateDriveThruOrderDto: the caller (createDriveThruOrder)
 * sends { vehiclePlate, vehicleDesc?, totalAmount?, notes? }.
 *
 * CreateUpsellRuleDto: the caller (createUpsellRule) sends
 * { triggerProductId?, triggerCategoryName?,
 * suggestedProductId, suggestedProductName, title,
 * discountAmount? }.
 *
 * SaveTableLayoutsDto: the caller (saveTableLayouts) sends
 * { layouts, branchId } — and each layout item carries
 * `is_active`, which is NOT in the controller type. The DTO
 * accepts it, or the save would 400. The service ignores the
 * flag on insert (it always stores is_active: true) — a
 * pre-existing simplification, not fixed here.
 *
 * RenameHeldDraftTableDto: the caller (renameHeldDraftTable)
 * sends { tableNumber }. The controller String()s a missing
 * table, so it stays optional.
 */

import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  Min,
  ValidateNested,
} from 'class-validator';

export class RecordManagerCompDto {
  @IsOptional()
  @IsNumber()
  saleId?: number;

  @IsOptional()
  @IsString()
  tableNumber?: string;

  @IsIn(['vip_guest', 'customer_complaint', 'staff_meal', 'promotional_tasting'])
  compType!: 'vip_guest' | 'customer_complaint' | 'staff_meal' | 'promotional_tasting';

  @IsString()
  @IsNotEmpty()
  managerName!: string;

  @IsOptional()
  @IsString()
  managerPin?: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  itemsSummary?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordTableRatingDto {
  @IsString()
  @IsNotEmpty()
  tableNumber!: string;

  @IsOptional()
  @IsNumber()
  saleId?: number;

  @IsNumber()
  @Min(1)
  rating!: number;

  @IsOptional()
  @IsString()
  feedbackCategory?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDriveThruOrderDto {
  @IsString()
  @IsNotEmpty()
  vehiclePlate!: string;

  @IsOptional()
  @IsString()
  vehicleDesc?: string;

  @IsOptional()
  @IsNumber()
  totalAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateUpsellRuleDto {
  @IsOptional()
  @IsNumber()
  triggerProductId?: number;

  @IsOptional()
  @IsString()
  triggerCategoryName?: string;

  @IsNumber()
  suggestedProductId!: number;

  @IsString()
  @IsNotEmpty()
  suggestedProductName!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;
}

export class TableLayoutItemDto {
  @IsOptional()
  @IsNumber()
  id?: number;

  @IsOptional()
  @IsString()
  table_number?: string;

  @IsOptional()
  @IsString()
  zone_code?: string;

  @IsOptional()
  @IsIn(['square', 'rectangle', 'round', 'booth'])
  shape?: 'square' | 'rectangle' | 'round' | 'booth';

  @IsOptional()
  @IsNumber()
  x_pos?: number;

  @IsOptional()
  @IsNumber()
  y_pos?: number;

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  seats?: number;

  @IsOptional()
  @IsNumber()
  rotation?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class SaveTableLayoutsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TableLayoutItemDto)
  layouts?: TableLayoutItemDto[];

  @IsOptional()
  @IsNumber()
  branchId?: number;
}

export class RenameHeldDraftTableDto {
  @IsOptional()
  @IsString()
  tableNumber?: string;
}
