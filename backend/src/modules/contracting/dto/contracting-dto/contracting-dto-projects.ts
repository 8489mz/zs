import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  @IsIn([
    'planning',
    'draft',
    'submitted',
    'negotiation',
    'active',
    'suspended',
    'completed',
    'handed_over',
    'lost',
    'cancelled',
  ])
  status?:
    | 'planning'
    | 'draft'
    | 'submitted'
    | 'negotiation'
    | 'active'
    | 'suspended'
    | 'completed'
    | 'handed_over'
    | 'lost'
    | 'cancelled';

  @IsNumber()
  @IsOptional()
  clientId?: number;

  @IsString()
  @IsOptional()
  clientName?: string;

  @IsNumber()
  @Min(0)
  contractValue!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  downPaymentAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  retentionPercent?: number;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  expectedEndDate?: string;

  @IsNumber()
  @IsOptional()
  siteLocationId?: number;

  @IsNumber()
  @IsOptional()
  costCenterId?: number;

  @IsString()
  @IsOptional()
  projectManager?: string;

  @IsString()
  @IsOptional()
  locationAddress?: string;

  @IsString()
  @IsOptional()
  consultantName?: string;

  @IsString()
  @IsOptional()
  contractRef?: string;

  @IsString()
  @IsOptional()
  contractDate?: string;

  @IsString()
  @IsOptional()
  lossReason?: string;

  @IsString()
  @IsOptional()
  lossNotes?: string;

  @IsNumber()
  @IsOptional()
  competitorPrice?: number;

  @IsNumber()
  @IsOptional()
  revisionNumber?: number;

  @IsNumber()
  @IsOptional()
  originalTenderId?: number;

  @IsString()
  @IsOptional()
  submittedAt?: string;

  @IsString()
  @IsOptional()
  awardedAt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  clientId?: number;

  @IsString()
  @IsOptional()
  clientName?: string;

  @IsString()
  @IsOptional()
  @IsIn([
    'planning',
    'draft',
    'submitted',
    'negotiation',
    'active',
    'suspended',
    'completed',
    'handed_over',
    'lost',
    'cancelled',
  ])
  status?:
    | 'planning'
    | 'draft'
    | 'submitted'
    | 'negotiation'
    | 'active'
    | 'suspended'
    | 'completed'
    | 'handed_over'
    | 'lost'
    | 'cancelled';

  @IsNumber()
  @Min(0)
  @IsOptional()
  contractValue?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  downPaymentAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  retentionPercent?: number;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  expectedEndDate?: string;

  @IsString()
  @IsOptional()
  actualEndDate?: string;

  @IsNumber()
  @IsOptional()
  siteLocationId?: number;

  @IsNumber()
  @IsOptional()
  costCenterId?: number;

  @IsString()
  @IsOptional()
  projectManager?: string;

  @IsString()
  @IsOptional()
  locationAddress?: string;

  @IsString()
  @IsOptional()
  consultantName?: string;

  @IsString()
  @IsOptional()
  contractRef?: string;

  @IsString()
  @IsOptional()
  contractDate?: string;

  @IsString()
  @IsOptional()
  lossReason?: string;

  @IsString()
  @IsOptional()
  lossNotes?: string;

  @IsNumber()
  @IsOptional()
  competitorPrice?: number;

  @IsNumber()
  @IsOptional()
  revisionNumber?: number;

  @IsNumber()
  @IsOptional()
  originalTenderId?: number;

  @IsString()
  @IsOptional()
  submittedAt?: string;

  @IsString()
  @IsOptional()
  awardedAt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class MarkTenderLostDto {
  @IsString()
  @IsNotEmpty()
  lossReason!: string;

  @IsString()
  @IsOptional()
  lossNotes?: string;

  @IsNumber()
  @IsOptional()
  competitorPrice?: number;
}

export class AwardTenderDto {
  @IsString()
  @IsOptional()
  contractRef?: string;

  @IsString()
  @IsOptional()
  contractDate?: string;

  @IsNumber()
  @IsOptional()
  downPaymentAmount?: number;

  @IsNumber()
  @IsOptional()
  retentionPercent?: number;

  @IsString()
  @IsOptional()
  projectManager?: string;

  @IsString()
  @IsOptional()
  consultantName?: string;

  @IsString()
  @IsOptional()
  startDate?: string;
}
