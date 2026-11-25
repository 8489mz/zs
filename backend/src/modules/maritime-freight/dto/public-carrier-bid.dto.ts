import { IsString, IsOptional, IsNumber, IsInt } from 'class-validator';

/*
 * New file: backend/src/modules/maritime-freight/dto/public-carrier-bid.dto.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the public carrier
 * bid route (unauthenticated) now takes a DTO class, so the real
 * global requestValidationPipe validates and whitelists it. Before D4
 * it took `any` — and the pipe does nothing for `any`, so any extra
 * field (or a wrong-typed field) reached the service untouched, and
 * the whole payload was stored verbatim as raw_bid_data.
 *
 * CALLER VERIFICATION (verified against the real caller payload at
 * b48be82b0): PublicCarrierQuotePage sends { token, shippingLineName,
 * shippingLineId?, oceanFreight, currency, thcOrigin, thcDestination,
 * bafCharges, otherCharges, transitTimeDays, freeDays, validityDate,
 * notes } (currency defaults 'USD', transitTimeDays 18, freeDays 14,
 * validityDate '' and notes '' when blank, oceanFreight client-
 * guarded > 0). The service reads shippingLineName || lineName
 * (both spellings accepted), Number(... || 0) for every charge, and
 * asserts the public-quote token — a missing or mismatched token
 * throws the service's own 404, so token stays OPTIONAL here and
 * the 404 is preserved instead of becoming a 400. shippingLineId
 * is string | number | null, bare-optional per the
 * SubmitMaritimeBidDto precedent. The page sends only the 13 known
 * fields, so whitelisting changes nothing about what is stored.
 */

export class SubmitPublicCarrierBidDto {
  @IsString()
  @IsOptional()
  token?: string;

  @IsString()
  @IsOptional()
  shippingLineName?: string;

  @IsString()
  @IsOptional()
  lineName?: string;

  @IsOptional()
  shippingLineId?: string | number | null;

  @IsNumber()
  @IsOptional()
  oceanFreight?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsOptional()
  thcOrigin?: number;

  @IsNumber()
  @IsOptional()
  thcDestination?: number;

  @IsNumber()
  @IsOptional()
  bafCharges?: number;

  @IsNumber()
  @IsOptional()
  otherCharges?: number;

  @IsInt()
  @IsOptional()
  transitTimeDays?: number;

  @IsInt()
  @IsOptional()
  freeDays?: number;

  @IsString()
  @IsOptional()
  validityDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
