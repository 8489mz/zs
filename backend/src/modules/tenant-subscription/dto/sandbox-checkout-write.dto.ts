/*
 * D10 — tenant-subscription sandbox-checkout write DTO (new file; 1 site).
 *
 * Caller trap (verified against the sandbox-checkout controller +
 * sandbox-checkout-render.util.ts at 7413c4f3e): NO frontend caller —
 * the caller is the server-rendered sandbox form, which posts
 * { gateway?, planId?, duration?, amount?, currency?, ref?,
 * redirectUrl? }. The service coerces/defaults EVERY field, so ALL
 * fields are optional. gateway stays a PLAIN STRING (open-ended
 * gateway names; the service lowercases).
 */
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CompleteSandboxCheckoutDto {
  @IsOptional()
  @IsString()
  gateway?: string;

  @IsOptional()
  @IsNumber()
  planId?: number;

  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  ref?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;
}
