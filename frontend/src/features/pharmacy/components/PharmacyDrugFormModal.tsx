import { useTranslation } from 'react-i18next';
import React from 'react';
import { DialogShell } from '@/shared/components/dialog-shell';
import { Button } from '@/shared/ui/button';
import { CustomSelect } from '@/shared/ui/custom-select';
import { XIcon } from '@/shared/components/icons/AppIcons';
import type { PharmacyDrug } from '../types/pharmacy.types';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

interface PharmacyDrugFormModalProps {
  open: boolean;
  onClose: () => void;
  editingDrug: Partial<PharmacyDrug> | null;
  formData: Partial<PharmacyDrug>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<PharmacyDrug>>>;
  onSubmit: (e: React.FormEvent) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: '36px',
  padding: '0 12px',
  borderRadius: '8px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  color: '#0f172a',
  backgroundColor: '#ffffff',
  boxSizing: 'border-box',
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: '#334155',
  marginBottom: '6px',
  lineHeight: '1.2',
};

export function PharmacyDrugFormModal({
  open,
  onClose,
  editingDrug,
  formData,
  setFormData,
  onSubmit,
}: PharmacyDrugFormModalProps) {
  const { t } = useTranslation();
  const handleBoxPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const bp = Number(e.target.value);
    const units = Number(formData.units_per_box || 1);
    // INV-FE3-FRONTEND-BOOK-DIGITS: the strip price is money posted in
    // the drug form; it rounds at the tenant's book digits, not 2dp.
    setFormData({
      ...formData,
      box_price: bp,
      strip_price: units > 0 ? roundMoneyValue(bp / units, currencyMoneyDigits(getGlobalSystemCurrency())) : bp,
    });
  };

  const handleUnitsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const units = Number(e.target.value);
    const bp = Number(formData.box_price || 0);
    setFormData({
      ...formData,
      units_per_box: units,
      strip_price: units > 0 ? roundMoneyValue(bp / units, currencyMoneyDigits(getGlobalSystemCurrency())) : bp,
    });
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      width="min(820px, 95vw)"
      ariaLabel={editingDrug ? t('pharmacy.pharmacy_drug_form_modal.s0', "تعديل بيانات الدواء") : t('pharmacy.pharmacy_drug_form_modal.s1', "إضافة دواء جديد بدليل الصيدلية")}
    >
      <div dir="rtl" style={{ width: '100%', boxSizing: 'border-box' }}>
        <div className="standard-dialog-header">
          <div className="standard-dialog-header-info">
            <h3 className="standard-dialog-title">
              {editingDrug ? t('pharmacy.pharmacy_drug_form_modal.s2', "تعديل بيانات الدواء") : t('pharmacy.pharmacy_drug_form_modal.s3', "إضافة دواء جديد بدليل الصيدلية")}
            </h3>
            <p className="standard-dialog-subtitle">
              {t('pharmacy.pharmacy_drug_form_modal.s4', "إدخال وتحديث البيانات العلمية والتجارية والتسعيرة الجبرية للدواء")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="standard-dialog-close-btn"
            aria-label={t('pharmacy.pharmacy_drug_form_modal.s5', "إغلاق")}
          >
            <XIcon size={18} />
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 20px 20px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s6', "الاسم التجاري (English) *")}</label>
              <input
                type="text"
                required
                value={formData.trade_name || ''}
                onChange={(e) => setFormData({ ...formData, trade_name: e.target.value })}
                placeholder={t('pharmacy.pharmacy_drug_form_modal.s7', "مثال: Panadol Extra")}
                style={inputStyle}
                dir="ltr"
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s8', "الاسم التجاري (بالعربي)")}</label>
              <input
                type="text"
                value={formData.trade_name_ar || ''}
                onChange={(e) => setFormData({ ...formData, trade_name_ar: e.target.value })}
                placeholder={t('pharmacy.pharmacy_drug_form_modal.s9', "مثال: بنادول إكسترا")}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s10', "المادة الفعالة (English) *")}</label>
              <input
                type="text"
                required
                value={formData.active_ingredient || ''}
                onChange={(e) => setFormData({ ...formData, active_ingredient: e.target.value })}
                placeholder={t('pharmacy.pharmacy_drug_form_modal.s11', "مثال: Paracetamol + Caffeine")}
                style={inputStyle}
                dir="ltr"
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s12', "المادة الفعالة (بالعربي)")}</label>
              <input
                type="text"
                value={formData.active_ingredient_ar || ''}
                onChange={(e) => setFormData({ ...formData, active_ingredient_ar: e.target.value })}
                placeholder={t('pharmacy.pharmacy_drug_form_modal.s13', "مثال: باراسيتامول + كافيين")}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s14', "الشكل الصيدلي")}</label>
              <CustomSelect
                value={formData.dosage_form}
                onChange={(val) => setFormData({ ...formData, dosage_form: val })}
                options={[
                  { value: t('pharmacy.pharmacy_drug_form_modal.s15', "أقراص (Tablets)"), label: t('pharmacy.pharmacy_drug_form_modal.s16', "أقراص (Tablets)") },
                  { value: t('pharmacy.pharmacy_drug_form_modal.s17', "كبسولات (Capsules)"), label: t('pharmacy.pharmacy_drug_form_modal.s18', "كبسولات (Capsules)") },
                  { value: t('pharmacy.pharmacy_drug_form_modal.s19', "شراب (Syrup)"), label: t('pharmacy.pharmacy_drug_form_modal.s20', "شراب (Syrup)") },
                  { value: t('pharmacy.pharmacy_drug_form_modal.s21', "أمبولات حقن (Ampoules)"), label: t('pharmacy.pharmacy_drug_form_modal.s22', "أمبولات حقن (Ampoules)") },
                  { value: t('pharmacy.pharmacy_drug_form_modal.s23', "فوار (Sachets)"), label: t('pharmacy.pharmacy_drug_form_modal.s24', "فوار وأكياس (Sachets)") },
                  { value: t('pharmacy.pharmacy_drug_form_modal.s25', "كريم جلدي (Cream)"), label: t('pharmacy.pharmacy_drug_form_modal.s26', "كريم موضعي (Cream)") },
                  { value: t('pharmacy.pharmacy_drug_form_modal.s27', "مرهم (Ointment)"), label: t('pharmacy.pharmacy_drug_form_modal.s28', "مرهم (Ointment)") },
                  { value: t('pharmacy.pharmacy_drug_form_modal.s29', "قطرة / بخاخ أنف (Drops/Spray)"), label: t('pharmacy.pharmacy_drug_form_modal.s30', "قطرة / بخاخ") },
                ]}
                style={{ height: '36px', borderRadius: '8px' }}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s31', "التركيز الدوائي")}</label>
              <input
                type="text"
                placeholder={t('pharmacy.pharmacy_drug_form_modal.s32', "مثال: 500mg")}
                value={formData.strength || ''}
                onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                style={inputStyle}
                dir="ltr"
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s33', "الشركة المصنعة")}</label>
              <input
                type="text"
                placeholder={t('pharmacy.pharmacy_drug_form_modal.s34', "اسم الشركة أو المصنع")}
                value={formData.manufacturer || ''}
                onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s35', "الباركود الدولي")}</label>
              <input
                type="text"
                placeholder={t('pharmacy.pharmacy_drug_form_modal.s36', "رقم الباركود الدولي")}
                value={formData.barcode || ''}
                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                style={{ ...inputStyle, fontFamily: 'monospace' }}
                dir="ltr"
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s37', "سعر العلبة (التسعيرة الجبرية)")}</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formData.box_price ?? 0}
                onChange={handleBoxPriceChange}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s38', "عدد الشرائط / الوحدات بالعلبة")}</label>
              <input
                type="number"
                min="1"
                value={formData.units_per_box ?? 1}
                onChange={handleUnitsChange}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s39', "سعر بيع الشريط التلقائي")}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.strip_price ?? 0}
                onChange={(e) => setFormData({ ...formData, strip_price: Number(e.target.value) })}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>{t('pharmacy.pharmacy_drug_form_modal.s40', "جدول الرقابة الدوائية")}</label>
              <CustomSelect
                value={formData.controlled_level || 'none'}
                onChange={(val) => setFormData({ ...formData, controlled_level: val as any })}
                options={[
                  { value: 'none', label: t('pharmacy.pharmacy_drug_form_modal.s41', "عادي (غير مجدول OTC)") },
                  { value: 'table_1', label: t('pharmacy.pharmacy_drug_form_modal.s42', "جدول أول (مؤثر / عهدة)") },
                  { value: 'table_2', label: t('pharmacy.pharmacy_drug_form_modal.s43', "جدول ثانٍ (رقابة مشددة)") },
                ]}
                style={{ height: '36px', borderRadius: '8px' }}
              />
            </div>
          </div>

          <div className="standard-dialog-footer" style={{ marginTop: '8px' }}>
            <Button variant="secondary" type="button" onClick={onClose}>
              {t('pharmacy.pharmacy_drug_form_modal.s44', "إلغاء")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              style={{ backgroundColor: '#170e5e', color: '#ffffff' }}
            >
              {editingDrug ? t('pharmacy.pharmacy_drug_form_modal.s45', "تحديث بيانات الدواء") : t('pharmacy.pharmacy_drug_form_modal.s46', "حفظ وإدراج بالدليل")}
            </Button>
          </div>
        </form>
      </div>
    </DialogShell>
  );
}
