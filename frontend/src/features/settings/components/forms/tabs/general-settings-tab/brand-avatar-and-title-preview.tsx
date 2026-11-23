import { useTranslation } from 'react-i18next';
import { useWatch } from 'react-hook-form';

export function BrandAvatarAndTitlePreview({
  control,
  accentColor,
  logoData,
  children,
}: {
  control: any;
  accentColor: string;
  logoData?: string;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const storeName = useWatch({ control, name: 'storeName' });
  const brandName = useWatch({ control, name: 'brandName' });

  return (
    <>
      <div
        style={{
          width: '50px',
          height: '50px',
          borderRadius: '8px',
          border: `2px solid ${accentColor}`,
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {logoData ? (
          <img src={logoData} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: '1.3rem', fontWeight: 900, color: accentColor }}>
            {(storeName || brandName || 'Z').slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {storeName || t('settings.forms.tabs.general_settings_tab.s0', "اسم النشاط / المتجر")}
        </div>
        <div style={{ fontSize: '0.74rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {brandName || 'Z Systems'}
        </div>
        {children}
      </div>
    </>
  );
}
