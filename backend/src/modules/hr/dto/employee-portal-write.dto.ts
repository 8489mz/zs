/*
 * D9 — employee-portal write DTOs (new file).
 *
 * Caller traps (verified against employee-portal.api.ts at eba4e59d1):
 * - EmployeePortalChangePinDto: currentPin + newPin are REQUIRED
 *   though the interface marks both optional (the service throws
 *   INVALID_PIN when either is missing — D5 precedent).
 * - RequestAdvanceDto.reason is OPTIONAL though the interface says
 *   required (the service defaults 'بدون تفاصيل').
 */
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class EmployeePortalLoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  pinCode!: string;

  @IsOptional()
  @IsString()
  companyCode?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class EmployeePortalChangePinDto {
  @IsString()
  currentPin!: string;

  @IsString()
  newPin!: string;
}

export class RequestLeaveDto {
  @IsNumber()
  leaveTypeId!: number;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RequestAdvanceDto {
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsNumber()
  repaymentMonths?: number;
}
