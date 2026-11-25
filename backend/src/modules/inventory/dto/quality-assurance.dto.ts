import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateQCPointDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsEnum(['receipt', 'manufacturing', 'delivery', 'internal'])
  triggerStage!: 'receipt' | 'manufacturing' | 'delivery' | 'internal';

  @IsEnum(['pass_fail', 'measure', 'checklist'])
  testType!: 'pass_fail' | 'measure' | 'checklist';

  @IsOptional()
  @IsNumber()
  normMeasureMin?: number;

  @IsOptional()
  @IsNumber()
  normMeasureMax?: number;

  @IsOptional()
  @IsString()
  measureUnit?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;
}

export class CreateQCInspectionDto {
  @IsOptional()
  @IsString()
  pointId?: string;

  @IsEnum(['goods_receipt', 'work_order', 'delivery', 'adhoc'])
  referenceDocType!: 'goods_receipt' | 'work_order' | 'delivery' | 'adhoc';

  @IsString()
  referenceDocId!: string;

  @IsNumber()
  productId!: number;

  @IsNumber()
  @Min(0.0001)
  inspectedQty!: number;

  @IsNumber()
  @Min(0)
  acceptedQty!: number;

  @IsNumber()
  @Min(0)
  rejectedQty!: number;

  @IsOptional()
  @IsNumber()
  measuredValue?: number;

  @IsOptional()
  @IsBoolean()
  passed?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  autoCreateNcrOnFail?: boolean;
}

export class CreateNCRDto {
  @IsOptional()
  @IsString()
  inspectionId?: string;

  @IsNumber()
  productId!: number;

  @IsString()
  defectDescription!: string;

  @IsEnum(['minor', 'major', 'critical'])
  severity!: 'minor' | 'major' | 'critical';

  @IsOptional()
  @IsString()
  rootCause?: string;

  @IsEnum(['quarantine_scrap', 'return_to_vendor', 'rework', 'concession_accept'])
  dispositionAction!: 'quarantine_scrap' | 'return_to_vendor' | 'rework' | 'concession_accept';

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

export class UpdateNCRStatusDto {
  @IsEnum(['open', 'investigating', 'resolved', 'closed'])
  status!: 'open' | 'investigating' | 'resolved' | 'closed';

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
