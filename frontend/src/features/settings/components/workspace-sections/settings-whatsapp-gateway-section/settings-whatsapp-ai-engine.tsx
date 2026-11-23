import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { AiConfigResponse } from './settings-whatsapp-gateway-section-shared';

export interface SettingsWhatsAppAiEngineProps {
  t: ReturnType<typeof useTranslation>['t'];
  aiConfig: AiConfigResponse | undefined;
  selectedProvider: 'gemini' | 'openai' | 'custom';
  setSelectedProvider: React.Dispatch<React.SetStateAction<'gemini' | 'openai' | 'custom'>>;
  setShowApiKey: React.Dispatch<React.SetStateAction<boolean>>;
  showApiKey: boolean;
  customApiKey: string;
  handleApiKeyChange: (val: string) => void;
  fetchKeyModels: (keyToUse?: string) => Promise<void>;
  fetchingModels: boolean;
  customModel: string;
  setCustomModel: React.Dispatch<React.SetStateAction<string>>;
  geminiAvailableModels: Array<{ id: string; displayName: string }>;
  customBaseUrl: string;
  setCustomBaseUrl: React.Dispatch<React.SetStateAction<string>>;
  saveAiKeyMutation: { isPending: boolean; mutate: (payload: { apiKey?: string; provider: 'gemini' | 'openai' | 'custom'; model?: string; baseUrl?: string }) => void };
  testAiKeyMutation: { isPending: boolean; mutate: (params?: { apiKey?: string; provider?: 'gemini' | 'openai' | 'custom'; model?: string; baseUrl?: string }) => void };
  deleteAiKeyMutation: { isPending: boolean; mutate: () => void };
  aiFeedback: { kind: 'success' | 'error'; message: string } | null;
}

