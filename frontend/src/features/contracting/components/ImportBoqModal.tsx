import { useTranslation } from 'react-i18next';
import { useState, useRef } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { downloadExcelFile } from '@/lib/browser';
import { getTextDirection } from '@/lib/arabic-normalization';
import { contractingApi } from '../api/contracting.api';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import {
  parseBoqWorkbook,
  reExtractBoqWithCustomMapping,
  ParsedBoqItemResult,
  ColumnMapping,
} from '../utils/boqExcelParser';
import {
  parseBoqPdf,
  reExtractBoqPdfWithCustomMapping,
} from '../utils/boqPdfParser';
import { registerOriginalWorkbook } from '../utils/originalWorkbookPricer';

interface ImportBoqModalProps {
  open: boolean;
  projectId?: string;
  projectName?: string;
  existingItemCount?: number;
  onClose: () => void;
  onImported?: () => void;
  onSuccess?: () => void;
  onImportItems?: (items: ParsedBoqItemResult[], mode: 'append' | 'replace') => void;
}

const CATEGORY_NAMES: Record<string, string> = {
  fire_fighting: 'مكافحة وإطفاء الحريق',
  hvac: 'تكييف وتهوية',
  civil_concrete: 'خرسانة ومدني',
  architecture_finishes: 'تشطيبات ومعماري',
  plumbing_sanitary: 'صحي وتغذية',
  electrical_power: 'كهرباء وإنارة',
  hvac_firefighting: 'تكييف وإطفاء',
  general: 'أعمال عامة',
};

const UNIT_LABELS: Record<string, string> = {
  m3: 'م3',
  m2: 'م2',
  m: 'م.ط',
  item: 'عدد',
  ls: 'مقطوعية',
  point: 'نقطة',
  set: 'طقم',
  ton: 'طن',
  kg: 'كجم',
};

