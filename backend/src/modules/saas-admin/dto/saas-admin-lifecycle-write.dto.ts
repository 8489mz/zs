/*
 * D10 — saas-admin lifecycle write DTOs (new file; 4 sites).
 *
 * Caller traps (verified against saas-admin.api.ts at 7413c4f3e):
 * - DeleteTenantDto / WipeTenantDataDto: superAdminPassword is REQUIRED
 *   and NON-EMPTY (the service verifies it in production; the frontend
 *   always sends it).
 * - ExitImpersonationDto: originalSessionId is REQUIRED and NON-EMPTY
 *   (the service throws BadRequest when it is missing/blank; the
 *   frontend always sends it).
 * - SeedTenantDemoDto: ALL fields optional (activityType defaults to
 *   'supermarket'; no whitelist found).
 */
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DeleteTenantDto {
  @IsString()
  @IsNotEmpty()
  superAdminPassword!: string;
}

export class ExitImpersonationDto {
  // The service trims and throws on a blank id, so the pipe trims too.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  originalSessionId!: string;
}

export class SeedTenantDemoDto {
  @IsOptional()
  @IsString()
  activityType?: string;

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

export class WipeTenantDataDto {
  @IsString()
  @IsNotEmpty()
  superAdminPassword!: string;
}
