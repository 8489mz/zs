/*
 * D5 sales — price-list calculate DTO.
 *
 * CalculatePriceDto: the caller (price-lists.api.ts calculate)
 * sends { customerId?, productId, quantity, basePrice,
 * paymentTerms? }. The controller defaults quantity to 1 and
 * basePrice to 0, so both stay optional; paymentTerms is the
 * credit-branch switch of the pricing engine
 * (INV-VAN-PRICE-LIST-WIRING) and only 'cash' | 'credit' are
 * meaningful.
 */

import { IsIn, IsNumber, IsOptional } from 'class-validator';

export class CalculatePriceDto {
  @IsOptional()
  @IsNumber()
  customerId?: number | null;

  @IsNumber()
  productId!: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  basePrice?: number;

  @IsOptional()
  @IsIn(['cash', 'credit'])
  paymentTerms?: 'cash' | 'credit';
}
