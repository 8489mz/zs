import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn } from 'class-validator';

export const VALID_JOB_DOC_TYPES = [
  'commercial_invoice',
  'packing_list',
  'certificate_of_origin',
  'form4_bank_swift',
  'ocean_bl_copy',
  'air_waybill_copy',
  'telex_release',
  'delivery_order',
  'customs_declaration',
  'inspection_cert',
  'insurance_cert',
  'other',
] as const;

export type JobDocType = (typeof VALID_JOB_DOC_TYPES)[number];

export class CreateJobDocumentDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_JOB_DOC_TYPES)
  docType!: JobDocType;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsNumber()
  @IsOptional()
  fileSizeBytes?: number;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
