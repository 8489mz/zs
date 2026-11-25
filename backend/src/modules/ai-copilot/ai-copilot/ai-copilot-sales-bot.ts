import type { Kysely } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { buildStorePublicBase } from '../../storefront/engines/store-public-url.engine';
import type { AiProvider } from './ai-copilot-types';
import type { Logger } from '@nestjs/common';

export class AiCopilotSalesBot {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly logger: Logger,
    private readonly bound: {
      getEffectiveAiConfig: (tenantId: string) => Promise<{
        provider: AiProvider;
        apiKey: string | null;
        model: string;
        baseUrl?: string;
      }>;
      askOpenAiSalesBot: (
        customerMessage: string,
        products: Array<{ name: string; price: number; stock: number; color?: string | null; size?: string | null }>,
        businessInfo: { name: string; currency: string; storefrontUrl?: string; customPrompt?: string },
        apiKey: string,
        model?: string,
        baseUrl?: string,
      ) => Promise<string | null>;
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

  private async askOpenAiSalesBot(
    customerMessage: string,
    products: Array<{ name: string; price: number; stock: number; color?: string | null; size?: string | null }>,
    businessInfo: { name: string; currency: string; storefrontUrl?: string; customPrompt?: string },
    apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1',
  ): Promise<string | null> {
    return this.bound.askOpenAiSalesBot(customerMessage, products, businessInfo, apiKey, model, baseUrl);
  }

  async generateSalesBotReply(params: {
    question: string;
    tenantId: string;
    customerPhone?: string;
  }): Promise<{ reply: string; matchedProducts: any[]; engine: 'gemini_llm' | 'local_smart' }> {
    const { question, tenantId } = params;
    const q = (question || '').trim();

    // 1. Get tenant business info
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'slug', 'custom_domain'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const businessName = tenant?.business_name || 'متجرنا';
    const storefrontUrl = tenant?.custom_domain
      ? `https://${tenant.custom_domain}`
      : tenant?.slug
        ? buildStorePublicBase(process.env.APP_PUBLIC_URL, tenant.slug) || undefined
        : undefined;

    // 2. Read custom bot prompt & currency
    const promptRow = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'whatsapp_gateway_ai_bot_prompt')
      .executeTakeFirst();

    let customPrompt = '';
    if (promptRow?.value) {
      try {
        customPrompt = JSON.parse(promptRow.value);
      } catch {
        customPrompt = promptRow.value;
      }
    }

    // 3. Fetch active catalog products
    const rawProducts = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'retail_price', 'stock_qty', 'color', 'size'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('stock_qty', 'desc')
      .limit(60)
      .execute();

    const products = rawProducts.map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.retail_price || 0),
      stock: Number(p.stock_qty || 0),
      color: p.color,
      size: p.size,
    }));

    // Find relevant matched products for frontend UI or metadata
    const matchedProducts = products.filter((p) => {
      const words = p.name.toLowerCase().split(/\s+/);
      const qLower = q.toLowerCase();
      return words.some((w) => w.length > 2 && qLower.includes(w)) || qLower.includes(p.name.toLowerCase());
    });

    const aiConfig = await this.getEffectiveAiConfig(tenantId);
    if (aiConfig.apiKey && aiConfig.apiKey.trim()) {
      try {
        let reply: string | null = null;
        if (aiConfig.provider === 'openai' || aiConfig.provider === 'custom' || aiConfig.apiKey.startsWith('sk-')) {
          reply = await this.askOpenAiSalesBot(
            q,
            products,
            {
              name: businessName,
              currency: 'ج.م',
              storefrontUrl,
              customPrompt,
            },
            aiConfig.apiKey.trim(),
            aiConfig.model,
            aiConfig.baseUrl,
          );
        } else {
          reply = await this.askGeminiSalesBot(
            q,
            products,
            {
              name: businessName,
              currency: 'ج.م',
              storefrontUrl,
              customPrompt,
              model: aiConfig.model,
            },
            aiConfig.apiKey.trim(),
          );
        }

        if (reply && reply.trim()) {
          return {
            reply: reply.trim(),
            matchedProducts: matchedProducts.slice(0, 5),
            engine: 'gemini_llm',
          };
        }
      } catch (err: any) {
        this.logger.warn(`AI sales bot failed, falling back to local: ${err?.message || err}`);
      }
    }

    // Fallback to local smart sales responder
    const localReply = this.runLocalSalesResponder(q, products, {
      name: businessName,
      currency: 'ج.م',
      storefrontUrl,
    });

    return {
      reply: localReply,
      matchedProducts: matchedProducts.slice(0, 5),
      engine: 'local_smart',
    };
  }

  private async askGeminiSalesBot(
    customerMessage: string,
    products: Array<{ name: string; price: number; stock: number; color?: string | null; size?: string | null }>,
    businessInfo: { name: string; currency: string; storefrontUrl?: string; customPrompt?: string; model?: string },
    apiKey: string,
  ): Promise<string | null> {
    const catalogText = products
      .slice(0, 45)
      .map(
        (p, idx) =>
          `${idx + 1}. ${p.name} | السعر: ${p.price} ${businessInfo.currency} | المتوفر بالمخزن: ${p.stock > 0 ? p.stock + ' قطعة' : 'غير متوفر حالياً'}${p.color ? ' | اللون: ' + p.color : ''}${p.size ? ' | المقاس: ' + p.size : ''}`,
      )
      .join('\n');

    const prompt = `أنت المساعد الذكي لمبيعات وخدمة عملاء متجر "${businessInfo.name}".
مهمتك: الرد على استفسار الزبون على تطبيق واتساب بأسلوب لطيف ومحترف باللهجة العربية/المصرية السلسة والمحترمة.

قواعدك الصارمة:
1. اعتمد فقط على قائمة المنتجات والأسعار المتاحة بالمخزن أدناه:
${catalogText}

2. إذا سأل العميل عن منتج متاح، اذكر سعره بدقة وتوفر المخزون، وشجعه على الشراء${businessInfo.storefrontUrl ? ` مع رابط المتجر: ${businessInfo.storefrontUrl}` : ''}.
3. إذا سأل عن منتج غير موجود أو كميته 0، اعتذر بلطف ولباقة واقترح أقرب بديل إن وجد من القائمة.
4. حافظ على ردود مختصرة ومناسبة للواتساب (بين 2 إلى 4 أسطر)، مريحة للقراءة وبإيموجيز لطيفة غير مبالغ فيها.
5. لا تؤلف منتجات أو أسعار غير موجودة في القائمة.
${businessInfo.customPrompt ? `تعليمات التاجر الإضافية: ${businessInfo.customPrompt}` : ''}

رسالة العميل الواردة:
"${customerMessage}"

اكتب الرد النهائي الموجه للعميل مباشرة دون مقدمات أو شروحات إضافية.`;

    const cleanModel = (businessInfo.model || '').trim();
    const candidateModels = [
      ...(cleanModel ? [cleanModel] : []),
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-2.0-flash-exp',
      'gemini-1.5-flash',
      'gemini-pro',
    ];

    for (const model of candidateModels) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.4,
            },
          }),
        });

        if (!res.ok) {
          if (res.status === 404) continue;
          return null;
        }

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) return rawText.trim();
      } catch {
        // try next
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }

  private runLocalSalesResponder(
    customerMessage: string,
    products: Array<{ name: string; price: number; stock: number }>,
    businessInfo: { name: string; currency: string; storefrontUrl?: string },
  ): string {
    const q = (customerMessage || '').toLowerCase();
    const matched = products.filter((p) => {
      const words = p.name.toLowerCase().split(/\s+/);
      return words.some((w) => w.length > 2 && q.includes(w)) || q.includes(p.name.toLowerCase());
    });

    if (matched.length > 0) {
      const top = matched.slice(0, 3);
      const itemsList = top
        .map(
          (p) =>
            `• *${p.name}*: سعره ${p.price} ${businessInfo.currency} (${p.stock > 0 ? `متوفر ${p.stock} قطعة` : 'غير متوفر حالياً'})`,
        )
        .join('\n');
      return `أهلاً بك يا فندم في ${businessInfo.name}! 🌟\n\nبخصوص استفسارك، إليك المنتجات المتوفرة:\n${itemsList}\n\n${businessInfo.storefrontUrl ? `تقدر تطلب أونلاين مباشرة عبر متجرنا: ${businessInfo.storefrontUrl}\n` : ''}لو محتاج أي مساعدة في الطلب أنا تحت أمرك!`;
    }

    return `أهلاً بك في ${businessInfo.name}! 🌟\nسعداء بتواصلك معنا. يمكنك استعراض كافة منتجاتنا وأحدث العروض والأسعار عبر المتجر:\n${businessInfo.storefrontUrl || 'متجرنا الإلكتروني'}\n\nأو يمكنك توضيح اسم الصنف المطلوب وسأوافيك بتفاصيله فوراً!`;
  }
}
