/*
 * D5 sales — POS terminal DTOs (test-connection + bridge).
 *
 * TestTerminalConnectionDto: the caller (pos.api.ts
 * testTerminalConnection) sends { ip?, port?, provider? } —
 * all optional; the service falls back to the tenant's saved
 * terminal settings (and to 192.168.1.150:8080 / 'fawry').
 *
 * BridgePollDto / BridgeCallbackDto: the caller is the C#
 * hardware bridge (tools/z-systems-bridge/Program.cs), NOT the
 * web frontend. The poll sends { tenantId, machineName,
 * bridgeVersion }; the callback ALWAYS sends all eight fields,
 * with "" fallbacks for authCode / cardLastFour / message and
 * "declined" for status — so there is no MinLength anywhere
 * here; an empty string is a legitimate bridge value. status
 * stays a free string (the service compares it against
 * 'approved' / 'APPROVED' / 'cancelled' and treats anything
 * else as declined).
 */

import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class TestTerminalConnectionDto {
  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsNumber()
  port?: number;

  @IsOptional()
  @IsString()
  provider?: string;
}

export class BridgePollDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsOptional()
  @IsString()
  machineName?: string;

  @IsOptional()
  @IsString()
  bridgeVersion?: string;
}

export class BridgeCallbackDto {
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsString()
  @IsNotEmpty()
  status!: string;

  @IsOptional()
  @IsString()
  authCode?: string;

  @IsOptional()
  @IsString()
  rrn?: string;

  @IsOptional()
  @IsString()
  cardScheme?: string;

  @IsOptional()
  @IsString()
  cardLastFour?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
