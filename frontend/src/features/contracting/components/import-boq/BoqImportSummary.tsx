import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { ParsedBoqItemResult } from '../../utils/boqExcelParser';

export interface BoqImportSummaryProps {
  parsedRows: ParsedBoqItemResult[];
  isParsing: boolean;
  t: TFunction;
  validRows: ParsedBoqItemResult[];
  unpricedRows: ParsedBoqItemResult[];
  totalContractVal: number;
  totalCostVal: number;
  existingItemCount: number;
  importMode: 'append' | 'replace';
  setImportMode: Dispatch<SetStateAction<'append' | 'replace'>>;
}

export function BoqImportSummary({
  parsedRows,
  isParsing,
  t,
  validRows,
  unpricedRows,
  totalContractVal,
  totalCostVal,
  existingItemCount,
  importMode,
  setImportMode,
}: BoqImportSummaryProps) {
  return (
    <>
        {/* Summary KPIs for Parsed Data */}
        {parsedRows.length > 0 && !isParsing && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.import_boq_modal.s15', "إجمالي البنود المقروءة")}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                {parsedRows.length} {t('contracting.import_boq_modal.s16', "بند")}
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.import_boq_modal.s17', "البنود الصالحة للاستيراد")}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#15803d' }}>
                  {validRows.length} {t('contracting.import_boq_modal.s18', "بند")}
                </span>
                {unpricedRows.length > 0 && (
                  <span style={{ fontSize: 'var(--font-micro)', color: '#b45309', fontWeight: 700 }}>
                    ({unpricedRows.length} {t('contracting.import_boq_modal.s19', "غير مسعر)")}
                  </span>
                )}
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.import_boq_modal.s20', "إجمالي القيمة التعاقدية")}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#170e5e', marginTop: '2px' }}>
                {totalContractVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>{t('contracting.import_boq_modal.s21', "إجمالي التكلفة التقديرية")}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#475569', marginTop: '2px' }}>
                {totalCostVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        )}

        {/* Mode Selector (Append vs Replace) if existing items exist */}
        {parsedRows.length > 0 && !isParsing && existingItemCount > 0 && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AppIcons.Layers size={16} color="#170e5e" />
              <span style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>
                {t('contracting.import_boq_modal.s22', "طريقة إدراج البنود في دراسة العطاء (يوجد حالياً")} {existingItemCount} {t('contracting.import_boq_modal.s23', "بند سابق):")}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: importMode === 'append' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
                  background: importMode === 'append' ? '#ffffff' : 'transparent',
                  color: importMode === 'append' ? '#170e5e' : '#64748b',
                  fontWeight: 700,
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  boxShadow: importMode === 'append' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'append'}
                  onChange={() => setImportMode('append')}
                  style={{ accentColor: '#170e5e' }}
                />
                <span>{t('contracting.import_boq_modal.s24', "➕ إلحاق وإضافة للبنود القائمة (دمج التخصصات)")}</span>
              </label>

              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: importMode === 'replace' ? '1.5px solid #b91c1c' : '1px solid #cbd5e1',
                  background: importMode === 'replace' ? '#ffffff' : 'transparent',
                  color: importMode === 'replace' ? '#b91c1c' : '#64748b',
                  fontWeight: 700,
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  boxShadow: importMode === 'replace' ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  style={{ accentColor: '#b91c1c' }}
                />
                <span>{t('contracting.import_boq_modal.s25', "🔄 استبدال وتفريغ البنود السابقة")}</span>
              </label>
            </div>
          </div>
        )}
    </>
  );
}
