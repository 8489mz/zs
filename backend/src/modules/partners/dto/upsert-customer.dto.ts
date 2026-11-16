import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, IsObject } from 'class-validator';

export class UpsertCustomerDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  balance?: number;

  @IsOptional()
  @IsIn(['cash', 'vip', 'credit', 'wholesale', 'half_wholesale'])
  type?: 'cash' | 'vip' | 'credit' | 'wholesale' | 'half_wholesale';

  // INV-VAN-PRICE-LIST-WIRING: the price list assigned to this
  // customer (the engine resolves it first for the customer's
  // sales). null clears the assignment; absent leaves it unchanged
  // on update. An unknown or foreign list id is refused with
  // PRICE_LIST_NOT_FOUND; an INACTIVE list id is stored as given
  // (the assignment is preserved for reactivation, and the engine
  // resolves it as "no list" while it is inactive).
  @IsOptional()
  @IsNumber()
  priceListId?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  storeCreditBalance?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNumber?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
