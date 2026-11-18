import { useTranslation } from 'react-i18next';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import type { BarcodePrintPreset } from '@/lib/barcode-labels';
import { todayLocalDateKey } from '@/lib/format';

const EXPIRY_PERIOD_OPTIONS = [
  { value: '1', label: 'شهر واحد' },
  { value: '2', label: 'شهران' },
  { value: '3', label: '3 أشهر (عطارة وبقوليات)' },
  { value: '6', label: '6 أشهر (نصف سنة)' },
  { value: '9', label: '9 أشهر' },
  { value: '12', label: 'سنة واحدة (12 شهر)' },
  { value: '24', label: 'سنتان (24 شهر)' },
  { value: '36', label: '3 سنوات' },
];

const STORAGE_NOTE_PRESETS = [
  'يحفظ في مكان جاف وبارد',
  'يحفظ مبرداً من 1 إلى 4 م°',
  'يحفظ مجمداً عند -18 م°',
  'يحفظ بعيداً عن أشعة الشمس والحرارة',
];

const NET_WEIGHT_PRESETS = ['1 كجم', '500 جم', '250 جم', '5 كجم', '10 كجم'];

export function getFutureDate(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return todayLocalDateKey(d);
}

interface BarcodeFoodStatementSectionProps {
  preset: BarcodePrintPreset;
  activeUnitName?: string;
  showFoodStatement: boolean;
  setShowFoodStatement: (val: boolean) => void;
  showProductionDate: boolean;
  setShowProductionDate: (val: boolean) => void;
  productionDate: string;
  setProductionDate: (val: string) => void;
  packagingDate: string;
  setPackagingDate: (val: string) => void;
  expiryType: 'period' | 'date';
  setExpiryType: (val: 'period' | 'date') => void;
  expiryPeriodMonths: number;
  setExpiryPeriodMonths: (val: number) => void;
  expiryDate: string;
  setExpiryDate: (val: string) => void;
  showNetWeight: boolean;
  setShowNetWeight: (val: boolean) => void;
  netWeightText: string;
  setNetWeightText: (val: string) => void;
  foodStatementNote: string;
  setFoodStatementNote: (val: string) => void;
}

