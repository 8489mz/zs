/*
 * D10 — bosta settings write DTO (new file; 1 site).
 *
 * Caller trap (verified against bosta.api.ts at 7413c4f3e): saveSettings
 * sends a Partial<BostaSettings> and the service merges each provided
 * key — EVERY field is optional. The apiKey '••••••••' placeholder is
 * skipped by the service, not by the pipe.
 */
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class SaveBostaSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(['sandbox', 'production'])
  environment?: 'sandbox' | 'production';

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  pickupBusinessName?: string;

  @IsOptional()
  @IsString()
  pickupPhone?: string;

  @IsOptional()
  @IsString()
  pickupCity?: string;

  @IsOptional()
  @IsString()
  pickupAddress?: string;
}
