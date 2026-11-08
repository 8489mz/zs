import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateTicketStatusDto {
  @IsNotEmpty({ message: 'حالة التذكرة مطلوبة' })
  @IsString()
  @IsIn(['received', 'inspecting', 'in_progress', 'waiting_parts', 'repaired', 'delivered', 'unrepairable', 'cancelled'], { message: 'حالة التذكرة غير صالحة' })
  status!: 'received' | 'inspecting' | 'in_progress' | 'waiting_parts' | 'repaired' | 'delivered' | 'unrepairable' | 'cancelled';

  @IsOptional()
  @IsNumber()
  @Min(0)
  finalCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  collectedAmount?: number;

  @IsOptional()
  @IsString()
  technicianNotes?: string;

  // Explicit client authorization: refund the original cash advance when
  // cancelling/unrepairable, after every issued spare part has been returned.
  @IsOptional()
  @IsBoolean()
  refundAdvance?: boolean;

  @IsOptional()
  @IsString()
  paymentMethod?: 'cash' | 'card' | 'wallet' | 'instapay';
}

export class AddTicketPartDto {
  @IsNotEmpty({ message: 'الصنف / قطعة الغيار مطلوبة' })
  @IsNumber()
  productId!: number;

  @IsNotEmpty({ message: 'اسم قطعة الغيار مطلوب' })
  @IsString()
  productName!: string;

  @IsNotEmpty({ message: 'الكمية مطلوبة' })
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsNotEmpty({ message: 'سعر بيع القطعة مطلوب' })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  locationId?: number;
}
