/*
 * D10 — gcc-shipping settings write DTO (new file; 1 site).
 *
 * Caller trap (verified against gcc-shipping.api.ts at 7413c4f3e):
 * saveSettings sends a Partial<GccShippingSettings> and the service
 * merges each provided key — EVERY field is optional.
 */
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class SaveGccShippingSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(['aramex', 'smsa'])
  activeCarrier?: 'aramex' | 'smsa';

  @IsOptional()
  @IsEnum(['sandbox', 'production'])
  environment?: 'sandbox' | 'production';

  @IsOptional()
  @IsString()
  aramexAccountNumber?: string;

  @IsOptional()
  @IsString()
  aramexAccountPin?: string;

  @IsOptional()
  @IsString()
  aramexAccountEntity?: string;

  @IsOptional()
  @IsString()
  aramexCountryCode?: string;

  @IsOptional()
  @IsString()
  aramexUserName?: string;

  @IsOptional()
  @IsString()
  aramexPassword?: string;

  @IsOptional()
  @IsString()
  smsaPassKey?: string;

  @IsOptional()
  @IsString()
  smsaCustomsCurrency?: string;

  @IsOptional()
  @IsString()
  pickupBusinessName?: string;

  @IsOptional()
  @IsString()
  pickupContactPerson?: string;

  @IsOptional()
  @IsString()
  pickupPhone?: string;

  @IsOptional()
  @IsString()
  pickupCountry?: string;

  @IsOptional()
  @IsString()
  pickupCity?: string;

  @IsOptional()
  @IsString()
  pickupAddress?: string;
}
