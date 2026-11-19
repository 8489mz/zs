import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSiteMobilizationExpenseDto {
  @IsString()
  @IsNotEmpty()
  expenseCategory!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  expenseDate!: string;

  @IsString()
  @IsNotEmpty()
  paidTo!: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  referenceReceipt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 3. Labor Attendance DTOs
export class RecordLaborAttendanceRecordDto {
  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsNotEmpty()
  workerName!: string;

  @IsString()
  @IsNotEmpty()
  workerRole!: string;

  @IsString()
  @IsNotEmpty()
  attendanceDate!: string;

  @IsString()
  @IsOptional()
  status?: string;

  @IsNumber()
  @Min(0)
  dailyBaseWage!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  overtimeHours?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  overtimeRatePerHour?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  nightShiftAllowance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  bonusAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  deductionAmount?: number;

  @IsOptional()
  isPaid?: boolean;

  @IsString()
  @IsOptional()
  paymentBatchRef?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 4. Client Payment Milestones & In-Kind Barter DTOs
export class CreateClientPaymentMilestoneDto {
  @IsString()
  @IsNotEmpty()
  milestoneName!: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  requiredProgressPercent?: number;

  @IsNumber()
  @Min(0)
  scheduledAmount!: number;

  @IsString()
  @IsOptional()
  settlementType?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class RecordInKindBarterDeductionDto {
  @IsString()
  @IsNotEmpty()
  inKindUnitRef!: string;

  @IsNumber()
  @Min(1)
  inKindValuation!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 5. Equipment & Tools DTOs
export class CreateEquipmentAssetDto {
  @IsString()
  @IsNotEmpty()
  assetCode!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  currentProjectId?: string;

  @IsString()
  @IsOptional()
  currentLocationDesc?: string;

  @IsString()
  @IsOptional()
  assignedSupervisor?: string;

  @IsString()
  @IsOptional()
  operationalStatus?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  purchaseCost?: number;

  @IsString()
  @IsOptional()
  purchaseDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class TransferEquipmentAssetDto {
  @IsString()
  @IsNotEmpty()
  toProjectId!: string;

  @IsString()
  @IsOptional()
  transferDate?: string;

  @IsString()
  @IsNotEmpty()
  dispatchedBy!: string;

  @IsString()
  @IsNotEmpty()
  receivedBy!: string;

  @IsString()
  @IsOptional()
  conditionOnDispatch?: string;

  @IsString()
  @IsOptional()
  conditionOnReceipt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 6. Supplier Price Memory & Rating DTOs
export class RecordSupplierPriceMemoryDto {
  @IsNumber()
  @IsNotEmpty()
  supplierId!: number;

  @IsString()
  @IsNotEmpty()
  materialName!: string;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsNumber()
  @Min(0)
  lastUnitPrice!: number;

  @IsString()
  @IsOptional()
  lastPurchaseDate?: string;

  @IsString()
  @IsOptional()
  lastProjectId?: string;

  @IsString()
  @IsOptional()
  governorate?: string;

  @IsString()
  @IsOptional()
  paymentTerms?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  qualityRating?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  deliverySpeedRating?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 7. Work Inspection Requests (WIR) DTOs
