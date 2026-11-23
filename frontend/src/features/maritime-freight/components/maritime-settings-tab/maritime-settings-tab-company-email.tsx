import { MailIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface MaritimeSettingsTabCompanyEmailProps {
  __t: ReturnType<typeof useTranslation>['t'];
  companyOfficialEmail: string;
  setCompanyOfficialEmail: React.Dispatch<React.SetStateAction<string>>;
}

export function MaritimeSettingsTabCompanyEmail({ __t, companyOfficialEmail, setCompanyOfficialEmail }: MaritimeSettingsTabCompanyEmailProps) {
  return (
    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px', marginBottom: '14px' }}>
        <MailIcon size={17} color="#170e5e" />
        <div>
          <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>{__t('maritime_freight.maritime_settings_tab.s10', "البريد الإلكتروني الرسمي للشركة")}</h4>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            {__t('maritime_freight.maritime_settings_tab.s11', "هذا البريد يُستخدم في توقيع الرسائل والقوالب عبر متغير")} <span dir="ltr" style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px', fontSize: '0.72rem', color: '#4f46e5' }}>{'{{company_email}}'}</span> {__t('maritime_freight.maritime_settings_tab.s12', "— يختلف عن بيانات الدخول لخادم البريد أدناه")}
          </p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {__t('maritime_freight.maritime_settings_tab.s13', "البريد الرسمي للمراسلات *")}
          </label>
          <input
            type="email"
            value={companyOfficialEmail}
            onChange={(e) => setCompanyOfficialEmail(e.target.value)}
            placeholder="freight@yourcompany.com"
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.8125rem', boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  );
}
