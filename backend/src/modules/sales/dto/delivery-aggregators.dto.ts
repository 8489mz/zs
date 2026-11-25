/*
 * D5 sales — delivery aggregators update DTO.
 *
 * UpdateAggregatorChannelDto mirrors AggregatorChannelDto
 * (delivery-aggregators.service.ts) as an all-optional class:
 * the update service falls back to the stored row for every
 * field it does not receive, so a partial update is a
 * legitimate service capability (the D3 promotion precedent —
 * one class with a required name would narrow it). The only
 * in-repo caller (PosDeliveryAggregatorsModal) sends
 * { is_active } only; the service picks the seven fields it
 * stores (commission_rate, price_markup_percentage,
 * price_markup_fixed, is_active, auto_accept_orders, api_key,
 * webhook_secret) and ignores code / name / name_en.
 */

import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateAggregatorChannelDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  name_en?: string;

  @IsOptional()
  @IsNumber()
  commission_rate?: number;

  @IsOptional()
  @IsNumber()
  price_markup_percentage?: number;

  @IsOptional()
  @IsNumber()
  price_markup_fixed?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  auto_accept_orders?: boolean;

  @IsOptional()
  @IsString()
  api_key?: string;

  @IsOptional()
  @IsString()
  webhook_secret?: string;
}
