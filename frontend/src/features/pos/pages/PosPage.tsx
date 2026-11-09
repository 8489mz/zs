import { useTranslation } from 'react-i18next';
import { PosWorkspace } from '@/features/pos/components/PosWorkspace';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { FeatureGate } from '@/shared/components/feature-gate';
import { getPosAvailability } from '@/features/pos/lib/pos-availability';

export function PosPage() {
  const { t } = useTranslation();
  const { data: settings, isLoading } = useSettingsQuery();

  if (isLoading) {
    return (
      <div className="screen-center" style={{ minHeight: '60vh' }}>
        <div className="loading-card">{t('pos.pos_page.s0', "جاري التحقق من إعدادات نقطة البيع...")}</div>
      </div>
    );
  }

  // I5-D1: the availability rule lives in pos-availability.ts (single source
  // of truth shared with the sales register header). The vertical flags below
  // only pick which reason paragraph the disabled state shows.
  const availability = getPosAvailability(settings);
  const isWholesaleVertical = availability.reason === 'wholesale';
  const isWarehousingVertical = availability.reason === 'warehousing';
  const isNonRetailVertical = availability.available === false && availability.reason !== 'module-off';
  const isPosDisabled = !availability.available;
  // I5-D1: the current operation mode is what the trial read as "broken" —
  // name it explicitly instead of a bare "غير مفعّل".
  const isEnterpriseMode = settings?.enableEnterpriseFeatures === true;

  if (isPosDisabled) {
    return (
      <div
        dir="rtl"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '65vh',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '36px 28px',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: '#f1f5f9',
              border: '1px solid #e2e8f0',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              color: '#475569',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}>
            {t('pos.pos_page.s1', "موديول نقطة البيع (الكاشير) غير مفعّل")}
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.6, marginBottom: '24px' }}>
            {isWholesaleVertical
              ? t('pos.pos_page.s2', "هذا الحساب مهيأ لنمط تجارة الجملة والتوزيع المؤسسي وأسطول سيارات الفان، حيث تتم المبيعات الميدانية وإصدار الفواتير وأوامر البيع عبر شاشات توزيع الفان وسجل الفواتير بدون كاشير.")
              : isWarehousingVertical
              ? t('pos.pos_page.s2_wh', "هذا الحساب مهيأ لإدارة المخازن والمستودعات والتحويلات، حيث تعتمد الحركات على أذونات الصرف والإضافة والتحويلات بين الفروع ومحاضر الجرد بدون كاشير أو نقاط بيع.")
              : isNonRetailVertical
              ? t('pos.pos_page.s3', "هذا الحساب مخصص لقطاع تخصصي (مشاريع مقاولات أو شحن ولوجستيات أو خدمات) لا يعتمد على نقاط البيع المباشرة.")
              : t('pos.pos_page.s4', "تم تعطيل موديول نقطة البيع والكاشير في إعدادات المنشأة. يمكنك تفعيله من شاشة إعدادات الموديولات.")}
          </p>
          {isEnterpriseMode && (
            <p style={{ fontSize: '13px', color: '#1d4ed8', lineHeight: 1.6, marginBottom: '24px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 14px' }}>
              {t('pos.pos_page.s8', "النمط الحالي: مؤسسة تجارية متقدمة (Enterprise Trading) — نقاط البيع مغلقة عن قصد في هذا النمط، وتتم المبيعات عبر أوامر البيع ثم تحويلها إلى فواتير.")}
            </p>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {isWarehousingVertical && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/inventory';
                  }
                }}
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 22px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('pos.pos_page.s5_wh', "المستودعات والتحويلات")}
              </button>
            )}
            {isWholesaleVertical && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/inventory/van-sales';
                  }
                }}
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 22px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('pos.pos_page.s5', "سيارات التوزيع (الفان)")}
              </button>
            )}
            {isEnterpriseMode && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/sales/orders';
                  }
                }}
                style={{
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 22px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('pos.pos_page.s9', "أوامر البيع")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/dashboard';
                }
              }}
              style={{
                background: isWholesaleVertical || isWarehousingVertical || isEnterpriseMode ? '#f1f5f9' : '#170e5e',
                color: isWholesaleVertical || isWarehousingVertical || isEnterpriseMode ? '#334155' : '#ffffff',
                border: isWholesaleVertical || isWarehousingVertical || isEnterpriseMode ? '1px solid #cbd5e1' : 'none',
                borderRadius: '8px',
                padding: '10px 22px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('pos.pos_page.s6', "العودة إلى لوحة التحكم")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <FeatureGate feature="sales" featureName={t('pos.pos_page.s7', "نقطة البيع والكاشير")}>
      <PosWorkspace />
    </FeatureGate>
  );
}