export function SettingsWhatsAppAiEngine({ t, aiConfig, selectedProvider, setSelectedProvider, setShowApiKey, showApiKey, customApiKey, handleApiKeyChange, fetchKeyModels, fetchingModels, customModel, setCustomModel, geminiAvailableModels, customBaseUrl, setCustomBaseUrl, saveAiKeyMutation, testAiKeyMutation, deleteAiKeyMutation, aiFeedback }: SettingsWhatsAppAiEngineProps) {
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        padding: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s0', "محرك ومفتاح الذكاء الاصطناعي (Universal AI Engine)")}
            </h3>
            <span
              style={{
                fontSize: '11px',
                background: aiConfig?.hasApiKey ? '#dcfce7' : '#fef3c7',
                color: aiConfig?.hasApiKey ? '#166534' : '#92400e',
                padding: '2px 8px',
                borderRadius: '6px',
                fontWeight: 800,
              }}
            >
              {aiConfig?.hasApiKey
                ? `${aiConfig.provider === 'openai' ? 'OpenAI' : aiConfig.provider === 'custom' ? t('settings.workspace_sections.settings_whats_app_gateway_section.s1', "محرك مخصص") : 'Gemini'} متصل ونشط${aiConfig.model ? ` (${aiConfig.model})` : ''}`
                : t('settings.workspace_sections.settings_whats_app_gateway_section.s2', "يعمل بالمحرك المحلي المدمج")}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s3', "يدعم كلاً من")} <strong>Google Gemini</strong> {t('settings.workspace_sections.settings_whats_app_gateway_section.s4', "و")} <strong>OpenAI (ChatGPT)</strong> {t('settings.workspace_sections.settings_whats_app_gateway_section.s5', "ومزودي النماذج المتوافقة مثل")} <strong>DeepSeek</strong>{t('settings.workspace_sections.settings_whats_app_gateway_section.s6', ". يغذي")} <strong>{t('settings.workspace_sections.settings_whats_app_gateway_section.s7', "مستشار الإدارة (زاد AI)")}</strong> {t('settings.workspace_sections.settings_whats_app_gateway_section.s8', "وبوت")} <strong>{t('settings.workspace_sections.settings_whats_app_gateway_section.s9', "الرد الآلي على الواتساب")}</strong>.
          </p>
        </div>
      </div>

      {/* AI Key & Multi-Provider Settings */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Provider Selector Tabs */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s10', "اختر مزود الذكاء الاصطناعي (AI Provider):")}
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { id: 'gemini', label: 'Google Gemini', tag: t('settings.workspace_sections.settings_whats_app_gateway_section.s11', "موصى به") },
              { id: 'openai', label: 'OpenAI / ChatGPT (GPT-4o & Mini)', tag: t('settings.workspace_sections.settings_whats_app_gateway_section.s12', "متقدم") },
              { id: 'custom', label: t('settings.workspace_sections.settings_whats_app_gateway_section.s13', "مزود مخصص (DeepSeek / Groq / Local)"), tag: t('settings.workspace_sections.settings_whats_app_gateway_section.s14', "مفتوح") },
            ].map((p) => {
              const active = selectedProvider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProvider(p.id as any)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: active ? '2px solid #170e5e' : '1px solid #cbd5e1',
                    background: active ? '#f5f3ff' : '#ffffff',
                    color: active ? '#170e5e' : '#475569',
                    fontWeight: active ? 800 : 600,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{p.label}</span>
                  <span
                    style={{
                      fontSize: '10px',
                      background: active ? '#170e5e' : '#f1f5f9',
                      color: active ? '#ffffff' : '#64748b',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {p.tag}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* API Key Input - Anti-Autofill Protected */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <label style={{ fontSize: '12px', fontWeight: 800, color: '#1e293b' }}>
              {selectedProvider === 'gemini'
                ? t('settings.workspace_sections.settings_whats_app_gateway_section.s15', "مفتاح Google Gemini API:")
                : selectedProvider === 'openai'
                ? t('settings.workspace_sections.settings_whats_app_gateway_section.s16', "مفتاح OpenAI API (sk-...):")
                : t('settings.workspace_sections.settings_whats_app_gateway_section.s17', "مفتاح API الخاص بالمزود المخصص:")}
            </label>
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              style={{
                background: 'none',
                border: 'none',
                color: '#1d4ed8',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                padding: '2px 4px',
              }}
            >
              {showApiKey ? t('settings.workspace_sections.settings_whats_app_gateway_section.s18', "إخفاء الرمز") : t('settings.workspace_sections.settings_whats_app_gateway_section.s19', "إظهار الرمز")}
            </button>
          </div>
          <input
            type="text"
            name="ai_gateway_token_no_autofill"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            data-bwignore="true"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={showApiKey ? '' : 'secure-password-field'}
            placeholder={
              aiConfig?.hasApiKey
                ? `المفتاح مسجل: ${aiConfig.maskedKey}`
                : selectedProvider === 'gemini'
                ? t('settings.workspace_sections.settings_whats_app_gateway_section.s20', "الصق مفتاح AIzaSy... الخاص بك هنا")
                : selectedProvider === 'openai'
                ? t('settings.workspace_sections.settings_whats_app_gateway_section.s21', "الصق مفتاح sk-... الخاص بك هنا")
                : t('settings.workspace_sections.settings_whats_app_gateway_section.s22', "الصق مفتاح API الخاص بك هنا")
            }
            value={customApiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '13px',
              background: '#ffffff',
              direction: 'ltr',
              textAlign: 'left',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Gemini Model Selection - 100% Dynamic from Google */}
        {selectedProvider === 'gemini' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 800, color: '#1e293b' }}>
                {t('settings.workspace_sections.settings_whats_app_gateway_section.s23', "اختيار نموذج Google Gemini (Model):")}
              </label>
              {(customApiKey.trim() || aiConfig?.hasApiKey) && (
                <button
                  type="button"
                  onClick={() => fetchKeyModels()}
                  disabled={fetchingModels}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#1d4ed8',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                  }}
                  title={t('settings.workspace_sections.settings_whats_app_gateway_section.s24', "استعراض كافة النماذج التي يدعمها مفتاحك من سيرفرات جوجل مباشرة")}
                >
                  <RefreshCwIcon size={12} className={fetchingModels ? 'animate-spin' : ''} />
                  <span>{fetchingModels ? t('settings.workspace_sections.settings_whats_app_gateway_section.s25', "جاري الفحص من جوجل...") : t('settings.workspace_sections.settings_whats_app_gateway_section.s26', "استعراض نماذج مفتاحك من جوجل")}</span>
                </button>
              )}
            </div>

            {!customApiKey.trim() && !aiConfig?.hasApiKey ? (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  color: '#64748b',
                  fontSize: '12px',
                  lineHeight: 1.5,
                }}
              >
                {t('settings.workspace_sections.settings_whats_app_gateway_section.s27', "أدخل مفتاح Google Gemini أعلاه لاختيار نموذج من النماذج المتاحة لمفتاحك.")}
              </div>
            ) : (
              <CustomSelect
                value={customModel || ''}
                onChange={(val) => setCustomModel(val)}
                placeholder={customModel || t('settings.workspace_sections.settings_whats_app_gateway_section.s28', "اختر نموذجاً أو اتركه تلقائياً")}
                options={[
                  { value: '', label: t('settings.workspace_sections.settings_whats_app_gateway_section.s29', "تلقائي (اختيار أحدث نموذج متاح ومستقر لمفتاحك تلقائياً)"), hint: t('settings.workspace_sections.settings_whats_app_gateway_section.s30', "تلقائي") },
                  ...(customModel && !geminiAvailableModels.some((m) => m.id === customModel)
                    ? [{ value: customModel, label: customModel, hint: t('settings.workspace_sections.settings_whats_app_gateway_section.s31', "النموذج المحفوظ حالياً") }]
                    : []),
                  ...geminiAvailableModels.map((m) => ({
                    value: m.id,
                    label: m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id,
                    hint: m.id,
                  })),
                ]}
              />
            )}
          </div>
        )}

        {/* Custom Model and Base URL Fields for OpenAI / Custom */}
        {selectedProvider !== 'gemini' && (
          <div style={{ display: 'grid', gridTemplateColumns: selectedProvider === 'custom' ? '1fr 1fr' : '1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                {t('settings.workspace_sections.settings_whats_app_gateway_section.s32', "اسم النموذج (Model) - اختياري:")}
              </label>
              <input
                type="text"
                placeholder={selectedProvider === 'openai' ? t('settings.workspace_sections.settings_whats_app_gateway_section.s33', "gpt-4o-mini (الافتراضي)") : t('settings.workspace_sections.settings_whats_app_gateway_section.s34', "deepseek-chat أو أي نموذج")}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '12.5px',
                  background: '#ffffff',
                  direction: 'ltr',
                  textAlign: 'left',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            {selectedProvider === 'custom' && (
              <div>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                  {t('settings.workspace_sections.settings_whats_app_gateway_section.s35', "عنوان الرابط الأساسي (API Base URL) - اختياري:")}
                </label>
                <input
                  type="text"
                  placeholder={t('settings.workspace_sections.settings_whats_app_gateway_section.s36', "مثال: https://api.deepseek.com/v1")}
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12.5px',
                    background: '#ffffff',
                    direction: 'ltr',
                    textAlign: 'left',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Actions Row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant="primary"
            disabled={saveAiKeyMutation.isPending || (!customApiKey.trim() && !aiConfig?.hasApiKey && !customModel && !customBaseUrl)}
            onClick={() =>
              saveAiKeyMutation.mutate({
                apiKey: customApiKey.trim() || undefined,
                provider: selectedProvider,
                model: customModel.trim(),
                baseUrl: customBaseUrl.trim() || undefined,
              })
            }
            style={{ background: '#170e5e', fontSize: '12.5px', padding: '8px 18px', fontWeight: 800 }}
          >
            {saveAiKeyMutation.isPending ? t('settings.workspace_sections.settings_whats_app_gateway_section.s37', "جاري الحفظ...") : t('settings.workspace_sections.settings_whats_app_gateway_section.s38', "حفظ إعدادات المحرك")}
          </Button>

          <Button
            type="button"
            variant="secondary"
            disabled={testAiKeyMutation.isPending || (!customApiKey.trim() && !aiConfig?.hasApiKey)}
            onClick={() =>
              testAiKeyMutation.mutate({
                provider: selectedProvider,
                apiKey: customApiKey.trim() || undefined,
                model: customModel.trim(),
                baseUrl: customBaseUrl.trim() || undefined,
              })
            }
            style={{ fontSize: '12.5px', padding: '8px 16px', fontWeight: 800 }}
          >
            {testAiKeyMutation.isPending ? t('settings.workspace_sections.settings_whats_app_gateway_section.s39', "جاري فحص الاتصال...") : t('settings.workspace_sections.settings_whats_app_gateway_section.s40', "فحص الاتصال بالمحرك")}
          </Button>

          {aiConfig?.isCustomKey && (
            <Button
              type="button"
              variant="secondary"
              disabled={deleteAiKeyMutation.isPending}
              onClick={() => deleteAiKeyMutation.mutate()}
              style={{ fontSize: '12px', padding: '8px 12px', color: '#dc2626' }}
              title={t('settings.workspace_sections.settings_whats_app_gateway_section.s41', "حذف المفتاح المخصص والرجوع للإعداد الافتراضي")}
            >
              {deleteAiKeyMutation.isPending ? t('settings.workspace_sections.settings_whats_app_gateway_section.s42', "جاري الحذف...") : t('settings.workspace_sections.settings_whats_app_gateway_section.s43', "حذف المفتاح المخصص")}
            </Button>
          )}
        </div>


        {aiFeedback && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              background: aiFeedback.kind === 'success' ? '#dcfce7' : '#fee2e2',
              color: aiFeedback.kind === 'success' ? '#166534' : '#991b1b',
              border: `1px solid ${aiFeedback.kind === 'success' ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {aiFeedback.message}
          </div>
        )}
      </div>
    </div>
  );
}
