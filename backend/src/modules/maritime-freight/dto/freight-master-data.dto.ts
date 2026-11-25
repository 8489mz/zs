import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  MinLength,
  ValidateNested,
} from 'class-validator';

/*
 * New file: backend/src/modules/maritime-freight/dto/freight-master-data.dto.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the maritime-freight
 * master-data routes now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D4 they
 * took `any` (shipping-lines create/update, import-bulk, portal-pin,
 * ports) — and the pipe does nothing for `any`, so any extra field (or
 * a wrong-typed field) reached the service untouched.
 *
 * CALLER VERIFICATION (every field verified against the real caller
 * payload at b48be82b0):
 * - set portal pin: useSetFreightPortalPinMutation sends { pinCode }
 *   only (frontend/.../useSetFreightPortalPinMutation.ts). The service
 *   runs assertSecurePasscode (min 4 chars); the min length is pinned
 *   here, the trivial-pattern / phone-suffix rules stay server-side.
 * - create port: MaritimePortsTab sends exactly the 5 fields, all
 *   present (frontend/.../maritime-freight-types.ts:
 *   CreateMaritimePortPayload). The service upper-cases code and
 *   countryCode, so both stay required here.
 * - shipping lines create + update: PartnerFormModal sends the same
 *   shape for both (frontend/.../PartnerFormModal.tsx:55). CALLER
 *   TRAP: the form's carrierType state is 'shipping_line' |
 *   'overseas_agent' | 'airline' | 'trucking' — FOUR values — while
 *   the service type declares only the first two. The declared type
 *   lies (the D3 periodMonth lesson); the DTO accepts all four. The
 *   update service sets every field from the payload and never
 *   updates `code`, so the update DTO is all-optional and carries
 *   `code` as optional with that note.
 * - import-bulk: ImportCarriersModal sends only filtered valid rows
 *   (nameAr non-empty, code always present via the AUTO_n fallback)
 *   with camelCase fields PLUS `trackingUrl` (which the service never
 *   reads) PLUS `isValid: boolean` (sent inside the item object).
 *   CALLER TRAP: the DTO item must accept `trackingUrl?` and
 *   `isValid?` or the import 400s. The service also reads the
 *   snake_case spellings (nameAr || name_ar, carrierType ||
 *   carrier_type, ...), so the item accepts BOTH spellings (the D2
 *   rule). Item code/nameAr stay OPTIONAL: the service SKIPS rows
 *   without them, never throws — mirror the service exactly. The
 *   items array itself gets ArrayMinSize(1): the service throws on an
 *   empty/non-array payload.
 */

// Shipping-line carrier types the real caller can send. The service
// type declares only 'shipping_line' | 'overseas_agent'; the form
// (PartnerFormModal) offers all four and sends the value verbatim.
export const SHIPPING_LINE_CARRIER_TYPES = ['shipping_line', 'overseas_agent', 'airline', 'trucking'] as const;

export type ShippingLineCarrierType = (typeof SHIPPING_LINE_CARRIER_TYPES)[number];

export class SetCustomerPortalPinDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  pinCode!: string;
}

export class CreatePortDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsString()
  @IsNotEmpty()
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  countryCode!: string;

  @IsString()
  @IsNotEmpty()
  countryName!: string;
}

export class CreateShippingLineDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  nameAr!: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsIn(SHIPPING_LINE_CARRIER_TYPES)
  @IsOptional()
  carrierType?: ShippingLineCarrierType;

  @IsString()
  @IsOptional()
  tradeLanes?: string;

  @IsString()
  @IsOptional()
  countryName?: string;

  @IsString()
  @IsOptional()
  countryCode?: string;

  @IsString()
  @IsOptional()
  cityName?: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  rfqEmail?: string;

  @IsString()
  @IsOptional()
  bookingEmail?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  whatsapp?: string;

  @IsString()
  @IsOptional()
  wechat?: string;

  @IsString()
  @IsOptional()
  servicesOffered?: string;

  @IsString()
  @IsOptional()
  supportedPorts?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateShippingLineDto {
  // Sent by the form on every update, but the service never updates
  // `code` — declared optional here so the caller's payload still
  // passes, and the service keeps ignoring it.
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  nameAr?: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsIn(SHIPPING_LINE_CARRIER_TYPES)
  @IsOptional()
  carrierType?: ShippingLineCarrierType;

  @IsString()
  @IsOptional()
  tradeLanes?: string;

  @IsString()
  @IsOptional()
  countryName?: string;

  @IsString()
  @IsOptional()
  countryCode?: string;

  @IsString()
  @IsOptional()
  cityName?: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  rfqEmail?: string;

  @IsString()
  @IsOptional()
  bookingEmail?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  whatsapp?: string;

  @IsString()
  @IsOptional()
  wechat?: string;

  @IsString()
  @IsOptional()
  servicesOffered?: string;

  @IsString()
  @IsOptional()
  supportedPorts?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// One row of the bulk carrier import. The service accepts both the
// camelCase and the snake_case spelling of every field, and skips rows
// without a code or a name — both behaviours are mirrored here.
export class ImportCarriersBulkItemDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  nameAr?: string;

  @IsString()
  @IsOptional()
  name_ar?: string;

  @IsString()
  @IsOptional()
  nameEn?: string;

  @IsString()
  @IsOptional()
  name_en?: string;

  @IsString()
  @IsOptional()
  carrierType?: string;

  @IsString()
  @IsOptional()
  carrier_type?: string;

  @IsString()
  @IsOptional()
  countryName?: string;

  @IsString()
  @IsOptional()
  country_name?: string;

  @IsString()
  @IsOptional()
  countryCode?: string;

  @IsString()
  @IsOptional()
  country_code?: string;

  @IsString()
  @IsOptional()
  cityName?: string;

  @IsString()
  @IsOptional()
  city_name?: string;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsString()
  @IsOptional()
  contact_person?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  rfqEmail?: string;

  @IsString()
  @IsOptional()
  rfq_email?: string;

  @IsString()
  @IsOptional()
  bookingEmail?: string;

  @IsString()
  @IsOptional()
  booking_email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  whatsapp?: string;

  @IsString()
  @IsOptional()
  wechat?: string;

  @IsString()
  @IsOptional()
  tradeLanes?: string;

  @IsString()
  @IsOptional()
  trade_lanes?: string;

  @IsString()
  @IsOptional()
  servicesOffered?: string;

  @IsString()
  @IsOptional()
  services_offered?: string;

  @IsString()
  @IsOptional()
  supportedPorts?: string;

  @IsString()
  @IsOptional()
  supported_ports?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // Sent by the import modal inside every item although the service
  // never reads it — accepted here so the import does not 400.
  @IsString()
  @IsOptional()
  trackingUrl?: string;

  // Sent by the import modal inside every item (the modal's own
  // validity flag) although the service never reads it.
  @IsBoolean()
  @IsOptional()
  isValid?: boolean;
}

export class ImportCarriersBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportCarriersBulkItemDto)
  items!: ImportCarriersBulkItemDto[];
}
