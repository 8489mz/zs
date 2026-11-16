import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SalePaymentDto } from './upsert-sale.dto';

/**
 * INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: body of POST
 * /api/sales/:id/payment-adjustment — the ONLY writer of sale_payments
 * after posting, besides the original sale insert. `payments` is the
 * COMPLETE new leg set (one row per channel; same-channel rows are
 * merged server-side): it replaces the stored legs wholesale, it does
 * not top them up. `reason` is mandatory and audit-logged; a manager
 * PIN is required for non-admins, exactly like updateSale.
 */
export class AdjustSalePaymentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments!: SalePaymentDto[];

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  managerPin?: string;
}
