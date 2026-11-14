import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

/* INV-SUPPLIER-NONSTOCK-BILL: a bill for things that never touch stock.
 * Each line is free text (what the supplier brought) + the chart account
 * the amount belongs to (expense or asset) + the amount. The total is
 * derived server-side from the lines; the client never sends a total. */
export class CreateSupplierBillLineDto {
  @IsString()
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  accountId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class CreateSupplierBillDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  supplierId!: number;

  /* Optional business day of the bill (YYYY-MM-DD). Absent: the server
   * tenant day. Present: validated against the tenant-day window
   * ([today-7d, today], the clock-P6 client-date bounds) — never trusted
   * from the client clock beyond that parse. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  billDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierBillLineDto)
  lines!: CreateSupplierBillLineDto[];
}
