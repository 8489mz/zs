import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export class SalePaymentDto {
  @IsIn(['cash', 'card', 'wallet', 'instapay'])
  paymentChannel!: 'cash' | 'card' | 'wallet' | 'instapay';

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;
}

class SaleItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  productId!: number;

  @IsOptional()
  @IsString()
  name?: string;

  @Type(() => Number)
  @IsNumber()
  // INV-EXCHANGE-APPROVAL-QUANTITIES: NO @Min here — the quantity
  // rule lives on UpsertSaleDto.items (SaleItemQtyConstraint). A
  // nested item cannot see its parent's exchangeSaleId, and an
  // exchange return line legitimately carries qty: -qty. Ordinary
  // items still need qty >= 0.001; the constraint enforces exactly
  // that, plus the exchange-return exception below.
  qty!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  originalSaleItemId?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  originalPrice?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  offerDiscount?: number;

  /**
   * Per-line TOTAL discount (INV-CONVERSION-LINE-DISCOUNTS-PRESERVED):
   * the amount subtracted from this line's gross total (qty x price),
   * not a per-unit amount. Order/quotation conversion sends it, and
   * the POS sends it too since INV-POS-LINE-DISCOUNT (per-line
   * discount on the cart line); a direct sale without a line discount
   * is unchanged. Deliberately
   * NOT named `discount`: conversion payloads historically sent a
   * per-item `discount` that normalizeSalePayload drops, and reusing
   * that name would silently change storefront/van conversions that
   * still send it.
   */
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  lineDiscount?: number;

  @IsOptional()
  @IsString()
  offerName?: string;

  @IsOptional()
  @IsString()
  unitName?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  unitMultiplier?: number;

  @IsOptional()
  @IsIn(['retail', 'wholesale', 'half_wholesale', 'credit'])
  priceType?: 'retail' | 'wholesale' | 'half_wholesale' | 'credit';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  modifiers?: any;

  @IsOptional()
  @IsArray()
  serials?: string[];
}

/**
 * INV-EXCHANGE-APPROVAL-QUANTITIES: which quantity failure, if any,
 * the sale items carry. 'min' — a line whose |qty| is below 0.001
 * (zero, or too small in either sign); 'exchange' — a negative line
 * whose exchange linkage is missing or malformed. null — every line
 * is fine: qty >= 0.001, or qty <= -0.001 on a sale carrying a valid
 * exchangeSaleId with a valid originalSaleItemId on that line.
 */
type SaleItemQtyFailure = 'min' | 'exchange';

function findInvalidSaleItemQty(items: unknown, exchangeSaleId: unknown): SaleItemQtyFailure | null {
  if (!Array.isArray(items)) return null; // @IsArray reports that
  const hasExchangeSource =
    typeof exchangeSaleId === 'number' && Number.isInteger(exchangeSaleId) && exchangeSaleId >= 1;
  for (const item of items) {
    const qty = (item as { qty?: unknown } | null)?.qty;
    if (typeof qty !== 'number' || Number.isNaN(qty)) return null; // @IsNumber reports that
    if (qty >= 0.001) continue;
    if (qty <= -0.001 && hasExchangeSource) {
      const originalId = (item as { originalSaleItemId?: unknown } | null)?.originalSaleItemId;
      if (typeof originalId === 'number' && Number.isInteger(originalId) && originalId >= 1) continue;
      return 'exchange';
    }
    return 'min';
  }
  return null;
}

@ValidatorConstraint({ name: 'saleItemQty', async: false })
class SaleItemQtyConstraint implements ValidatorConstraintInterface {
  validate(items: unknown, args: ValidationArguments): boolean {
    return findInvalidSaleItemQty(items, (args.object as { exchangeSaleId?: unknown } | null)?.exchangeSaleId) === null;
  }

