import { IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGuaranteeDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsNumber()
  @IsOptional()
  subcontractorId?: number;

  @IsString()
  @IsNotEmpty()
  guaranteeNumber!: string;

  @IsString()
  @IsIn(['advance_payment', 'performance', 'retention', 'maintenance', 'bid_bond'])
  guaranteeType!: 'advance_payment' | 'performance' | 'retention' | 'maintenance' | 'bid_bond';

  @IsString()
  @IsNotEmpty()
  issuingBank!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsNotEmpty()
  issueDate!: string;

  @IsString()
  @IsNotEmpty()
  expiryDate!: string;

  @IsString()
  @IsOptional()
  claimExpiryDate?: string;

  @IsOptional()
  reductionSchedule?: any;

  @IsString()
  @IsOptional()
  documentUrl?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateGuaranteeDto {
  @IsString()
  @IsOptional()
  issuingBank?: string;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  claimExpiryDate?: string;

  @IsOptional()
  reductionSchedule?: any;

  @IsString()
  @IsOptional()
  documentUrl?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ExtendGuaranteeDto {
  @IsString()
  @IsNotEmpty()
  newExpiryDate!: string;

  @IsString()
  @IsOptional()
  newClaimExpiryDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReleaseGuaranteeDto {
  @IsString()
  @IsNotEmpty()
  releaseDate!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class InvokeGuaranteeDto {
  @IsString()
  @IsNotEmpty()
  invocationDate!: string;

  @IsNumber()
  @Min(0.01)
  @IsOptional()
  invokedAmount?: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class CreateCostPoolDto {
  @IsString()
  @IsNotEmpty()
  poolCode!: string;

  @IsString()
  @IsNotEmpty()
  poolName!: string;

  @IsString()
  @IsNotEmpty()
  poolType!: 'labor_care' | 'labor_burden' | 'equipment_shared' | 'site_supervision' | 'custom';

  @IsString()
  @IsNotEmpty()
  driverType!: 'labor_days' | 'labor_cost' | 'equipment_hours' | 'direct_effort' | 'manual_ratio';

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateIndirectExpenseDto {
  @IsString()
  @IsNotEmpty()
  poolId!: string;

  @IsString()
  @IsNotEmpty()
  expenseTitle!: string;

  @IsNumber()
  @Min(0.01)
  grossAmount!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  recoveredAmount?: number;

  @IsString()
  @IsOptional()
  expenseDate?: string;

  @IsString()
  @IsOptional()
  voucherRef?: string;

  @IsString()
  @IsOptional()
  mobilizationExpenseId?: string;
}

export class CreateAllocationBatchDto {
  @IsString()
  @IsNotEmpty()
  periodStart!: string;

  @IsString()
  @IsNotEmpty()
  periodEnd!: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  deferredInAmount?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

// Document Register DTOs (Drawing/Document Control — Procore/Autodesk Build benchmark)
export class CreateContractingDocumentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  discipline?: string;

  @IsString()
  @IsIn(['drawing', 'specification', 'contract', 'correspondence', 'method_statement', 'other'])
  @IsOptional()
  docType?: 'drawing' | 'specification' | 'contract' | 'correspondence' | 'method_statement' | 'other';

  @IsString()
  @IsOptional()
  notes?: string;

  // First revision, created together with the document
  @IsString()
  @IsOptional()
  revCode?: string;

  @IsString()
  @IsOptional()
  fileRef?: string;
}

export class CreateContractingDocumentRevisionDto {
  @IsString()
  @IsNotEmpty()
  revCode!: string;

  @IsString()
  @IsOptional()
  fileRef?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateContractingDocumentRevisionStatusDto {
  @IsString()
  @IsIn(['for_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected', 'superseded'])
  reviewStatus!: 'for_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected' | 'superseded';

  @IsString()
  @IsOptional()
  reviewedBy?: string;

  @IsString()
  @IsOptional()
  reviewComments?: string;
}

export class DistributeContractingDocumentDto {
  @IsString()
  @IsNotEmpty()
  recipientName!: string;

  @IsString()
  @IsIn(['internal', 'consultant', 'owner', 'subcontractor', 'authority', 'other'])
  @IsOptional()
  recipientRole?: 'internal' | 'consultant' | 'owner' | 'subcontractor' | 'authority' | 'other';

  @IsString()
  @IsIn(['email', 'whatsapp', 'hand', 'portal', 'other'])
  @IsOptional()
  distributionMethod?: 'email' | 'whatsapp' | 'hand' | 'portal' | 'other';

  @IsString()
  @IsOptional()
  notes?: string;
}

// Meeting Minutes DTOs
export class MeetingAttendeeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  role?: string;
}

export class CreateMeetingMinuteDto {
  @IsString()
  @IsOptional()
  meetingType?: string;

  @IsString()
  @IsOptional()
  meetingDate?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeetingAttendeeDto)
  @IsOptional()
  attendees?: MeetingAttendeeDto[];

  @IsString()
  @IsOptional()
  agenda?: string;

  @IsString()
  @IsOptional()
  summary?: string;

  @IsString()
  @IsOptional()
  preparedBy?: string;
}

export class CreateMeetingActionItemDto {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsOptional()
  ownerName?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  linkedRfiId?: string;

  @IsString()
  @IsOptional()
  linkedChangeOrderId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
