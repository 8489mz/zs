import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

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
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => CloseOperationDetailDto) @Transform(({ value }) => Array.isArray(value) ? value : []) cardDetails?: CloseOperationDetailDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => CloseOperationDetailDto) @Transform(({ value }) => Array.isArray(value) ? value : []) walletDetails?: CloseOperationDetailDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => CloseOperationDetailDto) @Transform(({ value }) => Array.isArray(value) ? value : []) instapayDetails?: CloseOperationDetailDto[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsString() @MaxLength(100) managerPin!: string;
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I21): the second approver's
   * secret, required when |variance| is over the shortage-tolerance
   * cap. Verified by account password (a manager/admin other than
   * the closer) — the shared manager PIN carries no identity, so
   * it cannot prove a second person and is rejected for this use.
   */
  @IsOptional() @IsString() @MaxLength(100) approverSecret?: string;
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I20): override for a close
   * blocked by open tables / draft sales. Same identity rule as
   * approverSecret, plus a reason of at least 10 characters,
   * stamped into close_note.
   * INV-SHIFT-CLOSE-HANDOVER-NOTE-REASON: the reason may also
   * live in the closing note (note) — the server falls back to
   * it — and an admin/super_admin closer needs no second
   * manager's secret at all.
   */
  @IsOptional() @IsString() @MaxLength(100) openTablesOverrideSecret?: string;
  @IsOptional() @IsString() @MaxLength(500) openTablesOverrideReason?: string;
}
