/*
 * New file: backend/src/modules/settings/dto/whatsapp-webhook.dto.ts
 *
 * D7 (INV-DTO-SETTINGS-22): DTO class for the two WhatsApp webhook
 * endpoints (POST /api/whatsapp/webhook + /api/whatsapp/webhook/
 * :tenantId), which took `any` — a provider payload the pipe could
 * not validate at all.
 *
 * The DTO enumerates the three provider formats + the generic /
 * simulator format at the TOP level only (Meta: object + entry;
 * UltraMsg: event_type + data; GreenAPI: typeWebhook + messageData
 * + senderData + instanceData + timestamp + idMessage; generic:
 * phone / message / text / question / simulate). Nested contents
 * are NOT validated (unknown[] / object) — providers change their
 * nested shapes without notice, and the service only reads the
 * top-level keys below. A NEW provider top-level key must be added
 * here, or the pipe 400s it (recorded risk).
 */

import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class WhatsAppWebhookDto {
  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsArray()
  entry?: unknown[];

  @IsOptional()
  @IsString()
  event_type?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  typeWebhook?: string;

  @IsOptional()
  @IsObject()
  messageData?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  senderData?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  instanceData?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  timestamp?: number;

  @IsOptional()
  @IsString()
  idMessage?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @IsBoolean()
  simulate?: boolean;
}
