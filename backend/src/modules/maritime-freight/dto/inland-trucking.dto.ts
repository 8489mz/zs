import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn, Min } from 'class-validator';

export const VALID_TRUCKING_STATUSES = ['assigned', 'loading', 'in_transit', 'delivered', 'empty_returned'] as const;
export type TruckingTripStatus = (typeof VALID_TRUCKING_STATUSES)[number];

export class CreateInlandTruckingTripDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsString()
  @IsOptional()
  containerNumber?: string;

  @IsString()
  @IsNotEmpty()
  truckingCompany!: string;

  @IsString()
  @IsNotEmpty()
  driverName!: string;

  @IsString()
  @IsOptional()
  driverPhone?: string;

  @IsString()
  @IsNotEmpty()
  truckPlate!: string;

  @IsString()
  @IsOptional()
  trailerPlate?: string;

  @IsString()
  @IsNotEmpty()
  originPortTerminal!: string;

  @IsString()
  @IsNotEmpty()
  deliveryDestination!: string;

  @IsString()
  @IsOptional()
  dispatchDate?: string;

  @IsString()
  @IsOptional()
  deliveryDate?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  costAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sellAmount?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateInlandTruckingTripStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_TRUCKING_STATUSES)
  tripStatus!: TruckingTripStatus;

  @IsString()
  @IsOptional()
  deliveryDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