  defaultMessage(args?: ValidationArguments): string {
    const failure = findInvalidSaleItemQty(
      args?.value,
      (args?.object as { exchangeSaleId?: unknown } | null)?.exchangeSaleId,
    );
    if (failure === 'exchange') {
      return 'السطور السالبة في الاستبدال تتطلب فاتورة أصلية وسطراً أصلياً مرتبطاً';
    }
    // The 'min' wording is byte-identical to the message the old
    // @Min(0.001) produced through the pipe (the pipe keeps Arabic
    // messages verbatim), so ordinary items see no change.
    return 'الحقل أصناف الطلب > الكمية يجب أن يكون أكبر من أو يساوي 0.001.';
  }
}

export class UpsertSaleDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  exchangeSaleId?: number;

  @IsOptional()
  @IsIn(['cash', 'card', 'store_credit'])
  exchangeRefundMethod?: 'cash' | 'card' | 'store_credit';

  @IsOptional()
  @IsString()
  offlineDocNo?: string;

  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I26): the offline sale's
   * original client timestamp (savedAt). createSale stores it as
   * created_at when valid, so the sale lands in the shift whose
   * window actually held it — never silently re-dated to sync
   * time. Rejected with OFFLINE_TIMESTAMP_INVALID when
   * unparseable, out of range, or in the future.
   */
  @IsOptional()
  @IsString()
  offlineCreatedAt?: string;

  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I24): the POS station code
   * (getPosTerminalCode, e.g. T4A2), stored on sales as
   * pos_terminal_code so a sale attributes to its station's shift.
   * Never the EDC card-terminal id (terminalId) — that is a
   * different device and is null on cash sales.
   */
  @IsOptional()
  @IsString()
  terminalCode?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  customerId?: number;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerAddress?: string;

  @IsOptional()
  @IsIn(['cash', 'credit'])
  paymentType?: 'cash' | 'credit';

  @IsOptional()
  @IsIn(['cash', 'card', 'wallet', 'instapay', 'mixed', 'credit'])
  paymentChannel?: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit';

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceCharge?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  tipAmount?: number;

  /**
   * R5-A (INV-REST-TOTALS-TRUTH-2, R-I53): the total the POS displayed
   * to the cashier. createSale cross-checks it against its own
   * recomputed total and rejects a drift over one minor unit with 422
   * SALE_TOTAL_MISMATCH. Optional — dashboard sales, order
   * conversions and offline sync never send it and skip the check.
   * Required here (not just on the normalized payload) because the
   * global validation pipe forbids non-whitelisted fields: without
   * this field every POS sale carrying it would 400 VALIDATION_ERROR.
   */
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedTotal?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(1)
  guestCount?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  storeCreditUsed?: number;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  loyaltyPointsRedeemed?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;

  @IsOptional()
  @IsString()
  editReason?: string;

  @IsOptional()
  @IsString()
  tableNumber?: string;

  @IsOptional()
  @IsString()
  orderType?: string;

  @Transform(({ value }: { value: unknown }) => (value && Number(value) > 0 ? Number(value) : undefined))
  @IsOptional()
  @IsNumber()
  @Min(1)
  deliveryRepId?: number;

  /**
   * O62: the storefront order this cart came from. The server reads that order and pre-approves the
   * terms it fixed at checkout (coupon discount, line prices), so a cashier without canDiscount is
   * not asked for a manager PIN — and cannot use it to grant a discount of their own: only the
   * stored order's numbers are approved.
   */
  @Transform(({ value }: { value: unknown }) => (value && Number(value) > 0 ? Number(value) : undefined))
  @IsOptional()
  @IsNumber()
  @Min(1)
  onlineOrderId?: number;

  @IsOptional()
  @IsString()
  deliveryStatus?: string;

  @Transform(({ value }: { value: unknown }) => (value ? String(value) : undefined))
  @IsOptional()
  @IsIn(['cod', 'prepaid_by_rep', 'prepaid_online'])
  collectionStatus?: 'cod' | 'prepaid_by_rep' | 'prepaid_online';

  @IsOptional()
  @IsIn(['freelance_courier', 'store_fleet'])
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet';

  @Transform(({ value }: { value: unknown }) => (value && Number(value) > 0 ? Number(value) : undefined))
  @IsOptional()
  @IsNumber()
  @Min(1)
  branchId?: number;

  @Transform(({ value }: { value: unknown }) => (value && Number(value) > 0 ? Number(value) : undefined))
  @IsOptional()
  @IsNumber()
  @Min(1)
  locationId?: number;

  @IsOptional()
  @IsIn(['pos', 'dashboard'])
  source?: 'pos' | 'dashboard';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  @Validate(SaleItemQtyConstraint)
  items!: SaleItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  @IsOptional()
  payments?: SalePaymentDto[];

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  tenderedAmount?: number;

  @IsOptional()
  @IsString()
  terminalId?: string;

  @IsOptional()
  @IsString()
  terminalAuthCode?: string;

  // INV-REST-PAID-GATES-2 (R4-D, I40): the amount the terminal
  // approved, sent by the POS so the server can pin the card leg to
  // it. Optional — a manual-auth-code path without an amount stays
  // unpinned (D-R4D-5).
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  terminalApprovedAmount?: number;

  @IsOptional()
  @IsString()
  terminalRrn?: string;

  @IsOptional()
  @IsString()
  cardScheme?: string;

  @IsOptional()
  @IsString()
  cardLastFour?: string;

  @IsOptional()
  @IsString()
  diningCourse?: string;

  @IsOptional()
  @IsString()
  pagerNumber?: string;
}

