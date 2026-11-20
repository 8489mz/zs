import { useTranslation } from 'react-i18next';
import { useState, useRef } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { downloadExcelFile } from '@/lib/browser';
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
import { BoqImportTopSections } from './import-boq/BoqImportTopSections';
import { BoqImportSummary } from './import-boq/BoqImportSummary';
import { BoqColumnMapping } from './import-boq/BoqColumnMapping';
import { BoqPreviewFilters } from './import-boq/BoqPreviewFilters';
import { BoqPreviewTable } from './import-boq/BoqPreviewTable';

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
        <BoqImportTopSections
          t={t}
          handleDownloadTemplate={handleDownloadTemplate}
          fileInputRef={fileInputRef}
          handleFileChange={handleFileChange}
          fileName={fileName}
          sheetNames={sheetNames}
          selectedSheet={selectedSheet}
          handleSheetChange={handleSheetChange}
          generalError={generalError}
          isParsing={isParsing}
          />

        <BoqImportSummary
          parsedRows={parsedRows}
          isParsing={isParsing}
          t={t}
          validRows={validRows}
          unpricedRows={unpricedRows}
          totalContractVal={totalContractVal}
          totalCostVal={totalCostVal}
          existingItemCount={existingItemCount}
          importMode={importMode}
          setImportMode={setImportMode}
          />

        <BoqColumnMapping
          parsedRows={parsedRows}
          isParsing={isParsing}
          setShowCustomMapping={setShowCustomMapping}
          showCustomMapping={showCustomMapping}
          t={t}
          headerRowIndex={headerRowIndex}
          columnMapping={columnMapping}
          handleColumnMappingChange={handleColumnMappingChange}
          headers={headers}
          />

        {/* Preview Table & Filter Controls */}
        {parsedRows.length > 0 && !isParsing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <BoqPreviewFilters
              setActiveFilterTab={setActiveFilterTab}
              activeFilterTab={activeFilterTab}
              t={t}
              validRows={validRows}
              readyRows={readyRows}
              unpricedRows={unpricedRows}
              preambleRows={preambleRows}
              sectionHeaderRows={sectionHeaderRows}
              ignoreSectionHeaders={ignoreSectionHeaders}
              setIgnoreSectionHeaders={setIgnoreSectionHeaders}
              ignorePreambles={ignorePreambles}
              setIgnorePreambles={setIgnorePreambles}
              />

            <BoqPreviewTable
              t={t}
              displayedRows={displayedRows}
              ignoreSectionHeaders={ignoreSectionHeaders}
              ignorePreambles={ignorePreambles}
              handleRowCategoryChange={handleRowCategoryChange}
              handleRowUnitChange={handleRowUnitChange}
              handleRowQtyChange={handleRowQtyChange}
              handleRowPriceChange={handleRowPriceChange}
              />
          </div>
        )}
      </div>
    </StandardDialog>
  );
}
