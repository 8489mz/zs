import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): delivery-reps settlement + dispatch
 * DTOs. Ranges mirror the service throws exactly: countedCashAmount
 * carries Min(0) because the service throws SETTLEMENT_AMOUNT_INVALID
 * for a finite negative amount; expectedAmount is required with Min(0)
 * because the service throws when it is missing, non-finite, or
 * negative. The dispatch id lists mirror the service validateIds
 * rule (array, at most 200, safe ints above 0, unique); the
 * both-empty rule (no saleIds and no onlineOrderIds) stays in the
 * service as backstop (DELIVERY_DISPATCH_EMPTY).
 */
export class SettleDeliveryOrderDto {
  @IsOptional()
  @IsString()
  signatureDataUrl?: string;

  @IsOptional()
  @IsString()
  proofPhotoUrl?: string;

  @IsOptional()
  @IsNumber()
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  gpsLng?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  countedCashAmount?: number;
}

export class SettleAllDeliveryOrdersDto {
  @IsNumber()
  @Min(0)
  expectedAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  countedCashAmount?: number;
}

export class DispatchDeliveryOrdersDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  saleIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  onlineOrderIds?: number[];

  @IsOptional()
  @IsString()
  notes?: string;
}
