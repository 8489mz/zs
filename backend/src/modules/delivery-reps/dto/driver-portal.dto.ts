import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): driver-portal DTOs. The global
 * requestValidationPipe does nothing for the inline types these routes
 * took before, so any extra field reached the service untouched. Every
 * field below is caller-verified against the real driver portal caller
 * (frontend/src/features/delivery-reps/api/van-sales-driver-auth.ts
 * plus DriverPortalLogin.tsx / DriverPinChangeScreen.tsx): the DTO
 * accepts exactly what the caller sends, so a real driver payload
 * never 400s at the boundary. Login/change-pin/settle are
 * auth-adjacent — a DTO that rejects a real driver payload locks
 * drivers out of their portal, so the positive cases for these three
 * are pinned in the D3 spec with the real caller payloads, no
 * exceptions.
 */
export class DriverLoginDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  pinCode!: string;

  @IsOptional()
  @IsString()
  companyCode?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class DriverChangePinDto {
  @IsString()
  @IsNotEmpty()
  currentPin!: string;

  @IsString()
  @IsNotEmpty()
  newPin!: string;
}

export class DriverSettleOrderDto {
  @IsOptional()
  @IsString()
  signatureDataUrl?: string;

  @IsOptional()
  @IsString()
  proofPhotoUrl?: string;

  @IsOptional()
  @IsNumber()
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  gpsLng?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
