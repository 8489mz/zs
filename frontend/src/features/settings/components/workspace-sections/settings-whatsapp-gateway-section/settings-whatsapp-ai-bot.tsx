import { Button } from '@/shared/ui/button';
import { MessageSquareIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { WhatsAppGatewayConfig } from './settings-whatsapp-gateway-section-shared';

export interface SettingsWhatsAppAiBotProps {
  t: ReturnType<typeof useTranslation>['t'];
  currentConfig: WhatsAppGatewayConfig;
  isMaritime: boolean;
  isContracting: boolean;
  setForm: React.Dispatch<React.SetStateAction<Partial<WhatsAppGatewayConfig>>>;
  webhookUrl: string;
  handleCopyWebhook: () => void;
  copiedWebhook: boolean;
}

export function SettingsWhatsAppAiBot(props: SettingsWhatsAppAiBotProps) {
  const { t, currentConfig, isMaritime, isContracting, setForm, webhookUrl, handleCopyWebhook, copiedWebhook } = props;
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageSquareIcon size={18} color="#15803d" />
            </div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s44', "بوت واتساب التفاعلي لخدمة ومبيعات العملاء (Conversational AI Bot)")}
            </h3>
            <span
              style={{
                fontSize: '11px',
                background: currentConfig.aiBotEnabled ? '#dcfce7' : '#f1f5f9',
                color: currentConfig.aiBotEnabled ? '#166534' : '#64748b',
                padding: '2px 8px',
                borderRadius: '6px',
                fontWeight: 800,
              }}
            >
              {currentConfig.aiBotEnabled ? t('settings.workspace_sections.settings_whats_app_gateway_section.s45', "الرد الآلي مفعل") : t('settings.workspace_sections.settings_whats_app_gateway_section.s46', "الرد الآلي متوقف")}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {isMaritime
              ? t('settings.workspace_sections.settings_whats_app_gateway_section.s47', "يقوم البوت بالرد التلقائي الذكي على استفسارات العملاء حول مواعيد وصول السفن، تتبع الحاويات، رسوم النولون وخدمات التخليص الملاحي.")
              : isContracting
              ? t('settings.workspace_sections.settings_whats_app_gateway_section.s48', "يقوم البوت بالرد التلقائي الذكي على استفسارات الملاك والاستشاريين ومقاولي الباطن حول بنود المقايسات وحالات المستخلصات.")
              : t('settings.workspace_sections.settings_whats_app_gateway_section.s49', "يقوم البوت بالرد التلقائي الذكي على استفسارات الزبائن حول أسعار المنتجات وتوفر المقاسات والألوان في المخزن لحظياً، مع إرسال روابط الشراء المباشرة.")}
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: currentConfig.aiBotEnabled ? '#166534' : '#475569' }}>
            {currentConfig.aiBotEnabled ? t('settings.workspace_sections.settings_whats_app_gateway_section.s50', "مفعل") : t('settings.workspace_sections.settings_whats_app_gateway_section.s51', "تفعيل البوت")}
          </span>
          <input
            type="checkbox"
            checked={currentConfig.aiBotEnabled}
            onChange={(e) => setForm({ ...currentConfig, aiBotEnabled: e.target.checked })}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>
      </div>

      {/* Bot Rules & Webhook Box */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {/* Webhook Configuration */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <strong style={{ fontSize: '13px', color: '#0f172a', fontWeight: 800 }}>{t('settings.workspace_sections.settings_whats_app_gateway_section.s52', "رابط استقبال رسائل الزبائن (Inbound Webhook URL):")}</strong>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s53', "انسخ هذا الرابط وضعه في خانة")} <strong>Webhook URL</strong> {t('settings.workspace_sections.settings_whats_app_gateway_section.s54', "في لوحة UltraMsg أو GreenAPI أو Meta Official API لاستقبال رسائل العملاء فورياً:")}
          </p>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="text"
              readOnly
              value={webhookUrl}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                background: '#f1f5f9',
                color: '#334155',
                direction: 'ltr',
                textAlign: 'left',
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopyWebhook}
              style={{ fontSize: '11.5px', padding: '7px 12px', whiteSpace: 'nowrap' }}
            >
              {copiedWebhook ? t('settings.workspace_sections.settings_whats_app_gateway_section.s55', "تم النسخ!") : t('settings.workspace_sections.settings_whats_app_gateway_section.s56', "نسخ الرابط")}
            </Button>
          </div>
          <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s57', "يدعم كود المحاكاة، UltraMsg، GreenAPI، و Meta Cloud API بنظام Webhook تلقائي موحد.")}
          </span>
        </div>

        {/* Custom Personality Prompt */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <strong style={{ fontSize: '13px', color: '#0f172a', fontWeight: 800 }}>{t('settings.workspace_sections.settings_whats_app_gateway_section.s58', "توجيهات مخصصة للبوت (Shop Prompt Rules):")}</strong>
          <label style={{ display: 'block', fontSize: '11.5px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s59', "اكتب أي شروط أو سياسات خاصة بمتجرك (مثال: نبرة الصوت، التوصيل المجاني، سياسة الاستبدال):")}
          </label>
          <textarea
            rows={3}
            placeholder={t('settings.workspace_sections.settings_whats_app_gateway_section.s60', "مثال: رحب بالعميل باسم متجرنا، واذكر أن مصاريف الشحن 35 ج فقط داخل القاهرة، ولدينا استبدال مجاني خلال 14 يوم...")}
            value={currentConfig.aiBotPrompt || ''}
            onChange={(e) => setForm({ ...currentConfig, aiBotPrompt: e.target.value })}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              background: '#ffffff',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
    </div>
  );
}
