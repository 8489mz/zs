export class AiCopilotOpenAi {
  async testOpenAiKey(
    apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1',
  ): Promise<{ success: boolean; message: string; model?: string; provider?: string }> {
    const cleanUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(`${cleanUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Say OK' }],
          max_tokens: 5,
        }),
      });

      if (res.ok) {
        return {
          success: true,
          message: `تم الاتصال بنجاح بمحرك OpenAI (${model || 'gpt-4o-mini'})!`,
          model: model || 'gpt-4o-mini',
          provider: 'openai',
        };
      }

      const errData = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${res.status}`;
      return {
        success: false,
        message: `فشل الاتصال بـ OpenAI: ${errMsg}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `تعذر الاتصال بمحرك OpenAI: ${err?.message || String(err)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async askOpenAi(
    question: string,
    snapshot: Record<string, unknown>,
    apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1',
  ): Promise<{ answer: string; suggestedQuestions: string[] } | null> {
    const prompt = `أنت (زاد AI)، المساعد والمستشار التجاري والمالي الذكي لنظام إدارة المنشآت Z-Systems.
بيانات النشاط الحالية:
${JSON.stringify(snapshot, null, 2)}

قواعدك الصارمة:
1. أجب «على قد السؤال بالضبط» وبإيجاز شديد ومباشر (من سطر إلى 3 أسطر كحد أقصى).
2. لا تسرد تقريراً شاملاً لم يطلبه المستخدم.
3. إذا سأل المستخدم عن بند محدد فقط، أجب عنه بالتحديد فقط بالأرقام.
4. إذا كان السؤال دردشة أو تحية، أجب بروح ذكية ومرحة وموجزة في سطر واحد دون سرد بيانات.
5. تحدث باللغة العربية بأسلوب راقٍ وموجز.
6. اقترح فقط 3 أسئلة تالية قصيرة تناسب نفس موضوع السؤال.

السؤال: "${question}"

أجب حصراً بصيغة JSON صالحة:
{
  "answer": "الإجابة المباشرة والموجزة",
  "suggestedQuestions": ["سؤال 1", "سؤال 2", "سؤال 3"]
}`;

    const cleanUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(`${cleanUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a helpful business analytics assistant. Respond only with JSON as requested.' },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      if (parsed.answer) {
        return {
          answer: String(parsed.answer),
          suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.map(String) : [],
        };
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async askOpenAiSalesBot(
    customerMessage: string,
    products: Array<{ name: string; price: number; stock: number; color?: string | null; size?: string | null }>,
    businessInfo: { name: string; currency: string; storefrontUrl?: string; customPrompt?: string },
    apiKey: string,
    model = 'gpt-4o-mini',
    baseUrl = 'https://api.openai.com/v1',
  ): Promise<string | null> {
    const catalogText = products.slice(0, 45).map((p, idx) =>
      `${idx + 1}. ${p.name} | السعر: ${p.price} ${businessInfo.currency} | المتوفر بالمخزن: ${p.stock > 0 ? p.stock + ' قطعة' : 'غير متوفر حالياً'}${p.color ? ' | اللون: ' + p.color : ''}${p.size ? ' | المقاس: ' + p.size : ''}`
    ).join('\n');

    const prompt = `أنت المساعد الذكي لمبيعات وخدمة عملاء متجر "${businessInfo.name}".
مهمتك: الرد على استفسار الزبون على تطبيق واتساب بأسلوب لطيف ومحترف باللهجة العربية/المصرية السلسة والمحترمة.

قواعدك الصارمة:
1. اعتمد فقط على قائمة المنتجات والأسعار المتاحة بالمخزن أدناه:
${catalogText}

2. إذا سأل العميل عن منتج متاح، اذكر سعره بدقة وتوفر المخزون، وشجعه على الشراء${businessInfo.storefrontUrl ? ` مع رابط المتجر: ${businessInfo.storefrontUrl}` : ''}.
3. إذا سأل عن منتج غير موجود أو كميته 0، اعتذر بلطف واقترح أقرب بديل إن وجد من القائمة.
4. حافظ على ردود مختصرة ومناسبة للواتساب (بين 2 إلى 4 أسطر).
5. لا تؤلف منتجات أو أسعار غير موجودة في القائمة.
${businessInfo.customPrompt ? `تعليمات التاجر الإضافية: ${businessInfo.customPrompt}` : ''}

رسالة العميل الواردة:
"${customerMessage}"

اكتب الرد النهائي الموجه للعميل مباشرة دون مقدمات أو شروحات إضافية.`;

    const cleanUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(`${cleanUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 300,
        }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
