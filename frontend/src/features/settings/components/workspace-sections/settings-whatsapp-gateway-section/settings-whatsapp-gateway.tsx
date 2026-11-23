import { Button } from '@/shared/ui/button';
import { SubmitButton } from '@/shared/components/submit-button';
import { MessageSquareIcon, CheckIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { WhatsAppGatewayConfig } from './settings-whatsapp-gateway-section-shared';

export interface SettingsWhatsAppGatewayProps {
  t: ReturnType<typeof useTranslation>['t'];
  currentConfig: WhatsAppGatewayConfig;
  setForm: React.Dispatch<React.SetStateAction<Partial<WhatsAppGatewayConfig>>>;
  isMaritime: boolean;
  isContracting: boolean;
  feedback: { kind: 'success' | 'error'; message: string } | null;
  testPhone: string;
  setTestPhone: React.Dispatch<React.SetStateAction<string>>;
  testMutation: { isPending: boolean; mutate: (phone: string) => void };
  setFeedback: React.Dispatch<React.SetStateAction<{ kind: 'success' | 'error'; message: string } | null>>;
  saveMutation: { isPending: boolean; isSuccess: boolean; mutate: (payload: Partial<WhatsAppGatewayConfig>) => void };
  handleSaveAll: () => void;
}

export function SettingsWhatsAppGateway(props: SettingsWhatsAppGatewayProps) {
  const { t, currentConfig, setForm, isMaritime, isContracting, feedback, testPhone, setTestPhone, testMutation, setFeedback, saveMutation, handleSaveAll } = props;
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
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageSquareIcon size={18} color="#166534" />
            </div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: '#0f172a' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s73', "إعدادات حساب واتساب السحابي (Cloud WhatsApp Credentials)")}
            </h3>
            <span style={{ fontSize: '11px', background: currentConfig.enabled ? '#dcfce7' : '#f1f5f9', color: currentConfig.enabled ? '#166534' : '#64748b', padding: '2px 8px', borderRadius: '6px', fontWeight: 800 }}>
              {currentConfig.enabled ? t('settings.workspace_sections.settings_whats_app_gateway_section.s74', "البوابة مفعلة") : t('settings.workspace_sections.settings_whats_app_gateway_section.s75', "متوقفة")}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
            {t('settings.workspace_sections.settings_whats_app_gateway_section.s76', "بيانات الاتصال برقم الواتساب لإرسال الفواتير الإلكترونية وإشعارات المتجر للعملاء.")}
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: currentConfig.enabled ? '#166534' : '#475569' }}>
            {currentConfig.enabled ? t('settings.workspace_sections.settings_whats_app_gateway_section.s77', "البوابة مفعلة") : t('settings.workspace_sections.settings_whats_app_gateway_section.s78', "تفعيل البوابة")}
          </span>
          <input
            type="checkbox"
            checked={currentConfig.enabled}
            onChange={(e) => setForm({ ...currentConfig, enabled: e.target.checked })}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>
      </div>

      {/* 2-Column Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {/* Provider & Credentials */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <strong style={{ fontSize: '13px', color: '#0f172a', fontWeight: 800 }}>{t('settings.workspace_sections.settings_whats_app_gateway_section.s79', "مزود خدمة الواتساب السحابي:")}</strong>

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s80', "المزود المعتمد:")}
            </label>
            <select
              value={currentConfig.provider}
              onChange={(e) => setForm({ ...currentConfig, provider: e.target.value as any })}
              style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff', fontWeight: 700 }}
            >
              <option value="ultramsg">{t('settings.workspace_sections.settings_whats_app_gateway_section.s81', "UltraMsg (الأشهر في مصر والوطن العربي)")}</option>
              <option value="greenapi">{t('settings.workspace_sections.settings_whats_app_gateway_section.s82', "Green API (بوابة عالمية مستقرة)")}</option>
              <option value="custom_webhook">{t('settings.workspace_sections.settings_whats_app_gateway_section.s83', "Custom Webhook (بوابة أو سيرفر خاص بك)")}</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s84', "معرّف الحساب / Instance ID:")}
            </label>
            <input
              type="text"
              placeholder={t('settings.workspace_sections.settings_whats_app_gateway_section.s85', "مثال: instance98765")}
              value={currentConfig.instanceId || ''}
              onChange={(e) => setForm({ ...currentConfig, instanceId: e.target.value })}
              style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff', direction: 'ltr', textAlign: 'left', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s86', "مفتاح الاتصال / Token:")}
            </label>
            <input
              type="password"
              placeholder={t('settings.workspace_sections.settings_whats_app_gateway_section.s87', "رمز الـ Token السري الخاص بحسابك...")}
              value={currentConfig.token || ''}
              onChange={(e) => setForm({ ...currentConfig, token: e.target.value })}
              style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff', direction: 'ltr', textAlign: 'left', boxSizing: 'border-box' }}
            />
          </div>

          {currentConfig.provider === 'custom_webhook' && (
            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('settings.workspace_sections.settings_whats_app_gateway_section.s88', "رابط الويب هوك (Webhook URL):")}
              </label>
              <input
                type="url"
                placeholder="https://your-api.com/send-message"
                value={currentConfig.apiUrl || ''}
                onChange={(e) => setForm({ ...currentConfig, apiUrl: e.target.value })}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', background: '#ffffff', direction: 'ltr', textAlign: 'left', boxSizing: 'border-box' }}
              />
            </div>
          )}
        </div>

        {/* Automation Rules */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <strong style={{ fontSize: '13px', color: '#0f172a', fontWeight: 800 }}>{t('settings.workspace_sections.settings_whats_app_gateway_section.s89', "قواعد الإرسال التلقائي الصامت:")}</strong>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', color: '#1e293b' }}>
            <input
              type="checkbox"
              checked={currentConfig.autoSendInvoice}
              onChange={(e) => setForm({ ...currentConfig, autoSendInvoice: e.target.checked })}
              style={{ width: '16px', height: '16px' }}
            />
            <span>
              {isMaritime
                ? t('settings.workspace_sections.settings_whats_app_gateway_section.s90', "إرسال رابط الفاتورة والمستندات للعميل تلقائياً فور إصدار واعتماد فاتورة الشحن.")
                : isContracting
                ? t('settings.workspace_sections.settings_whats_app_gateway_section.s91', "إرسال رابط المستخلص للجهة المالكة تلقائياً فور اعتماده.")
                : t('settings.workspace_sections.settings_whats_app_gateway_section.s92', "إرسال رابط الفاتورة الإلكترونية للعميل تلقائياً فور حفظ الفاتورة بالكاشير.")}
            </span>
          </label>

          {!isMaritime && !isContracting && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', color: '#1e293b' }}>
              <input
                type="checkbox"
                checked={currentConfig.autoSendOnlineOrder}
                onChange={(e) => setForm({ ...currentConfig, autoSendOnlineOrder: e.target.checked })}
                style={{ width: '16px', height: '16px' }}
              />
              <span>{t('settings.workspace_sections.settings_whats_app_gateway_section.s93', "إرسال رسالة تأكيد للعميل فور وصول طلب من المتجر الإلكتروني.")}</span>
            </label>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s94', "قالب رسالة الفاتورة (تتغير المتغيرات تلقائياً):")}
            </label>
            <textarea
              rows={3}
              value={currentConfig.invoiceTemplate}
              onChange={(e) => setForm({ ...currentConfig, invoiceTemplate: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#ffffff', boxSizing: 'border-box' }}
            />
            <span style={{ fontSize: '10.5px', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_whats_app_gateway_section.s95', "المتغيرات المتاحة:")} {'{customerName}'}, {'{businessName}'}, {'{invoiceNo}'}, {'{totalAmount}'}, {'{invoiceLink}'}
            </span>
          </div>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '12.5px',
            fontWeight: 700,
            marginBottom: '14px',
            background: feedback.kind === 'success' ? '#dcfce7' : '#fee2e2',
            color: feedback.kind === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${feedback.kind === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          {feedback.message}
        </div>
      )}

      {/* Footer Actions & Testing */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="tel"
            placeholder={t('settings.workspace_sections.settings_whats_app_gateway_section.s96', "رقم الهاتف للتجربة (مثلاً 010...)")}
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            style={{ width: '190px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#ffffff', direction: 'ltr', textAlign: 'left' }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={testMutation.isPending || !currentConfig.enabled}
            onClick={() => {
              if (!testPhone.trim()) {
                setFeedback({ kind: 'error', message: t('settings.workspace_sections.settings_whats_app_gateway_section.s97', "يرجى إدخال رقم الهاتف لإجراء الاختبار") });
                return;
              }
              setFeedback(null);
              testMutation.mutate(testPhone.trim());
            }}
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            {testMutation.isPending ? t('settings.workspace_sections.settings_whats_app_gateway_section.s98', "جاري الإرسال...") : t('settings.workspace_sections.settings_whats_app_gateway_section.s99', "إرسال رسالة اختبار")}
          </Button>
        </div>

        <SubmitButton
          type="button"
          isPending={saveMutation.isPending}
          isSuccess={saveMutation.isSuccess}
          idleText={t('settings.workspace_sections.settings_whats_app_gateway_section.s101', "حفظ الإعدادات بالكامل")}
          pendingText={t('settings.workspace_sections.settings_whats_app_gateway_section.s100', "جاري الحفظ...")}
          successText="تم حفظ إعدادات الواتساب بنجاح!"
          onClick={handleSaveAll}
          style={{ background: '#170e5e', color: '#ffffff', fontSize: '13px', padding: '8px 20px', fontWeight: 800 }}
        />
      </div>

      {saveMutation.isSuccess && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '10px 14px',
            background: '#f0fdf4',
            border: '1.5px solid #86efac',
            borderRadius: '8px',
            color: '#15803d',
            fontSize: '12.5px',
            fontWeight: 800,
            marginTop: '12px',
            boxShadow: '0 1px 4px rgba(22, 163, 74, 0.12)',
          }}
        >
          <CheckIcon size={16} color="#16a34a" />
          <span>تم حفظ وتحديث إعدادات الواتساب والرد الآلي بنجاح! التغييرات مفعلة مباشرة.</span>
        </div>
      )}
    </div>
  );
}
