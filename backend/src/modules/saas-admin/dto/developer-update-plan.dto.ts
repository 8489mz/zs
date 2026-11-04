import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { ADMIN_MIN_PASSWORD_LENGTH } from '../../../core/auth/utils/password-policy';

export class DeveloperUpdatePlanDto {
  @IsString()
  masterPassword!: string;

  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsOptional()
  planId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  extraFeatures?: string[];
}

/**
 * Setting the developer master password. The 12-character admin floor
 * applies: this secret guards plan/package changes for every tenant.
 * It is deliberately NOT the super_admin login password.
 */
export class SetDeveloperMasterPasswordDto {
  @IsString()
  @MinLength(ADMIN_MIN_PASSWORD_LENGTH)
  newMasterPassword!: string;
}
