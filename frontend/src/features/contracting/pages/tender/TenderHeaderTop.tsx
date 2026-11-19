import { useTranslation } from 'react-i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { TenderItem } from './tender-page-types';

export interface TenderHeaderTopProps {
  items: TenderItem[];
  tendersUnderStudyCount: number;
  handleStartNewTender: () => void;
  handleExportPricedExcel: () => void;
  setIsTenderSwitcherOpen: (open: boolean) => void;
  setIsWorkflowMapOpen: (open: boolean) => void;
  setIsAutoPricingOpen: (open: boolean) => void;
  setIsQuotationOpen: (open: boolean) => void;
}

export function TenderHeaderTop({
  items,
  tendersUnderStudyCount,
  handleStartNewTender,
  handleExportPricedExcel,
  setIsTenderSwitcherOpen,
  setIsWorkflowMapOpen,
  setIsAutoPricingOpen,
  setIsQuotationOpen,
}: TenderHeaderTopProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* 1. Header & Bid Setup Card */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h2 style={{ fontSize: 'var(--font-page-title)', fontWeight: 800, color: '#170e5e', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AppIcons.Sliders size={20} />
              {t('contracting.contracting_tender_page.s0', "المرحلة 1: دراسة وتسعير العطاءات والمشروعات المحتملة (Tender & Bid Estimator)")}
            </h2>
            <p style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', margin: '4px 0 0' }}>
              {t('contracting.contracting_tender_page.s1', "حصر الكميات من المخططات وتفكيك الكود الهندسي (BOM) لضبط نسب الخامات والمصنعيات وحساب الأرباح قبل توقيع العقد.")}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleStartNewTender}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 700,
                background: '#170e5e',
                color: '#ffffff',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                boxShadow: '0 1px 3px rgba(23, 14, 94, 0.15)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Plus size={15} />
              <span>{t('contracting.contracting_tender_page.s2', "تسعير عطاء جديد")}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsTenderSwitcherOpen(true)}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#1e293b',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Folder size={15} />
              <span>{t('contracting.contracting_tender_page.s3', "العطاءات المحفوظة")}</span>
              <span
                style={{
                  fontSize: 'var(--font-badge)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  background: '#f1f5f9',
                  color: '#170e5e',
                  fontWeight: 700,
                  border: '1px solid #cbd5e1',
                }}
              >
                {tendersUnderStudyCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsWorkflowMapOpen(true)}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Layers size={15} />
              <span>{t('contracting.contracting_tender_page.s4', "خريطة مسار المشروع")}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAutoPricingOpen(true)}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: 'var(--font-body)',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Calculator size={15} />
              <span>{t('contracting.contracting_tender_page.s5', "محرك التسعير الآلي")}</span>
            </button>

            <button
              type="button"
              disabled={items.length === 0}
              onClick={handleExportPricedExcel}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: items.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 'var(--font-body)',
                opacity: items.length > 0 ? 1 : 0.6,
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.FileSpreadsheet size={15} />
              <span>{t('contracting.contracting_tender_page.s6', "تصدير إكسيل مسعر (Excel)")}</span>
            </button>

            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => setIsQuotationOpen(true)}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                fontWeight: 600,
                background: '#ffffff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: items.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 'var(--font-body)',
                opacity: items.length > 0 ? 1 : 0.6,
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.Printer size={15} />
              <span>{t('contracting.contracting_tender_page.s7', "عرض سعر رسمي للعميل")}</span>
            </button>
          </div>
        </div>
    </>
  );
}
