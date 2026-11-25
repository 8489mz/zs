import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  IsIn,
  IsPositive,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomsBrokerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  licenseNo?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsArray()
  customsPorts?: string[];

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsString()
  commercialRegistry?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class DisburseBrokerAdvanceDto {
  @IsString()
  brokerId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  advanceNo!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amountEgp!: number;

  @IsOptional()
  @IsString()
  disbursementDate?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class LiquidateBrokerExpenseDto {
  @IsString()
  brokerId!: string;

  @IsOptional()
  @IsString()
  advanceId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  receiptNo!: string;

  @IsOptional()
  @IsString()
  expenseDate?: string;

  @IsIn(['customs_duty', 'vat', 'port_fees', 'demurrage', 'inspection', 'broker_fee', 'transport', 'other'])
  category!: 'customs_duty' | 'vat' | 'port_fees' | 'demurrage' | 'inspection' | 'broker_fee' | 'transport' | 'other';

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amountEgp!: number;

  @IsOptional()
  @IsBoolean()
  isCapitalized?: boolean;

  @IsOptional()
  @IsBoolean()
  isRefundableVat?: boolean;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordContainerDepositDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  shipmentId!: string;

  @IsString()
  containerNo!: string;

  @IsString()
  shippingLine!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  depositAmountEgp!: number;

  @IsOptional()
  @IsString()
  paymentDate?: string;

  @IsString()
  expectedReturnDate!: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // I6-E: optional client idempotency key (<= 128 chars). When the
  // caller sends one it is stored and a retry with the same key
  // returns the existing deposit instead of recording twice. When
  // absent the service derives the key from the natural key
  // (shipment + container), which is already unique per tenant —
  // so the live form (which sends exactly the DTO fields and no
  // key) is retry-safe today without a frontend change, and a
  // future frontend change can send a per-submit key.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class RecordContainerReturnRefundDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsString()
  actualReturnDate!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  refundedAmountEgp!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deductionsAmountEgp?: number;

  @IsOptional()
  @IsString()
  deductionReason?: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
