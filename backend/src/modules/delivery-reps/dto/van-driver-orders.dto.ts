import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CountedStockDto, PerDayCashDto } from './van-trips.dto';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): driver order / trip / sale DTOs.
 * Ranges mirror the service throws exactly, and the service stays
 * the backstop for every cross-field rule:
 * - executeSale items carry NO min-size and NO Min on qty: the
 *   service never throws on an empty list and SKIPS qty <= 0 lines.
 *   unitPrice / lineDiscount carry no Min either (lineDiscount is
 *   clamped with Math.max(0, ...) in the service; unitPrice is
 *   resolved by the service against the system-authorized price).
 *   CREDIT_REQUIRES_CUSTOMER stays in the service.
 * - submitFieldReturn.saleId is REQUIRED even though the controller
 *   type marks it optional: the service throws
 *   RETURN_REQUIRES_SALE_ID without it, and the real caller always
 *   sends it. Its items carry ArrayMinSize(1) (EMPTY_RETURN_ITEMS),
 *   qty IsPositive (INVALID_RETURN_QTY), unitPrice Min(0)
 *   (INVALID_RETURN_PRICE).
 * - recordCollection.amount is IsPositive (INVALID_AMOUNT for <= 0);
 *   the tenant money-digits precision check stays in the service.
 * - executeDamagedSwap has NO tripId in the body: the caller passes
 *   tripId as the URL param only. damagedQty / replacementQty are
 *   IsPositive (INVALID_QUANTITY).
 * - settleTrip keeps supervisorPin / supervisorOverridePin optional
 *   even though the slice throws SETTLEMENT_REQUIRES_SUPERVISOR_PIN
 *   when a PIN is required and missing — the DTO must preserve that
 *   403 instead of turning it into a 400. chargeStockVarianceToRep
 *   stays an optional boolean so older phone builds keep sending it
 *   without a 400 (INV-VAN-SELF-SETTLE-PIN-REQUIRED: the service
 *   ignores a driver-supplied value; the rep never decides whether
 *   his own shortage is charged or waived).
 * - submitTripSettlement has NO frontend caller in the tree; its DTO
 *   mirrors the controller type exactly (no countedStock, no
 *   supervisor PIN fields, no activeVisitCustomerId).
 */
export class OpenTripItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsNumber()
  qty!: number;
}

export class OpenTripDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  sourceWarehouseId?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpenTripItemDto)
  items?: OpenTripItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  startOdometer?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  vehicleId?: number;
}

export class SettleTripDriverDto {
  @IsInt()
  @Min(1)
  tripId!: number;

  @IsNumber()
  countedCash!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerDayCashDto)
  perDayCash?: PerDayCashDto[];

  @IsOptional()
  @IsNumber()
  endOdometer?: number;

  @IsBoolean()
  unloadRemainingToWarehouse!: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountedStockDto)
  countedStock?: CountedStockDto[];

  @IsOptional()
  @IsBoolean()
  chargeStockVarianceToRep?: boolean;

  @IsOptional()
  @IsBoolean()
  nightStockApproved?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  activeVisitCustomerId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  supervisorPin?: string;

  @IsOptional()
  @IsString()
  supervisorOverridePin?: string;
}

export class SubmitTripSettlementDto {
  @IsInt()
  @Min(1)
  tripId!: number;

  @IsNumber()
  countedCash!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PerDayCashDto)
  perDayCash?: PerDayCashDto[];

  @IsOptional()
  @IsNumber()
  endOdometer?: number;

  @IsBoolean()
  unloadRemainingToWarehouse!: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ExecuteSaleItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsNumber()
  qty!: number;

  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @IsOptional()
  @IsString()
  unitName?: string;

  @IsOptional()
  @IsNumber()
  unitMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  isBonus?: boolean;

  @IsOptional()
  @IsString()
  bonusReason?: string;

  @IsOptional()
  @IsNumber()
  originalPrice?: number;

  @IsOptional()
  @IsNumber()
  lineDiscount?: number;
}

export class PackagingBreakdownDto {
  @IsOptional()
  @IsNumber()
  cartonsCount?: number;

  @IsOptional()
  @IsNumber()
  piecesCount?: number;

  @IsOptional()
  @IsNumber()
  itemsCount?: number;
}

export class ExecuteSaleDto {
  @IsInt()
  @Min(1)
  tripId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsIn(['cash', 'credit', 'card', 'split', 'instapay', 'vodafone_cash'])
  paymentMethod!: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExecuteSaleItemDto)
  items!: ExecuteSaleItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  deliveryGpsLat?: number;

  @IsOptional()
  @IsNumber()
  deliveryGpsLng?: number;

  @IsOptional()
  @IsIn(['timeout', 'denied', 'unavailable'])
  gpsMissingReason?: 'timeout' | 'denied' | 'unavailable';

  @IsOptional()
  @IsString()
  deliveryProofPhoto?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PackagingBreakdownDto)
  packagingBreakdown?: PackagingBreakdownDto;

  @IsOptional()
  @IsString()
  clientTxId?: string;

  @IsOptional()
  @IsNumber()
  cashDiscountAmount?: number;

  @IsOptional()
  @IsString()
  supervisorOverridePin?: string;

  @IsOptional()
  @IsString()
  supervisorOverrideReason?: string;

  @IsOptional()
  @IsString()
  transferReference?: string;

  @IsOptional()
  @IsString()
  transferReceiptUrl?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  recipientRole?: string;

  @IsOptional()
  @IsString()
  recipientSignature?: string;

  @IsOptional()
  @IsString()
  offlineCreatedAt?: string;
}

export class RecordCollectionDto {
  @IsInt()
  @Min(1)
  tripId!: number;

  @IsInt()
  @Min(1)
  customerId!: number;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsIn(['cash', 'instapay', 'vodafone_cash', 'bank_transfer'])
  paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';

  @IsOptional()
  @IsString()
  transferReference?: string;

  @IsOptional()
  @IsString()
  transferReceiptUrl?: string;

  @IsOptional()
  @IsString()
  supervisorOverridePin?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  gpsLng?: number;

  @IsOptional()
  @IsString()
  clientTxId?: string;

  @IsOptional()
  @IsString()
  offlineCreatedAt?: string;
}

export class ExecuteDamagedSwapDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number;

  @IsInt()
  @Min(1)
  damagedProductId!: number;

  @IsNumber()
  @IsPositive()
  damagedQty!: number;

  @IsOptional()
  @IsString()
  damageReason?: string;

  @IsInt()
  @Min(1)
  replacementProductId!: number;

  @IsNumber()
  @IsPositive()
  replacementQty!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  clientTxId?: string;
}

export class FieldReturnItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsNumber()
  @IsPositive()
  qty!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  saleItemId?: number;

  @IsOptional()
  @IsNumber()
  unitMultiplier?: number;

  @IsOptional()
  @IsString()
  unitName?: string;
}

export class SubmitFieldReturnDto {
  @IsInt()
  @Min(1)
  tripId!: number;

  @IsInt()
  @Min(1)
  customerId!: number;

  @IsInt()
  @Min(1)
  saleId!: number;

  @IsIn(['damaged', 'expired', 'manufacturing_defect', 'stagnant', 'order_mismatch', 'customer_request'])
  returnReason!: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';

  @IsOptional()
  @IsIn(['credit', 'cash'])
  refundMethod?: 'credit' | 'cash';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FieldReturnItemDto)
  items!: FieldReturnItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  offlineCreatedAt?: string;
}
