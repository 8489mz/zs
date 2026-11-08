import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export class UpsertTradeInDto {
  @IsNotEmpty({ message: 'اسم البائع / العميل مطلوب' })
  @IsString()
  sellerName!: string;

  @IsNotEmpty({ message: 'رقم هاتف البائع مطلوب' })
  @IsString()
  sellerPhone!: string;

  @IsNotEmpty({ message: 'الرقم القومي للبائع مطلوب للتوثيق الأمني' })
  @IsString()
  sellerNationalId!: string;

  @IsOptional()
  @IsString()
  deviceBrand?: string;

  @IsNotEmpty({ message: 'موديل الجهاز مطلوب' })
  @IsString()
  deviceModel!: string;

  @IsNotEmpty({ message: 'رقم السيريال / IMEI مطلوب' })
  @IsString()
  serialNumber!: string;

  @IsOptional()
  @IsString()
  imei2?: string;

  @IsOptional()
  @IsString()
  deviceConditionState?: 'new_sealed' | 'like_new' | 'used' | 'for_parts';

  @IsOptional()
  @IsString()
  deviceConditionNotes?: string;

  @IsNotEmpty({ message: 'سعر الشراء المتفق عليه مطلوب' })
  @IsNumber()
  @Min(0)
  agreedPurchasePrice!: number;

  @IsOptional()
  @IsString()
  @IsIn(['cash_purchase', 'exchange_trade_in'], { message: 'نوع عملية الاستبدال غير مدعوم' })
  transactionType?: 'cash_purchase' | 'exchange_trade_in';

  @IsOptional()
  @IsNumber()
  createdProductId?: number;

  @IsOptional()
  @IsBoolean()
  autoAddToInventory?: boolean;

  @IsOptional()
  @IsNumber()
  resalePrice?: number;

  // An exchange settles against the new-device sale, so it must name
  // it; a cash purchase keeps sale_id optional (client-supplied link).
  @ValidateIf((o: UpsertTradeInDto) => o.transactionType === 'exchange_trade_in')
  @IsNumber()
  @Min(1, { message: 'ربط الاستبدال بفاتورة بيع مطلوب' })
  saleId?: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  signatureData?: string;

  @IsOptional()
  @IsNumber()
  branchId?: number;

  @IsOptional()
  @IsNumber()
  locationId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
