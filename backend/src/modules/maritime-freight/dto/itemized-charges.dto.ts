import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class QuotationChargeDto {
  @IsString()
  @IsNotEmpty()
  chargeCode!: string;

  @IsString()
  @IsNotEmpty()
  chargeNameAr!: string;

  @IsString()
  @IsNotEmpty()
  chargeNameEn!: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @Min(0)
  unitRate!: number;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsBoolean()
  @IsOptional()
  isLocalCharge?: boolean;

  @IsNumber()
  @IsOptional()
  taxRatePercent?: number;

  @IsNumber()
  @IsOptional()
  taxAmount?: number;
}

export class JobChargeDto {
  @IsNumber()
  @IsOptional()
  id?: number;

  @IsString()
  @IsNotEmpty()
  chargeCode!: string;

  @IsString()
  @IsNotEmpty()
  chargeNameAr!: string;

  @IsString()
  @IsNotEmpty()
  chargeNameEn!: string;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @Min(0)
  costAmount!: number;

  @IsNumber()
  @Min(0)
  sellAmount!: number;

  @IsNumber()
  @IsOptional()
  profitAmount?: number;

  @IsBoolean()
  @IsOptional()
  isLocalCharge?: boolean;

  @IsNumber()
  @IsOptional()
  taxRatePercent?: number;

  @IsNumber()
  @IsOptional()
  taxAmount?: number;

  @IsBoolean()
  @IsOptional()
  isInvoiced?: boolean;
}

export class UpdateJobChargesDto {
  @ValidateNested({ each: true })
  @Type(() => JobChargeDto)
  charges!: JobChargeDto[];
}
