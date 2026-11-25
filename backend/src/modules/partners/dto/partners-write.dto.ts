/*
 * D10 — partners write DTOs (new file; 3 sites, 2 classes — the
 * add-address and delete-address handlers share CustomerAddressDto).
 *
 * Caller traps (verified against customers.api.ts at 7413c4f3e):
 * - AdjustCustomerLoyaltyPointsDto.pointsChange is REQUIRED; actionType
 *   is optional (the helper defaults it to 'manual_adjust'); notes
 *   optional.
 * - CustomerAddressDto.address is REQUIRED (both address handlers pass
 *   it straight to the service).
 */
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class AdjustCustomerLoyaltyPointsDto {
  @IsNumber()
  pointsChange!: number;

  @IsOptional()
  @IsEnum(['earn', 'redeem', 'manual_adjust'])
  actionType?: 'earn' | 'redeem' | 'manual_adjust';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CustomerAddressDto {
  @IsString()
  address!: string;
}
