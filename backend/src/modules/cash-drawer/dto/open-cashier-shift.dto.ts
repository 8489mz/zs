import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class OpenCashierShiftDto {
  @IsOptional() @Transform(({ value }) => (value == null || value === '' ? 0 : Number(value))) @IsNumber() @Min(0) openingCash?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value))) @IsNumber() branchId?: number;
  @IsOptional() @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value))) @IsNumber() locationId?: number;
  @IsOptional() @IsString() @MaxLength(100) password?: string;
  @IsOptional() @IsString() @MaxLength(100) managerPin?: string;
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I24): the POS station code
   * (e.g. T4A2, persistent per browser). One open shift per
   * branch+terminal; a sale carrying this code attributes to this
   * shift even when posted by another login. Never the EDC
   * card-terminal id (sales.terminal_id) — that is a different
   * device and is null on cash sales.
   */
  @IsOptional() @IsString() @MaxLength(32) terminalCode?: string;
}

