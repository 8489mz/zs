import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class CloseOperationDetailDto {
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class CloseCashierShiftDto {
  @Transform(({ value }) => Number(value)) @IsNumber() countedCash!: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) cardDeclaredTotal?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0) cardOperationCount?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) walletDeclaredTotal?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0) walletOperationCount?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsNumber() @Min(0) instapayDeclaredTotal?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0) instapayOperationCount?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CloseOperationDetailDto)
  @Transform(({ value }) => (Array.isArray(value) ? value : []))
  cardDetails?: CloseOperationDetailDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CloseOperationDetailDto)
  @Transform(({ value }) => (Array.isArray(value) ? value : []))
  walletDetails?: CloseOperationDetailDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CloseOperationDetailDto)
  @Transform(({ value }) => (Array.isArray(value) ? value : []))
  instapayDetails?: CloseOperationDetailDto[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsString() @MaxLength(100) managerPin!: string;
  /**
   * INV-SECOND-MANAGER-PASSWORD-REMOVED: legacy field, accepted
   * but IGNORED — no second-manager password is collected or
   * required when |variance| is over the shortage-tolerance cap;
   * any closer closes alone with a >=10-char note. Kept optional
   * so older clients sending it do not 400.
   */
  @IsOptional() @IsString() @MaxLength(100) approverSecret?: string;
  /**
   * INV-SECOND-MANAGER-PASSWORD-REMOVED: legacy field, accepted
   * but IGNORED — the open-tables override needs a >=10-char
   * reason only (openTablesOverrideReason, or the closing note —
   * INV-SHIFT-CLOSE-HANDOVER-NOTE-REASON). Kept optional so older
   * clients sending it do not 400.
   */
  @IsOptional() @IsString() @MaxLength(100) openTablesOverrideSecret?: string;
  @IsOptional() @IsString() @MaxLength(500) openTablesOverrideReason?: string;
}
