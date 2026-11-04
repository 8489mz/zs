import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, MaxLength, MinLength, ValidateNested } from 'class-validator';

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
}

export class CreateOnlineOrderDto {
  @MinLength(2, { message: 'اسم المستلم يجب ألا يقل عن حرفين' })
  @IsString({ message: 'اسم المستلم يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'يرجى إدخال اسم المستلم' })
  customerName!: string;

  @Matches(/^[+]?[0-9]{7,16}$/, { message: 'يرجى إدخال رقم هاتف صحيح (بين 7 إلى 16 رقماً)' })
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصاً' })
  @IsNotEmpty({ message: 'يرجى إدخال رقم الهاتف' })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[^0-9+]/g, '').trim() : value))
  customerPhone!: string;

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

