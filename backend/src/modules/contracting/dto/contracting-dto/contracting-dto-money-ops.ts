import { IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateRetentionRecordDto {
  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsString()
  @IsIn(['client', 'subcontractor'])
  partyType!: 'client' | 'subcontractor';

  @IsNumber()
  @IsOptional()
  partyId?: number;

  @IsString()
  @IsNotEmpty()
  partyName!: string;

  @IsNumber()
  @Min(0)
  heldAmount!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  retentionPercent?: number;

  @IsString()
  @IsOptional()
  ipcInvoiceId?: string;

  @IsString()
  @IsOptional()
  releaseDueDate?: string;

  @IsString()
  @IsOptional()
  guaranteeCertificateRef?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReleaseRetentionDto {
  @IsNumber()
  @Min(0.001)
  releaseAmount!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreatePaymentHoldDto {
  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsString()
  @IsIn(['subcontractor', 'supplier'])
  partyType!: 'subcontractor' | 'supplier';

  @IsString()
  @IsNotEmpty()
  partyName!: string;

  @IsNumber()
  @Min(0.001)
  holdAmount!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsOptional()
  defectDescription?: string;
}

export class ReleasePaymentHoldDto {
  @IsString()
  @IsOptional()
  releaseNotes?: string;
}

export class CreateSupplierReturnDto {
  @IsString()
  @IsOptional()
  returnNumber?: string;

  @IsNumber()
  @IsOptional()
  supplierId?: number;

  @IsString()
  @IsNotEmpty()
  supplierName!: string;

  @IsString()
  @IsOptional()
  returnDate?: string;

  @IsArray()
  items!: any[];

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateLaborAttendanceDto {
  @IsString()
  @IsNotEmpty()
  workerName!: string;

  @IsString()
  @IsIn(['carpenter', 'blacksmith', 'mason', 'helper', 'operator', 'surveyor', 'electrician', 'plumber'])
  trade!: 'carpenter' | 'blacksmith' | 'mason' | 'helper' | 'operator' | 'surveyor' | 'electrician' | 'plumber';

  @IsString()
  @IsOptional()
  workDate?: string;

  @IsString()
  @IsOptional()
  shiftType?: string;

  @IsNumber()
  @Min(0.5)
  hoursWorked!: number;

  @IsString()
  @IsOptional()
  splitProjectId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  splitHours?: number;

  @IsNumber()
  @Min(0)
  dailyRate!: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreatePettyCashDto {
  @IsString()
  @IsNotEmpty()
  custodianName!: string;

  @IsString()
  @IsOptional()
  custodianRole?: string;

  @IsString()
  @IsOptional()
  disbursementNumber?: string;

  @IsNumber()
  @Min(1)
  amountGiven!: number;

  @IsString()
  @IsOptional()
  issueDate?: string;

  @IsString()
  @IsOptional()
  settlementDueDate?: string;
}

export class SettlePettyCashDto {
  @IsArray()
  receipts!: any[];

  @IsString()
  @IsOptional()
  closureNotes?: string;
}

export class CreateGovernmentLicenseDto {
  @IsString()
  @IsIn(['excavation', 'building', 'civil_defense', 'road_occupancy', 'environmental', 'other'])
  licenseType!: 'excavation' | 'building' | 'civil_defense' | 'road_occupancy' | 'environmental' | 'other';

  @IsString()
  @IsNotEmpty()
  licenseNumber!: string;

  @IsString()
  @IsNotEmpty()
  issuingAuthority!: string;

  @IsString()
  @IsOptional()
  issueDate?: string;

  @IsString()
  @IsNotEmpty()
  expiryDate!: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  feeAmount?: number;

  @IsString()
  @IsOptional()
  documentUrl?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  alertLeadDays?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
