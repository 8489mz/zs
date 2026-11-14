import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
