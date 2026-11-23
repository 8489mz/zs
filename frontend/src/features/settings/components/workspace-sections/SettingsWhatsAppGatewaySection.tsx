import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { toast } from '@/shared/components/system-alert';
import { useAuthStore } from '@/stores/auth-store';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import type { AiConfigResponse, SimChatMessage, WhatsAppGatewayConfig } from './settings-whatsapp-gateway-section/settings-whatsapp-gateway-section-shared';
export type { WhatsAppGatewayConfig } from './settings-whatsapp-gateway-section/settings-whatsapp-gateway-section-shared';
import { SettingsWhatsAppAiEngine } from './settings-whatsapp-gateway-section/settings-whatsapp-ai-engine';
import { SettingsWhatsAppAiBot } from './settings-whatsapp-gateway-section/settings-whatsapp-ai-bot';
import { SettingsWhatsAppSimulator } from './settings-whatsapp-gateway-section/settings-whatsapp-simulator';
import { SettingsWhatsAppGateway } from './settings-whatsapp-gateway-section/settings-whatsapp-gateway';


export function SettingsWhatsAppGatewaySection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tenant = useAuthStore((s) => s.tenant);
  const currentVertical = resolveCurrentVertical(tenant);
  const isMaritime = currentVertical === 'maritime';
  const isContracting = currentVertical === 'contracting';

  const [testPhone, setTestPhone] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // 1. WhatsApp Gateway Config
  const { data } = useQuery<WhatsAppGatewayConfig>({
    queryKey: ['settings-whatsapp-config'],
    queryFn: () => http<WhatsAppGatewayConfig>('/api/settings/whatsapp'),
  });

  const [form, setForm] = useState<Partial<WhatsAppGatewayConfig>>({});

  const defaultInvoiceTemplate = isMaritime
    ? 'مرحباً بكم بشركة {businessName}، مرفق تفاصيل فاتورة ومستندات الشحن رقم #{invoiceNo} بقيمة {totalAmount} عبر الرابط التالي: {invoiceLink}'
    : isContracting
    ? 'مرحباً بكم بشركة {businessName}، مرفق تفاصيل مستخلص / فاتورة الأعمال رقم #{invoiceNo} بقيمة {totalAmount} عبر الرابط التالي: {invoiceLink}'
    : 'مرحباً بك يا {customerName} في {businessName}، يسعدنا تسوقك معنا! يمكنك استعراض فاتورتك رقم #{invoiceNo} بقيمة {totalAmount} <CurrencySymbol /> عبر الرابط التالي: {invoiceLink}';

  const currentConfig: WhatsAppGatewayConfig = {
    enabled: form.enabled ?? data?.enabled ?? false,
    provider: form.provider ?? data?.provider ?? 'ultramsg',
    apiUrl: form.apiUrl ?? data?.apiUrl ?? '',
    instanceId: form.instanceId ?? data?.instanceId ?? '',
    token: form.token ?? data?.token ?? '',
    autoSendInvoice: form.autoSendInvoice ?? data?.autoSendInvoice ?? false,
    autoSendOnlineOrder: form.autoSendOnlineOrder ?? data?.autoSendOnlineOrder ?? false,
    invoiceTemplate: form.invoiceTemplate ?? data?.invoiceTemplate ?? defaultInvoiceTemplate,
    aiBotEnabled: form.aiBotEnabled ?? data?.aiBotEnabled ?? false,
    aiBotPrompt: form.aiBotPrompt ?? data?.aiBotPrompt ?? '',
    aiBotWelcomeMessage: form.aiBotWelcomeMessage ?? data?.aiBotWelcomeMessage ?? '',
    aiBotOffHoursOnly: form.aiBotOffHoursOnly ?? data?.aiBotOffHoursOnly ?? false,
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<WhatsAppGatewayConfig>) =>
      http<{ ok: boolean }>('/api/settings/whatsapp', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-whatsapp-config'] });
      toast.success('تم حفظ وتطبيق إعدادات الواتساب وبوت الذكاء الاصطناعي بنجاح!');
      setFeedback({ kind: 'success', message: 'تم حفظ إعدادات الواتساب وبوت الذكاء الاصطناعي بنجاح!' });
      setTimeout(() => setFeedback(null), 3500);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'فشل حفظ الإعدادات');
      setFeedback({ kind: 'error', message: err?.message || 'فشل حفظ الإعدادات' });
    },
  });

  const testMutation = useMutation({
    mutationFn: (phone: string) =>
      http<{ success: boolean; message?: string }>('/api/settings/whatsapp/test', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      }),
    onSuccess: (res) => {
      if (res.success) {
        setFeedback({ kind: 'success', message: 'وصل الاختبار بنجاح إلى هاتفك! البوابة تعمل وجاهزة.' });
      } else {
        setFeedback({ kind: 'error', message: res.message || 'فشل إرسال رسالة الاختبار. تأكد من البيانات والاشتراك.' });
      }
    },
    onError: (err: any) => {
      setFeedback({ kind: 'error', message: err?.message || 'خطأ أثناء فحص البوابة' });
    },
  });

  // 2. Universal AI Engine Config (Gemini / OpenAI / Custom)
  const { data: aiConfig, refetch: refetchAiConfig } = useQuery<AiConfigResponse>({
    queryKey: ['settings-ai-config'],
    queryFn: () => http<AiConfigResponse>('/api/ai-copilot/config'),
  });

  const [selectedProvider, setSelectedProvider] = useState<'gemini' | 'openai' | 'custom'>('gemini');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [geminiAvailableModels, setGeminiAvailableModels] = useState<Array<{ id: string; displayName: string }>>([]);

  const fetchKeyModels = async (keyToUse?: string) => {
    const k = (keyToUse || customApiKey).trim();
    if (!k && !aiConfig?.hasApiKey) {
      setGeminiAvailableModels([]);
      return;
    }
    setFetchingModels(true);
    try {
      const res = await http<{ models: Array<{ id: string; displayName: string }> }>('/api/ai-copilot/models', {
        method: 'POST',
        body: JSON.stringify({ apiKey: k || undefined, provider: selectedProvider }),
      });
      if (res?.models && res.models.length > 0) {
        setGeminiAvailableModels(res.models);
        try {
          localStorage.setItem('zs_gemini_models_cache', JSON.stringify(res.models));
        } catch {}
        setAiFeedback({ kind: 'success', message: `تم جلب ${res.models.length} نموذج متاح لمفتاحك من سيرفرات Google!` });
        setTimeout(() => setAiFeedback(null), 3000);
      } else {
        setGeminiAvailableModels([]);
      }
    } catch {
      setGeminiAvailableModels([]);
    } finally {
      setFetchingModels(false);
    }
  };

  // 1. Hydrate cached models from localStorage on mount (0ms, zero network calls)
  useEffect(() => {
    try {
      const cached = localStorage.getItem('zs_gemini_models_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setGeminiAvailableModels(parsed);
        }
      }
    } catch {}
  }, []);

  // 2. Hydrate saved configuration from backend without re-fetching models automatically
  useEffect(() => {
    if (aiConfig) {
      if (aiConfig.provider) {
        setSelectedProvider(aiConfig.provider);
      }
      const rawModel = (aiConfig.model || '').trim();
      const cleanModel = rawModel && !/[^\x20-\x7E]/.test(rawModel) ? rawModel : '';
      setCustomModel(cleanModel);
      if (aiConfig.baseUrl) {
        setCustomBaseUrl(aiConfig.baseUrl);
      }
      // Note: We deliberately do NOT call fetchKeyModels() automatically on page load.
      // The user's saved model is preserved and shown, and models are only queried on explicit user demand.
    }
  }, [aiConfig]);

  const handleApiKeyChange = (val: string) => {
    setCustomApiKey(val);
    const trimmed = val.trim();
    if (!trimmed) {
      if (!aiConfig?.hasApiKey) {
        setGeminiAvailableModels([]);
      }
    } else if (trimmed.startsWith('sk-')) {
      setSelectedProvider('openai');
    } else if (trimmed.startsWith('AIza') || trimmed.startsWith('AQ.')) {
      setSelectedProvider('gemini');
    }
  };

  const saveAiKeyMutation = useMutation({
    mutationFn: (payload: { apiKey?: string; provider: 'gemini' | 'openai' | 'custom'; model?: string; baseUrl?: string }) =>
      http<{ ok: boolean }>('/api/ai-copilot/config', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      refetchAiConfig();
      setAiFeedback({ kind: 'success', message: 'تم حفظ إعدادات ومفتاح محرك الذكاء الاصطناعي بنجاح!' });
      setCustomApiKey('');
      setTimeout(() => setAiFeedback(null), 3500);
    },
    onError: (err: any) => {
      setAiFeedback({ kind: 'error', message: err?.message || 'فشل حفظ إعدادات الذكاء الاصطناعي' });
    },
  });

  const deleteAiKeyMutation = useMutation({
    mutationFn: () =>
      http<{ ok: boolean }>('/api/ai-copilot/config', {
        method: 'POST',
        body: JSON.stringify({ apiKey: '' }),
      }),
    onSuccess: () => {
      refetchAiConfig();
      setCustomApiKey('');
      setCustomModel('');
      setGeminiAvailableModels([]);
      try {
        localStorage.removeItem('zs_gemini_models_cache');
      } catch {}
      setAiFeedback({ kind: 'success', message: 'تم حذف المفتاح المخصص وإلغاء الربط بنجاح!' });
      setTimeout(() => setAiFeedback(null), 3500);
    },
    onError: (err: any) => {
      setAiFeedback({ kind: 'error', message: err?.message || 'فشل حذف المفتاح المخصص' });
    },
  });

  const testAiKeyMutation = useMutation({
    mutationFn: (params?: { apiKey?: string; provider?: 'gemini' | 'openai' | 'custom'; model?: string; baseUrl?: string }) =>
      http<{ success: boolean; message: string; model?: string; availableModels?: Array<{ id: string; displayName: string }> }>('/api/ai-copilot/test-key', {
        method: 'POST',
        body: JSON.stringify({
          provider: params?.provider || selectedProvider,
          apiKey: (params?.apiKey !== undefined ? params.apiKey : customApiKey) || undefined,
          model: (params?.model !== undefined ? params.model : customModel) || undefined,
          baseUrl: (params?.baseUrl !== undefined ? params.baseUrl : customBaseUrl) || undefined,
        }),
      }),
    onSuccess: (res) => {
      if (res.success) {
        setAiFeedback({ kind: 'success', message: res.message });
        if (res.availableModels && res.availableModels.length > 0) {
          setGeminiAvailableModels(res.availableModels);
          try {
            localStorage.setItem('zs_gemini_models_cache', JSON.stringify(res.availableModels));
          } catch {}
        }
      } else {
        setAiFeedback({ kind: 'error', message: res.message });
      }
    },
    onError: (err: any) => {
      setAiFeedback({ kind: 'error', message: err?.message || 'خطأ أثناء فحص اتصال الذكاء الاصطناعي' });
    },
  });

  // 3. Interactive WhatsApp Chat Simulator
  const [simQuestion, setSimQuestion] = useState('');
  const [simChatHistory, setSimChatHistory] = useState<SimChatMessage[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: isMaritime
        ? 'أهلاً بك يا فندم! مرحباً بك في قسم الشحن والملاحة البحرية، اكتب أي استفسار حول نولون الشحن، تتبع الحاويات أو الموانئ لتجربة الرد الذكي.'
        : isContracting
        ? 'أهلاً بك يا فندم! مرحباً بك في الإدارة الهندسية، اكتب أي استفسار حول المستخلصات والمشاريع لتجربة الرد الذكي.'
        : 'أهلاً بك يا فندم! مرحباً بك في المتجر، اكتب أي استفسار عن المنتجات أو الأسعار لتجربة الرد الفوري المولد بالذكاء الاصطناعي.',
      time: 'الآن',
      engine: 'gemini_llm',
    },
  ]);

  const simulateMutation = useMutation({
    mutationFn: (question: string) =>
      http<{ handled: boolean; reply?: string; engine?: string; message?: string }>('/api/settings/whatsapp/simulate-bot', {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
    onSuccess: (res) => {
      const now = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      if (res.handled && res.reply) {
        setSimChatHistory((prev) => [
          ...prev,
          { id: String(Date.now()), sender: 'bot', text: res.reply!, time: now, engine: res.engine },
        ]);
      } else {
        setSimChatHistory((prev) => [
          ...prev,
          {
            id: String(Date.now()),
            sender: 'bot',
            text: res.message || 'عذراً، لم أتمكن من الرد. يرجى التأكد من تفعيل البوت في الإعدادات أعلاه.',
            time: now,
            engine: 'local_smart',
          },
        ]);
      }
    },
    onError: (err: any) => {
      const now = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      setSimChatHistory((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          sender: 'bot',
          text: `خطأ أثناء المحاكاة: ${err?.message || 'تعذر الاتصال بالخادم'}`,
          time: now,
        },
      ]);
    },
  });

  const handleSendSim = (text?: string) => {
    const q = (text || simQuestion).trim();
    if (!q) return;
    const now = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    setSimChatHistory((prev) => [
      ...prev,
      { id: String(Date.now()) + '-u', sender: 'customer', text: q, time: now },
    ]);
    setSimQuestion('');
    simulateMutation.mutate(q);
  };

  const handleSaveAll = () => {
    setFeedback(null);
    saveMutation.mutate(currentConfig);
  };

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/whatsapp/webhook`
    : '/api/whatsapp/webhook';

  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const handleCopyWebhook = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }} dir="rtl">
      {/* CARD 1: UNIVERSAL AI ENGINE (GEMINI, OPENAI, CUSTOM) */}
      <SettingsWhatsAppAiEngine
        t={t}
        aiConfig={aiConfig}
        selectedProvider={selectedProvider}
        setSelectedProvider={setSelectedProvider}
        setShowApiKey={setShowApiKey}
        showApiKey={showApiKey}
        customApiKey={customApiKey}
        handleApiKeyChange={handleApiKeyChange}
        fetchKeyModels={fetchKeyModels}
        fetchingModels={fetchingModels}
        customModel={customModel}
        setCustomModel={setCustomModel}
        geminiAvailableModels={geminiAvailableModels}
        customBaseUrl={customBaseUrl}
        setCustomBaseUrl={setCustomBaseUrl}
        saveAiKeyMutation={saveAiKeyMutation}
        testAiKeyMutation={testAiKeyMutation}
        deleteAiKeyMutation={deleteAiKeyMutation}
        aiFeedback={aiFeedback}
      />

      {/* CARD 2: CONVERSATIONAL WHATSAPP AI BOT */}
      <SettingsWhatsAppAiBot
        t={t}
        currentConfig={currentConfig}
        isMaritime={isMaritime}
        isContracting={isContracting}
        setForm={setForm}
        webhookUrl={webhookUrl}
        handleCopyWebhook={handleCopyWebhook}
        copiedWebhook={copiedWebhook}
      />

      {/* CARD 3: INTERACTIVE WHATSAPP BOT SIMULATOR */}
      <SettingsWhatsAppSimulator
        t={t}
        simChatHistory={simChatHistory}
        simulateMutation={simulateMutation}
        handleSendSim={handleSendSim}
        simQuestion={simQuestion}
        setSimQuestion={setSimQuestion}
      />

      {/* CARD 4: CLOUD WHATSAPP GATEWAY & OUTBOUND AUTOMATION */}
      <SettingsWhatsAppGateway
        t={t}
        currentConfig={currentConfig}
        setForm={setForm}
        isMaritime={isMaritime}
        isContracting={isContracting}
        feedback={feedback}
        testPhone={testPhone}
        setTestPhone={setTestPhone}
        testMutation={testMutation}
        setFeedback={setFeedback}
        saveMutation={saveMutation}
        handleSaveAll={handleSaveAll}
      />
    </div>
  );
}
