import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsIn,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';

export class ArCollectionsQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  levelId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsNumber()
  offset?: number;
}

export class CreateCollectionLogDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['call', 'whatsapp', 'visit', 'letter', 'dispute', 'promise_to_pay', 'other'])
  interactionType!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['sent', 'answered', 'promise_to_pay', 'no_answer', 'disputed', 'refused', 'escalated', 'settled'])
  resultStatus!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;

  // Single-server-clock rule (P6, RC-5): these were @IsString(), so any
  // string — including garbage — was stored verbatim into a date column.
  // @IsDateString() rejects non-dates at the boundary; the service
  // additionally bounds them to [today, today+365d] in the tenant zone.
  @IsOptional()
  @IsDateString()
  promisedDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  promisedAmount?: number;

  @IsOptional()
  @IsDateString()
  nextFollowupDate?: string;
}

export class RecordPromiseToPayDto {
  @IsNotEmpty()
  @IsDateString()
  promisedDate!: string;

  @IsNumber()
  @Min(0.01)
  promisedAmount!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ToggleCreditBlockDto {
  @IsBoolean()
  block!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateDunningLevelDto {
  @IsOptional()
  @IsString()
  levelName?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  daysPastDue?: number;

  @IsOptional()
  @IsBoolean()
  autoBlockSales?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['whatsapp', 'manual_call', 'legal', 'email'])
  actionType?: string;

  @IsOptional()
  @IsString()
  templateText?: string;
}
