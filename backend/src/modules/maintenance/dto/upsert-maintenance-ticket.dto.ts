import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertMaintenanceTicketDto {
  @IsOptional()
  @IsNumber()
  customerId?: number;

  @IsNotEmpty({ message: 'اسم العميل مطلوب' })
  @IsString()
  customerName!: string;

  @IsNotEmpty({ message: 'رقم هاتف العميل مطلوب' })
  @IsString()
  customerPhone!: string;

  @IsOptional()
  @IsString()
  deviceBrand?: string;

  @IsNotEmpty({ message: 'نوع وموديل الجهاز مطلوب' })
  @IsString()
  deviceModel!: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  passcode?: string;

  @IsNotEmpty({ message: 'وصف العطل مطلوب' })
  @IsString()
  problemDescription!: string;

  @IsOptional()
  @IsString()
  deviceCondition?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  finalCost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  advancePayment?: number;

  @IsOptional()
  @IsString()
  @IsIn(['received', 'inspecting', 'in_progress', 'waiting_parts', 'repaired', 'delivered', 'unrepairable', 'cancelled'], { message: 'حالة التذكرة غير صالحة' })
  status?: 'received' | 'inspecting' | 'in_progress' | 'waiting_parts' | 'repaired' | 'delivered' | 'unrepairable' | 'cancelled';

  @IsOptional()
  @IsNumber()
  technicianId?: number;

  @IsOptional()
  @IsString()
  technicianName?: string;

  @IsOptional()
  @IsString()
  technicianNotes?: string;

  @IsOptional()
  @IsNumber()
  branchId?: number;

  @IsOptional()
  @IsNumber()
  locationId?: number;

  @IsOptional()
  @IsNumber()
  warrantyDays?: number;
}
