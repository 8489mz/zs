import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';

export interface TenderTotalsBarProps {
  consolidatedMaterials: Array<{
    code: string;
    name: string;
    unit: string;
    totalQty: number;
    totalCost: number;
  }>;
  grandTotals: {
    totalSellingPrice: number;
    totalDirectCost: number;
    totalProfit: number;
    profitMargin: number;
  };
  items: readonly unknown[];
  isSubmitting: boolean;
  formatCurrency: (value: number | string | undefined | null) => string;
  handleExportPricedClientExcel: () => Promise<void>;
  setIsQuotationOpen: (open: boolean) => void;
  handleSaveTender: (targetStatus: 'planning' | 'active') => Promise<void>;
}

export function TenderTotalsBar({
  consolidatedMaterials,
  grandTotals,
  items,
  isSubmitting,
  formatCurrency,
  handleExportPricedClientExcel,
  setIsQuotationOpen,
  handleSaveTender,
}: TenderTotalsBarProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* 5. Consolidated Pre-Procurement MRP Materials Takeoff */}
      {consolidatedMaterials.length > 0 && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px' }}>
          <h3 style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#0f172a', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AppIcons.Box size={18} />
            {t('contracting.contracting_tender_page.s81', "إجمالي الموارد والخامات التقديرية لتنفيذ العطاء بالكامل (Pre-Procurement Materials Takeoff)")}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            {consolidatedMaterials.slice(0, 8).map((mat, mIdx) => (
              <div key={mIdx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>{mat.name}</div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', margin: '3px 0' }}>
                  {mat.totalQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} {mat.unit}
                </div>
                <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: 600 }}>
                  {t('contracting.contracting_tender_page.s82', "التكلفة:")} {formatCurrency(mat.totalCost)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Bottom Sticky Award Bar */}
      <div
        style={{
          position: 'sticky',
          bottom: '20px',
          zIndex: 10,
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: '12px',
          padding: '14px 22px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          flexWrap: 'wrap',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_tender_page.s83', "إجمالي التكلفة المباشرة")}</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(grandTotals.totalDirectCost)}</div>
          </div>

          <div>
            <div style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>{t('contracting.contracting_tender_page.s84', "صافي الربح المتوقع (")}{grandTotals.profitMargin.toFixed(1)}%)</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: '#15803d' }}>{formatCurrency(grandTotals.totalProfit)}</div>
          </div>

          <div>
            <div style={{ fontSize: '12px', color: '#170e5e', fontWeight: 700 }}>{t('contracting.contracting_tender_page.s85', "إجمالي قيمة العطاء للعميل")}</div>
            <div style={{ fontSize: '19px', fontWeight: 800, color: '#170e5e' }}>{formatCurrency(grandTotals.totalSellingPrice)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={handleExportPricedClientExcel}
            title={t('contracting.contracting_tender_page.s86', "تصدير شيت العميل الأصلي بنفس ألوانه وديباجته وتنسيقاته مع كتابة الأسعار فقط")}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Download size={15} />
            <span>{t('contracting.contracting_tender_page.s87', "تصدير شيت العميل المسعر (Excel)")}</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => setIsQuotationOpen(true)}
            style={{
              height: '40px',
              padding: '0 16px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Printer size={15} />
            <span>{t('contracting.contracting_tender_page.s88', "عرض السعر للعميل")}</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => handleSaveTender('planning')}
            style={{
              height: '40px',
              padding: '0 18px',
              borderRadius: '8px',
              fontWeight: 600,
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.Save size={16} />
            <span>{isSubmitting ? t('contracting.contracting_tender_page.s89', "جاري الحفظ...") : t('contracting.contracting_tender_page.s90', "حفظ كعطاء قيد الدراسة (Planning)")}</span>
          </button>

          <button
            type="button"
            disabled={isSubmitting || items.length === 0}
            onClick={() => handleSaveTender('active')}
            style={{
              height: '40px',
              padding: '0 20px',
              borderRadius: '8px',
              fontWeight: 800,
              background: '#170e5e',
              color: '#ffffff',
              border: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              boxShadow: '0 2px 6px rgba(23, 14, 94, 0.25)',
              fontSize: '13px',
              opacity: items.length > 0 && !isSubmitting ? 1 : 0.6,
            }}
          >
            <AppIcons.CheckShield size={17} />
            <span>{isSubmitting ? t('contracting.contracting_tender_page.s91', "جاري الترسية والتأسيس...") : t('contracting.contracting_tender_page.s92', "اعتماد وترسية العطاء كمشروع رسمي")}</span>
          </button>
        </div>
      </div>
    </>
  );
}
