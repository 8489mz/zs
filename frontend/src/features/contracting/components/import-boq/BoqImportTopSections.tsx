import type { ChangeEvent, RefObject } from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';

export interface BoqImportTopSectionsProps {
  t: TFunction;
  handleDownloadTemplate: () => Promise<void>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  fileName: string;
  sheetNames: string[];
  selectedSheet: string;
  handleSheetChange: (newSheetName: string) => Promise<void>;
  generalError: string | null;
  isParsing: boolean;
}

export function BoqImportTopSections({
  t,
  handleDownloadTemplate,
  fileInputRef,
  handleFileChange,
  fileName,
  sheetNames,
  selectedSheet,
  handleSheetChange,
  generalError,
  isParsing,
}: BoqImportTopSectionsProps) {
  return (
    <>
      {/* Banner with Template Download */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 'var(--font-body)', color: '#1e293b' }}>
            {t('contracting.import_boq_modal.s5', "محرك الاستيراد الذكي الشامل (Universal BOQ & PDF Importer)")}
          </div>
          <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', marginTop: '2px' }}>
            {t('contracting.import_boq_modal.s6', "يدعم ملفات Excel و CSV ومستندات PDF الاستشارية، مع التعرف التلقائي على صف الهيدر، تجميع البنود متعددة الأسطر، ترجمة الوحدات، وتصنيف الأعمال هندسياً.")}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadTemplate}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            backgroundColor: '#ffffff',
            color: '#170e5e',
            fontSize: 'var(--font-badge)',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <AppIcons.Download size={14} />
          {t('contracting.import_boq_modal.s7', "تحميل النموذج الاسترشادي (XLSX)")}
        </button>
      </div>

      {/* File Input & Drop Area */}
      <div
        style={{
          border: '2px dashed #cbd5e1',
          borderRadius: '10px',
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#ffffff',
          cursor: 'pointer',
          transition: 'border-color 0.2s',
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx, .xls, .csv, .pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', color: '#170e5e' }}>
          {fileName?.toLowerCase().endsWith('.pdf') ? (
            <AppIcons.FileText size={36} />
          ) : (
            <AppIcons.FileSpreadsheet size={36} />
          )}
        </div>
        <div style={{ fontWeight: 700, fontSize: 'var(--font-body)', color: '#0f172a' }}>
          {fileName ? `الملف المحدد: ${fileName}` : t('contracting.import_boq_modal.s8', "اضغط لاختيار ملف Excel أو CSV أو PDF لجدول المقايسة")}
        </div>
        <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b', marginTop: '4px' }}>
          {t('contracting.import_boq_modal.s9', "يدعم ملفات .xlsx و .xls و .csv و .pdf (مع التعرف التلقائي على الجداول وتجميع البنود متعددة الأسطر)")}
        </div>
      </div>

      {/* Multi-Sheet Detection Bar */}
      {sheetNames.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#1e293b' }}>
            {t('contracting.import_boq_modal.s10', "صفحة العمل (Sheet):")}
          </div>
          <select
            value={selectedSheet}
            onChange={(e) => handleSheetChange(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #94a3b8',
              backgroundColor: '#ffffff',
              fontWeight: 600,
              color: '#0f172a',
              fontSize: 'var(--font-subtitle)',
              cursor: 'pointer',
            }}
          >
            {sheetNames.map((name) => (
              <option key={name} value={name}>
                {name} {name === selectedSheet ? t('contracting.import_boq_modal.s11', " (المختارة)") : ''}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
            {t('contracting.import_boq_modal.s12', "تم التعرف على (")}{sheetNames.length}{t('contracting.import_boq_modal.s13', ") صفحات، وتم اختيار الصفحة الأكثر مطابقة لبنود المقايسة تلقائياً.")}
          </div>
        </div>
      )}

      {/* Error Notification */}
      {generalError && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontSize: 'var(--font-body)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AppIcons.AlertCircle size={16} />
          <span>{generalError}</span>
        </div>
      )}

      {/* Parsing Progress */}
      {isParsing && (
        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: 'var(--font-body)' }}>
          {t('contracting.import_boq_modal.s14', "جاري قراءة وتحليل بيانات المقايسة والكشف الذكي عن الأعمدة...")}
        </div>
      )}
    </>
  );
}
