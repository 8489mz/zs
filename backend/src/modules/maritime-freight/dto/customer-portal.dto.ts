import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/*
 * New file: backend/src/modules/maritime-freight/dto/customer-portal.dto.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the maritime customer
 * portal routes now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D4 they
 * took inline object types (or, for quotes/request, an interface named
 * *Dto) — and the pipe does nothing for an inline type or an interface,
 * so any extra field (or a wrong-typed field) reached the service
 * untouched.
 *
 * CALLER VERIFICATION (every field verified against the real caller
 * payload at b48be82b0; the frontend api file is the caller surface):
 * - login: freightCustomerPortalApi.login sends { phone, pinCode,
 *   companyCode?, tenantId? } (frontend/.../maritime-freight-portal-api.ts).
 *   The service throws INVALID_CREDENTIALS on a blank phone/pin, so
 *   both stay required here.
 * - token-login: freightCustomerPortalApi.tokenLogin sends { token }.
 * - approve: freightCustomerPortalApi.approveQuotation sends
 *   { approvalNotes?, clientReference?, confirmedBy? } (the portal page
 *   sends the client reference from the PO-number field and the
 *   confirmed-by name from the logged-in customer; either may be
 *   absent). The controller adds clientIp itself — it is NOT a body
 *   field and is not declared here.
 * - reject: freightCustomerPortalApi.rejectQuotation sends { reason? }.
 *   The service defaults a missing reason; it stays optional here.
 *
 * CreatePortalQuoteRequestDto is converted IN PLACE in
 * maritime-customer-portal.service.ts (contract Rule 5) — it is not
 * in this file.
 */

export class MaritimeCustomerLoginDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  pinCode!: string;

  @IsString()
  @IsOptional()
  companyCode?: string;

  @IsString()
  @IsOptional()
  tenantId?: string;
}

export class MaritimeCustomerTokenLoginDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class ApproveQuotationDto {
  @IsString()
  @IsOptional()
  approvalNotes?: string;

  @IsString()
  @IsOptional()
  clientReference?: string;

  @IsString()
  @IsOptional()
  confirmedBy?: string;
}

export class RejectQuotationDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
