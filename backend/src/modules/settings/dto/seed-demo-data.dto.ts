/*
 * New file: backend/src/modules/settings/dto/seed-demo-data.dto.ts
 *
 * D7 (INV-DTO-SETTINGS-22): the SeedDemoDataDto interface (was in
 * services/demo-data/settings-demo-data-shared.ts) becomes a
 * decorated class so the real global requestValidationPipe validates
 * the POST /api/admin/demo-data/seed body. The shared file
 * re-exports this class, so the service imports are unchanged.
 *
 * Caller verification (three frontend callers, all objects): the
 * wizard sends all 5 fields; the sandbox card sends { password }
 * only; the onboarding banner sends { activityType, password: '' }.
 * The service defaults every field, so all 5 are optional. The
 * service's bare-string form (password-only) has NO live caller
 * and the DTO does not accept a string body.
 */

import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SeedDemoDataDto {
  @IsOptional()
  @IsString()
  activityType?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsBoolean()
  wipeExisting?: boolean;

  @IsOptional()
  @IsBoolean()
  seedSales?: boolean;

  @IsOptional()
  @IsBoolean()
  seedOnlineOrders?: boolean;
}
