import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateJobOpeningDto {
  @IsString()
  title!: string;

  @IsString()
  department!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  experienceYearsMin?: number;

  @IsNumber()
  @Min(1)
  headcount!: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  requirements?: string;

  @IsOptional()
  @IsEnum(['draft', 'published', 'closed'])
  status?: 'draft' | 'published' | 'closed';
}

export class CreateApplicantDto {
  @IsOptional()
  @IsString()
  jobId?: string;

  @IsString()
  fullName!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  experienceYears?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  rating?: number;

  @IsOptional()
  @IsString()
  talentPoolTag?: string;

  @IsOptional()
  @IsString()
  cvUrl?: string;

  @IsOptional()
  @IsString()
  interviewNotes?: string;
}

export class UpdateApplicantStageDto {
  @IsEnum(['new', 'screening', 'interview', 'offer', 'hired', 'rejected'])
  stage!: 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';

  @IsOptional()
  @IsString()
  interviewNotes?: string;

  @IsOptional()
  @IsNumber()
  rating?: number;
}

export class HireApplicantDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  customSalary?: number;

  @IsOptional()
  @IsNumber()
  branchId?: number;
}
