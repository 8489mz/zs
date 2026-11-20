import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import type { ColumnMapping, ParsedBoqItemResult } from '../../utils/boqExcelParser';

export interface BoqColumnMappingProps {
  parsedRows: ParsedBoqItemResult[];
  isParsing: boolean;
  setShowCustomMapping: Dispatch<SetStateAction<boolean>>;
  showCustomMapping: boolean;
  t: TFunction;
  headerRowIndex: number;
  columnMapping: ColumnMapping;
  handleColumnMappingChange: (field: keyof ColumnMapping, newColIdx: number) => void;
  headers: string[];
}

export function BoqColumnMapping({
  parsedRows,
  isParsing,
  setShowCustomMapping,
  showCustomMapping,
  t,
  headerRowIndex,
  columnMapping,
  handleColumnMappingChange,
  headers,
}: BoqColumnMappingProps) {
  return (
    <>
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
    </>
  );
}
