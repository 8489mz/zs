import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSubcontractDto {
  @IsNumber()
  subcontractorId!: number;

  @IsString()
  @IsOptional()
  contractNumber?: string;

  @IsString()
  @IsOptional()
  contractType?: 'supply_and_apply' | 'labor_only' | 'supply_only' | 'labor_plus_consumables';

  @IsString()
  @IsNotEmpty()
  scopeOfWork!: string;

  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  retentionPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  advancePct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  advanceAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  advanceRecoveryStartPct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  advanceRecoveryEndPct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  retentionLimitPct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  penaltyPerDay?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  ldCapPct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  liabilityCapAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  whtRate?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  socialInsurancePct?: number;

  @IsString()
  @IsOptional()
  paymentLinkageMode?: 'independent' | 'pay_when_paid' | 'pay_when_certified';

  @IsInt()
  @Min(0)
  @IsOptional()
  paymentTermsDays?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  tailReservePct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  wastageAllowancePct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  mosAdmissiblePct?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  mosCapPct?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  dlpMonths?: number;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateDailyLogDto {
  @IsString()
  @IsNotEmpty()
  logDate!: string;

  @IsString()
  @IsOptional()
  weatherConditions?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  laborCount?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  subcontractorLaborCount?: number;

  @IsString()
  @IsOptional()
  equipmentOnSite?: string;

  @IsString()
  @IsNotEmpty()
  workPerformed!: string;

  @IsString()
  @IsOptional()
  delaysOrObstacles?: string;

  @IsString()
  @IsOptional()
  materialsReceived?: string;
}

export class CreateRfiDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  question!: string;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsString()
  @IsOptional()
  dateRequired?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AnswerRfiDto {
  @IsString()
  @IsNotEmpty()
  answer!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
