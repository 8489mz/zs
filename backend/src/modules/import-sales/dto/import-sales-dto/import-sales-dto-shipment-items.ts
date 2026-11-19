import { IsString, IsNumber, IsOptional, Min, IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class AddShipmentItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  factoryUnitPriceUsd!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitCbm?: number;

  @IsOptional()
  @IsString()
  hsCode?: string;
}

export class UpdateShipmentItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  receivedQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetRetailMargin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetWholesaleMargin?: number;

  @IsOptional()
  @IsIn(['capitalize', 'expense'])
  shortageHandlingMethod?: 'capitalize' | 'expense';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitWeightKg?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unitCbm?: number;

  @IsOptional()
  @IsString()
  hsCode?: string;
}

export class RecordForeignTransferDto {
  @IsString()
  supplierId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amountEgp!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amountForeign!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  exchangeRateContract?: number;

  @IsOptional()
  @IsString()
  proformaInvoiceId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bankAccountId?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  transferDate?: string;

  @IsOptional()
  @IsString()
  approvalRequestId?: string;

  @IsOptional()
  @IsIn(['bank_transfer', 'cash_carried', 'letter_of_credit', 'cash_against_documents', 'open_account'])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @IsString()
  bankSwiftCode?: string;

  @IsOptional()
  @IsString()
  form4Number?: string;

  @IsOptional()
  @IsString()
  form4Date?: string;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @IsString()
  travelDate?: string;

  @IsOptional()
  @IsString()
  handoverReceiptNo?: string;

  @IsOptional()
  @IsString()
  lcNumber?: string;

  @IsOptional()
  @IsString()
  lcIssuingBank?: string;

  @IsOptional()
  @IsString()
  lcExpiryDate?: string;

  @IsOptional()
  @IsString()
  lcDocuments?: string;

  @IsOptional()
  @IsString()
  cadHandoverProof?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  paymentDueDate?: string;
}
