import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// D6 (INV-DTO-ACCOUNTING-25): converted from interfaces to decorated
// classes in place (DTO contract Rule 5). CloseFiscalPeriodDto is
// all-optional: the caller sends `payload || {}`. ReopenFiscalPeriodDto
// requires the reason (the service throws on an empty reason).
export class CloseFiscalPeriodDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReopenFiscalPeriodDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export interface FiscalPeriodResponse {
  id: number;
  tenant_id: string;
  fiscal_year_id: number;
  period_number: number;
  name: string;
  code: string | null;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  closed_at: string | null;
  closed_by: number | null;
  closing_notes: string | null;
  created_at: string;
  updated_at: string;
}
