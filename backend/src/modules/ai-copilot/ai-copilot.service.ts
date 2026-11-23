import { Inject, Injectable, Logger } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';

import { AiCopilotAsk } from './ai-copilot/ai-copilot-ask';
import { AiCopilotConfig } from './ai-copilot/ai-copilot-config';
import { AiCopilotTestKeys } from './ai-copilot/ai-copilot-test-keys';
import { AiCopilotSalesBot } from './ai-copilot/ai-copilot-sales-bot';
import { AiCopilotOpenAi } from './ai-copilot/ai-copilot-openai';
import type { AiProvider, CopilotResponse } from './ai-copilot/ai-copilot-types';
export type { CopilotResponse } from './ai-copilot/ai-copilot-types';

@Injectable()
export class AiCopilotService {
  private readonly logger = new Logger(AiCopilotService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
  ) {}

  private s1Instance?: AiCopilotAsk;
  private get s1(): AiCopilotAsk {
    return (this.s1Instance ??= new AiCopilotAsk(
      this.db,
      this.logger,
      {
        getEffectiveAiConfig: (tenantId) => this.s2.getEffectiveAiConfig(tenantId),
        askOpenAi: (question, snapshot, apiKey, model, baseUrl) =>
          this.s5.askOpenAi(question, snapshot, apiKey, model, baseUrl)
      }
    ));
  }

  private s2Instance?: AiCopilotConfig;
  private get s2(): AiCopilotConfig {
    return (this.s2Instance ??= new AiCopilotConfig(
      this.db,
      this.logger
    ));
  }

  private s3Instance?: AiCopilotTestKeys;
  private get s3(): AiCopilotTestKeys {
    return (this.s3Instance ??= new AiCopilotTestKeys(
      {
        getEffectiveAiConfig: (tenantId) => this.s2.getEffectiveAiConfig(tenantId),
        getEffectiveGeminiApiKey: (tenantId) => this.s2.getEffectiveGeminiApiKey(tenantId),
        testOpenAiKey: (apiKey, model, baseUrl) => this.s5.testOpenAiKey(apiKey, model, baseUrl)
      }
    ));
  }

  private s4Instance?: AiCopilotSalesBot;
  private get s4(): AiCopilotSalesBot {
    return (this.s4Instance ??= new AiCopilotSalesBot(
      this.db,
      this.logger,
      {
        getEffectiveAiConfig: (tenantId) => this.s2.getEffectiveAiConfig(tenantId),
        askOpenAiSalesBot: (customerMessage, products, businessInfo, apiKey, model, baseUrl) =>
          this.s5.askOpenAiSalesBot(customerMessage, products, businessInfo, apiKey, model, baseUrl)
      }
    ));
  }

  private s5Instance?: AiCopilotOpenAi;
  private get s5(): AiCopilotOpenAi {
    return (this.s5Instance ??= new AiCopilotOpenAi());
  }

  async ask(question: string, actor: AuthContext): Promise<CopilotResponse> {
    return this.s1.ask(question, actor);
  }

  async getEffectiveAiConfig(tenantId: string): Promise<{
    provider: AiProvider;
    apiKey: string | null;
    model: string;
    baseUrl?: string;
  }> {
    return this.s2.getEffectiveAiConfig(tenantId);
  }

  async getEffectiveGeminiApiKey(tenantId: string): Promise<string | null> {
    return this.s2.getEffectiveGeminiApiKey(tenantId);
  }

  async getConfig(actor: AuthContext): Promise<{
    hasApiKey: boolean;
    isCustomKey: boolean;
    maskedKey: string;
    engine: 'gemini_llm' | 'openai_llm' | 'custom_llm' | 'local_analytics';
    provider: AiProvider;
    model: string;
    baseUrl?: string;
  }> {
    return this.s2.getConfig(actor);
  }

  async saveConfig(
    payload: {
      provider?: AiProvider;
      apiKey?: string;
      geminiApiKey?: string;
      model?: string;
      baseUrl?: string;
    },
    actor: AuthContext,
  ): Promise<{ ok: boolean }> {
    return this.s2.saveConfig(payload, actor);
  }

  async getAvailableModels(
    params: { apiKey?: string; provider?: AiProvider },
    actor: AuthContext,
  ): Promise<{ models: Array<{ id: string; displayName: string }> }> {
    return this.s2.getAvailableModels(params, actor);
  }

  async testAiKey(
    params: {
      apiKey?: string;
      provider?: AiProvider;
      model?: string;
      baseUrl?: string;
    },
    actor?: AuthContext,
  ): Promise<{ success: boolean; message: string; model?: string; provider?: string; availableModels?: Array<{ id: string; displayName: string }> }> {
    return this.s3.testAiKey(params, actor);
  }

  async testGeminiKey(
    apiKey?: string,
    actor?: AuthContext,
    requestedModel?: string,
  ): Promise<{
    success: boolean;
    message: string;
    model?: string;
    availableModels?: Array<{ id: string; displayName: string }>;
  }> {
    return this.s3.testGeminiKey(apiKey, actor, requestedModel);
  }

  async generateSalesBotReply(params: {
    question: string;
    tenantId: string;
    customerPhone?: string;
  }): Promise<{ reply: string; matchedProducts: any[]; engine: 'gemini_llm' | 'local_smart' }> {
    return this.s4.generateSalesBotReply(params);
  }

  async testOpenAiKey(
    apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1',
  ): Promise<{ success: boolean; message: string; model?: string; provider?: string }> {
    return this.s5.testOpenAiKey(apiKey, model, baseUrl);
  }
}
