import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, Min } from 'class-validator';

export class ToggleHotSkuDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  productId!: number;

  @IsBoolean()
  isHighRiskShrinkage!: boolean;
}
