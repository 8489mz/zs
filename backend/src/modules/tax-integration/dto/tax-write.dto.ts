/*
 * D9 — tax-integration write DTOs (new file; AttachSignatureDto,
 * TaxSettingsDto, CreateEgsUnitDto and RequestComplianceDto live IN
 * PLACE in their service files per Rule 5).
 *
 * Caller traps (no frontend caller exists for any of these endpoints
 * — the positive cases are the interface shapes, D5 precedent):
 * - SubmitEtaInvoicesDto.invoiceIds is OPTIONAL (the service returns
 *   success count 0 when it is missing/empty).
 * - SubmitZatcaInvoicesBulkDto.invoiceIds is OPTIONAL and NARROWED
 *   from (number|string)[] to string[] (D5 cashierShiftId precedent:
 *   numbers coerce to strings, non-numeric strings pass the pipe and
 *   are filtered by the service).
 * - ValidateZatcaComplianceDto: ALL FIVE fields OPTIONAL — the
 *   endpoint RETURNS an error list instead of throwing, so
 *   required-ness stays with the service (a strict DTO would turn a
 *   {valid:false, errors:[...]} 200 into a 400 and defeat the
 *   endpoint's purpose). lineItems is @IsArray() only (no
 *   ArrayMinSize — [] is a service-reported error); totalWithVat is
 *   @IsNumber() only (no Min — a negative is a service-reported
 *   error).
 */
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

export class SubmitEtaInvoicesDto {
  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  invoiceIds?: string[];
}

export class SubmitZatcaInvoicesBulkDto {
  @IsOptional()
  @IsArray()
  @Type(() => String)
  @IsString({ each: true })
  invoiceIds?: string[];
}

export class ValidateZatcaComplianceDto {
  @IsOptional()
  @IsString()
  sellerVatNumber?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  issueDate?: string;

  @IsOptional()
  @IsArray()
  lineItems?: unknown[];

  @IsOptional()
  @IsNumber()
  totalWithVat?: number;
}
