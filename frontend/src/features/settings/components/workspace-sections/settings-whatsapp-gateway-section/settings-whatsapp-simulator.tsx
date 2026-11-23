import { Button } from '@/shared/ui/button';
import { MessageSquareIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { SimChatMessage } from './settings-whatsapp-gateway-section-shared';

export interface SettingsWhatsAppSimulatorProps {
  t: ReturnType<typeof useTranslation>['t'];
  simChatHistory: SimChatMessage[];
  simulateMutation: { isPending: boolean; mutate: (question: string) => void };
  handleSendSim: (text?: string) => void;
  simQuestion: string;
  setSimQuestion: React.Dispatch<React.SetStateAction<string>>;
}

export function SettingsWhatsAppSimulator(props: SettingsWhatsAppSimulatorProps) {
  const { t, simChatHistory, simulateMutation, handleSendSim, simQuestion, setSimQuestion } = props;
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
      <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MessageSquareIcon size={18} color="#059669" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '15.5px', fontWeight: 900, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s61', "محاكي محادثة واتساب التفاعلي (WhatsApp AI Live Simulator)")}
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s62', "اختبر ردود بوت الذكاء الاصطناعي مباشرة كأنك عميل على واتساب وتحقق من دقته في فحص أسعار ومخزون منتجاتك الحالية:")}
            </p>
          </div>
        </div>
      </div>

      {/* WhatsApp Mock Chat Window */}
      <div
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          overflow: 'hidden',
          background: '#efeae2',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}
      >
        {/* Mock Header */}
        <div
          style={{
            background: '#075e54',
            color: '#ffffff',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: '#128c7e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
              }}
            >
              <MessageSquareIcon size={18} />
            </div>
            <div>
              <div style={{ fontSize: '13.5px', fontWeight: 800 }}>{t('settings.workspace_sections.settings_whats_app_gateway_section.s63', "مساعد المتجر الذكي (WhatsApp AI Bot)")}</div>
              <div style={{ fontSize: '11px', opacity: 0.85 }}>{t('settings.workspace_sections.settings_whats_app_gateway_section.s64', "متصل الآن • بالذكاء الاصطناعي")}</div>
            </div>
          </div>
          <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '12px' }}>
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s65', "تجربة حية")}
          </span>
        </div>

        {/* Chat Messages Body */}
        <div
          style={{
            height: '280px',
            overflowY: 'auto',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {simChatHistory.map((msg) => {
            const isCustomer = msg.sender === 'customer';
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignSelf: isCustomer ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                }}
              >
                <div
                  style={{
                    background: isCustomer ? '#dcf8c6' : '#ffffff',
                    color: '#0f172a',
                    padding: '8px 12px',
                    borderRadius: isCustomer ? '10px 0 10px 10px' : '0 10px 10px 10px',
                    boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {msg.text}
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    color: '#64748b',
                    marginTop: '2px',
                    alignSelf: isCustomer ? 'flex-end' : 'flex-start',
                    display: 'flex',
                    gap: '4px',
                  }}
                >
                  <span>{msg.time}</span>
                  {msg.engine && (
                    <span style={{ color: msg.engine === 'gemini_llm' || msg.engine === 'openai_llm' || msg.engine === 'custom_llm' ? '#2563eb' : '#059669', fontWeight: 700 }}>
                      ({msg.engine === 'gemini_llm' ? 'Gemini' : msg.engine === 'openai_llm' ? 'OpenAI' : msg.engine === 'custom_llm' ? 'AI Cloud' : 'Smart Local'})
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {simulateMutation.isPending && (
            <div style={{ alignSelf: 'flex-start', background: '#ffffff', padding: '8px 14px', borderRadius: '10px', fontSize: '12px', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s66', "جاري التفكير وصياغة الرد بالذكاء الاصطناعي...")}
            </div>
          )}
        </div>

        {/* Quick Suggestion Chips */}
        <div style={{ background: '#f8fafc', padding: '8px 12px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '6px', overflowX: 'auto' }}>
          {[
            t('settings.workspace_sections.settings_whats_app_gateway_section.s67', "بكام المنتجات عندكم؟"),
            t('settings.workspace_sections.settings_whats_app_gateway_section.s68', "عندكم مقاس L متوفر وبكام؟"),
            t('settings.workspace_sections.settings_whats_app_gateway_section.s69', "عايز أطلب أونلاين يوصلني إمتى؟"),
            t('settings.workspace_sections.settings_whats_app_gateway_section.s70', "في عروض أو تخفيضات النهاردة؟"),
          ].map((chip, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSendSim(chip)}
              style={{
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '16px',
                padding: '4px 10px',
                fontSize: '11.5px',
                color: '#334155',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Chat Input Bar */}
        <div style={{ background: '#f0f2f5', padding: '10px 14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={t('settings.workspace_sections.settings_whats_app_gateway_section.s71', "اكتب سؤالك كأنك زبون يراسل المتجر على واتساب...")}
            value={simQuestion}
            onChange={(e) => setSimQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSendSim();
              }
            }}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12.5px',
              background: '#ffffff',
            }}
          />
          <Button
            type="button"
            variant="primary"
            disabled={simulateMutation.isPending || !simQuestion.trim()}
            onClick={() => handleSendSim()}
            style={{ background: '#075e54', fontSize: '12px', padding: '8px 16px', fontWeight: 800 }}
          >
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s72', "إرسال")}
          </Button>
        </div>
      </div>
    </div>
  );
}