export function ImportBoqModal({
  open,
  projectId,
  projectName,
  existingItemCount = 0,
  onClose,
  onImported,
  onSuccess,
  onImportItems,
}: ImportBoqModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // INV-FE3-FRONTEND-BOOK-DIGITS: row totals are money; they round at the
  // tenant's book digits, not hardcoded 2dp. (Row prices/quantities keep
  // their 4dp parse precision — they are unit prices, not money totals.)
  const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [fileName, setFileName] = useState<string>('');
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [pdfMatrix, setPdfMatrix] = useState<string[][] | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    itemCodeCol: -1,
    descriptionCol: -1,
    categoryCol: -1,
    unitCol: -1,
    qtyCol: -1,
    unitPriceCol: -1,
    estimatedCostCol: -1,
    notesCol: -1,
    totalPriceCol: -1,
  });
  const [showCustomMapping, setShowCustomMapping] = useState(false);
  const [ignoreSectionHeaders, setIgnoreSectionHeaders] = useState(true);
  const [ignorePreambles, setIgnorePreambles] = useState(false);
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'ready' | 'unpriced' | 'preambles' | 'section_headers'>('all');
  const [parsedRows, setParsedRows] = useState<ParsedBoqItemResult[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const isPdf = Boolean(pdfMatrix) || (Boolean(fileName) && fileName.toLowerCase().endsWith('.pdf'));

  const handleDownloadTemplate = async () => {
    const headersList = [
      'كود البند (Item Code)',
      'بيان الأعمال والمواصفات (Description)',
      'التصنيف (Category)',
      'الوحدة (Unit)',
      'الكمية التعاقدية (Contract Qty)',
      'سعر الفئة التعاقدي (Unit Price)',
      'التكلفة التقديرية للوحدة (Estimated Cost)',
      'ملاحظات (Notes)',
    ];

    const sampleRows = [
      ['CIV-001', 'حفر وتطهير للموقع وتجهيز المناسيب طبقاً للمواصفات', 'civil_concrete', 'm3', 500, 45, 30, 'حسب المناسيب التصميمية'],
      ['CIV-002', 'خرسانة عادية للأساسات سمك 20 سم إجهاد 250 كجم/سم2', 'civil_concrete', 'm3', 120, 1400, 1150, 'معالجة كيميائية'],
      ['CIV-003', 'خرسانة مسلحة للقواعد والأعمدة شاملة حديد التسليح والصب', 'civil_concrete', 'm3', 85, 3400, 2750, 'حديد عز إجهاد 400'],
      ['ARC-001', 'مباني طوب أسمنتي مصمت سمك 25 سم لزوم الأساسات', 'architecture_finishes', 'm2', 350, 220, 175, 'بمونة أسمنتية 300 كجم'],
      ['FIN-001', 'بياض محارة أسمنتية للحوائط الداخلية مؤكد بالبؤج والأوتار', 'architecture_finishes', 'm2', 1200, 85, 65, 'سمك 2 سم'],
      ['MEP-001', 'تأسيس مواسير وتغذية مياه وصرف صحي معتمد', 'plumbing_sanitary', 'ls', 1, 45000, 36000, 'شامل التركيب والاختبار'],
    ];

    const safeProjectName = projectName ? projectName.replace(/[/\\?%*:|"<>]/g, '_') : 'project';
    await downloadExcelFile(`BOQ_Template_${safeProjectName}.xlsx`, headersList, sampleRows);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isPdfFile = file.name.toLowerCase().endsWith('.pdf');
    setFileName(file.name);
    setIsParsing(true);
    setGeneralError(null);
    setShowCustomMapping(false);

    try {
      const buffer = await file.arrayBuffer();
      setFileBuffer(buffer);

      let result: any;
      if (isPdfFile) {
        const pdfResult = await parseBoqPdf(buffer);
        setPdfMatrix(pdfResult.rawMatrix);
        result = pdfResult;
      } else {
        setPdfMatrix(null);
        result = await parseBoqWorkbook(file);
      }

      if (!result.rows || result.rows.length === 0) {
        setGeneralError('الملف فارغ أو لا يحتوي على بنود أعمال صالحة.');
        setParsedRows([]);
        return;
      }

      setSheetNames(result.sheetNames);
      setSelectedSheet(result.selectedSheet);
      setHeaderRowIndex(result.headerRowIndex);
      setHeaders(result.headers);
      setColumnMapping(result.columnMapping);
      setParsedRows(result.rows);

      if (!isPdfFile && buffer) {
        registerOriginalWorkbook({
          fileName: file.name,
          buffer,
          sheetName: result.selectedSheet,
          columnMapping: result.columnMapping,
          headerRowIndex: result.headerRowIndex,
        });
      }
    } catch (err: any) {
      setGeneralError(err?.message || 'تعذر قراءة محتويات الملف، يرجى التأكد من صيغة Excel أو CSV أو PDF');
      setParsedRows([]);
    } finally {
      setIsParsing(false);
    }
  };

  const handleSheetChange = async (newSheetName: string) => {
    if (!fileBuffer || !newSheetName || newSheetName === selectedSheet) return;

    setSelectedSheet(newSheetName);
    setIsParsing(true);
    setGeneralError(null);

    try {
      const file = new File([fileBuffer], fileName, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const result = await parseBoqWorkbook(file, newSheetName);

      setHeaderRowIndex(result.headerRowIndex);
      setHeaders(result.headers);
      setColumnMapping(result.columnMapping);
      setParsedRows(result.rows);

      if (!isPdf && fileBuffer) {
        registerOriginalWorkbook({
          fileName,
          buffer: fileBuffer,
          sheetName: newSheetName,
          columnMapping: result.columnMapping,
          headerRowIndex: result.headerRowIndex,
        });
      }
    } catch (err: any) {
      setGeneralError(err?.message || `تعذر قراءة صفحة ${newSheetName}`);
    } finally {
      setIsParsing(false);
    }
  };

  const handleColumnMappingChange = (field: keyof ColumnMapping, newColIdx: number) => {
    if (!fileBuffer) return;

    const updatedMapping = { ...columnMapping, [field]: newColIdx };
    setColumnMapping(updatedMapping);

    if (!isPdf && fileBuffer) {
      registerOriginalWorkbook({
        fileName,
        buffer: fileBuffer,
        sheetName: selectedSheet,
        columnMapping: updatedMapping,
        headerRowIndex,
      });
    }

    try {
      if (pdfMatrix) {
        const { rows } = reExtractBoqPdfWithCustomMapping(pdfMatrix, updatedMapping);
        setParsedRows(rows);
      } else if (selectedSheet) {
        const { rows } = reExtractBoqWithCustomMapping(
          fileBuffer,
          selectedSheet,
          headerRowIndex,
          updatedMapping,
          fileName
        );
        setParsedRows(rows);
      }
    } catch (err: any) {
      setGeneralError(err?.message || 'حدث خطأ أثناء إعادة مطابقة الأعمدة');
    }
  };

  const sectionHeaderRows = parsedRows.filter((r) => r.isSectionHeader);
  const preambleRows = parsedRows.filter((r) => r.isPreamble);

  const validRows = parsedRows.filter((r) => {
    if (ignoreSectionHeaders && r.isSectionHeader) return false;
    if (ignorePreambles && r.isPreamble) return false;
    return r.isValid;
  });

  const readyRows = validRows.filter((r) => r.status === 'ready');
  const unpricedRows = validRows.filter((r) => r.status === 'unpriced');
  const totalContractVal = validRows.reduce((sum, r) => sum + r.contractQty * r.unitPrice, 0);
  const totalCostVal = validRows.reduce((sum, r) => sum + r.contractQty * r.estimatedUnitCost, 0);

  const displayedRows = parsedRows.filter((r) => {
    if (activeFilterTab === 'ready') {
      return r.status === 'ready' && !r.isSectionHeader && (!ignorePreambles || !r.isPreamble);
    }
    if (activeFilterTab === 'unpriced') {
      return r.status === 'unpriced' && !r.isSectionHeader && (!ignorePreambles || !r.isPreamble);
    }
    if (activeFilterTab === 'preambles') {
      return r.isPreamble;
    }
    if (activeFilterTab === 'section_headers') {
      return r.isSectionHeader;
    }
    // 'all' tab:
    if (ignoreSectionHeaders && r.isSectionHeader) return false;
    if (ignorePreambles && r.isPreamble) return false;
    return true;
  });

  const handleRowPriceChange = (rowIndex: number, newPrice: number) => {
    setParsedRows((prev) =>
      prev.map((r) => {
        if (r.index !== rowIndex) return r;
        const raw = isNaN(newPrice) ? 0 : Math.max(0, newPrice);
        const updatedPrice = Math.round((raw + Number.EPSILON) * 10000) / 10000;
        const updatedTotal = roundMoneyValue(r.contractQty * updatedPrice, bookDigits);
        let newStatus = r.status;
        let warning = r.warningMessage;
        let valid = r.isValid;

        if (updatedPrice > 0) {
          if (r.contractQty > 0) {
            newStatus = 'ready';
            warning = undefined;
            valid = true;
          } else {
            newStatus = 'zero_qty';
            warning = 'كمية تعاقدية مبدئية: 0';
            valid = true;
          }
        } else {
          newStatus = 'unpriced';
          warning = r.contractQty > 0 ? 'غير مسعر (بند مناقصة للتسعير لاحقاً)' : 'غير مسعر وكمية صفرية';
        }

        return {
          ...r,
          unitPrice: updatedPrice,
          totalPrice: updatedTotal,
          status: newStatus,
          warningMessage: warning,
          isValid: valid,
        };
      })
    );
  };

  const handleRowQtyChange = (rowIndex: number, newQty: number) => {
    setParsedRows((prev) =>
      prev.map((r) => {
        if (r.index !== rowIndex) return r;
        const raw = isNaN(newQty) ? 0 : Math.max(0, newQty);
        const updatedQty = Math.round((raw + Number.EPSILON) * 10000) / 10000;
        const updatedTotal = roundMoneyValue(updatedQty * r.unitPrice, bookDigits);
        let newStatus = r.status;
        let warning = r.warningMessage;

        if (updatedQty > 0) {
          if (r.unitPrice > 0) {
            newStatus = 'ready';
            warning = undefined;
          } else {
            newStatus = 'unpriced';
            warning = 'غير مسعر (بند مناقصة للتسعير لاحقاً)';
          }
        } else {
          if (r.unitPrice > 0) {
            newStatus = 'zero_qty';
            warning = 'كمية تعاقدية مبدئية: 0';
          } else {
            newStatus = 'unpriced';
            warning = 'غير مسعر وكمية صفرية';
          }
        }

        return {
          ...r,
          contractQty: updatedQty,
          totalPrice: updatedTotal,
          status: newStatus,
          warningMessage: warning,
        };
      })
    );
  };

  const handleRowUnitChange = (rowIndex: number, newUnit: string) => {
    setParsedRows((prev) =>
      prev.map((r) => (r.index === rowIndex ? { ...r, unit: newUnit } : r))
    );
  };

  const handleRowCategoryChange = (rowIndex: number, newCategory: string) => {
    setParsedRows((prev) =>
      prev.map((r) => (r.index === rowIndex ? { ...r, category: newCategory } : r))
    );
  };

  const handleImport = async () => {
    if (validRows.length === 0) {
      setGeneralError('لا توجد بنود صالحة للاستيراد في الملف');
      return;
    }

    setIsSubmitting(true);
    setGeneralError(null);

    try {
      if (!isPdf && fileBuffer && fileName) {
        registerOriginalWorkbook({
          fileName,
          buffer: fileBuffer,
          sheetName: selectedSheet,
          columnMapping,
          headerRowIndex,
        });
      }

      if (onImportItems) {
        onImportItems(validRows, importMode);
        (onImported || onSuccess)?.();
        onClose();
        return;
      }

      if (!projectId) {
        setGeneralError('معرف المشروع غير محدد');
        return;
      }

      const itemsToCreate = validRows.map((r) => ({
        itemCode: r.itemCode,
        description: r.description,
        category: r.category,
        unit: r.unit || 'm3',
        contractQty: r.contractQty,
        unitPrice: r.unitPrice,
        estimatedUnitCost: r.estimatedUnitCost,
        notes: r.notes,
      }));

      await contractingApi.batchCreateBoqItems(projectId, itemsToCreate);
      (onImported || onSuccess)?.();
      onClose();
    } catch (err: any) {
      setGeneralError(err?.message || 'حدث خطأ أثناء استيراد بنود المقايسة');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={onImportItems ? t('contracting.import_boq_modal.s0', "استيراد مقايسة العطاء (Excel / PDF)") : t('contracting.import_boq_modal.s1', "استيراد جدول الكميات والمقايسة (Excel / PDF)")}
      subtitle={projectName ? `المشروع: ${projectName}` : t('contracting.import_boq_modal.s2', "التعرف الذكي التلقائي على الأعمدة والوحدات باللغتين العربية والإنجليزية")}
      width="min(1280px, 98vw)"
      minHeight="min(600px, 85vh)"
      footerActions={(
        <StandardDialogFooter
          onCancel={onClose}
          onSubmit={handleImport}
          submitText={
            isSubmitting
              ? t('contracting.import_boq_modal.s3', "جاري الاستيراد...")
              : onImportItems
                ? importMode === 'append' && existingItemCount > 0
                  ? `تأكيد إلحاق وإضافة (${validRows.length}) بند بالمشروع`
                  : `تأكيد إدراج (${validRows.length}) بند في دراسة العطاء`
                : `تأكيد استيراد (${validRows.length}) بند إلى المقايسة`
          }
          cancelText={t('contracting.import_boq_modal.s4', "إلغاء")}
          submitDisabled={isSubmitting || validRows.length === 0}
        />
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
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

        {/* Custom Column Mapping Accordion */}
        {parsedRows.length > 0 && !isParsing && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
            <div
              onClick={() => setShowCustomMapping(!showCustomMapping)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 14px',
                background: '#f8fafc',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AppIcons.Settings size={15} color="#170e5e" />
                <span style={{ fontWeight: 700, fontSize: 'var(--font-subtitle)', color: '#1e293b' }}>
                  {t('contracting.import_boq_modal.s26', "تخصيص مطابقة أعمدة الملف يدوياً (Column Mapping)")}
                </span>
                <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                  {t('contracting.import_boq_modal.s27', "(صف الهيدر المكتشف: الصف رقم")} {headerRowIndex + 1})
                </span>
              </div>
              <div style={{ fontSize: 'var(--font-micro)', color: '#170e5e', fontWeight: 700 }}>
                {showCustomMapping ? t('contracting.import_boq_modal.s28', "إخفاء الخيارات ▲") : t('contracting.import_boq_modal.s29', "تعديل مطابقة الأعمدة ▼")}
              </div>
            </div>

            {showCustomMapping && (
              <div
                style={{
                  padding: '14px',
                  background: '#ffffff',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '12px',
                  borderTop: '1px solid #e2e8f0',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.import_boq_modal.s30', "بيان الأعمال والمواصفات (إلزامي):")}
                  </label>
                  <select
                    value={columnMapping.descriptionCol}
                    onChange={(e) => handleColumnMappingChange('descriptionCol', Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-subtitle)' }}
                  >
                    <option value={-1}>{t('contracting.import_boq_modal.s31', "-- غير محدد --")}</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {idx + 1}: {h || `عمود ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.import_boq_modal.s32', "الكمية التعاقدية (Quantity):")}
                  </label>
                  <select
                    value={columnMapping.qtyCol}
                    onChange={(e) => handleColumnMappingChange('qtyCol', Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-subtitle)' }}
                  >
                    <option value={-1}>{t('contracting.import_boq_modal.s33', "-- غير محدد (افتراضي 0) --")}</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {idx + 1}: {h || `عمود ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.import_boq_modal.s34', "سعر الفئة التعاقدي (Unit Price):")}
                  </label>
                  <select
                    value={columnMapping.unitPriceCol}
                    onChange={(e) => handleColumnMappingChange('unitPriceCol', Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-subtitle)' }}
                  >
                    <option value={-1}>{t('contracting.import_boq_modal.s35', "-- غير محدد (غير مسعر 0) --")}</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {idx + 1}: {h || `عمود ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.import_boq_modal.s36', "وحدة القياس (Unit):")}
                  </label>
                  <select
                    value={columnMapping.unitCol}
                    onChange={(e) => handleColumnMappingChange('unitCol', Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-subtitle)' }}
                  >
                    <option value={-1}>{t('contracting.import_boq_modal.s37', "-- غير محدد (افتراضي م3) --")}</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {idx + 1}: {h || `عمود ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.import_boq_modal.s38', "كود البند / مسلسل (Item Code):")}
                  </label>
                  <select
                    value={columnMapping.itemCodeCol}
                    onChange={(e) => handleColumnMappingChange('itemCodeCol', Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-subtitle)' }}
                  >
                    <option value={-1}>{t('contracting.import_boq_modal.s39', "-- توليد تسلسلي تلقائي --")}</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {idx + 1}: {h || `عمود ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {t('contracting.import_boq_modal.s40', "التصنيف الهندسي (Category):")}
                  </label>
                  <select
                    value={columnMapping.categoryCol}
                    onChange={(e) => handleColumnMappingChange('categoryCol', Number(e.target.value))}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: 'var(--font-subtitle)' }}
                  >
                    <option value={-1}>{t('contracting.import_boq_modal.s41', "-- تصنيف ذكي تلقائي من البيان --")}</option>
                    {headers.map((h, idx) => (
                      <option key={idx} value={idx}>
                        {idx + 1}: {h || `عمود ${idx + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview Table & Filter Controls */}
        {parsedRows.length > 0 && !isParsing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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

            {/* 3. Interactive BOQ Data Table */}
            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                overflowX: 'hidden',
                overflowY: 'auto',
                maxHeight: '440px',
                backgroundColor: '#ffffff',
                width: '100%',
              }}
            >
              <table
                style={{
                  width: '100%',
                  tableLayout: 'fixed',
                  borderCollapse: 'collapse',
                  fontSize: 'var(--font-subtitle)',
                }}
              >
                <colgroup>
                  <col style={{ width: '36px' }} />
                  <col style={{ width: '75px' }} />
                  <col />
                  <col style={{ width: '140px' }} />
                  <col style={{ width: '75px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '105px' }} />
                  <col style={{ width: '105px' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 2 }}>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s55', "م")}</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s56', "كود البند")}</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s57', "بيان الأعمال والمواصفات")}</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s58', "التخصص")}</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s59', "الوحدة")}</th>
                    <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s60', "الكمية")}</th>
                    <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s61', "سعر الفئة")}</th>
                    <th style={{ padding: '10px 6px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s62', "إجمالي القيمة")}</th>
                    <th style={{ padding: '10px 6px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>{t('contracting.import_boq_modal.s63', "الحالة")}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: 'var(--font-body)' }}>
                        {t('contracting.import_boq_modal.s64', "لا توجد بنود تطابق التصفية المختارة")}
                      </td>
                    </tr>
                  ) : (
                    displayedRows.map((row) => {
                      const isRowIgnored =
                        (ignoreSectionHeaders && row.isSectionHeader) ||
                        (ignorePreambles && row.isPreamble);

                      return (
                        <tr
                          key={row.index}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            backgroundColor: isRowIgnored
                              ? '#f8fafc'
                              : !row.isValid
                              ? '#fff1f2'
                              : row.status === 'unpriced'
                              ? '#fffbeb'
                              : 'transparent',
                            opacity: isRowIgnored ? 0.75 : 1,
                          }}
                        >
                          <td style={{ padding: '8px 4px', textAlign: 'center', color: '#64748b' }}>{row.index}</td>
                          <td
                            style={{
                              padding: '8px 6px',
                              textAlign: 'center',
                              fontWeight: 700,
                              color: '#1e293b',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              fontSize: 'var(--font-micro)',
                            }}
                            title={row.itemCode}
                          >
                            {row.itemCode}
                          </td>
                          {(() => {
                            const dir = getTextDirection(row.description);
                            const isRtl = dir === 'rtl';
                            return (
                              <td
                                dir={dir}
                                className="spec-description text-justify"
                                style={{
                                  padding: '10px 14px',
                                  textAlign: isRtl ? 'right' : 'left',
                                  textAlignLast: isRtl ? 'right' : 'left',
                                  textJustify: 'inter-word',
                                  lineHeight: 1.55,
                                  wordBreak: 'break-word',
                                  overflowWrap: 'break-word',
                                  whiteSpace: 'normal',
                                  direction: dir,
                                  verticalAlign: 'middle',
                                }}
                              >
                                <div
                                  dir={dir}
                                  style={{
                                    fontWeight: row.isSectionHeader ? 700 : 600,
                                    color: '#0f172a',
                                    textAlign: isRtl ? 'right' : 'left',
                                    textAlignLast: isRtl ? 'right' : 'left',
                                    direction: dir,
                                    wordBreak: 'break-word',
                                    overflowWrap: 'break-word',
                                    whiteSpace: 'normal',
                                  }}
                                >
                                  {row.description}
                                </div>
                                {row.warningMessage && (
                                  <div
                                    dir="rtl"
                                    style={{
                                      color: row.isSectionHeader ? '#64748b' : '#b45309',
                                      fontSize: 'var(--font-micro)',
                                      marginTop: '4px',
                                      fontWeight: 600,
                                      textAlign: 'right',
                                      direction: 'rtl',
                                    }}
                                  >
                                    {row.warningMessage}
                                  </div>
                                )}
                                {row.validationError && (
                                  <div
                                    dir="rtl"
                                    style={{
                                      color: '#b91c1c',
                                      fontSize: 'var(--font-micro)',
                                      marginTop: '4px',
                                      fontWeight: 600,
                                      textAlign: 'right',
                                      direction: 'rtl',
                                    }}
                                  >
                                    {row.validationError}
                                  </div>
                                )}
                              </td>
                            );
                          })()}
                          <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                            {row.isSectionHeader ? (
                              <span style={{ color: '#94a3b8' }}>-</span>
                            ) : (
                              <select
                                value={row.category || 'general'}
                                onChange={(e) => handleRowCategoryChange(row.index, e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  paddingLeft: '18px',
                                  borderRadius: '5px',
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#f8fafc',
                                  color: '#334155',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  textOverflow: 'ellipsis',
                                  overflow: 'hidden',
                                  outline: 'none',
                                  boxSizing: 'border-box',
                                }}
                              >
                                {Object.entries(CATEGORY_NAMES).map(([key, label]) => (
                                  <option key={key} value={key}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                            {row.isSectionHeader ? (
                              <span style={{ color: '#94a3b8' }}>-</span>
                            ) : (
                              <select
                                value={row.unit || ''}
                                onChange={(e) => handleRowUnitChange(row.index, e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '4px 4px',
                                  paddingLeft: '14px',
                                  borderRadius: '5px',
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: '#ffffff',
                                  color: '#334155',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  textAlign: 'center',
                                  outline: 'none',
                                  boxSizing: 'border-box',
                                }}
                              >
                                <option value="">-</option>
                                {Object.entries(UNIT_LABELS).map(([key, label]) => (
                                  <option key={key} value={key}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                            {row.isSectionHeader ? (
                              <span style={{ color: '#94a3b8' }}>-</span>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={row.contractQty === 0 ? '' : Math.round((row.contractQty + Number.EPSILON) * 10000) / 10000}
                                placeholder="0"
                                onChange={(e) => handleRowQtyChange(row.index, parseFloat(e.target.value) || 0)}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  borderRadius: '5px',
                                  border: '1px solid #cbd5e1',
                                  backgroundColor: row.contractQty === 0 ? '#fff7ed' : '#ffffff',
                                  fontSize: 'var(--font-subtitle)',
                                  fontWeight: 600,
                                  color: '#0f172a',
                                  textAlign: 'right',
                                  outline: 'none',
                                  boxSizing: 'border-box',
                                }}
                              />
                            )}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                            {row.isSectionHeader ? (
                              <span style={{ color: '#94a3b8' }}>-</span>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={row.unitPrice === 0 ? '' : Math.round((row.unitPrice + Number.EPSILON) * 10000) / 10000}
                                placeholder="0.00"
                                onChange={(e) => handleRowPriceChange(row.index, parseFloat(e.target.value) || 0)}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  borderRadius: '5px',
                                  border: row.unitPrice === 0 ? '1px solid #f59e0b' : row.isAutoPriced ? '1px solid #10b981' : '1px solid #cbd5e1',
                                  backgroundColor: row.unitPrice === 0 ? '#fffbeb' : row.isAutoPriced ? '#f0fdf4' : '#ffffff',
                                  fontSize: 'var(--font-subtitle)',
                                  fontWeight: 700,
                                  color: row.unitPrice === 0 ? '#b45309' : row.isAutoPriced ? '#15803d' : '#0f172a',
                                  textAlign: 'right',
                                  outline: 'none',
                                  boxSizing: 'border-box',
                                }}
                                title={row.isAutoPriced ? (row.warningMessage || t('contracting.import_boq_modal.s65', "تم التسعير التقديري تلقائياً من المكتبة الهندسية")) : (row.unitPrice === 0 ? t('contracting.import_boq_modal.s66', "انقر لتسعير البند مباشرة في المقايسة") : t('contracting.import_boq_modal.s67', "سعر الفئة التعاقدي"))}
                              />
                            )}
                          </td>
                          <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: '#170e5e', whiteSpace: 'nowrap', fontSize: 'var(--font-micro)' }}>
                            {row.isSectionHeader ? '-' : (row.contractQty * row.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {row.isSectionHeader ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: isRowIgnored ? '#64748b' : '#b45309',
                                  background: isRowIgnored ? '#f1f5f9' : '#fef3c7',
                                  padding: '3px 6px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 700,
                                }}
                              >
                                <AppIcons.FileText size={12} />
                                {t('contracting.import_boq_modal.s68', "عنوان رئيسي")}
                              </span>
                            ) : row.isPreamble && ignorePreambles ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#64748b',
                                  background: '#f1f5f9',
                                  padding: '3px 6px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 700,
                                }}
                              >
                                <AppIcons.FileText size={12} />
                                {t('contracting.import_boq_modal.s69', "ديباجة")}
                              </span>
                            ) : row.isAutoPriced ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#15803d',
                                  background: '#dcfce7',
                                  padding: '3px 6px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 700,
                                }}
                                title={row.warningMessage || t('contracting.import_boq_modal.s70', "تم التسعير التقديري تلقائياً من المكتبة الهندسية")}
                              >
                                <AppIcons.CheckCircle size={12} />
                                {t('contracting.import_boq_modal.s71', "مسعر آلياً")}
                              </span>
                            ) : row.status === 'ready' ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#15803d',
                                  background: '#dcfce7',
                                  padding: '3px 6px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 700,
                                }}
                              >
                                <AppIcons.CheckCircle size={12} />
                                {t('contracting.import_boq_modal.s72', "جاهز")}
                              </span>
                            ) : row.status === 'unpriced' ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#b45309',
                                  background: '#fef3c7',
                                  padding: '3px 6px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 700,
                                }}
                              >
                                <AppIcons.AlertTriangle size={12} />
                                {t('contracting.import_boq_modal.s73', "غير مسعر")}
                              </span>
                            ) : row.status === 'zero_qty' ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#c2410c',
                                  background: '#ffedd5',
                                  padding: '3px 6px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 700,
                                }}
                              >
                                <AppIcons.AlertTriangle size={12} />
                                {t('contracting.import_boq_modal.s74', "كمية 0")}
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  color: '#b91c1c',
                                  background: '#fee2e2',
                                  padding: '3px 6px',
                                  borderRadius: '6px',
                                  fontSize: 'var(--font-micro)',
                                  fontWeight: 700,
                                }}
                              >
                                <AppIcons.AlertCircle size={12} />
                                {t('contracting.import_boq_modal.s75', "غير صالح")}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </StandardDialog>
  );
}
