import { RefreshCwIcon, SendIcon, AlertTriangleIcon, CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { MaritimeMailConfig } from '../../api/maritime-freight.api';

export interface MaritimeSettingsTabTestCenterProps {
  __t: ReturnType<typeof useTranslation>['t'];
  testing: boolean;
  handleTestConnection: () => Promise<void>;
  setShowTestEmailInput: React.Dispatch<React.SetStateAction<boolean>>;
  showTestEmailInput: boolean;
  syncing: boolean;
  handleSyncInboundBids: () => Promise<void>;
  testTargetEmail: string;
  setTestTargetEmail: React.Dispatch<React.SetStateAction<string>>;
  sendingTest: boolean;
  handleSendTestEmail: () => Promise<void>;
  testResult: { smtpSuccess?: boolean; imapSuccess?: boolean; smtpMessage?: string; imapMessage?: string } | null;
  syncResult: { success: boolean; syncedCount: number; message: string; details?: any[] } | null;
  config: MaritimeMailConfig;
}

export function MaritimeSettingsTabTestCenter({ __t, testing, handleTestConnection, setShowTestEmailInput, showTestEmailInput, syncing, handleSyncInboundBids, testTargetEmail, setTestTargetEmail, sendingTest, handleSendTestEmail, testResult, syncResult, config }: MaritimeSettingsTabTestCenterProps) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '14px' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
            {__t('maritime_freight.maritime_settings_tab.s49', "مركز الفحص والاختبار والتشغيل المباشر (Diagnostic & Action Center)")}
          </h4>
          <p style={{ margin: '3px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            {__t('maritime_freight.maritime_settings_tab.s50', "تأكيد نجاح الاتصال بكلا الخادمين (SMTP & IMAP) ومزامنة صندوق الوارد الآن")}
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            disabled={testing}
            onClick={handleTestConnection}
            style={{
              padding: '7px 14px',
              background: '#ffffff',
              color: '#170e5e',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCwIcon size={14} />
            <span>{testing ? __t('maritime_freight.maritime_settings_tab.s51', "جاري فحص الاتصال...") : __t('maritime_freight.maritime_settings_tab.s52', "فحص واختبار الاتصال")}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTestEmailInput(!showTestEmailInput)}
            style={{
              padding: '7px 14px',
              background: '#ffffff',
              color: '#170e5e',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <SendIcon size={14} />
            <span>{__t('maritime_freight.maritime_settings_tab.s53', "إرسال بريد تجريبي")}</span>
          </button>

          <button
            type="button"
            disabled={syncing}
            onClick={handleSyncInboundBids}
            style={{
              padding: '7px 16px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
            }}
          >
            <RefreshCwIcon size={14} />
            <span>{syncing ? __t('maritime_freight.maritime_settings_tab.s54', "جاري المزامنة...") : __t('maritime_freight.maritime_settings_tab.s55', "مزامنة البريد واستيراد العروض الآن")}</span>
          </button>
        </div>
      </div>

      {/* حقل إرسال بريد تجريبي */}
      {showTestEmailInput && (
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '14px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
            {__t('maritime_freight.maritime_settings_tab.s56', "البريد الإلكتروني المستلم:")}
          </span>
          <input
            type="email"
            value={testTargetEmail}
            onChange={(e) => setTestTargetEmail(e.target.value)}
            placeholder="name@example.com"
            style={{ flex: '1 1 200px', maxWidth: '320px', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.8125rem' }}
          />
          <button
            type="button"
            disabled={sendingTest}
            onClick={handleSendTestEmail}
            style={{
              padding: '6px 14px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {sendingTest ? __t('maritime_freight.maritime_settings_tab.s57', "جاري الإرسال...") : __t('maritime_freight.maritime_settings_tab.s58', "إرسال الرسالة الآن")}
          </button>
        </div>
      )}

      {/* نتائج فحص الاتصال */}
      {testResult && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '14px' }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '8px',
              border: `1px solid ${testResult.smtpSuccess ? '#bbf7d0' : '#fecaca'}`,
              background: testResult.smtpSuccess ? '#f0fdf4' : '#fef2f2',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.8125rem', color: testResult.smtpSuccess ? '#166534' : '#991b1b' }}>
              {testResult.smtpSuccess ? <CheckCircleIcon size={16} /> : <AlertTriangleIcon size={16} />}
              <span>{__t('maritime_freight.maritime_settings_tab.s59', "خادم الإرسال (SMTP):")} {testResult.smtpSuccess ? __t('maritime_freight.maritime_settings_tab.s60', "متصل بنجاح ومصادق") : __t('maritime_freight.maritime_settings_tab.s61', "فشل الاتصال")}</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#475569', marginTop: '4px' }}>
              {testResult.smtpMessage}
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '8px',
              border: `1px solid ${testResult.imapSuccess ? '#bbf7d0' : '#fecaca'}`,
              background: testResult.imapSuccess ? '#f0fdf4' : '#fef2f2',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '0.8125rem', color: testResult.imapSuccess ? '#166534' : '#991b1b' }}>
              {testResult.imapSuccess ? <CheckCircleIcon size={16} /> : <AlertTriangleIcon size={16} />}
              <span>{__t('maritime_freight.maritime_settings_tab.s62', "خادم الاستقبال (IMAP):")} {testResult.imapSuccess ? __t('maritime_freight.maritime_settings_tab.s63', "متصل بنجاح وجاهز للقراءة") : __t('maritime_freight.maritime_settings_tab.s64', "فشل الاتصال")}</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#475569', marginTop: '4px' }}>
              {testResult.imapMessage}
            </div>
          </div>
        </div>
      )}

      {/* نتيجة المزامنة اللحظية */}
      {syncResult && (
        <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
          <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#1e293b' }}>
            {__t('maritime_freight.maritime_settings_tab.s65', "نتيجة فحص البريد الوارد:")} {syncResult.message}
          </div>
          {syncResult.details && syncResult.details.length > 0 ? (
            <ul style={{ margin: '6px 0 0 0', paddingInlineStart: '20px', fontSize: '0.75rem', color: '#475569' }}>
              {syncResult.details.map((item, idx) => (
                <li key={idx}>
                  {__t('maritime_freight.maritime_settings_tab.s66', "عرض مستلم للطلب #")}{item.rfqNumber}{__t('maritime_freight.maritime_settings_tab.s67', ": الخط الملاحي")} {item.carrier} {__t('maritime_freight.maritime_settings_tab.s68', "بسعر $")}{item.price} ({item.freeDays} {__t('maritime_freight.maritime_settings_tab.s69', "أيام سماح)")}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {/* معلومات آخر عملية مزامنة مسجلة */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.75rem', color: '#64748b' }}>
        <div>
          <strong>{__t('maritime_freight.maritime_settings_tab.s70', "تاريخ آخر مزامنة:")}</strong>{' '}
          {config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString('ar-EG') : __t('maritime_freight.maritime_settings_tab.s71', "لم تتم المزامنة بعد")}
        </div>
        <div>
          <strong>{__t('maritime_freight.maritime_settings_tab.s72', "حالة آخر فحص:")}</strong>{' '}
          {config.lastSyncStatus === 'success' ? (
            <span style={{ color: '#16a34a', fontWeight: 700 }}>{__t('maritime_freight.maritime_settings_tab.s73', "ناجحة")}</span>
          ) : config.lastSyncStatus === 'failed' ? (
            <span style={{ color: '#dc2626', fontWeight: 700 }}>{__t('maritime_freight.maritime_settings_tab.s74', "فشلت")}</span>
          ) : (
            __t('maritime_freight.maritime_settings_tab.s75', "لا يوجد")
          )}
        </div>
        {config.lastSyncDetails && (
          <div>
            <strong>{__t('maritime_freight.maritime_settings_tab.s76', "تفاصيل:")}</strong> {config.lastSyncDetails}
          </div>
        )}
      </div>
    </div>
  );
}
