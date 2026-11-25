import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class VerifyBankDetailsDto {
  @IsOptional()
  @IsString()
  verificationNotes?: string;
}

export class CreateQuotationDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  supplierId!: string;

  @IsString()
  quotationNo!: string;

  @IsOptional()
  @IsString()
  inquiryDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  incoterm?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  itemName!: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPriceForeign!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  moq?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productionLeadDays?: number;

  @IsOptional()
  @IsString()
  portOfLoading?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedFreightUsd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimatedCustomsRatePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SelectQuotationDto {
  @IsOptional()
  @IsString()
  selectionReason?: string;
}

export class CreateSampleOrderDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  supplierId!: string;

  @IsString()
  sampleCode!: string;

  @IsString()
  itemName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sampleCostForeign?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  freightCostForeign?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  requestDate?: string;

  @IsOptional()
  @IsString()
  courierTrackingNo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateSampleOrderInspectionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qualityScore?: number;

  @IsOptional()
  @IsIn(['pending', 'approved_reference', 'rejected', 'rework_requested'])
  decision?: string;

  @IsOptional()
  @IsBoolean()
  referenceSampleApproved?: boolean;

  @IsOptional()
  @IsString()
  defectAnalysis?: string;

  @IsOptional()
  @IsArray()
  photoUrls?: string[];

  @IsOptional()
  @IsString()
  receivedDate?: string;
}

export class ConvertFeasibilityToProjectDto {
  @IsString()
  projectId!: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  targetPort?: string;

  @IsOptional()
  @IsNumber()
  advancePaymentPercentage?: number;
}
