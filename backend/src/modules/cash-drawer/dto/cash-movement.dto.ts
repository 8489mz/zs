import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CashMovementDto {
  /** Stable client-generated key; retries return the current listing without posting twice. */
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  requestKey!: string;

  @IsOptional() @IsIn(['cash_in', 'cash_out']) type?: 'cash_in' | 'cash_out';
  @Transform(({ value }) => Number(value)) @IsNumber() amount!: number;
  @IsString() @MaxLength(500) note!: string;
  @IsOptional() @IsString() @MaxLength(100) managerPin?: string;
}
