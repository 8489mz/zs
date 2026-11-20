import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { ParsedBoqItemResult } from '../../utils/boqExcelParser';

export interface BoqPreviewFiltersProps {
  setActiveFilterTab: Dispatch<SetStateAction<'all' | 'ready' | 'unpriced' | 'preambles' | 'section_headers'>>;
  activeFilterTab: 'all' | 'ready' | 'unpriced' | 'preambles' | 'section_headers';
  t: TFunction;
  validRows: ParsedBoqItemResult[];
  readyRows: ParsedBoqItemResult[];
  unpricedRows: ParsedBoqItemResult[];
  preambleRows: ParsedBoqItemResult[];
  sectionHeaderRows: ParsedBoqItemResult[];
  ignoreSectionHeaders: boolean;
  setIgnoreSectionHeaders: Dispatch<SetStateAction<boolean>>;
  ignorePreambles: boolean;
  setIgnorePreambles: Dispatch<SetStateAction<boolean>>;
}

export function BoqPreviewFilters({
  setActiveFilterTab,
  activeFilterTab,
  t,
  validRows,
  readyRows,
  unpricedRows,
  preambleRows,
  sectionHeaderRows,
  ignoreSectionHeaders,
  setIgnoreSectionHeaders,
  ignorePreambles,
  setIgnorePreambles,
}: BoqPreviewFiltersProps) {
  return (
    <>
      {/* 1. Quick Status Filter Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setActiveFilterTab('all')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '6px',
            border: activeFilterTab === 'all' ? '1px solid #170e5e' : '1px solid #cbd5e1',
            backgroundColor: activeFilterTab === 'all' ? '#170e5e' : '#ffffff',
            color: activeFilterTab === 'all' ? '#ffffff' : '#334155',
            fontSize: 'var(--font-micro)',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <span>{t('contracting.import_boq_modal.s42', "جميع البنود المدرجة")}</span>
          <span
            style={{
              padding: '1px 6px',
              borderRadius: '10px',
              backgroundColor: activeFilterTab === 'all' ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
              fontSize: '10px',
              fontWeight: 800,
            }}
          >
            {validRows.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveFilterTab('ready')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '6px',
            border: activeFilterTab === 'ready' ? '1px solid #15803d' : '1px solid #cbd5e1',
            backgroundColor: activeFilterTab === 'ready' ? '#15803d' : '#ffffff',
            color: activeFilterTab === 'ready' ? '#ffffff' : '#15803d',
            fontSize: 'var(--font-micro)',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <AppIcons.CheckCircle size={13} />
          <span>{t('contracting.import_boq_modal.s43', "المسعرة والجاهزة")}</span>
          <span
            style={{
              padding: '1px 6px',
              borderRadius: '10px',
              backgroundColor: activeFilterTab === 'ready' ? 'rgba(255,255,255,0.2)' : '#dcfce7',
              color: activeFilterTab === 'ready' ? '#ffffff' : '#15803d',
              fontSize: '10px',
              fontWeight: 800,
            }}
          >
            {readyRows.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveFilterTab('unpriced')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '6px',
            border: activeFilterTab === 'unpriced' ? '1px solid #b45309' : '1px solid #cbd5e1',
            backgroundColor: activeFilterTab === 'unpriced' ? '#b45309' : '#ffffff',
            color: activeFilterTab === 'unpriced' ? '#ffffff' : '#b45309',
            fontSize: 'var(--font-micro)',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <AppIcons.AlertTriangle size={13} />
          <span>{t('contracting.import_boq_modal.s44', "غير المسعرة (للتسعير الفوري)")}</span>
          <span
            style={{
              padding: '1px 6px',
              borderRadius: '10px',
              backgroundColor: activeFilterTab === 'unpriced' ? 'rgba(255,255,255,0.2)' : '#fef3c7',
              color: activeFilterTab === 'unpriced' ? '#ffffff' : '#b45309',
              fontSize: '10px',
              fontWeight: 800,
            }}
          >
            {unpricedRows.length}
          </span>
        </button>

        {preambleRows.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilterTab('preambles')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: activeFilterTab === 'preambles' ? '1px solid #64748b' : '1px solid #cbd5e1',
              backgroundColor: activeFilterTab === 'preambles' ? '#64748b' : '#ffffff',
              color: activeFilterTab === 'preambles' ? '#ffffff' : '#475569',
              fontSize: 'var(--font-micro)',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.FileText size={13} />
            <span>{t('contracting.import_boq_modal.s45', "ديباجة وملاحظات عامة")}</span>
            <span
              style={{
                padding: '1px 6px',
                borderRadius: '10px',
                backgroundColor: activeFilterTab === 'preambles' ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
                color: activeFilterTab === 'preambles' ? '#ffffff' : '#475569',
                fontSize: '10px',
                fontWeight: 800,
              }}
            >
              {preambleRows.length}
            </span>
          </button>
        )}

        {sectionHeaderRows.length > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilterTab('section_headers')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: activeFilterTab === 'section_headers' ? '1px solid #475569' : '1px solid #cbd5e1',
              backgroundColor: activeFilterTab === 'section_headers' ? '#475569' : '#ffffff',
              color: activeFilterTab === 'section_headers' ? '#ffffff' : '#64748b',
              fontSize: 'var(--font-micro)',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <AppIcons.FileText size={13} />
            <span>{t('contracting.import_boq_modal.s46', "عناوين الأبواب (DIVISION)")}</span>
            <span
              style={{
                padding: '1px 6px',
                borderRadius: '10px',
                backgroundColor: activeFilterTab === 'section_headers' ? 'rgba(255,255,255,0.2)' : '#f1f5f9',
                color: activeFilterTab === 'section_headers' ? '#ffffff' : '#64748b',
                fontSize: '10px',
                fontWeight: 800,
              }}
            >
              {sectionHeaderRows.length}
            </span>
          </button>
        )}
      </div>

      {/* 2. Exclusion Checkboxes Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '10px 14px',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
        }}
      >
        {sectionHeaderRows.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: 'var(--font-subtitle)',
                fontWeight: 700,
                color: '#1e293b',
              }}
            >
              <input
                type="checkbox"
                checked={ignoreSectionHeaders}
                onChange={(e) => setIgnoreSectionHeaders(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#170e5e' }}
              />
              <span>
                {t('contracting.import_boq_modal.s47', "استبعاد سطور العناوين والأبواب الاستشارية (")}{sectionHeaderRows.length} {t('contracting.import_boq_modal.s48', "عنوان مثل DIVISION و Section) من بنود المقايسة")}
              </span>
            </label>
            <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>
              {ignoreSectionHeaders
                ? t('contracting.import_boq_modal.s49', "العناوين مستبعدة تلقائياً لضمان سحب البنود التنفيذية فقط")
                : t('contracting.import_boq_modal.s50', "العناوين مدرجة كبنود مسودة")}
            </span>
          </div>
        )}

        {preambleRows.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: sectionHeaderRows.length > 0 ? '1px dashed #e2e8f0' : 'none',
              paddingTop: sectionHeaderRows.length > 0 ? '8px' : 0,
            }}
          >
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: 'var(--font-subtitle)',
                fontWeight: 700,
                color: '#1e293b',
              }}
            >
              <input
                type="checkbox"
                checked={ignorePreambles}
                onChange={(e) => setIgnorePreambles(e.target.checked)}
                style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#170e5e' }}
              />
              <span>
                {t('contracting.import_boq_modal.s51', "استبعاد سطور الملاحظات والديباجة الاستشارية العامة (")}{preambleRows.length} {t('contracting.import_boq_modal.s52', "سطر بدون كمية وسعر) من بنود المقايسة")}
              </span>
            </label>
            <span style={{ fontSize: 'var(--font-micro)', color: '#64748b', fontWeight: 600 }}>
              {ignorePreambles
                ? t('contracting.import_boq_modal.s53', "الملاحظات مستبعدة لتركيز المقايسة على البنود ذات الحصر والكميات فقط")
                : t('contracting.import_boq_modal.s54', "الملاحظات مدرجة كبنود استشارية")}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
