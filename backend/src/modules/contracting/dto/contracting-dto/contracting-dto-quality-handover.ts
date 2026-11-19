import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateInspectionRequestDto {
  @IsString()
  @IsOptional()
  wirNumber?: string;

  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsString()
  @IsNotEmpty()
  locationGrid!: string;

  @IsString()
  @IsNotEmpty()
  tradeCategory!: string;

  @IsString()
  @IsOptional()
  inspectionType?: string;

  @IsString()
  @IsNotEmpty()
  scheduledDate!: string;

  @IsString()
  @IsOptional()
  consultantName?: string;

  @IsString()
  @IsOptional()
  consultantNotes?: string;

  @IsString()
  @IsOptional()
  attachments?: string;
}

export class UpdateInspectionRequestStatusDto {
  @IsString()
  @IsIn(['submitted', 'approved', 'approved_with_notes', 'rejected'])
  status!: 'submitted' | 'approved' | 'approved_with_notes' | 'rejected';

  @IsString()
  @IsOptional()
  consultantName?: string;

  @IsString()
  @IsOptional()
  consultantNotes?: string;
}

// 8. Snag Items & Punch List DTOs
export class CreateSnagItemDto {
  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsNotEmpty()
  itemTitle!: string;

  @IsString()
  @IsNotEmpty()
  locationDesc!: string;

  @IsString()
  @IsOptional()
  @IsIn(['minor', 'major', 'critical'])
  severity?: 'minor' | 'major' | 'critical';

  @IsString()
  @IsOptional()
  @IsIn(['internal', 'subcontractor'])
  responsibleParty?: 'internal' | 'subcontractor';

  @IsNumber()
  @IsOptional()
  subcontractorId?: number;

  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateSnagItemStatusDto {
  @IsString()
  @IsIn(['open', 'rectified', 'verified_closed'])
  status!: 'open' | 'rectified' | 'verified_closed';

  @IsString()
  @IsOptional()
  rectifiedDate?: string;

  @IsString()
  @IsOptional()
  verifiedBy?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 9. Project Handover DTOs
export class CreateProjectHandoverDto {
  @IsString()
  @IsIn(['preliminary', 'final'])
  handoverType!: 'preliminary' | 'final';

  @IsString()
  @IsNotEmpty()
  handoverDate!: string;

  @IsString()
  @IsNotEmpty()
  committeeMembers!: string;

  @IsString()
  @IsOptional()
  warrantyStartDate?: string;

  @IsString()
  @IsOptional()
  warrantyEndDate?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  retentionReleaseAmount?: number;

  @IsString()
  @IsOptional()
  certificateRef?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ApproveProjectHandoverDto {
  @IsString()
  @IsOptional()
  approvedBy?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// 10. Material & Shop Drawing Submittals DTOs
export class CreateSubmittalDto {
  @IsString()
  @IsIn(['material', 'shop_drawing', 'sample', 'method_statement'])
  submittalType!: 'material' | 'shop_drawing' | 'sample' | 'method_statement';

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  specificationSection?: string;

  @IsString()
  @IsOptional()
  supplierManufacturer?: string;

  @IsString()
  @IsOptional()
  boqItemId?: string;

  @IsString()
  @IsOptional()
  subcontractId?: string;

  @IsString()
  @IsOptional()
  submissionDate?: string;

  @IsString()
  @IsOptional()
  reviewDueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateSubmittalStatusDto {
  @IsString()
  @IsIn(['submitted', 'approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'])
  status!: 'submitted' | 'approved' | 'approved_as_noted' | 'revise_and_resubmit' | 'rejected';

  @IsString()
  @IsOptional()
  consultantName?: string;

  @IsString()
  @IsOptional()
  consultantComments?: string;

  @IsString()
  @IsOptional()
  consultantReviewDate?: string;
}

// 11. Material Price Escalation Claims DTOs
export class CreateMaterialEscalationDto {
  @IsString()
  @IsIn(['rebar_steel', 'portland_cement', 'ready_mix', 'bitumen', 'sand_gravel', 'other'])
  materialType!: 'rebar_steel' | 'portland_cement' | 'ready_mix' | 'bitumen' | 'sand_gravel' | 'other';

  @IsString()
  @IsNotEmpty()
  materialName!: string;

  @IsNumber()
  @Min(0)
  basePriceContract!: number;

  @IsNumber()
  @Min(0)
  currentMarketPrice!: number;

  @IsNumber()
  @Min(0)
  executedQuantity!: number;

  @IsString()
  @IsNotEmpty()
  unit!: string;

  @IsString()
  @IsOptional()
  bulletinSourceReference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
