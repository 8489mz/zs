/*
 * D9 — HR biometric write DTOs (new file; the 3 interface DTOs live
 * IN PLACE in biometric-attendance.service.ts per Rule 5).
 *
 * Caller traps (verified against hr.api.ts + BiometricDevicesAndPinsTabs
 * at eba4e59d1):
 * - AssignEmployeeBiometricPinDto.biometricPin accepts missing/null/
 *   string — the service does body?.biometricPin ?? null (null clears).
 * - BulkCreateEmployeesDto.items is OPTIONAL (the service tolerates
 *   missing — body?.items || []), though the only caller always sends it.
 */
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class AssignEmployeeBiometricPinDto {
  @IsOptional()
  @IsString()
  biometricPin?: string;
}

export class CreateEmployeeFromBiometricPinDto {
  @IsString()
  pin!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class BulkCreateEmployeeItemDto {
  @IsString()
  pin!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class BulkCreateEmployeesDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkCreateEmployeeItemDto)
  items?: BulkCreateEmployeeItemDto[];
}

/*
 * D9 — the three device/log DTOs are converted from interfaces to
 * classes, MOVED here from biometric-attendance.service.ts: the
 * service file was 982 lines at HEAD and the decorated classes
 * would push it past the 1110 cutoff, so the in-place form
 * (Rule 5) is kept only for the other D9 interfaces, whose
 * files stay under cap. The service imports these classes back.
 * Caller traps (verified against the BiometricIntegrationModal +
 * BiometricDevicesAndPinsTabs callers at eba4e59d1):
 * - deviceBrand/status are the interface enums (the form sends only
 *   those values); port has NO Min/Max (the service clamps 1-65535);
 *   commKey has NO MinLength (masked '....' handling — D7 precedent).
 * - Preview: EVERY field optional (the service defaults all of them);
 *   fromDate/toDate accept null (the modal sends null when the scope
 *   is not custom). syncScope stays a PLAIN STRING (the service
 *   defaults an unknown scope to 'since_last' — D8 precedent).
 * - Import: rawText REQUIRED (interface + caller agree); deviceSerial
 *   is NEVER sent by the caller (interface-only, service defaults
 *   'file_import'). minSessionMinutes is NEVER sent either (service
 *   defaults 10). columnMapping is built ONLY from the 7 mapping keys.
 */
export class BiometricColumnMappingDto {
  @IsOptional()
  @IsNumber()
  pinColIndex?: number;

  @IsOptional()
  @IsNumber()
  dateTimeColIndex?: number;

  @IsOptional()
  @IsNumber()
  dateColIndex?: number;

  @IsOptional()
  @IsNumber()
  checkInTimeColIndex?: number;

  @IsOptional()
  @IsNumber()
  checkOutTimeColIndex?: number;

  @IsOptional()
  @IsNumber()
  directionColIndex?: number;

  @IsOptional()
  @IsBoolean()
  hasHeaderRow?: boolean | null;
}

export class UpsertBiometricDeviceDto {
  @IsString()
  deviceName!: string;

  @IsString()
  serialNumber!: string;

  @IsOptional()
  @IsEnum(['zkteco', 'hikvision', 'dahua', 'generic'])
  deviceBrand?: 'zkteco' | 'hikvision' | 'dahua' | 'generic';

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsNumber()
  port?: number;

  @IsOptional()
  @IsString()
  commKey?: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsString()
  notes?: string;
}

export type BiometricSyncScope = 'since_last' | 'open_month' | 'custom';

export class PreviewBiometricLogDto {
  @IsOptional()
  @IsString()
  rawText?: string;

  @IsOptional()
  @IsString()
  base64UserDat?: string;

  @IsOptional()
  @IsNumber()
  debounceMinutes?: number;

  @IsOptional()
  @IsNumber()
  minSessionMinutes?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BiometricColumnMappingDto)
  columnMapping?: BiometricColumnMappingDto;

  @IsOptional()
  @IsString()
  syncScope?: BiometricSyncScope;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}

export class ImportBiometricLogDto {
  @IsString()
  rawText!: string;

  @IsOptional()
  @IsNumber()
  debounceMinutes?: number;

  @IsOptional()
  @IsNumber()
  minSessionMinutes?: number;

  @IsOptional()
  @IsBoolean()
  onlyOpenPayrollMonth?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => BiometricColumnMappingDto)
  columnMapping?: BiometricColumnMappingDto;

  @IsOptional()
  @IsBoolean()
  autoCreateEmployees?: boolean;

  @IsOptional()
  @IsBoolean()
  stageUnmatched?: boolean;

  @IsOptional()
  @IsString()
  deviceSerial?: string;

  @IsOptional()
  @IsString()
  syncScope?: BiometricSyncScope;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}
