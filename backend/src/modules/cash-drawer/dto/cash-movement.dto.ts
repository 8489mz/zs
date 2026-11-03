import { Transform } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CashMovementDto {
  /** Stable client-generated key; retries return the current listing without posting twice. */
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  requestKey!: string;

  @IsOptional() @IsIn(['cash_in', 'cash_out', 'safe_drop', 'safe_replenishment']) type?: 'cash_in' | 'cash_out' | 'safe_drop' | 'safe_replenishment';
  @Transform(({ value }) => Number(value)) @IsNumber() amount!: number;
  @IsString() @MaxLength(500) note!: string;
  @IsOptional() @IsString() @MaxLength(100) managerPin?: string;
  /** Caller-named counterpart cash/bank account for safe_drop / safe_replenishment transfers. Required for those types, ignored otherwise. */
  @IsOptional() @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value))) @IsNumber() counterpartAccountId?: number;
}
