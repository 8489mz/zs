import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateQcInspectionDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  stage!: string;

  @IsString()
  inspectionDate!: string;

  @IsOptional()
  @IsString()
  inspectorName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sampleSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  passedQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  failedQuantity?: number;

  @IsOptional()
  @IsString()
  defectNotes?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  reportFileUrl?: string;
}

export class UpsertAciComplianceDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsString()
  acidNumber!: string;

  @IsOptional()
  @IsString()
  acidIssueDate?: string;

  @IsOptional()
  @IsString()
  acidExpiryDate?: string;

  @IsOptional()
  @IsString()
  cargoxDocumentId?: string;

  @IsOptional()
  @IsString()
  importerTaxNumber?: string;

  @IsOptional()
  @IsString()
  exporterId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  complianceChecklist?: any;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSourcingTripDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  tripTitle!: string;

  @IsString()
  destinationCity!: string;

  @IsString()
  startDate!: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budgetEgp?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  actualCostEgp?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  findings?: any;
}

export class ProcessLateExpenseDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  lateExpenseAmount!: number;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  payableAccountId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  // INV-IMPORT-SUPPLIER-ATTRIBUTION: the explicit supplier this
  // late expense is owed to. Exactly one of supplierId /
  // unallocableReason must be supplied: a late expense is never
  // silently attributed to the goods supplier. When
  // unallocableReason is recorded, the credit posts to the
  // tenant-designated clearing account, labelled with the reason.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  unallocableReason?: string;
}

export class CalculateCustomsTaxDto {
  @IsString()
  hsCode!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cifValueEgp!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overrideDutyRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overrideVatRatePercent?: number;
}
