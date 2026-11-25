/*
 * D5 sales — misc sales-controller DTOs.
 *
 * AuthorizeDiscountOverrideDto: the caller (pos.api.ts
 * authorizeDiscountOverride) sends { secret }. The controller
 * String()s a missing secret, so it stays optional; a numeric
 * secret coerces to a string under enableImplicitConversion.
 *
 * CancelSaleDto: the caller (sales.api.ts cancel) sends
 * { reason, managerPin } (both always, possibly empty). The
 * controller String()s missing fields, so both stay optional;
 * a numeric reason coerces to a string the same way.
 */

import { IsOptional, IsString } from 'class-validator';

export class AuthorizeDiscountOverrideDto {
  @IsOptional()
  @IsString()
  secret?: string;
}

export class CancelSaleDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;
}
