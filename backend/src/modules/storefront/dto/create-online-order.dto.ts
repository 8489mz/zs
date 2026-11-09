import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/* INV-REST-KIOSK-MODIFIER-UI (R7-B1): one modifier picked on a kiosk line.
 * The shape mirrors the POS cart modifier (GroupModifierSelection in
 * group-modifier-mapping.ts) so the kiosk, the POS and the online-order →
 * sale conversion all speak the same modifier: optionId is the
 * pos_modifier_options row, productId is the option's linked stock
 * component (component_product_id) or, for a combo/bare mod, the component
 * product itself; price is the CLIENT's price and is never trusted — the
 * service re-prices it from server truth (R4-C contract). No @Min on
 * price on purpose: a negative client price on a mod with no configured
 * truth is the contract helper's 422 RESTAURANT_MODIFIER_PRICE_UNVERIFIED,
 * and a min here would mask that specific error as a generic 400. */
export class OnlineOrderItemModifierDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  optionId?: number;

  /* productId 0 is the POS "no stock component" sentinel
   * (buildGroupModifierSelection sets productId to
   * component_product_id || 0), so 0 is valid here — only
   * negatives are rejected. */
  @IsOptional()
  @IsInt()
  @Min(0)
  productId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  componentProductId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  groupId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  groupName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'كمية الإضافة يجب أن تكون 1 على الأقل' })
  qty?: number;

  @IsOptional()
  @IsBoolean()
  isComboComponent?: boolean;

  @IsOptional()
  @IsNumber()
  costPrice?: number;
}

export class OnlineOrderItemDto {
  @IsNumber()
  @IsPositive()
  productId!: number;

  @IsNumber()
  @IsPositive()
  @Max(1000, { message: 'الكمية المطلوبة للصنف الواحد لا تتجاوز 1000' })
  quantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Chosen variant (size/option) name; priced by the server from the product's metadata (SF-4). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  variantName?: string;

  /** Modifiers picked for this line (kiosk / storefront). Validated and
   * re-priced by the service from server truth (R4-C contract); a line
   * with no modifiers omits the field entirely. */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OnlineOrderItemModifierDto)
  @ArrayMaxSize(50, { message: 'عدد إضافات الصنف الواحد لا يتجاوز 50' })
  @IsArray()
  modifiers?: OnlineOrderItemModifierDto[];
}

export class CreateOnlineOrderDto {
  @MinLength(2, { message: 'اسم المستلم يجب ألا يقل عن حرفين' })
  @IsString({ message: 'اسم المستلم يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'يرجى إدخال اسم المستلم' })
  customerName!: string;

  // INV-REST-KIOSK-ORDER-TRUTH: a missing phone is allowed through the
  // DTO — the service itself decides where a phone is required: a
  // dine-in order needs none (the ticket has the table number; the
  // service skips phone validation there and stores ''), while a
  // takeaway/delivery order is still rejected by assertValidCustomerPhone.
  // A phone that IS sent is still validated by the pattern below.
  @IsOptional()
  @Matches(/^[+]?[0-9]{7,16}$/, { message: 'يرجى إدخال رقم هاتف صحيح (بين 7 إلى 16 رقماً)' })
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[^0-9+]/g, '').trim() : value))
  customerPhone?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  customerAddress?: string;

  @IsOptional()
  @IsString()
  customerNotes?: string;

  @ValidateNested({ each: true })
  @Type(() => OnlineOrderItemDto)
  @ArrayMaxSize(100, { message: 'عدد أصناف الطلب لا يتجاوز 100' })
  @ArrayMinSize(1, { message: 'يجب اختيار صنف واحد على الأقل لإتمام الطلب' })
  @IsArray({ message: 'يجب تحديد أصناف الطلب في قائمة صالحة' })
  @IsNotEmpty({ message: 'يجب تحديد أصناف الطلب' })
  items!: OnlineOrderItemDto[];

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsNumber()
  deliveryZoneId?: number;

  @IsOptional()
  @IsString()
  deliveryZoneName?: string;

  @IsOptional()
  @IsString()
  orderType?: string;

  @IsOptional()
  @IsString()
  tableNumber?: string;

  @IsOptional()
  @IsString()
  fulfillmentType?: 'delivery' | 'pickup' | 'dine_in';

  @IsOptional()
  @IsNumber()
  pickupBranchId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

