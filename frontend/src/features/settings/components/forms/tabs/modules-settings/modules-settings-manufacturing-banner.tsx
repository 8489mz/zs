import { useTranslation } from 'react-i18next';
import { FactoryIcon } from './modules-settings-icons';

export function ModulesSettingsManufacturingBanner() {
  const { t } = useTranslation();
  return (
    <div style={{
      padding: '12px 16px',
      marginBottom: '14px',
      background: '#f0fdf4',
      border: '1px solid #bbf7d0',
      borderRadius: '10px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '0.82rem',
      color: '#166534',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center' }}>
          <FactoryIcon size={20} />
        </span>
        <span>
          <strong>{t('settings.forms.tabs.modules_settings_tab.s6', "باقة التصنيع والإنتاج الصناعي الشاملة (All-Inclusive Suite):")}</strong> {t('settings.forms.tabs.modules_settings_tab.s7', "تم تفعيل كافة الموديولات التشغيلية للمصانع تلقائياً (أوامر الإنتاج، قوائم المكونات BOM، مشتريات المواد الخام والتوريد، مستودعات المواد والمنتج التام، مراكز التكلفة والمحاسبة، CRM، والموارد البشرية) بكامل صلاحيات المنظومة دون قيود باقات.")}
        </span>
      </div>
      <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '3px 10px', borderRadius: '6px', fontWeight: 800, border: '1px solid #86efac', flexShrink: 0 }}>
        {t('settings.forms.tabs.modules_settings_tab.s8', "باقة متكاملة شاملة")}
      </span>
    </div>
  );
}
