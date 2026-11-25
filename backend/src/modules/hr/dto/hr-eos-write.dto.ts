/*
 * D9 — end-of-service post-accounting DTO (new file; the calculate +
 * create DTOs live IN PLACE in end-of-service.service.ts per Rule 5).
 * Caller: end-of-service.api.ts postAccounting sends
 * { treasuryAccountId?, notes? } — both optional (the service reads
 * payload.treasuryAccountId || null).
 */
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class PostSettlementAccountingDto {
  @IsOptional()
  @IsNumber()
  treasuryAccountId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
