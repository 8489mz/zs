import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): fleet DTOs. The admin fuel/oil
 * variants carry the extra repId the admin caller sends; the driver
 * variants do not (the driver caller never sends repId). Ranges
 * mirror the service throws exactly: fuel odometer/liters/
 * pricePerLiter are IsPositive because the service throws
 * INVALID_ODOMETER / INVALID_LITERS / INVALID_PRICE_PER_LITER for
 * values <= 0; oil odometerAtChange/ratedKm are IsPositive the same
 * way; oilType is required and non-empty because the service throws
 * INVALID_OIL_TYPE; alertKmBefore carries no range check because the
 * service defaults it to 500 without throwing.
 */
export class RecordAdminFuelLogDto {
  @IsInt()
  @Min(1)
  vehicleId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  tripId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  repId?: number;

  @IsNumber()
  @IsPositive()
  odometer!: number;

  @IsNumber()
  @IsPositive()
  liters!: number;

  @IsNumber()
  @IsPositive()
  pricePerLiter!: number;

  @IsOptional()
  @IsString()
  stationName?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordFuelLogDto {
  @IsInt()
  @Min(1)
  vehicleId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  tripId?: number;

  @IsNumber()
  @IsPositive()
  odometer!: number;

  @IsNumber()
  @IsPositive()
  liters!: number;

  @IsNumber()
  @IsPositive()
  pricePerLiter!: number;

  @IsOptional()
  @IsString()
  stationName?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordAdminOilChangeDto {
  @IsInt()
  @Min(1)
  vehicleId!: number;

  @IsNumber()
  @IsPositive()
  odometerAtChange!: number;

  @IsString()
  @IsNotEmpty()
  oilType!: string;

  @IsNumber()
  @IsPositive()
  ratedKm!: number;

  @IsBoolean()
  withFilter!: boolean;

  @IsOptional()
  @IsNumber()
  alertKmBefore?: number;

  @IsOptional()
  @IsNumber()
  cost?: number;

  @IsOptional()
  @IsString()
  performedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  repId?: number;
}

export class RecordOilChangeDto {
  @IsInt()
  @Min(1)
  vehicleId!: number;

  @IsNumber()
  @IsPositive()
  odometerAtChange!: number;

  @IsString()
  @IsNotEmpty()
  oilType!: string;

  @IsNumber()
  @IsPositive()
  ratedKm!: number;

  @IsBoolean()
  withFilter!: boolean;

  @IsOptional()
  @IsNumber()
  alertKmBefore?: number;

  @IsOptional()
  @IsNumber()
  cost?: number;

  @IsOptional()
  @IsString()
  performedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignVehicleDriverDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsString()
  shiftName!: string;

  @IsOptional()
  @IsString()
  shiftStartTime?: string;

  @IsOptional()
  @IsString()
  shiftEndTime?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
