import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateExpenseDto {
  @IsString()
  title!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  amount!: number;

  /** Stable client-generated key; retries return the original expense. */
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  requestKey!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  branchId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  locationId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  costCenterId?: number;
}
