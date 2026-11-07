import { Transform, Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListDealsQueryDto {
  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  assignedUserId?: number;
}

export class CreateDealDto {
  @IsString()
  title!: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedAmount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsString()
  stage?: string;

  // INV-CRM-ERROR: the create modal posts '' when the user leaves the date
  // empty, and @IsOptional() skips only null/undefined -- '' used to die
  // in the validation pipe as a date-format error instead of reaching the
  // required-field check in the service. Normalise '' to missing here.
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string | null;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  assignedUserId?: number | null;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  customerId?: number | null;

  @IsOptional()
  @IsString()
  lostReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDealDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedAmount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string | null;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  assignedUserId?: number | null;

  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  customerId?: number | null;

  @IsOptional()
  @IsString()
  lostReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateActivityDto {
  @IsOptional()
  @IsString()
  activityType?: string;

  @IsString()
  summary!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;
}
