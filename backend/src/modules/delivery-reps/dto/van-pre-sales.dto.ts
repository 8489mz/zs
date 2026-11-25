import { ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): admin pre-sales DTOs.
 *
 * ConsolidatePreSalesOrdersDto: orderIds is required with at least
 * one entry because the service throws NO_ORDERS_SELECTED on an
 * empty list. targetRepId AND deliveryRepId are both accepted (the
 * F18 trial problem 30 pair): the admin dialog sends deliveryRepId,
 * older callers send targetRepId, and the service requires at least
 * one of them — that either/or rule stays in the service as backstop
 * (TARGET_REP_REQUIRED).
 *
 * ConvertPreSalesOrderDto: the whole body is optional at the route
 * (the caller always sends at least an empty object), and every field
 * is optional. paymentType AND paymentMethod are both accepted.
 * PRE-EXISTING MISMATCH, NOT fixed here: the caller
 * (van-sales-presales.ts convertAdminPreSalesOrderToInvoice) sends
 * paymentMethod only, while the convert service reads paymentType
 * only and defaults to the order's payment terms — so the caller's
 * payment choice is silently dropped today. The DTO accepts both
 * spellings so the caller does not 400; fixing the mapping is a
 * separate behaviour change. paidAmount carries no Min: the service
 * clamps it to >= 0 instead of throwing.
 */
export class ConsolidatePreSalesOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  orderIds!: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  targetRepId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  deliveryRepId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sourceWarehouseId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ConvertPreSalesOrderDto {
  @IsOptional()
  @IsIn(['cash', 'credit'])
  paymentType?: 'cash' | 'credit';

  @IsOptional()
  @IsIn(['cash', 'credit'])
  paymentMethod?: 'cash' | 'credit';

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
