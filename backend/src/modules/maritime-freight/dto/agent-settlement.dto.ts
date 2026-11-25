import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn, Min } from 'class-validator';

export const VALID_SETTLEMENT_TYPES = ['debit_note', 'credit_note', 'profit_share', 'offset_clearing'] as const;
export type AgentSettlementType = (typeof VALID_SETTLEMENT_TYPES)[number];

export const VALID_SETTLEMENT_STATUSES = ['pending', 'approved', 'cleared', 'disputed'] as const;
export type AgentSettlementStatus = (typeof VALID_SETTLEMENT_STATUSES)[number];

export class CreateAgentSettlementDto {
  @IsString()
  @IsOptional()
  agentId?: string;

  @IsString()
  @IsNotEmpty()
  agentName!: string;

  @IsString()
  @IsOptional()
  jobId?: string;

  @IsString()
  @IsOptional()
  jobNumber?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_SETTLEMENT_TYPES)
  settlementType!: AgentSettlementType;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  profitSharePercent?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  exchangeRate?: number;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateAgentSettlementStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_SETTLEMENT_STATUSES)
  status!: AgentSettlementStatus;

  @IsString()
  @IsOptional()
  notes?: string;
}
