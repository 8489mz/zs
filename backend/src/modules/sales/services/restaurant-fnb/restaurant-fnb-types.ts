/*
 * D5 sales — restaurant F&B DTOs converted from interfaces to
 * classes (Rule 5, in place). TenantScope stays an interface —
 * it is a server-side scope object, never a request body.
 *
 * Required-ness follows the SERVICE, not the interface
 * declarations (the D3 periodMonth lesson):
 * - CalculateTipPoolDto.shiftDate: the interface declares it
 *   required, but the service defaults to the business date
 *   when absent. Optional.
 * - SaveTableZoneDto.tableNumbers: the interface declares it
 *   required, but the service stores [] when absent. Optional.
 * - GeneratePrepSheetDto.prepDate: the interface declares it
 *   required, but the service defaults to the business date
 *   when absent. Optional. items: the caller never sends them
 *   (the service falls back to default prep templates), so
 *   items stay optional — but when an item IS sent, productId
 *   and productName are required (the slice inserts them into
 *   non-nullable columns unguarded); unitName / parLevel stay
 *   optional (the slice defaults them to 'كجم' / 10).
 * - CalculateTipPoolDto.staff: the service THROWS on an empty
 *   staff list, so the DTO requires at least one member.
 */

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export interface TenantScope {
  tenantId: string;
  branchId?: number | null;
  userId?: number | null;
  // INV-REST-FNB-CLAIMS-POST: the comp/tip gates need the caller's identity.
  // accountId is the tenant account scope the journal posts under; role /
  // permissions are the caller's own, read from the session — never from
  // the request body. The controller forwards them from req.authContext.
  accountId?: string | null;
  username?: string | null;
  role?: string | null;
  permissions?: string[];
}

export class Toggle86ItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsNumber()
  componentProductId?: number | null;

  @IsBoolean()
  is86ed!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsNumber()
  autoRestoreHours?: number;
}

export class TipPoolStaffDto {
  @IsInt()
  @Min(1)
  employeeId!: number;

  @IsString()
  @IsNotEmpty()
  employeeName!: string;

  @IsString()
  @IsNotEmpty()
  roleName!: string;

  @IsNumber()
  hoursWorked!: number;

  @IsOptional()
  @IsNumber()
  pointWeight?: number;
}

export class CalculateTipPoolDto {
  @IsOptional()
  @IsString()
  shiftDate?: string;

  @IsOptional()
  @IsString()
  shiftName?: string;

  @IsOptional()
  @IsNumber()
  totalCashTips?: number;

  @IsOptional()
  @IsNumber()
  totalCardTips?: number;

  @IsIn(['roles', 'hours', 'equal'])
  distributionMethod!: 'roles' | 'hours' | 'equal';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TipPoolStaffDto)
  staff!: TipPoolStaffDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SaveTableZoneDto {
  @IsOptional()
  @IsNumber()
  id?: number;

  @IsString()
  @IsNotEmpty()
  zoneCode!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsNumber()
  capacitySeats?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tableNumbers?: string[];

  @IsOptional()
  @IsNumber()
  minimumSpend?: number;
}

export class PrepSheetItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsString()
  @IsNotEmpty()
  productName!: string;

  @IsOptional()
  @IsString()
  unitName?: string;

  @IsOptional()
  @IsNumber()
  parLevel?: number;
}

export class GeneratePrepSheetDto {
  @IsOptional()
  @IsString()
  prepDate?: string;

  @IsOptional()
  @IsIn(['morning', 'evening', 'night'])
  shiftType?: 'morning' | 'evening' | 'night';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrepSheetItemDto)
  items?: PrepSheetItemDto[];
}
