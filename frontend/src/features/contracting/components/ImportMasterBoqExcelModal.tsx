import { useTranslation } from 'react-i18next';
import { useState, useRef } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { downloadExcelFile } from '@/lib/browser';
import { contractingApi } from '../api/contracting.api';
import { MasterBoqTrade } from '../contracting.types';
import * as XLSX from 'xlsx';

interface ImportMasterBoqExcelModalProps {
  open: boolean;
  trades: MasterBoqTrade[];
  onClose: () => void;
  onImported: () => void;
}

interface ParsedMasterRow {
  index: number;
  itemCode: string;
  tradeCategory: string;
  tradeNameAr: string;
  name: string;
  description: string;
  unit: string;
  standardCost: number;
  standardPrice: number;
  selected: boolean;
  isValid: boolean;
  error?: string;
}

const TRADE_CATEGORY_MAP: Record<string, { key: string; ar: string }> = {
  // 1. Civil & Concrete
  'الأعمال المدنية والخرسانات': { key: 'civil_concrete', ar: 'الأعمال المدنية والخرسانات' },
  'مدني وخرسانات': { key: 'civil_concrete', ar: 'الأعمال المدنية والخرسانات' },
  civil_concrete: { key: 'civil_concrete', ar: 'الأعمال المدنية والخرسانات' },
  civil: { key: 'civil_concrete', ar: 'الأعمال المدنية والخرسانات' },

  // 2. Masonry & Insulation
  'المباني والعزل والفواصل': { key: 'masonry_insulation', ar: 'المباني والعزل والفواصل' },
  'أعمال المباني والعزل': { key: 'masonry_insulation', ar: 'المباني والعزل والفواصل' },
  'مباني وعزل': { key: 'masonry_insulation', ar: 'المباني والعزل والفواصل' },
  masonry_insulation: { key: 'masonry_insulation', ar: 'المباني والعزل والفواصل' },
  masonry: { key: 'masonry_insulation', ar: 'المباني والعزل والفواصل' },

  // 3. Finishes & Decor
  'التشطيبات المعمارية والديكور': { key: 'finishing_decor', ar: 'التشطيبات المعمارية والديكور' },
  'أعمال التشطيبات والديكور والدهانات': { key: 'finishing_decor', ar: 'التشطيبات المعمارية والديكور' },
  'أعمال التشطيبات والديكور': { key: 'finishing_decor', ar: 'التشطيبات المعمارية والديكور' },
  'تشطيبات وديكور': { key: 'finishing_decor', ar: 'التشطيبات المعمارية والديكور' },
  finishing_decor: { key: 'finishing_decor', ar: 'التشطيبات المعمارية والديكور' },
  finishes: { key: 'finishing_decor', ar: 'التشطيبات المعمارية والديكور' },

  // 4. Doors, Windows & Facades
  'الأبواب والشبابيك والواجهات': { key: 'doors_windows_aluminum', ar: 'الأبواب والشبابيك والواجهات' },
  'الأبواب والشبابيك والألومنيوم': { key: 'doors_windows_aluminum', ar: 'الأبواب والشبابيك والواجهات' },
  'الأبواب والشبابيك والواجهات والتكسيات': { key: 'doors_windows_aluminum', ar: 'الأبواب والشبابيك والواجهات' },
  'أبواب وشبابيك': { key: 'doors_windows_aluminum', ar: 'الأبواب والشبابيك والواجهات' },
  doors_windows_aluminum: { key: 'doors_windows_aluminum', ar: 'الأبواب والشبابيك والواجهات' },
  doors_windows_facades: { key: 'doors_windows_aluminum', ar: 'الأبواب والشبابيك والواجهات' },

  // 5. Steel Structure
  'المنشآت المعدنية والجمالونات': { key: 'steel_structure', ar: 'المنشآت المعدنية والجمالونات' },
  'الجمالونات والمنشآت المعدنية': { key: 'steel_structure', ar: 'المنشآت المعدنية والجمالونات' },
  'الجمالونات والحدادة والإنشاءات المعدنية': { key: 'steel_structure', ar: 'المنشآت المعدنية والجمالونات' },
  steel_structure: { key: 'steel_structure', ar: 'المنشآت المعدنية والجمالونات' },
  steel_structures: { key: 'steel_structure', ar: 'المنشآت المعدنية والجمالونات' },

  // 6. Electrical & Lighting
  'الأعمال الكهربائية والإنارة': { key: 'electrical_lighting', ar: 'الأعمال الكهربائية والإنارة' },
  'أعمال الكهرباء والإنارة': { key: 'electrical_lighting', ar: 'الأعمال الكهربائية والإنارة' },
  'الأعمال الكهربائية والتيار الخفيف': { key: 'electrical_lighting', ar: 'الأعمال الكهربائية والإنارة' },
  'كهرباء وإنارة': { key: 'electrical_lighting', ar: 'الأعمال الكهربائية والإنارة' },
  electrical_lighting: { key: 'electrical_lighting', ar: 'الأعمال الكهربائية والإنارة' },
  electrical: { key: 'electrical_lighting', ar: 'الأعمال الكهربائية والإنارة' },

  // 7. ELV & Smart Systems
  'التيار الخفيف والأنظمة الذكية (ELV)': { key: 'smart_elv_systems', ar: 'التيار الخفيف والأنظمة الذكية (ELV)' },
  'الأنظمة الذكية والإلكترونيات والـ ELV': { key: 'smart_elv_systems', ar: 'التيار الخفيف والأنظمة الذكية (ELV)' },
  'التيار الخفيف والسمارت': { key: 'smart_elv_systems', ar: 'التيار الخفيف والأنظمة الذكية (ELV)' },
  smart_elv_systems: { key: 'smart_elv_systems', ar: 'التيار الخفيف والأنظمة الذكية (ELV)' },
  smart_systems_elv: { key: 'smart_elv_systems', ar: 'التيار الخفيف والأنظمة الذكية (ELV)' },

  // 8. Plumbing & Sanitary
  'الأعمال الصحية وتغذية وصرف المياه': { key: 'plumbing_sanitary', ar: 'الأعمال الصحية وتغذية وصرف المياه' },
  'الأعمال الصحية والسباكة': { key: 'plumbing_sanitary', ar: 'الأعمال الصحية وتغذية وصرف المياه' },
  'الأعمال الصحية والصرف': { key: 'plumbing_sanitary', ar: 'الأعمال الصحية وتغذية وصرف المياه' },
  'صحي وسباكة': { key: 'plumbing_sanitary', ar: 'الأعمال الصحية وتغذية وصرف المياه' },
  plumbing_sanitary: { key: 'plumbing_sanitary', ar: 'الأعمال الصحية وتغذية وصرف المياه' },
  plumbing: { key: 'plumbing_sanitary', ar: 'الأعمال الصحية وتغذية وصرف المياه' },

  // 9. HVAC & Mechanical
  'التكييف والتهوية الميكانيكية': { key: 'hvac_mechanical', ar: 'التكييف والتهوية الميكانيكية' },
  'التكييف والتهوية والأعمال الميكانيكية': { key: 'hvac_mechanical', ar: 'التكييف والتهوية الميكانيكية' },
  'تكييف وميكانيكا': { key: 'hvac_mechanical', ar: 'التكييف والتهوية الميكانيكية' },
  hvac_mechanical: { key: 'hvac_mechanical', ar: 'التكييف والتهوية الميكانيكية' },
  hvac: { key: 'hvac_mechanical', ar: 'التكييف والتهوية الميكانيكية' },

  // 10. Fire Fighting
  'شبكات مكافحة وإطفاء الحريق': { key: 'fire_fighting', ar: 'شبكات مكافحة وإطفاء الحريق' },
  'مكافحة وإطفاء الحريق': { key: 'fire_fighting', ar: 'شبكات مكافحة وإطفاء الحريق' },
  'إطفاء وحريق': { key: 'fire_fighting', ar: 'شبكات مكافحة وإطفاء الحريق' },
  fire_fighting: { key: 'fire_fighting', ar: 'شبكات مكافحة وإطفاء الحريق' },
  fire_fighting_mep: { key: 'fire_fighting', ar: 'شبكات مكافحة وإطفاء الحريق' },

  // 11. Site Works & Infrastructure
  'تجهيزات الموقع والبنية التحتية واللاندسكيب': { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  'تجهيزات الموقع والأعمال التمهيدية': { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  'الموقع العام واللاندسكيب والشبكات الخارجية': { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  'الموقع العام واللاندسكيب': { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  'تجهيزات الموقع': { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  'لاندسكيب وطرق': { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  site_infrastructure: { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  site_mobilization: { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  site_landscape: { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
  landscape_infrastructure: { key: 'site_infrastructure', ar: 'تجهيزات الموقع والبنية التحتية واللاندسكيب' },
};

function normalizeArabicDigits(str: string): string {
  return str
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function parseNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = normalizeArabicDigits(String(val).trim()).replace(/[^0-9.-]+/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function ImportMasterBoqExcelModal({
  open,
  trades,
  onClose,
  onImported,
}: ImportMasterBoqExcelModalProps) {
  const { t: __t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<ParsedMasterRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleDownloadTemplate = async () => {
    const headers = [
      'كود البند (Item Code)',
      'التخصص الإنشائي (Trade)',
      'مسمى البند (Item Name)',
      'بيان الأعمال والمواصفات الفنية (Description)',
      'الوحدة (Unit)',
      'التكلفة المرجعية (Standard Cost)',
      'سعر البيع التعاقدي (Standard Price)',
    ];

    const sampleRows = [
      ['CIV-099', 'الأعمال المدنية والخرسانات', 'صب خرسانة ممسوسة بالهليكوبتر مع الألياف', 'صب وتسوية بلاطات أرضية سمك 15 سم مع مصلد أسطح', 'm2', 240, 350],
      ['ELE-099', 'الأعمال الكهربائية والتيار الخفيف', 'تأسيس مسارات خراطيم بالسقف الخرساني', 'تمديد خراطيم ومخارج إنارة ومراوح وتثبيت بالحديد', 'point', 45, 75],
      ['PLU-099', 'الأعمال الصحية وتغذية وصرف المياه', 'تأسيس تغذية مياه PPR ألماني 15 بار', 'شبكة تغذية مدفونة داخل الحوائط شاملة كبس واختبار 24 ساعة', 'm', 80, 125],
      ['FIN-099', 'أعمال التشطيبات والديكور والدهانات', 'توريد وتركيب أرضيات HDF ألماني 8 مم', 'شامل طبقة الفوم العازل والنعلات والزوايا والأركان', 'm2', 290, 410],
    ];

    await downloadExcelFile(
      `نموذج_استيراد_بنك_بنود_المقاولات_${new Date().toISOString().slice(0, 10)}.xlsx`,
      headers,
      sampleRows,
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('الملف فارغ أو لا يحتوي على أوراق عمل صالحة');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rawMatrix: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      if (rawMatrix.length < 2) {
        throw new Error('الملف لا يحتوي على بيانات كافية (يجب أن يحتوي على صف عناوين وبيانات البنود)');
      }

      // 1. Identify header row (scan first 10 rows)
      let headerRowIdx = 0;
      const colIndices = {
        code: -1,
        trade: -1,
        name: -1,
        desc: -1,
        unit: -1,
        cost: -1,
        price: -1,
      };

      for (let r = 0; r < Math.min(10, rawMatrix.length); r++) {
        const row = rawMatrix[r];
        row.forEach((cellVal: any, c: number) => {
          const s = String(cellVal || '').trim().toLowerCase();
          if (colIndices.code === -1 && (s.includes('كود') || s.includes('code') || s.includes('رقم البند'))) colIndices.code = c;
          if (colIndices.trade === -1 && (s.includes('تخصص') || s.includes('trade') || s.includes('تصنيف') || s.includes('قسم'))) colIndices.trade = c;
          if (colIndices.name === -1 && (s.includes('مسمى') || s.includes('اسم البند') || s.includes('item name') || s.includes('name') || s.includes('البند'))) colIndices.name = c;
          if (colIndices.desc === -1 && (s.includes('مواصف') || s.includes('بيان') || s.includes('وصف') || s.includes('desc') || s.includes('specification'))) colIndices.desc = c;
          if (colIndices.unit === -1 && (s.includes('وحدة') || s.includes('unit') || s.includes('التمييز'))) colIndices.unit = c;
          if (colIndices.cost === -1 && (s.includes('تكل') || s.includes('cost') || s.includes('سعر التكلفة'))) colIndices.cost = c;
          if (colIndices.price === -1 && (s.includes('بيع') || s.includes('price') || s.includes('سعر البيع') || s.includes('سعر الفئة'))) colIndices.price = c;
        });

        if (colIndices.name !== -1 || colIndices.code !== -1) {
          headerRowIdx = r;
          break;
        }
      }

      // Fallback defaults if headers not strictly labeled
      if (colIndices.code === -1) colIndices.code = 0;
      if (colIndices.trade === -1) colIndices.trade = 1;
      if (colIndices.name === -1) colIndices.name = colIndices.desc !== -1 ? colIndices.desc : 2;
      if (colIndices.desc === -1) colIndices.desc = colIndices.name !== 3 ? 3 : 2;
      if (colIndices.unit === -1) colIndices.unit = 4;
      if (colIndices.cost === -1) colIndices.cost = 5;
      if (colIndices.price === -1) colIndices.price = 6;

      const rows: ParsedMasterRow[] = [];
      let autoSeq = 1;

      for (let r = headerRowIdx + 1; r < rawMatrix.length; r++) {
        const row = rawMatrix[r];
        if (!row || row.length === 0) continue;

        let code = String(row[colIndices.code] || '').trim();
        const rawTrade = String(row[colIndices.trade] || '').trim();
        let name = String(row[colIndices.name] || '').trim();
        const desc = colIndices.desc !== -1 ? String(row[colIndices.desc] || '').trim() : '';
        const unit = String(row[colIndices.unit] || 'm3').trim() || 'm3';
        const cost = parseNumber(row[colIndices.cost]);
        const price = parseNumber(row[colIndices.price]);

        if (!name && desc) {
          name = desc.slice(0, 80);
        }
        if (!name) continue; // Skip empty rows

        if (!code) {
          code = `CUST-${String(autoSeq++).padStart(4, '0')}`;
        }

        // Resolve trade category
        let tradeCategory = 'civil_concrete';
        let tradeNameAr = 'الأعمال المدنية والخرسانات';

        if (rawTrade) {
          const match = TRADE_CATEGORY_MAP[rawTrade] || Object.entries(TRADE_CATEGORY_MAP).find(([k]) => rawTrade.includes(k))?.[1];
          if (match) {
            tradeCategory = match.key;
            tradeNameAr = match.ar;
          } else {
            // Find in loaded trades
            const existingTrade = trades.find((t) => t.tradeNameAr === rawTrade || t.tradeCategory === rawTrade);
            if (existingTrade) {
              tradeCategory = existingTrade.tradeCategory;
              tradeNameAr = existingTrade.tradeNameAr;
            } else {
              tradeCategory = 'custom_trade';
              tradeNameAr = rawTrade;
            }
          }
        }

        rows.push({
          index: r,
          itemCode: code,
          tradeCategory,
          tradeNameAr,
          name,
          description: desc || name,
          unit,
          standardCost: cost,
          standardPrice: price > 0 ? price : Math.round(cost * 1.25),
          selected: true,
          isValid: Boolean(name && code),
        });
      }

      if (rows.length === 0) {
        throw new Error('لم يتم العثور على أي صفوف بنود صالحة في الملف المرفوع');
      }

      setParsedRows(rows);
    } catch (err: any) {
      console.error('Failed to parse Excel file:', err);
      setErrorMessage(err?.message || 'تعذر قراءة ملف الإكسيل، يرجى التأكد من تطابق التنسيق');
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleSelectAll = (selected: boolean) => {
    setParsedRows((prev) => prev.map((r) => ({ ...r, selected: r.isValid ? selected : false })));
  };

  const toggleRowSelect = (index: number) => {
    setParsedRows((prev) =>
      prev.map((r) => (r.index === index ? { ...r, selected: !r.selected } : r)),
    );
  };

  const handleImportSubmit = async () => {
    const selectedItems = parsedRows.filter((r) => r.selected && r.isValid);
    if (selectedItems.length === 0) {
      setErrorMessage('يرجى تحديد بند واحد على الأقل للاستيراد');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const payload = selectedItems.map((r) => ({
        itemCode: r.itemCode,
        tradeCategory: r.tradeCategory,
        tradeNameAr: r.tradeNameAr,
        name: r.name,
        description: r.description,
        unit: r.unit,
        standardCost: r.standardCost,
        standardPrice: r.standardPrice,
      }));

      const res = await contractingApi.bulkImportMasterBoqItems(payload);
      setSuccessMessage(res.message || `تم استيراد ${selectedItems.length} بند بنجاح إلى بنك البنود المرجعي`);
      setTimeout(() => {
        onImported();
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Bulk import error:', err);
      setErrorMessage(err?.message || 'تعذر استيراد البنود، يرجى مراجعة البيانات المدخلة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCount = parsedRows.filter((r) => r.selected && r.isValid).length;

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={__t('contracting.import_master_boq_excel_modal.s0', "استيراد بنود المقاولات من ملف Excel")}
      subtitle={__t('contracting.import_master_boq_excel_modal.s1', "رفع ومعالجة شيتات المقايسات والتسعير وإدراجها دفعة واحدة في بنك البنود المرجعي للشركة.")}
      size="xl"
      minHeight="min(640px, 85vh)"
    >
      <div style={{ padding: '0', display: 'flex', flexDirection: 'column', gap: '16px' }} dir="rtl">
        {/* شريط الإرشادات وتنزيل النموذج */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ color: '#170e5e', display: 'flex' }}>
              <AppIcons.FileSpreadsheet size={20} />
            </div>
            <div>
              <div style={{ fontSize: 'var(--font-body)', fontWeight: 700, color: '#0f172a' }}>
                {__t('contracting.import_master_boq_excel_modal.s2', "نموذج الإكسيل القياسي")}
              </div>
              <div style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                {__t('contracting.import_master_boq_excel_modal.s3', "يدعم ملفات .xlsx و .xls و .csv مع المطابقة التلقائية لأسماء وتخصصات البنود.")}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDownloadTemplate}
            style={{
              height: '34px',
              padding: '0 14px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#170e5e',
              fontSize: 'var(--font-micro)',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AppIcons.Download size={14} />
            <span>{__t('contracting.import_master_boq_excel_modal.s4', "تحميل نموذج Excel الاسترشادي")}</span>
          </button>
        </div>

        {/* التنبيهات */}
        {errorMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: 'var(--font-body)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AppIcons.AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              fontSize: 'var(--font-body)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AppIcons.CheckCircle size={16} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* صندوق الرفع السحابي */}
        {parsedRows.length === 0 ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: '2px dashed #cbd5e1',
              borderRadius: '12px',
              padding: '44px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              background: '#fcfdfd',
              transition: 'border-color 0.2s, background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#170e5e';
              e.currentTarget.style.backgroundColor = '#f8fafc';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#cbd5e1';
              e.currentTarget.style.backgroundColor = '#fcfdfd';
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx, .xls, .csv"
              style={{ display: 'none' }}
            />
            <div style={{ color: '#64748b', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
              <AppIcons.Upload size={40} />
            </div>
            <div style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
              {__t('contracting.import_master_boq_excel_modal.s5', "انقر لاختيار ملف Excel أو اسحب الملف هنا")}
            </div>
            <div style={{ fontSize: 'var(--font-subtitle)', color: '#64748b' }}>
              {__t('contracting.import_master_boq_excel_modal.s6', "يدعم ملفات مقايسات المشاريع وشيتات التسعير (.xlsx, .xls, .csv)")}
            </div>
            {isParsing && (
              <div style={{ marginTop: '14px', fontSize: 'var(--font-body)', color: '#170e5e', fontWeight: 600 }}>
                {__t('contracting.import_master_boq_excel_modal.s7', "جاري فحص وقراءة البنود من الملف...")}
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* إحصائيات المعاينة والشريط العلوي */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: 'var(--font-section-title)', fontWeight: 700, color: '#0f172a' }}>
                  {__t('contracting.import_master_boq_excel_modal.s8', "معاينة البنود المقروءة:")}
                </span>
                <span
                  style={{
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    border: '1px solid #bfdbfe',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: 'var(--font-badge)',
                    fontWeight: 700,
                  }}
                >
                  {selectedCount} {__t('contracting.import_master_boq_excel_modal.s9', "من أصل")} {parsedRows.length} {__t('contracting.import_master_boq_excel_modal.s10', "محدد للاستيراد")}
                </span>
                <span style={{ fontSize: 'var(--font-micro)', color: '#64748b' }}>
                  {__t('contracting.import_master_boq_excel_modal.s11', "(الملف:")} {fileName})
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => toggleSelectAll(true)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    fontSize: 'var(--font-micro)',
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {__t('contracting.import_master_boq_excel_modal.s12', "تحديد الكل")}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSelectAll(false)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    fontSize: 'var(--font-micro)',
                    fontWeight: 600,
                    color: '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  {__t('contracting.import_master_boq_excel_modal.s13', "إلغاء التحديد")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setParsedRows([]);
                    setFileName('');
                  }}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    fontSize: 'var(--font-micro)',
                    fontWeight: 600,
                    color: '#b91c1c',
                    cursor: 'pointer',
                  }}
                >
                  {__t('contracting.import_master_boq_excel_modal.s14', "تغيير الملف")}
                </button>
              </div>
            </div>

            {/* جدول المعاينة الدقيق */}
            <div
              style={{
                maxHeight: '380px',
                overflowY: 'auto',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                background: '#ffffff',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
                <colgroup>
                  <col style={{ width: '38px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '140px' }} />
                  <col style={{ width: 'auto' }} />
                  <col style={{ width: '65px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '65px' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 2 }}>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedCount === parsedRows.length && parsedRows.length > 0}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                      {__t('contracting.import_master_boq_excel_modal.s15', "كود البند")}
                    </th>
                    <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                      {__t('contracting.import_master_boq_excel_modal.s16', "التخصص")}
                    </th>
                    <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                      {__t('contracting.import_master_boq_excel_modal.s17', "مسمى البند والمواصفات")}
                    </th>
                    <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>
                      {__t('contracting.import_master_boq_excel_modal.s18', "الوحدة")}
                    </th>
                    <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                      {__t('contracting.import_master_boq_excel_modal.s19', "التكلفة")}
                    </th>
                    <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569' }}>
                      {__t('contracting.import_master_boq_excel_modal.s20', "سعر البيع")}
                    </th>
                    <th style={{ padding: '8px 10px', fontSize: 'var(--font-table-head)', fontWeight: 600, color: '#475569', textAlign: 'center' }}>
                      {__t('contracting.import_master_boq_excel_modal.s21', "الهامش")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((r) => {
                    const margin = r.standardPrice > 0 ? Math.round(((r.standardPrice - r.standardCost) / r.standardPrice) * 100) : 0;
                    return (
                      <tr
                        key={r.index}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: r.selected ? '#ffffff' : '#fafafa',
                          opacity: r.selected ? 1 : 0.6,
                        }}
                      >
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={r.selected}
                            onChange={() => toggleRowSelect(r.index)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#170e5e', fontFamily: 'monospace' }}>
                          {r.itemCode}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)' }}>
                          <span
                            style={{
                              background: '#f1f5f9',
                              color: '#475569',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              display: 'inline-block',
                            }}
                          >
                            {r.tradeNameAr}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontSize: 'var(--font-body)', fontWeight: 600, color: '#0f172a' }}>
                            {r.name}
                          </div>
                          {r.description && r.description !== r.name && (
                            <div style={{ fontSize: 'var(--font-micro)', color: '#64748b', marginTop: '2px' }}>
                              {r.description.slice(0, 100)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', textAlign: 'center', color: '#475569' }}>
                          {r.unit}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', color: '#64748b' }}>
                          {r.standardCost > 0 ? r.standardCost.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 'var(--font-micro)', fontWeight: 700, color: '#170e5e' }}>
                          {r.standardPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '8px',
                              background: margin >= 20 ? '#ecfdf5' : '#fffbeb',
                              color: margin >= 20 ? '#047857' : '#b45309',
                            }}
                          >
                            {margin}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <StandardDialogFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          style={{
            height: '38px',
            padding: '0 16px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            color: '#475569',
            fontWeight: 600,
            fontSize: 'var(--font-body)',
            cursor: 'pointer',
          }}
        >
          {__t('contracting.import_master_boq_excel_modal.s22', "إلغاء")}
        </button>

        {parsedRows.length > 0 && (
          <button
            type="button"
            onClick={handleImportSubmit}
            disabled={isSubmitting || selectedCount === 0}
            style={{
              height: '38px',
              padding: '0 20px',
              borderRadius: '8px',
              border: 'none',
              background: '#170e5e',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 'var(--font-body)',
              cursor: selectedCount > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
              opacity: selectedCount > 0 && !isSubmitting ? 1 : 0.6,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 3px rgba(23, 14, 94, 0.2)',
            }}
          >
            <AppIcons.CheckCircle size={15} />
            <span>
              {isSubmitting ? __t('contracting.import_master_boq_excel_modal.s23', "جاري الاستيراد والحفظ...") : `تأكيد استيراد (${selectedCount}) بند إلى البنك`}
            </span>
          </button>
        )}
      </StandardDialogFooter>
    </StandardDialog>
  );
}
