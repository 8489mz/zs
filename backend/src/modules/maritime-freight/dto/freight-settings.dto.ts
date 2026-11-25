import { Type } from 'class-transformer';
import { IsString, IsOptional, IsIn, IsBoolean, IsInt, IsNumber, ValidateNested } from 'class-validator';

/*
 * New file: backend/src/modules/maritime-freight/dto/freight-settings.dto.ts
 *
 * WHAT THIS PINS (INV-DTO-MARITIME-FREIGHT-28, D4): the maritime-freight
 * settings routes now take DTO classes, so the real global
 * requestValidationPipe validates and whitelists them. Before D4 they
 * took `any` (pipeline-settings) or a Partial of an interface
 * (mail-settings) — and the pipe does nothing for `any` or an
 * interface, so any extra field (or a wrong-typed field) reached the
 * service untouched.
 *
 * CALLER VERIFICATION (every field verified against the real caller
 * payload at b48be82b0):
 * - saveMailSettings: MaritimeSettingsTab sends the full flat config
 *   (from the GET) PLUS `companyOfficialEmail` — a field the
 *   MaritimeMailConfig interface does NOT declare but the service
 *   reads and persists. All fields optional: the service merges with
 *   the current config.
 * - testMailConnection: MaritimeSettingsTab sends NESTED { smtp: {
 *   host, port, secure, user, password }, imap: { ... } }.
 *   PRE-EXISTING MISMATCH (NOT fixed here): testConnection reads
 *   only the FLAT fields (smtpHost etc.), so today the test ignores
 *   the form values and tests the SAVED config. The DTO accepts the
 *   nested shape the caller sends PLUS the flat fields (a flat
 *   caller would exercise the service's override path).
 * - savePipelineSettings: MaritimePipelineSettingsTab sends the full
 *   config from the GET; MaritimeContext sends Partial updates. All
 *   fields optional (the service merges { ...current, ...dto }).
 *   `defaultExchangeRate` is a legacy key the service deletes on
 *   save ("even if an old client still sends it") and strips on
 *   read — accepted here as optional so an old client does not 400.
 */

// Mail provider values the settings form sends.
export const MAIL_PROVIDERS = ['outlook', 'gmail', 'custom'] as const;

export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export class SaveMailSettingsDto {
  @IsIn(MAIL_PROVIDERS)
  @IsOptional()
  outgoingProvider?: MailProvider;

  @IsString()
  @IsOptional()
  smtpHost?: string;

  @IsInt()
  @IsOptional()
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;

  @IsString()
  @IsOptional()
  smtpUser?: string;

  @IsString()
  @IsOptional()
  smtpPassword?: string;

  @IsString()
  @IsOptional()
  fromName?: string;

  @IsString()
  @IsOptional()
  fromEmail?: string;

  @IsIn(MAIL_PROVIDERS)
  @IsOptional()
  incomingProvider?: MailProvider;

  @IsString()
  @IsOptional()
  imapHost?: string;

  @IsInt()
  @IsOptional()
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  imapSecure?: boolean;

  @IsString()
  @IsOptional()
  imapUser?: string;

  @IsString()
  @IsOptional()
  imapPassword?: string;

  @IsBoolean()
  @IsOptional()
  autoReadInboundBids?: boolean;

  @IsString()
  @IsOptional()
  lastSyncAt?: string;

  @IsString()
  @IsOptional()
  lastSyncStatus?: string;

  @IsString()
  @IsOptional()
  lastSyncDetails?: string;

  @IsString()
  @IsOptional()
  emailSubjectTemplate?: string;

  @IsString()
  @IsOptional()
  emailIntroTemplate?: string;

  @IsString()
  @IsOptional()
  emailSignatureTemplate?: string;

  // Not in the MaritimeMailConfig interface, but the service reads
  // and persists it — the settings form sends it with every save.
  @IsString()
  @IsOptional()
  companyOfficialEmail?: string;
}

// The nested connection shapes the settings form sends on the test
// endpoint (see header: the service reads the flat fields instead).
export class MailSmtpConnectionDto {
  @IsString()
  @IsOptional()
  host?: string;

  @IsInt()
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsOptional()
  user?: string;

  @IsString()
  @IsOptional()
  password?: string;
}

export class MailImapConnectionDto {
  @IsString()
  @IsOptional()
  host?: string;

  @IsInt()
  @IsOptional()
  port?: number;

