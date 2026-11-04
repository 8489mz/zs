import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReleaseDeliveryOrderDto {
  @IsBoolean()
  @IsOptional()
  documentsComplete?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  documentReason?: string;
}
