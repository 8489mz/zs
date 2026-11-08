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

  // Structured diagnosis + quoted cost, recorded by the technician
  // during 'inspecting' through this same status-update call. Kept
  // separate from free-text technicianNotes: diagnosis is the
  // technician's finding, quotedCost the price the customer is asked
  // to approve before repair starts (review P2-5).
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quotedCost?: number;

  // Explicit staff-recorded customer approval of the quote. There is
  // no customer portal and no customer signature: staff record the
  // approval as quote_approved_at = now, quote_approved_by = the
  // authenticated user. Never inferred from a status change — the
  // flag must be sent on the call.
  @IsOptional()
  @IsBoolean()
  approveQuote?: boolean;

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
