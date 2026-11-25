import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * INV-DTO-DELIVERY-REPS-58 (D3): admin promotion-toggle / route /
 * financial-ledger DTOs. settleRepFinancialItem.method is required
 * with the cash/waiver union because the service throws
 * SETTLEMENT_METHOD_INVALID otherwise; addRepBonusOrCommission.amount
 * is IsPositive because the service throws INVALID_AMOUNT for <= 0,
 * and its notes is a required string (the controller type requires
 * it). pushRepShortagesToPayroll.settlementIds is required with at
 * least one entry because the service throws NO_ITEMS_SELECTED on an
 * empty list. linkRepToEmployee.employeeId is required-but-nullable
 * (ValidateIf): the service updates the link with whatever value it
 * receives and never validates it.
 */
export class TogglePromotionActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class OptimizeSupervisorRouteDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  customerIds?: number[];

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  repId?: number;

  @IsOptional()
  @IsNumber()
  startLat?: number;

  @IsOptional()
  @IsNumber()
  startLng?: number;

  @IsOptional()
  @IsBoolean()
  persistSequence?: boolean;
}

export class SettleRepFinancialItemDto {
  @IsIn(['cash', 'waiver'])
  method!: 'cash' | 'waiver';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  supervisorPin?: string;
}

export class PushRepShortagesToPayrollDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  settlementIds!: number[];

  @IsOptional()
  @IsString()
  targetMonth?: string;
}

export class AddRepBonusOrCommissionDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @IsIn(['bonus', 'commission'])
  entryType!: 'bonus' | 'commission';

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  notes!: string;
}

export class LinkRepToEmployeeDto {
  @IsInt()
  @Min(1)
  repId!: number;

  @ValidateIf((o) => o.employeeId !== null)
  @IsInt()
  @Min(1)
  employeeId!: number | null;
}

export class AutoCreateEmployeeDto {
  @IsInt()
  @Min(1)
  repId!: number;
}