export type NormalizedSalePayload = {
  customerId: number | null;
  paymentType: 'cash' | 'credit';
  paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit';
  discount: number;
  deliveryFee: number;
  serviceCharge?: number;
  tipAmount?: number;
  expectedTotal?: number | null;
  guestCount?: number;
  taxRate: number;
  pricesIncludeTax: boolean;
  storeCreditUsed: number;
  loyaltyPointsRedeemed: number;
  note: string;
  managerPin: string;
  branchId: number | null;
  locationId: number | null;
  source: 'pos' | 'dashboard';
  items: Array<{
    productId: number;
    qty: number;
    price: number;
    originalPrice?: number;
    offerDiscount?: number;
    lineDiscount?: number;
    offerName?: string;
    unitName: string;
    unitMultiplier: number;
    priceType: 'retail' | 'wholesale' | 'half_wholesale' | 'credit';
    notes: string;
    modifiers: any;
    serials?: string[];
  }>;
  payments: Array<{ paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay'; amount: number }>;
  tenderedAmount: number;
  tableNumber: string | null;
  orderType: string | null;
  diningCourse?: string | null;
  pagerNumber?: string | null;
  deliveryRepId?: number;
  deliveryStatus?: string;
  collectionStatus?: 'cod' | 'prepaid_by_rep' | 'prepaid_online';
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet';
  terminalId?: string | null;
  terminalCode?: string | null;
  terminalAuthCode?: string | null;
  terminalApprovedAmount?: number | null;
  terminalRrn?: string | null;
  cardScheme?: string | null;
  cardLastFour?: string | null;
};

/**
 * Internal-only handoff from convertToSale to createSale
 * (INV-SALES-ORDER-CONVERSION-STOCK-LEGS). It is a plain type, never
 * a DTO field: an HTTP caller must never be able to ask createSale to
 * release an arbitrary order's reservation. Only the sales-orders
 * service builds it, and createSale honors it solely as its fourth
 * argument, inside the sale transaction, after verifying the order is
 * in the 'converting' state claimed by convertToSale.
 */
export interface SalesOrderConversionRelease {
  salesOrderId: number;
  branchId: number | null;
  locationId: number | null;
  items: Array<{ productId: number; qty: number }>;
}
