/*
 * D9 — mobile-attendance write DTOs (new file).
 *
 * Caller traps (verified against mobile-punch.api.ts at eba4e59d1):
 * - RecordPunchDto.type stays a PLAIN STRING, not an enum: the service
 *   branches on check_in and treats anything else as check_out (D8
 *   fulfillmentType precedent). latitude/longitude are type-only (the
 *   service owns the GPS range errors). selfieDataUrl/notes optional.
 * - SetEmployeePinDto.pinCode is presence-only: the service asserts
 *   min-4 + weak-pattern rules itself.
 */
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class MobilePunchLoginDto {
  @IsString()
  phone!: string;

  @IsString()
  pinCode!: string;

  @IsOptional()
  @IsString()
  companyCode?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class RecordPunchDto {
  @IsString()
  type!: 'check_in' | 'check_out';

  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsOptional()
  @IsString()
  selfieDataUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateBranchGeofenceDto {
  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsOptional()
  @IsNumber()
  geofenceRadiusMeters?: number;
}

export class SetEmployeePinDto {
  @IsString()
  pinCode!: string;
}
