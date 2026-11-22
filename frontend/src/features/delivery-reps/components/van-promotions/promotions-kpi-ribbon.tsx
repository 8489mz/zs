import { useTranslation } from 'react-i18next';
import type { FmcgPromotion } from '../../api/van-sales.api';

export interface PromotionsKpiRibbonProps {
  promotions: FmcgPromotion[];
  activeCount: number;
  mixMatchCount: number;
  tieredCount: number;
}

export function PromotionsKpiRibbon({
  promotions,
  activeCount,
  mixMatchCount,
  tieredCount,
}: PromotionsKpiRibbonProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '14px',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s0', "إجمالي العروض الترويجية")}
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
          {promotions.length}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s1', "كافة الخطط والسياسات المسجلة")}
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s2', "العروض المفعلة حالياً")}
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#16a34a' }}>
          {activeCount}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s3', "تطبق فورياً في سلة المناديب")}
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s4', "باقات وخلطات (Mix & Match)")}
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#170e5e' }}>
          {mixMatchCount}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s5', "توليفات الأصناف المتزامنة")}
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s6', "شرائح الكميات وسقف الفاتورة")}
        </div>
        <div style={{ fontSize: '24px', fontWeight: 800, color: '#d97706' }}>
          {tieredCount}
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
          {t('delivery_reps.van_promotions_admin_tab.s7', "حوافز زيادة حجم الطلبية")}
        </div>
      </div>
    </div>
  );
}
