import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

/*
 * D10: BostaCreateDeliveryDto + the nested specs type are decorated
 * classes IN PLACE (Rule 5) — the ship-order site takes the class now.
 * BostaSettings stays an interface (the settings site takes the
 * SaveBostaSettingsDto class in dto/bosta-write.dto.ts). ALL delivery
 * fields are optional: the service defaults every one from the order
 * and the saved settings.
 */

export interface BostaSettings {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  apiKey: string;
  pickupBusinessName?: string;
  pickupPhone?: string;
  pickupCity?: string;
  pickupAddress?: string;
}

export class BostaDeliverySpecsDto {
  @IsOptional()
  @IsEnum(['Parcel', 'Document'])
  packageType?: 'Parcel' | 'Document';

  @IsOptional()
  @IsEnum(['SMALL', 'MEDIUM', 'LARGE'])
  size?: 'SMALL' | 'MEDIUM' | 'LARGE';

  @IsOptional()
  @IsNumber()
  itemsCount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  weight?: number;
}

export class BostaCreateDeliveryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BostaDeliverySpecsDto)
  specs?: BostaDeliverySpecsDto;

  @IsOptional()
  @IsNumber()
  cod?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  receiverAddress?: string;

  @IsOptional()
  @IsString()
  receiverCity?: string;
}

export interface BostaDeliveryResponse {
  ok: boolean;
  deliveryId: string;
  trackingNumber: string;
  status: string;
  awbUrl?: string;
  isSandbox: boolean;
  message?: string;
}

export interface BostaTrackingEvent {
  state: string;
  timestamp: string;
  reason?: string;
}

export interface BostaTrackingResponse {
  ok: boolean;
  trackingNumber: string;
  currentStatus: string;
  history: BostaTrackingEvent[];
}
