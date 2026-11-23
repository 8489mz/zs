import { SettingsIcon, CheckIcon, CheckCircleIcon, AlertTriangleIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface MaritimeSettingsTabHeaderProps {
  __t: ReturnType<typeof useTranslation>['t'];
  companyProfile: { name: string; email: string; phone: string };
  saving: boolean;
  handleSave: () => Promise<void>;
  feedbackMsg: { type: 'success' | 'error'; text: string } | null;
}

export function MaritimeSettingsTabHeader({ __t, companyProfile, saving, handleSave, feedbackMsg }: MaritimeSettingsTabHeaderProps) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SettingsIcon size={18} color="#170e5e" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
              {__t('maritime_freight.maritime_settings_tab.s1', "إعدادات خوادم البريد ومراسلات طلبات التسعير (Mail & Freight RFQ Automation)")}
            </h3>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            {__t('maritime_freight.maritime_settings_tab.s2', "ربط حساب البريد المخصص لشركتك لإرسال طلبات التسعير (RFQs) آلياً للناقلين والخطوط الملاحية وشركات الطيران وقراءة عروض الأسعار الواردة بالذكاء الاصطناعي")}
          </p>
          {companyProfile.name && (
            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f0f4ff', border: '1px solid #c7d2fe', borderRadius: '8px', fontSize: '0.78rem', color: '#3730a3', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 700 }}>{__t('maritime_freight.maritime_settings_tab.s3', "هوية شركتك المرتبطة تلقائياً:")}</span>
              <span style={{ fontWeight: 600 }}>{companyProfile.name}</span>
              {companyProfile.email && <span style={{ color: '#6366f1' }}>— {companyProfile.email}</span>}
              <span style={{ color: '#64748b', marginInlineStart: 'auto', fontSize: '0.72rem' }}>
                {__t('maritime_freight.maritime_settings_tab.s4', "يتم استيراد هذه البيانات تلقائياً من إعدادات المنشأة العامة")}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            style={{
              height: '36px',
              padding: '0 18px',
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.8125rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 2px 4px rgba(23, 14, 94, 0.15)',
            }}
          >
            <CheckIcon size={15} />
            <span>{saving ? __t('maritime_freight.maritime_settings_tab.s5', "جاري الحفظ...") : __t('maritime_freight.maritime_settings_tab.s6', "حفظ الإعدادات")}</span>
          </button>
        </div>
      </div>

      {/* إشعار التغذية الراجعة */}
      {feedbackMsg && (
        <div
          style={{
            marginTop: '14px',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '0.8125rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: feedbackMsg.type === 'success' ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${feedbackMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            color: feedbackMsg.type === 'success' ? '#166534' : '#991b1b',
          }}
        >
          {feedbackMsg.type === 'success' ? <CheckCircleIcon size={16} /> : <AlertTriangleIcon size={16} />}
          <span>{feedbackMsg.text}</span>
        </div>
      )}
    </div>
  );
}
