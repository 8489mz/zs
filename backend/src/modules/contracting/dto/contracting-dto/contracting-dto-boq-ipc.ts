import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBoqItemDto {
  @IsString()
  @IsNotEmpty()
  itemCode!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  contractQty!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedUnitCost?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateBoqItemDto {
  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  contractQty?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedUnitCost?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateChangeOrderDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  @IsIn(['cost_only', 'time_only', 'cost_and_time'])
  impactType?: 'cost_only' | 'time_only' | 'cost_and_time';

  @IsNumber()
  costImpact!: number;

  @IsInt()
  @IsOptional()
  timeImpactDays?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateChangeOrderStatusDto {
  @IsString()
  @IsIn(['draft', 'pending_approval', 'approved', 'rejected'])
  status!: 'draft' | 'pending_approval' | 'approved' | 'rejected';

  @IsString()
  @IsOptional()
  notes?: string;
}

export class IpcItemInputDto {
  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  previousQty?: number;

  @IsNumber()
  @Min(0)
  currentQty!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  storedMaterialsQty?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  wirId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  claimedQty?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  certifiedQty?: number;

  @IsString()
  @IsOptional()
  varianceReason?: string;

  @IsString()
  @IsOptional()
  progressStage?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  stageWeightPct?: number;

  @IsString()
  @IsOptional()
  changeOrderId?: string;
}

export class CreateIpcInvoiceDto {
  @IsString()
  @IsOptional()
  @IsIn(['client', 'subcontractor'])
  ipcType?: 'client' | 'subcontractor';

  @IsNumber()
  @IsOptional()
  subcontractorId?: number;

  @IsString()
  @IsOptional()
  subcontractorName?: string;

  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  sequenceOrder?: number;

  @IsString()
  @IsOptional()
  periodStart?: string;

  @IsString()
  @IsOptional()
  periodEnd?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  advanceRecoveryPercent?: number;

  @IsBoolean()
  @IsOptional()
  advanceRecoveryOverride?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  retentionPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  otherDeductions?: number;

  @IsNumber()
  @IsOptional()
  grossWorkDoneAmount?: number;

  @IsNumber()
  @IsOptional()
  escalationAmount?: number;

  @IsNumber()
  @IsOptional()
  mosAddedAmount?: number;

  @IsNumber()
  @IsOptional()
  mosReleasedAmount?: number;

  @IsNumber()
  @IsOptional()
  backchargeAmount?: number;

  @IsNumber()
  @IsOptional()
  ldAmount?: number;

  @IsNumber()
  @IsOptional()
  materialExcessAmount?: number;

  @IsNumber()
  @IsOptional()
  sharedResourceAmount?: number;

  @IsNumber()
  @IsOptional()
  directPaymentAmount?: number;

  @IsNumber()
  @IsOptional()
  carriedForwardDebitIn?: number;

  @IsNumber()
  @IsOptional()
  whtAmount?: number;

  @IsNumber()
  @IsOptional()
  socialInsuranceAmount?: number;

  @IsNumber()
  @IsOptional()
  claimedAmount?: number;

  @IsNumber()
  @IsOptional()
  vatAmount?: number;

  @IsString()
  @IsOptional()
  certificationDueDate?: string;

  @IsString()
  @IsOptional()
  paymentDueDate?: string;

  @IsArray()
  @IsOptional()
  itemizedDeductions?: Array<{
    deductionType: string;
    sourceTable?: string;
    sourceId?: string;
    amount: number;
    vatTreatment?: string;
    debitNoteRef?: string;
    noticeRef?: string;
    description?: string;
  }>;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IpcItemInputDto)
  items!: IpcItemInputDto[];
}
