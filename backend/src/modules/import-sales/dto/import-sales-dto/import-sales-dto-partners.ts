/*
 * D10 — import-sales partner write DTOs (new file; 4 sites).
 *
 * Caller traps (verified against shipments-partners.ts +
 * shipments-projects.ts at 7413c4f3e):
 * - SetProjectPartnersDto.capitalShare is OPTIONAL (the SERVICE
 *   signature marks it optional) though the controller type marks it
 *   required; profitPercentage is REQUIRED.
 * - RecordCapitalTransactionDto.idempotencyKey is accepted though NO
 *   caller sends it (the service accepts it).
 */
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreateImportPartnerDto {
  @IsString()
  name!: string;

  @IsNumber()
  percentage!: number;

  @IsOptional()
  @IsNumber()
  capitalAmount?: number;

  @IsOptional()
  @IsString()
  accountId?: string;
}

export class UpdateImportPartnerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsNumber()
  capitalAmount?: number;
}

export class SetProjectPartnerItemDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsNumber()
  capitalShare?: number;

  @IsNumber()
  profitPercentage!: number;
}

export class SetProjectPartnersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SetProjectPartnerItemDto)
  partners!: SetProjectPartnerItemDto[];
}

export class RecordCapitalTransactionDto {
  @IsEnum(['DEPOSIT', 'WITHDRAWAL'])
  type!: 'DEPOSIT' | 'WITHDRAWAL';

  @IsNumber()
  amount!: number;

  @IsString()
  date!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