export function BarcodeFoodStatementSection({
  preset,
  activeUnitName,
  showFoodStatement,
  setShowFoodStatement,
  showProductionDate,
  setShowProductionDate,
  productionDate,
  setProductionDate,
  packagingDate,
  setPackagingDate,
  expiryType,
  setExpiryType,
  expiryPeriodMonths,
  setExpiryPeriodMonths,
  expiryDate,
  setExpiryDate,
  showNetWeight,
  setShowNetWeight,
  netWeightText,
  setNetWeightText,
  foodStatementNote,
  setFoodStatementNote,
}: BarcodeFoodStatementSectionProps) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        marginTop: '10px',
        background: showFoodStatement ? '#f0fdf4' : '#ffffff',
        border: `1px solid ${showFoodStatement ? '#86efac' : '#e2e8f0'}`,
        borderRadius: '6px',
        padding: '8px 10px',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.78rem',
            fontWeight: 700,
            color: showFoodStatement ? '#166534' : '#1e293b',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={showFoodStatement}
            onChange={(e) => setShowFoodStatement(e.target.checked)}
            style={{ accentColor: '#166534', width: '15px', height: '15px', cursor: 'pointer' }}
          />
          <span>{t('products.barcode_print_dialog.s38', 'بطاقة بيان السلع المعبأة (تواريخ التعبئة والصلاحية والوزن)')}</span>
        </label>
        <span style={{ fontSize: '0.68rem', color: '#15803d', fontWeight: 600 }}>{t('products.barcode_print_dialog.s39', 'مطابقة للتموين')}</span>
      </div>

      {showFoodStatement && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {preset.family === 'thermal' && preset.labelHeightMm < 32 && (
            <div style={{ fontSize: '0.7rem', color: '#92400e', background: '#fefce8', border: '1px solid #fde68a', borderRadius: '6px', padding: '5px 8px', lineHeight: 1.45 }}>
              مقاس <strong>{preset.labelWidthMm}×{preset.labelHeightMm} مم</strong> صغير مع بيانات التموين الكاملة — تم تفعيل التحجيم التلقائي (<strong>Auto-Fit</strong>) للحفاظ على وضوح الباركود، ولأفضل قراءة رسمية يُنصح بمقاس <strong>50×40 مم</strong>.
            </div>
          )}

          {/* أ) تواريخ الإنتاج والتعبئة والصلاحية */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>{t('products.barcode_print_dialog.s40', 'التواريخ وفترة الصلاحية:')}</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '0.72rem', color: '#334155' }}>
                <input
                  type="checkbox"
                  checked={showProductionDate}
                  onChange={(e) => setShowProductionDate(e.target.checked)}
                  style={{ accentColor: '#166534', width: '13px', height: '13px' }}
                />
                <span>{t('products.barcode_print_dialog.s41', 'إضافة تاريخ الإنتاج (إنتاج: ...)')}</span>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: showProductionDate ? '1fr 1fr 1fr' : '1fr 1fr', gap: '6px' }}>
              {showProductionDate && (
                <Field label={t('products.barcode_print_dialog.s42', 'تاريخ الإنتاج')}>
                  <input
                    type="date"
                    value={productionDate}
                    onChange={(e) => setProductionDate(e.target.value)}
                    style={{ height: '28px', fontSize: '0.74rem', padding: '2px 6px' }}
                  />
                </Field>
              )}

              <Field label={t('products.barcode_print_dialog.s43', 'تاريخ التعبئة')}>
                <input
                  type="date"
                  value={packagingDate}
                  onChange={(e) => setPackagingDate(e.target.value)}
                  style={{ height: '28px', fontSize: '0.74rem', padding: '2px 6px' }}
                />
              </Field>

              {expiryType === 'period' ? (
                <Field label={t('products.barcode_print_dialog.s44', 'فترة الصلاحية')}>
                  <CustomSelect
                    value={String(expiryPeriodMonths)}
                    options={EXPIRY_PERIOD_OPTIONS}
                    onChange={(val) => {
                      const m = Number(val || 6);
                      setExpiryPeriodMonths(m);
                      setExpiryDate(getFutureDate(m));
                    }}
                  />
                </Field>
              ) : (
                <Field label={t('products.barcode_print_dialog.s45', 'تاريخ الانتهاء')}>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    style={{ height: '28px', fontSize: '0.74rem', padding: '2px 6px' }}
                  />
                </Field>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.72rem', color: '#334155', marginTop: '6px' }}>
              <span>{t('products.barcode_print_dialog.s46', 'صيغة الصلاحية:')}</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="expiryType"
                  checked={expiryType === 'period'}
                  onChange={() => setExpiryType('period')}
                  style={{ accentColor: '#166534' }}
                />
                <span>{t('products.barcode_print_dialog.s47', 'مدة بالشهور (مثال: صالحة 6 أشهر)')}</span>
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="expiryType"
                  checked={expiryType === 'date'}
                  onChange={() => setExpiryType('date')}
                  style={{ accentColor: '#166534' }}
                />
                <span>{t('products.barcode_print_dialog.s48', 'تاريخ انتهاء صريح')}</span>
              </label>
            </div>
          </div>

          {/* ب) بيان الوزن الصافي المعتمد (المواصفة 2613 لسنة 2008) */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>
                <input
                  type="checkbox"
                  checked={showNetWeight}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setShowNetWeight(checked);
                    if (checked && !netWeightText) {
                      setNetWeightText(activeUnitName || t('products.barcode_print_dialog.s49', '1 كجم'));
                    }
                  }}
                  style={{ accentColor: '#166534', width: '14px', height: '14px' }}
                />
                <span>{t('products.barcode_print_dialog.s50', 'بيان الوزن الصافي المعتمد (صافي: ...)')}</span>
              </label>
              <span style={{ fontSize: '0.68rem', color: '#64748b' }}>{t('products.barcode_print_dialog.s51', 'مواصفة م.ق.م 2613')}</span>
            </div>

            {showNetWeight && (
              <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="text"
                    value={netWeightText}
                    onChange={(e) => setNetWeightText(e.target.value)}
                    placeholder={t('products.barcode_print_dialog.s52', 'مثال: 1 كجم أو 500 جم أو 250 جم')}
                    style={{ flex: 1, height: '28px', fontSize: '0.75rem', padding: '2px 8px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {NET_WEIGHT_PRESETS.map((presetWeight) => (
                    <button
                      key={presetWeight}
                      type="button"
                      onClick={() => setNetWeightText(presetWeight)}
                      style={{
                        fontSize: '0.68rem',
                        padding: '2px 6px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        background: netWeightText === presetWeight ? '#dcfce7' : '#f8fafc',
                        color: netWeightText === presetWeight ? '#15803d' : '#334155',
                        fontWeight: netWeightText === presetWeight ? 700 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {presetWeight}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ج) تعليمات وشروط التخزين والحفظ (القرار 330/2017) */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#166534' }}>{t('products.barcode_print_dialog.s53', 'تعليمات وشروط الحفظ والتخزين:')}</span>
              {foodStatementNote && (
                <button
                  type="button"
                  onClick={() => setFoodStatementNote('')}
                  style={{ border: 'none', background: 'transparent', color: '#b91c1c', fontSize: '0.68rem', cursor: 'pointer', padding: 0 }}
                >
                  {t('products.barcode_print_dialog.s54', 'مسح الملاحظة')}
                </button>
              )}
            </div>
            <input
              type="text"
              value={foodStatementNote}
              onChange={(e) => setFoodStatementNote(e.target.value)}
              placeholder={t('products.barcode_print_dialog.s55', 'مثال: يحفظ في مكان جاف وبارد بعيداً عن الرطوبة')}
              style={{ width: '100%', height: '28px', fontSize: '0.75rem', padding: '2px 8px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
              {STORAGE_NOTE_PRESETS.map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => setFoodStatementNote(note)}
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 6px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    background: foodStatementNote === note ? '#dcfce7' : '#f8fafc',
                    color: foodStatementNote === note ? '#15803d' : '#334155',
                    fontWeight: foodStatementNote === note ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {note}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
