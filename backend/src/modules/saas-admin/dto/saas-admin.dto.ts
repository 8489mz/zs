import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  IsNumber,
  IsNotEmpty,
  IsBoolean,
  ValidateNested,
} from 'class-validator';

export class ListSaasTenantsQueryDto {
  @IsOptional()
  @IsIn(['trial', 'active', 'expired', 'suspended'])
  status?: 'trial' | 'active' | 'expired' | 'suspended';

  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateTrialTenantDto {
  @IsString()
  slug!: string;

  @IsString()
  businessName!: string;

  @IsOptional()
  @IsString()
  branchName?: string;

  @IsString()
  ownerName!: string;

  @IsString()
  ownerPhone!: string;

  @IsString()
  @IsEmail()
  ownerEmail!: string;

  @IsOptional()
  @IsString()
  activityType?: string;

  @IsOptional()
  @IsString()
  businessIndustry?: string;

  @IsString()
  username!: string;

  @IsOptional()
  @IsString()
  password?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  campaign?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  featurePlanId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  saasPlanId?: number;
}

export class ExtendTrialDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days!: number;
}

export class TenantStatusActionDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ResetOwnerPasswordDto {
  @IsOptional()
  @IsString()
  newPassword?: string;
}

export class ActivateTenantDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  planId?: number;

  @IsOptional()
  @Type(() => Number)
  paymentAmount?: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths?: number;
}

export class RenewTenantDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @Type(() => Number)
  @IsInt()
  planId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  durationMonths!: number;

  @IsOptional()
  @Type(() => Number)
  paymentAmount?: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}

export class CreateSaasPlanDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  price!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  billingPeriodMonths!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxUsers?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxBranches?: number;

  @IsOptional()
  @IsString()
  featurePlanId?: string;
}

export class RecordPaymentDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @Type(() => Number)
  amount!: number;

  @IsString()
  currency!: string;

  @IsString()
  method!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  date?: string;
}

export class FeatureOverrideDto {
  // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): one super-admin per-tenant
  // feature override. granted true = grant (feature ON over the mode
  // default), false = hide (feature OFF over the plan default),
  // null = remove the override (back to the profile/plan default).
  @IsString()
  @IsNotEmpty()
  featureCode!: string;

  @IsOptional()
  @IsBoolean()
  granted?: boolean | null;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateTenantPlanDto {
  @IsOptional()
  @IsString()
  planId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  extraFeatures?: string[];

  @IsOptional()
  @IsString()
  activityType?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureOverrideDto)
  featureOverrides?: FeatureOverrideDto[];
}

export class UpdateSaasPlanDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  billingPeriodMonths?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxUsers?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maxBranches?: number;

  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsOptional()
  @IsString()
  featurePlanId?: string;
}

export class UpdateTenantSlugDto {
  @IsString()
  @IsNotEmpty({ message: 'معرف النسخة الجديد مطلوب' })
  slug!: string;
}
