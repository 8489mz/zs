import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProformaInvoiceItemDto {
  // I1-P1: coerce a string id ("5") to a number so the PI item link
  // survives transport instead of failing IsNumber validation.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitPriceForeign?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  factoryPriceUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitPriceUsd?: number;

  @IsOptional()
  @IsString()
  hsCode?: string;
}

export class CreateProformaInvoiceDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  supplierId!: string;

  @IsString()
  piNumber!: string;

  @IsString()
  piDate!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmountForeign!: number;

  @IsOptional()
  @IsString()
  incoterm?: string;

  @IsOptional()
  @IsString()
  deliveryPort?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRateContract?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  advancePercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balancePercentage?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProformaInvoiceItemDto)
  items?: ProformaInvoiceItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
