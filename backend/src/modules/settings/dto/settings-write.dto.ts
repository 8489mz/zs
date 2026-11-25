/*
 * New file: backend/src/modules/settings/dto/settings-write.dto.ts
 *
 * D7 (INV-DTO-SETTINGS-22): DTO classes for the 12 settings write
 * sites that took inline object types or `any` (daily digest config,
 * offline releases simulate/apply/passcode/create, demo-data
 * clear/wipe/reset/wipe-catalog, cloud backup config, WhatsApp
 * config, CSV import rows). Every field is caller-verified against
 * the real frontend caller (see dto-settings.spec.ts).
 *
 * Notes:
 * - DailyDigestConfigDto / CloudBackupConfigDto / WhatsAppConfigDto
 *   are all-optional: the controllers take Partial<Config> and the
 *   services merge only the fields present.
 * - ApplyLocalUpdateDto.version + patchUrl are REQUIRED (the service
 *   throws 'version and patchUrl are required'); changelog and
 *   passcode are optional (the caller sends passcode '' when there
 *   is none). CreateOfflineReleaseDto.version + patchUrl are
 *   REQUIRED (the service throws); changelog is optional (service
 *   `?? ''`).
 * - SetReleasePasscodeDto.passcode is REQUIRED (the service throws
 *   'passcode مطلوب' on an empty one).
 * - ClearDemoDataDto.password is OPTIONAL: the service only checks
 *   a password for super_admin AND a password present; an admin or
 *   owner clears without one. WipeDemoDataDto / ResetStockBalancesDto
 *   / WipeCatalogProductsDto passwords are REQUIRED: their services
 *   throw PASSWORD_REQUIRED on an empty password (D5 precedent).
 * - WhatsAppConfigDto.webhookSecret has NO @MinLength: the masked
 *   '••••••••' placeholder (8 chars) is explicitly skipped by the
 *   service — a min-length would 400 the save whenever the user
 *   does not change the secret. token is string-only for the same
 *   reason. provider is the SERVICE whitelist (sendRawMessage
 *   handles exactly ultramsg / greenapi / custom_webhook).
 * - CloudBackupConfigDto.lastBackupStatus is exactly the values
 *   the service ever writes ('', 'success', 'failed').
 *   retentionDays has NO @Min: the service coerces with
 *   Number(... || 30), so 0 means 30 — the DTO must not 400 it.
 * - ImportRowsDto.rows is an unknown array: the importers validate
 *   each row themselves; the DTO only pins that rows is an array.
 * - Booleans under enableImplicitConversion: the string "false"
 *   converts to boolean true (pinned in the spec, not fixed).
 */

import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class DailyDigestConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  timeOfDay?: string;

  @IsOptional()
  @IsBoolean()
  includeSales?: boolean;

  @IsOptional()
  @IsBoolean()
  includeTransfers?: boolean;

  @IsOptional()
  @IsBoolean()
  includeShortages?: boolean;

  @IsOptional()
  @IsNumber()
  mainWarehouseId?: number;

  @IsOptional()
  @IsNumber()
  shopLocationId?: number;
}

export class SimulateUpdateDto {
  @IsOptional()
  @IsString()
  fromVersion?: string;

  @IsOptional()
  @IsString()
  targetVersion?: string;

  @IsOptional()
  @IsString()
  passcode?: string;
}

export class ApplyLocalUpdateDto {
  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsString()
  @IsNotEmpty()
  patchUrl!: string;

  @IsOptional()
  @IsString()
  changelog?: string;

  @IsOptional()
  @IsString()
  passcode?: string;
}

export class SetReleasePasscodeDto {
  @IsString()
  @IsNotEmpty()
  passcode!: string;
}

export class CreateOfflineReleaseDto {
  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsOptional()
  @IsString()
  changelog?: string;

  @IsString()
  @IsNotEmpty()
  patchUrl!: string;

  @IsOptional()
  @IsString()
  passcode?: string;

  @IsOptional()
  @IsBoolean()
  requiresPasscode?: boolean;
}

export class ClearDemoDataDto {
  @IsOptional()
  @IsString()
  password?: string;
}

export class WipeDemoDataDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class ResetStockBalancesDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class WipeCatalogProductsDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class CloudBackupConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  bucket?: string;

  @IsOptional()
  @IsString()
  accessKeyId?: string;

  @IsOptional()
  @IsString()
  secretAccessKey?: string;

  @IsOptional()
  @IsNumber()
  retentionDays?: number;

  @IsOptional()
  @IsString()
  lastBackupAt?: string;

  @IsOptional()
  @IsEnum(['success', 'failed', ''])
  lastBackupStatus?: 'success' | 'failed' | '';

  @IsOptional()
  @IsString()
  lastError?: string;
}

export class WhatsAppConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(['ultramsg', 'greenapi', 'custom_webhook'])
  provider?: 'ultramsg' | 'greenapi' | 'custom_webhook';

  @IsOptional()
  @IsString()
  apiUrl?: string;

  @IsOptional()
  @IsString()
  instanceId?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsBoolean()
  autoSendInvoice?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSendOnlineOrder?: boolean;

  @IsOptional()
  @IsString()
  invoiceTemplate?: string;

  @IsOptional()
  @IsBoolean()
  aiBotEnabled?: boolean;

  @IsOptional()
  @IsString()
  aiBotPrompt?: string;

  @IsOptional()
  @IsString()
  aiBotWelcomeMessage?: string;

  @IsOptional()
  @IsBoolean()
  aiBotOffHoursOnly?: boolean;
}

export class ImportRowsDto {
  @IsOptional()
  @IsArray()
  rows?: unknown[];
}
