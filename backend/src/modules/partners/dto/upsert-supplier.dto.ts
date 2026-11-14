import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, IsObject } from 'class-validator';

export class UpsertSupplierDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balance?: number;

  /* INV-SUPPLIER-ADVANCE-OVERDRAFT-LIMIT: 'freelancer' marks a contractor
   * (ads/marketing) registered on the supplier page instead of as an HR
   * employee. The overdraft limit caps cumulative outstanding advances;
   * null clears it back to uncapped. */
  @IsOptional()
  @IsIn(['supplier', 'freelancer'])
  supplierType?: 'supplier' | 'freelancer';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overdraftLimit?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
