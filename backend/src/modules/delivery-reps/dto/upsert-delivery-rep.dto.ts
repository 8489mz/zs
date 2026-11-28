import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, Min } from 'class-validator';

export class UpsertDeliveryRepDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  nationalId?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  vehiclePlate?: string;

  @IsString()
  @IsOptional()
  pinCode?: string;

  @IsString()
  @IsOptional()
  repType?: string;

  @IsBoolean()
  @IsOptional()
  isVanRep?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  permissions?: Record<string, any>;

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxCashCustodyLimit?: number | null;
}
