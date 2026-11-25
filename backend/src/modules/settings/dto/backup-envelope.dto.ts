import { IsArray, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class BackupMetaDto {
  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  exportedAt?: string;

  // Legacy snake_case key — normalizeEnvelope reads exported_at too.
  @IsOptional()
  @IsString()
  exported_at?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;
}

export class BackupEnvelopeDto {
  @IsOptional()
  @IsString()
  confirmation?: string;

  @IsOptional()
  @IsString()
  restoreConfirmation?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BackupMetaDto)
  meta?: BackupMetaDto;

  @IsOptional()
  @IsObject()
  tables?: Record<string, unknown[]>;
}
