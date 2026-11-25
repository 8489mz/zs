import { IsOptional, IsString } from 'class-validator';

// INV-DTO-PILOT-PURCHASES-INVENTORY (D2 pilot): POST
// /api/purchases/:id/cancel took an inline body type, so the global
// validation pipe never ran on it. Both fields are optional — the
// controller coerces missing values to '' — and the DTO mirrors exactly
// what the real caller sends (reason, managerPin).
export class CancelPurchaseDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  managerPin?: string;
}
