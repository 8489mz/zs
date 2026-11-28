import { IsString, IsNumber, IsOptional, Min, IsPositive, IsNotEmpty, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateContainerPreorderDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  shipmentId!: string;

  @IsString()
  customerId!: string;

  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  reservedQuantity!: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  unitPriceEgp!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  depositAmountEgp?: number;

  @IsOptional()
  @IsString()
  depositTreasuryAccountId?: string;

  @IsOptional()
  @IsString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // I6-E: optional client idempotency key (<= 128 chars). When the
  // caller sends one it is stored and a retry with the same key
  // returns the existing reservation instead of recording twice.
  // When absent the service derives the key from the reservation
  // identity (shipment + customer + product + qty + price +
  // deposit) — a retry sends the identical payload so it replays,
  // while a genuinely different reservation gets a different key.
  // Known limit: two intentionally identical reservations with no
  // client key are indistinguishable from a retry and the second
  // returns the first; sending a client key removes the ambiguity.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ConvertPreorderToSaleDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  branchId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  locationId?: number;
}

export class RefundImportPreorderDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amountEgp!: number;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  treasuryAccountId?: string;
}

export class RecordFxAcquisitionDto {
  @IsString()
  currency!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  foreignAmount!: number;

  // INV-IMPORT-FX-TREASURY-LIVE-RATE (I4-D7): the EGP cost is the
  // RESULT of the live rate (foreignAmount x live rate), never its
  // source — so it is optional. When omitted the service derives it
  // from the live-resolved rate; when supplied it must agree with
  // the live rate within one piastre or the acquisition rejects.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  egpCost?: number;

  // INV-IMPORT-FX-TREASURY-LIVE-RATE (I4-D7): a supplied rate is an
  // echo, never a source — the service re-resolves the live rate and
  // rejects a supplied rate that disagrees with it (0.0001).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  acquisitionDate?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** EGP source (cash/bank) account the EGP was paid from. Defaults via the bank resolver; must differ from the destination account. */
  @IsOptional()
  @IsString()
  sourceAccountId?: string;

  /** Foreign transfer (supplier payment id) this acquisition funds. The transfer's currency must match the acquisition currency. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  transferId?: number;

  /** Optional idempotency key (service-level key path): a caller that sends a key owns the retry identity — a retry with the same key returns the original acquisition with no second row. A caller that sends no key gets pass-through, exactly as before: two identical FX buys with no key are legitimate distinct operations, so no server-derived key exists here. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
