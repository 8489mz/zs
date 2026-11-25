/*
 * D9 — payroll-policies update DTO (new file).
 *
 * Caller traps (verified against HrSettingsStaticSections.tsx at
 * eba4e59d1 — the statutory save sends the FULL 31-field object and
 * the attendance save spreads the whole GET config + 3 fields, so
 * the DTO's field set is the closure of both payloads):
 * - ALL 31 fields are OPTIONAL: the service heals country/date/
 *   reference/reviewed, then validates; {} passes when both features
 *   are off.
 * - The 3 vocabulary fields (statutoryCountry, taxableEarningsBasis,
 *   insuranceWageBasis) are PLAIN STRINGS: the service HEALS an
 *   invalid country and validates the other two only when the feature
 *   is enabled — an enum would 400 a payload the service heals/accepts.
 * - hrWeekendDays is a COMMA STRING ('friday,saturday'), NOT an array.
 * - hrSocialInsuranceEmployeePct is a legacy flat field NOT in
 *   HrStatutoryPolicy but sent by the caller and stored verbatim — it
 *   must be in the DTO or the save 400s (Package C trap).
 * - insuranceConfig nested DTO: all 4 fields optional numbers (the
 *   service enforces pcts only when insurance is enabled — the service
 *   is the backstop). taxBrackets nested: max optional nullable number,
 *   rate required number.
 */
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

export class InsuranceConfigDto {
  @IsOptional()
  @IsNumber()
  employeePct?: number;

  @IsOptional()
  @IsNumber()
  employerPct?: number;

  @IsOptional()
  @IsNumber()
  minSalary?: number;

  @IsOptional()
  @IsNumber()
  maxSalary?: number;
}

export class TaxBracketDto {
  @IsOptional()
  @IsNumber()
  max?: number;

  @IsNumber()
  rate!: number;
}

export class UpdatePayrollPoliciesDto {
  // Attendance + legacy payroll fields (sent by both save sites).
  @IsOptional()
  @IsNumber()
  workHoursPerDay?: number;

  @IsOptional()
  @IsNumber()
  latenessGracePeriodMinutes?: number;

  @IsOptional()
  @IsNumber()
  latenessPenaltyMultiplier?: number;

  @IsOptional()
  @IsNumber()
  absencePenaltyMultiplier?: number;

  @IsOptional()
  @IsNumber()
  overtimeMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  hrDelayPolicyEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  hrDelayPolicyFirstTimeDeduction?: number;

  @IsOptional()
  @IsNumber()
  hrDelayPolicySecondTimeDeduction?: number;

  @IsOptional()
  @IsNumber()
  hrDelayPolicyThirdTimeDeduction?: number;

  @IsOptional()
  @IsNumber()
  hrDelayPolicyFourthTimeDeduction?: number;

  @IsOptional()
  @IsString()
  hrCommissionType?: string;

  @IsOptional()
  @IsNumber()
  hrCommissionValue?: number;

  @IsOptional()
  @IsNumber()
  hrCommissionTarget?: number;

  @IsOptional()
  @IsNumber()
  hrSocialInsuranceEmployeePct?: number;

  @IsOptional()
  @IsString()
  hrWeekendDays?: string;

  // HrStatutoryPolicy fields (16).
  @IsOptional()
  @IsBoolean()
  hrSocialInsuranceEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  hrIncomeTaxEnabled?: boolean;

  @IsOptional()
  @IsString()
  statutoryCountry?: string;

  @IsOptional()
  @IsString()
  statutoryEffectiveFrom?: string;

  @IsOptional()
  @IsString()
  statutoryEffectiveTo?: string;

  @IsOptional()
  @IsString()
  statutoryLegalReference?: string;

  @IsOptional()
  @IsBoolean()
  statutoryReviewed?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => InsuranceConfigDto)
  insuranceConfig?: InsuranceConfigDto;

  @IsOptional()
  @IsNumber()
  taxPersonalExemption?: number;

  @IsOptional()
  @IsString()
  taxableEarningsBasis?: string;

  @IsOptional()
  @IsBoolean()
  taxDeductEmployeeInsurance?: boolean;

  @IsOptional()
  @IsString()
  insuranceWageBasis?: string;

  @IsOptional()
  @IsBoolean()
  insuranceProratePartialEmployment?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxBracketDto)
  taxBrackets?: TaxBracketDto[];

  @IsOptional()
  @IsNumber()
  directAdvanceCashCap?: number;

  @IsOptional()
  @IsObject()
  directAdvanceCashCapByCurrency?: Record<string, number>;
}
