import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

/*
 * D8 (INV-DTO-STOREFRONT-14): DTO classes for the storefront-public
 * controller's @Body sites. Every field below is caller-verified
 * against the real frontend caller (storefront.api.ts) and against
 * the SERVICE whitelist, not the controller type — see
 * dto-storefront.spec.ts for the per-field evidence.
 *
 * - ValidateCouponDto: the caller sends { code, subtotal } — both
 *   required (interface + caller).
 * - QuoteCartDto: the service TOLERATES missing/empty items (it
 *   returns a zero quote), so items is OPTIONAL. productId is
 *   `number | string` in the type; the DTO narrows to number (D5
 *   cashierShiftId precedent): a numeric string coerces, a
 *   non-numeric one 400s (no real caller sends one; cart ids are
 *   numeric). fulfillmentType is delivery|pickup|dine_in — the
 *   FRONTEND type is wider than the backend facade type
 *   (delivery|pickup); the service treats non-'pickup' as
 *   not-pickup, so 'dine_in' must pass.
 * - MockPayDto: the caller sends payload || {} — both fields
 *   optional; an empty {} passes.
 * - PayTableBillDto: every field optional. NOTE: the service throws
 *   ServiceUnavailable unconditionally today ("الدفع الإلكتروني
 *   لفاتورة الطاولة غير متاح حالياً") — every call 503s. The DTO
 *   only validates shape; the 503 behavior is unchanged.
 * - The 5 payment/marketplace webhook `any` sites stay `any` (new
 *   pinned exclusions): their payload shape is defined by the
 *   provider, outside the repo, and signature verification reads
 *   the raw body or concatenated provider fields.
 */

export class ValidateCouponDto {
  @IsString()
  code!: string;

  @IsNumber()
  subtotal!: number;
}

export class QuoteCartItemDto {
  /* Narrowed from `number | string` (D5 precedent): a numeric
   * string coerces to a number; a non-numeric one 400s. */
  @IsNumber()
  productId!: number;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsString()
  variantName?: string | null;
}

export class QuoteCartDto {
  /* Optional: the service returns a zero quote for missing/empty
   * items — D5 service-tolerance precedent. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteCartItemDto)
  items?: QuoteCartItemDto[];

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsNumber()
  deliveryZoneId?: number;

  @IsOptional()
  @IsString()
  deliveryZoneName?: string;

  /* delivery|pickup|dine_in: the FRONTEND type is wider than the
   * backend facade type (delivery|pickup). */
  @IsOptional()
  @IsEnum(['delivery', 'pickup', 'dine_in'])
  fulfillmentType?: 'delivery' | 'pickup' | 'dine_in';

  @IsOptional()
  @IsEnum(['delivery', 'dine_in'])
  orderType?: 'delivery' | 'dine_in';

  @IsOptional()
  @IsString()
  tableNumber?: string;
}

export class MockPayDto {
  @IsOptional()
  @IsString()
  cardNumber?: string;

  @IsOptional()
  @IsString()
  cardHolder?: string;
}

export class PayTableBillDto {
  @IsOptional()
  @IsNumber()
  tipAmount?: number;

  /* Plain string, no enum: the service ignores the field entirely
   * (it throws ServiceUnavailable before reading the DTO). */
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  guestName?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;
}
