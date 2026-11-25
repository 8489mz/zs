/*
 * D9 — approvals write DTOs (new file; CreateApprovalRuleDto lives
 * IN PLACE in approval-workflow.service.ts per Rule 5).
 *
 * Caller traps (no frontend caller exists for any of these endpoints
 * — the positive cases are the interface shapes, D5 precedent):
 * - UpdateApprovalRuleDto mirrors the Partial shape: every field
 *   optional; module is purchase_orders ONLY and requiredRole is
 *   'admin' ONLY (both service whitelists, same as create).
 * - RejectApprovalRequestDto.reason is REQUIRED (the service throws
 *   when it is blank).
 */
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateApprovalRuleDto {
  @IsOptional()
  @IsEnum(['purchase_orders'])
  module?: 'purchase_orders';

  @IsOptional()
  @IsNumber()
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  tierLevel?: number;

  @IsOptional()
  @IsEnum(['admin'])
  requiredRole?: string;

  @IsOptional()
  @IsNumber()
  approverUserId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ApproveApprovalRequestDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectApprovalRequestDto {
  @IsString()
  reason!: string;
}
