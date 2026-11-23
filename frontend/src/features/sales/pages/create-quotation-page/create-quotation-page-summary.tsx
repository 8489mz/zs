import { Button } from '@/shared/ui/button';
import { formatCurrencyWithSymbol } from '@/lib/format';
import { UploadIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { useNavigate } from 'react-router-dom';

export interface CreateQuotationPageSummaryProps {
  t: ReturnType<typeof useTranslation>['t'];
  notes: string;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  termsConditions: string;
  setTermsConditions: React.Dispatch<React.SetStateAction<string>>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  attachments: File[];
  calculations: { rawSubtotal: number; totalDiscount: number; netTaxable: number; taxTotal: number; grandTotal: number };
  currency: string;
  handleSubmit: (approve: boolean) => void;
  isSubmitting: boolean;
  clearDraft: () => void;
  navigate: ReturnType<typeof useNavigate>;
}

export function CreateQuotationPageSummary(props: CreateQuotationPageSummaryProps) {
  const { t, notes, setNotes, termsConditions, setTermsConditions, handleFileUpload, attachments, calculations, currency, handleSubmit, isSubmitting, clearDraft, navigate } = props;
  return (
    <>
    {/* Section 4: 60/40 Symmetrical Bottom Split */}
    <section className="document-prototype-section" style={{ marginTop: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: '24px' }}>
        {/* Right Side (60%): Notes, Terms & Attachments */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {t('sales.create_quotation_page.s61', "ملاحظات إضافية على عرض السعر")}
            </label>
            <textarea
              rows={3}
              placeholder={t('sales.create_quotation_page.s62', "أدخل أي ملاحظات خاصة بالعميل أو بالمواصفات الفنية...")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {t('sales.create_quotation_page.s63', "الشروط والأحكام والضمانات التعاقدية")}
            </label>
            <textarea
              rows={4}
              value={termsConditions}
              onChange={(e) => setTermsConditions(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                lineHeight: 1.6,
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Attachments */}
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
              {t('sales.create_quotation_page.s64', "المرفقات والمستندات")}
            </label>
            <div
              style={{
                border: '2px dashed #cbd5e1',
                borderRadius: '8px',
                padding: '16px',
                textAlign: 'center',
                background: '#f8fafc',
                cursor: 'pointer',
              }}
              onClick={() => document.getElementById('quotation-file-input')?.click()}
            >
              <UploadIcon size={20} color="#64748b" style={{ margin: '0 auto 6px' }} />
              <div style={{ fontSize: '12.5px', color: '#475569', fontWeight: 600 }}>
                {t('sales.create_quotation_page.s65', "انقر لإرفاق عروض مواصفات أو كتالوجات أو مستندات")}
              </div>
              <input
                id="quotation-file-input"
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>
            {attachments.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {attachments.map((f, i) => (
                  <span
                    key={i}
                    style={{
                      background: '#e2e8f0',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '11.5px',
                      color: '#334155',
                    }}
                  >
                    {f.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Left Side (40%): Financial Summary Card */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '15px',
                fontWeight: 800,
                color: '#170e5e',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '12px',
                marginBottom: '16px',
              }}
            >
              {t('sales.create_quotation_page.s66', "ملخص القيمة الإجمالية")}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                <span>{t('sales.create_quotation_page.s67', "المجموع قبل الخصم:")}</span>
                <span style={{ fontWeight: 600 }}>{formatCurrencyWithSymbol(calculations.rawSubtotal, currency)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#16a34a' }}>
                <span>{t('sales.create_quotation_page.s68', "إجمالي الخصومات:")}</span>
                <span style={{ fontWeight: 600 }}>- {formatCurrencyWithSymbol(calculations.totalDiscount, currency)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                <span>{t('sales.create_quotation_page.s69', "الصافي الخاضع للضريبة:")}</span>
                <span style={{ fontWeight: 600 }}>{formatCurrencyWithSymbol(calculations.netTaxable, currency)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569' }}>
                <span>{t('sales.create_quotation_page.s70', "ضريبة القيمة المضافة:")}</span>
                <span style={{ fontWeight: 600 }}>+ {formatCurrencyWithSymbol(calculations.taxTotal, currency)}</span>
              </div>

              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '12px',
                  borderTop: '2px solid #cbd5e1',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{t('sales.create_quotation_page.s71', "الإجمالي النهائي:")}</span>
                <span style={{ fontSize: '20px', fontWeight: 900, color: '#170e5e' }}>
                  {formatCurrencyWithSymbol(calculations.grandTotal, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons at bottom of card */}
          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button
              variant="primary"
              onClick={() => handleSubmit(true)}
              disabled={isSubmitting}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                width: '100%',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 700,
              }}
            >
              {isSubmitting ? t('sales.create_quotation_page.s72', "جاري الحفظ...") : t('sales.create_quotation_page.s73', "اعتماد وحفظ عرض السعر")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                clearDraft();
                navigate('/quotations');
              }}
              style={{ width: '100%', fontSize: '13px' }}
            >
              {t('sales.create_quotation_page.s74', "العودة لقائمة عروض الأسعار")}
            </Button>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
