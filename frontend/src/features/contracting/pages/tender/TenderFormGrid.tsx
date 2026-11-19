import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { AppIcons } from '@/shared/components/icons/AppIcons';

interface TenderFormGridProps {
  projectName: string;
  setProjectName: Dispatch<SetStateAction<string>>;
  clientName: string;
  setClientName: Dispatch<SetStateAction<string>>;
  globalProfitMargin: number;
  setGlobalProfitMargin: Dispatch<SetStateAction<number>>;
  globalOverhead: number;
  setGlobalOverhead: Dispatch<SetStateAction<number>>;
  globalWaste: number;
  setGlobalWaste: Dispatch<SetStateAction<number>>;
  handleApplyGlobalMargins: () => void;
}

export function TenderFormGrid({
  projectName,
  setProjectName,
  clientName,
  setClientName,
  globalProfitMargin,
  setGlobalProfitMargin,
  globalOverhead,
  setGlobalOverhead,
  globalWaste,
  setGlobalWaste,
  handleApplyGlobalMargins,
}: TenderFormGridProps) {
  const { t } = useTranslation();
  return (
    <>
        {/* Form Inputs Grid - سطر واحد هندسي متناسق بدون التفاف */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', width: '100%', flexWrap: 'nowrap' }}>
          <div style={{ flex: '2 1 220px', minWidth: '160px' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s22', "اسم المشروع / العطاء المقترح")}
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={t('contracting.contracting_tender_page.s23', "مثال: عطاء إنشاء مجمع سكني وتجاري")}
              style={{ width: '100%', height: '34px', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ flex: '1.5 1 170px', minWidth: '140px' }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s24', "العميل / جهة الإسناد")}
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={t('contracting.contracting_tender_page.s25', "اسم المالك أو جهة الطرح")}
              style={{ width: '100%', height: '34px', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ width: '95px', flexShrink: 0 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s26', "هامش الربح %")}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={globalProfitMargin}
              onChange={(e) => setGlobalProfitMargin(Number(e.target.value))}
              style={{ width: '100%', height: '34px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', textAlign: 'center', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ width: '95px', flexShrink: 0 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s27', "المصاريف %")}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={globalOverhead}
              onChange={(e) => setGlobalOverhead(Number(e.target.value))}
              style={{ width: '100%', height: '34px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', textAlign: 'center', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ width: '85px', flexShrink: 0 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-table-head)', fontWeight: 700, color: '#334155', marginBottom: '4px', whiteSpace: 'nowrap' }}>
              {t('contracting.contracting_tender_page.s28', "الهالك %")}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={globalWaste}
              onChange={(e) => setGlobalWaste(Number(e.target.value))}
              style={{ width: '100%', height: '34px', padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: 'var(--font-body)', textAlign: 'center', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleApplyGlobalMargins}
              style={{
                height: '34px',
                padding: '0 12px',
                borderRadius: '8px',
                fontWeight: 700,
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                color: '#170e5e',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
                transition: 'all 0.15s ease',
              }}
            >
              <AppIcons.CheckCircle size={14} />
              <span>{t('contracting.contracting_tender_page.s29', "تعميم النسب على كافة البنود")}</span>
            </button>
          </div>
        </div>
    </>
  );
}
