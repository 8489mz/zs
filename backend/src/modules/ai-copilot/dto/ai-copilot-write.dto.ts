/*
 * D10 — ai-copilot write DTOs (new file; 5 sites).
 *
 * Caller traps (verified against AiBusinessCopilotModal +
 * SettingsWhatsAppGatewaySection at 7413c4f3e):
 * - AgentChatDto.message is REQUIRED (plain string — the service trims
 *   and never throws on empty); sessionId is sent only when set.
 * - AddKnowledgeSourceDto.title + rawText are REQUIRED (the service
 *   throws when either is missing); sourceType stays a PLAIN STRING
 *   (the service defaults an unknown type to 'document').
 * - SaveAiConfigDto: ALL fields optional; apiKey '' is an explicit
 *   delete (NO @IsNotEmpty); the service merges with the saved config
 *   and infers the provider.
 * - TestAiKeyDto / GetAiModelsDto: ALL fields optional; the caller
 *   always sends provider.
 */
import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';

export class AgentChatDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class AddKnowledgeSourceDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsString()
  rawText!: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SaveAiConfigDto {
  @IsOptional()
  @IsEnum(['gemini', 'openai', 'custom'])
  provider?: 'gemini' | 'openai' | 'custom';

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  geminiApiKey?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;
}

export class TestAiKeyDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsEnum(['gemini', 'openai', 'custom'])
  provider?: 'gemini' | 'openai' | 'custom';

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;
}

export class GetAiModelsDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsEnum(['gemini', 'openai', 'custom'])
  provider?: 'gemini' | 'openai' | 'custom';
}
