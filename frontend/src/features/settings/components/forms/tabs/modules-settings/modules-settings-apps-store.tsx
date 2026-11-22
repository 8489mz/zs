import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface ModulesSettingsAppsStoreProps {
  isSuperAdmin: boolean;
}

export function ModulesSettingsAppsStore({ isSuperAdmin }: ModulesSettingsAppsStoreProps) {
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      padding: '16px 20px',
      borderRadius: '12px',
      marginBottom: isSuperAdmin ? '18px' : '0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      flexWrap: 'wrap',
      gap: '12px',
    }}>
      <div>
        <strong style={{ fontSize: '0.92rem', color: '#0f172a', display: 'block', marginBottom: '3px', fontWeight: 800 }}>
          {t('settings.forms.tabs.modules_settings_tab.s19', "متجر التطبيقات والموديولات (Apps Store)")}
        </strong>
        <span style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
          {t('settings.forms.tabs.modules_settings_tab.s20', "الواجهة المعتمدة لاستعراض موديولات وتطبيقات النظام وتفاصيلها التشغيلية وفق باقة الاشتراك المعتمدة ونشاط المنشأة.")}
        </span>
      </div>
      <Link
        to="/apps"
        style={{
          padding: '8px 18px',
          background: '#170e5e',
          color: '#ffffff',
          borderRadius: '8px',
          fontSize: '0.82rem',
          fontWeight: 700,
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {t('settings.forms.tabs.modules_settings_tab.s21', "فتح متجر التطبيقات")}
      </Link>
    </div>
  );
}
