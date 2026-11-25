import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional } from 'class-validator';

// INV-DTO-PILOT-PURCHASES-INVENTORY (D2 pilot): POST
// /api/locations/:id/assign-products took an inline body type, so the
// global validation pipe never ran on it. The DTO mirrors the shape the
// service already tolerates: productIds is optional (the controller
// passes `body.productIds || []` and the service returns success on an
// empty list), so no @ArrayMinSize here.
export class AssignProductsDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  productIds?: number[];
}