  @IsBoolean()
  @IsOptional()
  secure?: boolean;

  @IsString()
  @IsOptional()
  user?: string;

  @IsString()
  @IsOptional()
  password?: string;
}

export class TestMailConnectionDto {
  // Nested shapes the only caller sends.
  @ValidateNested()
  @Type(() => MailSmtpConnectionDto)
  @IsOptional()
  smtp?: MailSmtpConnectionDto;

  @ValidateNested()
  @Type(() => MailImapConnectionDto)
  @IsOptional()
  imap?: MailImapConnectionDto;

  // Flat fields the service actually reads (its override path).
  @IsIn(MAIL_PROVIDERS)
  @IsOptional()
  outgoingProvider?: MailProvider;

  @IsString()
  @IsOptional()
  smtpHost?: string;

  @IsInt()
  @IsOptional()
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;

  @IsString()
  @IsOptional()
  smtpUser?: string;

  @IsString()
  @IsOptional()
  smtpPassword?: string;

  @IsString()
  @IsOptional()
  fromName?: string;

  @IsString()
  @IsOptional()
  fromEmail?: string;

  @IsIn(MAIL_PROVIDERS)
  @IsOptional()
  incomingProvider?: MailProvider;

  @IsString()
  @IsOptional()
  imapHost?: string;

  @IsInt()
  @IsOptional()
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  imapSecure?: boolean;

  @IsString()
  @IsOptional()
  imapUser?: string;

  @IsString()
  @IsOptional()
  imapPassword?: string;

  @IsBoolean()
  @IsOptional()
  autoReadInboundBids?: boolean;

  @IsString()
  @IsOptional()
  lastSyncAt?: string;

  @IsString()
  @IsOptional()
  lastSyncStatus?: string;

  @IsString()
  @IsOptional()
  lastSyncDetails?: string;

  @IsString()
  @IsOptional()
  emailSubjectTemplate?: string;

  @IsString()
  @IsOptional()
  emailIntroTemplate?: string;

  @IsString()
  @IsOptional()
  emailSignatureTemplate?: string;

  @IsString()
  @IsOptional()
  companyOfficialEmail?: string;
}

// Pipeline automation modes the settings tab sends.
export const PIPELINE_AUTOMATION_MODES = ['manual', 'hybrid', 'full_autonomous'] as const;

export type PipelineAutomationMode = (typeof PIPELINE_AUTOMATION_MODES)[number];

export const PIPELINE_MARGIN_TYPES = ['fixed', 'percentage'] as const;

export type PipelineMarginType = (typeof PIPELINE_MARGIN_TYPES)[number];

export class SavePipelineSettingsDto {
  @IsBoolean()
  @IsOptional()
  enableSeaFreight?: boolean;

  @IsBoolean()
  @IsOptional()
  enableAirFreight?: boolean;

  @IsBoolean()
  @IsOptional()
  enableRoadFreight?: boolean;

  @IsIn(PIPELINE_AUTOMATION_MODES)
  @IsOptional()
  automationMode?: PipelineAutomationMode;

  @IsIn(PIPELINE_MARGIN_TYPES)
  @IsOptional()
  defaultMarginType?: PipelineMarginType;

  @IsNumber()
  @IsOptional()
  defaultMarginValue?: number;

  @IsNumber()
  @IsOptional()
  marginFloor?: number;

  @IsNumber()
  @IsOptional()
  rfqCutOffHoursStandard?: number;

  @IsNumber()
  @IsOptional()
  rfqCutOffHoursUrgent?: number;

  @IsBoolean()
  @IsOptional()
  earlyAwardingEnabled?: boolean;

  @IsNumber()
  @IsOptional()
  earlyAwardingMinFreeDays?: number;

  @IsBoolean()
  @IsOptional()
  requireManualRfqDispatch?: boolean;

  @IsBoolean()
  @IsOptional()
  requireManualAwardAndMargin?: boolean;

  @IsBoolean()
  @IsOptional()
  requireManualQuoteDispatch?: boolean;

  @IsBoolean()
  @IsOptional()
  autoSendWhatsAppQuote?: boolean;

  @IsBoolean()
  @IsOptional()
  autoSendEmailQuote?: boolean;

  // Legacy key: the service deletes it on save and strips it on read.
  // Accepted so an old client still sending it does not 400.
  @IsNumber()
  @IsOptional()
  defaultExchangeRate?: number;
}
