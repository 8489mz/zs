import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateMaterialEscalationStatusDto {
  @IsString()
  @IsIn(['draft', 'submitted_to_client', 'approved_by_consultant', 'settled_in_ipc', 'rejected'])
  status!: 'draft' | 'submitted_to_client' | 'approved_by_consultant' | 'settled_in_ipc' | 'rejected';

  @IsString()
  @IsOptional()
  ipcInvoiceId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 12. Subcontractor Back-Charges DTOs
export class CreateSubcontractorBackchargeDto {
  @IsString()
  @IsNotEmpty()
  subcontractId!: string;

  @IsString()
  @IsOptional()
  beneficiarySubcontractId?: string;

  @IsString()
  @IsIn(['damage_rework', 'safety_fine', 'equipment_usage', 'material_supplied', 'site_cleanup', 'other'])
  backchargeCategory!:
    'damage_rework' | 'safety_fine' | 'equipment_usage' | 'material_supplied' | 'site_cleanup' | 'other';

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsOptional()
  occurrenceDate?: string;
}

export class UpdateBackchargeStatusDto {
  @IsString()
  @IsIn(['pending_approval', 'applied_to_deduction', 'waived'])
  status!: 'pending_approval' | 'applied_to_deduction' | 'waived';

  @IsString()
  @IsOptional()
  appliedIpcInvoiceId?: string;
}

// 13. Equipment Fuel & Operating Meter Logs DTOs
export class CreateEquipmentFuelLogDto {
  @IsString()
  @IsOptional()
  equipmentId?: string;

  @IsString()
  @IsNotEmpty()
  equipmentName!: string;

  @IsString()
  @IsOptional()
  logDate?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  startMeterHours?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  endMeterHours?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  fuelLitersAdded?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  fuelCostTotal?: number;

  @IsString()
  @IsOptional()
  driverOperatorName?: string;

  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 12. Subcontractor Management & Ledger DTOs
export class CreateSubcontractorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  tradeSpecialty?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  taxNumber?: string;

  @IsString()
  @IsOptional()
  commercialReg?: string;

  @IsString()
  @IsOptional()
  nationalId?: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankIban?: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  rating?: number;

  @IsString()
  @IsIn(['active', 'suspended', 'blacklisted'])
  @IsOptional()
  status?: 'active' | 'suspended' | 'blacklisted';

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateSubcontractorDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  tradeSpecialty?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  mobile?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  taxNumber?: string;

  @IsString()
  @IsOptional()
  commercialReg?: string;

  @IsString()
  @IsOptional()
  nationalId?: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankIban?: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  rating?: number;

  @IsString()
  @IsIn(['active', 'suspended', 'blacklisted'])
  @IsOptional()
  status?: 'active' | 'suspended' | 'blacklisted';

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateSubcontractorPaymentDto {
  @IsString()
  @IsNotEmpty()
  requestKey!: string;

  @IsNumber()
  subcontractorId!: number;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsString()
  @IsOptional()
  invoiceId?: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  paymentDate?: string;

  @IsString()
  @IsIn(['cash', 'bank_transfer', 'check'])
  @IsOptional()
  paymentMethod?: 'cash' | 'bank_transfer' | 'check';

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isAdvancePayment?: boolean;

  @IsString()
  @IsIn(['advance', 'progress', 'retention', 'operational_advance'])
  @IsOptional()
  paymentCategory?: 'advance' | 'progress' | 'retention' | 'operational_advance';
}
