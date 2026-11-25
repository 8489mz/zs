import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import type { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import type { AiProvider } from './ai-copilot-types';

export class AiCopilotTestKeys {
  constructor(
    private readonly bound: {
      getEffectiveAiConfig: (tenantId: string) => Promise<{
        provider: AiProvider;
        apiKey: string | null;
        model: string;
        baseUrl?: string;
      }>;
      getEffectiveGeminiApiKey: (tenantId: string) => Promise<string | null>;
      testOpenAiKey: (
        apiKey: string,
        model?: string,
        baseUrl?: string,
      ) => Promise<{ success: boolean; message: string; model?: string; provider?: string }>;
    },
  ) {}

  private async getEffectiveAiConfig(tenantId: string): Promise<{
    provider: AiProvider;
    apiKey: string | null;
    model: string;
    baseUrl?: string;
  }> {
    return this.bound.getEffectiveAiConfig(tenantId);
  }

  private async getEffectiveGeminiApiKey(tenantId: string): Promise<string | null> {
    return this.bound.getEffectiveGeminiApiKey(tenantId);
  }

  private async testOpenAiKey(
    apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1',
  ): Promise<{ success: boolean; message: string; model?: string; provider?: string }> {
    return this.bound.testOpenAiKey(apiKey, model, baseUrl);
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
    const { tenantId } = actor ? requireTenantScope(actor) : { tenantId: '' };
    const config = tenantId ? await this.getEffectiveAiConfig(tenantId) : { provider: 'gemini' as AiProvider, apiKey: null, model: '' };

    const keyToTest = (params.apiKey || config.apiKey || '').trim();
    const provider = params.provider || (keyToTest.startsWith('sk-') ? 'openai' : config.provider || 'gemini');
    const rawModel = (params.model !== undefined ? params.model : config.model) || '';
    const model = rawModel && !/[^\x20-\x7E]/.test(rawModel) ? rawModel.trim() : '';
    const baseUrl = params.baseUrl || (config as any).baseUrl || 'https://api.openai.com/v1';

    if (!keyToTest) {
      return { success: false, message: 'لم يتم توفير مفتاح الذكاء الاصطناعي لاختباره' };
    }

    if (provider === 'openai' || provider === 'custom' || keyToTest.startsWith('sk-')) {
      return this.testOpenAiKey(keyToTest, model || 'gpt-4o-mini', baseUrl);
    }

    return this.testGeminiKey(keyToTest, actor, model);
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
    let keyToTest = (apiKey || '').trim();
    if (!keyToTest && actor) {
      const { tenantId } = requireTenantScope(actor);
      keyToTest = (await this.getEffectiveGeminiApiKey(tenantId)) || '';
    }

    if (!keyToTest) {
      return { success: false, message: 'لم يتم توفير مفتاح Gemini لاختباره' };
    }

    // 1. Fetch available models from Google API
    let availableModels: Array<{ id: string; displayName: string }> = [];
    let detectedModel: string | null = null;
    let listError: string | null = null;

    for (const apiVer of ['v1beta', 'v1']) {
      try {
        const listRes = await fetch(`https://generativelanguage.googleapis.com/${apiVer}/models?pageSize=100`, {
          headers: { 'x-goog-api-key': keyToTest },
        });

        const listData = await listRes.json().catch(() => ({}));
        if (listRes.ok && Array.isArray(listData?.models)) {
          const contentModels = listData.models.filter((m: any) =>
            m.supportedGenerationMethods?.includes('generateContent'),
          );

          if (contentModels.length > 0) {
            availableModels = contentModels.map((m: any) => ({
              id: m.name.replace(/^models\//, ''),
              displayName: m.displayName || m.name.replace(/^models\//, ''),
            }));

            const flash =
              contentModels.find((m: any) => m.name?.includes('3.8-flash')) ||
              contentModels.find((m: any) => m.name?.includes('3.7-flash')) ||
              contentModels.find((m: any) => m.name?.includes('flash'));
            const chosen = flash || contentModels[0];
            if (chosen?.name) {
              detectedModel = chosen.name.replace(/^models\//, '');
              break;
            }
          }
        } else if (listData?.error?.message) {
          listError = listData.error.message;
        }
      } catch (err: any) {
        listError = err?.message || String(err);
      }
    }

    // 2. If a specific valid model was requested by the user, test it directly first
    const cleanRequested = (requestedModel || '').trim();
    const isValidRequestedModel = cleanRequested && !/[^\x20-\x7E]/.test(cleanRequested);
    let requestedModelError: string | null = null;

    if (isValidRequestedModel) {
      for (const apiVer of ['v1beta', 'v1']) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        try {
          const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${cleanRequested}:generateContent`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': keyToTest,
            },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Respond with OK' }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
          });

          if (res.ok) {
            return {
              success: true,
              message: `تم الاتصال بنموذج Google (${cleanRequested}) الذي حددته بنجاح وفاعلية!`,
              model: cleanRequested,
              availableModels: availableModels.length > 0 ? availableModels : undefined,
            };
          }

          const errData = await res.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${res.status}`;
          requestedModelError = errMsg;
        } catch (err: any) {
          requestedModelError = err?.message || String(err);
        } finally {
          clearTimeout(timeout);
        }
      }

      // If the user explicitly requested a specific model and Google failed to respond for it,
      // report the exact error from Google rather than secretly switching models!
      const friendlyErr = requestedModelError?.includes('503')
        ? 'النموذج يواجه ضغطاً مؤقتاً في سيرفرات Google حالياً (503 High Demand) - Spikes in demand are temporary.'
        : requestedModelError?.includes('404') || requestedModelError?.includes('no longer available')
        ? 'النموذج غير متاح أو تم إيقافه لمفتاحك من قِبل Google (404 Deprecated).'
        : requestedModelError?.includes('429')
        ? 'تم تجاوز الحصة المتاحة لهذا النموذج من قِبل Google (429 Quota Exceeded).'
        : requestedModelError || 'فشل الاتصال بالنموذج المحدد من قِبل Google';

      return {
        success: false,
        message: `تعذر الاتصال بالنموذج المحدد (${cleanRequested}) من قِبل Google: ${friendlyErr}`,
        model: cleanRequested,
        availableModels: availableModels.length > 0 ? availableModels : undefined,
      };
    }

    // 3. Auto mode (no specific model requested): test models discovered from Google API
    const candidateModels = [
      ...(detectedModel ? [detectedModel] : []),
      ...(availableModels.length > 0 ? availableModels.map((m) => m.id) : []),
      'gemini-3.6-flash',
      'gemini-flash-latest',
    ];
    const uniqueModels = Array.from(new Set(candidateModels));

    let lastError = listError || '';

    for (const model of uniqueModels) {
      for (const apiVer of ['v1beta', 'v1']) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);

        try {
          const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${model}:generateContent`;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': keyToTest,
            },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Respond with OK' }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
          });

          if (res.ok) {
            return {
              success: true,
              message: `تم فحص المفتاح والاتصال بنموذج Google (${model}) المتاح لحسابك بنجاح!`,
              model,
              availableModels: availableModels.length > 0 ? availableModels : undefined,
            };
          }

          const errData = await res.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${res.status}`;
          lastError = errMsg;

          if (errMsg.includes('API_KEY_SERVICE_BLOCKED')) {
            return {
              success: false,
              message: 'المفتاح محظور (API_KEY_SERVICE_BLOCKED): يرجى في صفحة Google AI Studio الضغط على "Create API key in new project" لإنشاء مفتاح في مشروع جديد غير مقيد.',
            };
          }

          if (res.status !== 404 && !errMsg.toLowerCase().includes('not found')) {
            break;
          }
        } catch (err: any) {
          lastError = err?.message || String(err);
        } finally {
          clearTimeout(timeout);
        }
      }
    }

    return {
      success: false,
      message: `فشل الاتصال بجوجل: ${lastError}`,
      availableModels: availableModels.length > 0 ? availableModels : undefined,
    };
  }
}
