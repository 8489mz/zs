import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): driver field-work DTOs.
 * - CreateDriverCustomerDto.metadata is an opaque object (the real
 *   caller sends district / route / visit_days / visit_day / gpsLat /
 *   gpsLng / locationUrl inside it, and the service reads those keys
 *   and spreads the object — only the object shape is validated).
 * - RecordFieldVisitDto.negativeReason is a 6-value enum, required
 *   exactly when visitType is 'negative' (ValidateIf): the service
 *   throws MISSING_NEGATIVE_REASON on that combination and stores the
 *   reason verbatim otherwise.
 * - RecordTripExpenseDto / RecordPackagingMovementDto carry the
 *   tripId body echo the caller always sends (the URL param stays
 *   authoritative — the service merges the URL tripId over the body).
 *   expense amount is IsPositive (INVALID_EXPENSE_AMOUNT for <= 0);
 *   packaging quantities carry no Min (the service clamps negatives
 *   to 0 and throws EMPTY_PACKAGING_QTY only when both are 0).
 * - EvaluateCartPromotionsDto.cartItems is an opaque array: the
 *   engine's CartItemInput shape is not validated, only that it is
 *   an array (the D2 serials precedent).
 * - RecordVisitInventoryDto items carry productId REQUIRED: the real
 *   caller sends a row number (idx + 1) per item even though the
 *   service never reads it (it stores the items as JSON).
 * - CreateTransferDto items carry ArrayMinSize(1) (EMPTY_ITEMS); the
 *   per-item qty carries no Min — the service SKIPS qty <= 0 lines.
 */
export class CreateDriverCustomerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visitDays?: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RecordFieldVisitDto {
  @IsInt()
  @Min(1)
  tripId!: number;

  @IsInt()
  @Min(1)
  customerId!: number;

  @IsIn(['positive', 'negative'])
  visitType!: 'positive' | 'negative';

  @IsOptional()
  @IsInt()
  @Min(1)
  saleId?: number;

  @ValidateIf((o) => o.visitType === 'negative')
  @IsIn(['no_cash', 'shop_closed', 'sufficient_stock', 'item_unavailable', 'postponed', 'other'])
  negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';

  @IsOptional()
  @IsString()
  postponedToDate?: string;

  @IsOptional()
  @IsNumber()
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  gpsLng?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class TransferItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsNumber()
  qty!: number;
}

export class CreateTransferDto {
  @IsInt()
  @Min(1)
  toRepId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  fromTripId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  toTripId?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordTripExpenseDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  tripId?: number;

  @IsString()
  expenseType!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  receiptPhotoUrl?: string;

  @IsOptional()
  @IsString()
  supervisorOverridePin?: string;
}

export class RecordPackagingMovementDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  tripId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number;

  @IsString()
  packageType!: string;

  @IsNumber()
  deliveredQty!: number;

  @IsNumber()
  returnedQty!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class EvaluateCartPromotionsDto {
  @IsArray()
  cartItems!: unknown[];

  @IsOptional()
  @IsNumber()
  invoiceSubtotal?: number;

  @IsOptional()
  @IsString()
  customerType?: string;
}

export class OptimizeDriverRouteDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  customerIds?: number[];

  @IsOptional()
  @IsNumber()
  startLat?: number;

  @IsOptional()
  @IsNumber()
  startLng?: number;

  @IsOptional()
  @IsBoolean()
  persistSequence?: boolean;

  @IsOptional()
  @IsString()
  route?: string;
}

export class CheckInStoreVisitDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  tripId?: number;

  @IsInt()
  @Min(1)
  customerId!: number;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}

export class VisitInventoryItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsString()
  productName!: string;

  @IsNumber()
  qtyOnShelf!: number;

  @IsOptional()
  @IsString()
  expiryDate?: string | null;
}

export class RecordVisitInventoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitInventoryItemDto)
  items!: VisitInventoryItemDto[];
}

export class RecordVisitNoSaleDto {
  @IsString()
  @IsNotEmpty()
  noSaleReason!: string;

  @IsOptional()
  @IsString()
  noSaleNotes?: string;
}

export class CheckOutStoreVisitDto {
  @IsOptional()
  @IsBoolean()
  hasSale?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  saleId?: number;

  @IsOptional()
  @IsNumber()
  saleAmount?: number;

  @IsOptional()
  @IsBoolean()
  hasCollection?: boolean;

  @IsOptional()
  @IsNumber()
  collectionAmount?: number;
}

export class RecordTradeSurveyDto {
  @IsInt()
  @Min(1)
  customerId!: number;

  @IsIn(['cooler_inspection', 'asset_tracking', 'competitor_survey'])
  surveyType!: 'cooler_inspection' | 'asset_tracking' | 'competitor_survey';

  @IsOptional()
  @IsInt()
  @Min(1)
  tripId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  visitId?: number;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  assetName?: string;

  @IsOptional()
  @IsString()
  assetCondition?: string;

  @IsOptional()
  @IsBoolean()
  isPureCompanyProducts?: boolean;

  @IsOptional()
  @IsNumber()
  temperatureCelsius?: number;

  @IsOptional()
  @IsNumber()
  cleanlinessRating?: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  competitorName?: string;

  @IsOptional()
  @IsString()
  competitorProduct?: string;

  @IsOptional()
  @IsString()
  competitorOfferDetails?: string;

  @IsOptional()
  @IsNumber()
  competitorPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RecordBreadcrumbDto {
  @IsInt()
  @Min(1)
  tripId!: number;

  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsOptional()
  @IsNumber()
  speedKmh?: number;

  @IsOptional()
  @IsNumber()
  batteryLevel?: number;
}
