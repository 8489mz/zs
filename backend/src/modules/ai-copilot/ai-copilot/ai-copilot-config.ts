import { sql } from '../../../database/kysely';
import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { ForbiddenException } from '@nestjs/common';
import type { AiProvider } from './ai-copilot-types';
import type { Logger } from '@nestjs/common';

export class AiCopilotConfig {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly logger: Logger,
  ) {}

  async getEffectiveAiConfig(tenantId: string): Promise<{
    provider: AiProvider;
    apiKey: string | null;
    model: string;
    baseUrl?: string;
  }> {
    let customKey: string | null = null;
    let customProvider: AiProvider = 'gemini';
    let customModel = '';
    let customBaseUrl = '';

    try {
      const rows = await this.db
        .selectFrom('settings')
        .select(['key', 'value'])
        .where('tenant_id', '=', tenantId)
        .where('key', 'in', ['ai_api_key', 'gemini_api_key', 'ai_provider', 'ai_model', 'ai_base_url'])
        .execute();

      const map = new Map<string, any>();
      for (const r of rows) {
        try { map.set(r.key, JSON.parse(r.value)); } catch { map.set(r.key, r.value); }
      }

      customKey = map.get('ai_api_key') || map.get('gemini_api_key') || null;
      if (typeof customKey === 'string') customKey = customKey.trim();

      const p = map.get('ai_provider');
      if (p === 'openai' || p === 'custom' || p === 'gemini') {
        customProvider = p;
      } else if (customKey?.startsWith('sk-')) {
        customProvider = 'openai';
      }

      customModel = String(map.get('ai_model') || '').trim();
      if (/[^\x20-\x7E]/.test(customModel)) {
        customModel = '';
      }
      customBaseUrl = String(map.get('ai_base_url') || '').trim();
    } catch (err: any) {
      this.logger.warn(`Failed to read tenant AI config: ${err?.message || err}`);
    }

    if (!customKey) {
      const envOpenAiKey = process.env.OPENAI_API_KEY;
      const envGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.AI_COPILOT_API_KEY;
      if (envOpenAiKey && envOpenAiKey.trim().length > 5) {
        return {
          provider: 'openai',
          apiKey: envOpenAiKey.trim(),
          model: customModel || 'gpt-4o-mini',
          baseUrl: customBaseUrl || 'https://api.openai.com/v1',
        };
      }
      if (envGeminiKey && envGeminiKey.trim().length > 5) {
        return {
          provider: 'gemini',
          apiKey: envGeminiKey.trim(),
          model: customModel || 'gemini-flash-latest',
        };
      }
      return {
        provider: customProvider,
        apiKey: null,
        model: customModel || (customProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-latest'),
      };
    }

    return {
      provider: customProvider,
      apiKey: customKey,
      model: customModel || (customProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-latest'),
      baseUrl: customBaseUrl || (customProvider === 'openai' ? 'https://api.openai.com/v1' : undefined),
    };
  }

  async getEffectiveGeminiApiKey(tenantId: string): Promise<string | null> {
    const config = await this.getEffectiveAiConfig(tenantId);
    return config.apiKey;
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
    const { tenantId } = requireTenantScope(actor);
    const aiConfig = await this.getEffectiveAiConfig(tenantId);
    const hasKey = !!(aiConfig.apiKey && aiConfig.apiKey.trim());

    let masked = '';
    if (aiConfig.apiKey && aiConfig.apiKey.length > 8) {
      masked = `${aiConfig.apiKey.slice(0, 4)}••••${aiConfig.apiKey.slice(-4)}`;
    }

    // Clean model: return actual technical model identifier (e.g. gemini-3.6-flash), sanitizing any legacy Arabic string
    const cleanModel = (aiConfig.model && !/[^\x20-\x7E]/.test(aiConfig.model)) ? aiConfig.model : '';

    return {
      hasApiKey: hasKey,
      isCustomKey: hasKey,
      maskedKey: masked,
      engine: !hasKey
        ? 'local_analytics'
        : aiConfig.provider === 'openai'
          ? 'openai_llm'
          : aiConfig.provider === 'custom'
            ? 'custom_llm'
            : 'gemini_llm',
      provider: aiConfig.provider,
      model: cleanModel,
      baseUrl: aiConfig.baseUrl,
    };
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
    if (actor.role !== 'admin' && actor.role !== 'super_admin'
      && !actor.permissions?.includes('settings') && !actor.permissions?.includes('canManageSettings')) {
      throw new ForbiddenException('Missing settings management permission');
    }
    const { tenantId, accountId } = requireTenantScope(actor);
    const existingConfig = await this.getEffectiveAiConfig(tenantId);

    // Explicit delete when apiKey is explicitly passed as empty string or null
    const isExplicitDelete = payload.apiKey === '' || payload.apiKey === null;
    const isExplicitKeyPassed = typeof payload.apiKey === 'string' && payload.apiKey.trim().length > 0;
    const keyVal = isExplicitDelete ? '' : isExplicitKeyPassed ? payload.apiKey!.trim() : (existingConfig.apiKey || '');

    let provider = payload.provider || existingConfig.provider || (keyVal.startsWith('sk-') ? 'openai' : 'gemini');
    let model = isExplicitDelete ? '' : (payload.model !== undefined ? payload.model.trim() : (existingConfig.model || ''));
    if (/[^\x20-\x7E]/.test(model)) {
      model = '';
    }
    const baseUrl = isExplicitDelete ? '' : (payload.baseUrl !== undefined ? payload.baseUrl.trim() : ((existingConfig as any).baseUrl || ''));

    if (keyVal) {
      await sql`
        INSERT INTO settings (key, value, tenant_id, account_id)
        VALUES
          ('ai_api_key', ${JSON.stringify(keyVal)}, ${tenantId}, ${accountId}),
          ('gemini_api_key', ${JSON.stringify(keyVal)}, ${tenantId}, ${accountId}),
          ('ai_provider', ${JSON.stringify(provider)}, ${tenantId}, ${accountId}),
          ('ai_model', ${JSON.stringify(model)}, ${tenantId}, ${accountId}),
          ('ai_base_url', ${JSON.stringify(baseUrl)}, ${tenantId}, ${accountId})
        ON CONFLICT (tenant_id, key)
        DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
      `.execute(this.db);
    } else {
      await this.db
        .deleteFrom('settings')
        .where('tenant_id', '=', tenantId)
        .where('key', 'in', ['ai_api_key', 'gemini_api_key', 'ai_provider', 'ai_model', 'ai_base_url'])
        .execute();
    }

    return { ok: true };
  }

  async getAvailableModels(
    params: { apiKey?: string; provider?: AiProvider },
    actor: AuthContext,
  ): Promise<{ models: Array<{ id: string; displayName: string }> }> {
    const { tenantId } = requireTenantScope(actor);
    const config = await this.getEffectiveAiConfig(tenantId);
    const keyToUse = (params.apiKey || config.apiKey || '').trim();
    const provider = params.provider || config.provider || 'gemini';

    if (provider === 'gemini' && keyToUse) {
      for (const apiVer of ['v1beta', 'v1']) {
        try {
          const listRes = await fetch(`https://generativelanguage.googleapis.com/${apiVer}/models?pageSize=100`, {
            headers: { 'x-goog-api-key': keyToUse },
          });

          const listData = await listRes.json().catch(() => ({}));
          if (listRes.ok && Array.isArray(listData?.models)) {
            const models = listData.models
              .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
              .map((m: any) => ({
                id: m.name.replace(/^models\//, ''),
                displayName: m.displayName || m.name.replace(/^models\//, ''),
              }));
            if (models.length > 0) {
              return { models };
            }
          }
        } catch {
          // ignore error and try next version
        }
      }
    }

    return {
      models: [],
    };
  }
}
